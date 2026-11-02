//! JMA AMeDAS fetch: `latest_time.txt`, the station table (cached 24 h) and the
//! latest map file. No coordinate is ever sent: the nearest station within 30 km of each cell
//! is picked here.

use rgcs_env::{parse, SourceId};

use crate::env_fetch::{get_logged, parse_err, Fetched, Plan, AMEDAS_MAX_KM, AMEDAS_TABLE_TTL_MS};

const ID: SourceId = SourceId::JmaAmedas;

pub async fn fetch(client: &reqwest::Client, plan: Plan<'_>) -> Result<Fetched, String> {
    if plan.cells.is_empty() {
        return Err("no_location".into());
    }
    let base = &plan.endpoints.jma;
    let latest = get_logged(
        client,
        ID,
        format!("{base}/bosai/amedas/data/latest_time.txt"),
        plan.timeout,
    )
    .await?;
    let stamp = parse_err(parse::amedas_latest(&latest))?;
    let at_ms = parse::timestamp_ms(&latest).ok_or_else(|| "parse".to_string())?;
    let table = match plan.table {
        Some((fetched, t)) if plan.now_ms.saturating_sub(fetched) < AMEDAS_TABLE_TTL_MS => (fetched, t),
        _ => {
            let url = format!("{base}/bosai/amedas/const/amedastable.json");
            let body = get_logged(client, ID, url, plan.timeout).await?;
            (plan.now_ms, parse_err(parse::amedas_table(&body))?)
        }
    };
    let stations: Vec<(String, parse::Station)> = plan
        .cells
        .iter()
        .filter_map(|c| {
            let (lat, lon) = c.coords();
            parse::nearest_station(&table.1, lat, lon, AMEDAS_MAX_KM).map(|(s, _)| (c.key(), s))
        })
        .collect();
    if stations.is_empty() {
        // No station within 30 km of any cell: nothing to read here.
        return Err("no_location".into());
    }
    let url = format!("{base}/bosai/amedas/data/map/{stamp}.json");
    let map = get_logged(client, ID, url, plan.timeout).await?;
    let per_cell = stations
        .iter()
        .map(|(cell, station)| Ok((cell.clone(), parse_err(parse::amedas_map(&map, station, at_ms))?)))
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Fetched {
        per_cell,
        notes: Vec::new(),
        table: Some(table),
    })
}
