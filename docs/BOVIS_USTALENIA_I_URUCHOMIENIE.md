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
- **SUMA**: po lewej zwarta tabela typów modułów z kolumnami **OK (zielone), NOK (czerwone), SUMA** i „ŁĄCZNIE”. Po prawej, na tej samej wysokości, panel „POWIERZCHNIA MAGAZYNU”: pasek zajęta/wolna w %, kafelki **Maszyny, Powierzchnia całkowita, Zajęta powierzchnia, Wolna powierzchnia**, a pod nimi **JEDEN wykres na 12 miesięcy w prawym panelu**. Nie powielać wykresów pod całą tabelą, nie dodawać dodatkowego kafelka „Wykorzystanie 20%”.
- **Wykres miesięczny:** jeden słupek dla każdego miesiąca; nad słupkiem liczba maszyn na koniec miesiąca, poniżej słupka zajęta powierzchnia w m², dalej skrócona nazwa miesiąca. Nad wykresem rok (w demonstracji 2026). Wysokość słupka odpowiada zajętemu procentowi całkowitej dostępnej powierzchni. Brak danych oznaczać jako brak, nie jako zerowy stan. Całość musi zmieścić się w prawej wolnej części ekranu; mniejsze ekrany mogą przewijać wykres poziomo.
- **OUTDOOR / INDOOR / BQ / NEW GEN**: lewa tabela numerów seryjnych z osobnymi kolumnami dla każdego typu modułu; w Paryżu dużo przykładowych numerów, osobno S/N OK i S/N NOK; prawa strona węższa (ok. 28%), z małymi kafelkami 2×2 oraz podsumowaniem **Razem / OK / NOK** dla wybranej grupy. Bez miesięcznego wykresu w tych czterech zakładkach.
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
5. **Stan na koniec miesiąca** odtwarzać z potwierdzonego stanu początkowego plus potwierdzonych PZ minus potwierdzonych WZ i korekt do godz. końca miesiąca. Z tego liczyć liczbę maszyn, zajęte m², wolne m² i udział procentowy. Zapis zmiany historycznej powinien aktualizować właściwe okresy; brak danych historycznych = „Brak danych”.
6. Eksport i widoki PZ/WZ pobierają po wdrożeniu **te same dane źródłowe**, dzięki czemu tabele, wykresy i pliki się zgadzają. Filtry muszą działać na realnych S/N i typach.
7. Przed przełączeniem: zatwierdzony model danych, uprawnienia i kontrola bezpieczeństwa, test w izolacji bez naruszania rzeczywistych stanów, potem świadoma decyzja użytkownika o uruchomieniu.

## Obecna sytuacja wdrożeniowa
- Widoki Bovis są pokazowe; **nie traktować jako podłączonej ewidencji**.
- PZ/WZ są placeholderami, bez formularzy i zapisów.
- Dane Paryża nie są zapisane do D1.
- Przed twierdzeniem, że UI działa na Cloudflare, należy **sprawdzić publikację i działanie w przeglądarce**. Zapis w GitHubie nie jest potwierdzeniem wdrożenia.
- W kolejnych rozmowach kontynuować od tego pliku i od implementacji w repozytorium, zamiast wymyślać wymagania na nowo.
