-- NeoStream v3 database schema
-- All tables use CREATE TABLE IF NOT EXISTS — never drops existing data.

CREATE TABLE IF NOT EXISTS sessions (
  id                  SERIAL PRIMARY KEY,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  peak_viewers        INT DEFAULT 0,
  total_messages      INT DEFAULT 0,
  total_claude_calls  INT DEFAULT 0,
  total_twitch_calls  INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS viewers (
  twitch_id           TEXT PRIMARY KEY,
  username            TEXT NOT NULL,
  points              INT DEFAULT 0,
  rank                TEXT DEFAULT 'Lurker',
  broadcaster_type    TEXT DEFAULT 'none',
  is_turbo            BOOLEAN DEFAULT false,
  sub_tier            TEXT,
  is_mod              BOOLEAN DEFAULT false,
  is_vip              BOOLEAN DEFAULT false,
  stream_streak       INT DEFAULT 1,
  flagged             BOOLEAN DEFAULT false,
  realness_score      INT DEFAULT 50,
  first_seen          TIMESTAMPTZ DEFAULT NOW(),
  last_seen           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_chatters (
  session_id          INT REFERENCES sessions(id) ON DELETE CASCADE,
  viewer_id           TEXT REFERENCES viewers(twitch_id) ON DELETE CASCADE,
  message_count       INT DEFAULT 0,
  first_message_at    TIMESTAMPTZ,
  joined_at           TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS cooldowns (
  target              TEXT NOT NULL,
  type                TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (target, type)
);

CREATE TABLE IF NOT EXISTS blacklist (
  channel_name        TEXT PRIMARY KEY,
  added_at            TIMESTAMPTZ DEFAULT NOW(),
  reason              TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id                  SERIAL PRIMARY KEY,
  type                TEXT NOT NULL,
  recipient           TEXT,
  channel             TEXT,
  message             TEXT,
  sent_at             TIMESTAMPTZ DEFAULT NOW(),
  session_id          INT REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_stats (
  session_id          INT REFERENCES sessions(id) ON DELETE CASCADE,
  metric_key          TEXT NOT NULL,
  metric_value        TEXT,
  PRIMARY KEY (session_id, metric_key)
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  account_type        TEXT PRIMARY KEY,
  username            TEXT NOT NULL,
  access_token        TEXT NOT NULL,
  refresh_token       TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS flagged_users (
  twitch_id           TEXT PRIMARY KEY,
  username            TEXT NOT NULL,
  flag_count          INT DEFAULT 1,
  last_flagged_at     TIMESTAMPTZ DEFAULT NOW(),
  ignore_until        TIMESTAMPTZ,
  permanently_ignored BOOLEAN DEFAULT false,
  reason              TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id                  SERIAL PRIMARY KEY,
  viewer_id           TEXT REFERENCES viewers(twitch_id) ON DELETE CASCADE,
  session_id          INT REFERENCES sessions(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  last_message_at     TIMESTAMPTZ DEFAULT NOW(),
  exchange_count      INT DEFAULT 0,
  is_active           BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                  SERIAL PRIMARY KEY,
  conversation_id     INT REFERENCES conversations(id) ON DELETE CASCADE,
  role                TEXT NOT NULL,
  content             TEXT NOT NULL,
  sent_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_calls (
  id                  SERIAL PRIMARY KEY,
  service             TEXT NOT NULL,
  endpoint            TEXT,
  tokens_used         INT,
  cost_usd            NUMERIC(10,6),
  success             BOOLEAN DEFAULT true,
  called_at           TIMESTAMPTZ DEFAULT NOW(),
  session_id          INT REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS favorite_streamers (
  id                  SERIAL PRIMARY KEY,
  username            TEXT UNIQUE NOT NULL,
  display_name        TEXT,
  added_at            TIMESTAMPTZ DEFAULT NOW(),
  last_visited_at     TIMESTAMPTZ,
  visit_count         INT DEFAULT 0,
  priority_order      INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bot_clusters (
  id                  SERIAL PRIMARY KEY,
  detected_at         TIMESTAMPTZ DEFAULT NOW(),
  account_count       INT NOT NULL,
  account_list        JSONB NOT NULL,
  session_id          INT REFERENCES sessions(id) ON DELETE SET NULL,
  dismissed           BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS viewer_messages (
  viewer_id           TEXT REFERENCES viewers(twitch_id) ON DELETE CASCADE,
  session_id          INT REFERENCES sessions(id) ON DELETE CASCADE,
  message             TEXT NOT NULL,
  sent_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Flat exchange log used by continuity.js for conversation history
CREATE TABLE IF NOT EXISTS conversation_history (
  id             SERIAL PRIMARY KEY,
  viewer_id      TEXT NOT NULL,
  session_id     INT  NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  viewer_message TEXT NOT NULL,
  bot_reply      TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for shouldReply velocity/repeat queries (called on every message)
CREATE INDEX IF NOT EXISTS idx_convhist_viewer_session
  ON conversation_history (viewer_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_viewer_messages_viewer_session
  ON viewer_messages (viewer_id, session_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_viewer_messages_session_time
  ON viewer_messages (session_id, sent_at DESC);

-- Unique constraint on conversations so continuity.js can ON CONFLICT upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_conversations_viewer_session'
  ) THEN
    ALTER TABLE conversations
    ADD CONSTRAINT uq_conversations_viewer_session UNIQUE (viewer_id, session_id);
  END IF;
END $$;
