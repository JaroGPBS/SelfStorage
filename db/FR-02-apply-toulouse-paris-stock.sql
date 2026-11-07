-- GPBS Storage FR / Toulouse & Paris stock import into the EXISTING production D1.
-- NOT AUTORUN. Make a D1 backup and review FR-01 preflight results first.
-- Only correct balances in 78 catalogued part rows are imported. PL and Belleville untouched.
-- No fake teams, car stock, visits or historical operations are imported or deleted.
-- Expected snapshot: Toulouse 887 units, Paris 1345 units; 78 parts each (zeros included).
-- Warehouse IDs chosen for new D1 FR records: FR-TOULOUSE / FR-PARIS.
-- STOP if existing FR warehouses already use other IDs for Toulouse or Paris.
-- Check the live D1 schema for required warehouse fields before running this file.

INSERT OR IGNORE INTO warehouses (id,name,country_code,active) VALUES
  ('FR-TOULOUSE','Tuluza','FR',1),
  ('FR-PARIS','Paryż','FR',1);

-- Global guards: never silently import an incomplete snapshot or unresolved part IDs.
-- SELECT .. WHERE 1 before ON CONFLICT is required for SQLite's UPSERT parser.
INSERT INTO warehouse_stock (warehouse_id,part_id,quantity,updated_at)
SELECT 'FR-TOULOUSE',s.part_id,s.toulouse_qty,CURRENT_TIMESTAMP
FROM fr_stock_import_20261107 s JOIN parts p ON p.id=s.part_id
WHERE (SELECT COUNT(*) FROM fr_stock_import_20261107)=78
  AND (SELECT SUM(toulouse_qty) FROM fr_stock_import_20261107)=887
  AND (SELECT SUM(paris_qty) FROM fr_stock_import_20261107)=1345
  AND (SELECT COUNT(*) FROM fr_stock_import_20261107 s2 LEFT JOIN parts p2 ON p2.id=s2.part_id WHERE p2.id IS NULL)=0
  AND (SELECT COUNT(*) FROM warehouses WHERE id='FR-TOULOUSE' AND country_code='FR' AND active=1)=1
  AND (SELECT COUNT(*) FROM warehouses WHERE id='FR-PARIS' AND country_code='FR' AND active=1)=1
  AND 1
ON CONFLICT(warehouse_id,part_id) DO UPDATE SET
  quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP;

INSERT INTO warehouse_stock (warehouse_id,part_id,quantity,updated_at)
SELECT 'FR-PARIS',s.part_id,s.paris_qty,CURRENT_TIMESTAMP
FROM fr_stock_import_20261107 s JOIN parts p ON p.id=s.part_id
WHERE (SELECT COUNT(*) FROM fr_stock_import_20261107)=78
  AND (SELECT SUM(toulouse_qty) FROM fr_stock_import_20261107)=887
  AND (SELECT SUM(paris_qty) FROM fr_stock_import_20261107)=1345
  AND (SELECT COUNT(*) FROM fr_stock_import_20261107 s2 LEFT JOIN parts p2 ON p2.id=s2.part_id WHERE p2.id IS NULL)=0
  AND (SELECT COUNT(*) FROM warehouses WHERE id='FR-TOULOUSE' AND country_code='FR' AND active=1)=1
  AND (SELECT COUNT(*) FROM warehouses WHERE id='FR-PARIS' AND country_code='FR' AND active=1)=1
  AND 1
ON CONFLICT(warehouse_id,part_id) DO UPDATE SET
  quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP;

-- The exact snapshot totals below are valid only if each target has 78 stock rows.
SELECT w.id,w.name,COUNT(ws.part_id) AS positions,
  COALESCE(SUM(ws.quantity),0) AS units
FROM warehouses w LEFT JOIN warehouse_stock ws ON ws.warehouse_id=w.id
WHERE w.id IN ('FR-TOULOUSE','FR-PARIS')
GROUP BY w.id,w.name ORDER BY w.id;
