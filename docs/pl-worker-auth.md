# GPBS Storage — etap: logowanie pracowników PL (D1)

Ten etap dodaje wyłącznie backend. Nie zmienia działającej francuskiej
aplikacji `/`, jej Apps Script `/api` ani produkcyjnych stanów Tychy.

## Migracja (wymagana przed pierwszym testem)

W Cloudflare D1 `gpbs-storage` wykonaj `db/07-pl-login-limits.sql`.
Skrypt tylko tworzy oddzielną tabelę ograniczeń prób logowania.
Bez niej POST login celowo zwraca HTTP 503 (fail closed).

Wykorzystuje istniejące produkcyjne sekrety:
- `PIN_PEPPER` (nadany już w panelu — HMAC nad PIN-ami D1)
- `PANEL_SESSION_SECRET` (osobne zastosowanie dzięki domenie klucza PL)

Nie wolno ujawniać ani zmieniać kluczy. Nie należy regenerować
`PIN_PEPPER`, ponieważ unieważniłoby to wcześniej wydane PIN-y.

## API

`POST /api/pl/auth` JSON, w obrębie tej samej domeny:

```json
{"action":"login","pin":"0000"}
```

Wartość `0000` jest tylko przykładem formatu; nie jest kodem testowym.
Wysyłanie wymaga poprawnego nagłówka Origin. Sukces: sesyjne
ciasteczko `__Host-gpbs_pl_worker` (Secure, HttpOnly,
SameSite=Strict, TTL 8 godzin), `user.id`, `user.nickname`,
`user.role` i aktywne magazyny PL przypisane kontu.

`GET /api/pl/auth` sprawdza sesję, aktualny status, archiwizację,
zmianę PIN-u oraz dostęp do aktywnych polskich magazynów.

`POST /api/pl/auth` z `{"action":"logout"}` wylogowuje przeglądarkę.

W odpowiedzi **nie ma** numeru PIN, skrótu PIN, numeru telefonu,
nazwiska ani innych prywatnych danych kontaktowych.

PIN jest jedynie sposobem uwierzytelnienia. Wszystkie późniejsze
operacje magazynowe mają odnosić się do niezmiennego `users.id`.

## Zabezpieczenia

- Weryfikacja zgodna z aktualnym generatorem PIN-ów panelu:
  `HMAC-SHA256(PIN_PEPPER, 'GPBS:D1:PIN:v1:' + pin)`.
- Sprawdzenie konta `active=1` i braku wpisu w `user_archives`
  oraz dostępów w `user_warehouse_access` i `warehouses`.
- Sesja podpisana osobnym kluczem domenowym; nie może być użyta do
  logowania administratora panelu.
- Reset PIN-u, archiwizacja, dezaktywacja i odebranie dostępów
  unieważniają stosowny dostęp przy kolejnym wywołaniu.
- Tabela `pl_login_rate_limits`: 7 prób / 15 minut dla IP,
  globalne 60 prób / 15 minut, po przekroczeniu blokada 15 minut.
  Identyfikatory IP są zapisywane tylko jako HMAC (bez jawnego IP).
- W razie braku konfiguracji lub tabeli brak logowania zamiast
  omijania sprawdzeń.

## Granice tego etapu

Brak jeszcze pracowniczego ekranu logowania oraz PZ/WZ przez tę sesję.
Testowe PZ/WZ `/api/pl/warehouse-operation` nadal są odrębnym,
wyłączonym domyślnie narzędziem tylko dla `PL-TEST`.

PIN-y FR działają we własnym systemie. Przed wspólnym logowaniem na
oba rynki trzeba wykryć i usunąć kolizje kodów między FR i D1.
Czterocyfrowy PIN sam w sobie ma małą przestrzeń kodów: przed
pełnym uruchomieniem należy rozważyć dodatkową ochronę urządzeń
lub silniejsze uwierzytelnianie, oprócz już dodanych limitów prób.
