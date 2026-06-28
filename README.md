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
- ustaw `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.

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
- `POST /api/jira/import`
- `GET /api/onboarding/steps`
- `GET /api/slack/digest-preview?teamId=...&date=YYYY-MM-DD`

## Co jest w repo

- `app/`, `components/`, `lib/` — aplikacja v1.
- `supabase/schema.sql` — schemat danych v1.
- `prototype/` — historyczny mockup HTML/CSS/JS.
- `docs/` — spec produktu, notatki techniczne i prompt.
