//! MLIT forms 1–3 as PDF / CSV: render tests on fixtures and the export endpoint.

mod common;

use axum::http::{header, Method, StatusCode};
use common::{call, error_code, login, req, seed_vehicle, spawn_app};
use regex::Regex;
use rgcs_core::{
    Flight, FlightSquawk, FlightStatus, InspectionResult, InspectionResultRow, InspectionRun,
    MaintenanceRecord, VehicleRegistry,
};
use rgcs_server::export_csv::{csv_form1, csv_form2, csv_form3};
use rgcs_server::pdf::forms::{render_form1, render_form2, render_form3, FormContext};
use serde_json::json;

/// 2026-12-05 10:00 JST.
const T0: u64 = 1_796_050_800_000 + 4 * 86_400_000 + 10 * 3_600_000;

fn registry() -> VehicleRegistry {
    VehicleRegistry {
        sysid: 1,
        name: "UAV-01".into(),
        registration: "JU1234567890".into(),
        uas_type: "回転翼航空機(マルチローター)".into(),
        model: "X-500".into(),
        type_cert_no: "".into(),
        airworthiness_class: "第二種".into(),
        airworthiness_no: "AW-001".into(),
        manufacturer: "RTOS".into(),
        serial_no: "SN-0001".into(),
        initial_flight_minutes: 100,
        inspection_template_id: Some(1),
        endurance_minutes: None,
        total_flight_minutes: 103,
    }
}

fn flight(i: u64, squawks: usize) -> Flight {
    let takeoff = T0 + i * 3_600_000;
    Flight {
        id: i as i64 + 1,
        sysid: 1,
        status: FlightStatus::Confirmed,
        pilot: "山田".into(),
        pilot_license: "T123".into(),
        takeoff_at: takeoff,
        landed_at: Some(takeoff + 90_000),
        takeoff_lat: Some(35.481883),
        takeoff_lon: Some(138.48029),
        landing_lat: Some(35.482883),
        landing_lon: Some(138.48129),
        takeoff_place: if i % 2 == 0 {
            "熊谷市 ○○運動場".into()
        } else {
            String::new()
        },
        landing_place: String::new(),
        purposes: vec!["空撮".into(), "研究開発".into()],
        specific_flight: vec!["目視外飛行".into()],
        summary: "デモ飛行".into(),
        safety_notes: String::new(),
        flight_minutes: 2,
        total_minutes: 100 + 2 * (i as u32 + 1),
        squawks: (0..squawks)
            .map(|k| FlightSquawk {
                id: k as i64,
                flight_id: i as i64 + 1,
                occurred_on: "2026-12-05".into(),
                description: "振動が大きい".into(),
                action_on: "2026-12-06".into(),
                action: "プロペラ交換".into(),
                confirmer: "山田".into(),
                created_by: "admin".into(),
                created_at: 0,
            })
            .collect(),
        supersedes: None,
        created_by: "system".into(),
        created_at: 0,
        updated_at: 0,
    }
}

fn run(i: i64) -> InspectionRun {
    let labels = [
        "機体全般",
        "プロペラ",
        "フレーム",
        "通信系統",
        "推進系統",
        "電源系統",
        "自動制御系統",
        "操縦装置",
        "バッテリー、燃料",
    ];
    InspectionRun {
        id: i,
        sysid: 1,
        template_id: 1,
        template_name: "様式2 標準".into(),
        template_version: 1,
        place: "テスト場".into(),
        lat: None,
        lon: None,
        performed_on: "2026-12-05".into(),
        inspector: "admin".into(),
        notes: "飛行後点検：異常なし".into(),
        results: labels
            .iter()
            .enumerate()
            .map(|(k, l)| InspectionResultRow {
                position: k as u32 + 1,
                label: (*l).into(),
                detail: "外観、損傷、ゆがみ".into(),
                result: if k == 1 {
                    InspectionResult::Ng
                } else {
                    InspectionResult::Ok
                },
                remark: if k == 1 { "欠け".into() } else { String::new() },
            })
            .collect(),
        has_ng: true,
        supersedes: None,
        created_by: "admin".into(),
        created_at: 0,
    }
}

fn record(i: i64) -> MaintenanceRecord {
    MaintenanceRecord {
        id: i,
        sysid: 1,
        performed_on: "2026-12-10".into(),
        total_minutes: 103,
        detail: "プロペラ交換(CW ×2)".into(),
        reason: "日常点検で欠けを発見".into(),
        place: "工場".into(),
        engineer: "admin".into(),
        notes: "次回 2027-03".into(),
        supersedes: None,
        created_by: "admin".into(),
        created_at: 0,
    }
}

fn ctx(r: &VehicleRegistry) -> FormContext<'_> {
    FormContext {
        registry: r,
        from: "2026-12-01",
        to: "2026-12-31",
    }
}

fn pages(pdf: &[u8]) -> usize {
    let text = String::from_utf8_lossy(pdf);
    Regex::new(r"/Type\s*/Page\b").unwrap().find_iter(&text).count()
}

#[test]
fn form1_pdf_has_one_page_for_three_flights() {
    let r = registry();
    let flights: Vec<Flight> = (0..3).map(|i| flight(i, usize::from(i == 1))).collect();
    let pdf = render_form1(&ctx(&r), &flights);
    assert!(pdf.starts_with(b"%PDF-"));
    assert_eq!(pages(&pdf), 1);
    // The whole Noto Sans JP CFF is embedded (printpdf 0.12 does not subset it): ~3.7 MB.
    assert!(pdf.len() < 6_000_000, "{} bytes", pdf.len());
}

#[test]
fn form1_breaks_pages_after_many_rows() {
    let r = registry();
    let flights: Vec<Flight> = (0..40).map(|i| flight(i, 0)).collect();
    assert!(pages(&render_form1(&ctx(&r), &flights)) >= 2);
}

#[test]
fn form2_one_run_per_page_block() {
    let r = registry();
    let runs: Vec<InspectionRun> = (1..=3).map(run).collect();
    assert_eq!(pages(&render_form2(&ctx(&r), &runs)), 3);
}

#[test]
fn csv_form1_has_bom_crlf_and_squawks() {
    let csv = String::from_utf8(csv_form1(&[flight(0, 1)])).unwrap();
    assert!(csv.starts_with('\u{feff}'));
    let header = csv.trim_start_matches('\u{feff}').lines().next().unwrap();
    assert!(csv.contains("\r\n"));
    assert!(
        header.starts_with("NR,飛行年月日,飛行させた者の氏名,技能証明書番号,飛行の目的"),
        "{header}"
    );
    assert!(
        csv.contains("発生 2026-12-05: 振動が大きい → 処置 2026-12-06: プロペラ交換 (山田)"),
        "{csv}"
    );
    assert!(csv.contains("10:00,10:01,2,102"), "{csv}");
}

#[test]
fn csv_cells_cannot_become_spreadsheet_formulas() {
    // free text typed by an operator must not run as a formula when the CSV is opened in Excel
    let mut f = flight(0, 1);
    f.summary = "=HYPERLINK(\"http://x\",\"y\")".into();
    f.safety_notes = "@SUM(A1)".into();
    f.pilot = "+81 3".into();
    let csv = String::from_utf8(csv_form1(&[f])).unwrap();
    assert!(csv.contains("'=HYPERLINK"), "{csv}");
    assert!(csv.contains("'@SUM(A1)"), "{csv}");
    assert!(csv.contains("'+81 3"), "{csv}");
    let mut r = record(1);
    r.notes = "-5 + cmd".into();
    r.detail = "-12.5".into();
    let csv3 = String::from_utf8(csv_form3(&[r])).unwrap();
    assert!(csv3.contains("'-5 + cmd"), "{csv3}");
    assert!(csv3.contains(",-12.5,"), "plain numbers stay numbers: {csv3}");
}

#[test]
fn empty_range_renders_a_one_page_form() {
    let r = registry();
    assert_eq!(pages(&render_form1(&ctx(&r), &[])), 1);
    assert_eq!(pages(&render_form2(&ctx(&r), &[])), 1);
    assert_eq!(pages(&render_form3(&ctx(&r), &[])), 1);
    let csv = String::from_utf8(csv_form2(&[])).unwrap();
    assert_eq!(csv.lines().count(), 1, "BOM + header only");
    let csv3 = String::from_utf8(csv_form3(&[record(1)])).unwrap();
    assert!(csv3.contains("2026-12-10,103,プロペラ交換(CW ×2)"), "{csv3}");
}

#[tokio::test]
async fn export_endpoint_streams_pdf_and_csv_with_filenames() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let (_, _, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/flights",
            Some(&admin),
            Some(json!({ "pilot": "admin", "pilot_license": "", "takeoff_at": T0, "landed_at": T0 + 60_000,
                "takeoff_place": "", "landing_place": "", "purposes": ["空撮"], "specific_flight": [], "summary": "", "safety_notes": "" })),
        ),
    )
    .await;
    let path = "/api/vehicles/1/logbook/export?form=1&from=2026-12-01&to=2026-12-31&format=pdf";
    let request = axum::http::Request::builder()
        .method(Method::GET)
        .uri(path)
        .header(header::COOKIE, &admin)
        .body(axum::body::Body::empty())
        .unwrap();
    let res = tower::ServiceExt::oneshot(app.clone(), request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/pdf"
    );
    assert_eq!(
        res.headers().get(header::CONTENT_DISPOSITION).unwrap(),
        "attachment; filename=\"logbook-1-form1-2026-12-01-2026-12-31.pdf\""
    );
    let bytes = http_body_util::BodyExt::collect(res.into_body())
        .await
        .unwrap()
        .to_bytes();
    assert!(bytes.starts_with(b"%PDF-"));

    let request = axum::http::Request::builder()
        .method(Method::GET)
        .uri("/api/vehicles/1/logbook/export?form=3&from=2026-12-01&to=2026-12-31&format=csv")
        .header(header::COOKIE, &admin)
        .body(axum::body::Body::empty())
        .unwrap();
    let res = tower::ServiceExt::oneshot(app.clone(), request).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "text/csv; charset=utf-8"
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/logbook/export?form=4&from=2026-12-01&to=2026-12-31&format=pdf",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (status, _, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/logbook/export?form=1&from=2026-12-01&to=2026-12-31&format=xml",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Writes the three forms to `$RGCS_PDF_OUT` (or the temp dir) for a visual check with `sips`.
#[test]
#[ignore = "visual fixture"]
fn write_fixture_pdfs() {
    let dir = std::env::var("RGCS_PDF_OUT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("rgcs-forms"));
    std::fs::create_dir_all(&dir).unwrap();
    let r = registry();
    let flights: Vec<Flight> = (0..6).map(|i| flight(i, usize::from(i == 1))).collect();
    std::fs::write(dir.join("form1.pdf"), render_form1(&ctx(&r), &flights)).unwrap();
    std::fs::write(dir.join("form2.pdf"), render_form2(&ctx(&r), &[run(1), run(2)])).unwrap();
    std::fs::write(
        dir.join("form3.pdf"),
        render_form3(&ctx(&r), &[record(1), record(2)]),
    )
    .unwrap();
    std::fs::write(dir.join("form1.csv"), csv_form1(&flights)).unwrap();
}
