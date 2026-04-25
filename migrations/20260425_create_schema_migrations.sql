-- Versioned migration tracking table.
-- The migration runner (scripts/migrate.js) inserts one row per applied .sql file.
CREATE TABLE IF NOT EXISTS schema_migrations_180 (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
    ON schema_migrations_180 (applied_at DESC);
