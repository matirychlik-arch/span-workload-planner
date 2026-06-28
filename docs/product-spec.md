# Product spec - Workload Planner

## Cel

Zbudowac proste narzedzie do zarzadzania czasem pracy pracownikow, inspirowane aktualna tabela workloadu w Excelu, ale z interaktywnymi bloczkami czasu.

Narzedzie ma sluzyc do planowania pracy, a nie do raportowania czasu do Jiry.

## Glowny model mentalny

- Backlog zawiera taski.
- Kolor taska oznacza epic z Jiry.
- Kafelek/task mozna przeciagac na kalendarz.
- Pracownik ma wlasny poziomy kontener workloadu.
- Kazda kolumna to kolejny dzien.
- W pionie widac godziny od 07:00 do 19:00.
- Task ma domyslnie 1h.
- Task mozna rozciagac w dol/gore, zeby zmienic czas trwania.
- Task mozna rozciagac w prawo/lewo, zeby rozlozyc go na kilka dni.

## Widok glowny

### Header

- Logo/nazwa produktu.
- Przycisk ustawien.
- Nawigacja tygodniowa: poprzedni tydzien, dzis, nastepny tydzien.
- Import z Jiry.

### Sidebar backlogu

Sidebar ma byc skladany bez przycisku w topbarze. Ikona skladania znajduje sie w prawym gornym rogu sidebaru, tak jak w typowych aplikacjach z sidebarami.

Po zlozeniu zostaje waski pasek z etykieta `BACKLOG` i ikonka rozwijania.

Backlog ma byc scrollowalny. Lista taskow ma byc kompaktowa, najlepiej jako male kwadratowe/prawie kwadratowe kafelki w gridzie. Kafelki powinny byc blisko siebie, bez duzych przerw.

Backlog zawiera:

- taski pobrane z Jiry,
- taski dodane recznie.

### Planner

Planner to horyzontalny kalendarz:

- kazda kolumna to kolejny dzien,
- system startuje od 2026-06-01,
- nie pokazujemy dni przed 2026-06-01,
- weekendy sa wyszarzone,
- dni ida kolejno, bez ukrywania sobot i niedziel,
- przy wejsciu planner centruje sie na obecnym dniu/tygodniu,
- scroll poziomy ma byc wspolny dla wszystkich pracownikow, aby mozna bylo porownywac ich oblozenie w tych samych dniach.

Kazdy pracownik jest osobnym poziomym kontenerem. Miedzy pracownikami ma byc widoczny odstep/padding, aby godziny i sumy nie nachodzily na siebie.

### Os godzin

Dla kazdego dnia i pracownika widoczne sa znaczniki 07:00-19:00.

Wazne:

- 07:00 nie moze byc uciete przy gornej krawedzi,
- 19:00 nie moze byc zasloniete przez sume ani kolejnego pracownika,
- suma dnia powinna miec wlasne miejsce na dole komorki.

## Zachowania taskow

### Dodanie taska

Task z backlogu po upuszczeniu na kalendarz trafia do:

- konkretnego pracownika,
- konkretnego dnia,
- konkretnej godziny.

Domyslnie trwa 1h.

### Przesuniecie na zajety slot

Jesli task zostanie przesuniety w miejsce, gdzie juz jest inny task, kolejne taski maja sie automatycznie przesunac nizej.

### Sticky packing

Taski maja byc lepkie do siebie. Oznacza to:

- jesli task wyzej sie wydluza, taski ponizej ida nizej,
- jesli task wyzej sie skraca, taski ponizej wracaja do gory,
- po zmianie nie powinny zostawac dziury pomiedzy taskami.

To zachowanie jest wazniejsze niz zachowanie recznych przerw miedzy taskami.

### Resize pionowy

Rozciaganie w pionie zmienia liczbe godzin taska. Minimalny czas: 1h.

### Resize poziomy

Rozciaganie w poziomie zmienia liczbe dni taska. Przypadek uzycia: ten sam task jest planowany na poniedzialek, wtorek i srode.

Dla MVP moze to oznaczac jeden pasek rozciagniety przez kilka kolumn dni, z ta sama godzina startu i ta sama liczba godzin kazdego dnia.

## Ustawienia

Ustawienia sa w modalu.

### Pracownicy

- dodawanie pracownikow,
- usuwanie pracownikow,
- po usunieciu pracownika jego zaplanowane taski sa usuwane z widoku/prototypu.

### Epiki / kolory

Kategorie w prototypie reprezentuja epiki z Jiry.

- kolor = epic,
- task = issue/task w epicu,
- w produkcji epiki powinny przychodzic z Jiry,
- w prototypie mozna dodawac/usuwac epiki recznie.

### Jira

JQL moze byc w ustawieniach jako tryb advanced. Docelowo moze byc zastapiony prostszymi filtrami UI.

## Zespoly i role

SPAN ma obslugiwac wiele zespolow. Kazdy zespol ma wlasna tablice workloadu, zarzadzana przez PM-a.

Role:

- `admin` - zarzadza workspace, integracjami, uzytkownikami i uprawnieniami.
- `pm` - zarzadza tablicami zespolow, planuje workload, decyduje o zasadach edycji.
- `employee` - widzi swoj workload i, jesli zespol na to pozwala, moze edytowac/przesuwac swoja prace.

Tryby edycji zespolu:

- `collaborative` - pracownicy moga samodzielnie przesuwac swoje zadania i aktualizowac ilosc pracy wykonanej w dniu, tygodniu albo sprincie.
- `pm_only` - tylko PM/admin moze edytowac plan. Pracownik ma widok read-only.

Kazda tablica powinna miec jasny kontekst:

- nazwa zespolu,
- PM odpowiedzialny,
- czlonkowie,
- aktywny sprint / zakres dat,
- status uprawnien do edycji.

## Codzienny workload i Slack

Docelowo SPAN ma laczyc sie ze Slackiem. Kazdy uzytkownik o 07:00 rano dostaje prywatna liste workloadu zaplanowanego na dany dzien.

Wiadomosc powinna zawierac:

- liste taskow na dzis,
- godziny startu i czas trwania,
- link do taska w Jirze, jesli task pochodzi z Jiry,
- laczna liczbe godzin na dzis,
- szybki link do widoku dnia w SPAN.

Dla PM-a mozna dodac osobny digest zespolu:

- kto jest przeciazony,
- kto ma wolne sloty,
- ktore taski nie maja przypisanej osoby,
- konflikty i zadania wychodzace poza dostepny dzien.

## Onboarding

SPAN ma miec onboarding kontekstowy, ktory wskazuje konkretne elementy UI i tlumaczy nie tylko funkcje, ale benefit dla odbiorcy.

Zasada copy:

- nie "Tu przeciagasz task",
- tylko "Przeciagnij task na os czasu, zeby od razu zobaczyc, komu zabiera realna pojemnosc dnia."

Przykladowe kroki:

- Backlog: "Tu laduja taski z Jiry i reczne wrzutki, wiec PM nie musi przepisywac pracy miedzy narzedziami."
- Timeline: "Tu widzisz realne oblozenie w czasie, nie tylko liste zadan."
- Rozciaganie kafelka: "Zmieniaj czas trwania bez liczenia w arkuszu."
- Multi-select: "Przenos kilka blokow naraz, kiedy caly plan dnia lub sprintu sie przesuwa."
- Sticky packing: "SPAN sam domyka dziury po zmianach, zeby plan zostal czytelny."
- Slack digest: "Kazdy rano dostaje swoj plan dnia bez pytania PM-a."

## Logowanie i integracje

Docelowe integracje:

- Google login - glowna metoda logowania.
- Jira - zrodlo taskow, epicow, statusow i linkow do issue.
- Slack - codzienne powiadomienia i digesty.

Integracje powinny byc konfigurowane na poziomie workspace przez admina. Zwykly pracownik nie powinien miec dostepu do tokenow ani ustawien integracji.

## Branding / UI

Estetyka ma byc oparta o referencje z `assets/brand_reference.html`:

- DM Sans jako font glowny,
- DM Mono do etykiet technicznych, godzin, metadanych,
- jasne tla cream/off-white,
- miekkie zaokraglone karty,
- subtelne linie 0.5px,
- paleta: blue `#4A7FF8`, coral `#FF7648`, amber `#FFC757`, cream `#F0EDE6`, ink `#1A1916`.
