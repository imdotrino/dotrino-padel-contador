# Pádel — marcador y torneos

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

`padel.dotrino.com`. Cuatro pestañas bajo el topbar:

- **Marcador** — dos paneles táctiles con puntuación de tenis (0/15/30/40, juegos y sets), saque, tie-break, ventaja / doble ventaja / punto de oro, deshacer y resultados guardados.
- **Partidos**, **Tabla** y **Torneo** — torneo todos contra todos con parejas que **rotan** (mínimo 4 jugadores) o **fijas** (mínimo 3 parejas); se arman **al azar** sin repetir pareja o **por puntaje** (1.º+4.º contra 2.º+3.º); canchas configurables con descansos por turnos; duración por partidos por jugador, rondas o partidos totales. Cada partido termina **por tiempo** (cronómetro de la ronda, 20 min por defecto; al acabarse vale el marcador que haya) o **por juegos**. La tabla suma lo que se encienda de **juego**, **set** y **partido ganado**, cada uno con sus puntos. Las reglas van en **sets reutilizables** (dos de fábrica y los tuyos, guardados en tu almacén): se elige uno para el torneo, y el formulario de abajo edita el elegido o crea otro a partir de él, con cada regla escrita como texto y editable aparte. Cada partido se puede jugar en el marcador y el resultado vuelve al torneo.

## Desarrollo

Vite sin framework (CONVENCIONES §1).

```bash
npm install
npm run dev      # http://localhost:3210
npm test         # motor del torneo (node --test, sin navegador)
npm run test:e2e # Playwright: maquetación en 9 tamaños (nada encimado, torneo a lo ancho),
                 # cronómetro (con reloj controlado) y puntos combinables; sirve dist/ bajo
                 # padel.dotrino.com (necesita red)
npm run build    # dist/
```

| Archivo | Qué hace |
|---|---|
| `src/tournament/engine.js` | lógica pura: generar rondas, descansos, clasificación, límites |
| `src/tournament/repo.js` | torneos y sets de reglas en `@dotrino/store` (hilos `padel.tournaments`, `padel.meta` y `padel.rulesets`) |
| `src/tournament/view.js` | pestañas Partidos, Tabla y Torneo |
| `src/scoreboard.js` | el marcador; el partido en curso en `localStorage` (volátil), los resultados en el store (`padel.results`) |
| `src/main.js` | pestañas, topbar, «volver», identidad |

Regla del torneo: **una ronda ya generada no cambia** al editar la configuración o un resultado. Esos cambios cuentan para las rondas que se generen después. Una ronda sin resultados se puede rehacer o quitar a mano.

Despliegue: push a `main` → GitHub Actions (`npm test` + build) → Pages.
