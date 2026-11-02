//! Wire frames: `55 66 | ctrl | len LE | seq LE | cmd | data | crc16 LE` (CRC-16/CCITT, init 0).

use crate::CameraError;

pub const HEADER: [u8; 2] = [0x55, 0x66];
/// Bytes before `data`: header 2 + ctrl 1 + len 2 + seq 2 + cmd 1; plus crc 2 after it.
pub const OVERHEAD: usize = 10;
/// 0x48 formats the SD card; it is refused at the lowest layer of both transports.
pub const FORBIDDEN_CMDS: &[u8] = &[0x48];

pub fn check_allowed(cmd: u8) -> Result<(), CameraError> {
    if FORBIDDEN_CMDS.contains(&cmd) {
        Err(CameraError::Forbidden(cmd))
    } else {
        Ok(())
    }
}

/// CRC-16/CCITT, polynomial 0x1021, initial value 0, no reflection.
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    data.iter().fold(0u16, |crc, byte| {
        let mut crc = crc ^ (u16::from(*byte) << 8);
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
        crc
    })
}

pub fn make_packet(cmd: u8, data: &[u8], ctrl: u8, seq: u16) -> Vec<u8> {
    let mut packet = Vec::with_capacity(OVERHEAD + data.len());
    packet.extend_from_slice(&HEADER);
    packet.push(ctrl);
    packet.extend_from_slice(&(data.len() as u16).to_le_bytes());
    packet.extend_from_slice(&seq.to_le_bytes());
    packet.push(cmd);
    packet.extend_from_slice(data);
    let crc = crc16_ccitt(&packet);
    packet.extend_from_slice(&crc.to_le_bytes());
    packet
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub cmd: u8,
    pub payload: Vec<u8>,
}

/// Incremental receive parser: resyncs on `55 66`, waits for whole frames, drops bad CRCs.
#[derive(Debug, Default)]
pub struct Parser {
    buf: Vec<u8>,
}

impl Parser {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Frame> {
        self.buf.extend_from_slice(bytes);
        let mut frames = Vec::new();
        loop {
            let Some(start) = self.buf.windows(2).position(|w| w == HEADER) else {
                self.buf.clear();
                return frames;
            };
            if start > 0 {
                self.buf.drain(..start);
            }
            if self.buf.len() < OVERHEAD {
                return frames;
            }
            let data_len = u16::from_le_bytes([self.buf[3], self.buf[4]]) as usize;
            let frame_len = OVERHEAD + data_len;
            if self.buf.len() < frame_len {
                return frames;
            }
            let frame: Vec<u8> = self.buf.drain(..frame_len).collect();
            let expected = u16::from_le_bytes([frame[frame_len - 2], frame[frame_len - 1]]);
            if crc16_ccitt(&frame[..frame_len - 2]) != expected {
                continue;
            }
            frames.push(Frame {
                cmd: frame[7],
                payload: frame[8..frame_len - 2].to_vec(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::siyi::encode::gimbal_angle;
    use crate::CameraError;

    fn hex(s: &str) -> Vec<u8> {
        s.split_whitespace()
            .map(|b| u8::from_str_radix(b, 16).unwrap())
            .collect()
    }

    #[test]
    fn packet_matches_sdk_example_yaw30_pitch20() {
        assert_eq!(
            make_packet(0x0E, &gimbal_angle(30.0, 20.0), 1, 0),
            hex("55 66 01 04 00 00 00 0E 2C 01 C8 00 59 17")
        );
    }

    #[test]
    fn packet_matches_sdk_example_yaw0_pitch_minus90() {
        assert_eq!(
            make_packet(0x0E, &gimbal_angle(0.0, -90.0), 1, 0),
            hex("55 66 01 04 00 00 00 0E 00 00 7C FC 4F A4")
        );
    }

    #[test]
    fn parser_splits_two_frames_and_skips_garbage() {
        let mut bytes = b"zz".to_vec();
        bytes.extend(make_packet(0x5F, &[5, 0, 1, 2], 1, 1));
        bytes.extend(make_packet(0x5F, &[5, 0], 1, 2));
        let mut p = Parser::default();
        let frames = p.push(&bytes);
        assert_eq!(frames.len(), 2);
        assert_eq!((frames[0].cmd, frames[0].payload.len()), (0x5F, 4));
        assert_eq!((frames[1].cmd, frames[1].payload.len()), (0x5F, 2));
    }

    #[test]
    fn parser_drops_bad_crc_and_resyncs() {
        let mut bad = make_packet(0x0D, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1, 1);
        bad[9] ^= 0xFF;
        let mut bytes = bad;
        bytes.extend(make_packet(0x19, &[1], 1, 2));
        let frames = Parser::default().push(&bytes);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].cmd, 0x19);
    }

    #[test]
    fn parser_waits_for_a_partial_frame() {
        let packet = make_packet(0x18, &[2, 5], 1, 3);
        let mut p = Parser::default();
        assert!(p.push(&packet[..7]).is_empty());
        let frames = p.push(&packet[7..]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].payload, vec![2, 5]);
    }

    #[test]
    fn format_sd_is_refused() {
        assert_eq!(check_allowed(0x48), Err(CameraError::Forbidden(0x48)));
        assert!(check_allowed(0x49).is_ok());
        assert_eq!(FORBIDDEN_CMDS, &[0x48]);
    }
}
