//! 点検・校正: `…/calibration` starts / steps / ends a session,
//! `…/motor-test` spins one motor (or all in turn). Every command goes through the queue and
//! the audit log; ESC calibration and motor tests spin propellers and need a confirm token.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::{
    CalibKind, CalibPhase, CalibRecord, CalibStatus, LinkStatus, ParamChange, SysId, VehicleCommand,
};
use rgcs_mavlink::Outcome;
use rgcs_store::audit::AuditInput;
use rgcs_store::param_history::ParamHistoryInput;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::commands::confirm_failure;
use crate::params::write_one;

pub const MAV_CMD_PREFLIGHT_CALIBRATION: u16 = 241;
pub const MAV_CMD_DO_MOTOR_TEST: u16 = 209;
pub const MAV_CMD_SET_MESSAGE_INTERVAL: u16 = 511;
pub const MAV_CMD_DO_START_MAG_CAL: u16 = 42424;
pub const MAV_CMD_DO_CANCEL_MAG_CAL: u16 = 42426;
pub const MAV_CMD_ACCELCAL_VEHICLE_POS: u16 = 42429;
const MSG_RC_CHANNELS: f32 = 65.0;
/// RC input at 10 Hz while the sticks are swept; 0 hands the rate back to the vehicle.
const RC_INTERVAL_US: f32 = 100_000.0;
/// `ESC_CALIBRATION = 3`: ArduCopter calibrates the ESCs automatically on the next boot.
const ESC_CAL_AUTO: f32 = 3.0;
pub const CONFIRM_ESC: &str = "calib_esc";
pub const CONFIRM_MOTOR: &str = "motor_test";
pub const MAX_MOTOR_SECONDS: f32 = 10.0;
pub const MAX_MOTORS: u8 = 12;

#[derive(Serialize)]
struct Overview {
    records: Vec<CalibRecord>,
    session: Option<CalibStatus>,
}

#[derive(Deserialize)]
pub struct StartBody {
    kind: CalibKind,
    confirm_token: Option<String>,
}

#[derive(Deserialize)]
pub struct MotorBody {
    motor: u8,
    pct: f32,
    seconds: f32,
    /// Motors tested one after another starting at `motor` (0 = only `motor`).
    #[serde(default)]
    count: u8,
    confirm_token: Option<String>,
}

#[derive(Serialize)]
struct MotorReply {
    ok: bool,
    reason: Option<String>,
}

/// `GET …/calibration`: the latest run of each kind and the session, if any.
pub async fn overview(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    match app.store.latest_calibrations(sysid).await {
        Ok(records) => ok(Overview {
            records,
            session: app.calib.get(sysid),
        }),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

/// `POST …/calibration {kind}`
pub async fn start(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<StartBody>,
) -> Response {
    if let Some(r) = refused(&app, sysid).await {
        return r;
    }
    if body.kind == CalibKind::Motor {
        return err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "motor tests use /motor-test",
        );
    }
    if body.kind == CalibKind::Esc {
        if let Some(r) = unconfirmed(&app, body.confirm_token.as_deref(), sysid, CONFIRM_ESC) {
            return r;
        }
    }
    let Some(running) = app.calib.begin(sysid, body.kind, &op.username) else {
        return err(
            StatusCode::CONFLICT,
            "busy",
            "a calibration is already running on this vehicle",
        );
    };
    let user = op.username.as_str();
    let next = match body.kind {
        CalibKind::Accel => settle(
            send(&app, user, sysid, MAV_CMD_PREFLIGHT_CALIBRATION, p5(1.0)).await,
            None,
        ),
        CalibKind::Level => settle(
            send(&app, user, sysid, MAV_CMD_PREFLIGHT_CALIBRATION, p5(2.0)).await,
            Some(CalibPhase::Done),
        ),
        CalibKind::Compass => settle(
            send(&app, user, sysid, MAV_CMD_DO_START_MAG_CAL, mag_params()).await,
            None,
        ),
        CalibKind::Rc => settle(
            send(
                &app,
                user,
                sysid,
                MAV_CMD_SET_MESSAGE_INTERVAL,
                rc_rate(RC_INTERVAL_US),
            )
            .await,
            None,
        ),
        CalibKind::Esc | CalibKind::Motor => esc(&app, user, sysid).await,
    };
    finish_step(&app, sysid, running, next)
}

/// `POST …/calibration/next`: the vehicle sits in the requested accelerometer position.
pub async fn next(State(app): State<AppState>, AuthUser(op): AuthUser, Path(sysid): Path<SysId>) -> Response {
    if let Some(r) = refused(&app, sysid).await {
        return r;
    }
    let session = app.calib.get(sysid);
    let Some((s, pos)) = session.and_then(|s| {
        s.position
            .filter(|_| s.phase == CalibPhase::Waiting)
            .map(|p| (s, p))
    }) else {
        return err(
            StatusCode::CONFLICT,
            "not_waiting",
            "the vehicle is not waiting for a position",
        );
    };
    // Running before the send: the vehicle asks for the next position as soon as it accepts.
    app.calib
        .set(sysid, s.clone().with_phase(CalibPhase::Running, None));
    let outcome = send(
        &app,
        &op.username,
        sysid,
        MAV_CMD_ACCELCAL_VEHICLE_POS,
        p1(f32::from(pos)),
    )
    .await;
    if !outcome.ok() {
        app.calib
            .set(sysid, s.with_phase(CalibPhase::Waiting, outcome.reason()));
    }
    ok(app.calib.get(sysid))
}

/// `POST …/calibration/cancel`
pub async fn cancel(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    let Some(s) = app.calib.get(sysid).filter(CalibStatus::is_active) else {
        return err(StatusCode::CONFLICT, "not_running", "no calibration is running");
    };
    match s.kind {
        CalibKind::Compass => {
            drop(send(&app, &op.username, sysid, MAV_CMD_DO_CANCEL_MAG_CAL, [0.0; 7]).await)
        }
        CalibKind::Rc => drop(
            send(
                &app,
                &op.username,
                sysid,
                MAV_CMD_SET_MESSAGE_INTERVAL,
                rc_rate(0.0),
            )
            .await,
        ),
        _ => {}
    }
    let done = s.with_phase(CalibPhase::Cancelled, None);
    app.calib.set(sysid, done.clone());
    ok(done)
}

/// `POST …/calibration/finish`: RC only — writes `RCn_MIN / MAX / TRIM` of the swept channels.
pub async fn finish(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    if let Some(r) = refused(&app, sysid).await {
        return r;
    }
    let Some(s) = app
        .calib
        .get(sysid)
        .filter(|s| s.kind == CalibKind::Rc && s.is_active())
    else {
        return err(
            StatusCode::CONFLICT,
            "not_running",
            "no RC calibration is running",
        );
    };
    let changes: Vec<ParamChange> = s
        .rc_result()
        .into_iter()
        .flat_map(|(ch, min, max, trim)| {
            [("MIN", min), ("MAX", max), ("TRIM", trim)].map(|(k, v)| ParamChange {
                name: format!("RC{ch}_{k}"),
                value: f32::from(v),
            })
        })
        .collect();
    let verified = !changes.is_empty() && write_all(&app, &op.username, sysid, &changes).await;
    drop(
        send(
            &app,
            &op.username,
            sysid,
            MAV_CMD_SET_MESSAGE_INTERVAL,
            rc_rate(0.0),
        )
        .await,
    );
    let reason = match (changes.is_empty(), verified) {
        (true, _) => Some("rc_not_moved".to_string()),
        (false, false) => Some("params_unverified".to_string()),
        _ => None,
    };
    let done = s.with_phase(
        if verified {
            CalibPhase::Done
        } else {
            CalibPhase::Failed
        },
        reason,
    );
    app.calib.set(sysid, done.clone());
    ok(done)
}

/// `POST …/motor-test {motor, pct, seconds, count?}` (MAV_CMD_DO_MOTOR_TEST, throttle in %).
pub async fn motor_test(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<MotorBody>,
) -> Response {
    if let Some(r) = refused(&app, sysid).await {
        return r;
    }
    if let Some(r) = unconfirmed(&app, body.confirm_token.as_deref(), sysid, CONFIRM_MOTOR) {
        return r;
    }
    let valid = (1..=MAX_MOTORS).contains(&body.motor)
        && body.count <= MAX_MOTORS
        && body.pct > 0.0
        && body.pct <= 100.0
        && body.seconds > 0.0
        && body.seconds <= MAX_MOTOR_SECONDS;
    if !valid {
        return err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "motor 1–12, throttle 1–100 %, 0–10 s",
        );
    }
    let params = [
        f32::from(body.motor),
        0.0,
        body.pct,
        body.seconds,
        f32::from(body.count),
        0.0,
        0.0,
    ];
    let outcome = send(&app, &op.username, sysid, MAV_CMD_DO_MOTOR_TEST, params).await;
    let detail = format!("M{} {}% {}s", body.motor, body.pct, body.seconds);
    if let Err(e) = app
        .store
        .record_calibration(sysid, CalibKind::Motor, outcome.ok(), &op.username, Some(&detail))
        .await
    {
        tracing::error!(error = %e, "motor test record failed");
    }
    ok(MotorReply {
        ok: outcome.ok(),
        reason: outcome.reason(),
    })
}

/// The session after a start: a refusal fails it, `done` finishes it, otherwise the vehicle's
/// frames move it on (and may already have).
fn settle(outcome: Outcome, done: Option<CalibPhase>) -> Option<(CalibPhase, Option<String>)> {
    match (outcome.ok(), done) {
        (false, _) => Some((CalibPhase::Failed, outcome.reason())),
        (true, Some(p)) => Some((p, None)),
        (true, None) => None,
    }
}

fn finish_step(
    app: &AppState,
    sysid: SysId,
    running: CalibStatus,
    next: Option<(CalibPhase, Option<String>)>,
) -> Response {
    if let Some((phase, reason)) = next {
        let current = app.calib.get(sysid).unwrap_or(running);
        app.calib.set(sysid, current.with_phase(phase, reason));
    }
    ok(app.calib.get(sysid))
}

async fn esc(app: &AppState, operator: &str, sysid: SysId) -> Option<(CalibPhase, Option<String>)> {
    let change = ParamChange {
        name: "ESC_CALIBRATION".into(),
        value: ESC_CAL_AUTO,
    };
    if write_all(app, operator, sysid, &[change]).await {
        Some((CalibPhase::Done, Some("next_boot".into())))
    } else {
        Some((CalibPhase::Failed, Some("params_unverified".into())))
    }
}

/// Writes and verifies each change, recording it in the parameter history; stops (false) as soon
/// as the vehicle arms or its link is lost.
async fn write_all(app: &AppState, operator: &str, sysid: SysId, changes: &[ParamChange]) -> bool {
    let mut all = true;
    for change in changes {
        // a write can take seconds: the vehicle must still be connected and disarmed for each one
        if refused(app, sysid).await.is_some() {
            return false;
        }
        let old_value = app.params.get(sysid, &change.name);
        let result = write_one(&app.params, sysid, change, &app.outgoing).await;
        let row = ParamHistoryInput {
            operator,
            sysid,
            name: &change.name,
            old_value,
            new_value: change.value,
            verified: result.verified,
        };
        if let Err(e) = app.store.record_param(row).await {
            tracing::error!(error = %e, "param_history write failed");
        }
        all &= result.verified;
    }
    all
}

/// Why the vehicle cannot be calibrated now: not connected, link lost or armed.
async fn refused(app: &AppState, sysid: SysId) -> Option<Response> {
    let Some(v) = app.router.lock().await.state(sysid).cloned() else {
        return Some(err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        ));
    };
    if v.link == LinkStatus::Lost {
        return Some(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s",
        ));
    }
    v.armed
        .then(|| err(StatusCode::CONFLICT, "vehicle_armed", "disarm before calibrating"))
}

/// The refusal when the confirm token is missing, expired or for another command.
fn unconfirmed(app: &AppState, token: Option<&str>, sysid: SysId, name: &str) -> Option<Response> {
    let verdict = token.map(|t| app.consume_confirm(t, sysid, name));
    confirm_failure(verdict).map(|reason| err(StatusCode::CONFLICT, "confirm_required", reason))
}

/// Queues one COMMAND_LONG, waits for its ACK and audits it.
async fn send(app: &AppState, operator: &str, sysid: SysId, mav_cmd: u16, params: [f32; 7]) -> Outcome {
    let Some(vehicle) = app.router.lock().await.state(sysid).cloned() else {
        return Outcome::LinkClosed;
    };
    let cmd = VehicleCommand::Other { mav_cmd, params };
    let (done, rx) = oneshot::channel();
    let job = crate::commands::queued(&vehicle, cmd.clone(), done);
    let outcome = match app.queue.send(job).await {
        Ok(()) => rx.await.unwrap_or(Outcome::LinkClosed),
        Err(_) => Outcome::LinkClosed,
    };
    let entry = AuditInput {
        operator,
        sysid: Some(sysid),
        target: "vehicle",
        command: "calibration",
        args: serde_json::to_string(&cmd).ok(),
        result: if outcome.ok() { "ok" } else { "failed" },
        reason: outcome.reason(),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
    outcome
}

fn p1(v: f32) -> [f32; 7] {
    [v, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
}

fn p5(v: f32) -> [f32; 7] {
    [0.0, 0.0, 0.0, 0.0, v, 0.0, 0.0]
}

/// All compasses, no retry, autosave, no delay, no autoreboot.
fn mag_params() -> [f32; 7] {
    [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]
}

fn rc_rate(us: f32) -> [f32; 7] {
    [MSG_RC_CHANNELS, us, 0.0, 0.0, 0.0, 0.0, 0.0]
}
