//! Joins chunked STATUSTEXT (MAVLink 2 extensions `id` / `chunk_seq`). ArduPilot splits long
//! texts into 50-byte chunks sharing an `id`; the chunk that does not fill all 50 bytes ends
//! the message. `id == 0` is never chunked. Stale partials flush after 1 s, joined length is
//! capped at [`MAX_CHUNKS`].

use rgcs_core::SysId;

pub const CHUNK_LEN: usize = 50;
pub const FLUSH_AFTER_MS: u64 = 1_000;
/// A joined message never exceeds this many chunks; the cap emits it (bounded memory).
pub const MAX_CHUNKS: usize = 32;
/// Partials held at once; beyond this the oldest is emitted as-is (bounded memory per link).
pub const MAX_PARTIALS: usize = 16;

/// A chunk that uses every byte of the 50-byte wire field means "more follows".
pub fn is_full_chunk(wire: &[u8]) -> bool {
    wire.len() >= CHUNK_LEN && wire[..CHUNK_LEN].iter().all(|b| *b != 0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Complete {
    pub sysid: SysId,
    pub severity: u8,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Chunk {
    seq: u8,
    text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Partial {
    sysid: SysId,
    id: u16,
    severity: u8,
    chunks: Vec<Chunk>,
    /// Set once by the first chunk; appends never postpone the flush.
    started_ms: u64,
    /// The end chunk (shorter than 50 bytes) has arrived; we only wait for missing seqs.
    ended: bool,
}

impl Partial {
    fn complete(self) -> Complete {
        let mut chunks = self.chunks;
        chunks.sort_by_key(|c| c.seq);
        Complete {
            sysid: self.sysid,
            severity: self.severity,
            text: chunks.into_iter().map(|c| c.text).collect(),
        }
    }

    /// Every seq from 0 to the end chunk is present.
    fn is_whole(&self) -> bool {
        self.ended && {
            let max = self.chunks.iter().map(|c| c.seq).max().unwrap_or(0) as usize;
            self.chunks.len() == max + 1
        }
    }
}

/// Immutable joiner keyed by `(sysid, id)`; every call returns the next state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Joiner {
    partials: Vec<Partial>,
}

impl Joiner {
    /// `raw` is the chunk's text with trailing NULs removed; `full` is whether the wire chunk
    /// used all 50 bytes (`id == 0` messages are never chunked and complete at once).
    #[allow(clippy::too_many_arguments)]
    pub fn push(
        &self,
        sysid: SysId,
        severity: u8,
        raw: &str,
        id: u16,
        chunk_seq: u8,
        full: bool,
        now_ms: u64,
    ) -> (Self, Option<Complete>) {
        if id == 0 {
            let done = Complete {
                sysid,
                severity,
                text: raw.to_string(),
            };
            return (self.clone(), Some(done));
        }
        let (kept, prev): (Vec<Partial>, Vec<Partial>) = self
            .partials
            .iter()
            .cloned()
            .partition(|p| !(p.sysid == sysid && p.id == id));
        let mut partial = prev.into_iter().next().unwrap_or(Partial {
            sysid,
            id,
            severity,
            chunks: Vec::new(),
            started_ms: now_ms,
            ended: false,
        });
        if partial.chunks.iter().all(|c| c.seq != chunk_seq) {
            partial.chunks.push(Chunk {
                seq: chunk_seq,
                text: raw.to_string(),
            });
        }
        partial.ended |= !full;
        if partial.is_whole() || partial.chunks.len() >= MAX_CHUNKS {
            return (Self { partials: kept }, Some(partial.complete()));
        }
        let mut partials = kept;
        let evicted = if partials.len() >= MAX_PARTIALS {
            let oldest = partials
                .iter()
                .enumerate()
                .min_by_key(|(_, p)| p.started_ms)
                .map(|(i, _)| i)
                .expect("non-empty");
            Some(partials.remove(oldest).complete())
        } else {
            None
        };
        partials.push(partial);
        (Self { partials }, evicted)
    }

    /// Emits partials older than [`FLUSH_AFTER_MS`] with whatever chunks arrived (in seq order).
    pub fn flush(&self, now_ms: u64) -> (Self, Vec<Complete>) {
        let (stale, fresh): (Vec<Partial>, Vec<Partial>) = self
            .partials
            .iter()
            .cloned()
            .partition(|p| now_ms.saturating_sub(p.started_ms) >= FLUSH_AFTER_MS);
        let done = stale.into_iter().map(Partial::complete).collect();
        (Self { partials: fresh }, done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push(j: &Joiner, id: u16, seq: u8, text: &str, full: bool, now: u64) -> (Joiner, Option<Complete>) {
        j.push(1, 6, text, id, seq, full, now)
    }

    #[test]
    fn id_zero_completes_immediately_even_when_it_fills_the_chunk() {
        let fifty = "A".repeat(CHUNK_LEN);
        let (j, out) = push(&Joiner::default(), 0, 0, &fifty, true, 0);
        assert_eq!(j, Joiner::default());
        assert_eq!(out.map(|c| c.text), Some(fifty));
        let (_, out) = push(&Joiner::default(), 0, 0, "PreArm: Compass", false, 0);
        assert_eq!(out.map(|c| c.text), Some("PreArm: Compass".into()));
    }

    #[test]
    fn chunks_with_the_same_id_join_in_sequence_order() {
        let head = "B".repeat(CHUNK_LEN);
        let (j, out) = push(&Joiner::default(), 7, 1, " tail", false, 5);
        assert_eq!(out, None, "the end chunk arrived first: wait for seq 0");
        let (j2, out) = push(&j, 7, 0, &head, true, 10);
        assert_eq!(out.map(|c| c.text), Some(format!("{head} tail")));
        assert_eq!(j2, Joiner::default());
        assert_eq!(j.partials.len(), 1, "push does not mutate the previous value");
    }

    #[test]
    fn different_ids_and_vehicles_never_mix() {
        let a = "C".repeat(CHUNK_LEN);
        let b = "D".repeat(CHUNK_LEN);
        let (j, _) = push(&Joiner::default(), 1, 0, &a, true, 0);
        let (j, _) = push(&j, 2, 0, &b, true, 1);
        let (j, out) = j.push(2, 6, "other vehicle", 1, 0, true, 2);
        assert_eq!(out, None);
        let (j, out) = push(&j, 2, 1, " end-b", false, 3);
        assert_eq!(out.map(|c| c.text), Some(format!("{b} end-b")));
        let (j, out) = push(&j, 1, 1, " end-a", false, 4);
        assert_eq!(out.map(|c| c.text), Some(format!("{a} end-a")));
        assert_eq!(j.partials.len(), 1, "vehicle 2's partial is still waiting");
    }

    #[test]
    fn stale_partial_flushes_after_one_second_from_its_first_chunk() {
        let chunk = "E".repeat(CHUNK_LEN);
        let (j, _) = push(&Joiner::default(), 9, 0, &chunk, true, 0);
        let (j, _) = push(&j, 9, 1, &chunk, true, 900);
        let (j, out) = j.flush(999);
        assert!(out.is_empty());
        let (j, out) = j.flush(1_000);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text.len(), 2 * CHUNK_LEN);
        assert_eq!(j, Joiner::default());
    }

    #[test]
    fn a_stream_of_full_chunks_is_capped() {
        let chunk = "F".repeat(CHUNK_LEN);
        let mut j = Joiner::default();
        let mut done = None;
        for i in 0..MAX_CHUNKS + 5 {
            let (next, out) = push(&j, 3, i as u8, &chunk, true, i as u64);
            j = next;
            if let Some(c) = out {
                done = Some((i, c));
                break;
            }
        }
        let (at, c) = done.expect("the cap emits the message");
        assert_eq!(at + 1, MAX_CHUNKS);
        assert_eq!(c.text.len(), MAX_CHUNKS * CHUNK_LEN);
    }

    #[test]
    fn concurrent_partials_are_bounded_and_the_oldest_is_emitted() {
        let chunk = "G".repeat(CHUNK_LEN);
        let mut j = Joiner::default();
        let mut emitted = Vec::new();
        for id in 1..=(MAX_PARTIALS as u16 + 3) {
            let (next, out) = push(&j, id, 0, &chunk, true, id as u64);
            j = next;
            emitted.extend(out);
        }
        assert_eq!(j.partials.len(), MAX_PARTIALS);
        assert_eq!(emitted.len(), 3, "the oldest partials were flushed to make room");
        assert_eq!(emitted[0].text, chunk);
    }

    #[test]
    fn duplicate_chunk_seq_is_ignored() {
        let chunk = "H".repeat(CHUNK_LEN);
        let (j, _) = push(&Joiner::default(), 5, 0, &chunk, true, 0);
        let (j, out) = push(&j, 5, 0, &chunk, true, 1);
        assert_eq!(out, None);
        assert_eq!(j.partials[0].chunks.len(), 1);
        let (_, out) = push(&j, 5, 1, " end", false, 2);
        assert_eq!(out.map(|c| c.text), Some(format!("{chunk} end")));
    }

    #[test]
    fn fullness_is_decided_on_the_wire_bytes() {
        assert!(is_full_chunk(&[b'A'; CHUNK_LEN]));
        let mut padded = [b'A'; CHUNK_LEN];
        padded[CHUNK_LEN - 1] = 0;
        assert!(!is_full_chunk(&padded));
        assert!(!is_full_chunk(&[b'A'; 10]));
    }
}
