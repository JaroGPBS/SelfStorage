# SelfStorage

Aplikacja magazynowa dla ekip serwisowych.

## Aktualny etap

Pierwszy szkielet aplikacji PWA:

- logowanie PIN,
- skan QR magazynu,
- ręczne wpisanie kodu magazynu,
- rozpoczęcie wizyty,
- zapamiętanie aktywnej wizyty po odświeżeniu,
- ekran Pobranie / Zwrot,
- zakończenie wizyty,
- grafitowy interfejs,
- Service Worker i manifest PWA,
- Cloudflare Pages Function `/api` jako bramka do Google Apps Script.

## Struktura

```text
SelfStorage/
├── index.html
├── css/
│   └── app.css
├── js/
│   ├── app.js
│   ├── api.js
│   ├── scanner.js
│   └── storage.js
├── functions/
│   └── api.js
├── icons/
│   └── app-icon.svg
├── manifest.webmanifest
└── service-worker.js
```

Następny etap: wdrożenie repo na Cloudflare Pages i test przepływu PIN → magazyn → aktywna wizyta → zakończenie.
