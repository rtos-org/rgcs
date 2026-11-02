//! CSV versions of the three forms: UTF-8 with BOM and CRLF so Excel opens them correctly,
//! Japanese headers, one file per form.

use rgcs_core::jst;
use rgcs_core::{Flight, InspectionRun, MaintenanceRecord};

use crate::pdf::forms::{place_text, result_text};

const BOM: &[u8] = "\u{feff}".as_bytes();

fn writer() -> csv::Writer<Vec<u8>> {
    csv::WriterBuilder::new()
        .terminator(csv::Terminator::CRLF)
        .from_writer(Vec::with_capacity(4096))
}

fn finish(w: csv::Writer<Vec<u8>>) -> Vec<u8> {
    let body = w.into_inner().unwrap_or_default();
    let mut out = Vec::with_capacity(body.len() + BOM.len());
    out.extend_from_slice(BOM);
    out.extend_from_slice(&body);
    out
}

/// A cell Excel would run as a formula (`=` `+` `-` `@`, tab, CR first) gets a leading `'`
/// (OWASP CSV injection); plain numbers such as `-12.5` stay as they are.
fn safe(cell: String) -> String {
    let risky = cell.starts_with(['=', '+', '-', '@', '\t', '\r']);
    if risky && cell.trim().parse::<f64>().is_err() {
        format!("'{cell}")
    } else {
        cell
    }
}

/// A data row: every cell through `safe` (headers are ours and go out as written).
fn row<const N: usize>(w: &mut csv::Writer<Vec<u8>>, cells: [String; N]) {
    let _ = w.write_record(cells.map(safe));
}

pub fn squawk_text(f: &Flight) -> String {
    f.squawks
        .iter()
        .map(|s| {
            let mut t = format!("発生 {}: {}", s.occurred_on, s.description);
            if !s.action_on.is_empty() || !s.action.is_empty() {
                t.push_str(&format!(" → 処置 {}: {}", s.action_on, s.action));
            }
            if !s.confirmer.is_empty() {
                t.push_str(&format!(" ({})", s.confirmer));
            }
            t
        })
        .collect::<Vec<_>>()
        .join(" / ")
}

/// 様式 1: one row per flight.
pub fn csv_form1(flights: &[Flight]) -> Vec<u8> {
    let mut w = writer();
    let _ = w.write_record([
        "NR",
        "飛行年月日",
        "飛行させた者の氏名",
        "技能証明書番号",
        "飛行の目的",
        "特定飛行の形態",
        "飛行概要",
        "離陸場所",
        "着陸場所",
        "離陸時刻",
        "着陸時刻",
        "飛行時間(分)",
        "総飛行時間(分)",
        "飛行の安全に影響のあった事項",
        "記事",
    ]);
    for (i, f) in flights.iter().enumerate() {
        row(
            &mut w,
            [
                (i + 1).to_string(),
                jst::date(f.takeoff_at),
                f.pilot.clone(),
                f.pilot_license.clone(),
                f.purposes.join("、"),
                f.specific_flight.join("、"),
                f.summary.clone(),
                place_text(&f.takeoff_place, f.takeoff_lat, f.takeoff_lon),
                place_text(&f.landing_place, f.landing_lat, f.landing_lon),
                jst::hhmm(f.takeoff_at),
                f.landed_at.map(jst::hhmm).unwrap_or_default(),
                f.flight_minutes.to_string(),
                f.total_minutes.to_string(),
                f.safety_notes.clone(),
                squawk_text(f),
            ],
        );
    }
    finish(w)
}

/// 様式 2: one row per inspection item.
pub fn csv_form2(runs: &[InspectionRun]) -> Vec<u8> {
    let mut w = writer();
    let _ = w.write_record([
        "記録ID",
        "実施年月日",
        "実施場所",
        "実施者",
        "点検項目",
        "点検内容",
        "結果",
        "備考",
        "特記事項",
    ]);
    for run in runs {
        for r in &run.results {
            row(
                &mut w,
                [
                    run.id.to_string(),
                    run.performed_on.clone(),
                    place_text(&run.place, run.lat, run.lon),
                    run.inspector.clone(),
                    r.label.clone(),
                    r.detail.clone(),
                    result_text(r.result).to_string(),
                    r.remark.clone(),
                    run.notes.clone(),
                ],
            );
        }
    }
    finish(w)
}

/// 様式 3: one row per maintenance record.
pub fn csv_form3(records: &[MaintenanceRecord]) -> Vec<u8> {
    let mut w = writer();
    let _ = w.write_record([
        "実施年月日",
        "総飛行時間(分)",
        "内容",
        "実施理由",
        "実施場所",
        "実施者",
        "特記事項",
    ]);
    for r in records {
        row(
            &mut w,
            [
                r.performed_on.clone(),
                r.total_minutes.to_string(),
                r.detail.clone(),
                r.reason.clone(),
                r.place.clone(),
                r.engineer.clone(),
                r.notes.clone(),
            ],
        );
    }
    finish(w)
}
