-- GPBS Storage — Polish worker PIN login throttling.
-- Run once in Cloudflare D1 gpbs-storage, before testing /api/pl/auth.
-- Different namespace from existing panel_login_attempts.
CREATE TABLE IF NOT EXISTS pl_login_rate_limits (
  identifier TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_expires INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pl_login_rate_limits_updated
  ON pl_login_rate_limits(updated_at);
