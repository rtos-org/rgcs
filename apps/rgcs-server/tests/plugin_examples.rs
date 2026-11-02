//! Every manifest RGCS documents or ships loads: the `toml` blocks in PLUGINS.md, the examples
//! and (where present) the internal deploy plugins.

use std::path::{Path, PathBuf};

use rgcs_core::PluginStatus;
use rgcs_server::plugins::PluginRegistry;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn assert_all_load(root: &Path) -> usize {
    let infos = PluginRegistry::scan(root).infos();
    for i in &infos {
        assert_eq!(i.status, PluginStatus::Ok, "{}: {:?}", i.id, i.error);
    }
    infos.len()
}

#[test]
fn the_examples_and_deploy_plugins_load() {
    assert!(assert_all_load(&repo().join("examples/plugins")) >= 1);
    let deploy = repo().join("deploy/plugins");
    if deploy.is_dir() {
        assert_all_load(&deploy);
    }
}

#[test]
fn the_manifests_in_plugins_md_are_valid() {
    let doc = std::fs::read_to_string(repo().join("PLUGINS.md")).expect("PLUGINS.md");
    let blocks: Vec<&str> = doc
        .split("```toml\n")
        .skip(1)
        .map(|b| b.split("```").next().unwrap_or(""))
        .collect();
    assert!(blocks.len() >= 2);
    for b in blocks {
        let m = rgcs_core::parse_manifest(b).unwrap_or_else(|e| panic!("{e:?}\n{b}"));
        rgcs_core::validate(&m, &m.id).unwrap_or_else(|e| panic!("{e:?}\n{b}"));
    }
}
