//! Manifest checks: every rule maps to one [`PluginError`].

use crate::plugin::{
    valid_id, LocalText, Manifest, OverlayCache, OverlaySpec, PluginError, MAX_AREA_ZOOM_SPAN, MAX_LINKS,
    MAX_OVERLAYS, MAX_TEXT_CHARS, MAX_ZOOM, PLUGIN_API,
};

const MAX_VERSION_CHARS: usize = 20;
const MAX_URL_CHARS: usize = 500;

/// Checks a parsed manifest found in directory `dir`.
pub fn validate(m: &Manifest, dir: &str) -> Result<(), PluginError> {
    if !valid_id(&m.id) {
        return Err(PluginError::BadId);
    }
    if m.id != dir {
        return Err(PluginError::IdMismatch);
    }
    if m.api != PLUGIN_API {
        return Err(PluginError::ApiVersion);
    }
    if m.overlays.len() > MAX_OVERLAYS || m.links.len() > MAX_LINKS {
        return Err(PluginError::TooMany);
    }
    short(&m.version, MAX_VERSION_CHARS)?;
    text(&m.name)?;
    m.description.as_ref().map_or(Ok(()), text)?;
    m.author.as_deref().map_or(Ok(()), |a| short(a, MAX_TEXT_CHARS))?;
    m.homepage.as_deref().map_or(Ok(()), https)?;
    for (i, o) in m.overlays.iter().enumerate() {
        overlay(o)?;
        if m.overlays[..i].iter().any(|p| p.id == o.id) {
            return Err(PluginError::DuplicateOverlay);
        }
    }
    for l in &m.links {
        text(&l.label)?;
        https(&l.url)?;
    }
    Ok(())
}

fn overlay(o: &OverlaySpec) -> Result<(), PluginError> {
    if !valid_id(&o.id) {
        return Err(PluginError::BadId);
    }
    text(&o.name)?;
    o.attribution.as_ref().map_or(Ok(()), text)?;
    o.notice.as_ref().map_or(Ok(()), text)?;
    tile_template(&o.tiles)?;
    let span_ok =
        o.cache == OverlayCache::Direct || o.max_zoom.saturating_sub(o.min_zoom) <= MAX_AREA_ZOOM_SPAN;
    if o.min_zoom > o.max_zoom || o.max_zoom > MAX_ZOOM || !span_ok {
        return Err(PluginError::BadZoom);
    }
    if !matches!(o.tile_size, 256 | 512) || !(10..=100).contains(&o.default_opacity) {
        return Err(PluginError::BadValue);
    }
    for e in &o.legend {
        text(&e.label)?;
        if !is_hex_color(&e.color) {
            return Err(PluginError::BadValue);
        }
    }
    Ok(())
}

/// English is required; every value is 1–200 characters.
fn text(t: &LocalText) -> Result<(), PluginError> {
    if t.en.is_empty() {
        return Err(PluginError::NoEnText);
    }
    t.all().try_for_each(|s| short(s, MAX_TEXT_CHARS))
}

fn short(s: &str, max: usize) -> Result<(), PluginError> {
    let n = s.chars().count();
    if n == 0 || n > max {
        return Err(PluginError::BadValue);
    }
    Ok(())
}

fn https(s: &str) -> Result<(), PluginError> {
    match url::Url::parse(s) {
        Ok(u) if u.scheme() == "https" && u.host().is_some() && s.len() <= MAX_URL_CHARS => Ok(()),
        _ => Err(PluginError::BadUrl),
    }
}

/// `http(s)` with `{z}`, `{x}` and `{y}` and no other placeholder.
fn tile_template(s: &str) -> Result<(), PluginError> {
    let has_all = ["{z}", "{x}", "{y}"].iter().all(|p| s.contains(p));
    let filled = s.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0");
    let ok = has_all
        && s.len() <= MAX_URL_CHARS
        && !filled.contains(['{', '}'])
        && matches!(url::Url::parse(&filled), Ok(u) if matches!(u.scheme(), "http" | "https") && u.host().is_some());
    if ok {
        Ok(())
    } else {
        Err(PluginError::BadUrl)
    }
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
}
