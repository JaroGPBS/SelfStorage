-- GPBS Storage — prywatna kartoteka personelu.
-- Bez zmian w istniejacych kontach, rolach i stanach magazynowych.
-- Pola prywatne celowo poza tabela users, aby backend pracownika
-- nie mogl przypadkowo pobrac nazwiska lub telefonu.
CREATE TABLE IF NOT EXISTS user_private_profiles (
  user_id TEXT PRIMARY KEY NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  display_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_private_profiles_last_name
  ON user_private_profiles(last_name, first_name);

-- Uzytkownicy dodani przed ta migracja pozostaja bez wpisu
-- w user_private_profiles, dopoki administrator ich nie uzupelni.
-- Nie zgadujemy imion ani nazwisk z istniejacego pola users.name.
