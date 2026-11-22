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
- Endpoint /api/pl-routes-recognize wymaga sesji Office PL z rolą Admin/Kierownik/Koordynator. Z dokumentu wydobywa numer trasy, datę załadunku, nazwy/indeksy części oraz ilości. Nie odczytuje numerów seryjnych i podpisów.
- API dopasowuje pozycje jednoznacznie do katalogu PL w D1, sumuje powtórzenia, brak ilości przyjmuje jako 1 i oznacza niepewne wiersze.
- Zdjęcie jest wyświetlane obok edytowalnych danych. W przypadku aktualnie wpisanych części aplikacja pyta przed zastąpieniem listy. Użytkownik weryfikuje dane i dopiero potem klika „Zapisz trasę”.
- Rozpoznanie nie zapisuje nic do D1 ani R2. Dotychczasowe zapisanie trasy do D1 i archiwizacja skompresowanego JPEG do prywatnego R2 działają bez zmian.

## Testy przed użyciem produkcyjnym

- Zdjęcie WZ z kilkoma poprawnymi częściami; sprawdź datę, numer trasy, sumowanie powtórzeń i dopasowanie katalogu.
- Zdjęcie niewyraźne, nieczytelna ilość, nieznana nazwa i brak daty; sprawdź ostrzeżenia i możliwość ręcznych poprawek.
- Wybór niepoprawnego pliku/PDF; musi zostać odrzucony.
- Niedostępny binding AI; ręczny zapis nadal powinien działać, bez utraty zdjęcia.
- Zweryfikuj, że zdjęcie pojawia się w Szczegółach trasy dopiero po zapisaniu, a AI nie tworzy zapisów bez zatwierdzenia.
