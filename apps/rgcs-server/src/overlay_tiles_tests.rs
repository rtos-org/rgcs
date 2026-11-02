use super::*;

const NACHI: Rect = Rect {
    south: 33.62,
    west: 135.85,
    north: 33.71,
    east: 135.96,
};
const Z8_14: RangeInclusive<u8> = 8..=14;

fn gif(w: u16, h: u16) -> Vec<u8> {
    let mut b = b"GIF89a".to_vec();
    b.extend_from_slice(&w.to_le_bytes());
    b.extend_from_slice(&h.to_le_bytes());
    b.extend_from_slice(&[0, 0, 0, 0x3b]);
    b
}

fn png(w: u32, h: u32) -> Vec<u8> {
    let mut b = PNG_SIGNATURE.to_vec();
    b.extend_from_slice(&13u32.to_be_bytes());
    b.extend_from_slice(b"IHDR");
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    b
}

fn source(format: TileFormat) -> Source {
    Source {
        plugin: "docomo-lte".into(),
        overlay: "lte".into(),
        template: "http://127.0.0.1:9/{z}/{x}/{y}".into(),
        format,
        tile_size: 256,
        min_zoom: 8,
        max_zoom: 14,
    }
}

#[test]
fn rect_rules() {
    assert!(NACHI.is_valid());
    let bad = |s, w, n, e| {
        !Rect {
            south: s,
            west: w,
            north: n,
            east: e,
        }
        .is_valid()
    };
    assert!(bad(33.7, 135.8, 33.6, 135.9), "south above north");
    assert!(bad(33.6, 135.9, 33.7, 135.8), "west east of east");
    assert!(bad(-85.0, 0.0, 10.0, 1.0), "south at the pole limit");
    assert!(bad(0.0, 0.0, 85.0, 1.0), "north at the pole limit");
    assert!(bad(0.0, -180.1, 1.0, 1.0));
    assert!(bad(0.0, 0.0, 1.0, f64::NAN));
    assert!(!bad(-84.9, -180.0, 84.9, 180.0));
}

#[test]
fn a_point_falls_in_the_expected_tile() {
    let r = Rect {
        south: 33.668,
        west: 135.904,
        north: 33.6683,
        east: 135.9042,
    };
    let z8 = range(&r, 8);
    assert_eq!((z8.x0, z8.x1, z8.y0, z8.y1), (224, 224, 102, 102));
    assert_eq!(count(&r, Z8_14), 7, "one tile per zoom 8–14");
    assert_eq!(count(&r, 10..=10), 1);
}

#[test]
fn counts_tiles_and_lists_them_over_the_overlay_zooms() {
    let total = count(&NACHI, Z8_14);
    let listed: Vec<_> = tiles(&NACHI, Z8_14).collect();
    assert_eq!(listed.len() as u64, total);
    assert!(total > 7 && total < OVERLAY_MAX_TILES, "{total}");
    assert!(listed.iter().all(|&(z, x, y)| covers(&NACHI, &Z8_14, z, x, y)));
    assert!(!covers(&NACHI, &Z8_14, 8, 0, 0));
    assert!(
        !covers(&NACHI, &Z8_14, 7, 112, 51),
        "zoom 7 is outside the fetched range"
    );
    assert!(tiles(&NACHI, 10..=11).all(|(z, _, _)| z == 10 || z == 11));
}

#[test]
fn the_world_is_clamped_and_too_many() {
    let world = Rect {
        south: -84.9,
        west: -180.0,
        north: 84.9,
        east: 180.0,
    };
    let z8 = range(&world, 8);
    assert_eq!(
        (z8.x0, z8.x1, z8.y0, z8.y1),
        (0, 255, 1, 254),
        "84.9° is inside the top / bottom row"
    );
    assert!(count(&world, Z8_14) > OVERLAY_MAX_TILES);
}

#[test]
fn gif_checks() {
    let g = TileFormat::Gif;
    assert_eq!(check_tile(g, 256, Some("image/gif"), &gif(256, 256)), Ok(()));
    let mut g87 = gif(256, 256);
    g87[4] = b'7';
    assert_eq!(
        check_tile(g, 256, Some("image/gif; charset=binary"), &g87),
        Ok(())
    );
    assert_eq!(
        check_tile(g, 256, Some("image/gif"), &gif(512, 256)),
        Err("bad_size")
    );
    assert_eq!(check_tile(g, 512, Some("image/gif"), &gif(512, 512)), Ok(()));
    assert_eq!(check_tile(g, 256, Some("text/html"), b"GIF89a"), Err("html"));
    assert_eq!(check_tile(g, 256, Some("image/gif"), b"<html>"), Err("html"));
    assert_eq!(
        check_tile(g, 256, Some("image/png"), &gif(256, 256)),
        Err("not_gif")
    );
    assert_eq!(check_tile(g, 256, None, &gif(256, 256)), Err("not_gif"));
    assert_eq!(
        check_tile(g, 256, Some("image/gif"), b"GIF89a\x00"),
        Err("not_gif")
    );
    assert_eq!(
        check_tile(g, 256, Some("image/gif"), &png(256, 256)),
        Err("not_gif")
    );
}

#[test]
fn png_checks() {
    let p = TileFormat::Png;
    assert_eq!(check_tile(p, 256, Some("image/png"), &png(256, 256)), Ok(()));
    assert_eq!(check_tile(p, 512, Some("image/png"), &png(512, 512)), Ok(()));
    assert_eq!(
        check_tile(p, 256, Some("image/png"), &png(256, 255)),
        Err("bad_size")
    );
    assert_eq!(
        check_tile(p, 256, Some("image/gif"), &png(256, 256)),
        Err("not_png")
    );
    assert_eq!(
        check_tile(p, 256, Some("image/png"), &gif(256, 256)),
        Err("not_png")
    );
    assert_eq!(
        check_tile(p, 256, Some("image/png"), &png(256, 256)[..20]),
        Err("not_png")
    );
    let mut no_ihdr = png(256, 256);
    no_ihdr[12..16].copy_from_slice(b"IDAT");
    assert_eq!(check_tile(p, 256, Some("image/png"), &no_ihdr), Err("not_png"));
    assert_eq!(
        check_tile(p, 256, Some("text/html; charset=utf-8"), b"<!doctype html>"),
        Err("html")
    );
}

#[test]
fn blank_tiles_are_valid_images() {
    let (g, gt) = blank(TileFormat::Gif);
    assert!(g.starts_with(b"GIF89a") && g.ends_with(&[0x3b]) && gt == "image/gif");
    let (p, pt) = blank(TileFormat::Png);
    assert_eq!(png_size("image/png", p), Some((1, 1)));
    assert!(p.ends_with(b"IEND\xae\x42\x60\x82") && pt == "image/png");
}

#[test]
fn urls_paths_and_names() {
    let t = "http://127.0.0.1:9/map/{z}/{x}/{z}_{x}_{y}.gif";
    assert_eq!(
        tile_url(t, 14, 14530, 6540),
        "http://127.0.0.1:9/map/14/14530/14_14530_6540.gif"
    );
    let p = source(TileFormat::Gif).tile_path(Path::new("/data"), 9, 449, 205);
    assert_eq!(p, PathBuf::from("/data/overlays/docomo-lte/lte/9/449/205.gif"));
    let p = source(TileFormat::Png).tile_path(Path::new("/data"), 9, 449, 205);
    assert_eq!(p, PathBuf::from("/data/overlays/docomo-lte/lte/9/449/205.png"));
    assert_eq!(parse_tile_name("205.gif", "gif"), Some(205));
    assert_eq!(parse_tile_name("205.png", "gif"), None);
    assert_eq!(parse_tile_name("205gif", "gif"), None);
    assert_eq!(parse_tile_name("205", "gif"), None);
    assert_eq!(parse_tile_name("-1.gif", "gif"), None);
    assert_eq!(parse_tile_name("../x.gif", "gif"), None);
    assert!(in_range(0, 0, 0) && in_range(14, 16383, 16383));
    assert!(!in_range(14, 16384, 0) && !in_range(14, 0, 16384));
    assert!(!in_range(TILE_ROUTE_MAX_ZOOM + 1, 0, 0));
}
