# AppFair

Motor de gestión de riesgos empresariales (FAIR + Monte Carlo, alineado a ISO 31000 / RIMS
RA.1-2015 / ISO 28001). Frontend y backend, full-stack: el frontend ya no calcula nada por su
cuenta ni persiste en `localStorage` — todo el motor (perfiles, simulación Monte Carlo,
autocálculo, tratamiento de riesgos, Registro de Riesgos) vive en el backend, y el frontend es
un cliente de su API REST.

- `frontend/app_fair.html` — app de una sola página (Análisis Rápido + FAIR completo),
  autocontenida en HTML/CSS/JS sin build. Análisis Rápido y el autocompletado de texto
  siguen siendo 100% locales (el backend no tiene ni necesita un endpoint para eso); todo lo
  demás (Criterios de Riesgo, Valores por Defecto, Contexto Organizacional, simulación FAIR,
  tratamiento y Registro de Riesgos) se guarda y calcula en el backend.
- `backend/` — API REST en Express con el motor de cálculo como módulos puros de Node,
  persistencia en archivo JSON y protegida por API key. Ver `backend/README.md` para
  instalación, endpoints y notas de diseño.

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

## Licencia

[MIT](LICENSE).
