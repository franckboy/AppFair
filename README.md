# AppFair

Motor de gestión de riesgos empresariales (FAIR + Monte Carlo, alineado a ISO 31000 / RIMS
RA.1-2015 / ISO 28001).

- `frontend/app_fair.html` — app de una sola página (Análisis Rápido + FAIR completo),
  autocontenida, persistencia en `localStorage`.
- `backend/` — API REST en Express que reimplementa el mismo motor de cálculo como módulos
  puros de Node, con persistencia en archivo JSON y protegida por API key. Ver
  `backend/README.md` para instalación, endpoints y notas de diseño.
