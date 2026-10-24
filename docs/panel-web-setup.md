# GPBS Storage — panel WWW biurowy i administracyjny

## Status

Pierwsza wersja panelu: `/panel/` — jedno menu, wspólny design GPBS, sekcje:
- Pulpit z liczbą aktywnych magazynów, części, operacji i użytkowników
- Magazyny PL i stany magazynowe (PL-TEST vs PL-TYCHY)
- Katalog części z indeksami magazynowymi i SAP; filtr po magazynie
- Historia PZ/WZ i zmiany ilości
- Użytkownicy, pięć ról, przypisania do magazynów we wszystkich krajach; dodawanie, edycja i aktywowanie/dezaktywowanie kont

**Nie jest to jeszcze produkcyjny panel pracowników.**
W tej fazie dostęp ma tylko główny ADMIN; rolom kierownika, koordynatora,
magazyniera i ekipy nadamy szczegółowe uprawnienia przed uruchomieniem ich logowań.

Panel zawiera również zakładkę **Bezpieczeństwo** — lokalny, jednorazowy generator\nlosowego klucza `PANEL_SESSION_SECRET` (48 bajtów, 64 znaki Base64).\nNie przesyła klucza na serwer ani nie zapisuje go w danych panelu.\n\nBackend: Cloudflare Pages Function `/api/panel`.
Endpoint jest całkowicie oddzielny od `/api` obsługującego magazyny francuskie.

## Bezpieczne włączenie po stronie Cloudflare

Cloudflare Pages projektu `selfstorage` → Settings → Variables and secrets
→ produkcyjne środowisko. Dodaj **dwa odrębne sekrety**, bez umieszczania ich w kodzie,
w czacie, linkach ani w plikach:

- `PANEL_ADMIN_PASSWORD` — hasło administracyjne o długości **minimum 8 znaków** (zalecane dłuższe, unikalne).
- `PANEL_SESSION_SECRET` — odrębny, losowy klucz do podpisywania sesji
  (co najmniej 32 znaki). Zmiana klucza wyloguje dotychczasowe sesje.

Jeśli początkowy klucz sesji został ujawniony w rozmowie, należy go\n**wymienić**: otworzyć w panelu **Bezpieczeństwo**, wygenerować i skopiować\nnowy klucz, a następnie podmienić wartość Secret w Cloudflare i wdrożyć.\nZmiana klucza wyloguje aktywne sesje.\n\nZapisz sekrety i wykonaj ponowne wdrożenie. Bez prawidłowej konfiguracji
API odmawia logowania.

Początkowe logowanie głównego ADMINA odbywa się **dwoma czynnikami wiedzy**:
silnym hasłem panelu i dotychczasowym PIN-em administratora z Google Apps Script.
Wystawienie sesji odbywa się na serwerze, a nie przez samą logikę JavaScript.
Cookie sesji ma `HttpOnly; Secure; SameSite=Strict` i ważność 8 godzin.

**Przed uruchomieniem dostępu dla kolejnych osób** wymagamy poprawnego
uwierzytelniania dla ról D1, kontroli prób, dziennika audytu oraz przejścia
na centralny system kont (bez polegania na legacy Apps Script).

## Blokady logowania (D1)

Wymagana tabela `panel_login_attempts` w bazie `gpbs-storage`
(utworzona przez administratora z poziomu konsoli D1):
```sql
CREATE TABLE IF NOT EXISTS panel_login_attempts (
  identifier TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
```

Dla panelu administratora:
- **5 prób w ciągu 15 minut z jednego adresu IP** powoduje blokadę na **5 minut**.
- Po poprawnym haśle panelu osobna **wspólna pula 5 prób PIN-u**
  blokuje weryfikację PIN-u na **30 minut**.
- Żądania są liczone w D1 *przed* porównaniem poświadczeń; piąta próba
  w danym oknie zostaje zablokowana nawet wtedy, gdy byłaby poprawna.
- Udane, pełne logowanie czyści oba liczniki.
- Identyfikator IP w D1 jest skrótem HMAC; nie przechowujemy jawnego adresu IP.
- Brak połączenia D1 lub nagłówka `CF-Connecting-IP` powoduje odmowę logowania.
- Przy atakach rozproszonych wskazana dodatkowa reguła Cloudflare WAF/rate-limit.
  Sama tabela D1 nie zastępuje WAF.

**Przed produkcyjnym udostępnieniem panelu:** techniczny `PANEL_SESSION_SECRET`
powinien być niezależnym, losowym kluczem wygenerowanym i zachowanym prywatnie,
nie kluczem kopiowanym z jawnej rozmowy lub repozytorium.

## D1

Panel odczytuje następujące istniejące tabele:
`warehouses`, `warehouse_stock`, `parts`,
`warehouse_operations`, `warehouse_operation_lines`, `users`,
`user_roles`, `user_warehouse_access`, `user_pin_credentials`.

**Przed dodawaniem lub edycją użytkowników należy wykonać w D1\nmigrację `db/04-panel-audit.sql`.** Kod wymaga tabeli `panel_audit_log`\ni odmówi zapisu, dopóki jej nie będzie.\n\nDodawanie i edycja konta zapisują `users`, `user_warehouse_access`\noraz wpis do `panel_audit_log` w **jednej transakcji D1 `batch`**.\nEdytowanie konta umożliwia zmianę nazwy, roli, magazynów i aktywności,\nbez dotykania PIN-u. Nowy użytkownik nie otrzymuje PIN-u automatycznie.

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


## Użytkownicy: opcjonalne dane kontaktowe

W panelu jest **jedna zakładka Użytkownicy**. Tabela zachowuje dotychczasowe
kolumny: Użytkownik, Rola, Magazyny, PIN, Status, Edytuj.

Kliknięcie wiersza (poza przyciskiem Edytuj) rozwija jedną dodatkową linię
z trzema polami: Imię, Nazwisko i Numer telefonu. Ponowne kliknięcie zwija
wiersz; rozwinięcie drugiego użytkownika zwija poprzedniego. Na komputerze
i telefonie kontakt jest dostępny w tym samym miejscu.

W formularzu dodawania i edycji wymagany pozostaje **identyfikator
użytkownika** (np. MT), rola i przypisania według potrzeb.
**Imię, nazwisko i telefon są opcjonalne** — można je uzupełnić później.
Zmiana tych pól nie zmienia identyfikatora ani PIN-u.

Dane prywatne pozostają w oddzielnej tabeli
`user_private_profiles` (`db/05-user-private-profiles.sql`).
Serwer dołącza je **tylko w widoku Użytkownicy objętym autoryzacją ADMINA**,
a nie przez API pracownika. `users.name` nadal przechowuje krótki
identyfikator (MT), nie imię i nazwisko. Kolumna `display_code`
w prywatnym profilu jest generowana na podstawie identyfikatora i unikalna.

Aktualnie pracownicza aplikacja francuska nie zmienia swojego interfejsu
ani logowania. Nowy polski interfejs w przyszłości może pokazywać same
inicjały/identyfikator; żadnego stałego napisu „Dzień dobry” nie dodajemy.

Już dodane konto bez kontaktu pozostaje bez zmian; kliknięcie jego wiersza
pokaże kreski zamiast brakujących danych. Wystarczy uzupełnić je przez Edytuj.
