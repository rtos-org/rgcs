#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CameraError {
    /// 0x48 (SD format) is never sent.
    #[error("command 0x{0:02X} is forbidden")]
    Forbidden(u8),
    #[error("{0} is not supported by this camera")]
    Unsupported(&'static str),
    /// A precondition failed; the code maps to `409 {code}` (rgb_only, stream_unknown, ...).
    #[error("refused: {0}")]
    Refused(&'static str),
    #[error("camera is not connected")]
    NotConnected,
    #[error("io: {0}")]
    Io(String),
    #[error("protocol: {0}")]
    Protocol(String),
}
