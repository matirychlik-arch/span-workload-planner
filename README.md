# SPAN Workload Planner

Aplikacja SPAN została przepięta z mockupu HTML do stacku produkcyjnego:

- Next.js + TypeScript (App Router),
- BFF API w Next (`/api/*`),
- model danych pod Supabase (`supabase/schema.sql`),
- planner z drag/drop, multi-select, kopiowaniem `Alt/Option`, resize i sticky packing.

## Start lokalny

```bash
npm install
npm run dev
```

Po starcie otwórz:

- `http://localhost:3000/planner`
- `http://localhost:3000/login`

## Konfiguracja ENV

Skopiuj `.env.example` do `.env.local`.

Minimalny tryb działania:
- bez Supabase i bez Jira działa od razu na lokalnym store (demo users).

Tryb integracyjny:
- ustaw `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
- ustaw `NEXT_PUBLIC_ENABLE_DEMO_AUTH=false` na środowisku produkcyjnym,
- ustaw `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`,
- ustaw `CRON_SECRET` w Vercelu, żeby chronić endpoint automatycznych backupów,
- opcjonalnie ustaw `SUPABASE_BACKUP_BUCKET`; domyślnie używany jest bucket `planner-backups`.

## Backupy

- Ręczny eksport JSON zostaje dostępny w ustawieniach admina.
- Automatyczne migawki zapisują się w Supabase Storage do prywatnego bucketa `planner-backups`.
- Vercel Cron odpala `/api/backups/scheduled` co godzinę, a aplikacja zapisuje backup tylko o 12:00 i 17:00 czasu Europe/Warsaw.
- Admin może w ustawieniach odświeżyć listę migawek i przywrócić wybraną wersję.

## Spotkania i cykliczne taski

**Przed wdrożeniem tej wersji uruchom `supabase/recurring-tasks.sql` w Supabase SQL Editor.**
Migracja dodaje dane bez usuwania istniejących tasków. Przy nowej instalacji uruchom ją po `supabase/schema.sql`.

- Przy tworzeniu lub edycji taska dostępny jest typ **Task / Spotkanie**. Spotkania mają subtelną przerywaną obwódkę, niezależnie od koloru.
- Prawy przycisk na jednodniowym bloku → **Powtarzanie** → codziennie lub poniedziałek–piątek → **Bez końca** lub **W wybranym dniu**. Wybrany ostatni dzień jest wliczony.
- Cykl zachowuje pracownika, godzinę i długość pierwszego bloku. Kolejne daty powstają przy otwieraniu okresu kalendarza; seria bez końca nie ma ukrytego terminu wygaśnięcia.
- Przesunięcie, zmiana długości i Delete dotyczą jednego wystąpienia. Usunięte/przeniesione wystąpienia nie odtwarzają się przy odświeżeniu.
- Nazwa, opis, kolor i typ są wspólne dla wystąpień cyklu. Zwykłe kopiowanie tworzy osobny task, nie nowy cykl.
- **Powtarzanie → Zakończ po tym wystąpieniu** usuwa przyszłe wystąpienia, pozostawiając wybrane i wcześniejsze. Aby zmienić częstotliwość, zakończ serię i utwórz nową.
- Cykliczne bloki utrzymują godzinę podczas sticky packing. Kolizje z innymi blokami oznacza komunikat **Konflikt** przy sumie dnia.
- Ręczne i chmurowe migawki zawierają reguły, wyjątki i typy tasków. Starszy backup bez reguł można nadal przywrócić.

`npm test` obejmuje testy domeny, uprawnień, kopii i migracji SQL w lokalnym PostgreSQL (PGlite), bez dostępu do produkcji.

## Deploy (Supabase + Vercel)

Pełna instrukcja krok po kroku:

- [deploy-supabase-vercel.md](/Users/mati/Documents/Aplikacja%20do%20zarządzania%20czasu/workload-planner-codex-starter/docs/deploy-supabase-vercel.md)

## API (BFF)

- `GET /api/teams`
- `GET /api/planner?teamId&from&to`
- `POST /api/assignments/create`
- `POST /api/assignments/move`
- `POST /api/assignments/resize`
- `POST /api/assignments/copy`
- `POST /api/assignments/bulk-move`
- `POST /api/assignments/delete`
- `POST /api/assignments/repeat`
- `DELETE /api/assignments/repeat`
- `POST /api/jira/import`
- `GET /api/onboarding/steps`
- `GET /api/slack/digest-preview?teamId=...&date=YYYY-MM-DD`

## Co jest w repo

- `app/`, `components/`, `lib/` — aplikacja v1.
- `supabase/schema.sql` — schemat danych v1.
- `prototype/` — historyczny mockup HTML/CSS/JS.
- `docs/` — spec produktu, notatki techniczne i prompt.
