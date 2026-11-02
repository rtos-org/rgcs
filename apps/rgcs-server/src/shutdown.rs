//! Process shutdown trigger for `axum::serve(..).with_graceful_shutdown`.
//!
//! Ruling 18: the graceful path ends every active ROI with speed 0. systemd stops the
//! service with SIGTERM (no `KillSignal=` in the unit), so SIGTERM must take that path as
//! well as Ctrl-C / SIGINT.

use std::future::Future;

use tracing::info;

/// Install the handlers now (so a signal raised right after this returns is caught) and
/// return a future that resolves on the first SIGINT or SIGTERM.
pub fn shutdown_signal() -> std::io::Result<impl Future<Output = ()>> {
    #[cfg(unix)]
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    Ok(async move {
        #[cfg(unix)]
        tokio::select! {
            _ = tokio::signal::ctrl_c() => info!("SIGINT: shutting down"),
            _ = term.recv() => info!("SIGTERM: shutting down"),
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
            info!("shutting down");
        }
    })
}
