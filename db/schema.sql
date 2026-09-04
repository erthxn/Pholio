-- Pholio database schema (Neon / Postgres)

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  platform_id     TEXT UNIQUE NOT NULL,   -- Spectrum chat/contact identifier
  name            TEXT,                   -- filled in if/when the user shares it
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scans (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address         TEXT NOT NULL,
  chain           TEXT NOT NULL,
  raw_data        JSONB NOT NULL,         -- snapshot of what the chain APIs returned
  ai_summary      TEXT NOT NULL,          -- the plain-English trading-style read
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scans_user_address ON scans (user_id, address, chain);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (user_id, created_at);
