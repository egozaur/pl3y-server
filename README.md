# pl3y-server

Wspólny serwer gier PL3Y: jeden Cloudflare Worker (`pl3y-server`) z Durable Objects dla Mafii, Kurczaczy Imperium, Milionerów, Tajniaków, Rozejrzyj się oraz graczy (nick + PIN) i Wordle PL. Strony gier są w osobnych repozytoriach (`egozaur/<gra>`), lobby w `egozaur/egozaur.github.io`.

## Wdrożenie

1. Konto Cloudflare, token API z uprawnieniem „Edit Cloudflare Workers” i Account ID.
2. W repo GitHub dodaj sekrety `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` oraz zmienną Actions `DEPLOY_ENABLED=true`.
3. Push na `main` uruchamia testy, a przy `DEPLOY_ENABLED=true` także deploy (`.github/workflows/worker.yml`).
4. Ręcznie: `npm install && npx wrangler deploy`.

Nie zmieniaj nazw klas Durable Objects ani istniejących tagów `[[migrations]]` w `wrangler.toml` (to skasowałoby dane). Nowa klasa DO = nowy tag migracji. Usunięcie gry = migracja z `deleted_classes`.

## Hasło i sesje (sekrety Cloudflare)

```
npx wrangler secret put PL3Y_PASSWORD       # długie hasło
npx wrangler secret put PL3Y_TOKEN_SECRET   # losowy klucz podpisu, np. openssl rand -base64 48
npx wrangler secret put PL3Y_TEST_SECRET    # sekret testów E2E z localhost (opcjonalny)
```

Tryb bramki: zmienna `AUTH_MODE` w `wrangler.toml` (`required` domyślnie; brak sekretów = 503, serwer nigdy nie zostaje otwarty). Zmiana hasła: ponownie `secret put PL3Y_PASSWORD`. Wylogowanie wszystkich: zmień `PL3Y_TOKEN_SECRET` (zmienia też słowo dnia Wordle i unieważnia tokeny graczy, chyba że ustawiono `PL3Y_WORDLE_SECRET`).

Kolejność wdrożenia przy `required`: 1) sekrety, 2) strony (lobby i gry), 3) Worker. Sprawdzenie: `curl -i -X POST https://pl3y-server.pl3y.workers.dev/api/rooms -H "Origin: https://pl3y.pl"` ma dać 401.

## Gracze: reset PIN-u przez Discord

Zapomniany PIN → „Nie pamiętam PIN-u” → Worker wysyła na Discorda link „Reset”. Konfiguracja: Discord → ustawienia kanału → Integracje → Webhooki → Nowy webhook → kopiuj URL, potem `npx wrangler secret put PL3Y_DISCORD_WEBHOOK`. Bez sekretu prośby nigdzie nie trafiają. Link jest podpisany, ważny 7 dni, jedna prośba na nick na godzinę.

## Testy

`node --test test/all.test.js` (to samo robi CI). Lokalny Worker: `npx wrangler dev` (z `--var ALLOW_LOCALHOST:true` i sekretami jako `--var`).
