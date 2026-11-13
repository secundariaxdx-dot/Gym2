# Gym — app de entrenos con sobrecarga progresiva (PWA)

App personal de Pau para iPhone 13 mini (PWA instalada desde Safari, sin App Store). Replica la sobrecarga
progresiva automática de Symmetry Pro. Publicada con GitHub Pages desde la raíz de este repo (rama main).
Idioma de la app y de la conversación: español.

## Estructura
- `src/` — código fuente (se edita aquí): `engine.js` (motor de progresión/fatiga/análisis, UMD testable con node),
  `app.js` (UI y lógica), `seed.js` (17 ejercicios y rutinas iniciales de Pau), `library.js` (122 ejercicios),
  `style.css`, `template.html`.
- `build.py` — une `src/` y genera en la RAÍZ: `index.html`, `sw.js`, `manifest.webmanifest`, iconos. Requiere Pillow.
  **No edites `index.html` ni `sw.js` a mano**: se sobrescriben.
- `test/` — `engine.test.js` (node) y `e2e*.py`/`persist.py` (Playwright con /usr/bin/google-chrome, viewport 375x812).

## Flujo de cambio
1. Editar `src/`.
2. Subir el nombre de caché en `build.py` (`CACHE = 'gym-vN'`) si cambia algo que el iPhone deba recargar.
3. `python3 build.py`
4. `node test/engine.test.js` y `python3 test/e2e.py && python3 test/e2e_v12.py && python3 test/e2e_v13.py && python3 test/persist.py`
5. Commit + push a main (Pages publica en 1–2 min). Comprobar que `sw.js` publicado muestra el nuevo `gym-vN`.

## Datos y compatibilidad (importante)
- Todo en `localStorage`, clave `gymapp.v1`. Estado: exercises, routines, routineOrder, sessions, activities, active,
  timer, settings. Las migraciones deben ser **aditivas**: los datos de versiones anteriores no se pueden romper.
- Los datos solo existen en el iPhone; hay copia manual en Ajustes. Abrir siempre desde el icono de inicio.
- El service worker es cache-first con actualización en segundo plano: el iPhone ve la versión nueva al abrir la app
  dos veces. `window.__gym = {state, E}` está expuesto para los tests.

## Reglas del motor (resumen)
- Doble progresión por serie: si llega al máximo de reps, sube peso (paso por ejercicio, kg o lb); si no, intenta +1 rep.
- 1RM con Epley; estancamiento tras 2 sesiones (fatiga ≥3) o 3 → propone descarga (~10 %).
- Peso corporal sin lastre: sube repeticiones. Calentamientos propuestos por el peso de trabajo, sin registrarse.
- Análisis post-entreno por reglas: 10–20 series/semana por músculo; sugiere +1/−1 serie.
- Fútbol 36 h y running 24 h de fatiga en piernas; solo se marca el día en el calendario.

## Versiones
v1.0 núcleo · v1.1 temporizador persistente + offline · v1.2 calendario, análisis, récords · v1.3 biblioteca 122 ejercicios y rutinas.
Siguiente caché: gym-v5. Pendiente posible: pasos de Apple Health (requeriría app nativa).
