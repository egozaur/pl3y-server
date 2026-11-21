# CLAUDE.md

Always respond in Polish (zawsze odpowiadaj po polsku). UI text and code comments are in Polish.

## Szybki start

`pl3y-server` = jedyny backend całego PL3Y: jeden Cloudflare Worker (`pl3y-server`) + Durable Objects. Brak frameworka, brak builda. Testy: `node --test test/all.test.js` (Windows: portable Node `C:\Users\Kurczak\tools\node`, dodaj do PATH). Push do `main` = test + (przy `DEPLOY_ENABLED=true`) deploy na produkcję, więc przed pushem pytaj.

| Folder | Co to |
|---|---|
| `src/index.js` | routing wszystkich gier, allow-lista Origin, bramka auth, limity IP |
| `src/core/` | `auth.js` (hasło → token HMAC), `limits.js` (limity, TTL), `players.js` (nick + PIN + awatar) |
| `src/games/<gra>/` | serwer jednej gry; frontend gry jest w osobnym repo `../<gra>` |
| `test/core/`, `test/games/<gra>/` | testy; `test/all.test.js` zbiera wszystko |

Gry: `mafia` (DO `Room`, czysty silnik w `engine/`), `kurczacze` (`KiRoom`, silnik + bot + `data.js` generowane, nie edytuj), `milion` (`MlRoom`, `MlScores`), `tajniacy` (`TjRoom`, `TjSaves`, `TjDuo`), `rozejrzyj` (`RzWords`), `wordle` (`WdDaily`; `words-pl.js` generowane przez `../wordle/dev/build-words-pl.mjs`). Opis protokołu każdej gry jest w CLAUDE.md jej frontendu (`../<gra>/CLAUDE.md`, sekcja „Server”); trzymaj obie strony w zgodzie.

## Zasady

- Klasy DO są runtime-agnostic (lokalne tryby `?local=1` gier importują je prosto z tego repo, przez `../pl3y-server/src/games/<gra>/…`). Nie dodawaj do nich API specyficznych dla Cloudflare poza tym, co już jest.
- Nowa klasa DO = nowy `[[migrations]]` w `wrangler.toml`. Nigdy nie zmieniaj nazw istniejących klas ani tagów (kasuje dane).
- Każdy stan wychodzący do klienta Mafii przechodzi przez `src/games/mafia/engine/view.js` (to jedyne miejsce decydujące, co widzi TV i gracz); testy pilnują wycieków ról.

## Auth, limity, TTL

- `core/auth.js`: hasło (`PL3Y_PASSWORD`) → token HMAC (`PL3Y_TOKEN_SECRET`; rodzaje `d` 30 min, `p` 12 h, `t` test 1 h). Każde `/api/*` poza `/api/health` i `/api/auth/login` wymaga tokena wg `AUTH_MODE` (`off`/`optional`/`required`, brak = `required`). Token WebSocket jako `?tok=`. Kontrakt klienta: `../egozaur.github.io/CLAUDE.md`.
- `core/limits.js`: limity na IP (login 8/min, tworzenie pokoju 10/min, ws join 30/min, zapisy 30/min, odczyty 120/min, `pin` 20/min, `guess` 60/min) i na gniazdo WebSocket (burst 40, potem 20 msg/s, 100 przekroczeń z rzędu = zamknięcie 4429). `ttlFor`/`ENDED_TTL`: zakończona gra trzyma pokój 30 min.
- Testy: `test/core/auth.suite.js`.

## Gracze i Wordle

- `core/players.js`: DO `Players` (singleton): nick zarezerwowany 4-cyfrowym PIN-em + awatar 0–10, bez kont. Klucz `p:<n>`, `n` = `normNick()`. PIN jako SHA-256 z solą; 5 błędnych = blokada 15 min. Token gracza `pt` = `signData(secret,'player',{n,v})`; `v` rośnie przy resecie admina. Trasy: `POST /api/pl/check|claim|login|me|avatar|reset-request`, `GET|POST /api/pl/admin-reset`. Webhook Discord: `PL3Y_DISCORD_WEBHOOK`.
- `games/wordle/daily.js`: DO `WdDaily` (singleton): słowo dnia znane tylko serwerowi (dzień wg Europe/Warsaw, kolejność = tasowanie `ANSWERS` z HMAC `PL3Y_WORDLE_SECRET` lub `PL3Y_TOKEN_SECRET`). `POST /api/wd/state|guess`, `GET /api/wd/rank`.
- Ranking Milionerów przyjmuje tylko zweryfikowane nicki (`pt`); goście grają bez rankingu. Testy: `test/core/players.suite.js`.
