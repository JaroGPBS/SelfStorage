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
