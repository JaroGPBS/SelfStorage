# GPBS Storage — czysta baza od uruchomienia produkcyjnego (PL)

## Decyzja funkcjonalna (2026-10-25)

**Nie resetujemy stanów w testowej bazie jako metody uruchomienia magazynu.**
Po zakończeniu wszystkich prób przygotowujemy **nową, niezależną Cloudflare
D1**, z docelowym schematem i tylko zatwierdzonymi danymi podstawowymi.

Pierwszy dzień produkcji ma wyglądać tak:

- Katalog prawdziwych części: **jest** (nazwa, indeks/QR, opcjonalny SAP);
- magazyn i niezbędne role/konta/PIN-y/uprawnienia: **są, skonfigurowane
  na nowo**;
- stany części: **NIEUSTALONE**, czyli **brak wierszy** w `warehouse_stock`
  dla danego magazynu. Nie generować ani nie importować zer;
- robocze i zatwierdzone inwentaryzacje oraz skany: **BRAK**;
- PZ, WZ, ruchy, wydania, zwroty, transfery, operacje ekip: **BRAK**;
- historia, audyt testów i archiwa użytkowników: **BRAK**;
- samochody, zespoły i przypisania testowe: **BRAK**;
- nowe niezweryfikowane części utworzone w testach: **NIE PRZENOSIĆ**.

Pierwsza operacja na produkcji to prawdziwa inwentaryzacja. Dopiero jej
zatwierdzenie zapisuje początkowy stan fizyczny policzonych części.
Niezinwentaryzowane pozostają nieustalone.

## Dlaczego nowa D1, a nie DELETE / reset tabel

Obecne `env.DB` obsługuje polskie /pl/ oraz /panel/ i współdzieli
`parts`, `warehouses`, `users`, `warehouse_stock`,
`warehouse_operations`, `pl_warehouse_inventories`,
`stock_movements`, `vehicle_*`, dzienniki i archiwa.

Ręczne usuwanie operacji ze starej bazy jest ryzykowne: można pominąć
nowe tabele albo osierocić powiązania. Stworzenie nowej fizycznej D1
eliminuje w ogóle historię testów z **produkcyjnego zbioru danych**.
Stara testowa baza jest oddzielnym zasobem i **nie może być podłączona**
do interfejsów udostępnionych pracownikom biura; można ją usunąć
dopiero po osobnej decyzji, kontroli kopii i sprawdzeniu, że produkcja
nie ma z nią żadnego powiązania.

**Uwaga**: baza i historia widoczna w GPBS mogą być całkowicie czyste.
Nie obiecujemy kasowania technicznych logów dostawcy Cloudflare,
backupu lub kopii poza D1.

## Tryb pracy do ukończenia aplikacji

1. Testujemy obecne `/pl/` i funkcje PZ/WZ w obecnej testowej D1.
2. Nowy magazyn lub testowy kod nie jest wymagany do rozdzielania
   danych — izolacja polega na **osobnej instancji D1**, a nie nazwie
   magazynu w tej samej bazie.
3. Do czasu świadomego przełączenia do PROD nie udostępniamy
   istniejącego panelu biurowego jako „czystej produkcji”.
4. Wszystkie przyszłe moduły D1 muszą zapisywać dane operacyjne
   wyłącznie w bazie środowiska, z której pobierają stany. Nie wolno
   łączyć testowych i produkcyjnych danych przy kopiowaniu.

## Przygotowanie nowej bazy (przed uruchomieniem magazynu)

**Tę procedurę wykonujemy na końcu testów, nie teraz. Nie wykonuje ona
automatycznie żadnego czyszczenia ani nie przełącza aktualnej usługi.**

1. Zamrozić testową wersję kodu oraz zrobić kopię testowej D1
   (tylko na potrzeby zabezpieczenia / diagnozy).
2. W Cloudflare utworzyć **nową D1** o odrębnym ID od starej bazy.
   Nie klonować danych / zawartości starej D1.
3. Wdrożyć do nowej D1 **wyłącznie pełny schemat tabel i indeksów**.
   W repo znajdują się migracje:
   - bazowe tabele `parts`, `warehouses`, `warehouse_stock`,
     `warehouse_operations`, `warehouse_operation_lines`,
     `users`, `user_roles`, `user_warehouse_access`,
     `user_pin_credentials`, `panel_login_attempts`;
   - `db/01-add-sap-column.sql`;
   - `db/02-d1-teams-vehicles-inventory.sql`;
   - `db/04-panel-audit.sql`;
   - `db/05-user-private-profiles.sql`;
   - `db/06-user-archive.sql`;
   - `db/07-pl-login-limits.sql`;
   - `db/08-pl-warehouse-inventories.sql`;
   - `db/09-pl-inventory-scanning.sql`.
   
   **BLOKER PRZED CUTOVER:** repo NIE zawiera obecnie jednej
   kanonicznej migracji tworzącej komplet bazowych tabel.
   Trzeba odtworzyć i zatwierdzić taki plik ze schematu
   (`sqlite_master`) istniejącej D1, sprawdzić zależności,
   i przetestować na oddzielnej pustej D1.
   Nie wolno zakładać, że migracje 01–09 same wystarczą.
4. Zatwierdzić i przenieść **wyłącznie listę prawdziwych części**.
   Nie kopiować wprost całej tabeli `parts`: testy mogły dodać
   części `PENDING`, a także fałszywe wpisy nieoznaczone w katalogu.
   Trzeba porównać z zatwierdzoną listą źródłową (indeks, nazwa, SAP).
   Przypisanie indeksów/ID musi pozostać stabilne w zatwierdzonej liście.
5. Dodać tylko rzeczywiste lokalizacje i konta; nadać PIN-y i
   przypisania do magazynu. Nie importować zapisów `user_archives`,
   starych testowych PIN-ów, prób logowania ani `panel_audit_log`.
   Konfiguracja logowania wymaga produkcyjnych sekretów w Cloudflare.
6. **Nie kopiować żadnych rekordów operacyjnych** (stanów, skanowań,
   inwentaryzacji, dokumentów, historii, ruchów, samochodów, zespołów
   testowych itp.). Puste tabele z gotowym schematem muszą być dostępne
   dla nowych operacji.
7. Uruchomić `db/10-clean-production-validation.sql` na **nowej D1**.
   Każda pozycja `MUSI_BYC_0` ma mieć 0 rekordów.
   Sprawdzić ponadto, że katalog zawiera jedynie właściwe części
   i że każdy wymagany pracownik ma rzeczywisty dostęp.
   Jeśli w wykazie `sqlite_master` są dodatkowe tabele operacyjne,
   trzeba dopisać je do audytu czystości **przed startem**.
8. W konfiguracji Cloudflare używać **osobnego bindingu D1** dla
   testów i produkcji. Uwaga: w obecnej architekturze zarówno /pl/,
   jak i /panel/ korzystają z nazwy bindingu `DB`.
   Zmiana bindingu produkcyjnego Pages dotknie OBA te interfejsy.
   Przełączamy je równocześnie tylko, jeśli panel i jego konta
   zostały przygotowane na czystą D1. Francuska aplikacja mobilna
   pozostaje w osobnej bramce Apps Script; przy przyszłej migracji FR
   trzeba osobno zatwierdzić zakres.
9. Zanim pracownicy zaczną, sprawdzić w interfejsach PL i panelu:
   - logowanie działa tylko dla prawidłowo skonfigurowanych kont;
   - pokazuje prawdziwy katalog;
   - stany nieustalone, nie zero;
   - historia ruchów i inwentaryzacji jest całkowicie pusta;
   - nie pojawiają się żadne testowe ekipy, PZ/WZ ani archiwa.
10. Dopiero po tych testach udostępnić bazę i panel pracownikom.

## Czego ABSOLUTNIE nie robimy

- Nie używamy przycisku „wyzeruj wszystkie stany” zamiast nowej D1.
- Nie kopiujemy starego `warehouse_stock` ani tabel historii do PROD.
- Nie wykonujemy `DROP TABLE` / `DELETE` na bieżącej testowej D1
  podczas budowania aplikacji.
- Nie zapewniamy „czystości” wyłącznie przez ukrycie wierszy w panelu.
- Nie kasujemy testowej bazy bez osobnej akceptacji po weryfikacji
  przełączenia i sprawdzeniu ewentualnych obowiązków retencji.

## Kryterium gotowości

Dla biura produkcja ma wyglądać jak **zupełnie nowa instalacja**
GPBS Storage: części i narzędzia do pierwszej inwentaryzacji, bez
żadnej historii wcześniejszego użytkowania.

**Stan wdrożenia**: decyzja, procedura i SQL do weryfikacji są już
w repozytorium. Nowa fizyczna D1 **nie została jeszcze utworzona**,
aktualne bindingi Cloudflare nie są przełączone i żadne rekordy
nie zostały skasowane. Wykonujemy provisioning dopiero na końcu
całości testów, po uzupełnieniu kanonicznej migracji bazowego schematu.
