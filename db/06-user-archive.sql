-- GPBS Storage: zachowaj ID i historie operacji przy usunieciu pracownika z listy.
-- NIGDY nie kasujemy wierszy users ani warehouse_operations.
CREATE TABLE IF NOT EXISTS user_archives (
  user_id TEXT PRIMARY KEY NOT NULL,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_by TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_archives_date
  ON user_archives(archived_at DESC);
