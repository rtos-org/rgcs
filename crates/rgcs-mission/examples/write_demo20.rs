//! Regenerates the golden fixture: `cargo run -p rgcs-mission --example write_demo20 > crates/rgcs-mission/tests/fixtures/demo20.waypoints`
fn main() {
    print!("{}", rgcs_mission::to_wpl(&rgcs_core::demo20()));
}
