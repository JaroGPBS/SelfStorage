-- GPBS Storage / PL: permit the FIRST receipt (PZ) without prior inventory.
-- Run ONCE on the existing D1 after db/11-pl-warehouse-sessions.sql.
-- Preserves all rows, stock, operations and history; no drop/delete/update.
-- For the first PZ, quantity_before stores 0 only as calculation baseline,
-- while before_unknown=1 explicitly records that prior physical stock was UNKNOWN.
-- Existing historical lines keep before_unknown=0 (known quantity).

ALTER TABLE pl_warehouse_session_lines
  ADD COLUMN before_unknown INTEGER NOT NULL DEFAULT 0
    CHECK(before_unknown IN (0,1));
