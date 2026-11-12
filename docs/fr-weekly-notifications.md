# GPBS Storage FR — cotygodniowe inwentaryzacje / powiadomienia

Zakres:
- Admin -> Powiadomienia FR: dzień tygodnia, godzina (Europe/Paris), treść, włącz/wyłącz.
- Ekipy: po terminie informacja "Wymagana inwentaryzacja", bez blokad.
- Office -> Stany samochodowe -> ekipa: pominięte tygodnie, np. 46/2026.
- D1: stan magazynu i dotychczasowe kody QR pozostają bez zmian.
- Wcześniejsze tygodnie nie są naliczane. Liczenie zaczyna się od włączenia harmonogramu.
- Jeden raport inwentaryzacji na tydzień wystarcza, niezależnie od samochodu.

## Konfiguracja Web Push — jednorazowo (nie jest wykonywana przez sam commit GitHub)

1. Utwórz parę kluczy VAPID P-256 dla Web Push. Utrzymuj prywatny klucz w
   Cloudflare Secrets; nigdy nie umieszczaj go w GitHubie ani nie wklejaj do czatu.
   Public key: niejawny nie jest, ale musi pochodzić z dokładnie tej samej pary.
2. W środowisku Cloudflare Pages GPBS Storage ustaw zmienną tekstową
   VAPID_PUBLIC_KEY (Base64 URL-safe bez paddingu).
3. Utwórz osobny Cloudflare Worker z pliku workers/fr-weekly-reminder.js.
   Punktem wyjścia jest wrangler.fr-weekly.example.toml — wpisz prawdziwy
   database_id istniejącej bazy D1 gpbs-storage, binding "DB". NIE twórz
   drugiej, pustej bazy.
4. Dodaj do Workera VAPID_PUBLIC_KEY oraz VAPID_PRIVATE_KEY jako Secrets;
   ewentualnie VAPID_SUBJECT jako URL kontaktowy https://... lub mailto:...
5. Ustaw Cron */5 * * * * (UTC). Worker sam porównuje dzień i godzinę w
   Europe/Paris, więc uwzględnia zmianę czasu.
6. W Admin -> Powiadomienia FR ustaw i zapisz termin i treść.
7. Ekipa uruchamia aplikację mobilną i klika "Włącz przypomnienia na telefonie",
   akceptując zgodę systemową. iPhone wymaga aplikacji dodanej do ekranu głównego
   (iOS 16.4+). Powiadomienie po dotknięciu tylko się zamyka.

Do czasu konfiguracji punktów 1–5 mechanizm pominiętych tygodni i komunikat
w aplikacji mogą działać, ale PUSH NA ZAMKNIĘTY TELEFON NIE BĘDZIE WYSYŁANY.

Koszt: Cron co 5 minut odczytuje harmonogram z D1 (~288 sprawdzeń dziennie).
Dopiero gdy nadejdzie właściwy dzień i godzina, sprawdza inwentaryzacje.
D1 i Worker podlegają limitom faktycznego planu Cloudflare.
