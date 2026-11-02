use super::*;

const DOCOMO: &str = r##"
id = "docomo-lte"
api = 1
version = "1.0.0"
name = { en = "docomo LTE area", ja = "ドコモ LTE エリア" }
author = "RtoS"

[[overlay]]
id = "lte"
name = { en = "docomo LTE area", ja = "ドコモ LTE エリア" }
tiles = "https://servicearea.example.jp/map/{z}/{x}/{z}_{x}_{y}.gif"
cache = "area"
format = "gif"
tile_size = 256
min_zoom = 8
max_zoom = 14
notice = { en = "No guarantee in the air.", ja = "上空通信の保証なし" }

[[overlay.legend]]
color = "#ff7f00"
label = "LTE"

[[link]]
label = { en = "docomo coverage map", ja = "ドコモ公式エリアマップ" }
url = "https://www.docomo.ne.jp/area/map/"
"##;

fn parse(s: &str) -> Result<Manifest, PluginError> {
    parse_manifest(s)
}

fn checked(s: &str, dir: &str) -> Result<Manifest, PluginError> {
    let m = parse(s)?;
    validate(&m, dir)?;
    Ok(m)
}

/// The docomo manifest with one line replaced.
fn with(from: &str, to: &str) -> String {
    assert!(DOCOMO.contains(from), "{from}");
    DOCOMO.replacen(from, to, 1)
}

#[test]
fn a_full_manifest_parses_and_validates() {
    let m = checked(DOCOMO, "docomo-lte").unwrap();
    assert_eq!(m.id, "docomo-lte");
    assert_eq!(m.name.pick("ja"), "ドコモ LTE エリア");
    let o = &m.overlays[0];
    assert_eq!(
        (o.cache, o.format, o.tile_size, o.min_zoom, o.max_zoom),
        (OverlayCache::Area, TileFormat::Gif, 256, 8, 14)
    );
    assert_eq!(o.default_opacity, 60);
    assert_eq!(o.legend[0].label.pick("ko"), "LTE");
    assert_eq!(m.links[0].url, "https://www.docomo.ne.jp/area/map/");
}

#[test]
fn a_minimal_manifest_has_no_overlays_or_links() {
    let m = checked("id = \"x\"\napi = 1\nversion = \"0.1\"\nname = \"X\"\n", "x").unwrap();
    assert!(m.overlays.is_empty() && m.links.is_empty());
}

#[test]
fn local_text_picks_the_language_then_english() {
    let t = LocalText {
        en: "E".into(),
        ja: Some("J".into()),
        zh: None,
        ko: None,
    };
    assert_eq!((t.pick("ja"), t.pick("zh"), t.pick("en")), ("J", "E", "E"));
    let plain = parse("id = \"x\"\napi = 1\nversion = \"1\"\nname = \"Same\"\n")
        .unwrap()
        .name;
    assert_eq!(
        plain,
        LocalText {
            en: "Same".into(),
            ja: None,
            zh: None,
            ko: None
        }
    );
}

#[test]
fn unknown_keys_and_bad_toml_are_parse_errors() {
    assert_eq!(
        parse(&with("author = \"RtoS\"", "autor = \"RtoS\"")).unwrap_err(),
        PluginError::Parse
    );
    assert_eq!(
        parse(&with("cache = \"area\"", "cache = \"disk\"")).unwrap_err(),
        PluginError::Parse
    );
    assert_eq!(parse("id = ").unwrap_err(), PluginError::Parse);
}

#[test]
fn the_id_must_be_valid_and_match_the_directory() {
    assert_eq!(checked(DOCOMO, "other").unwrap_err(), PluginError::IdMismatch);
    let bad = with("id = \"docomo-lte\"", "id = \"Docomo LTE\"");
    assert_eq!(checked(&bad, "Docomo LTE").unwrap_err(), PluginError::BadId);
    assert_eq!(
        checked(&with("id = \"lte\"", "id = \"../x\""), "docomo-lte").unwrap_err(),
        PluginError::BadId
    );
    assert!(valid_id("a0-b") && !valid_id("-a") && !valid_id("") && !valid_id(&"a".repeat(41)));
}

#[test]
fn only_api_1_is_understood() {
    assert_eq!(
        checked(&with("api = 1", "api = 2"), "docomo-lte").unwrap_err(),
        PluginError::ApiVersion
    );
}

#[test]
fn every_text_needs_english() {
    let s = with(
        "name = { en = \"docomo LTE area\", ja = \"ドコモ LTE エリア\" }\nauthor",
        "name = { ja = \"ドコモ\" }\nauthor",
    );
    assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::NoEnText);
    let s = with("label = \"LTE\"", "label = { ja = \"LTE\" }");
    assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::NoEnText);
}

#[test]
fn tile_urls_need_the_three_placeholders_only() {
    for t in [
        "ftp://x.example/{z}/{x}/{y}.gif",
        "https://x.example/{z}/{x}.gif",
        "https://x.example/{z}/{x}/{y}/{s}.gif",
        "not a url {z}{x}{y}",
    ] {
        let s = with("https://servicearea.example.jp/map/{z}/{x}/{z}_{x}_{y}.gif", t);
        assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::BadUrl, "{t}");
    }
    // http is allowed for tiles (local test servers)
    let s = with("https://servicearea", "http://servicearea");
    assert!(checked(&s, "docomo-lte").is_ok());
}

#[test]
fn links_and_homepages_must_be_https() {
    let s = with(
        "url = \"https://www.docomo.ne.jp",
        "url = \"http://www.docomo.ne.jp",
    );
    assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::BadUrl);
    let s = with("author = \"RtoS\"", "homepage = \"javascript:alert(1)\"");
    assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::BadUrl);
}

#[test]
fn zoom_ranges_are_checked() {
    for (from, to) in [
        ("min_zoom = 8", "min_zoom = 15"),
        ("max_zoom = 14", "max_zoom = 23"),
        ("min_zoom = 8", "min_zoom = 5"),
    ] {
        assert_eq!(
            checked(&with(from, to), "docomo-lte").unwrap_err(),
            PluginError::BadZoom,
            "{to}"
        );
    }
    // a direct overlay may span any range: nothing is fetched
    let s = with("cache = \"area\"", "cache = \"direct\"").replace("min_zoom = 8", "min_zoom = 0");
    assert!(checked(&s, "docomo-lte").is_ok());
}

#[test]
fn overlay_ids_are_unique_in_a_plugin() {
    let block = &DOCOMO[DOCOMO.find("[[overlay]]").unwrap()..DOCOMO.find("[[overlay.legend]]").unwrap()];
    let s = format!("{DOCOMO}\n{block}");
    assert_eq!(
        checked(&s, "docomo-lte").unwrap_err(),
        PluginError::DuplicateOverlay
    );
}

#[test]
fn values_out_of_range_are_bad_values() {
    for (from, to) in [
        ("tile_size = 256", "tile_size = 300"),
        ("color = \"#ff7f00\"", "color = \"orange\""),
        ("version = \"1.0.0\"", "version = \"\""),
        ("author = \"RtoS\"", "author = \"\""),
    ] {
        assert_eq!(
            checked(&with(from, to), "docomo-lte").unwrap_err(),
            PluginError::BadValue,
            "{to}"
        );
    }
    let s = with("max_zoom = 14", "max_zoom = 14\ndefault_opacity = 5");
    assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::BadValue);
    let s = with("label = \"LTE\"", &format!("label = \"{}\"", "x".repeat(201)));
    assert_eq!(checked(&s, "docomo-lte").unwrap_err(), PluginError::BadValue);
}

#[test]
fn too_many_overlays_or_links() {
    let links = "[[link]]\nlabel = \"L\"\nurl = \"https://a.example/\"\n".repeat(MAX_LINKS + 1);
    let s = format!("id = \"x\"\napi = 1\nversion = \"1\"\nname = \"X\"\n{links}");
    assert_eq!(checked(&s, "x").unwrap_err(), PluginError::TooMany);
}

#[test]
fn a_manifest_over_64_kib_is_too_large() {
    let s = format!("{DOCOMO}\n# {}\n", "x".repeat(MAX_MANIFEST_BYTES));
    assert_eq!(parse(&s).unwrap_err(), PluginError::TooLarge);
}

#[test]
fn errors_have_short_codes() {
    assert_eq!(PluginError::IdMismatch.code(), "id_mismatch");
    assert_eq!(PluginError::NoEnText.code(), "no_en_text");
    assert_eq!(serde_json::to_value(PluginError::TooLarge).unwrap(), "too_large");
}

#[test]
fn info_hides_the_tile_url_of_area_overlays() {
    let m = checked(DOCOMO, "docomo-lte").unwrap();
    let info = PluginInfo::loaded(&m, true);
    assert_eq!(info.status, PluginStatus::Ok);
    assert_eq!(info.overlays[0].tiles, None);
    let direct = checked(&with("cache = \"area\"", "cache = \"direct\""), "docomo-lte").unwrap();
    let info = PluginInfo::loaded(&direct, false);
    assert!(!info.enabled);
    assert_eq!(
        info.overlays[0].tiles.as_deref(),
        Some("https://servicearea.example.jp/map/{z}/{x}/{z}_{x}_{y}.gif")
    );
    let v = serde_json::to_value(&info).unwrap();
    assert_eq!(v["overlays"][0]["cache"], "direct");
    assert_eq!(
        v["name"],
        serde_json::json!({ "en": "docomo LTE area", "ja": "ドコモ LTE エリア" })
    );
}

#[test]
fn a_broken_plugin_is_listed_with_its_code() {
    let info = PluginInfo::broken("bad", PluginError::Parse, true);
    assert_eq!(info.status, PluginStatus::Error);
    assert_eq!(info.error.as_deref(), Some("parse"));
    assert_eq!(info.name.en, "bad");
    assert!(info.overlays.is_empty());
}
