# TODO — monitoring limitów bezpłatnego planu Cloudflare w panelu administracyjnym

**Status:** do późniejszego wdrożenia. Ustalenie z 03.11.2026. **Nie implementować teraz.**

## Potrzeba
W panelu **administracyjnym** GPBS Storage dodać widok wykorzystania limitów usług Cloudflare, aby w początkowej fazie użytkowania oceniać, czy darmowy plan wystarcza.

## Wymagania
- Pokazać **wykorzystanie / limit / pozostało**, w wartościach bezwzględnych i procentowo.
- Pokazać **okres rozliczania limitu** (np. dzienny lub miesięczny), datę/godzinę ostatniego odczytu oraz — gdy wiadomo — datę resetu.
- Objąć usługi i metryki rzeczywiście wykorzystywane w projekcie, w szczególności D1 (odczyty, zapisy, rozmiar danych), Workers/Pages (żądania lub inne obowiązujące limity) oraz ewentualne kolejne usługi Cloudflare.
- Czytelnie odróżnić dane pobrane z oficjalnego źródła od **szacunków**. Jeśli limit/zużycie nie jest dostępne przez API, nie podawać wymyślonej liczby.
- Opcjonalnie dodać ostrzeżenia przy wysokim wykorzystaniu (np. 75% i 90%) oraz krótką historię trendu zużycia.
- Wskaźniki dostępne **wyłącznie administratorowi**. Nie pokazywać ich w panelu biurowym ani aplikacji pracowników.

## Warunki techniczne do sprawdzenia przed wdrożeniem
- Zweryfikować aktualne limity darmowego planu i sposób ich pomiaru w oficjalnej dokumentacji Cloudflare — limity i API mogą się zmieniać.
- Sprawdzić dostępność i dokładność metryk Cloudflare Analytics/API oraz wymagane uprawnienia.
- Dostęp do metryk realizować serwerowo przez sekret z minimalnym zakresem uprawnień; **nie umieszczać tokena Cloudflare w kodzie przeglądarki**.
- W przypadku liczników własnych określić ich zakres i ograniczenia, aby nie przedstawiać ich jako oficjalnych danych rozliczeniowych.

**Ważne:** To jest zapisany punkt prac na później; nie zmienia bieżących limitów, konfiguracji Cloudflare ani kodu panelu.

## R2 — zabezpieczenie kosztów i automatyczne blokady (ustalenie z 05.11.2026)

**Status:** podstawowa ochrona zapisu do R2 została wdrożona w API przy uruchamianiu zdjęć (limit 9 GB własnych plików aplikacji, limit 20 000 zapisów i 200 000 odczytów miesięcznie). **Pełny ekran monitoringu i ostrzeżenia w Storage Admin są nadal do wykonania.**

**Powód:** R2 jest aktywowane z **prywatną kartą płatniczą** właściciela projektu. Sam darmowy limit nie jest twardym ograniczeniem opłat. Nie można polegać jedynie na powiadomieniach o rachunku.

**Ustalony zakres:**
- W **Storage Admin** dodać sekcję R2: wykorzystana przestrzeń, liczba operacji zapisu/odczytu, limity, dostępne zasoby, daty okresu i czas ostatniej aktualizacji.
- Dla klasy Standard: **ostrzeżenie przy 8 GB**, **automatyczna blokada dodawania zdjęć przy 9 GB**; progi trzymać w konfiguracji, aby dało się je później zmienić.
- Monitorować również **miesięczne operacje klasy A i B**; ustalić bezpieczne progi ostrzegania i blokady z zapasem poniżej limitu, sprawdzając przy wdrożeniu obowiązujące limity R2.
- Blokada ma obejmować nowe wysyłanie i zastępowanie zdjęć, **nie może blokować** pracy magazynu: PZ, WZ, inwentaryzacji, wyszukiwania części ani odczytu wcześniej zapisanych zdjęć (o ile osobny limit odczytów nie wymaga ograniczenia).
- W przypadku błędu odczytu metryk / niemożliwości potwierdzenia dostępnego limitu nowe operacje mogące powiększyć zużycie mają zostać wstrzymane (**fail closed**), z jasnym komunikatem dla administratora.
- Dodatkowo ograniczyć maksymalny rozmiar pojedynczego pliku i tempo przesyłania; dostęp do R2 wyłącznie przez autoryzowany backend, bez publicznych zapisów i bez kluczy w przeglądarce.
- **Bezpieczeństwo uploadu R2:** API przyjmuje zdjęcia JPG/JPEG, PNG, BMP, WEBP, HEIC/HEIF/AVIF po weryfikacji rozszerzenia, MIME i sygnatury pliku, blokuje ZIP, wideo, SVG i dokumenty. Wspomagająca walidacja w przeglądarce nie zastępuje kontroli serwera. Docelowo warto dodać również pełne dekodowanie obrazów po stronie serwera.
- Po jednorazowej obróbce zdjęcia zastępować oryginał wersją lekką i **usuwać oryginał**; nie przechowywać dwóch trwałych kopii.
- Rozważyć alerty Cloudflare Billing jako **dodatkowe** ostrzeżenie, niezależne od blokady w aplikacji.

**Ważne ograniczenie:** Blokady po stronie GPBS Storage mogą skutecznie ograniczać własne żądania aplikacji, ale **nie gwarantują zerowych opłat** za wszelkie operacje na koncie Cloudflare (np. ręczne operacje lub inne usługi). Oficjalne statystyki mogą aktualizować się z opóźnieniem; własne liczniki i margines bezpieczeństwa trzeba zaprojektować ostrożnie. Nie przedstawiać rozwiązania jako twardego limitu rozliczeniowego Cloudflare.

**Kolejność:** podstawowe ograniczenia w API już istnieją, a przy rozbudowie Storage Admin dodać prezentację faktycznego wykorzystania R2, ostrzeżenie przy 8 GB, limity konfigurowalne oraz niezależne alerty Cloudflare Billing. Obecne liczniki obejmują wyłącznie operacje wykonywane przez aplikację, nie całe konto Cloudflare.
