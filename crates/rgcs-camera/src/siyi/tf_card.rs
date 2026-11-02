//! MT11 TF (microSD) card information, CMD 0x49 reply.

use rgcs_core::{StorageInfo, StorageStatus};

fn status_of(code: u8) -> StorageStatus {
    match code {
        0 => StorageStatus::NotInserted,
        1 => StorageStatus::MountFailed,
        2 => StorageStatus::Ok,
        3 => StorageStatus::LowSpace,
        4 => StorageStatus::ReadOnly,
        5 => StorageStatus::ReadError,
        _ => StorageStatus::Unknown,
    }
}

fn fs_name(code: u8) -> String {
    match code {
        0 => "unknown".into(),
        1 => "FAT32".into(),
        2 => "exFAT".into(),
        n => format!("fs_{n}"),
    }
}

/// Status (u8), file system (u8), total (u16, GB x100), available (u16, GB x100).
pub fn parse_tf_card(p: &[u8]) -> Option<StorageInfo> {
    if p.len() < 6 {
        return None;
    }
    let total = u16::from_le_bytes([p[2], p[3]]);
    let free = u16::from_le_bytes([p[4], p[5]]);
    let free_pct = (total > 0).then(|| (f32::from(free) / f32::from(total) * 1000.0).round() / 10.0);
    Some(StorageInfo {
        status: status_of(p[0]),
        fs: fs_name(p[1]),
        total_gb: f32::from(total) / 100.0,
        free_gb: f32::from(free) / 100.0,
        free_pct,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CameraError;
    use crate::siyi::frame::check_allowed;
    use rgcs_core::StorageStatus;

    fn payload(status: u8, fs: u8, total: u16, free: u16) -> Vec<u8> {
        let mut p = vec![status, fs];
        p.extend(total.to_le_bytes());
        p.extend(free.to_le_bytes());
        p
    }

    #[test]
    fn tf_card_normal() {
        let i = parse_tf_card(&payload(2, 2, 5820, 1234)).unwrap();
        assert_eq!(i.status, StorageStatus::Ok);
        assert_eq!(i.fs, "exFAT");
        assert_eq!(i.total_gb, 58.2);
        assert_eq!(i.free_gb, 12.34);
        assert_eq!(i.free_pct, Some(21.2));
    }

    #[test]
    fn tf_card_status_codes() {
        let cases = [
            (0, StorageStatus::NotInserted),
            (1, StorageStatus::MountFailed),
            (3, StorageStatus::LowSpace),
            (4, StorageStatus::ReadOnly),
            (5, StorageStatus::ReadError),
            (9, StorageStatus::Unknown),
        ];
        for (code, want) in cases {
            assert_eq!(parse_tf_card(&payload(code, 0, 100, 50)).unwrap().status, want);
        }
        assert_eq!(parse_tf_card(&payload(2, 0, 1, 1)).unwrap().fs, "unknown");
        assert_eq!(parse_tf_card(&payload(2, 7, 1, 1)).unwrap().fs, "fs_7");
    }

    #[test]
    fn tf_card_zero_total_has_no_pct() {
        assert_eq!(parse_tf_card(&payload(0, 0, 0, 0)).unwrap().free_pct, None);
    }

    #[test]
    fn tf_card_short_payload() {
        assert_eq!(parse_tf_card(&[2, 2, 0, 0, 0]), None);
    }

    #[test]
    fn tf_card_32gb() {
        let i = parse_tf_card(&payload(2, 1, 3200, 800)).unwrap();
        assert_eq!((i.fs.as_str(), i.total_gb, i.free_gb), ("FAT32", 32.0, 8.0));
    }

    #[test]
    fn sd_info_is_0x49_never_0x48() {
        assert!(check_allowed(0x49).is_ok());
        assert_eq!(check_allowed(0x48), Err(CameraError::Forbidden(0x48)));
    }
}
