//! Login lockout: 5 failures within the window lock a username for 60 s.
//! Pure and immutable; the caller supplies the clock (monotonic seconds).

use std::collections::HashMap;

pub const MAX_FAILURES: u32 = 5;
pub const LOCK_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Entry {
    failures: u32,
    locked_until: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Lockout {
    entries: HashMap<String, Entry>,
}

impl Lockout {
    /// Seconds remaining on the lock, if the user is locked at `now`.
    pub fn locked_for(&self, user: &str, now: u64) -> Option<u64> {
        self.entries
            .get(user)
            .and_then(|e| e.locked_until)
            .filter(|until| *until > now)
            .map(|until| until - now)
    }

    /// Records a failed attempt; the 5th failure starts the lock.
    pub fn fail(&self, user: &str, now: u64) -> Self {
        let prev = self.entries.get(user).copied().unwrap_or(Entry {
            failures: 0,
            locked_until: None,
        });
        let expired = prev.locked_until.is_some_and(|u| u <= now);
        let failures = if expired { 1 } else { prev.failures + 1 };
        let locked_until = if failures >= MAX_FAILURES {
            Some(now + LOCK_SECS)
        } else {
            None
        };
        let mut entries = self.entries.clone();
        entries.insert(
            user.to_string(),
            Entry {
                failures,
                locked_until,
            },
        );
        Self { entries }
    }

    /// A successful login clears the counter.
    pub fn succeed(&self, user: &str) -> Self {
        let mut entries = self.entries.clone();
        entries.remove(user);
        Self { entries }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifth_failure_locks_for_sixty_seconds() {
        let mut l = Lockout::default();
        for i in 0..4 {
            l = l.fail("admin", 10 + i);
            assert_eq!(l.locked_for("admin", 10 + i), None);
        }
        l = l.fail("admin", 20);
        assert_eq!(l.locked_for("admin", 20), Some(60));
        assert_eq!(l.locked_for("admin", 79), Some(1));
        assert_eq!(l.locked_for("admin", 80), None);
        assert_eq!(l.locked_for("other", 20), None);
    }

    #[test]
    fn success_resets_and_expired_lock_restarts_the_count() {
        let l = Lockout::default().fail("a", 0).fail("a", 1).succeed("a");
        assert_eq!(l, Lockout::default());
        let mut l = Lockout::default();
        for i in 0..5 {
            l = l.fail("a", i);
        }
        let l = l.fail("a", 100);
        assert_eq!(l.locked_for("a", 100), None);
    }
}
