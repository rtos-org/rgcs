//! `/api/plugins`: the plugins found in `plugins_dir` and the admin's on/off switch.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_server::app;
use rgcs_server::plugins::{PluginRegistry, MANIFEST};
use serde_json::json;

const SEA: &str = r#"
id = "sea"
api = 1
version = "1.0"
name = { en = "Sea marks", ja = "海図標識" }

[[overlay]]
id = "marks"
name = "Sea marks"
tiles = "https://tiles.example.org/{z}/{x}/{y}.png"
cache = "direct"
format = "png"
tile_size = 256
min_zoom = 9
max_zoom = 18

[[link]]
label = "Chart"
url = "https://chart.example.org/"
"#;

async fn plugin_app() -> (axum::Router, rgcs_server::app::AppState) {
    let root = temp_data_dir();
    for (dir, text) in [("sea", SEA), ("broken", "id = ")] {
        std::fs::create_dir_all(root.join(dir)).unwrap();
        std::fs::write(root.join(dir).join(MANIFEST), text).unwrap();
    }
    let (_app, state) = spawn_app().await;
    let state = state.with_plugins(PluginRegistry::scan(&root));
    (app::build(state.clone(), None), state)
}

#[tokio::test]
async fn the_list_needs_a_login_and_shows_every_plugin() {
    let (app, _) = plugin_app().await;
    let (s, _, _) = call(&app, req(Method::GET, "/api/plugins", None, None)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let cookie = login(&app).await;
    let (s, b, _) = call(&app, req(Method::GET, "/api/plugins", Some(&cookie), None)).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let rows = b["data"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], "broken");
    assert_eq!(rows[0]["status"], "error");
    assert_eq!(rows[0]["error"], "parse");
    assert_eq!(rows[1]["status"], "ok");
    assert_eq!(rows[1]["name"], json!({ "en": "Sea marks", "ja": "海図標識" }));
    assert_eq!(
        rows[1]["overlays"][0]["tiles"],
        "https://tiles.example.org/{z}/{x}/{y}.png"
    );
    assert_eq!(rows[1]["links"][0]["url"], "https://chart.example.org/");
}

#[tokio::test]
async fn an_admin_switches_a_plugin_and_the_choice_is_stored() {
    let (app, state) = plugin_app().await;
    let cookie = login(&app).await;
    let put = |id: &str, on: bool| {
        req(
            Method::PUT,
            &format!("/api/plugins/{id}"),
            Some(&cookie),
            Some(json!({ "enabled": on })),
        )
    };
    let (s, b, _) = call(&app, put("sea", false)).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["data"]["enabled"], false);
    assert!(!state.store.plugin_enabled().await.unwrap()["sea"]);
    assert!(state.plugins.overlay("sea", "marks").is_none());
    let (s, b, _) = call(&app, put("nobody", true)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&b), "not_found");
    assert!(!state.store.plugin_enabled().await.unwrap().contains_key("nobody"));
}

#[tokio::test]
async fn operators_cannot_switch_plugins() {
    let (app, state) = plugin_app().await;
    state
        .store
        .create_user("op", "operator-pw", rgcs_core::operator::Role::Operator)
        .await
        .unwrap();
    let op = login_as(&app, "op", "operator-pw").await;
    let (s, _, _) = call(&app, req(Method::GET, "/api/plugins", Some(&op), None)).await;
    assert_eq!(s, StatusCode::OK);
    let body = json!({ "enabled": false });
    let (s, _, _) = call(&app, req(Method::PUT, "/api/plugins/sea", Some(&op), Some(body))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(state.plugins.overlay("sea", "marks").is_some());
}
