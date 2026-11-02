//! The three MLIT forms (無人航空機の飛行日誌の取扱要領 様式 1–3) laid out on A4 with
//! bilingual headings. Column titles are the official ones; "FLAME" on the official form is
//! rendered as "FRAME".

use rgcs_core::jst;
use rgcs_core::{Flight, InspectionResult, InspectionRun, MaintenanceRecord, VehicleRegistry};

use super::table::{line_h, Col, Table};
use super::text::{em_mm, wrap};
use super::{Doc, MARGIN};

pub struct FormContext<'a> {
    pub registry: &'a VehicleRegistry,
    pub from: &'a str,
    pub to: &'a str,
}

const TITLE_PT: f32 = 13.0;
const SUB_PT: f32 = 8.0;
const INFO_PT: f32 = 8.0;

pub fn place_text(place: &str, lat: Option<f64>, lon: Option<f64>) -> String {
    if !place.is_empty() {
        return place.to_string();
    }
    match (lat, lon) {
        (Some(a), Some(o)) => format!("{a:.5}, {o:.5}"),
        _ => String::new(),
    }
}

pub fn minutes_text(n: u32) -> String {
    format!("{n} 分")
}

pub fn result_text(r: InspectionResult) -> &'static str {
    match r {
        InspectionResult::Ok => "正常",
        InspectionResult::Ng => "異常",
        InspectionResult::Skipped => "未実施",
    }
}

/// Title, subtitle and the 無人航空機の概要 grid; leaves the cursor below the block.
pub fn header_block(doc: &mut Doc, title_ja: &str, title_en: &str, ctx: &FormContext) {
    let r = ctx.registry;
    let mut y = MARGIN + em_mm(TITLE_PT);
    doc.text(MARGIN, y, TITLE_PT, title_ja);
    y += line_h(SUB_PT) + 1.0;
    doc.text(MARGIN, y, SUB_PT, title_en);
    y += line_h(INFO_PT) + 1.0;
    let fields: [(&str, &str, &str); 9] = [
        ("登録記号", "REGISTRATION ID", &r.registration),
        ("種類", "TYPE", &r.uas_type),
        ("型式", "MODEL", &r.model),
        ("型式認証書番号", "TYPE CERT. NO.", &r.type_cert_no),
        ("機体認証の区分", "CLASS", &r.airworthiness_class),
        ("機体認証書番号", "AIRWORTHINESS NO.", &r.airworthiness_no),
        ("設計製造者", "MANUFACTURER", &r.manufacturer),
        ("製造番号", "SERIAL NO.", &r.serial_no),
        ("期間", "PERIOD", ""),
    ];
    let period = format!("{} 〜 {}", ctx.from, ctx.to);
    let col_w = (doc.page_width() - 2.0 * MARGIN) / 2.0;
    let rows = fields.len().div_ceil(2);
    for (i, (ja, en, value)) in fields.iter().enumerate() {
        let x = MARGIN + if i < rows { 0.0 } else { col_w };
        let yy = y + (i % rows) as f32 * line_h(INFO_PT);
        let value = if *ja == "期間" { period.as_str() } else { value };
        doc.text(x, yy, INFO_PT, &format!("{ja} {en}: {value}"));
    }
    doc.set_cursor(y + rows as f32 * line_h(INFO_PT) + 2.0);
}

const FORM1_COLS: [Col; 11] = [
    Col {
        ja: "NR",
        en: "",
        width_mm: 10.0,
    },
    Col {
        ja: "飛行年月日",
        en: "FLIGHT DATE",
        width_mm: 20.0,
    },
    Col {
        ja: "飛行させた者の氏名",
        en: "NAME OF PILOT",
        width_mm: 28.0,
    },
    Col {
        ja: "飛行概要",
        en: "NATURE OF FLIGHT",
        width_mm: 56.0,
    },
    Col {
        ja: "離陸場所",
        en: "FROM",
        width_mm: 30.0,
    },
    Col {
        ja: "着陸場所",
        en: "TO",
        width_mm: 30.0,
    },
    Col {
        ja: "離陸時刻",
        en: "OFF TIME",
        width_mm: 14.0,
    },
    Col {
        ja: "着陸時刻",
        en: "ON TIME",
        width_mm: 14.0,
    },
    Col {
        ja: "飛行時間",
        en: "FLIGHT TIME",
        width_mm: 14.0,
    },
    Col {
        ja: "総飛行時間",
        en: "TOTAL FLIGHT TIME",
        width_mm: 18.0,
    },
    Col {
        ja: "飛行の安全に影響のあった事項",
        en: "MATTERS AFFECTED FLIGHT SAFETY",
        width_mm: 43.0,
    },
];

pub fn pilot_text(f: &Flight) -> String {
    if f.pilot_license.is_empty() {
        f.pilot.clone()
    } else {
        format!("{} ({})", f.pilot, f.pilot_license)
    }
}

pub fn nature_text(f: &Flight) -> String {
    let mut parts = Vec::new();
    if !f.purposes.is_empty() {
        parts.push(f.purposes.join("、"));
    }
    if !f.specific_flight.is_empty() {
        parts.push(f.specific_flight.join("、"));
    }
    if !f.summary.is_empty() {
        parts.push(f.summary.clone());
    }
    parts.join("\n")
}

fn flight_rows(flights: &[Flight]) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    for (i, f) in flights.iter().enumerate() {
        rows.push(vec![
            (i + 1).to_string(),
            jst::date(f.takeoff_at),
            pilot_text(f),
            nature_text(f),
            place_text(&f.takeoff_place, f.takeoff_lat, f.takeoff_lon),
            place_text(&f.landing_place, f.landing_lat, f.landing_lon),
            jst::hhmm(f.takeoff_at),
            f.landed_at.map(jst::hhmm).unwrap_or_default(),
            minutes_text(f.flight_minutes),
            minutes_text(f.total_minutes),
            f.safety_notes.clone(),
        ]);
        for s in &f.squawks {
            rows.push(vec![
                "記事".into(),
                format!("発生\n{}", s.occurred_on),
                s.description.clone(),
                format!("処置\n{}", s.action_on),
                s.action.clone(),
                format!("確認\n{}", s.confirmer),
            ]);
        }
    }
    rows
}

/// 様式 1 飛行記録 (landscape).
pub fn render_form1(ctx: &FormContext, flights: &[Flight]) -> Vec<u8> {
    let mut doc = Doc::new("無人航空機の飛行記録", true);
    header_block(&mut doc, "無人航空機の飛行記録", "JOURNEY LOG OF UAS", ctx);
    Table::new(&FORM1_COLS).draw(&mut doc, &flight_rows(flights));
    doc.finish()
}

const FORM2_COLS: [Col; 4] = [
    Col {
        ja: "点検項目",
        en: "INSPECTION ITEMS",
        width_mm: 45.0,
    },
    Col {
        ja: "点検内容",
        en: "DETAIL",
        width_mm: 85.0,
    },
    Col {
        ja: "結果",
        en: "RESULT",
        width_mm: 20.0,
    },
    Col {
        ja: "備考",
        en: "REMARKS",
        width_mm: 40.0,
    },
];

fn run_block(doc: &mut Doc, run: &InspectionRun) {
    let info = format!(
        "実施場所 PLACE: {}   実施年月日 DATE: {}   実施者 INSPECTOR: {}",
        place_text(&run.place, run.lat, run.lon),
        run.performed_on,
        run.inspector
    );
    let y = doc.cursor() + em_mm(INFO_PT);
    doc.text(MARGIN, y, INFO_PT, &info);
    doc.set_cursor(y + 2.0);
    let rows: Vec<Vec<String>> = run
        .results
        .iter()
        .map(|r| {
            vec![
                r.label.clone(),
                r.detail.clone(),
                result_text(r.result).into(),
                r.remark.clone(),
            ]
        })
        .collect();
    Table::new(&FORM2_COLS).draw(doc, &rows);
    let mut y = doc.cursor() + em_mm(INFO_PT);
    doc.text(MARGIN, y, INFO_PT, "特記事項 NOTES:");
    y += line_h(INFO_PT);
    for l in wrap(&run.notes, doc.page_width() - 2.0 * MARGIN, INFO_PT) {
        doc.text(MARGIN, y, INFO_PT, &l);
        y += line_h(INFO_PT);
    }
    doc.set_cursor(y);
}

/// 様式 2 日常点検記録 (portrait): one sheet per run.
pub fn render_form2(ctx: &FormContext, runs: &[InspectionRun]) -> Vec<u8> {
    let mut doc = Doc::new("無人航空機の日常点検記録", false);
    header_block(
        &mut doc,
        "無人航空機の日常点検記録",
        "DAILY INSPECTION RECORD OF UAS",
        ctx,
    );
    for (i, run) in runs.iter().enumerate() {
        if i > 0 {
            doc.new_page();
        }
        run_block(&mut doc, run);
    }
    doc.finish()
}

const FORM3_COLS: [Col; 7] = [
    Col {
        ja: "実施年月日",
        en: "DATE",
        width_mm: 22.0,
    },
    Col {
        ja: "総飛行時間",
        en: "TOTAL FLIGHT TIME",
        width_mm: 20.0,
    },
    Col {
        ja: "点検、修理、改造及び整備の内容",
        en: "DETAIL",
        width_mm: 90.0,
    },
    Col {
        ja: "実施理由",
        en: "REASON",
        width_mm: 40.0,
    },
    Col {
        ja: "実施場所",
        en: "PLACE",
        width_mm: 35.0,
    },
    Col {
        ja: "実施者",
        en: "ENGINEER",
        width_mm: 30.0,
    },
    Col {
        ja: "備考",
        en: "REMARKS",
        width_mm: 40.0,
    },
];

/// 様式 3 点検整備記録 (landscape).
pub fn render_form3(ctx: &FormContext, records: &[MaintenanceRecord]) -> Vec<u8> {
    let mut doc = Doc::new("無人航空機の点検整備記録", true);
    header_block(
        &mut doc,
        "無人航空機の点検整備記録",
        "INSPECTION AND MAINTENANCE RECORD OF UAS",
        ctx,
    );
    let rows: Vec<Vec<String>> = records
        .iter()
        .map(|r| {
            vec![
                r.performed_on.clone(),
                minutes_text(r.total_minutes),
                r.detail.clone(),
                r.reason.clone(),
                r.place.clone(),
                r.engineer.clone(),
                r.notes.clone(),
            ]
        })
        .collect();
    Table::new(&FORM3_COLS).draw(&mut doc, &rows);
    doc.finish()
}
