//! Confirm tokens for dangerous commands: issued by `POST …/confirm`, valid for
//! 30 s, bound to one vehicle and one command name, single use. Pure and immutable.

use std::collections::HashMap;

use rgcs_core::SysId;

pub const TOKEN_TTL_SECS: u64 = 30;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Pending {
    sysid: SysId,
    cmd: String,
    expires_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfirmTokens {
    pending: HashMap<String, Pending>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmError {
    Missing,
    Expired,
    Mismatch,
}

impl ConfirmTokens {
    /// Issues a token; expired tokens are dropped on the way.
    pub fn issue(&self, sysid: SysId, cmd: &str, now: u64) -> (Self, String) {
        let token = format!("{}", uuid::Uuid::new_v4().simple());
        let mut pending: HashMap<String, Pending> = self
            .pending
            .iter()
            .filter(|(_, p)| p.expires_at > now)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        pending.insert(
            token.clone(),
            Pending {
                sysid,
                cmd: cmd.to_string(),
                expires_at: now + TOKEN_TTL_SECS,
            },
        );
        (Self { pending }, token)
    }

    /// Consumes the token if it matches; it is removed whether or not it matched.
    pub fn consume(
        &self,
        token: &str,
        sysid: SysId,
        cmd: &str,
        now: u64,
    ) -> (Self, Result<(), ConfirmError>) {
        let mut pending = self.pending.clone();
        let result = match pending.remove(token) {
            None => Err(ConfirmError::Missing),
            Some(p) if p.expires_at <= now => Err(ConfirmError::Expired),
            Some(p) if p.sysid != sysid || p.cmd != cmd => Err(ConfirmError::Mismatch),
            Some(_) => Ok(()),
        };
        (Self { pending }, result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_single_use_and_bound() {
        let (c, token) = ConfirmTokens::default().issue(1, "arm", 100);
        let (c2, r) = c.consume(&token, 1, "arm", 110);
        assert_eq!(r, Ok(()));
        assert_eq!(c2.consume(&token, 1, "arm", 111).1, Err(ConfirmError::Missing));
        let (_, r) = c.consume(&token, 2, "arm", 110);
        assert_eq!(r, Err(ConfirmError::Mismatch));
        let (_, r) = c.consume(&token, 1, "rtl", 110);
        assert_eq!(r, Err(ConfirmError::Mismatch));
    }

    #[test]
    fn token_expires_after_30s() {
        let (c, token) = ConfirmTokens::default().issue(1, "arm", 100);
        assert_eq!(c.consume(&token, 1, "arm", 129).1, Ok(()));
        assert_eq!(c.consume(&token, 1, "arm", 130).1, Err(ConfirmError::Expired));
        let (c3, _) = c.issue(1, "rtl", 200);
        assert_eq!(c3.pending.len(), 1, "expired token was swept");
    }
}
