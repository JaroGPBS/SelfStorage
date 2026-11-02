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

Otwórz Cloudflare -> D1 -> testowa baza \`gpbs-storage\` -> Console.
Jeżeli migracja \`db/11-pl-warehouse-sessions.sql\` została już
wykonana, uruchom JEDNORAZOWO kolejną:

\`db/12-pl-uninventoried-receipts.sql\`

Dodaje ona wyłącznie kolumnę \`before_unknown\` do historii PZ/WZ.
Nie zmienia stanów, nie usuwa operacji ani inwentaryzacji.
Przy nowej bazie wykonaj migracje 11, następnie 12 i 13.
Nie uruchamiaj ponownie migracji, jeżeli kolumny już istnieją.

Bez migracji 13 aplikacja zablokuje nowe PZ/WZ i wyświetli
informację, co trzeba wykonać. Nie zmieniaj kluczy PIN i sesji.

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
- **Pierwsze PZ bez inwentaryzacji jest dozwolone.** Jeśli wcześniej
  część katalogowa miała stan „Nieustalony”, przyjęcie np. 10 szt.
  ustala zapisany stan na 10. Nie oznacza to potwierdzenia, że nie
  było wcześniej innych sztuk; to ustali późniejsza inwentaryzacja.
- Historia przyjęcia zachowuje \`before_unknown=1\`, a panel wyświetla
  poprzedni stan jako „Nieustalony”, nie jako fałszywe zero.
- **WZ może przekroczyć zapisany stan**, także gdy stan jest nieustalony.
  Aplikacja pobiera aktualne ilości z D1, a w już istniejącym oknie
  zatwierdzenia wyświetla czerwone ostrzeżenie
  „Wydajesz więcej niż jest na stanie. Czy na pewno ilość się zgadza?”.
  Magazynier może wrócić lub potwierdzić podaną ilość.
- WZ zapisuje całą faktycznie wydaną ilość (np. 8 przy stanie 5).
  `warehouse_stock` pozostaje nieujemny (stan 0); niedobór 3 szt.
  jest zapamiętany w `pl_warehouse_session_lines.shortage_quantity`
  i na czerwono wyświetlany w panelu biurowym. Nie znika z historii.
  W przypadku wcześniej nieustalonego stanu ostrzeżenie nie twierdzi,
  że brak rzeczywisty jest dokładnie znany.
- Zmiana stanu po podglądzie, a przed zapisem, powoduje odrzucenie
  całej sesji i konieczność ponownej weryfikacji ostrzeżenia.
  Sesja PZ/WZ nadal zapisywana jest atomowo i idempotentnie.
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

1. Magazynier Tychy -> PZ: przyjmij 10 szt. części o stanie Nieustalony.
   Po zapisaniu stan 10, poprzedni stan w historii: Nieustalony.
2. W tym samym szkicu PZ i WZ na różnych częściach:
   zatwierdź, sprawdź oba salda i oba wiersze historii.
3. PZ i WZ tej samej części: sprawdź wynik netto i obie migawki.
4. Sam WZ: sprawdź prawidłowe zmniejszenie ilości.
5. Próba WZ 8 szt. przy znanym stanie 5: czerwone ostrzeżenie,
   zatwierdzenie, zapis 8 szt., stan 0 i 3 szt. niedoboru w panelu.
   Rezygnacja w dialogu nie zapisuje żadnej operacji.
6. Samo WZ przy stanie Nieustalony: ostrzeżenie o nieznanym stanie;
   po potwierdzeniu zapis z flagą nieustalonego stanu.
   PZ 10 + WZ 4 tego indeksu w jednej sesji: stan 6 bez ostrzeżenia.
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
- Historia PZ/WZ jest w panelu biurowym (zakładka Ruchy PZ/WZ),
  nie w mobilnej aplikacji magazyniera.
- Nie ma jeszcze podpisu ani załączników.
