# GPBS Storage — PL: inwentaryzacja magazynu (wersja robocza)

## Cel i zakres

- Dostępne na `/pl/` tylko dla zalogowanych ról `ADMIN`, `KIEROWNIK`
  oraz `MAGAZYNIER`, mających aktywny przydział do polskiego magazynu.
- Jeden magazyn przypisany do pracownika → automatyczne wejście do niego,
  **bez QR**. Ekipy i koordynatorzy nie mają dostępu do tego endpointu.
- Oddzielny, mobilny ekran `Inwentaryzacja`, połączony z D1.
- Nadal odrębny od aplikacji francuskiej, osobnego przyszłego panelu
  biurowego i istniejącego panelu administracyjnego.
- Docelową szatę graficzną ujednolicamy z główną aplikacją po domknięciu
  funkcjonalności.

## Konfiguracja D1

**Wymagany krok przed użyciem arkusza**:
Cloudflare → D1 → `gpbs-storage` → Console → uruchom pełną zawartość
`db/08-pl-warehouse-inventories.sql`.

Tworzy tabele:
- `pl_warehouse_inventories` — właściciel, magazyn, status i wersja arkusza;
- `pl_warehouse_inventory_lines` — policzone ilości i stan przed liczeniem;
- `pl_warehouse_inventory_changes` — nienadpisywalna historia
  zatwierdzonych korekt, z identyfikatorem pracownika i przed/po.

Migracja **nie dopisuje żadnych stanów magazynowych**. Nie zmienia
produkcji FR, nie usuwa danych ani nie nadpisuje istniejącego `warehouse_stock`.

## Tryb bezpiecznego wdrożenia

Nowa flaga w Cloudflare Pages Production:
`PL_INVENTORY_PUBLISH_ENABLED` = `true` (Plain text, świadomy opt-in).

**Domyślnie flaga nie istnieje, czyli zatwierdzenie NIE DZIAŁA.**
Można zalogować się do magazynu, wyszukiwać części, wpisywać
policzone ilości od 0 do 100000, poprawiać je i przechowywać
roboczy arkusz w D1 — ale `warehouse_stock` nie jest w tym
trybie zmieniany. To bezpieczny etap testowania.

Po potwierdzeniu gotowości do zapisania prawdziwych stanów
administrator ustawia flagę i wykonuje wdrożenie Cloudflare.
Wtedy dopiero przycisk `Zatwierdź policzone pozycje` działa
(po niezależnym potwierdzeniu w oknie).

**Nie włączaj flagi wyłącznie dla testu na PL-TYCHY**, jeśli
wpisane ilości nie odpowiadają faktycznie policzonym częściom.
Można też przeprowadzić próbę na `PL-TEST`, o ile aktywne
konto ma do niego dostęp.

## Obsługa

1. W aplikacji magazyniera wybierz `Inwentaryzacja`.
2. Wyszukaj część po nazwie, numerze części albo SAP i wybierz ją.
3. Wpisz faktyczną ilość. `0` jest dozwolone tylko jako świadome
   potwierdzenie, że części nie ma. Puste pole oznacza `niepoliczona`.
4. Zapisz do roboczego arkusza; można ją `Popraw` lub `Usuń`.
   Arkusz zachowuje się po odświeżeniu strony.
5. Zatwierdzenie (gdy jest włączone) zapisuje jednocześnie
   wszystkie pozycje w bieżącym arkuszu i ich historię. Maksymalnie
   30 części na jeden arkusz; po zatwierdzeniu można prowadzić kolejny.
   Pozostałe niepoliczone części zachowują wcześniejsze stany lub
   pozostają `Nieustalony`.

Dla każdej pozycji zachowujemy stan przed i po inwentaryzacji.
Zatwierdzenie działa w jednej transakcji D1 `batch`, z ochroną
przed zmianą arkusza w innej karcie i przed zmianą `warehouse_stock`
od chwili dodania pozycji. Przy konflikcie nic się nie zapisuje.
W razie zmiany stanu magazynowego trzeba usunąć sporną pozycję
z arkusza, ponownie przeliczyć i dodać ją od nowa.

Stan magazynowy `NULL` pozostaje `Nieustalony`; jawnie policzone
`0` zapisuje się jako `0`, nie jako brak danych. Brakujące pozycje
nie są automatycznie zerowane.

## Endpoint

`GET /api/pl/inventory?warehouse=PL-TYCHY` — pobierz swój
otwarty arkusz i informację, czy zatwierdzanie jest włączone.

`POST /api/pl/inventory` (JSON z aktualną sesją, ten sam Origin):
- `{"action":"save","warehouseId":"PL-TYCHY","partId":"...","quantity":0}`
- `{"action":"remove","warehouseId":"PL-TYCHY","partId":"..."}`
- `{"action":"commit","warehouseId":"PL-TYCHY","inventoryId":"...","revision":0,"confirm":true}`

Serwer sprawdza role/uprawnienia D1, status konta, status magazynu,
aktywność części oraz aktualną wersję i przypisanie arkusza.
Klient nie przesyła ani ID aktora, ani aktualnego stanu magazynu:
serwer wylicza wszystko sam.

### Co będzie później

- Dalszy moduł skanowania części kodami kreskowymi podczas inwentaryzacji.
- Wprowadzenie historii inwentaryzacji do wspólnego panelu biurowego
  i administracyjnego.
- Możliwość rozbudowy do bardziej szczegółowych przebiegów inwentaryzacji.
- Finalne ujednolicenie grafiki mobilnej z głównym GPBS Storage.


## Skanowanie ciągłe, sumowanie i nowe części

Od kolejnego etapu ekran `/pl/` automatycznie otwiera aparat po wejściu
w Inwentaryzację. Obsługiwane są **QR i Code128**; korzysta z oddzielnego
`pl/inventory-scanner.js` i tego samego modułu biblioteki aparatu co FR,
ale bez zmian w głównej aplikacji FR.

Przebieg: skan → wstrzymanie odczytu → puste pole ilości z klawiaturą
numeryczną → `Dodaj` → wznowienie **tej samej sesji kamery** bez klikania
`Skanuj` ponownie. `X` zamyka skaner, zwalnia kamerę i przenosi
do wyszukiwania ręcznego po nazwie / numerze / SAP. Przycisk
`Otwórz skaner QR` pozwala wrócić do aparatu. Jeśli przeglądarka
nie otworzy klawiatury po programowym ustawieniu fokusu, użytkownik
może dotknąć już pustego pola — ograniczenie systemowej klawiatury
Android, nie aplikacji.

**Domyślnie wpisana ilość jest przyrostem** do sumy w bieżącym arkuszu:
5 + 8 + 6 = 19. Nie pokazujemy stanów bazowych w formularzu.
Osobny przycisk `Popraw sumę` służy świadomej korekcie całej ilości.

Weryfikacja i idempotencja:
- skan rozpoznawany wyłącznie względem znanych identyfikatorów części,
  indeksów GPBS / SAP lub surowego kodu nowej części, nigdy przez
  niepewne przybliżenia;
- `POST /api/pl/inventory` z `action:'add'` dodaje sztuki, a
  `action:'set'` świadomie zastępuje sumę;
- każde dodanie / korekta ma unikalny `PL-EVT-UUID` zapisywany z
  operacją w transakcji D1. Ponowienie tego samego żądania nie dolicza
  sztuk drugi raz;
- nieznany kod otwiera formularz dodania nowej części. **Nazwa
  jest obowiązkowa**; SAP może zostać zweryfikowany później;
- nowa część trafia do `parts` i `pl_part_verifications` ze statusem
  `PENDING`; stan magazynowy nadal jest nieustalony. W panelu admina
  cały wiersz jest czerwony do chwili świadomego zatwierdzenia danych
  przez administratora. W osobnym przyszłym panelu biurowym wykorzystamy
  ten sam status.

**Nowa jednorazowa migracja SQL przed korzystaniem z tych funkcji**:
`db/09-pl-inventory-scanning.sql`, wykonywana PO `db/08-pl-warehouse-inventories.sql`.
Tworzy `pl_warehouse_inventory_events` i `pl_part_verifications`;
nie zmienia stanów magazynowych, nie dotyka francuskiej aplikacji.

**Uwaga o testach:** przygotowanie arkusza i dodawanie nowych części
zmienia już dane D1 (arkusze i katalog), ale nie zmienia
`warehouse_stock`, dopóki flaga `PL_INVENTORY_PUBLISH_ENABLED`
pozostaje wyłączona. Nie twórz fikcyjnych części w katalogu produkcyjnym.
