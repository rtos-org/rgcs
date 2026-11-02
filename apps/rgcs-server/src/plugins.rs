//! Plugins, stage 1: `<plugins_dir>/<id>/plugin.toml`,
//! read once at start. A broken plugin is listed with its error and never stops the server.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use rgcs_core::{Manifest, OverlaySpec, PluginError, PluginInfo};

pub const MANIFEST: &str = "plugin.toml";

/// What one plugin directory held.
#[derive(Debug, Clone)]
enum Found {
    Loaded(Box<Manifest>),
    Broken { dir: String, error: PluginError },
}

impl Found {
    fn id(&self) -> &str {
        match self {
            Self::Loaded(m) => &m.id,
            Self::Broken { dir, .. } => dir,
        }
    }
}

/// The plugins found at start plus the admin's on/off choices. Cheap to clone.
#[derive(Debug, Clone, Default)]
pub struct PluginRegistry {
    found: Arc<Vec<Found>>,
    enabled: Arc<RwLock<HashMap<String, bool>>>,
}

impl PluginRegistry {
    /// Reads every `<root>/<dir>/plugin.toml`, in directory-name order. A missing `root` means
    /// no plugins; each broken plugin is logged once (id and code only).
    pub fn scan(root: &Path) -> Self {
        let mut dirs: Vec<(String, PathBuf)> = std::fs::read_dir(root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().join(MANIFEST).is_file())
            .filter_map(|e| Some((e.file_name().into_string().ok()?, e.path())))
            .collect();
        dirs.sort();
        let found = dirs
            .into_iter()
            .map(
                |(dir, path)| match read_manifest(&path).and_then(|m| check(m, &dir)) {
                    Ok(m) => {
                        tracing::info!(plugin = %m.id, version = %m.version, "plugin loaded");
                        Found::Loaded(Box::new(m))
                    }
                    Err(error) => {
                        tracing::warn!(plugin = %dir, error = error.code(), "plugin not loaded");
                        Found::Broken { dir, error }
                    }
                },
            )
            .collect();
        Self {
            found: Arc::new(found),
            enabled: Arc::default(),
        }
    }

    /// Installs the stored on/off choices (no entry = enabled).
    pub fn with_enabled(self, enabled: HashMap<String, bool>) -> Self {
        Self {
            enabled: Arc::new(RwLock::new(enabled)),
            ..self
        }
    }

    fn is_enabled(&self, id: &str) -> bool {
        let map = self.enabled.read().unwrap_or_else(|e| e.into_inner());
        map.get(id).copied().unwrap_or(true)
    }

    fn info(&self, f: &Found) -> PluginInfo {
        let on = self.is_enabled(f.id());
        match f {
            Found::Loaded(m) => PluginInfo::loaded(m, on),
            Found::Broken { dir, error } => PluginInfo::broken(dir, *error, on),
        }
    }

    pub fn infos(&self) -> Vec<PluginInfo> {
        self.found.iter().map(|f| self.info(f)).collect()
    }

    /// Switches a listed plugin; `None` for an unknown id. The caller stores the choice.
    pub fn set_enabled(&self, id: &str, on: bool) -> Option<PluginInfo> {
        let f = self.found.iter().find(|f| f.id() == id)?;
        self.enabled
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), on);
        Some(self.info(f))
    }

    /// The overlay of a loaded, enabled plugin.
    pub fn overlay(&self, plugin: &str, overlay: &str) -> Option<OverlaySpec> {
        self.found.iter().find_map(|f| match f {
            Found::Loaded(m) if m.id == plugin && self.is_enabled(plugin) => {
                m.overlays.iter().find(|o| o.id == overlay).cloned()
            }
            _ => None,
        })
    }
}

fn check(m: Manifest, dir: &str) -> Result<Manifest, PluginError> {
    rgcs_core::validate(&m, dir)?;
    Ok(m)
}

/// Reads and parses `<dir>/plugin.toml`; the size is checked before the file is read.
pub fn read_manifest(dir: &Path) -> Result<Manifest, PluginError> {
    use std::io::Read;
    let max = rgcs_core::plugin::MAX_MANIFEST_BYTES;
    let file = std::fs::File::open(dir.join(MANIFEST)).map_err(|_| PluginError::Parse)?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PluginError::Parse)?;
    if bytes.len() > max {
        return Err(PluginError::TooLarge);
    }
    let text = String::from_utf8(bytes).map_err(|_| PluginError::Parse)?;
    rgcs_core::parse_manifest(&text)
}

#[cfg(test)]
#[path = "plugins_tests.rs"]
mod tests;
