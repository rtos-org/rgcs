mod common;

use axum::http::{Method, StatusCode};
use common::*;

#[tokio::test]
async fn app_settings_require_a_session_and_return_the_map_config() {
    let (app, _) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/settings/app", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["lang"], "ja");
    assert_eq!(
        body["data"]["map_tile_url"],
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    );
    assert_eq!(body["data"]["map_attribution"], "© OpenStreetMap contributors");
}

#[tokio::test]
async fn gimbal_input_profile_defaults_validation_and_round_trip() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/settings/input/gimbal", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["max_pan_speed"], 30.0);
    assert_eq!(body["data"]["axes"][0]["fn"], "pan");

    let mut bad = body["data"].clone();
    bad["max_pan_speed"] = serde_json::json!(500);
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/input/gimbal",
            Some(&cookie),
            Some(bad),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(error_code(&body), "validation");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("max_pan_speed"));

    let (_, current, _) = call(
        &app,
        req(Method::GET, "/api/settings/input/gimbal", Some(&cookie), None),
    )
    .await;
    let mut good = current["data"].clone();
    good["max_pan_speed"] = serde_json::json!(45);
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/input/gimbal",
            Some(&cookie),
            Some(good),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, again, _) = call(
        &app,
        req(Method::GET, "/api/settings/input/gimbal", Some(&cookie), None),
    )
    .await;
    assert_eq!(again["data"]["max_pan_speed"], 45.0);
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(audit["data"][0]["command"], "input_profile");
}

#[tokio::test]
async fn app_settings_map_flag_round_trips() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(
        body["data"]["map"]["gimbal_ground_projection"], false,
        "default off"
    );

    let put = serde_json::json!({ "map": { "gimbal_ground_projection": true } });
    let (status, body, _) = call(
        &app,
        req(Method::PUT, "/api/settings/app", Some(&cookie), Some(put)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["map"]["gimbal_ground_projection"], true);
    assert_eq!(body["data"]["lang"], "ja", "the full settings come back");
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(body["data"]["map"]["gimbal_ground_projection"], true);

    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=20", Some(&cookie), None),
    )
    .await;
    let rows: Vec<_> = audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["command"] == "app_settings_put")
        .collect();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["target"], "settings");

    let bad = serde_json::json!({ "map": { "gimbal_ground_projection": "yes" } });
    let (status, _, _) = call(
        &app,
        req(Method::PUT, "/api/settings/app", Some(&cookie), Some(bad)),
    )
    .await;
    assert!(status.is_client_error(), "{status}");
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/app",
            None,
            Some(serde_json::json!({})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn app_settings_list_default_basemaps() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    let ids: Vec<&str> = body["data"]["basemaps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["map", "gsi_std", "gsi_photo"]);
    assert_eq!(body["data"]["basemaps"][1]["attribution"], "地理院タイル");
}

#[tokio::test]
async fn gcs_sysid_put_validates_range_and_vehicle_clash() {
    let (app, state) = spawn_app().await;
    let admin = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&admin), None)).await;
    assert_eq!(body["data"]["mavlink"]["gcs_sysid"], 255, "default");

    let put = |v: serde_json::Value| serde_json::json!({ "mavlink": { "gcs_sysid": v } });
    for bad in [serde_json::json!(0), serde_json::json!(256)] {
        let (status, body, _) = call(
            &app,
            req(Method::PUT, "/api/settings/app", Some(&admin), Some(put(bad))),
        )
        .await;
        assert_eq!(
            (status, error_code(&body)),
            (StatusCode::BAD_REQUEST, "validation")
        );
    }
    seed_vehicle(&state, 7, false, false).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/app",
            Some(&admin),
            Some(put(serde_json::json!(7))),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "sysid_in_use")
    );

    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/app",
            Some(&admin),
            Some(put(serde_json::json!(250))),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["mavlink"]["gcs_sysid"], 250);
    assert_eq!(state.gcs.get(), 250, "the link uses it from the next frame");

    state
        .store
        .create_user("op", "operator-pw", rgcs_core::operator::Role::Operator)
        .await
        .unwrap();
    let op = login_as(&app, "op", "operator-pw").await;
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/app",
            Some(&op),
            Some(put(serde_json::json!(240))),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "operators may change the map switch, not the SYSID"
    );
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/settings/app",
            Some(&op),
            Some(serde_json::json!({ "map": { "gimbal_ground_projection": true } })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn gcs_sysid_persists() {
    let store = rgcs_store::Store::open_memory().await.unwrap();
    store
        .put_app_setting(rgcs_store::app_settings::GCS_SYSID, "201")
        .await
        .unwrap();
    assert_eq!(rgcs_server::settings::load_gcs_sysid(&store).await, 201);
    store
        .put_app_setting(rgcs_store::app_settings::GCS_SYSID, "nonsense")
        .await
        .unwrap();
    assert_eq!(
        rgcs_server::settings::load_gcs_sysid(&store).await,
        255,
        "invalid stored values fall back to 255"
    );
}

#[tokio::test]
async fn app_settings_include_the_terrain_tiles() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["data"]["terrain_tiles"],
        "https://api.plateauview.mlit.go.jp/tiles/plateau-terrainrgb/{z}/{x}/{y}.png"
    );
    assert_eq!(body["data"]["terrain_encoding"], "mapbox");
}

#[tokio::test]
async fn app_settings_include_custom_and_disabled_terrain_encoding() {
    let (_, state) = spawn_app().await;
    for tiles in [Some("https://dem.local/{z}/{x}/{y}.png".to_string()), None] {
        let app = rgcs_server::app::build(state.clone().with_terrain(tiles.clone(), "mapbox"), None);
        let cookie = login(&app).await;
        let (status, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["data"]["terrain_tiles"], serde_json::json!(tiles));
        assert_eq!(body["data"]["terrain_encoding"], "mapbox");
    }
}

#[tokio::test]
async fn track_minutes_default_validation_and_round_trip() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(body["data"]["map"]["track_minutes"], 10, "default 10 minutes");

    for bad in [
        serde_json::json!(-1),
        serde_json::json!(121),
        serde_json::json!("5"),
    ] {
        let put = serde_json::json!({ "map": { "track_minutes": bad } });
        let (status, _, _) = call(
            &app,
            req(Method::PUT, "/api/settings/app", Some(&cookie), Some(put)),
        )
        .await;
        assert!(status.is_client_error(), "{bad} → {status}");
    }

    let put = serde_json::json!({ "map": { "track_minutes": 45 } });
    let (status, body, _) = call(
        &app,
        req(Method::PUT, "/api/settings/app", Some(&cookie), Some(put)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["map"]["track_minutes"], 45);
    // the other map switch is untouched by a PUT that leaves it out
    assert_eq!(body["data"]["map"]["gimbal_ground_projection"], false);
    let (_, body, _) = call(&app, req(Method::GET, "/api/settings/app", Some(&cookie), None)).await;
    assert_eq!(body["data"]["map"]["track_minutes"], 45);

    let put = serde_json::json!({ "map": { "track_minutes": 0 } });
    let (status, body, _) = call(
        &app,
        req(Method::PUT, "/api/settings/app", Some(&cookie), Some(put)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["map"]["track_minutes"], 0, "0 = no track");
}
