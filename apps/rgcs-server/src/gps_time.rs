//! The clock-sync GPS source: the router's newest FC `SYSTEM_TIME` for a vehicle,
//! aged against the link's wall clock.

use std::sync::Arc;

use async_trait::async_trait;
use rgcs_camera::camera::{GpsTime, TimeSample};
use rgcs_core::SysId;
use rgcs_mavlink::{Router, SystemTimeSample};
use tokio::sync::Mutex;

use crate::cameras::GpsTimeFactory;

pub struct RouterGpsTime {
    router: Arc<Mutex<Router>>,
    sysid: SysId,
}

impl RouterGpsTime {
    pub fn new(router: Arc<Mutex<Router>>, sysid: SysId) -> Self {
        Self { router, sysid }
    }
}

/// The factory `CameraManager::set_gps_time` installs: one source per vehicle.
pub fn factory(router: Arc<Mutex<Router>>) -> GpsTimeFactory {
    Arc::new(move |sysid| Arc::new(RouterGpsTime::new(router.clone(), sysid)) as Arc<dyn GpsTime>)
}

/// The sample aged at wall time `now_ms`; a sample from the future (a wall-clock step) is `None`.
pub fn aged(s: SystemTimeSample, now_ms: u64) -> Option<TimeSample> {
    let age_ms = now_ms.checked_sub(s.received_unix_ms)?;
    Some(TimeSample {
        unix_us: s.unix_us,
        age_us: age_ms.saturating_mul(1000),
    })
}

#[async_trait]
impl GpsTime for RouterGpsTime {
    async fn sample(&self) -> Option<TimeSample> {
        let s = self.router.lock().await.system_time(self.sysid)?;
        aged(s, crate::app::unix_ms())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        MavAutopilot, MavMessage, MavType, HEARTBEAT_DATA, SYSTEM_TIME_DATA,
    };
    use mavlink::MavHeader;
    use rgcs_mavlink::Clock;

    const UNIX_US: u64 = 1_790_000_000_000_000;

    fn router_with_time(received_unix_ms: u64) -> Arc<Mutex<Router>> {
        let header = MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 0,
        };
        let hb = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            ..HEARTBEAT_DATA::DEFAULT
        });
        let t = MavMessage::SYSTEM_TIME(SYSTEM_TIME_DATA {
            time_unix_usec: UNIX_US,
            ..SYSTEM_TIME_DATA::DEFAULT
        });
        let clock = Clock {
            mono_ms: 0,
            unix_ms: received_unix_ms,
        };
        let mut r = Router::default();
        r.on_message(&header, &hb, clock);
        r.on_message(&header, &t, clock);
        Arc::new(Mutex::new(r))
    }

    #[tokio::test]
    async fn sample_is_aged_by_the_wall_clock() {
        let src = RouterGpsTime::new(router_with_time(crate::app::unix_ms() - 300), 1);
        let s = src.sample().await.expect("sample");
        assert_eq!(s.unix_us, UNIX_US);
        assert!((250_000..=350_000).contains(&s.age_us), "age {}", s.age_us);
    }

    #[tokio::test]
    async fn future_sample_and_unknown_vehicle_are_none() {
        let router = router_with_time(crate::app::unix_ms() + 60_000);
        assert_eq!(RouterGpsTime::new(router.clone(), 1).sample().await, None);
        assert_eq!(RouterGpsTime::new(router, 2).sample().await, None);
    }
}
