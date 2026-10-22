-- GPBS Storage - rozszerzenie katalogu czesci o indeks SAP
-- Wykonaj w Cloudflare D1 Console dokladnie jeden raz.
-- Nie zmienia dotychczasowych numerow magazynowych i stanow.
ALTER TABLE parts ADD COLUMN sap_number TEXT;

-- Jeden numer SAP wskazuje na jedna czesc (puste pole jest dozwolone).
CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_sap_number
ON parts(sap_number)
WHERE sap_number IS NOT NULL AND TRIM(sap_number) <> '';

-- Sprawdzamy strukture kolumn:
PRAGMA table_info(parts);
