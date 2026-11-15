# GPBS Storage — Bovis: ustalenia i plan uruchomienia

Stan ustaleń: 15.11.2026. Ten plik służy do kontynuowania pracy w kolejnych rozmowach, bez odtwarzania wymagań z pamięci.

## Zasada główna
- W tej fazie projektujemy **wizualny układ modułów i dokumentów**. Nie uruchamiamy prawdziwych PZ/WZ ani importu, dopóki użytkownik nie pozna rzeczywistego procesu i rodzaju dokumentów. Nie dodajemy danych do Cloudflare D1.
- **Bovis Paryż** ma wyłącznie **fikcyjne dane pokazowe**. Przy nazwie magazynu widoczny jest czerwony napis „FIKCYJNE DANE SŁUŻĄCE DO PREZENTACJI”.
- **Bovis Lille, Nantes, Nancy, Marsylia i Tuluza** dostają **ten sam układ wizualny** (zakładki, tabelę, panel powierzchni, 12-miesięczny wykres i ramki), ale **bez fikcyjnych stanów, metrów, maszyn, numerów seryjnych i historii**. Nie wpisywać „0” zamiast nieznanego stanu. Puste pola oznaczać „—” / „Brak danych”.
- Nie przenosić tych zmian do Box Toulouse, Box Paryż, Belleville ani magazynów polskich. Polska jest ukończona i zamrożona.
- Stany samochodowe Bovis pozostają **na koniec**, nie dodawać ich teraz.

## Zakładki każdego magazynu Bovis
- Górne zakładki: **MODUŁY, CZĘŚCI, PZ, WZ**.
- W MODUŁY: **SUMA, OUTDOOR, INDOOR, BQ, NEW GEN**.
- **SUMA**: po lewej zwarta tabela typów modułów z kolumnami **OK (zielone), NOK (czerwone), SUMA** i „ŁĄCZNIE”. Po prawej, na tej samej wysokości, panel „POWIERZCHNIA MAGAZYNU”: **jeden pasek trójkolorowy: zajęte OK (niebieski), zajęte NOK (czerwony), wolne (jasne tło)**, z procentem powierzchni zajętej i wolnej; **dokładnie cztery kafelki w układzie 2×2**: Maszyny, Powierzchnia całkowita, Powierzchnia zajęta (OK+NOK), **Zajęte przez maszyny OK/NOK** (dwie wartości w jednym kafelku); pod nimi **jeden wykres na 12 miesięcy, również w prawym panelu**. Nie powielać wykresów pod całą tabelą i nie dokładać piątego kafelka.
- **Wykres miesięczny:** jeden słupek dla każdego miesiąca; **nad słupkiem skrócona nazwa miesiąca**, **wewnątrz dolnej części słupka liczba maszyn**, **pod słupkiem zajęta powierzchnia w m²**. Nad wykresem rok (demonstracja: 2026). Wysokość słupka odpowiada zajętemu procentowi całkowitej dostępnej powierzchni. Każdy słupek pokazuje 100% powierzchni magazynu, z trzema odcinkami pionowo: na dole OK (niebieski/szary), nad nim NOK (czerwony), u góry wolna przestrzeń (jasna). Wysokość każdej części jest proporcjonalna do odpowiedniej powierzchni w m². Nie dzielić słupków na lewą i prawą połowę. Dane demonstracyjne mają **wahać się między miesiącami**, nie rosnąć liniowo (np. 100, 80, 60, 95...). Grudzień 2026 pozostaje bez danych. Brak danych oznaczać jako brak, nie jako zerowy stan. Całość mieścić w prawym panelu; na węższych ekranach dopuszczalne przewijanie poziome.
- **OUTDOOR / INDOOR / BQ / NEW GEN**: lewa tabela numerów seryjnych z osobnymi kolumnami dla każdego typu modułu; w Paryżu dużo przykładowych numerów, osobno S/N OK i S/N NOK; prawa strona węższa (ok. 28%), z **małymi kafelkami 2×2** i trójkolorowym paskiem OK/NOK/wolne. Jeden kafelek pokazuje łącznie metraż OK i NOK (bez piątego kafelka). Poniżej podsumowanie **Razem / OK / NOK** dla wybranej grupy, z dopisaną powierzchnią OK i NOK w tej grupie. Bez miesięcznego wykresu w tych czterech zakładkach.
- Typy: OUTDOOR: FM, LQ, RQ, XS, ODL, ODR; INDOOR: CU, DUO, HICU, HIDUO, HIUno, CU RJ45, HICU RJ45; BQ: CU, DUO, CU OUT, DUO OUT; NEW GEN: CU, DUO L, DUO R. Nie zmieniać nazw i kolejności bez uzgodnienia.

## PZ/WZ — placeholder do chwili poznania procedury
- PZ: „Tutaj będzie można rejestrować dostawy modułów i części do [magazyn]. Po zapoznaniu się z procedurą przekazywania dokumentów i rzeczywistym sposobem przyjmowania oraz zapisywania dostaw ustalimy sposób wpisywania i wyświetlania danych, a także ewentualny import lub wydruk do pliku.”
- WZ analogicznie dla wydań.
- Nie wymieniać z nazwy firmy wysyłającej dokumenty: ich źródło, format, proces i odpowiedzialność **nie są jeszcze potwierdzone**.
- Nie zakładać, że dane przyjdą w Excelu. Format i import uzgodnić po otrzymaniu przykładowych dokumentów.

## Eksport
- W Paryżu istnieje pokazowe okno wyboru: grupa wszystkich modułów lub OUTDOOR/INDOOR/BQ/NEW GEN, poszczególne typy, status OK/NOK, wybór kolumn.
- Docelowe pola do raportu: **numer seryjny, data przyjęcia, numer tygodnia, nazwa trasy, numer trasy**; można dodać dalsze dopiero po poznaniu rzeczywistej dokumentacji.
- Obecnie generuje się **fikcyjny podgląd** oraz plik **CSV otwierany w Excelu**, nie rzeczywisty eksport dokumentów. CSV nie jest plikiem .xlsx. Nie sugerować, że prawdziwe dane zostały już podłączone.

## Jak później uruchomić prawdziwą logikę
1. Ustalić z użytkownikiem realny wzór i obieg dokumentów przyjęć/wydań, atrybuty przesyłki/trasy, daty, status potwierdzenia oraz reguły poprawek i anulowania.
2. Ustalić **stan początkowy** magazynu: przypisane numery seryjne, typy, status OK/NOK, datę początku ewidencji i powierzchnię magazynu. Bez datowanego stanu początkowego nie można rzetelnie odtworzyć wcześniejszych miesięcy.
3. Zapisywać potwierdzone ruchy PZ/WZ jako historię **per moduł (unikalny S/N)**: magazyn, rodzaj ruchu, data i czas, dokument, trasa/numer trasy jeśli istnieją, osoba wprowadzająca, status i korekty. Części mogą wymagać ewidencji ilościowej, moduły — S/N.
4. Metraż: magazyn ma zdefiniowaną całkowitą powierzchnię, typ maszyny lub konkretna maszyna ma zweryfikowane **zajęte m²**. Obecne 2 m² na maszynę w Paryżu to tylko przykładowa wartość; nie wdrażać jej automatycznie jako reguły.
5. **Stan na koniec miesiąca** odtwarzać z potwierdzonego stanu początkowego plus potwierdzonych PZ minus potwierdzonych WZ i korekt do godz. końca miesiąca, osobno dla statusów **OK i NOK**. Docelowy format wyliczonej historii: `{year,month,okCount,nokCount,okArea,nokArea}`. Z tego liczyć łączną liczbę maszyn, zajęte m², wolne m² i udział procentowy. Zmiana statusu OK↔NOK zmienia podział powierzchni, nie sumę maszyn. Zapis zmiany historycznej powinien aktualizować właściwe okresy; brak danych historycznych = „Brak danych”.
6. Eksport i widoki PZ/WZ pobierają po wdrożeniu **te same dane źródłowe**, dzięki czemu tabele, wykresy i pliki się zgadzają. Filtry muszą działać na realnych S/N i typach.
7. Przed przełączeniem: zatwierdzony model danych, uprawnienia i kontrola bezpieczeństwa, test w izolacji bez naruszania rzeczywistych stanów, potem świadoma decyzja użytkownika o uruchomieniu.

## Obecna sytuacja wdrożeniowa
- Widoki Bovis są pokazowe; **nie traktować jako podłączonej ewidencji**.
- PZ/WZ są placeholderami, bez formularzy i zapisów.
- Dane Paryża nie są zapisane do D1.
- Przed twierdzeniem, że UI działa na Cloudflare, należy **sprawdzić publikację i działanie w przeglądarce**. Zapis w GitHubie nie jest potwierdzeniem wdrożenia.
- W kolejnych rozmowach kontynuować od tego pliku i od implementacji w repozytorium, zamiast wymyślać wymagania na nowo.
