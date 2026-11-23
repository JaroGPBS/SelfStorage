# Office PL — odczyt AI zdjęcia WZ

Funkcja jest częścią istniejącego formularza **Polska → Trasy → Dodaj trasę → Załaduj ze zdjęcia**. Nie ma oddzielnego modułu OCR.

## Konfiguracja Cloudflare Pages

1. Cloudflare Dashboard → **Workers & Pages** → projekt z panelem Office → **Settings**.
2. Dla środowiska **Production** wybierz **Bindings → Add → Workers AI**.
3. Ustaw nazwę bindingu **AI** (wielkie litery) i zapisz.
4. Wykonaj ponowne wdrożenie projektu Pages, aby funkcja miała dostęp do env.AI.
5. Jeśli chcesz testować na preview, powtórz binding także w środowisku **Preview**.

Nie jest wymagany osobny klucz API w JavaScript przeglądarki. Serwer wywołuje model @cf/cloudflare/clairic przez binding. Bez bindingu wysyłanie do AI zwróci czytelny komunikat; ręczne wprowadzanie tras i istniejące archiwum R2 nadal działają.

## Przepływ

- Wybierany jest jeden plik zdjęcia JPG/PNG/WEBP/HEIC/HEIF do 15 MB; aplikacja weryfikuje rzeczywisty typ.
- Oryginał obsługiwanego formatu do 4 MiB trafia do AI przed kompresją archiwalną. Większe zdjęcia i HEIC/HEIF są konwertowane w przeglądarce na czytelną wersję JPEG do 4 MiB tylko na potrzeby AI.
- Endpoint /api/pl-routes-recognize wymaga sesji Office PL z rolą Admin/Kierownik/Koordynator. Dwa przebiegi Workers AI czytają osobno pełną fotografię (numer trasy, data, liczba wierszy Lp.) oraz powiększony środkowy fragment tabeli. Dla tabel do 20 wierszy model rozpoznaje skład każdego Lp. jako listę osobnych wydawanych elementów: model paczkomatu, dach, osłona, kotwy itd. Jeden numer Lp. może dać kilka pozycji części w Office. Nie traktuje się nazw sklepów, adresów i numerów seryjnych jako części.
- API dopasowuje pozycje jednoznacznie do katalogu PL w D1, **nie łączy** numerowanych wierszy nawet dla identycznych nazw, wykrywa przerwy w numeracji oraz wstawia puste wiersze do ręcznego uzupełnienia. Nieczytelne ilości pozostają puste. Nie zgaduje brakujących ilości ani nie pozwala zapisać trasy z pustymi pozycjami/ilościami.
- Zdjęcie jest wyświetlane obok edytowalnych danych (etykiety Lp.). W przypadku aktualnie wpisanych części aplikacja pyta przed zastąpieniem listy. Jeśli data nie zostanie odczytana, nie pozostaje domyślna dzisiejsza. Użytkownik weryfikuje dane i dopiero potem klika „Zapisz trasę”.
- Rozpoznanie nie zapisuje nic do D1 ani R2. Dotychczasowe zapisanie trasy do D1 i archiwizacja skompresowanego JPEG do prywatnego R2 działają bez zmian.

## Testy przed użyciem produkcyjnym

- Zdjęcie WZ z sześcioma wierszami; sprawdź numer trasy, datę, sześć oddzielnych wierszy Lp. i dopasowanie katalogu. Identyczne nazwy w różnych wierszach nie mogą być sumowane.
- Zdjęcie niewyraźne, nieczytelna ilość, nieznana nazwa i brak daty; sprawdź ostrzeżenia, puste ilości i datę, numerowane puste wiersze oraz możliwość ręcznych poprawek. Próba zapisu bez uzupełnienia ma zostać zablokowana.
- Wybór niepoprawnego pliku/PDF; musi zostać odrzucony.
- Niedostępny binding AI; ręczny zapis nadal powinien działać, bez utraty zdjęcia.
- Zweryfikuj, że zdjęcie pojawia się w Szczegółach trasy dopiero po zapisaniu, a AI nie tworzy zapisów bez zatwierdzenia.

## Układ interfejsu (listopad 2026)

- Kolumny Indeks SAP/GPBS, Nazwa części i Ilość mają **jeden wspólny nagłówek**; pola w wierszach nie powtarzają etykiet.
- Podgląd zdjęcia otwiera wewnątrz formularza osobny panel powiększenia z plus/minus/reset/zamknij; nie otwiera nowej karty.
- Zawartość jednego drukowanego Lp. jest rozdzielana na części fizyczne. Ilość w rodzaju `4x kotwa` jest wyodrębniana jako liczba 4; brak ilości zostaje pusty.
- Zachowujemy oryginalną weryfikację przez pracownika przed zapisem do D1 oraz archiwizację zdjęcia do R2.

Test kontrolny: na zdjęciu sześciu paczkomatów może być więcej niż sześć pozycji części, np. jeden wiersz oznaczony Lp. 1 zawiera STANDARD CFM-Q, dach, osłonę i cztery kotwy — cztery odrębne wiersze formularza, z zachowaniem ilości.
