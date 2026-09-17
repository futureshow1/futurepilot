# FuturePilot — trener operatora drona (prototyp 0.1)

Wersja robocza do testów. Gra treningowa na telefon (działa też na komputerze): krótkie ćwiczenia,
które uczą prawdziwego sterowania dronem — wysokość, zawis, orientacja, zakręty, FPV, prowadzenie kamery.

**Graj:** https://futureshow.pl/futurepilot/ — telefon trzymaj poziomo. Żeby mieć pełny ekran i działanie offline,
dodaj stronę do ekranu głównego (iPhone: Udostępnij → „Do ekranu początkowego"; Android: menu → „Zainstaluj aplikację").

## Sterowanie
- **Telefon:** dwa drążki pojawiają się pod kciukami tam, gdzie dotkniesz ekranu (lewa i prawa połowa).
- **Komputer:** W/S gaz lub wysokość, A/D obrót, strzałki lot, Shift delikatnie, P pauza, R od nowa, V widok.
- **Gamepad / aparatura RC przez USB:** wykrywane automatycznie; nietypowe kontrolery mają kreator przypisania osi w Ustawieniach.

## Technika
Statyczna aplikacja (PWA) bez kroku budowania: czysty JavaScript + three.js r160 (licencja MIT, kopia w `vendor/`).
Lokalnie: `python3 dev-server.py` i `http://localhost:8167`. Testy modelu lotu: `node test/physics.test.mjs`;
autopilot testowy w konsoli przeglądarki: `const ap = await import('./test/autopilot.js'); await ap.runAll();`.

Żadne dane nie opuszczają urządzenia — postępy są zapisywane wyłącznie w przeglądarce.

© FutureShow / Jan Przyłuski. Wersja 0.1 — fizyka uproszczona, progi ocen przed kalibracją.
