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
- `push/` — Cloudflare Worker `gym-push`: avisos (Durable Object `Rest`) + parte social (`social.js`, Durable Object `Social` con SQLite): https://gym-push.secundariaxdx.workers.dev.
  Desplegar: `cd push && npm install && CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=7e4f73e625824fb43879e32cda498b5c npx wrangler deploy`.
  Secreto `VAPID_PRIVATE_JWK` (clave privada, NO está en el repo; la pública es `PUSH_KEY` en build.py). Si se pierde: generar par nuevo,
  `wrangler secret put`, cambiar `PUSH_KEY` y Pau debe reactivar el aviso en Ajustes. Local: `push/.dev.vars` (DEV_ORIGINS=1 + clave).
- `test/` — `engine.test.js` (node) y `e2e*.py`/`persist.py` (Playwright con /usr/bin/google-chrome, viewport 375x812).

## Flujo de cambio
1. Editar `src/`.
2. Subir el nombre de caché en `build.py` (`CACHE = 'gym-vN'`) si cambia algo que el iPhone deba recargar.
3. `python3 build.py`
4. `node test/engine.test.js` y `python3 test/e2e.py && python3 test/e2e_v12.py && python3 test/e2e_v13.py && python3 test/persist.py && python3 test/e2e_v14.py && python3 test/update.py && python3 test/e2e_v17.py && python3 test/e2e_v110.py && python3 test/e2e_v21.py && python3 test/e2e_v22.py && python3 test/e2e_v23.py && python3 test/e2e_classes.py && python3 test/e2e_gestos.py && python3 test/e2e_social.py && python3 test/e2e_aislar.py`
   (las pruebas antiguas importan `test/_pau.py`, que simula el iPhone de Pau metiendo sus pesos de partida si el almacenamiento está vacío)
   y del servidor social: `node test/social.test.mjs` (wrangler dev local)
   y para el aviso: `node test/push.test.mjs && python3 test/e2e_push.py` (wrangler dev local, necesita push/.dev.vars)
   (requiere `pip install playwright`; usa /usr/bin/google-chrome)
5. Commit + push a main (Pages publica en 1–2 min). Comprobar que `sw.js` publicado muestra el nuevo `gym-vN`.

## Datos y compatibilidad (importante)
- Todo en `localStorage`, clave `gymapp.v1`. Estado: exercises, routines, routineOrder, sessions, activities, active,
  timer, settings. Las migraciones deben ser **aditivas**: los datos de versiones anteriores no se pueden romper.
- Las fotos de los entrenos van aparte, en IndexedDB (`gym-photos`, almacén `p`: {buf, type, t, v}; `v: 2` = ya reducida a 800 px); la sesión solo guarda ids en `photos` (aditivo).
  NO entran en la copia de seguridad. Si falta una foto, su hueco se quita sin error; las huérfanas se borran al abrir pasados 7 días.
- Los datos solo existen en el iPhone; hay copia manual en Ajustes. Abrir siempre desde el icono de inicio.
- El service worker es cache-first con actualización en segundo plano: el iPhone ve la versión nueva al abrir la app
  dos veces. `window.__gym = {state, E}` está expuesto para los tests.

## Social, cuentas privadas y clases (v3.x)
- **Grupo privado cifrado**: `settings.social` = {uid, token, username, name, code}. El `code` (GYM1-…) deriva por HKDF
  una clave AES-GCM (cifra entrenos/fotos en el móvil) y una «proof» (hash que el servidor guarda para validar el grupo).
  El servidor (`social.js`) NUNCA ve la clave; solo guarda texto cifrado, nombres de usuario y seguimientos.
- **Cuentas privadas**: seguir = solicitud (`request`) que la otra persona acepta (`accept`) o rechaza (`reject`); también
  `remove` (quitar seguidor). Hasta aceptar no se ve nada (`canSee`). Rutas en `social.js`; cliente en `app.js` (`socCall`,
  `viewAmigos`/`viewWho`/`viewPeople`/`viewRel`, `rc` = caché de datos remotos).
- **Administrador (oculto)**: la cuenta que crea el grupo queda `admin=1` en el servidor y `canSee` la deja ver a cualquiera
  sin seguir y sin crear fila de seguimiento (no cuenta como seguidor). El flag `admin` NO se expone en ninguna respuesta ni
  en la interfaz. (Acordado con Pau: las 3 personas saben que el creador puede ver todo.)
- **Sincronización**: `socSync` sube/actualiza/borra entrenos (`socPayload`) y clases, cifrados; fotos aparte (`photo-put`).
  `shareItems()` = entrenos + clases. Los amigos ven todo descifrado en el móvil (`decPost`, `hydrateRemote`).
- **Clases dirigidas**: en `state.activities` como `{id, type:'clase', classKind, min, rpe?, kcal?, hrAvg?, hrMax?, dist?,
  rounds?, other?, notes?, t, day}` (aditivo). Fatiga de piernas por tipo en `engine.js` (`CLASSES`, `classDef`): spinning 24h
  (como correr), crossfit 20, hiit 18, zumba/bodypump 12, boxeo 10, pilates 6, yoga/stretching 0, otra 6. Se apuntan desde el
  calendario (`class-add`), salen en el día, en el registro de Perfil (`classCard`) y en Amigos (`feedClassCard`).

## Reglas del motor (resumen)
- Doble progresión por serie: si llega al máximo de reps, sube peso (paso por ejercicio, kg o lb); si no, intenta +1 rep.
- 1RM con Epley; estancamiento tras 2 sesiones (fatiga ≥3) o 3 → propone descarga (~10 %).
- Peso corporal sin lastre: sube repeticiones. Calentamientos propuestos por el peso de trabajo, sin registrarse.
- Análisis post-entreno por reglas: 10–20 series/semana por músculo; sugiere +1/−1 serie.
- Fútbol 36 h y running 24 h de fatiga en piernas; solo se marca el día en el calendario.

## Versiones
v1.0 núcleo · v1.1 temporizador persistente + offline · v1.2 calendario, análisis, récords · v1.3 biblioteca 122 ejercicios y rutinas · v1.4 sonidos (clic al marcar serie, aviso al acabar el descanso, botón de silencio = settings.sound; audioSession 'ambient' para no cortar la música) · v1.5 marcar serie sin escribir = objetivo (reps y peso vacíos toman el objetivo) · v1.6 aviso con la app cerrada: Web Push desde el Worker; se programa al marcar serie, ±15 lo reprograma, saltar/terminar/🔇 lo cancela; con la app delante se anula 2,5 s antes y suena el pitido. settings.push/pushId (aditivo) · v1.7 clic más audible (ganancia 0,22), línea de progreso del entreno (series hechas/total, encima de las pestañas), gráfico por ejercicio (tocar en Progreso: mejor 1RM por sesión) y por grupo muscular (desplegable: series/semana con banda 10–20 y volumen kg/semana). Gráficos SVG propios, sin librerías · v1.8 Progreso ordenado: fatiga › grupo muscular (gráficos ocultos tras botón «Ver gráficos») › récords de todos los ejercicios › historial · v1.9 la notificación dice la siguiente serie («Serie 2/3: 85 kg × 11», sin nombre de ejercicio): la app la guarda en la caché local 'gym-meta' (/__next) al programar el aviso y el SW la lee al recibir el push; el servidor no recibe datos de entreno. · v1.10 franja única `#dock` encima de las pestañas (descanso compacto + línea de progreso), biblioteca plegada en Ejercicios (se abre al buscar/filtrar), al acabar un ejercicio abre y desplaza al siguiente con series pendientes, «Deshacer» al quitar ejercicio o borrar sesión, ↑/↓ para reordenar ejercicios del entreno, reloj interno solo con entreno/descanso a la vista, y guardado aplazado 0,5 s al escribir (`saveSoon`, se vuelca al salir). · v2.0 pulido visual (bloque «v2.0» al final de style.css): interruptores estilo iOS, píldora en la pestaña activa, resumen «Esta semana» en Hoy (toca → calendario), iconos SVG en el botón de silencio (estado en `aria-pressed`/clase `off`, ya no emoji), flecha en cada ejercicio, hojas con asa y animaciones puntuales (clases `opening`, `enter`, `pop`, `anim`; ojo: la clase `in` es la de los campos de texto). Se retiró la vibración experimental: no funcionaba en el iPhone de Pau. · v2.1 pestaña Perfil (sustituye a Ajustes en la barra; Ajustes se abre con el botón de arriba a la derecha de Perfil, `ui.tab==='aj'`): resumen (entrenos, racha de semanas, tiempo, volumen), gráfico de 12 semanas (duración/volumen/series), registro de entrenos por meses (`viewPerfil`, 20 por página) y detalle de cada entreno (`viewSess`, `ui.sessOpen`): series con peso × reps y 1RM, serie del récord, cambio frente a la vez anterior, series por músculo, análisis y borrar con Deshacer. Se llega también desde el día del calendario y con «Ver entreno» al guardar. El historial ya no está en Progreso. · v2.2 fotos en los entrenos (hasta 6) y figura de músculos trabajados (`bodyMap`, SVG propio frontal/posterior, intensidad por series; secundarios cuentan la mitad). Carrusel deslizable `mediaHtml`: fotos y al final la figura; en el detalle siempre, en la tarjeta del registro solo si hay fotos. Añadir foto desde el detalle o desde el resumen al guardar; tocar una foto la abre en grande y permite borrarla (con Deshacer). · v2.3 **estructura de página**: el documento NO se desplaza (`html, body { overflow: hidden }`); el contenido se desplaza dentro de `#scroller` y `#dock`/`#tabs` son piezas normales debajo (ya no `position: fixed`; el `body` sí va `position: fixed` anclado a los 4 bordes, porque en la app instalada iOS mide «100 %» sin la franja del indicador de inicio y dejaba un hueco negro abajo; además, en iOS 26 (WebKit 301108) la ventana de la app instalada mide la barra de estado de menos si el documento es más bajo que la pantalla: regla `@media (display-mode: standalone) { html { min-height: min(100lvh, calc(100% + env(safe-area-inset-top))) } }`). Motivo: en iOS, al volver de otra app, la barra fija se quedaba descolocada y se movía con el contenido. Usar siempre `getY()`/`setY()` (nunca `window.scrollY`/`scrollTo`); al salir de la app se suelta el campo activo y al volver se recoloca la vista (`resetViewport`). Fotos mucho más ligeras (800 px, JPEG 0,6, ~50 KB; las antiguas se recomprimen al abrir con `slimPhotos`). Figura de músculos redibujada, más anatómica (`BM_BODY`, `BM_FRONT`, `BM_BACK`: media figura en espejo, varios trazos por músculo permitidos). · v2.4/2.5 hueco negro bajo las pestañas en la app instalada (iOS 26, WebKit 301108): body anclado a los 4 bordes + `@media (display-mode: standalone) html { min-height: min(100lvh, 100% + safe-area-top) }`. · v3.0 pestaña **Amigos** (6 pestañas): grupo privado, seguir y ver entrenos de otros. · v3.1 cuentas privadas (solicitudes) + administrador oculto. · v3.2 clases dirigidas. · v3.3 gestos de iPhone (bloque «gestos» antes del listener de clics en app.js): deslizar desde el borde izquierdo (24 px) vuelve atrás en pantallas con `#app .back` (sigue al dedo; vuelve si pasa 1/3 o es rápido), bajar una hoja la cierra (no si empieza en un campo), y tirar hacia abajo arriba del todo en Amigos/Perfil con grupo actualiza (`#ptr`). El movimiento se sigue en el elemento tocado (`sw.tg`), porque iOS sigue enviándolo ahí aunque se redibuje la pantalla; durante un gesto no se redibuja (`swLate`).
· v3.4 **datos de cada usuario aparte**: una instalación nueva copia ejercicios y rutinas de `seed.js` pero SIN `baseline` (los pesos de partida eran los de Pau y le salían a quien instalaba la app). Quien ya los heredó ve en Ajustes la tarjeta «Pesos de partida» (`seedCard`, `seedLeft` = ejercicios cuyo baseline es idéntico al de seed): «Quitar» los guarda en `settings.seedBak` y los quita (no toca sesiones), «Recuperarlos» los devuelve, «Son míos» la oculta (`settings.seedMine`). La copia de seguridad ya no incluye `settings.social` (token y código del grupo) ni el aviso. Prueba: `test/e2e_aislar.py` (3 iPhones simulados).
Siguiente caché: gym-v22 (variable CACHE arriba en build.py; se ve en Ajustes). El SW descarga sin caché HTTP y la app se recarga sola al activarse una versión nueva. El pitido solo suena con la app abierta (iOS congela la PWA en segundo plano); con la app cerrada avisa la notificación push. Pendiente posible: pasos de Apple Health (requeriría app nativa).
