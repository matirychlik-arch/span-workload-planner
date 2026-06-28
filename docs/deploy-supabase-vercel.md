# SPAN - deploy na Supabase + Vercel

Ten dokument prowadzi krok po kroku przez konfigurację produkcyjną.

## 1) Supabase - utwórz projekt

1. Utwórz nowy projekt w Supabase.
2. Wejdź do `SQL Editor`.
3. Uruchom skrypt z pliku [schema.sql](/Users/mati/Documents/Aplikacja%20do%20zarządzania%20czasu/workload-planner-codex-starter/supabase/schema.sql).
4. Z `Project Settings -> API` skopiuj:
   - `Project URL`
   - `Publishable key`
   - `service_role key`

## 2) Supabase Auth - Google

1. W Supabase: `Authentication -> Providers -> Google` i włącz provider.
2. W Google Cloud utwórz `OAuth Client ID` typu `Web application`.
3. W Google dodaj:
   - `Authorized JavaScript origins`: `http://localhost:3000` + domena Vercela
   - `Authorized redirect URI`: `https://<twoj-project-ref>.supabase.co/auth/v1/callback`
4. Wklej `Client ID` i `Client Secret` do providera Google w Supabase.

## 3) URL config w Supabase

W `Authentication -> URL Configuration` ustaw:

1. `Site URL`: produkcyjny URL Vercela, np. `https://span-workload.vercel.app`
2. `Redirect URLs`:
   - `http://localhost:3000/**`
   - `https://span-workload.vercel.app/**`
   - `https://*.vercel.app/**` (opcjonalnie dla preview deployów)

## 4) Vercel - import repo

1. W Vercelu kliknij `Add New -> Project`.
2. Zaimportuj repo z tym projektem.
3. Ustaw framework: `Next.js`.

## 5) Vercel - env variables

W `Project Settings -> Environment Variables` dodaj:

1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY`
4. `NEXT_PUBLIC_APP_URL` (URL Vercela)
5. `NEXT_PUBLIC_ENABLE_DEMO_AUTH=false`

Opcjonalnie Jira:

1. `JIRA_BASE_URL`
2. `JIRA_EMAIL`
3. `JIRA_API_TOKEN`

Ustaw te zmienne co najmniej dla `Production` i `Preview`.

## 6) Deploy i test

1. Wykonaj deploy na Vercelu.
2. Otwórz `/login` i zaloguj się Google.
3. Wejdź na `/planner`.
4. Sprawdź:
   - tworzenie assignmentów,
   - drag/drop,
   - resize,
   - multi-select + kopiowanie `Alt/Option`,
   - import z Jiry.

## 7) Co dzieje się po pierwszym logowaniu

Przy pierwszym logowaniu nowego usera backend automatycznie tworzy:

1. workspace,
2. team,
3. membership (`admin`),
4. przykładowych pracowników, epiki, taski i assignmenty.

To robi `SupabaseStore` i dzięki temu planner działa od razu po loginie bez ręcznego seedowania.
