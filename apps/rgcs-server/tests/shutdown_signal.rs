//! Ruling 18 in deployment: systemd stops the service with SIGTERM, so the graceful path
//! (which sends every active ROI its speed 0) must also run on SIGTERM, not only on Ctrl-C.
//! This file is its own test binary, so the signal reaches no other test.

use std::time::Duration;

#[tokio::test]
async fn sigterm_triggers_graceful_shutdown() {
    let signal = rgcs_server::shutdown::shutdown_signal().expect("install signal handlers");
    let pid = std::process::id().to_string();
    let status = std::process::Command::new("kill")
        .args(["-TERM", &pid])
        .status()
        .expect("run kill");
    assert!(status.success());
    tokio::time::timeout(Duration::from_secs(5), signal)
        .await
        .expect("SIGTERM must resolve the shutdown future");
}
