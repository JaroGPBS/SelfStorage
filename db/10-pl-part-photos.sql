-- GPBS Storage: one identification photo per central part.
-- New-part API creates this table automatically on the first photo upload;
-- this idempotent migration is retained for backups/reproducible setup.
-- Existing warehouse stocks and histories are untouched.
CREATE TABLE IF NOT EXISTS pl_part_photos (
  part_id TEXT PRIMARY KEY REFERENCES parts(id),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/webp')),
  photo_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
