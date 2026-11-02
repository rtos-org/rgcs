//! Tests for `camera.rs` (kept out of the module to hold it under the file-size limit).

use super::*;
use crate::camera_media::*;

#[test]
fn mt11_caps_have_a_horizontal_fov() {
    assert_eq!(CameraCaps::siyi_mt11().hfov_deg, Some(62.0));
    assert_eq!(CameraCaps::none().hfov_deg, None);
    let json = serde_json::to_value(CameraCaps::siyi_mt11()).unwrap();
    assert_eq!(json["hfov_deg"], 62.0);
}

#[test]
fn siyi_caps_match_spec() {
    let c = CameraCaps::siyi_mt11();
    assert_eq!(c.kind, CameraKind::SiyiMt11);
    let z = c.zoom.as_ref().unwrap();
    assert_eq!(z.max, 165.0);
    assert!(z.absolute && z.step && z.continuous);
    let g = c.gimbal.as_ref().unwrap();
    assert_eq!(g.pitch_range, (-90.0, 30.0));
    assert_eq!(
        g.modes,
        vec![GimbalMode::Lock, GimbalMode::Follow, GimbalMode::Fpv]
    );
    assert!(g.rate && g.angle && g.center && g.attitude);
    assert_eq!(
        c.video_modes,
        vec![VideoMode::Rgb, VideoMode::Thermal, VideoMode::SideBySide]
    );
    assert!(c.photo && c.record && c.focus);
}

#[test]
fn none_caps_support_nothing() {
    let c = CameraCaps::none();
    assert_eq!(c.kind, CameraKind::None);
    for cmd in [
        CameraCommand::Photo,
        CameraCommand::RecordStart,
        CameraCommand::ZoomReset,
        CameraCommand::GimbalRate { yaw: 1, pitch: 1 },
        CameraCommand::VideoMode { mode: VideoMode::Rgb },
    ] {
        assert!(!c.supports(&cmd), "{cmd:?}");
    }
}

#[test]
fn supports_checks_the_right_cap() {
    let mut c = CameraCaps::siyi_mt11();
    assert!(c.supports(&CameraCommand::ZoomSpeed { dir: 1 }));
    c.zoom = Some(ZoomCaps {
        continuous: false,
        ..c.zoom.clone().unwrap()
    });
    assert!(!c.supports(&CameraCommand::ZoomSpeed { dir: 1 }));
    assert!(c.supports(&CameraCommand::ZoomStep { steps: 1 }));
    assert!(c.supports(&CameraCommand::GimbalCenter {
        mode: CenterMode::OneKeyReset
    }));
    c.video_modes = vec![VideoMode::Rgb];
    assert!(!c.supports(&CameraCommand::VideoMode {
        mode: VideoMode::Thermal
    }));
    assert!(c.supports(&CameraCommand::VideoMode { mode: VideoMode::Rgb }));
    c.gimbal = None;
    assert!(!c.supports(&CameraCommand::GimbalRate { yaw: 0, pitch: 0 }));
}

#[test]
fn profile_validation_names_the_field() {
    let ok = CameraProfile::default_for(1);
    assert_eq!(ok.validate(), Ok(()));
    let bad_host = CameraProfile {
        host: "camera.local".into(),
        ..ok.clone()
    };
    assert_eq!(
        bad_host.validate(),
        Err(ProfileError {
            field: "host".into(),
            message: "must be an IPv4 address".into()
        })
    );
    let bad_port = CameraProfile {
        port: 0,
        ..ok.clone()
    };
    assert_eq!(bad_port.validate().unwrap_err().field, "port");
    let bad_rtsp = CameraProfile {
        rtsp_url: "http://x".into(),
        ..ok.clone()
    };
    assert_eq!(bad_rtsp.validate().unwrap_err().field, "rtsp_url");
    let bad_box = CameraProfile {
        ai_box_px: 10,
        ..ok.clone()
    };
    assert_eq!(bad_box.validate().unwrap_err().field, "ai_box_px");
    let bad_palette = CameraProfile {
        thermal_palette: 1,
        ..ok.clone()
    };
    assert_eq!(bad_palette.validate().unwrap_err().field, "thermal_palette");
    assert_eq!(ok.rtsp_url_resolved(), "rtsp://192.168.144.25:8554/video1");
    // The probe may only ever target the camera itself (no SSRF / port-scan oracle).
    let other_host = CameraProfile {
        rtsp_url: "rtsp://10.0.0.9:8554/x".into(),
        ..ok.clone()
    };
    assert_eq!(other_host.validate().unwrap_err().field, "rtsp_url");
    let same_host = CameraProfile {
        rtsp_url: "rtsp://192.168.144.25:8554/video1".into(),
        ..ok.clone()
    };
    assert_eq!(same_host.validate(), Ok(()));
    let named = CameraProfile {
        rtsp_url: "rtsp://camera.local/video1".into(),
        ..ok.clone()
    };
    assert_eq!(named.validate().unwrap_err().field, "rtsp_url");
    // Same parser as the probe: userinfo tricks and odd authorities are rejected, not misread.
    let userinfo = CameraProfile {
        rtsp_url: "rtsp://192.168.144.25@10.0.0.9:8554/v".into(),
        ..ok.clone()
    };
    assert_eq!(userinfo.validate().unwrap_err().field, "rtsp_url");
    let creds = CameraProfile {
        rtsp_url: "rtsp://user:pw@192.168.144.25:8554/v".into(),
        ..ok.clone()
    };
    assert_eq!(creds.validate().unwrap_err().field, "rtsp_url");
    let spaced = CameraProfile {
        rtsp_url: "rtsp://192.168.144.25 :8554/v".into(),
        ..ok.clone()
    };
    assert_eq!(spaced.validate().unwrap_err().field, "rtsp_url");
}

#[test]
fn gimbal_input_profile_defaults_and_validation() {
    let d = GimbalInputProfile::default();
    assert_eq!((d.max_pan_speed, d.max_tilt_speed), (30.0, 20.0));
    assert_eq!(
        d.axes[0],
        AxisMapping {
            axis: 0,
            func: AxisFunction::Pan,
            deadzone: 0.08,
            invert: false,
            scale: 1.0
        }
    );
    assert_eq!(d.axes[1].func, AxisFunction::Tilt);
    assert!(d.axes[1].invert);
    assert_eq!(
        d.buttons[0],
        ButtonMapping {
            button: 0,
            func: ButtonFunction::RecordToggle
        }
    );
    assert_eq!(d.validate(), Ok(()));
    let bad = GimbalInputProfile {
        max_pan_speed: 500.0,
        ..d.clone()
    };
    assert_eq!(bad.validate().unwrap_err().field, "max_pan_speed");
    let mut axes = d.axes.clone();
    axes[0].deadzone = 0.7;
    let bad = GimbalInputProfile { axes, ..d.clone() };
    assert_eq!(bad.validate().unwrap_err().field, "axes[0].deadzone");
    let mut axes = d.axes.clone();
    axes[1].scale = 5.0;
    let bad = GimbalInputProfile { axes, ..d.clone() };
    assert_eq!(bad.validate().unwrap_err().field, "axes[1].scale");
    let json = serde_json::to_value(&d).unwrap();
    assert_eq!(json["axes"][0]["fn"], "pan");
    assert_eq!(json["buttons"][0]["fn"], "record_toggle");
}

#[test]
fn command_json_shape() {
    let rate = CameraCommand::GimbalRate { yaw: 10, pitch: -5 };
    let json = serde_json::to_string(&rate).unwrap();
    assert_eq!(json, r#"{"cmd":"gimbal_rate","args":{"yaw":10,"pitch":-5}}"#);
    assert_eq!(serde_json::from_str::<CameraCommand>(&json).unwrap(), rate);
    assert_eq!(
        serde_json::to_string(&CameraCommand::Photo).unwrap(),
        r#"{"cmd":"photo"}"#
    );
    assert_eq!(
        CameraCommand::VideoMode {
            mode: VideoMode::SideBySide
        }
        .name(),
        "video_mode"
    );
    let state = CameraState::disconnected(165.0);
    assert!(!state.connected);
    assert_eq!(state.recording, RecordingState::Idle);
    assert_eq!(state.zoom_max, 165.0);
}

#[test]
fn mt11_caps_cover_media() {
    let c = CameraCaps::siyi_mt11();
    let t = c.thermal.as_ref().unwrap();
    assert_eq!(t.gains, vec![ThermalGain::Low, ThermalGain::High]);
    assert_eq!(t.palettes.len(), 11);
    assert!(t.point_temp && t.frame_temp);
    let ai = c.ai_tracking.as_ref().unwrap();
    assert!(ai.box_select && ai.point_select && ai.candidates);
    let ids: Vec<&str> = c.encoding_presets.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        ["h264_720p", "h264_1080p", "h264_4k", "h265_1080p", "h265_4k"]
    );
    assert!(c.storage_info && c.clock_sync);
}

#[test]
fn none_caps_have_no_media() {
    let c = CameraCaps::none();
    assert!(c.thermal.is_none() && c.ai_tracking.is_none());
    assert!(c.encoding_presets.is_empty());
    assert!(!c.storage_info && !c.clock_sync);
    for cmd in [
        CameraCommand::ThermalGain {
            gain: ThermalGain::High,
        },
        CameraCommand::ThermalPalette { palette: 3 },
        CameraCommand::MeasurePoint { x: 0.5, y: 0.5 },
        CameraCommand::AiSelectBox {
            x: 0.5,
            y: 0.5,
            box_px: None,
        },
        CameraCommand::AiSelectPoint { x: 0.5, y: 0.5 },
        CameraCommand::AiCancel,
        CameraCommand::Encoding {
            preset: "h264_1080p".into(),
        },
        CameraCommand::SyncClock,
    ] {
        assert!(!c.supports(&cmd), "{cmd:?}");
    }
}

#[test]
fn supports_media_commands() {
    let mut c = CameraCaps::siyi_mt11();
    assert!(!c.supports(&CameraCommand::ThermalPalette { palette: 1 }));
    assert!(c.supports(&CameraCommand::ThermalPalette { palette: 3 }));
    assert!(!c.supports(&CameraCommand::Encoding {
        preset: "h266_8k".into()
    }));
    assert!(c.supports(&CameraCommand::Encoding {
        preset: "h265_4k".into()
    }));
    assert!(c.supports(&CameraCommand::AiCancel));
    c.ai_tracking = None;
    assert!(!c.supports(&CameraCommand::AiCancel));
}

#[test]
fn command_validation() {
    let field = |c: CameraCommand| c.validate().unwrap_err().field;
    let sel = |x: f32, box_px: Option<u16>| CameraCommand::AiSelectBox { x, y: 0.5, box_px };
    assert_eq!(field(sel(1.1, None)), "x");
    assert_eq!(field(CameraCommand::MeasurePoint { x: 0.5, y: f32::NAN }), "y");
    assert_eq!(field(sel(0.5, Some(31))), "box_px");
    assert_eq!(field(sel(0.5, Some(601))), "box_px");
    for ok in [Some(32), Some(600), None] {
        assert_eq!(sel(0.5, ok).validate(), Ok(()));
    }
    assert_eq!(field(CameraCommand::ThermalPalette { palette: 1 }), "palette");
    assert_eq!(CameraCommand::ThermalPalette { palette: 0 }.validate(), Ok(()));
    assert_eq!(CameraCommand::Photo.validate(), Ok(()));
}

#[test]
fn media_command_json_shape() {
    let json = |c: CameraCommand| serde_json::to_string(&c).unwrap();
    assert_eq!(
        json(CameraCommand::AiSelectBox {
            x: 0.5,
            y: 0.5,
            box_px: None
        }),
        r#"{"cmd":"ai_select_box","args":{"x":0.5,"y":0.5,"box_px":null}}"#
    );
    assert_eq!(json(CameraCommand::SyncClock), r#"{"cmd":"sync_clock"}"#);
    assert_eq!(
        json(CameraCommand::ThermalGain {
            gain: ThermalGain::High
        }),
        r#"{"cmd":"thermal_gain","args":{"gain":"high"}}"#
    );
    assert_eq!(CameraCommand::AiCancel.name(), "ai_cancel");
    assert_eq!(CameraCommand::SyncClock.name(), "sync_clock");
}

#[test]
fn gain_ranges() {
    assert_eq!(ThermalGain::High.range_c(), (-20.0, 150.0));
    assert_eq!(ThermalGain::Low.range_c(), (0.0, 550.0));
    assert_eq!(ThermalGain::from_wire(1), Some(ThermalGain::High));
    assert_eq!(ThermalGain::from_wire(0), Some(ThermalGain::Low));
    assert_eq!(ThermalGain::from_wire(2), None);
    assert_eq!((ThermalGain::Low.wire(), ThermalGain::High.wire()), (0, 1));
}

#[test]
fn needs_reload_only_for_connection_fields() {
    let a = CameraProfile::default_for(1);
    let same = |f: fn(&mut CameraProfile)| {
        let mut b = a.clone();
        f(&mut b);
        a.needs_reload(&b)
    };
    assert!(!same(|p| p.encoding_preset = "h265_4k".into()));
    assert!(!same(|p| p.thermal_palette = 4));
    assert!(!same(|p| p.thermal_overlay = !p.thermal_overlay));
    assert!(!same(|p| p.ai_box_px = 200));
    assert!(!same(|p| p.auto_record = !p.auto_record));
    assert!(same(|p| p.host = "10.0.0.2".into()));
    assert!(same(|p| p.port = 1234));
    assert!(same(|p| p.kind = CameraKind::SiyiMt11));
    assert!(same(|p| p.clock_sync = !p.clock_sync));
    assert!(same(|p| p.rtsp_url = "rtsp://{host}:8554/other".into()));
    assert!(same(|p| p.comp_id = 7));
    assert!(same(|p| p.video_source_mode = VideoSourceMode::Mt11));
    assert!(same(|p| p.android_url = "http://x".into()));
}

#[test]
fn new_button_functions_serialize() {
    for (f, s) in [
        (ButtonFunction::ThermalGainToggle, "thermal_gain_toggle"),
        (ButtonFunction::AiTrackingToggle, "ai_tracking_toggle"),
        (ButtonFunction::FocusNear, "focus_near"),
        (ButtonFunction::FocusFar, "focus_far"),
    ] {
        let v = serde_json::to_value(f).unwrap();
        assert_eq!(v, s);
        assert_eq!(serde_json::from_value::<ButtonFunction>(v).unwrap(), f);
    }
}

#[test]
fn disconnected_state_has_no_media() {
    let s = CameraState::disconnected(165.0);
    assert!(s.encoding.is_none() && s.thermal.is_none() && s.track.is_none());
    assert!(s.candidates.is_empty() && s.ai_ack.is_none());
    assert!(s.storage.is_none() && s.clock.is_none());
}

#[test]
fn zoom_unit_defaults_to_times() {
    let z: ZoomCaps =
        serde_json::from_str(r#"{"max":165,"absolute":true,"step":true,"continuous":true}"#).unwrap();
    assert_eq!(z.unit, ZoomUnit::Times);
}

#[test]
fn siyi_caps_keep_times() {
    assert_eq!(CameraCaps::siyi_mt11().zoom.unwrap().unit, ZoomUnit::Times);
}

#[test]
fn zoom_unit_serializes_snake_case() {
    assert_eq!(serde_json::to_string(&ZoomUnit::Percent).unwrap(), "\"percent\"");
}
