# Self Storage / PL — jedna sesja obsługi PZ i WZ

## Zakres

W magazynie PL pracownik z rolą ADMIN, KIEROWNIK lub MAGAZYNIER
przypisaną do aktywnego magazynu może w jednym ekranie:
1. Wprowadzić jedną nazwę: ekipa, dostawca lub odbiorca.
2. Dodać pozycje przyjęcia PZ, wydania WZ lub obu rodzajów.
3. Skanować QR/Code128 **na żądanie** albo wyszukiwać po nazwie, indeksie, SAP.
4. Zatwierdzić całą sesję jednym przyciskiem i potwierdzeniem.
5. Otrzymać identyfikator sesji oraz liczbę pozycji PZ i WZ.

Oba przyciski na ekranie magazynu prowadzą do **TEJ SAMEJ** sesji,
z odpowiednio wybraną zakładką początkową. Data/godzina sesji,
operator i magazyn pochodzą z serwera/sesji, nie z formularza.

## Przed rozpoczęciem testów w Cloudflare

Otwórz Cloudflare -> D1 -> testowa baza \`gpbs-storage\` -> Console
i uruchom JEDNORAZOWO całość migracji:

\`db/11-pl-warehouse-sessions.sql\`

Migracja wyłącznie tworzy dwie nowe tabele i indeksy, niczego
nie kasuje i nie aktualizuje: \`pl_warehouse_sessions\`,
\`pl_warehouse_session_lines\`.

Bez tej migracji ekran wyświetla informację i nie pozwoli zapisać
PZ/WZ. Nie zmieniaj ustawień \`PIN_PEPPER\` ani \`PANEL_SESSION_SECRET\`.

Endpoint: \`GET /api/pl/session?warehouse=PL-TYCHY\`
— gotowość do zapisu; \`view=recent\` — 15 ostatnich sesji.

\`POST /api/pl/session\`, z ważnym cookie pracownika:

\`\`\`json
{
  "id": "PL-SES-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "warehouseId": "PL-TYCHY",
  "counterparty": "Ekipa MT",
  "pz": [{"partId": "GPBS-P-000001", "quantity": 5}],
  "wz": [{"partId": "GPBS-P-000002", "quantity": 3}]
}
\`\`\`

ID jest nowym UUID przygotowanym po stronie przeglądarki,
a API weryfikuje magazyn, autoryzację, role i części. Nie wysyłamy PIN-u.

## Zasady bezpieczeństwa

- **Jeden batch D1:** sesja, pozycje PZ/WZ, migawki przed/po i zmiany
  magazynowe są zapisywane atomowo. Nie może zapisać się tylko PZ.
- Pozycje bez ustalonego stanu (\`warehouse_stock\` bez wiersza)
  są **blokowane**. Inwentaryzacja powinna być wykonana przed
  pracą. Stan 0 jest odmienny od braku stanu.
- WZ nie może doprowadzić do ujemnego stanu. Jeśli ta sama część
  występuje w PZ i WZ, rozliczamy PZ, a następnie WZ, w ramach
  pojedynczego atomowego salda.
- Serwer odrzuca nieaktywne części, konta, magazyny i brak grantów.
  Uprawnienia są również sprawdzane **w samej transakcji**.
- Powtórne wysłanie tego samego ID z identycznymi danymi jest
  idempotentne (nie nalicza ponownie). Inne dane dla ID => błąd.
- Po niepewnym błędzie sieci aplikacja utrzymuje ID oraz dane żądania
  w sessionStorage przeglądarki i umożliwia bezpieczne ponowienie.
- Roboczy szkic przechowywany jest lokalnie **w obrębie karty/sesji
  przeglądarki**. Nie jest to trwały szkic serwerowy, zatem
  całkowite wyczyszczenie danych przeglądarki może go utracić.
- Dane sesji nie zmieniają istniejącej aplikacji FR ani jej API.
- Zdjęcia dokumentów i podpis nie są częścią tego etapu.
  Podpis dla Belleville został uzgodniony jako przyszła wymagana
  funkcja, wdrażana osobno.

## Testy ręczne po migracji

1. Magazynier Tychy -> PZ: dodaj pozycję ze znanym stanem,
   zapisz, sprawdź zwiększenie ilości, godzinę i zapis sesji.
2. W tym samym szkicu PZ i WZ na różnych częściach:
   zatwierdź, sprawdź oba salda i oba wiersze historii.
3. PZ i WZ tej samej części: sprawdź wynik netto i obie migawki.
4. Sam WZ: sprawdź prawidłowe zmniejszenie ilości.
5. Próba WZ większego niż możliwy stan: HTTP 409 i **zero zmian**.
6. Próba operacji na stanie \`Nieustalony\`: HTTP 409.
7. Symulacja ponownego wysłania tej samej sesji: odpowiedź
   \`alreadySaved=true\`, stany bez podwójnej zmiany.
8. Druga rola/magazyn bez uprawnień: HTTP 403.
9. Odczyt historii przez \`/api/pl/session?view=recent&warehouse=...\`.
10. Kontrola, że magazyny FR i stary \`PL-TEST\` nie zostały naruszone.

Przy testach na prawdziwym magazynie Tychy operacje **zmieniają D1**.
Nie wykonuj losowych testów na żywych ilościach bez świadomej zgody
osoby odpowiedzialnej za stan. Docelowe uruchomienie firmy użyje
nowej, czystej D1, jak w \`docs/clean-production-d1-launch.md\`.

## Aktualne ograniczenia

- Jeden wspólny identyfikator sesji, nie ma jeszcze osobnych
  drukowalnych numerów dokumentów PZ/WZ.
- Panel biurowy nie ma jeszcze zakładki historii tych sesji;
  API ma kontrolowany odczyt ostatnich 15.
- Nie ma jeszcze podpisu ani załączników.
