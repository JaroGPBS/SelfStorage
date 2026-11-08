-- GPBS Storage: individual market access and optional feature restrictions.
-- Existing warehouse assignments are not modified.
-- For accounts without a record, the application derives PL/FR from
-- existing user_warehouse_access grants. Features remain allowed by default.
-- This table is also created automatically by Admin when a setting is saved.
CREATE TABLE IF NOT EXISTS user_access_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  pl_enabled INTEGER NOT NULL DEFAULT 0 CHECK(pl_enabled IN (0,1)),
  fr_enabled INTEGER NOT NULL DEFAULT 0 CHECK(fr_enabled IN (0,1)),
  extra_permissions TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
