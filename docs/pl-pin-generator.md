# GPBS Storage — generator PIN-ów D1 (Polska / projekt globalny)

Stan: przygotowany backend, **domyślnie wyłączony**. Wersja aplikacji francuskiej na Apps Script nie jest modyfikowana.

## Dotychczasowe tabele

- `user_roles`: role ADMIN, KIEROWNIK, KOORDYNATOR, MAGAZYNIER, EKIPA.
- `users`: identyfikator, nazwa, rola, aktywność.
- `user_warehouse_access`: magazyny przypisane do użytkownika.
- `user_pin_credentials`: `user_id` (PK), `pin_digest` (UNIQUE), daty utworzenia i zmiany.

## Generator serwerowy

Cloudflare Pages Function: `POST /api/pl/admin/generate-pins`.

Obsługiwane działania:
- `generate_missing`: nadanie PIN-ów tylko aktywnym użytkownikom, którzy ich jeszcze nie mają, opcjonalnie filtr `role`; maksymalnie 100 na wywołanie.
- `generate_one`: nadanie PIN-u jednemu aktywnemu użytkownikowi bez PIN-u.
- `reset_one`: świadoma wymiana istniejącego PIN-u jednego użytkownika.

Każdy PIN to losowy 4-cyfrowy kod z `crypto.getRandomValues`, z wyjątkiem zarezerwowanego `0000`. Unikalność w D1 zapewnia kolumna `pin_digest UNIQUE` i ponawianie losowania przy kolizji. W D1 jest tylko HMAC-SHA256 z tajnym serwerowym kluczem (bez przechowywania jawnego PIN-u).

PIN jest przekazywany **wyłącznie w odpowiedzi po jego wygenerowaniu lub zresetowaniu**; nie da się go później odczytać z D1. Jeśli administrator utraci kod, musi go zresetować.

## Warunki uruchomienia w panelu administracyjnym

Backend wymaga trzech ustawień dla środowiska Production:
- `PL_PIN_GENERATOR_ENABLED` = `true` (Text) — osobne zezwolenie na działanie generatora.
- `PIN_PEPPER` — losowy tajny ciąg co najmniej 32 znaków (Cloudflare **Secret**, nie Text).
- `PIN_ADMIN_SETUP_KEY` — **inny**, niezależny tajny ciąg co najmniej 32 znaków (Cloudflare **Secret**).

Uruchomienie endpointu wymaga ponadto:
- prawidłowego PIN-u aktywnego legacy użytkownika ADMIN, sprawdzanego serwerowo przez Google Apps Script;
- niezależnego klucza administracyjnego przesłanego w nagłówku `X-GPBS-Admin-Setup`;
- żądania POST JSON z tej samej domeny.

Dodatkowego klucza **nie wolno osadzić na stałe** w kodzie HTML/JavaScript dostępnym publicznie. Jest to ochrona przejściowa na czas przygotowania panelu. Docelowo zastępujemy ją sesją administratora, logowaniem z silnym uwierzytelnieniem, kontrolą tempa prób oraz szczegółowym rejestrem zmian.

## Ważne przed uruchomieniem wspólnego logowania D1 + Francja

**Unikalność PIN-ów jest obecnie sprawdzana tylko względem PIN-ów w D1.** Stare PIN-y we francuskim Google Sheets nie są jeszcze uwzględniane. Zanim podłączymy nowe konta do jednego wspólnego logowania wszystkich krajów, konieczne jest uzgodnienie wspólnej puli PIN-ów lub migracja francuskich kont.

Nie wolno usuwać ani zmieniać `PIN_PEPPER` bez procedury migracji: istniejące skróty PIN-ów przestaną pasować.

## Bezpieczeństwo

Czterocyfrowy PIN jest stosunkowo słabym sekretem. Przed logowaniem produkcyjnym wdrażamy limity prób i blokady oraz osobne, mocne uwierzytelnienie do administracji WWW. Nie włączamy zewnętrznego logowania na podstawie samego 4-cyfrowego PIN-u.

Backend nie modyfikuje aplikacji mobilnej ani ścieżki `/api` obsługującej produkcyjne magazyny francuskie.
