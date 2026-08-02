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

## Cómo correrlo

```bash
cd backend && npm install && npm start   # arranca en http://localhost:3000, imprime una
                                          # API key temporal si no defines API_KEY en .env
```

Abre `frontend/app_fair.html` directamente en el navegador (no necesita servidor propio) y,
en el botón **Conexión API** de la esquina superior, ingresa la URL del backend (por defecto
`http://localhost:3000`) y la API key que te imprimió la consola al arrancar.

## Desplegarlo (portafolio / demo)

- **Backend**: `render.yaml` en la raíz deja el despliegue en [Render](https://render.com)
  en unos clics (nivel gratis, sin tarjeta) — ver "Despliegue en Render" en
  `backend/README.md` para el paso a paso.
- **Frontend**: `frontend/app_fair.html` es estático — GitHub Pages lo sirve tal cual, sin
  build. Una vez que sepas la URL de Pages, ponla como `ALLOWED_ORIGIN` en las variables de
  entorno del backend en Render (Settings → Environment, sin necesidad de otro deploy).

## Licencia

[MIT](LICENSE).
