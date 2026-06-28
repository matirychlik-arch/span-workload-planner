# Technical notes

## Obecny prototyp

Obecny prototyp jest w jednym pliku HTML:

- HTML struktury,
- CSS designu,
- JavaScript stanu i interakcji.

Nie ma backendu ani zapisu do bazy. Dane sa trzymane w pamieci przegladarki.

## Docelowy stack

Rekomendowany kierunek po dopracowaniu UI:

- Frontend: React + TypeScript.
- Drag/drop: dnd-kit albo custom pointer events dla precyzyjnego timeline.
- Backend: Node.js/NestJS albo FastAPI.
- Baza: PostgreSQL.
- Jira integration: backend-only.
- Auth: zalezne od srodowiska firmowego.

## Dlaczego nie tylko HTML w produkcji

HTML/CSS/JS wystarcza do prototypu, ale produkcja bedzie potrzebowala:

- zapisu planow,
- wielu uzytkownikow,
- konfliktow edycji,
- integracji z Jira API,
- kontroli uprawnien,
- historii zmian,
- prawdopodobnie widoku realtime.

## Model danych MVP

### Workspace

```ts
type Workspace = {
  id: string;
  name: string;
  googleAuthEnabled: boolean;
  jiraConnected: boolean;
  slackConnected: boolean;
};
```

### User

```ts
type User = {
  id: string;
  email: string;
  name: string;
  googleSub?: string;
  slackUserId?: string;
};
```

### Team

```ts
type Team = {
  id: string;
  workspaceId: string;
  name: string;
  pmUserId: string;
  editMode: 'collaborative' | 'pm_only';
};
```

### TeamMember

```ts
type TeamMember = {
  teamId: string;
  userId: string;
  role: 'admin' | 'pm' | 'employee';
};
```

### Employee

```ts
type Employee = {
  id: string;
  teamId?: string;
  userId?: string;
  name: string;
  active: boolean;
};
```

### Epic

```ts
type Epic = {
  id: string;
  jiraKey?: string;
  name: string;
  color: string;
};
```

### Task

```ts
type Task = {
  id: string;
  source: 'jira' | 'manual';
  jiraIssueId?: string;
  jiraKey?: string;
  title: string;
  url?: string;
  epicId: string;
  status?: string;
  assigneeId?: string;
};
```

### Assignment

```ts
type Assignment = {
  id: string;
  taskId: string;
  employeeId: string;
  teamId?: string;
  startDate: string; // YYYY-MM-DD
  startHour: number; // 7-18
  durationHours: number;
  durationDays: number;
  desiredStartHour?: number;
  completionRatio?: number; // 0-1 albo procent wykonania w danym zakresie
};
```

Interpretacja `durationDays`: ten sam task wystepuje przez N kolejnych dni, w tych samych godzinach.

## Sticky packing algorithm

Po kazdej zmianie taska:

1. Pobierz taski dla danego pracownika i dnia.
2. Posortuj po `startHour`.
3. Ustaw pierwszy task na najwczesniejszy dozwolony slot albo zachowaj pozycje aktywnie przesuwanego taska.
4. Kazdy kolejny task ustaw od razu po poprzednim.
5. Jesli task wychodzi poza 19:00, przytnij albo pokaz konflikt.

W prototypie zadania sa po prostu kompaktowane bez dziur od 07:00. W docelowym produkcie warto zdecydowac, czy uzytkownik moze celowo zostawiac przerwy.

## Multi-day tasks

Dla MVP:

- jeden pasek moze miec `durationDays > 1`,
- renderuje sie jako pasek rozciagniety przez kilka kolumn,
- kazdego dnia liczy sie ta sama liczba godzin,
- sticky packing powinien uwzgledniac task we wszystkich dniach, ktore obejmuje.

W docelowej wersji mozna rozwazyc bardziej zaawansowany model: task ma kilka segmentow, kazdy z innym dniem/godzina/czasem.

## Jira integration

Jira jest tylko zrodlem taskow.

Nie zapisujemy do Jiry:

- worklogow,
- estymacji,
- statusow,
- assignee,
- komentarzy.

Backend powinien:

1. Trzymac token/API credentials bezpiecznie po stronie serwera.
2. Wykonywac JQL.
3. Pobierac issue fields: key, summary, status, assignee, epic, parent, labels, url.
4. Mapowac epic na kolor.
5. Wysylac frontendowi liste taskow.

## Auth i integracje

### Google login

Google login powinien byc pierwsza metoda auth. Rekomendacja:

- produkcyjnie: Supabase Auth albo Auth.js z providerem Google,
- mapowanie `googleSub` na `User`,
- wymuszony workspace po domenie lub zaproszeniu,
- role i dostepy trzymane w bazie, nie w tokenie frontendu.

### Slack

Slack wymaga backendowego scheduler/job runnera.

Przeplyw:

1. Admin laczy workspace ze Slackiem przez OAuth.
2. Backend zapisuje zaszyfrowany token bot/user.
3. Uzytkownicy mapuja sie po emailu albo przez `slackUserId`.
4. Codziennie o 07:00 backend liczy workload na dzis dla kazdego uzytkownika.
5. Backend wysyla DM z lista taskow i linkiem do widoku dnia.

Dla MVP wystarczy jeden job dzienny. Pozniej mozna dodac:

- digest PM-a,
- przypomnienia przed startem taska,
- alerty przy przeciazeniu.

### Jira

Jira OAuth/API token musi zostac po stronie backendu.

Dane potrzebne do SPAN:

- issue key,
- summary,
- status,
- assignee,
- epic/parent,
- labels,
- estimate, jesli dostepna,
- url do issue.

## Uprawnienia edycji

Kazda operacja zmiany planu musi byc walidowana backendowo.

Zasady:

- `admin` moze wszystko w workspace.
- `pm` moze edytowac tablice swoich zespolow.
- `employee` moze edytowac swoje assignmenty tylko gdy `Team.editMode === 'collaborative'`.
- w trybie `pm_only` employee widzi plan, ale nie moze przesuwac, resize'owac ani usuwac kafelkow.

Frontend moze ukrywac kontrolki, ale backend musi egzekwowac reguly.

## Onboarding technicznie

Onboarding najlepiej trzymac jako liste krokow z selectorami DOM i copy benefitowym.

```ts
type OnboardingStep = {
  id: string;
  selector: string;
  title: string;
  benefit: string;
  placement: 'top' | 'right' | 'bottom' | 'left';
};
```

Stan:

- `completedOnboardingAt`,
- `dismissedStepIds`,
- mozliwosc ponownego uruchomienia onboardingu z ustawien.

## Najblizsze TODO w Codex

1. Rozdzielic `prototype/index.html` na czytelne pliki: `index.html`, `styles.css`, `app.js`.
2. Poprawic sticky packing tak, aby zachowywal przesuwany slot jako kotwice, ale usuwal dziury po resize.
3. Dopracowac multi-day rendering, szczegolnie dla taskow zaczynajacych sie przed widocznym zakresem.
4. Dodac zapis do `localStorage`, zeby prototyp nie resetowal sie po odswiezeniu.
5. Dodac mock endpoint / mock JSON dla Jiry.
6. Po akceptacji UI przeniesc do React + TypeScript.
