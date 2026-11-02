//! Argon2id password hashing (PHC string format).

use std::sync::LazyLock;

use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::Argon2;

use crate::StoreError;

/// Hashes with a fresh random 128-bit salt.
pub fn hash_password(password: &str) -> Result<String, StoreError> {
    let salt = uuid::Uuid::new_v4();
    Argon2::default()
        .hash_password_with_salt(password.as_bytes(), salt.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| StoreError::Password(e.to_string()))
}

static DUMMY_HASH: LazyLock<String> =
    LazyLock::new(|| hash_password(&uuid::Uuid::new_v4().to_string()).expect("argon2 parameters are valid"));

/// A real Argon2id hash of a random, never-stored secret, verified against when a username does not
/// exist so the full KDF cost is paid either way (no user-enumeration timing oracle).
pub fn dummy_hash() -> &'static str {
    DUMMY_HASH.as_str()
}

/// Constant-time verification; a malformed stored hash counts as a mismatch.
pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    match argon2::password_hash::phc::PasswordHash::new(stored_hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dummy_hash_is_a_valid_phc_string_that_matches_nothing() {
        let h = dummy_hash();
        assert!(h.starts_with("$argon2id$"), "{h}");
        assert!(!verify_password("", h));
        assert!(!verify_password("rgcs-dummy", h));
        assert!(std::ptr::eq(dummy_hash(), h), "computed once");
    }

    #[test]
    fn hash_round_trips_and_rejects_wrong_password() {
        let h = hash_password("admin").unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert!(verify_password("admin", &h));
        assert!(!verify_password("Admin", &h));
        assert!(!verify_password("admin", "garbage"));
    }

    #[test]
    fn salts_differ_between_hashes() {
        assert_ne!(hash_password("x").unwrap(), hash_password("x").unwrap());
    }
}
