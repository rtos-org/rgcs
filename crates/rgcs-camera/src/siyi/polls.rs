//! The MT11 poll schedule (Python `main.py` background loop): one tick per second.

use rgcs_core::VideoMode;

use crate::siyi::{ai, encode};

/// Wire requests due on poll `tick` (0 = the first poll after connect, then +1 per second).
/// 0x48 (SD format) is never polled; `check_allowed` refuses it anyway.
pub fn due_polls(tick: u64, video_mode: Option<VideoMode>, stream_known: bool) -> Vec<(u8, Vec<u8>)> {
    let every = |n: u64| tick % n == 0;
    let thermal = video_mode == Some(VideoMode::Thermal);
    [
        (true, 0x0A, vec![]),
        (true, 0x0D, vec![]),
        (thermal, 0x14, encode::full_frame_temp().to_vec()),
        (!stream_known || every(30), 0x20, ai::encoding_request().to_vec()),
        (every(5), 0x40, vec![]),
        (every(5), 0x51, ai::track_push(true).to_vec()),
        (every(5), 0x5F, ai::candidate_push(true).to_vec()),
        (every(10), 0x49, vec![]),
        (every(10), 0x37, vec![]),
    ]
    .into_iter()
    .filter(|(due, _, _)| *due)
    .map(|(_, cmd, data)| (cmd, data))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmds(polls: &[(u8, Vec<u8>)]) -> Vec<(u8, Vec<u8>)> {
        polls.to_vec()
    }

    #[test]
    fn tick0_has_everything_once() {
        let p = cmds(&due_polls(0, Some(VideoMode::Rgb), false));
        for want in [
            (0x0A, vec![]),
            (0x0D, vec![]),
            (0x20, vec![1]),
            (0x40, vec![]),
            (0x51, vec![1]),
            (0x5F, vec![5]),
            (0x49, vec![]),
            (0x37, vec![]),
        ] {
            assert_eq!(p.iter().filter(|c| **c == want).count(), 1, "{want:?} in {p:?}");
        }
        assert!(!p.iter().any(|(c, _)| *c == 0x14), "{p:?}");
    }

    #[test]
    fn thermal_adds_0x14_every_tick() {
        for tick in 0..12 {
            let p = due_polls(tick, Some(VideoMode::Thermal), true);
            assert!(p.contains(&(0x14, vec![1])), "tick {tick}: {p:?}");
        }
        assert!(!due_polls(3, Some(VideoMode::SideBySide), true)
            .iter()
            .any(|(c, _)| *c == 0x14));
        assert!(!due_polls(3, None, true).iter().any(|(c, _)| *c == 0x14));
    }

    #[test]
    fn encoding_polled_every_second_until_known() {
        assert!(due_polls(7, Some(VideoMode::Rgb), false).contains(&(0x20, vec![1])));
        assert!(!due_polls(7, Some(VideoMode::Rgb), true)
            .iter()
            .any(|(c, _)| *c == 0x20));
        assert!(due_polls(30, Some(VideoMode::Rgb), true).contains(&(0x20, vec![1])));
    }

    #[test]
    fn slow_polls_follow_their_period() {
        let p = due_polls(7, Some(VideoMode::Rgb), true);
        assert_eq!(p, vec![(0x0A, vec![]), (0x0D, vec![])]);
        let p5 = due_polls(5, Some(VideoMode::Rgb), true);
        assert!(p5.contains(&(0x40, vec![])) && !p5.iter().any(|(c, _)| *c == 0x49));
    }

    #[test]
    fn never_0x48() {
        for tick in 0..=120 {
            for mode in [None, Some(VideoMode::Rgb), Some(VideoMode::Thermal)] {
                for known in [false, true] {
                    assert!(!due_polls(tick, mode, known).iter().any(|(c, _)| *c == 0x48));
                }
            }
        }
    }
}
