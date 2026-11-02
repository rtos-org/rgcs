//! `cargo run -p rgcs-camera --features sim --example siyi_sim -- --port 37260`
//! Runs the MT11 simulator and logs every frame it receives.

use rgcs_camera::siyi::sim::SimServer;

#[tokio::main]
async fn main() {
    let port = std::env::args()
        .skip_while(|a| a != "--port")
        .nth(1)
        .and_then(|p| p.parse().ok())
        .unwrap_or(37260u16);
    let mut sim = SimServer::start_on(port).await;
    println!("siyi-sim listening on {} (tcp+udp)", sim.addr);
    loop {
        tokio::select! {
            Some((transport, cmd, payload)) = sim.received.recv() => {
                println!("{transport:?} 0x{cmd:02X} {payload:02X?}");
            }
            _ = tokio::signal::ctrl_c() => break,
        }
    }
}
