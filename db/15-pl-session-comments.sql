-- GPBS Storage / Poland: optional, separate comments for PZ and WZ documents.
-- Non-destructive; does not touch any warehouse stock, sessions or history.
-- The session API also creates this table lazily on the first commented visit.
CREATE TABLE IF NOT EXISTS pl_warehouse_session_comments (
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('PZ','WZ')),
  comment TEXT NOT NULL CHECK(length(comment) BETWEEN 1 AND 500),
  PRIMARY KEY(session_id,direction),
  FOREIGN KEY(session_id) REFERENCES pl_warehouse_sessions(id)
);
