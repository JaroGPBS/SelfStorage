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

## Zakończenie inwentaryzacji i publikowanie stanów

Zgodnie z decyzją użytkownika, **polskie magazyny mogą już zatwierdzać
rzeczywiste stany**. Po wdrożeniu bieżącej wersji endpoint domyślnie
umożliwia zakończenie inwentaryzacji; wyłącznie użytkownik z ważnym
PIN-em i uprawnieniami do danego, aktywnego magazynu PL ma dostęp.
System nigdy nie publikuje przez ten endpoint do magazynów FR.

Opcjonalny wyłącznik bezpieczeństwa: w Cloudflare Pages Production
`PL_INVENTORY_PUBLISH_ENABLED=false` blokuje zatwierdzanie, ale nie
blokuje skanowania i tworzenia arkusza. Wartość `true` lub brak
zmiennej zezwala na zatwierdzanie w aktywnych magazynach PL.

`Zakończ inwentaryzację` pobiera aktualne podsumowanie z serwera,
prezentuje liczbę policzonych i niepoliczonych **pozycji katalogowych**
oraz liczbę nowych pozycji do weryfikacji. Po świadomym potwierdzeniu
jedna transakcja D1:
- weryfikuje stan arkusza, uprawnienia pracownika i wszystkie
  zapamiętane stany bazowe;
- zapisuje historię przed/po każdej policzonej części;
- aktualizuje WYŁĄCZNIE policzone części w `warehouse_stock`;
- kończy arkusz i pozwala na rozpoczęcie kolejnego.

Niepoliczone części zachowują poprzednie stany, a te bez zapisanego
stanu pozostają `Nieustalony`. `0` jest zapisywane wyłącznie
jeśli pracownik świadomie policzył zero.

Przycisk `Historia zakończonych inwentaryzacji` otwiera listę
ostatnich 20 zatwierdzonych arkuszy dla wybranego magazynu PL,
z datą, operatorem i liczbą pozycji (odczyt z D1).
Szczegółowe wpisy przed/po pozostają w
`pl_warehouse_inventory_changes` do przyszłych raportów biurowych.

Nie ma już limitu 30 pozycji. Arkusz dopuszcza do **5000 różnych
części** (techniczny bezpiecznik znacznie powyżej zakładanych
300+), a zatwierdzenie używa **3 instrukcji SQL w jednej transakcji**,
nie dwóch instrukcji na każdą część. Gwarantuje atomowy zapis
przy dużych arkuszach i zachowanie historii.

## Obsługa

1. W aplikacji magazyniera wybierz `Inwentaryzacja`.
2. Wyszukaj część po nazwie, numerze części albo SAP i wybierz ją.
3. Wpisz faktyczną ilość. `0` jest dozwolone tylko jako świadome
   potwierdzenie, że części nie ma. Puste pole oznacza `niepoliczona`.
4. Zapisz do roboczego arkusza; można ją `Popraw sumę` lub `Usuń`.
   Arkusz zachowuje się po odświeżeniu strony.
5. Zakończenie zapisuje jednocześnie wszystkie policzone pozycje
   w bieżącym arkuszu i ich historię. Arkusz mieści 5000 różnych części;
   po zatwierdzeniu można prowadzić kolejny.
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

- Wprowadzenie historii inwentaryzacji do wspólnego panelu biurowego
  i administracyjnego.
- Możliwość rozbudowy do bardziej szczegółowych przebiegów inwentaryzacji.
- Finalne ujednolicenie grafiki mobilnej z głównym GPBS Storage.


## Skanowanie na żądanie, sumowanie i nowe części

Na ekranie `/pl/` aparat jest **domyślnie wyłączony**. Pracownik
klika `Skanuj`, odczytuje jeden kod QR lub Code128, a aplikacja
**natychmiast zatrzymuje i zwalnia kamerę** przed pokazaniem okienka
z nazwą części i pustym polem ilości. `Dodaj` zapisuje policzoną
ilość w arkuszu, nie uruchamiając ponownie aparatu. Każdy następny
skan wymaga ponownego kliknięcia `Skanuj`.

Przycisk `X` zamyka aparat, a `Wyszukaj lub dodaj część ręcznie`
jest dostępny również na ekranie przy wyłączonym skanerze.
Aplikacja nie włącza automatycznie kamery po powrocie z tła,
po anulowaniu liczenia ani po zapisaniu nowej części.
Zmiana ogranicza zużycie baterii, nagrzewanie telefonu i ryzyko
odczytu przypadkowych kodów podczas przemieszczania się.

Skaner wykorzystuje oddzielny `pl/inventory-scanner.js`, bez
zmiany głównej francuskiej aplikacji.

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

### Pole ilości na telefonie

Klawiatura numeryczna zawsze jest dostępna w oknie liczenia:
cyfry 0–9, wyczyszczenie (`C`) i cofnięcie jednej cyfry (`⌫`).
Nie ma potrzeby wywoływania klawiatury systemowej Androida.
Po `Dodaj` kamera pozostaje wyłączona; następny skan wymaga
świadomego ponownego naciśnięcia `Skanuj`.


## Docelowy „punkt zero” po testach — NIE wykonywać teraz

Reset testowych stanów powinien być oddzielną, wyraźnie oznaczoną
operacją **tylko w panelu administracyjnym**, nie dostępną dla
magazyniera. Administrator wybiera konkretny aktywny magazyn PL
(np. PL-TYCHY), widzi podsumowanie wpływu i potwierdza kodem
/ wymaganą frazą. Przed wykonaniem tworzymy eksport stanu i
historyczne zdarzenie resetu; następnie w jednej kontrolowanej
operacji czyścimy `warehouse_stock` tylko dla wybranego magazynu,
a jego niezakończone arkusze unieważniamy, aby nie mogły zostać
opublikowane po resecie. **Nie wolno kasować katalogu części
wspólnego dla magazynów ani historii audytu bez oddzielnej zgody**.
Przy resetowaniu testowo dodanych części trzeba je najpierw
wytypować po `pl_part_verifications` i sprawdzić zależności.

Nie uruchamiaj ręcznego `DELETE FROM warehouse_stock` w produkcji
bez tego procesu — jest ryzyko starych arkuszy i utraty śladu zmian.
Na obecnym etapie resetu NIE implementujemy ani nie wykonujemy.
