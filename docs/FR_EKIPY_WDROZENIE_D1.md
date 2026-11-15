# GPBS Storage — Francja: ekipy, stany i Office

Stan kodu: 15.11.2026. Ten plik opisuje realną integrację FR i ograniczenia przed wyczyszczeniem testów.

## Niezmienny wygląd
- Nie zmieniać dopracowanych ekranów Office: Stany samochodowe / Ekipy, Zestawienie zbiorcze, Stan części, Inwentaryzacje, Historia ruchów, eksport, druk i raporty.
- Nie przebudowywać aplikacji mobilnej: PIN, tablica, pierwsza inwentaryzacja, skan QR, pobrania i zwroty w jednej wizycie.
- Polska jest ukończona i zamrożona. Widok prezentacyjny Bovis również zamknięty; nie zamieniać go teraz na dane produkcyjne.
- Box Toulouse i Box Paryż mają rzeczywiste stany w D1; ich stanów nie czyścić ani nie podmieniać przy czyszczeniu testowych kont.

## Co zostało podłączone w kodzie
1. Admin zapisuje konta ekip i dostęp FR do D1. Po PIN mobilny Worker używa uwierzytelnionej sesji.
2. Mobilny Worker `/api/fr`: tablica rejestracyjna jest informacją. **Części należą do ekipy (`user_id`), nie do samochodu (`vehicle_id`)**.
3. Trzy nowe tabele `fr_crew_stock`, `fr_crew_first_inventory`, `fr_crew_stock_revisions` (definicje w `db/19-fr-crew-stock.sql`) są tworzone automatycznie przez Worker przy wywołaniu FR. Bez kopiowania historycznych stanów `vehicle_stock` — mogą być testowe.
4. Pierwsza nowa inwentaryzacja ustala bazowy stan danej ekipy. Inwentaryzacje i ręczne zmiany aktualizują jej bilans oraz zapisują historię zdarzeń. Zmiana tablicy nie przenosi części.
5. Zapis mobilnej sesji POBRANIE/ZWROT aktualizuje w jednym `db.batch` prawdziwy stan magazynowy Boxu, rozliczenie części ekipy oraz historię PZ/WZ; niedobory magazynowe są osobno odnotowywane. Nie wolno używać fikcyjnych prób na rzeczywistych stanach.
6. Office `/api/office?view=vehicleCrews` czyta stany według ekipy. Zestawienie zbiorcze sumuje wszystkie ekipy (a nie unikatowe tablice). Inwentaryzacje, raporty i ruchy są pobierane według `user_id`, z zachowaniem gotowego układu i drukowania.
7. Office `/api/office?view=frBoxVisits` pobiera ostatnie maks. 200 rzeczywiście zapisanych wizyt w uprawnionych Boxach. Widok „Ruchy magazynowe” i przejście do historii ekipy nie używają już przykładów wpisanych na sztywno. Dłuższą historię trzeba później stronicować; nie udawać, że 200 to pełne archiwum.
8. Synchronizacja stanu mobilnego używa wersji `fr_crew_stock_revisions`, aby nie pobierać całej bazy dla każdego rysunku czy wykresu.

## Co jeszcze wymaga rzeczywistego sprawdzenia
- Zapis na GitHubie nie dowodzi publikacji Cloudflare Pages. Nie stwierdzać, że pełny scenariusz działa, bez testu uwierzytelnionego telefonu, D1 i Office.
- Zapisane wcześniej inwentaryzacje oparte o `vehicle_stock` nie są automatycznie przenoszone do `fr_crew_stock`, żeby nie pomieszać testów. Stara ekipa wymaga nowej pierwszej inwentaryzacji, jeżeli ma zostać ponownie użyta.
- Przed trwałym usuwaniem fikcyjnych ekip sprawdzić ich identyfikatory i powiązania w D1. Zasadniczo konta, które wykonywały realne PZ/WZ, pozostają chronione przed automatycznym kasowaniem.
- **Jednorazowy wyjątek AA (12.11.2026)**: po potwierdzeniu przyciskiem „Usuń” Admin może cofnąć wyłącznie jeden historyczny **ZWROT** testowy `MG-000-022` do `FR-TOULOUSE`, i ustawić stan tej jednej pozycji na `0`, **tylko** gdy D1 potwierdzi oznaczenie konta testowego, dokładnie jedną operację, zgodność daty i indeksu, zgodną ilość oraz brak późniejszych ruchów części. Cofnięcie i usunięcie konta oraz jego historii są w jednym `db.batch`. Gdy cokolwiek odbiega od tych warunków, system blokuje operację bez zmiany magazynu. Kod wyjątku nie jest ogólną funkcją usuwania historii.
- Nie usuwać danych z `warehouse_stock` ani `vehicles` automatycznie i nie obiecywać, że rekordy D1 zostały wyczyszczone bez odczytu/weryfikacji.
- Po bezpiecznym wyczyszczeniu kont testowych przeprowadzić kontrolę: Admin tworzy nową ekipę → PIN → wpis tablicy → inwentaryzacja → skan oryginalnego QR Boxu → pobranie i zwrot → zapis w D1 → Office stany, historia i raport, poprawne sumy.
- Transfery francuskie i magazyn Belleville są osobnymi przyszłymi etapami. Nie dodawać teraz pozornie działających przycisków.

## Zasady obsługi danych
- Magazyn BOX przechowuje rzeczywisty stan na regale; konto ekipy przechowuje jej własne części. Tablica rejestracyjna nie jest kluczem magazynowym.
- Stan całkowity ekipy wynika z pierwszej inwentaryzacji + pobrań − zwrotów + ręcznych zmian + kolejnych inwentaryzacji; raporty i Office korzystają z historii zdarzeń.
- Nie usuwać chronionych polskich tabel ani fikcyjnej prezentacji Bovis.
