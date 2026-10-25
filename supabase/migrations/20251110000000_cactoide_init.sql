-- Tofu (new file, 2026-10-25): Cactoide's schema for Tofu's managed PostgreSQL (see TOFU.md, Schema).
--
-- A copy of upstream's database/init.sql as of upstream commit 7a07d7439ff87eb5dfa9c8ad3787646c764693f3 (that file's
-- last change, 2025-11-10, gives this file its version), with three changes:
--   * no BEGIN/COMMIT: whatever applies this file (scripts/tofu-migrate.mjs at build, Tofu, or the Supabase CLI) runs
--     it in one transaction of its own, together with its record in the migration ledger;
--   * no CREATE EXTENSION pgcrypto: gen_random_uuid() is built into PostgreSQL 13 and later;
--   * row-level security is turned on for every table, with no policy. The app reads and writes over its own
--     connection (DATABASE_URL), which owns the tables and is not limited by it; these lines keep anyone holding the
--     database's public key (Supabase's Data API) from every row. Keep them, and give any new table the same line.
-- database/init.sql is unchanged, for upstream's docker-compose setup.

-- =======================================
-- Tables
-- =======================================

-- Events
CREATE TABLE IF NOT EXISTS events (
    id              VARCHAR(8) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    date            DATE NOT NULL,
    time            TIME NOT NULL,
    location        VARCHAR(200) NOT NULL,
    location_type   VARCHAR(20) NOT NULL DEFAULT 'none' CHECK (location_type IN ('none','text','maps')),
    location_url    VARCHAR(500),
    type            VARCHAR(20) NOT NULL CHECK (type IN ('limited','unlimited')),
    attendee_limit  INTEGER CHECK (attendee_limit > 0),
    user_id         VARCHAR(100) NOT NULL,
    visibility      VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private', 'invite-only')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RSVPs
CREATE TABLE IF NOT EXISTS rsvps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    VARCHAR(8) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    user_id     VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Invite tokens
CREATE TABLE IF NOT EXISTS invite_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    VARCHAR(8) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    token       VARCHAR(32) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- Indexes
-- =======================================
CREATE INDEX IF NOT EXISTS idx_events_user_id  ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_date     ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_location_type ON events(location_type);
CREATE INDEX IF NOT EXISTS idx_rsvps_event_id  ON rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_user_id   ON rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_event_id ON invite_tokens(event_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_expires_at ON invite_tokens(expires_at);

-- =======================================
-- Row-level security (Tofu)
-- =======================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;
