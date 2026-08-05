# AppFair

Motor de gestión de riesgos empresariales (FAIR + Monte Carlo, alineado a ISO 31000 / RIMS
RA.1-2015 / ISO 28001). Frontend y backend, full-stack: el frontend ya no calcula nada por su
cuenta ni persiste en `localStorage` — todo el motor (perfiles, simulación Monte Carlo,
autocálculo, tratamiento de riesgos, Registro de Riesgos) vive en el backend, y el frontend es
un cliente de su API REST.

- `frontend/app_fair.html` — app de una sola página (el wizard de FAIR completo, 4 pasos). Su
  lógica vive en `frontend/src/main.js` + `frontend/src/modules/*.js` (módulos ES reales, en
  migración incremental — ver "Plan de migración" abajo); no hay build en producción todavía.
  El autocompletado de texto es 100% local; todo lo demás (Criterios de Riesgo, Valores por
  Defecto, Contexto Organizacional, simulación FAIR, tratamiento y Registro de Riesgos) se
  guarda y calcula en el backend.
- `backend/` — API REST en Express con el motor de cálculo como módulos puros de Node,
  protegida por API key. Persistencia en archivo JSON local por defecto, o en Postgres
  (gratis, sin vencimiento — recomendado en producción) si se configura `DATABASE_URL`. Ver
  `backend/README.md` para instalación, endpoints y notas de diseño.

## En producción

- **Frontend**: https://franckboy.github.io/AppFair/frontend/app_fair.html (GitHub Pages,
  rama `main`)
- **Backend**: https://motor-riesgos-fair-backend.onrender.com (Render, nivel gratis — se
  duerme tras ~15 min sin tráfico; la primera petición después de eso tarda ~30-50s)

Para usar la app publicada, abre la URL del frontend, entra a **Conexión API** (botón en el
header) y pon la URL del backend de arriba + tu API key. Ver "Autenticación" en
`backend/README.md` sobre cómo se genera/gestiona esa key.

## Cómo correrlo

```bash
cd backend && npm install && npm start   # arranca en http://localhost:3000, imprime una
                                          # API key temporal si no defines API_KEY en .env
```

```bash
cd frontend && npm install && npm run dev   # servidor de Vite en http://localhost:5173
```

Abre la URL que imprime Vite y, en el botón **Conexión API** de la esquina superior, ingresa
la URL del backend (por defecto `http://localhost:3000`) y la API key que te imprimió la
consola al arrancar. `npm run build` + `npm run preview` generan y sirven una build de
producción local, si la necesitas.

**Nota**: `app_fair.html` ya no se puede abrir con doble clic directo desde el explorador de
archivos (`file://`) — desde la Fase 3 del plan de migración, su lógica usa imports de ES
modules reales, y los navegadores bloquean esos imports por CORS bajo `file://`. Necesita
servirse por HTTP: `npm run dev` en local, o cualquier servidor estático (GitHub Pages en
producción sigue funcionando igual, sin cambios — ver abajo).

## Cómo se desplegó (portafolio / demo)

- **Backend**: `render.yaml` en la raíz define el [Blueprint de Render](https://render.com)
  (nivel gratis, sin tarjeta) — ver "Despliegue en Render" en `backend/README.md` para el
  paso a paso, por si necesitas recrearlo.
- **Frontend**: `frontend/app_fair.html` es estático — GitHub Pages lo sirve tal cual desde
  `main`, sin build (Settings → Pages → Deploy from a branch).
- El `ALLOWED_ORIGIN` del backend en Render está fijado al origen de GitHub Pages
  (`https://franckboy.github.io`), y la URL/API key del backend están cargadas en el
  frontend publicado vía **Conexión API** (se guardan en el navegador, no en el repo).

## Pruebas

```bash
cd backend && npm test        # pruebas unitarias/integración del motor de cálculo (node --test)

cd frontend && npm install && npm run test:e2e   # suite E2E (Playwright) contra un backend real
```

La suite E2E arranca su propio backend + servidor estático (ver `frontend/playwright.config.js`)
y corre los flujos críticos de punta a punta: wizard completo, guardar borrador y reanudarlo,
Análisis Profundo, exportar el Informe Consolidado, eliminar un riesgo. Corre en cada push/PR
vía GitHub Actions (`.github/workflows/frontend-e2e.yml`), igual que las pruebas del backend.

## Plan de migración (arquitectura del frontend)

`app_fair.html` es un solo archivo de miles de líneas — funciona, pero cada cambio nuevo cuesta
más de ubicar. Hay un plan de migración incremental en marcha (bundler → CSS formal → módulos ES,
cada paso verificado con la suite E2E antes de avanzar al siguiente) — sin reescritura, sin
framework nuevo por ahora.

- **Fase 0 (hecha)**: la suite de pruebas E2E de arriba — la red de seguridad que permite
  reorganizar el código con confianza.
- **Fase 1 (hecha)**: Vite como servidor de desarrollo y build local (`frontend/vite.config.js`,
  scripts `dev`/`build`/`preview`). El único cambio de contenido en `app_fair.html` fue marcar
  su `<script>` como `type="module"`. Producción sigue sin build por ahora: GitHub Pages
  publica el archivo fuente tal cual — un `<script type="module">` corre nativo en el
  navegador sin necesitar Vite — y las dependencias de CDN (Chart.js, html2canvas, Font
  Awesome) siguen cargándose igual que antes. Cambiar el despliegue para servir la build de
  Vite queda para más adelante, cuando la Fase 3 (módulos ES) le dé más contenido real que
  optimizar.
- **Fase 2 (hecha)**: build formal de Tailwind CSS. Antes, el bloque `<style>` pegado en
  `app_fair.html` se regeneraba a mano con un proceso de 4 pasos que ni siquiera garantizaba
  tener guardado el `input.css` original. Ahora la fuente vive versionada en
  `frontend/src/tailwind-input.css` + `frontend/tailwind.config.js`, y
  `cd frontend && npm run build:css` (script en `frontend/scripts/build-css.js`) la recompila
  e inserta en `app_fair.html` en un solo paso. De paso corrigió una desincronización real: 7
  clases usadas en el HTML/JS actual (`border-blue-400`, `flex-shrink-0`, `items-start`,
  `list-disc`, `list-inside`, `pr-3`, `text-blue-900` — el banner de "reanudar análisis", la
  nota de ROI, el padding de la tabla de magnitud de pérdida y la lista de sensibilidad) no
  tenían estilo porque el bloque pegado nunca se había regenerado desde que se agregaron. El
  CSS sigue sirviéndose igual que antes (bloque estático en el HTML, sin build en producción).
- **Fase 3a (hecha)**: dividir el script (antes ~4500 líneas en un solo `<script>` inline) en
  módulos ES reales — `frontend/src/main.js` (punto de entrada, referenciado como
  `<script type="module" src="./src/main.js">`) + `frontend/src/modules/*.js`. Se movieron los
  15 módulos "hoja" (sin dependencias circulares complejas): `app-namespace` (el namespace
  compartido `App`, al que cada módulo se auto-registra — así el código que todavía no se
  movió sigue llamando `App.X.metodo()` sin reescribirse), `state`, `modal`, `utils`, `api`,
  `navigation`, `criteria`, `autocomplete`, `risk-catalog`, `asset-catalog`, `ui-mode`,
  `org-defaults`, `org-context`, `config-menu`, `fair-export`. `main.js` bajó de ~4500 a
  ~2700 líneas. Producción sigue sin build (GitHub Pages sirve el árbol de módulos tal cual,
  los imports relativos funcionan por HTTP sin necesitar bundler) — el único costo real es que
  ya no se puede abrir `app_fair.html` por `file://` (ver arriba).
- **Fase 3b (pendiente)**: los dos módulos más grandes e interconectados —
  `FairWizard` (~1700 líneas) y `FairRegister` (~900 líneas, con dependencia circular entre
  ambos) — más `FairAnalysis` (fachada delgada que los envuelve) y `QuickAnalysis` (depende de
  `FairRegister`), que juntos son más de la mitad del código y se dejaron aparte a propósito
  por su tamaño y riesgo.

## Licencia

[MIT](LICENSE).
