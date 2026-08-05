# AppFair

Motor de gestión de riesgos empresariales (FAIR + Monte Carlo, alineado a ISO 31000 / RIMS
RA.1-2015 / ISO 28001). Frontend y backend, full-stack: el frontend ya no calcula nada por su
cuenta ni persiste en `localStorage` — todo el motor (perfiles, simulación Monte Carlo,
autocálculo, tratamiento de riesgos, Registro de Riesgos) vive en el backend, y el frontend es
un cliente de su API REST.

- `frontend/app_fair.html` — app de una sola página (el wizard de FAIR completo, 4 pasos),
  autocontenida en HTML/CSS/JS sin build todavía (ver "Plan de migración" abajo). El
  autocompletado de texto es 100% local; todo lo demás (Criterios de Riesgo, Valores por
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

Abre `frontend/app_fair.html` directamente en el navegador (no necesita servidor propio) y,
en el botón **Conexión API** de la esquina superior, ingresa la URL del backend (por defecto
`http://localhost:3000`) y la API key que te imprimió la consola al arrancar.

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
framework nuevo por ahora. La suite de pruebas de arriba es la Fase 0 de ese plan: la red de
seguridad que permite reorganizar el código con confianza.

## Licencia

[MIT](LICENSE).
