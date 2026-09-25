# FuturePilot — trener operatora drona (prototyp 0.1)

Wersja robocza do testów. Gra treningowa na telefon (działa też na komputerze): krótkie ćwiczenia,
które uczą prawdziwego sterowania dronem — wysokość, zawis, orientacja, zakręty, FPV, prowadzenie kamery.

**Graj:** https://futureshow.pl/futurepilot/ — telefon trzymaj poziomo. Żeby mieć pełny ekran i działanie offline,
dodaj stronę do ekranu głównego (iPhone: Udostępnij → „Do ekranu początkowego"; Android: menu → „Zainstaluj aplikację").

## Co jest w środku
- **Pierwszy lot w 3 minuty** — prowadzony wstęp dla każdego: start, zawis bez trzymania drążków, przelot, obrót i lądowanie. Bez ocen.
- **Osiem ćwiczeń, 41 poziomów** — od drona z GPS po w pełni ręczne FPV; ułatwienia znikają wraz z postępami.
- **Opinie** — przycisk „Prześlij opinię" w grze (wysyła tylko to, co samodzielnie wpiszesz, plus widoczne dane techniczne).
- **Karta recenzenta dla pilotów:** https://futureshow.pl/futurepilot/recenzja.html

## Sterowanie
- **Telefon:** dwa drążki pojawiają się pod kciukami tam, gdzie dotkniesz ekranu (lewa i prawa połowa). Gra **nie używa żyroskopu ani przechylania** telefonu. Działa w poziomie (wygodniej) i w pionie.
- **Nie działa?** W *Ustawieniach* jest **Test zgodności urządzenia** — sprawdza przeglądarkę, ekran, grafikę 3D i płynność; raport można wysłać jednym przyciskiem. Gra otwarta wewnątrz aplikacji (np. Messengera) może nie mieć pełnego ekranu ani obracania — wtedy najlepiej otworzyć ją w Chrome lub Safari.
- **Komputer:** W/S gaz lub wysokość, A/D obrót, strzałki lot, Shift delikatnie, P pauza, R od nowa, V widok.
- **Gamepad / aparatura RC przez USB:** wykrywane automatycznie; nietypowe kontrolery mają kreator przypisania osi w Ustawieniach.

## Technika
Statyczna aplikacja (PWA) bez kroku budowania: czysty JavaScript + three.js r160 (licencja MIT, kopia w `vendor/`).
Lokalnie: `python3 dev-server.py` i `http://localhost:8167`. Testy modelu lotu: `node test/physics.test.mjs`;
autopilot testowy w konsoli przeglądarki: `const ap = await import('./test/autopilot.js'); await ap.runAll();`.

Postępy są zapisywane wyłącznie w przeglądarce. Strona liczy odwiedziny anonimowo (GoatCounter, bez ciasteczek); poza tym do autorów trafia tylko to, co samodzielnie wyślesz w formularzach (opinia, raport zgodności, karta recenzenta).

© FutureShow / Jan Przyłuski. Wersja 0.1 — fizyka uproszczona, progi ocen przed kalibracją.
