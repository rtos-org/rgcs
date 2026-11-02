//! The signed-in user. Every command is audited under this name.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum Role {
    Operator,
    Admin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Operator {
    pub username: String,
    pub role: Role,
    /// True while the seeded `admin` / `admin` account still works.
    pub dev_mode: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_snake_case_role() {
        let op = Operator {
            username: "admin".into(),
            role: Role::Admin,
            dev_mode: true,
        };
        assert_eq!(
            serde_json::to_string(&op).unwrap(),
            r#"{"username":"admin","role":"admin","dev_mode":true}"#
        );
    }
}
