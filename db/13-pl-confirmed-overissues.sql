-- GPBS / PL: explicitly record issues larger than the known recorded stock.
-- Run ONCE after db/12-pl-uninventoried-receipts.sql.
-- Only adds a column; no stock, history, parts or inventory are changed.
-- shortage_quantity = count of issued units above the available recorded quantity.
-- Unknown starting quantity is recorded separately in before_unknown.
-- warehouse_stock stays nonnegative; the discrepancy is preserved in PZ/WZ history.

ALTER TABLE pl_warehouse_session_lines
  ADD COLUMN shortage_quantity INTEGER NOT NULL DEFAULT 0
  CHECK(shortage_quantity >= 0);
