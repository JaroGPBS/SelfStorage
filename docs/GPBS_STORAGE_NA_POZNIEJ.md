# GPBS Storage — lista tematów na później

**Aktualizacja:** 25.11.2026  
**Zasada:** lista ustaleń i pomysłów do późniejszej decyzji. Sam wpis **nie oznacza zgody na wdrożenie**. Aktualnie działających funkcji nie zmieniać bez osobnej akceptacji.

## CMR — Belleville

### Podpis kierowcy na tablecie — ODŁOŻONE
- Kierowca podpisuje dokument rysikiem/palcem na tablecie, po zapoznaniu się z treścią.
- Odręczny podpis z tabletu umieszczany jest automatycznie w **polu 23** konkretnego CMR.
- Podpisany dokument zapisuje się jako PDF, który można **wydrukować dla kierowcy** i **przekazać jako PDF do biura w Polsce**, bez fotografowania lub skanowania podpisanego papieru.
- Przed wdrożeniem ustalić sposób powiązania podpisu z niezmienną treścią dokumentu oraz akceptację takiego rozwiązania w obiegu transportowym. Sam obraz podpisu w PDF nie jest automatycznie formalnym systemem e-CMR.
- **Decyzja 25.11.2026:** na razie **nie wdrażać**. Aktualny generator CMR pozostaje bez zmian; podpisy na papierze.

### Blokada edycji po wydruku — WDROŻONA W KODZIE (25.11.2026)
- Pierwsze **„Zapisz i drukuj”** zapisuje aktualny PDF w prywatnym R2 i uruchamia **60 minut** na poprawki, według czasu serwera (D1).
- W tym czasie można zmienić dane i wydrukować aktualną wersję; ponowne drukowanie **nie przedłuża** limitu.
- Po 60 minutach CMR jest **tylko do odczytu i druku**; ponowne otwarcie pobiera archiwalny PDF zamiast generować go na nowo.
- Bez historii poprawek: w D1 jest tylko bieżąca wersja, a zastąpiony PDF jest usuwany z R2.
- Wymagane działające powiązania Cloudflare **DB (D1)** i **PART_PHOTOS (R2)**. Jeśli zapis lub weryfikacja blokady się nie uda, aplikacja wstrzymuje wydruk.
- Dotyczy CMR zapisanych przyciskiem od wdrożenia; wcześniejsze demonstracyjne podglądy nie miały rejestru wydruków i nie mogą zostać automatycznie zablokowane wstecz.
- Podpis kierowcy nadal jest osobnym, **odłożonym** zadaniem.

## Storage Admin — limity Cloudflare i zabezpieczenia R2
- Istniejąca, szczegółowa lista: [Monitoring Cloudflare / R2](admin-cloudflare-free-plan-usage-todo.md).
- Obejmuje m.in. planowany widok metryk i limitów Cloudflare oraz monitoring i zabezpieczenia R2. Szczegółowy stan prac i wyjątki są w podlinkowanym pliku — nie dublować tutaj ustaleń.

## Bovis — rzeczywiste operacje
- Istniejący plan: [Bovis — ustalenia i uruchomienie](BOVIS_USTALENIA_I_URUCHOMIENIE.md).
- Produkcyjne PZ/WZ, import i rzeczywista ewidencja są osobnym etapem po poznaniu prawdziwych dokumentów i procedur Bovis. Układu demonstracyjnego nie traktować jako uruchomionych danych.

## GPBS Service — koncepcja na przyszłość
- W rozmowie z 24.11.2026 omówiono osobny prywatny interfejs serwisowy z PIN-em, korzystający ze wspólnej D1 GPBS Storage, dla maszyn Belleville (NOK/OK), napraw i dokumentacji.
- **Status:** temat projektowy do dalszego ustalenia; sam zapis nie jest poleceniem implementacji.

---
Ta lista ma pomagać w kontynuacji prac w kolejnych rozmowach. Zmiany w kodzie lub bazie danych wdrażać dopiero po wyraźnej akceptacji użytkownika.
