# Prompt do Codex

Pracujemy nad produktem Workload Planner dla zespolu Mobile Vikings Polska. To narzedzie do planowania workloadu pracownikow, inspirowane aktualna tabela Excel, ale z interaktywnymi bloczkami czasu.

Masz w repo:

- `prototype/index.html` - aktualny prototyp HTML/CSS/JS.
- `docs/product-spec.md` - opis wymagan produktowych.
- `docs/technical-notes.md` - notatki techniczne.
- `assets/brand_reference.html` - referencja stylistyczna, na ktorej trzeba bazowac.

Najwazniejsze zasady produktu:

1. Jira jest tylko zrodlem taskow do zaplanowania. Nie zapisujemy nic do Jiry.
2. Kolor taska oznacza epic z Jiry.
3. Kafelek oznacza konkretny task/issue.
4. Backlog jest skladanym sidebarem z kompaktowymi kafelkami taskow.
5. Planner ma os godzin 07:00-19:00.
6. Kazdy pracownik ma osobny poziomy kontener workloadu.
7. Scroll poziomy jest wspolny dla wszystkich pracownikow.
8. Kalendarz startuje od 2026-06-01 i nie pokazuje wczesniejszych dni.
9. Weekendow nie ukrywamy - sa wyszarzone.
10. Task mozna przeciagac na konkretna osobe, dzien i godzine.
11. Task startuje domyslnie od 1h.
12. Resize pionowy zmienia liczbe godzin.
13. Resize poziomy zmienia liczbe dni taska.
14. Taski maja byc sticky: bez dziur po resize; gdy task sie wydluza/skracaja, kolejne taski ida w dol/gore.
15. Ustawienia pracownikow i epicow sa w modalu.
16. UI ma bazowac na brand reference: DM Sans, DM Mono, cream/off-white, blue/coral/amber, miekkie zaokraglone karty, subtelne linie.

Twoje zadanie teraz:

1. Przejrzyj `prototype/index.html`.
2. Rozdziel go na `prototype/index.html`, `prototype/styles.css`, `prototype/app.js` bez zmiany zachowania.
3. Uporzadkuj kod JS na sekcje: state, date utils, rendering, drag/resize, actions.
4. Dodaj zapis i odczyt stanu z `localStorage`.
5. Popraw sticky packing tak, zeby po skroceniu taska kolejne taski dosuwaly sie do gory bez dziur.
6. Zadbaj, aby 07:00 i 19:00 nie byly ucinane przez header/sume/kolejnego pracownika.
7. Nie przechodz jeszcze do Reacta. Najpierw stabilizujemy prototyp HTML.

Po zmianach wypisz:

- co zmieniles,
- jak uruchomic,
- jakie ograniczenia nadal zostaly,
- co proponujesz jako nastepny krok.
