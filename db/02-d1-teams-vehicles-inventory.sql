-- GPBS Storage / Cloudflare D1: struktura operacyjna (etap 2).
-- Bez zmian w istniejacych tabelach: parts, warehouses, warehouse_stock.
-- Bez generowania sztucznych stanow w magazynie PL-TYCHY.
-- Bez wprowadzania PIN-ow: ich przechowywanie i autoryzacja wymagaja osobnej warstwy serwerowej.

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    external_ref TEXT UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    registration_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Przypisanie ekipy do auta. Dopoki released_at jest NULL, przypisanie
-- zajmuje to auto i ekipe. Zakonczenie wymaga potwierdzenia kierownika
-- w warstwie API, a nie samodzielnej operacji pracownika.
CREATE TABLE IF NOT EXISTS vehicle_assignments (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_INVENTORY'
      CHECK (status IN ('PENDING_INVENTORY', 'PENDING_APPROVAL', 'ACTIVE', 'RELEASED')),
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by TEXT,
    released_at TEXT,
    released_by TEXT,
    release_reason TEXT,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    CHECK (
        (released_at IS NULL AND status <> 'RELEASED')
        OR (released_at IS NOT NULL AND status = 'RELEASED')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_assignments_open_team
  ON vehicle_assignments(team_id) WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_assignments_open_vehicle
  ON vehicle_assignments(vehicle_id) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_vehicle_history
  ON vehicle_assignments(vehicle_id, assigned_at);

-- Brak wiersza oznacza stan jeszcze nieustalony, nie potwierdzone zero.
-- Wiersze powinny powstawac dopiero po wprowadzeniu/zaakceptowaniu danych.
CREATE TABLE IF NOT EXISTS vehicle_stock (
    vehicle_id TEXT NOT NULL,
    part_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (vehicle_id, part_id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
);

CREATE TABLE IF NOT EXISTS vehicle_inventories (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    assignment_id TEXT,
    inventory_type TEXT NOT NULL
      CHECK (inventory_type IN ('FIRST', 'HANDOVER', 'WEEKLY', 'RECOUNT')),
    status TEXT NOT NULL DEFAULT 'DRAFT'
      CHECK (status IN ('DRAFT', 'SUBMITTED', 'RECOUNT_REQUIRED', 'APPROVED', 'REJECTED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    review_note TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (assignment_id) REFERENCES vehicle_assignments(id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inventories_vehicle
  ON vehicle_inventories(vehicle_id, created_at);

CREATE INDEX IF NOT EXISTS idx_vehicle_inventories_manager_queue
  ON vehicle_inventories(status, submitted_at);

-- Ilosci w bazie sa wyliczane/zapisywane przez backend dopiero po
-- przeslaniu kompletnej slepej inwentaryzacji; nie przy jej wypelnianiu.
-- Counted_quantity NULL = pozycja niepoliczona; 0 = policzona i brak.
CREATE TABLE IF NOT EXISTS vehicle_inventory_lines (
    inventory_id TEXT NOT NULL,
    part_id TEXT NOT NULL,
    counted_quantity INTEGER CHECK (counted_quantity >= 0),
    expected_quantity INTEGER CHECK (expected_quantity >= 0),
    PRIMARY KEY (inventory_id, part_id),
    FOREIGN KEY (inventory_id) REFERENCES vehicle_inventories(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
);

-- Dziennik zmian stanow (dodatnia/ujemna zmiana ilosci).
-- Dwie pozycje dla transferu maja wspolne operation_id i sa zapisywane
-- atomowo przez API. Lokalizacje sa typu WAREHOUSE lub VEHICLE.
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    part_id TEXT NOT NULL,
    location_type TEXT NOT NULL CHECK (location_type IN ('WAREHOUSE', 'VEHICLE')),
    location_id TEXT NOT NULL,
    quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
    movement_type TEXT NOT NULL CHECK (movement_type IN (
      'RECEIPT', 'ISSUE', 'RETURN', 'CONSUMPTION', 'TRANSFER',
      'INITIAL_STOCK', 'INVENTORY_ADJUSTMENT', 'CORRECTION'
    )),
    actor_id TEXT,
    inventory_id TEXT,
    service_location TEXT,
    machine_serial TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (part_id) REFERENCES parts(id),
    FOREIGN KEY (inventory_id) REFERENCES vehicle_inventories(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_operation
  ON stock_movements(operation_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_location
  ON stock_movements(location_type, location_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_part
  ON stock_movements(part_id, created_at);

-- Audyt decyzji kierownika. PIN jest kazdorazowo weryfikowany przez
-- serwer i nie jest zapisywany w tej tabeli.
CREATE TABLE IF NOT EXISTS manager_actions (
    id TEXT PRIMARY KEY,
    manager_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
      'RELEASE_VEHICLE', 'APPROVE_INVENTORY', 'REJECT_INVENTORY',
      'REQUEST_RECOUNT', 'APPROVE_ASSIGNMENT'
    )),
    team_id TEXT,
    vehicle_id TEXT,
    inventory_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (inventory_id) REFERENCES vehicle_inventories(id)
);

CREATE INDEX IF NOT EXISTS idx_manager_actions_created
  ON manager_actions(created_at);
