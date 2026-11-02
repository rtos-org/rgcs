use std::path::{Path, PathBuf};

use rgcs_core::{PluginError, PluginStatus};

use super::*;

const GOOD: &str = r#"
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
"#;

fn temp_dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("rgcs-plugins-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn put(root: &Path, dir: &str, manifest: &str) {
    std::fs::create_dir_all(root.join(dir)).unwrap();
    std::fs::write(root.join(dir).join(MANIFEST), manifest).unwrap();
}

#[test]
fn a_missing_directory_means_no_plugins() {
    assert!(PluginRegistry::scan(&temp_dir().join("nope")).infos().is_empty());
}

#[test]
fn good_and_broken_plugins_are_listed_in_id_order() {
    let root = temp_dir();
    put(&root, "sea", GOOD);
    put(&root, "broken", "id = ");
    put(
        &root,
        "moved",
        &GOOD.replace("id = \"sea\"", "id = \"moved-elsewhere\""),
    );
    put(&root, "huge", &format!("{GOOD}\n# {}", "x".repeat(70 * 1024)));
    std::fs::create_dir_all(root.join("empty")).unwrap();
    std::fs::write(root.join("stray.toml"), GOOD).unwrap();
    let infos = PluginRegistry::scan(&root).infos();
    let rows: Vec<_> = infos
        .iter()
        .map(|i| (i.id.as_str(), i.status, i.error.as_deref()))
        .collect();
    assert_eq!(
        rows,
        [
            ("broken", PluginStatus::Error, Some("parse")),
            ("huge", PluginStatus::Error, Some("too_large")),
            ("moved", PluginStatus::Error, Some("id_mismatch")),
            ("sea", PluginStatus::Ok, None),
        ]
    );
    assert!(infos.iter().all(|i| i.enabled));
}

#[test]
fn overlays_resolve_only_for_loaded_enabled_plugins() {
    let root = temp_dir();
    put(&root, "sea", GOOD);
    put(&root, "broken", "id = ");
    let reg = PluginRegistry::scan(&root);
    assert_eq!(reg.overlay("sea", "marks").unwrap().max_zoom, 18);
    assert!(reg.overlay("sea", "other").is_none());
    assert!(reg.overlay("broken", "marks").is_none());
    assert!(reg.overlay("nobody", "marks").is_none());
    let reg = reg.with_enabled([("sea".to_string(), false)].into());
    assert!(reg.overlay("sea", "marks").is_none());
    assert!(!reg.infos()[1].enabled);
}

#[test]
fn switching_a_plugin_answers_its_row_and_unknown_ids_are_none() {
    let root = temp_dir();
    put(&root, "sea", GOOD);
    let reg = PluginRegistry::scan(&root);
    assert!(!reg.set_enabled("sea", false).unwrap().enabled);
    assert!(reg.overlay("sea", "marks").is_none());
    assert!(reg.set_enabled("sea", true).unwrap().enabled);
    assert!(reg.overlay("sea", "marks").is_some());
    assert!(reg.set_enabled("nobody", true).is_none());
}

#[test]
fn read_manifest_checks_the_size_before_reading_it_all() {
    let root = temp_dir();
    put(
        &root,
        "huge",
        &"#".repeat(rgcs_core::plugin::MAX_MANIFEST_BYTES + 1),
    );
    assert_eq!(
        read_manifest(&root.join("huge")).unwrap_err(),
        PluginError::TooLarge
    );
    std::fs::create_dir_all(root.join("bin")).unwrap();
    std::fs::write(root.join("bin").join(MANIFEST), [0xff, 0xfe, 0x00]).unwrap();
    assert_eq!(read_manifest(&root.join("bin")).unwrap_err(), PluginError::Parse);
}
