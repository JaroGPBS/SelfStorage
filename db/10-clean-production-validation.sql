-- GPBS Storage: READ-ONLY checklist for a BRAND NEW, empty operational D1.
-- Run ONLY against the NEW intended production D1 after applying ALL schemas
-- and importing approved PARTS + required active accounts/warehouse grants.
-- Running this on the current testing D1 reports test history; it does not erase it.
-- All TEST_HISTORY / TEST_DATA checks must have rekordow=0 at go-live.
-- No DELETE, DROP or UPDATE in this file.

SELECT 'PARTS_APPROVED_CATALOG' AS obszar, COUNT(*) AS rekordow,
  'ZATWIERDZONY_KATALOG' AS oczekiwane FROM parts
UNION ALL SELECT 'WAREHOUSES_CONFIG',COUNT(*),'TYLKO_PRAWDZIWE' FROM warehouses
UNION ALL SELECT 'USERS_CONFIG',COUNT(*),'TYLKO_AKTYWNE_KONTA' FROM users
UNION ALL SELECT 'USER_ROLES_CONFIG',COUNT(*),'KONFIGURACJA' FROM user_roles
UNION ALL SELECT 'USER_WAREHOUSE_GRANTS',COUNT(*),'KONFIGURACJA' FROM user_warehouse_access
UNION ALL SELECT 'USER_PIN_CREDENTIALS',COUNT(*),'NOWE_PINY' FROM user_pin_credentials
UNION ALL SELECT 'WAREHOUSE_STOCK',COUNT(*),'MUSI_BYC_0' FROM warehouse_stock
UNION ALL SELECT 'WAREHOUSE_OPERATIONS',COUNT(*),'MUSI_BYC_0' FROM warehouse_operations
UNION ALL SELECT 'WAREHOUSE_OPERATION_LINES',COUNT(*),'MUSI_BYC_0' FROM warehouse_operation_lines
UNION ALL SELECT 'PL_WAREHOUSE_INVENTORIES',COUNT(*),'MUSI_BYC_0' FROM pl_warehouse_inventories
UNION ALL SELECT 'PL_WAREHOUSE_INVENTORY_LINES',COUNT(*),'MUSI_BYC_0' FROM pl_warehouse_inventory_lines
UNION ALL SELECT 'PL_WAREHOUSE_INVENTORY_EVENTS',COUNT(*),'MUSI_BYC_0' FROM pl_warehouse_inventory_events
UNION ALL SELECT 'PL_WAREHOUSE_INVENTORY_CHANGES',COUNT(*),'MUSI_BYC_0' FROM pl_warehouse_inventory_changes
UNION ALL SELECT 'PL_PART_VERIFICATIONS',COUNT(*),'MUSI_BYC_0' FROM pl_part_verifications
UNION ALL SELECT 'STOCK_MOVEMENTS',COUNT(*),'MUSI_BYC_0' FROM stock_movements
UNION ALL SELECT 'VEHICLE_STOCK',COUNT(*),'MUSI_BYC_0' FROM vehicle_stock
UNION ALL SELECT 'VEHICLE_ASSIGNMENTS',COUNT(*),'MUSI_BYC_0' FROM vehicle_assignments
UNION ALL SELECT 'VEHICLE_INVENTORIES',COUNT(*),'MUSI_BYC_0' FROM vehicle_inventories
UNION ALL SELECT 'VEHICLE_INVENTORY_LINES',COUNT(*),'MUSI_BYC_0' FROM vehicle_inventory_lines
UNION ALL SELECT 'MANAGER_ACTIONS',COUNT(*),'MUSI_BYC_0' FROM manager_actions
UNION ALL SELECT 'PANEL_AUDIT_LOG',COUNT(*),'MUSI_BYC_0' FROM panel_audit_log
UNION ALL SELECT 'USER_ARCHIVES',COUNT(*),'MUSI_BYC_0' FROM user_archives
UNION ALL SELECT 'PL_LOGIN_RATE_LIMITS',COUNT(*),'MUSI_BYC_0' FROM pl_login_rate_limits
UNION ALL SELECT 'PANEL_LOGIN_ATTEMPTS',COUNT(*),'MUSI_BYC_0' FROM panel_login_attempts
UNION ALL SELECT 'TEAMS',COUNT(*),'MUSI_BYC_0' FROM teams
UNION ALL SELECT 'VEHICLES',COUNT(*),'MUSI_BYC_0' FROM vehicles
ORDER BY obszar;

-- Warehouse quantities MUST be absent, NOT filled with zero placeholders.
-- With no warehouse_stock records, the app displays 'Nieustalony'.

-- Optional: list the new D1 schema and verify there are no unexpected
-- legacy tables that might contain old warehouse transactions.
SELECT name AS tabela FROM sqlite_master
WHERE type='table' AND name NOT LIKE 'sqlite_%'
ORDER BY name;
