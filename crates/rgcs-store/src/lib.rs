//! SQLite persistence: users / sessions / audit log / settings. `Store` is cheap to
//! clone (it wraps a connection pool) and every method takes `&self`.

pub mod app_settings;
pub mod assignments;
pub mod audit;
pub mod calibrations;
pub mod camera_profiles;
pub mod env_sources;
pub mod flight_logs;
pub mod flights;
pub mod guard;
pub mod input_profile;
pub mod inspections;
pub mod lockout;
pub mod maintenance;
pub mod messages;
pub mod missions;
pub mod overlay_areas;
pub mod param_history;
pub mod password;
pub mod plugin_state;
pub mod presentation;
pub mod registry;
pub mod roi;
pub mod sessions;
pub mod survey_cameras;
pub mod users;

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub use audit::AuditEntry;
pub use lockout::Lockout;
pub use presentation::PresentationToken;
pub use users::UserRow;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("password hashing error: {0}")]
    Password(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid stored data: {0}")]
    Invalid(String),
    #[error("not found: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    /// Closes the pool (shutdown; tests use it to make every write fail).
    pub async fn close(&self) {
        self.pool.close().await;
    }

    /// Opens (creating if needed) the database file, runs migrations and seeds the dev account.
    pub async fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .foreign_keys(true);
        Self::connect(opts, 4).await
    }

    /// Private in-memory database (tests).
    pub async fn open_memory() -> Result<Self> {
        let opts = SqliteConnectOptions::new()
            .filename(":memory:")
            .foreign_keys(true);
        Self::connect(opts, 1).await
    }

    async fn connect(opts: SqliteConnectOptions, max: u32) -> Result<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max)
            .connect_with(opts)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        let store = Self { pool };
        store.seed_dev_admin().await?;
        Ok(store)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

/// Current time as RFC 3339 UTC, the format every `ts` column uses.
pub fn now_iso() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

/// Unix milliseconds (INTEGER timestamp columns of the P3+ tables).
pub fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// RFC 3339 for a given instant (tests and expiries).
pub fn iso(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap_or_default()
}
