//! `rgcs-server` binary: load `config.toml`, start the MAVLink link, the command queue and
//! the telemetry pumps, then serve the API and UI.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use rgcs_mavlink::{LinkChannels, LinkUrl, Router};
use rgcs_store::Store;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::info;
use tracing_subscriber::EnvFilter;

use rgcs_server::app::{self, AppState, BROADCAST_CAPACITY};
use rgcs_server::config::{self, Config};
use rgcs_server::telemetry;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if matches!(std::env::args().nth(1).as_deref(), Some("--version" | "-V")) {
        println!(
            "rgcs-server {} ({})",
            env!("CARGO_PKG_VERSION"),
            rgcs_server::BUILD
        );
        return Ok(());
    }
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let config_path = std::env::var("RGCS_CONFIG").unwrap_or_else(|_| config::DEFAULT_PATH.into());
    let config = Config::load(Path::new(&config_path))?;
    let link: LinkUrl = config
        .mavlink_url
        .parse()
        .map_err(|e| anyhow::anyhow!("mavlink_url: {e}"))?;
    info!(config = %config_path, listen = %config.listen, link = %link, "starting rgcs-server");

    let store = Store::open(&config.data_dir.join("rgcs.db")).await?;
    let dev_mode = store.dev_mode().await?;
    if dev_mode {
        tracing::warn!("development login admin/admin is active");
    }
    // Plugin overlays: a fetch cut off by the last shutdown is not running any more.
    match store.reset_interrupted_area_fetches().await {
        Ok(0) => {}
        Ok(n) => info!(areas = n, "reset interrupted overlay fetches"),
        Err(e) => tracing::warn!(error = %e, "overlay fetch reset failed"),
    }
    // Plugins: read once; a broken one is listed with its error and never stops the start.
    let plugins_dir = config.plugins_dir();
    let plugins = rgcs_server::plugins::PluginRegistry::scan(&plugins_dir)
        .with_enabled(store.plugin_enabled().await.unwrap_or_default());
    info!(dir = %plugins_dir.display(), plugins = plugins.infos().len(), "plugins scanned");

    let router = Arc::new(Mutex::new(Router::default()));
    let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let (events_tx, events_rx) = mpsc::channel(256);
    let (outgoing_tx, outgoing_rx) = mpsc::channel(64);
    let (acks_tx, _) = broadcast::channel(64);
    let (payload_tx, _) = broadcast::channel(rgcs_mavlink::port::PAYLOAD_CAPACITY);
    // AI guard telemetry tap (lossy, GuardHub subscribes).
    let (guard_tx, _) = broadcast::channel(rgcs_mavlink::GUARD_CAPACITY);
    let (queue_tx, queue_rx) = mpsc::channel(32);
    let gcs_sysid = rgcs_server::settings::load_gcs_sysid(&store).await;
    // The camera driver rides the FC link : clone before the moves below.
    let mav_port = rgcs_mavlink::MavPort::new(outgoing_tx.clone(), acks_tx.clone(), payload_tx.clone());
    let state = AppState::new(router.clone(), tx.clone(), store, queue_tx, dev_mode)
        .with_outgoing(outgoing_tx.clone())
        .with_mav_port(mav_port)
        .with_map(config.map_tile_url.clone(), config.map_attribution.clone())
        .with_basemaps(config.basemaps())
        .with_terrain(config.terrain())
        .with_plugins(plugins)
        .with_whep_upstream(&config.whep_upstream)
        .with_data_dir(config.data_dir.clone())
        .with_ai(rgcs_server::ai_api::build_ai(&config.ai))
        .with_log_fetch(config.log_fetch_enabled())
        .with_network(rgcs_server::network::NetworkConfig {
            listen: config.listen,
            mavlink_url: config.mavlink_url.clone(),
            role: config.role,
        })
        .with_video_timings(rgcs_video::Timings {
            timeout: Duration::from_millis(config.video_probe_timeout_ms),
            ..rgcs_video::Timings::default()
        });
    // 外的要因: configured hosts (or `[env.endpoints]` overrides); keys from env vars only.
    let env_endpoints = config
        .env
        .endpoints
        .apply(rgcs_server::env_fetch::EnvEndpoints::real());
    let env_keys = rgcs_server::env_fetch::EnvKeys::resolve(&config.env, &|name| std::env::var(name).ok());
    let env = rgcs_server::env_hub::EnvHub::new(env_endpoints, env_keys, tx.clone(), state.guard.clone());
    let state = state.with_env(env);
    state.gcs.set(gcs_sysid);
    // AI 緊急介入: stored settings (off by default), then subscribe before `guard_tx` moves.
    state
        .guard
        .apply_settings(rgcs_server::guard_settings::load(&state.store).await);
    state.guard.spawn(state.clone(), guard_tx.subscribe());
    // Fetches nothing external until the guard is enabled with consent 2.
    state.env.load(&state.store).await;
    state.env.spawn(state.clone(), guard_tx.subscribe());
    let channels = LinkChannels {
        events: events_tx,
        outgoing: outgoing_rx,
        acks: acks_tx.clone(),
        gcs: state.gcs.clone(),
        inspector: state.inspector.clone(),
        payload: payload_tx,
        stats: state.link_stats.clone(),
        guard: guard_tx,
    };
    tokio::spawn(rgcs_mavlink::run_link(link, router.clone(), channels));
    tokio::spawn(rgcs_mavlink::run_queue(queue_rx, outgoing_tx, acks_tx));
    tokio::spawn(telemetry::pump_events(
        events_rx,
        tx.clone(),
        telemetry::EventSinks::of(&state),
    ));
    tokio::spawn(state.missions.clone().resend_loop());
    tokio::spawn(state.flights.clone().run(router.clone()));
    tokio::spawn(rgcs_server::message_log::run_recorder(
        state.messages.clone(),
        tx.subscribe(),
    ));
    tokio::spawn(telemetry::diff_loop(
        router.clone(),
        tx.clone(),
        Duration::from_millis(config.telemetry_interval_ms.max(20)),
    ));

    state.media.spawn(&config.whep_upstream);
    tokio::spawn(rgcs_server::network::run_status(
        state.clone(),
        Duration::from_secs(1),
    ));
    state.bring_up_configured().await;
    state.spawn_background();
    let roi = state.roi.clone();
    let app = app::build(state, config.ui_dir.clone());
    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    let shutdown = rgcs_server::shutdown::shutdown_signal()?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await?;
    // Ruling 18: every active ROI ends with speed 0 before the process exits.
    roi.shutdown_all().await;
    Ok(())
}
