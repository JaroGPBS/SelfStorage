# GPBS Storage — panel WWW biurowy i administracyjny

## Status

Pierwsza wersja panelu: `/panel/` — jedno menu, wspólny design GPBS, sekcje:
- Pulpit z liczbą aktywnych magazynów, części, operacji i użytkowników
- Magazyny PL i stany magazynowe (PL-TEST vs PL-TYCHY)
- Katalog części z indeksami magazynowymi i SAP; filtr po magazynie
- Historia PZ/WZ i zmiany ilości
- Użytkownicy, pięć ról, przydziały do magazynów; formularz dodania użytkownika

**Nie jest to jeszcze produkcyjny panel pracowników.**
W tej fazie dostęp ma tylko główny ADMIN; rolom kierownika, koordynatora,
magazyniera i ekipy nadamy szczegółowe uprawnienia przed uruchomieniem ich logowań.

Backend: Cloudflare Pages Function `/api/panel`.
Endpoint jest całkowicie oddzielny od `/api` obsługującego magazyny francuskie.

## Bezpieczne włączenie po stronie Cloudflare

Cloudflare Pages projektu `selfstorage` → Settings → Variables and secrets
→ produkcyjne środowisko. Dodaj **dwa odrębne sekrety**, bez umieszczania ich w kodzie,
w czacie, linkach ani w plikach:

- `PANEL_ADMIN_PASSWORD` — nowe, długie, losowe hasło administracyjne (co najmniej 32 znaki).
- `PANEL_SESSION_SECRET` — odrębny, losowy klucz do podpisywania sesji
  (co najmniej 32 znaki). Zmiana klucza wyloguje dotychczasowe sesje.

Zapisz sekrety i wykonaj ponowne wdrożenie. Bez prawidłowej konfiguracji
API odmawia logowania.

Początkowe logowanie głównego ADMINA odbywa się **dwoma czynnikami wiedzy**:
silnym hasłem panelu i dotychczasowym PIN-em administratora z Google Apps Script.
Wystawienie sesji odbywa się na serwerze, a nie przez samą logikę JavaScript.
Cookie sesji ma `HttpOnly; Secure; SameSite=Strict` i ważność 8 godzin.

**Przed uruchomieniem dostępu dla kolejnych osób** wymagamy poprawnego
uwierzytelniania dla ról D1, kontroli prób, dziennika audytu oraz przejścia
na centralny system kont (bez polegania na legacy Apps Script).

## D1

Panel odczytuje następujące istniejące tabele:
`warehouses`, `warehouse_stock`, `parts`,
`warehouse_operations`, `warehouse_operation_lines`, `users`,
`user_roles`, `user_warehouse_access`, `user_pin_credentials`.

Dodawanie użytkownika zapisuje do `users` i przypisania do
`user_warehouse_access` w jednym `batch`; **nie nadaje jeszcze PIN-u**.
Przed wdrożeniem produkcyjnego administrowania kontami dołączyć zapis
w tabeli audytu z pliku `db/04-panel-audit.sql`.

Magazyn `PL-TYCHY` nie ma jeszcze zinwentaryzowanych stanów — pokazywać
jako „Nieustalony”, nie interpretować pustych stanów jako fizycznego zera.

Generator PIN-ów `/api/pl/admin/generate-pins` jest osobną,
**wyłączoną** usługą administracyjną. Nie łączyć z panelem przed migracją
PIN-ów francuskich ekip, weryfikacją unikalności globalnej i wprowadzeniem
rate-limit dla logowania.

## Nie zmieniamy

- `functions/api.js` → bieżąca bramka Apps Script FR pozostaje bez zmian.
- Aplikacja mobilna / `index.html` i skaner pozostają bez zmian.
- Baza samochodów, obsługa ekip i podpisy odłożone na później.
- Stany produkcyjne `PL-TYCHY` są nadal nieustalone.
