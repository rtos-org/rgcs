//! Flights (様式 1 rows) with squawks, minute totals and append-only corrections.
//! `takeoff_at` / `landed_at` are unix ms; a flight is open while `landed_at IS NULL`.

use rgcs_core::jst;
use rgcs_core::{Flight, FlightInput, FlightPatch, FlightSquawk, FlightSquawkInput, FlightStatus, SysId};
use sqlx::Row;

use crate::{unix_ms, Result, Store, StoreError};

/// Raw column values of one `flights` row (what a patch rewrites).
#[derive(Debug, Clone)]
struct Cols {
    sysid: SysId,
    status: FlightStatus,
    pilot: String,
    pilot_license: String,
    takeoff_at: u64,
    landed_at: Option<u64>,
    takeoff_lat: Option<f64>,
    takeoff_lon: Option<f64>,
    landing_lat: Option<f64>,
    landing_lon: Option<f64>,
    takeoff_place: String,
    landing_place: String,
    purposes: Vec<String>,
    specific_flight: Vec<String>,
    summary: String,
    safety_notes: String,
    supersedes: Option<i64>,
    created_by: String,
    created_at: u64,
}

fn json_list(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".into())
}

fn ms(v: i64) -> u64 {
    v.max(0) as u64
}

fn cols_of(r: &sqlx::sqlite::SqliteRow) -> Cols {
    Cols {
        sysid: r.get::<i64, _>("sysid") as SysId,
        status: if r.get::<String, _>("status") == "confirmed" {
            FlightStatus::Confirmed
        } else {
            FlightStatus::Draft
        },
        pilot: r.get("pilot"),
        pilot_license: r.get("pilot_license"),
        takeoff_at: ms(r.get("takeoff_at")),
        landed_at: r.get::<Option<i64>, _>("landed_at").map(ms),
        takeoff_lat: r.get("takeoff_lat"),
        takeoff_lon: r.get("takeoff_lon"),
        landing_lat: r.get("landing_lat"),
        landing_lon: r.get("landing_lon"),
        takeoff_place: r.get("takeoff_place"),
        landing_place: r.get("landing_place"),
        purposes: json_list(&r.get::<String, _>("purposes")),
        specific_flight: json_list(&r.get::<String, _>("specific_flight")),
        summary: r.get("summary"),
        safety_notes: r.get("safety_notes"),
        supersedes: r.get("supersedes"),
        created_by: r.get("created_by"),
        created_at: ms(r.get("created_at")),
    }
}

fn apply_patch(c: &Cols, p: &FlightPatch) -> Cols {
    Cols {
        pilot: p.pilot.clone().unwrap_or_else(|| c.pilot.clone()),
        pilot_license: p.pilot_license.clone().unwrap_or_else(|| c.pilot_license.clone()),
        takeoff_at: p.takeoff_at.unwrap_or(c.takeoff_at),
        landed_at: p.landed_at.or(c.landed_at),
        takeoff_place: p.takeoff_place.clone().unwrap_or_else(|| c.takeoff_place.clone()),
        landing_place: p.landing_place.clone().unwrap_or_else(|| c.landing_place.clone()),
        purposes: p.purposes.clone().unwrap_or_else(|| c.purposes.clone()),
        specific_flight: p
            .specific_flight
            .clone()
            .unwrap_or_else(|| c.specific_flight.clone()),
        summary: p.summary.clone().unwrap_or_else(|| c.summary.clone()),
        safety_notes: p.safety_notes.clone().unwrap_or_else(|| c.safety_notes.clone()),
        status: p.status.unwrap_or(c.status),
        ..c.clone()
    }
}

fn check_times(takeoff: u64, landed: Option<u64>) -> Result<()> {
    match landed {
        Some(l) if l < takeoff => Err(StoreError::Invalid("landed_at before takeoff_at".into())),
        _ => Ok(()),
    }
}

/// Minutes of every landed, non-superseded flight of a vehicle: `(landed_at, minutes)`.
type Landed = Vec<(u64, u32)>;

fn total_for(initial: u32, landed: &Landed, upto: Option<u64>) -> u32 {
    landed
        .iter()
        .filter(|(at, _)| upto.is_none_or(|u| *at <= u))
        .fold(initial, |acc, (_, m)| acc.saturating_add(*m))
}

fn build(id: i64, c: Cols, initial: u32, landed: &Landed, squawks: Vec<FlightSquawk>) -> Flight {
    let flight_minutes = c
        .landed_at
        .map(|l| jst::ceil_minutes(c.takeoff_at, l))
        .unwrap_or(0);
    Flight {
        id,
        sysid: c.sysid,
        status: c.status,
        pilot: c.pilot,
        pilot_license: c.pilot_license,
        takeoff_at: c.takeoff_at,
        landed_at: c.landed_at,
        takeoff_lat: c.takeoff_lat,
        takeoff_lon: c.takeoff_lon,
        landing_lat: c.landing_lat,
        landing_lon: c.landing_lon,
        takeoff_place: c.takeoff_place,
        landing_place: c.landing_place,
        purposes: c.purposes,
        specific_flight: c.specific_flight,
        summary: c.summary,
        safety_notes: c.safety_notes,
        flight_minutes,
        total_minutes: total_for(initial, landed, c.landed_at),
        squawks,
        supersedes: c.supersedes,
        created_by: c.created_by,
        created_at: c.created_at,
        updated_at: 0,
    }
}

fn squawk_of(r: &sqlx::sqlite::SqliteRow) -> FlightSquawk {
    FlightSquawk {
        id: r.get("id"),
        flight_id: r.get("flight_id"),
        occurred_on: r.get("occurred_on"),
        description: r.get("description"),
        action_on: r.get("action_on"),
        action: r.get("action"),
        confirmer: r.get("confirmer"),
        created_by: r.get("created_by"),
        created_at: ms(r.get("created_at")),
    }
}

impl Store {
    async fn insert_cols(&self, c: &Cols) -> Result<i64> {
        let mut conn = self.pool.acquire().await?;
        insert_row(&mut conn, c).await
    }
}

async fn insert_row(conn: &mut sqlx::SqliteConnection, c: &Cols) -> Result<i64> {
    let now = unix_ms() as i64;
    let res = sqlx::query(
        "INSERT INTO flights (sysid, status, pilot, pilot_license, takeoff_at, landed_at, takeoff_lat, takeoff_lon, \
         landing_lat, landing_lon, takeoff_place, landing_place, purposes, specific_flight, summary, safety_notes, \
         supersedes, created_by, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)",
    )
    .bind(i64::from(c.sysid))
    .bind(c.status.as_str())
    .bind(&c.pilot)
    .bind(&c.pilot_license)
    .bind(c.takeoff_at as i64)
    .bind(c.landed_at.map(|v| v as i64))
    .bind(c.takeoff_lat)
    .bind(c.takeoff_lon)
    .bind(c.landing_lat)
    .bind(c.landing_lon)
    .bind(&c.takeoff_place)
    .bind(&c.landing_place)
    .bind(to_json(&c.purposes))
    .bind(to_json(&c.specific_flight))
    .bind(&c.summary)
    .bind(&c.safety_notes)
    .bind(c.supersedes)
    .bind(&c.created_by)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(res.last_insert_rowid())
}

impl Store {
    async fn update_cols(&self, id: i64, c: &Cols) -> Result<()> {
        sqlx::query(
            "UPDATE flights SET status = ?2, pilot = ?3, pilot_license = ?4, takeoff_at = ?5, landed_at = ?6, \
             takeoff_place = ?7, landing_place = ?8, purposes = ?9, specific_flight = ?10, summary = ?11, \
             safety_notes = ?12, updated_at = ?13 WHERE id = ?1",
        )
        .bind(id)
        .bind(c.status.as_str())
        .bind(&c.pilot)
        .bind(&c.pilot_license)
        .bind(c.takeoff_at as i64)
        .bind(c.landed_at.map(|v| v as i64))
        .bind(&c.takeoff_place)
        .bind(&c.landing_place)
        .bind(to_json(&c.purposes))
        .bind(to_json(&c.specific_flight))
        .bind(&c.summary)
        .bind(&c.safety_notes)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn cols(&self, id: i64) -> Result<Option<Cols>> {
        let row = sqlx::query("SELECT * FROM flights WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(cols_of))
    }

    async fn landed(&self, sysid: SysId) -> Result<Landed> {
        let rows = sqlx::query(
            "SELECT takeoff_at, landed_at FROM flights WHERE sysid = ?1 AND landed_at IS NOT NULL \
             AND id NOT IN (SELECT supersedes FROM flights WHERE supersedes IS NOT NULL)",
        )
        .bind(i64::from(sysid))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let l = ms(r.get("landed_at"));
                (l, jst::ceil_minutes(ms(r.get("takeoff_at")), l))
            })
            .collect())
    }

    async fn squawks_of(&self, sysid: SysId) -> Result<Vec<FlightSquawk>> {
        let rows = sqlx::query(
            "SELECT s.* FROM flight_squawks s JOIN flights f ON f.id = s.flight_id WHERE f.sysid = ?1 ORDER BY s.id",
        )
        .bind(i64::from(sysid))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(squawk_of).collect())
    }

    async fn assemble(&self, id: i64, c: Cols) -> Result<Flight> {
        let initial = self.initial_flight_minutes(c.sysid).await?;
        let landed = self.landed(c.sysid).await?;
        let squawks: Vec<FlightSquawk> = self
            .squawks_of(c.sysid)
            .await?
            .into_iter()
            .filter(|s| s.flight_id == id)
            .collect();
        Ok(build(id, c, initial, &landed, squawks))
    }

    /// Opens a draft at the first ARM; returns its id.
    #[allow(clippy::too_many_arguments)]
    pub async fn open_flight(
        &self,
        sysid: SysId,
        pilot: &str,
        pilot_license: &str,
        takeoff_at: u64,
        lat: Option<f64>,
        lon: Option<f64>,
        by: &str,
    ) -> Result<i64> {
        self.insert_cols(&Cols {
            sysid,
            status: FlightStatus::Draft,
            pilot: pilot.into(),
            pilot_license: pilot_license.into(),
            takeoff_at,
            landed_at: None,
            takeoff_lat: lat,
            takeoff_lon: lon,
            landing_lat: None,
            landing_lon: None,
            takeoff_place: String::new(),
            landing_place: String::new(),
            purposes: vec![],
            specific_flight: vec![],
            summary: String::new(),
            safety_notes: String::new(),
            supersedes: None,
            created_by: by.into(),
            created_at: 0,
        })
        .await
    }

    /// A re-ARM inside the window continues the flight: the landing is cleared. False when the
    /// row is no longer a draft (confirmed records are immutable) or does not exist.
    pub async fn reopen_flight(&self, id: i64) -> Result<bool> {
        let res = sqlx::query(
            "UPDATE flights SET landed_at = NULL, landing_lat = NULL, landing_lon = NULL, updated_at = ?2 \
             WHERE id = ?1 AND status = 'draft'",
        )
        .bind(id)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// The id of the row that corrected `id`, if any.
    pub async fn flight_superseded_by(&self, id: i64) -> Result<Option<i64>> {
        let v: Option<i64> =
            sqlx::query_scalar("SELECT id FROM flights WHERE supersedes = ?1 ORDER BY id DESC LIMIT 1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(v)
    }

    pub async fn land_flight(
        &self,
        id: i64,
        landed_at: u64,
        lat: Option<f64>,
        lon: Option<f64>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE flights SET landed_at = ?2, landing_lat = ?3, landing_lon = ?4, updated_at = ?5 WHERE id = ?1",
        )
        .bind(id)
        .bind(landed_at as i64)
        .bind(lat)
        .bind(lon)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The flight still in the air for `sysid` (`landed_at IS NULL`), newest first.
    pub async fn open_flight_of(&self, sysid: SysId) -> Result<Option<Flight>> {
        let row = sqlx::query(
            "SELECT id FROM flights WHERE sysid = ?1 AND landed_at IS NULL ORDER BY id DESC LIMIT 1",
        )
        .bind(i64::from(sysid))
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(r) => self.flight(r.get("id")).await,
            None => Ok(None),
        }
    }

    pub async fn flight(&self, id: i64) -> Result<Option<Flight>> {
        match self.cols(id).await? {
            Some(c) => Ok(Some(self.assemble(id, c).await?)),
            None => Ok(None),
        }
    }

    /// Non-superseded flights of one vehicle, ascending takeoff, within JST days when given.
    pub async fn list_flights(
        &self,
        sysid: SysId,
        from: Option<&str>,
        to: Option<&str>,
    ) -> Result<Vec<Flight>> {
        let (lo, hi) = jst::day_range_ms(from.unwrap_or("1970-01-01"), to.unwrap_or("9999-12-30"))
            .ok_or_else(|| StoreError::Invalid("date range".into()))?;
        let rows = sqlx::query(
            "SELECT * FROM flights WHERE sysid = ?1 AND takeoff_at >= ?2 AND takeoff_at < ?3 \
             AND id NOT IN (SELECT supersedes FROM flights WHERE supersedes IS NOT NULL) ORDER BY takeoff_at, id",
        )
        .bind(i64::from(sysid))
        .bind(lo as i64)
        .bind(hi as i64)
        .fetch_all(&self.pool)
        .await?;
        let initial = self.initial_flight_minutes(sysid).await?;
        let landed = self.landed(sysid).await?;
        let squawks = self.squawks_of(sysid).await?;
        Ok(rows
            .iter()
            .map(|r| {
                let id: i64 = r.get("id");
                let own = squawks.iter().filter(|s| s.flight_id == id).cloned().collect();
                build(id, cols_of(r), initial, &landed, own)
            })
            .collect())
    }

    /// A flight flown without RGCS connected (draft).
    pub async fn create_flight(&self, sysid: SysId, input: &FlightInput, by: &str) -> Result<Flight> {
        check_times(input.takeoff_at, Some(input.landed_at))?;
        let id = self
            .insert_cols(&Cols {
                sysid,
                status: FlightStatus::Draft,
                pilot: input.pilot.clone(),
                pilot_license: input.pilot_license.clone(),
                takeoff_at: input.takeoff_at,
                landed_at: Some(input.landed_at),
                takeoff_lat: None,
                takeoff_lon: None,
                landing_lat: None,
                landing_lon: None,
                takeoff_place: input.takeoff_place.clone(),
                landing_place: input.landing_place.clone(),
                purposes: input.purposes.clone(),
                specific_flight: input.specific_flight.clone(),
                summary: input.summary.clone(),
                safety_notes: input.safety_notes.clone(),
                supersedes: None,
                created_by: by.into(),
                created_at: 0,
            })
            .await?;
        self.flight(id)
            .await?
            .ok_or_else(|| StoreError::Invalid("flight vanished".into()))
    }

    /// Draft: edited in place. Confirmed: a superseding copy is inserted and returned.
    pub async fn patch_flight(&self, id: i64, patch: &FlightPatch, by: &str) -> Result<Option<Flight>> {
        let Some(current) = self.cols(id).await? else {
            return Ok(None);
        };
        let next = apply_patch(&current, patch);
        check_times(next.takeoff_at, next.landed_at)?;
        if next.status == FlightStatus::Confirmed && next.landed_at.is_none() {
            return Err(StoreError::Invalid("an open flight cannot be confirmed".into()));
        }
        let target = if current.status == FlightStatus::Draft {
            self.update_cols(id, &next).await?;
            id
        } else {
            let mut tx = self.pool.begin().await?;
            let new_id = insert_row(
                &mut tx,
                &Cols {
                    status: FlightStatus::Confirmed,
                    supersedes: Some(id),
                    created_by: by.into(),
                    ..next
                },
            )
            .await?;
            // The confirmed row keeps its own squawks; the correction gets copies.
            sqlx::query(
                "INSERT INTO flight_squawks (flight_id, occurred_on, description, action_on, action, confirmer, created_by, created_at) \
                 SELECT ?2, occurred_on, description, action_on, action, confirmer, created_by, created_at \
                 FROM flight_squawks WHERE flight_id = ?1 ORDER BY id",
            )
            .bind(id)
            .bind(new_id)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            new_id
        };
        self.flight(target).await
    }

    /// Drafts still in the air (`landed_at IS NULL`), per vehicle — adopted by the tracker at startup.
    pub async fn open_drafts(&self) -> Result<Vec<(SysId, i64)>> {
        let rows = sqlx::query(
            "SELECT sysid, id FROM flights WHERE landed_at IS NULL AND status = 'draft' ORDER BY sysid, id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| (r.get::<i64, _>("sysid") as SysId, r.get::<i64, _>("id")))
            .collect())
    }

    /// False unless the flight exists and is a draft. Attached logs stay, detached.
    pub async fn delete_draft(&self, id: i64) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let draft: Option<i64> =
            sqlx::query_scalar("SELECT id FROM flights WHERE id = ?1 AND status = 'draft'")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        if draft.is_none() {
            return Ok(false);
        }
        for sql in [
            "UPDATE flight_logs SET flight_id = NULL WHERE flight_id = ?1",
            "DELETE FROM flight_squawks WHERE flight_id = ?1",
            "DELETE FROM flights WHERE id = ?1",
        ] {
            sqlx::query(sql).bind(id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    /// `None` when the flight does not exist.
    pub async fn add_squawk(
        &self,
        flight_id: i64,
        input: &FlightSquawkInput,
        by: &str,
    ) -> Result<Option<FlightSquawk>> {
        if self.cols(flight_id).await?.is_none() {
            return Ok(None);
        }
        let res = sqlx::query(
            "INSERT INTO flight_squawks (flight_id, occurred_on, description, action_on, action, confirmer, created_by, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(flight_id)
        .bind(&input.occurred_on)
        .bind(&input.description)
        .bind(&input.action_on)
        .bind(&input.action)
        .bind(&input.confirmer)
        .bind(by)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        let row = sqlx::query("SELECT * FROM flight_squawks WHERE id = ?1")
            .bind(res.last_insert_rowid())
            .fetch_one(&self.pool)
            .await?;
        Ok(Some(squawk_of(&row)))
    }

    /// Registry initial minutes + every landed, non-superseded flight.
    pub async fn total_flight_minutes(&self, sysid: SysId) -> Result<u32> {
        let initial = self.initial_flight_minutes(sysid).await?;
        Ok(total_for(initial, &self.landed(sysid).await?, None))
    }

    /// Who last touched this vehicle (newest audit row), used as the draft's pilot.
    pub async fn last_operator(&self, sysid: SysId) -> Result<Option<String>> {
        let v: Option<String> =
            sqlx::query_scalar("SELECT operator FROM audit_log WHERE sysid = ?1 ORDER BY id DESC LIMIT 1")
                .bind(i64::from(sysid))
                .fetch_optional(&self.pool)
                .await?;
        Ok(v)
    }
}

#[cfg(test)]
#[path = "flights_tests.rs"]
mod tests;
