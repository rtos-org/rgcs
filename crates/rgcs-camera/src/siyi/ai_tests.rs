use super::*;
use crate::siyi::frame::make_packet;
use rgcs_core::{mt11_encoding_presets, Detection, VideoCodec};

fn hex(s: &str) -> Vec<u8> {
    let s: String = s.split_whitespace().collect();
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn le16(vals: &[u16]) -> Vec<u8> {
    vals.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn bx(lx: u16, ly: u16, rx: u16, ry: u16) -> StreamBox {
    StreamBox { lx, ly, rx, ry }
}

#[test]
fn ai_select_box_matches_sdk_example() {
    let pkt = make_packet(0x56, &encode_ai_select(Some(bx(200, 200, 400, 400))), 1, 0);
    assert_eq!(
        pkt,
        hex("55 66 01 09 00 00 00 56 01 C8 00 C8 00 90 01 90 01 92 20")
    );
}

#[test]
fn ai_cancel_matches_sdk_example() {
    let pkt = make_packet(0x56, &encode_ai_select(None), 1, 0);
    assert_eq!(
        pkt,
        hex("55 66 01 09 00 00 00 56 00 00 00 00 00 00 00 00 00 2D 94")
    );
}

#[test]
fn ai_point_matches_sdk_example() {
    let pkt = make_packet(0x56, &encode_ai_select_point(960, 540), 1, 0);
    assert_eq!(
        pkt,
        hex("55 66 01 09 00 00 00 56 01 C0 03 1C 02 00 00 00 00 39 F9")
    );
}

#[test]
fn click_box_centres() {
    assert_eq!(
        click_to_stream_box(0.5, 0.5, 1920, 1080, 150),
        Ok(bx(885, 465, 1035, 615))
    );
    assert_eq!(
        click_to_stream_box(0.5, 0.5, 3840, 2160, 150),
        Ok(bx(1845, 1005, 1995, 1155))
    );
    assert_eq!(
        click_to_stream_box(0.5, 0.5, 1280, 720, 150),
        Ok(bx(565, 285, 715, 435))
    );
}

#[test]
fn click_box_edges_shift_inward() {
    assert_eq!(
        click_to_stream_box(0.0, 0.0, 1920, 1080, 150),
        Ok(bx(0, 0, 150, 150))
    );
    assert_eq!(
        click_to_stream_box(1.0, 1.0, 1920, 1080, 150),
        Ok(bx(1769, 929, 1919, 1079))
    );
    assert_eq!(
        click_to_stream_box(0.01, 0.99, 1920, 1080, 150),
        Ok(bx(0, 929, 150, 1079))
    );
}

#[test]
fn click_box_larger_than_frame() {
    assert_eq!(
        click_to_stream_box(0.5, 0.5, 400, 300, 600),
        Ok(bx(0, 0, 399, 299))
    );
}

#[test]
fn click_box_rejects() {
    assert_eq!(
        click_to_stream_box(-0.1, 0.5, 1920, 1080, 100),
        Err(ClickError::OutOfRange)
    );
    assert_eq!(
        click_to_stream_box(0.5, 1.1, 1920, 1080, 100),
        Err(ClickError::OutOfRange)
    );
    assert_eq!(
        click_to_stream_box(0.5, 0.5, 0, 0, 100),
        Err(ClickError::StreamUnknown)
    );
}

#[test]
fn half_pixel_rounds_up_like_js() {
    assert_eq!(click_to_stream_box(0.5, 0.5, 1920, 1080, 151).unwrap().lx, 885);
    assert_eq!(click_to_stream_box(0.5, 0.5, 1920, 1080, 149).unwrap().lx, 886);
}

#[test]
fn stream_point() {
    assert_eq!(normalized_to_stream_point(0.5, 0.5, 1920, 1080), (960, 540));
    assert_eq!(normalized_to_stream_point(1.0, 1.0, 1920, 1080), (1919, 1079));
    assert_eq!(normalized_to_stream_point(0.0, 0.0, 1920, 1080), (0, 0));
}

fn track(cx: u16, cy: u16, w: u16, h: u16, target: u8, status: u8) -> Vec<u8> {
    let mut v = le16(&[cx, cy, w, h]);
    v.extend([target, status]);
    v
}

#[test]
fn track_centre_to_top_left() {
    let (st, r, name) = parse_track(&track(640, 360, 128, 72, 0, 0)).unwrap();
    assert_eq!(st, Some(TrackStatus::Tracking));
    assert_eq!(name, "person");
    for (a, b) in [(r.x, 0.45), (r.y, 0.45), (r.w, 0.1), (r.h, 0.1)] {
        assert!((a - b).abs() < 1e-6, "{a} vs {b}");
    }
}

#[test]
fn track_any_and_clamp() {
    let (st, _, name) = parse_track(&track(100, 100, 20, 20, 255, 4)).unwrap();
    assert_eq!((st, name.as_str()), (Some(TrackStatus::Tracking), "any"));
    let (st, r, name) = parse_track(&track(5, 5, 40, 40, 1, 1)).unwrap();
    assert_eq!(
        (st, name.as_str(), r.x, r.y),
        (Some(TrackStatus::Searching), "car", 0.0, 0.0)
    );
    assert_eq!(
        parse_track(&track(5, 5, 40, 40, 1, 2)).unwrap().0,
        Some(TrackStatus::Lost)
    );
    assert_eq!(parse_track(&track(5, 5, 40, 40, 1, 3)).unwrap().0, None);
    assert!(parse_track(&[0; 9]).is_none());
}

type Cand = (f32, f32, f32, f32, f32, u8);

fn candidate_payload(boxes: &[Cand], model: u8, pts: u64) -> Vec<u8> {
    let q = |v: f32| (v * 65535.0).round() as u16;
    let mut v = vec![5, model];
    v.extend(pts.to_le_bytes());
    v.push(boxes.len() as u8);
    for field in 0..5 {
        for b in boxes {
            let x = [b.0, b.1, b.2, b.3, b.4][field];
            v.extend(q(x).to_le_bytes());
        }
    }
    v.extend(boxes.iter().map(|b| b.5));
    v
}

#[test]
fn candidates_struct_of_arrays() {
    let p = candidate_payload(
        &[(0.1, 0.2, 0.3, 0.4, 0.9, 0), (0.5, 0.5, 0.7, 0.9, 0.5, 1)],
        0,
        123456,
    );
    let f = parse_candidates(&p).unwrap();
    assert_eq!(f.pts_us, 123456);
    assert_eq!(f.detections.len(), 2);
    let d = &f.detections[1];
    assert_eq!(
        (f.detections[0].class_name.as_str(), d.class_name.as_str()),
        ("person", "car")
    );
    for (a, b) in [(d.x0, 0.5), (d.y0, 0.5), (d.x1, 0.7), (d.y1, 0.9), (d.score, 0.5)] {
        assert!((a - b).abs() < 1e-4, "{a} vs {b}");
    }
    let empty = parse_candidates(&candidate_payload(&[], 0, 1)).unwrap();
    assert!(empty.detections.is_empty());
    assert!(parse_candidates(&p[..p.len() - 3]).is_none());
    assert!(parse_candidates(&[5, 0]).is_none());
}

fn det(x0: f32, y0: f32, x1: f32, y1: f32, class_id: u8) -> Detection {
    Detection {
        x0,
        y0,
        x1,
        y1,
        score: 0.9,
        class_id,
        class_name: String::new(),
    }
}

fn frame(detections: Vec<Detection>) -> DetectionFrame {
    DetectionFrame {
        model: 0,
        pts_us: 0,
        detections,
    }
}

#[test]
fn pick_detection_cases() {
    let none = frame(vec![det(0.0, 0.0, 0.1, 0.1, 0)]);
    assert!(pick_detection(&[&none], 0.9, 0.9).is_none());

    let big_small = frame(vec![det(0.0, 0.0, 0.8, 0.8, 0), det(0.4, 0.4, 0.5, 0.5, 0)]);
    assert_eq!(pick_detection(&[&big_small], 0.45, 0.45).unwrap().x0, 0.4);

    let old = frame(vec![det(0.40, 0.40, 0.50, 0.50, 0)]);
    let new = frame(vec![det(0.43, 0.43, 0.53, 0.53, 0)]);
    let followed = pick_detection(&[&old, &new], 0.41, 0.41).unwrap();
    assert_eq!(followed.x0, 0.43);

    let other = frame(vec![det(0.43, 0.43, 0.53, 0.53, 1)]);
    assert_eq!(pick_detection(&[&old, &other], 0.41, 0.41).unwrap().x0, 0.40);
}

#[test]
fn encoding_parse() {
    let mut p = vec![1, 2];
    p.extend(le16(&[3840, 2160, 16000]));
    p.push(30);
    let (st, e) = parse_encoding(&p).unwrap();
    assert_eq!(
        (st, e.codec, e.width, e.height, e.bitrate_kbps, e.fps),
        (1, VideoCodec::H265, 3840, 2160, 16000, Some(30))
    );
    assert_eq!(parse_encoding(&p[..8]).unwrap().1.fps, None);
    assert!(parse_encoding(&[1, 1, 0]).is_none());
    p[1] = 9;
    assert_eq!(parse_encoding(&p).unwrap().1.codec, VideoCodec::Unknown);
}

#[test]
fn encoding_encode() {
    let presets = mt11_encoding_presets();
    let by = |id: &str| presets.iter().find(|p| p.id == id).unwrap().clone();
    let mut want = vec![1, 1];
    want.extend(le16(&[1920, 1080, 0]));
    want.push(0);
    assert_eq!(encode_encoding(&by("h264_1080p")).to_vec(), want);
    assert_eq!(
        encode_encoding(&by("h264_720p")).to_vec(),
        hex("01 01 00 05 D0 02 00 00 00")
    );
    assert_eq!(encoding_request(), [1]);
}

#[test]
fn ack_codes() {
    assert_eq!(ai_mode_ack(&[1, 3]), Some("stabilization_no_ai"));
    assert_eq!(ai_select_ack(&[4]), Some("low_texture"));
    assert_eq!(ai_select_ack(&[9]), Some("unknown"));
    assert_eq!(ai_mode_ack(&[1]), None);
}

#[test]
fn push_enables() {
    assert_eq!(track_push(true), [1]);
    assert_eq!(candidate_push(true), [5]);
    assert_eq!(candidate_push(false), [4]);
    assert_eq!(ai_mode(true), [1]);
}

#[test]
fn encoding_ack_reads_the_status_byte() {
    assert_eq!(encoding_ack(&[1, 1]), Some(true));
    assert_eq!(encoding_ack(&[1, 0]), Some(false));
    assert_eq!(encoding_ack(&[1]), None);
}
