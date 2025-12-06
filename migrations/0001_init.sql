-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Accounts (platform connections)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT,
  platform_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  last_fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_platform_user ON accounts(platform, platform_user_id);

-- Account members (user <-> account many-to-many)
CREATE TABLE IF NOT EXISTS account_members (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_account ON account_members(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_account_members_user ON account_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_members_account ON account_members(account_id);

-- API keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- Rate limits per account
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  remaining INTEGER,
  limit_total INTEGER,
  reset_at TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  last_failure_at TEXT,
  circuit_open_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_account ON rate_limits(account_id);

-- Corpus snapshots (for D1 metadata storage)
CREATE TABLE IF NOT EXISTS corpus_snapshots (
  store_id TEXT NOT NULL,
  version TEXT NOT NULL,
  parents TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  invoked_at TEXT,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_key TEXT NOT NULL,
  tags TEXT,
  PRIMARY KEY (store_id, version)
);
CREATE INDEX IF NOT EXISTS idx_corpus_store_created ON corpus_snapshots(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corpus_content_hash ON corpus_snapshots(store_id, content_hash);
