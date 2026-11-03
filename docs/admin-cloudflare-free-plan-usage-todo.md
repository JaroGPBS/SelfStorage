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
