//! Registry / pilot / inspection template / inspection run API.

mod common;

use axum::http::{Method, StatusCode};
use common::{call, error_code, login, login_as, req, seed_vehicle, spawn_app};
use rgcs_core::operator::Role;
use serde_json::{json, Value};

fn registry_body() -> Value {
    json!({
        "name": "Demo copter", "registration": "JU1234567890", "uas_type": "回転翼航空機(マルチローター)",
        "model": "X-500", "type_cert_no": "", "airworthiness_class": "第二種", "airworthiness_no": "AW-001",
        "manufacturer": "RTOS", "serial_no": "SN-0001", "initial_flight_minutes": 125, "inspection_template_id": 1
    })
}

fn results(n: u32, ng_at: Option<u32>) -> Value {
    Value::Array(
        (1..=n)
            .map(|p| json!({ "position": p, "result": if Some(p) == ng_at { "ng" } else { "ok" }, "remark": "" }))
            .collect(),
    )
}

fn run_body(date: &str, n: u32, ng_at: Option<u32>) -> Value {
    json!({
        "template_id": 1, "place": "テスト場", "lat": 35.481883, "lon": 138.48029, "performed_on": date,
        "inspector": "admin", "notes": "", "results": results(n, ng_at), "supersedes": null
    })
}

#[tokio::test]
async fn registry_round_trip_and_operator_is_forbidden_to_write() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    state
        .store
        .create_user("op", "operator-pw", Role::Operator)
        .await
        .unwrap();
    let op = login_as(&app, "op", "operator-pw").await;
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/registry",
            Some(&op),
            Some(registry_body()),
        ),
    )
    .await;
    assert_eq!((status, error_code(&body)), (StatusCode::FORBIDDEN, "forbidden"));

    let admin = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/registry", Some(&admin), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["name"], "UAV-01");
    assert_eq!(body["data"]["registration"], "");
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/registry",
            Some(&admin),
            Some(registry_body()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["total_flight_minutes"], 125);
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/registry", Some(&op), None),
    )
    .await;
    assert_eq!(body["data"]["registration"], "JU1234567890");
    assert_eq!(body["data"]["name"], "Demo copter");

    let mut bad = registry_body();
    bad["inspection_template_id"] = json!(999);
    let (status, body, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/registry", Some(&admin), Some(bad)),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&admin), None),
    )
    .await;
    assert!(audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["command"] == "registry_put"));
}

#[tokio::test]
async fn pilot_info_is_mine() {
    let (app, _state) = spawn_app().await;
    let admin = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/users/me/pilot", Some(&admin), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (
            body["data"]["username"].as_str(),
            body["data"]["full_name"].as_str()
        ),
        (Some("admin"), Some(""))
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/users/me/pilot",
            Some(&admin),
            Some(json!({ "full_name": "山田", "license_no": "T123" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["license_no"], "T123");
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/users/me/pilot",
            Some(&admin),
            Some(json!({ "full_name": "x".repeat(121), "license_no": "" })),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
}

#[tokio::test]
async fn templates_crud_and_last_template_refused() {
    let (app, _state) = spawn_app().await;
    let admin = login(&app).await;
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/inspection/templates", Some(&admin), None),
    )
    .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"][0]["items"].as_array().unwrap().len(), 9);

    let items = json!([{ "label": "a", "detail": "A" }, { "label": "b", "detail": "B" }]);
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/inspection/templates",
            Some(&admin),
            Some(json!({ "name": "custom", "items": items })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["data"]["id"].as_i64().unwrap();
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            &format!("/api/inspection/templates/{id}"),
            Some(&admin),
            Some(json!({ "name": "custom 2", "items": [{ "label": "only", "detail": "" }] })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (
            body["data"]["version"].as_u64(),
            body["data"]["items"].as_array().unwrap().len()
        ),
        (Some(2), 1)
    );
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/inspection/templates/999",
            Some(&admin),
            Some(json!({ "name": "x", "items": items })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/inspection/templates",
            Some(&admin),
            Some(json!({ "name": "", "items": items })),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );

    let (status, body, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/inspection/templates/{id}"),
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(
        (status, body["data"]["deleted"].as_bool()),
        (StatusCode::OK, Some(true))
    );
    let (status, body, _) = call(
        &app,
        req(Method::DELETE, "/api/inspection/templates/1", Some(&admin), None),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "last_template")
    );
    let (status, _, _) = call(
        &app,
        req(
            Method::DELETE,
            "/api/inspection/templates/999",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn inspection_save_validates_count_and_lists() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let (_, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/inspections/template",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(body["data"]["id"], 1);

    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/inspections",
            Some(&admin),
            Some(run_body("2026-12-05", 8, None)),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/inspections",
            Some(&admin),
            Some(run_body("2026-12-05", 9, Some(2))),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["has_ng"], true);
    assert_eq!(body["data"]["results"][1]["label"], "プロペラ");
    let mut unknown = run_body("2026-12-05", 9, None);
    unknown["template_id"] = json!(999);
    let (status, _, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/inspections",
            Some(&admin),
            Some(unknown),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/inspections", Some(&admin), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/inspections?from=bad",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&admin), None),
    )
    .await;
    assert!(audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["command"] == "inspection_save"));
}

#[tokio::test]
async fn inspection_range_filter() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    for d in ["2026-12-01", "2026-12-02"] {
        let (status, _, _) = call(
            &app,
            req(
                Method::POST,
                "/api/vehicles/1/inspections",
                Some(&admin),
                Some(run_body(d, 9, None)),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (_, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/inspections?from=2026-12-02",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"][0]["performed_on"], "2026-12-02");
    let (_, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/inspections?to=2026-12-01&limit=1",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(body["data"][0]["performed_on"], "2026-12-01");
}
