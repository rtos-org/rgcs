//! The message log (2026-10-18): one entry per STATUSTEXT, link event,
//! command result or system notice, with a severity and an acknowledgement for alerts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

/// 重要度: icon and colour in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum Severity {
    Info,
    Ok,
    Warn,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Ok => "ok",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "info" => Self::Info,
            "ok" => Self::Ok,
            "warn" => Self::Warn,
            "error" => Self::Error,
            _ => return None,
        })
    }

    pub fn is_alert(self) -> bool {
        matches!(self, Self::Warn | Self::Error)
    }
}

/// Where an entry comes from: the vehicle (STATUSTEXT), the server's link watch, a command
/// result, or the server itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum MessageSource {
    Vehicle,
    Link,
    Command,
    System,
}

impl MessageSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Vehicle => "vehicle",
            Self::Link => "link",
            Self::Command => "command",
            Self::System => "system",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "vehicle" => Self::Vehicle,
            "link" => Self::Link,
            "command" => Self::Command,
            "system" => Self::System,
            _ => return None,
        })
    }
}

/// MAV_SEVERITY 0–3 → error, 4 → warn, 5–7 → info.
pub fn severity_of_statustext(level: u8) -> Severity {
    match level {
        0..=3 => Severity::Error,
        4 => Severity::Warn,
        _ => Severity::Info,
    }
}

/// Only the vehicle's warnings and errors (and the server's link alerts) need a 確認.
pub fn ackable(source: MessageSource, severity: Severity) -> bool {
    matches!(source, MessageSource::Vehicle | MessageSource::Link) && severity.is_alert()
}

/// One row of the message log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LogEntry {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub ts: u64,
    pub sysid: Option<SysId>,
    pub source: MessageSource,
    pub severity: Severity,
    pub text: String,
    pub ackable: bool,
    pub acked_by: Option<String>,
    #[ts(type = "number | null")]
    pub acked_at: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statustext_severity_mapping() {
        for level in 0..=3 {
            assert_eq!(severity_of_statustext(level), Severity::Error, "{level}");
        }
        assert_eq!(severity_of_statustext(4), Severity::Warn);
        for level in 5..=7 {
            assert_eq!(severity_of_statustext(level), Severity::Info, "{level}");
        }
    }

    #[test]
    fn only_vehicle_alerts_are_ackable() {
        assert!(ackable(MessageSource::Vehicle, Severity::Warn));
        assert!(ackable(MessageSource::Vehicle, Severity::Error));
        assert!(ackable(MessageSource::Link, Severity::Error));
        assert!(!ackable(MessageSource::Vehicle, Severity::Info));
        assert!(!ackable(MessageSource::Command, Severity::Error));
        assert!(!ackable(MessageSource::System, Severity::Warn));
        assert!(!ackable(MessageSource::Link, Severity::Ok));
    }

    #[test]
    fn severity_and_source_are_snake_case_on_the_wire() {
        assert_eq!(serde_json::to_string(&Severity::Warn).unwrap(), "\"warn\"");
        assert_eq!(serde_json::to_string(&MessageSource::Link).unwrap(), "\"link\"");
    }
}
