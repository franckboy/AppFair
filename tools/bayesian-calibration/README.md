# Calibración Bayesiana de Vulnerabilidad (herramienta offline)

Primer paso concreto hacia un futuro motor de riesgo en Python — ver la conversación de diseño
en el repositorio. **Es una herramienta de diagnóstico, no parte de la app**: lee datos de un
backend de AppFair ya corriendo, imprime un reporte, y no escribe nada de vuelta. No requiere
ningún cambio de infraestructura, no se conecta a producción, no se integra a la suite de tests.

## Qué hace

`backend/src/lib/autocalc.js` (`sampleVulnerabilityFromProfiles`) traduce Perfil de Atacante +
Nivel de Defensa en una Vulnerabilidad simulada (Capacidad de Amenaza vs. Fuerza de Resistencia,
vía la Función de Éxito de Contienda de Tullock) — mismos perfiles ya no dan siempre el mismo
número, sino una distribución. Este script pregunta: si incorporamos el histórico real del
Registro (riesgos donde un analista de verdad EDITÓ la Vulnerabilidad a mano, no el resultado sin
tocar del modelo) como evidencia, ¿la calibración se movería?

Para cada una de las 20 combinaciones Atacante × Defensa, compara:
- **Fórmula (hoy):** el balde (baja/media/alta) de la moda que da hoy el modelo TCap vs. RS
  simulado (mismo algoritmo que `sampleVulnerabilityFromProfiles`, corrido varias veces).
- **Calibrado (con evidencia):** una actualización Dirichlet-multinomial simple — la fórmula
  actúa como una creencia previa fuerte (`--prior-strength`, pseudo-observaciones), y cada
  riesgo con `vulnManualOverride: true` en el Registro suma una observación real. Sin evidencia,
  el resultado es idéntico a la fórmula.

## Uso

Sin dependencias externas — solo la librería estándar de Python 3.

```bash
python3 calibrate_vulnerability.py --base-url http://localhost:3000 --api-key TU_API_KEY
```

Opciones:
- `--base-url` — URL del backend de AppFair (default `http://localhost:3000`).
- `--api-key` — el mismo `X-API-Key` que usa el frontend para conectarse (requerido).
- `--prior-strength` — qué tan fuerte pesa la fórmula frente a la evidencia real (default `5.0`
  pseudo-observaciones; más alto = hace falta más evidencia para mover el resultado).

## Qué NO hace (a propósito)

- No escribe nada en el Registro ni en ninguna otra parte de la app.
- No expone ningún endpoint nuevo — solo consume `GET /api/config/profiles` y
  `GET /api/register`, que ya existen.
- No decide todavía si (ni cómo) esta calibración algún día alimentaría la app en producción —
  ese es un paso aparte, para cuando haya evidencia real suficiente que discutir.
