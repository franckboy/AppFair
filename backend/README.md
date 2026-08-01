# Motor de Riesgos FAIR — Backend

API REST del motor de cálculo de riesgos patrimoniales/ciberseguridad (FAIR + Monte Carlo,
alineado a ISO 31000 / RIMS RA.1-2015 / ISO 28001). Es **solo el backend** — no incluye
interfaz. Este mismo motor es el que corre hoy dentro de `app_fair.html`; aquí quedó separado
en módulos puros de JavaScript, sin ninguna dependencia del navegador (`document`,
`window`, etc.), para poder correrlo en un servidor.

## Instalación y arranque local

```bash
npm install
npm start          # arranca en http://localhost:3000
npm run dev         # con recarga automática al guardar cambios
npm test            # corre las 13 pruebas automatizadas del motor de cálculo
```

Variables de entorno (vía `.env` — copia `.env.example` — o el entorno del sistema):
- `PORT` — puerto del servidor (default `3000`)
- `API_KEY` — requerida para producción (ver "Autenticación" abajo). Si no la defines, el
  servidor genera una temporal en cada arranque y la imprime en consola, solo para poder
  probar en local sin fricción.

## Autenticación

Todos los endpoints bajo `/api/` (excepto `/api/health`) exigen el header `X-API-Key` con
el valor de tu `API_KEY`. Sin esto, cualquier origen que alcanzara el servidor podía leer y
escribir los Criterios de Riesgo, el Contexto Organizacional y el Registro de Riesgos sin
ninguna credencial — CORS está abierto (`cors()` sin restricción de origen), así que la
API key es la única barrera real hoy.

```bash
curl http://localhost:3000/api/config/criteria -H "X-API-Key: tu-api-key"
```

Una petición sin el header, o con una key incorrecta, responde `401`. Esto **no** es un
sistema de auth completo (no hay usuarios, roles ni expiración) — para multiusuario real,
reemplázalo por JWT/OAuth antes de exponerlo fuera de tu red de confianza.

## Persistencia

Los Criterios de Riesgo, Valores por Defecto, Contexto Organizacional y el Registro de
Riesgos se guardan en `data/db.json` — un archivo JSON simple, para que el proyecto corra
sin necesitar una base de datos externa desde el día 1.

**Esto es suficiente para un solo servidor con tráfico bajo.** Si vas a correr varias
instancias del backend al mismo tiempo (por ejemplo, detrás de un balanceador de carga) o
esperas muchas escrituras concurrentes, reemplaza `src/store/jsonStore.js` por una base de
datos real (PostgreSQL, MongoDB, etc.) — la interfaz (`get`, `set`, `upsertRiskInRegister`,
`deleteRiskFromRegister`) está pensada para que el resto del código no tenga que cambiar.

## Estructura del proyecto

```
server.js                        Arranca Express y monta las rutas
src/
  lib/
    random.js                    Generador con semilla (mulberry32) + muestreo triangular
    simulation.js                Motor Monte Carlo + Análisis de Sensibilidad (Pearson)
    evaluation.js                Evalúa un resultado contra los Criterios de Riesgo
    treatment.js                 Las 4 estrategias de tratamiento + ROSI + veredicto
    autocalc.js                  Vulnerabilidad, rangos de Magnitud, Reducción de ALE
    register.js                  Mapa de calor, Pareto 80-20, sensibilidad consolidada
    validate.js                  Validación de rangos triangulares, iterations y seed
  data/
    profiles.js                  Perfiles de Atacante/Defensa/Riesgo (constantes)
  store/
    jsonStore.js                 Persistencia en archivo JSON (swap-eable por una BD real)
  middleware/
    apiKeyAuth.js                Exige el header X-API-Key en todo /api/* salvo /api/health
  routes/
    config.js                    /api/config/*
    autocalc.js                  /api/autocalc/*
    simulate.js                  /api/simulate
    treatment.js                 /api/treatment/*
    register.js                  /api/register/*
test/
  lib.test.js                    13 pruebas del motor de cálculo (node --test)
```

## Endpoints

Todos los endpoints devuelven JSON. Todos aceptan `Content-Type: application/json`.

### `GET /api/health`
Chequeo de vida del servicio.

### `GET /api/config/profiles`
Devuelve los perfiles de Atacante, Defensa y Riesgo, y las etiquetas de las 9 categorías
de Magnitud de Pérdida. Son constantes del código, de solo lectura.

### `GET /api/config/criteria` · `PUT /api/config/criteria`
Los Criterios de Riesgo de la organización (Contexto, ISO 31000 6.3.4). `PUT` valida que
`rrtBands.medio < alto < critico` y que `aleAceptable < aleCritico`; si no, responde `400`.

```json
// PUT body
{
  "rrtBands": { "medio": 25, "alto": 50, "critico": 75 },
  "aleAceptable": 50000,
  "aleCritico": 250000,
  "aleUmbralExcedencia": 100000
}
```

### `GET /api/config/org-defaults` · `PUT /api/config/org-defaults`
Valores por defecto (moneda, nivel de defensa típico, dueño del riesgo, fuente/confianza
de datos) que un cliente puede usar para prellenar un análisis nuevo.

### `GET /api/config/org-context` · `PUT /api/config/org-context`
Contexto Organizacional (RIMS 5.2 / ISO 28001): misión, apetito de riesgo, partes
interesadas, entorno legal, alcance de la cadena de suministro cubierta.

### `POST /api/autocalc/vulnerability`
```json
// body
{ "attackerKey": "empleado-desleal", "defenseKey": "estandar", "confidence": "medio" }
// respuesta
{ "min": 19, "mode": 31, "max": 43, "attackerScore": 68, "defenseScore": 55 }
```

### `POST /api/autocalc/loss-magnitude`
```json
// body
{ "items": [{ "key": "productividad", "mode": 50000 }], "confidence": "medio" }
// respuesta
{ "productividad": { "min": 30000, "mode": 50000, "max": 70000 } }
```

### `POST /api/autocalc/reduccion-ale`
```json
// body
{ "currentDefenseKey": "basica", "targetDefenseKey": "avanzada" }
// respuesta
{ "currentScore": 26, "targetScore": 76, "reductionPercent": 68 }
```

### `POST /api/autocalc/attacker-defense-summary`
Devuelve el desglose completo de ambos perfiles y su diferencial — para mostrar el
resumen "Factor de Amenaza vs. Nivel de Defensa" sin duplicar la lógica en el cliente.

### `POST /api/simulate`
El endpoint principal — corre la simulación Monte Carlo completa y la evalúa.

```json
// body
{
  "iterations": 10000,
  "seed": 0,
  "tef": { "min": 5, "mode": 10, "max": 20 },
  "vuln": { "min": 19, "mode": 31, "max": 43 },
  "lossMagnitudes": {
    "productividad": { "min": 30000, "mode": 50000, "max": 70000 }
  },
  "riskType": "amenaza",
  "currency": "USD"
}
```
Devuelve `usedSeed`, `summary` (promedio/mediana/mín/máx/P90/CVaR95/prob. de exceder),
`evaluation` (clasificación + justificación), `sensitivity` (top 10 factores por
correlación), y `annualLosses` (los 10,000 valores simulados — guárdalos si vas a llamar
después a `/api/treatment/evaluate` con la estrategia Transferir/Seguro, que necesita la
distribución completa para un cálculo preciso, no solo el promedio).

**Reproducibilidad:** la misma combinación de `seed` + inputs siempre da exactamente el
mismo `annualLosses`. `seed: 0` genera una semilla aleatoria nueva cada vez (se devuelve en
`usedSeed` para que la anotes).

**Validación:** `iterations` debe ser un entero entre 1 y 50,000 (tope duro — sin esto, un
cliente podía pedir millones de iteraciones y bloquear el event loop de Node para todas las
demás peticiones). `tef`, `vuln` y cada entrada de `lossMagnitudes` deben ser objetos
`{min, mode, max}` numéricos con `min <= mode <= max`; `vuln` además debe estar en `0-100`.
Cualquier violación responde `400` con un mensaje específico, en vez de dejar pasar `NaN`
silenciosamente hacia el resultado.

### `POST /api/treatment/evaluate`
Evalúa las 4 estrategias de tratamiento (Mitigar, Transferir, Evitar, Aceptar) contra el
ALE actual, con ROSI y un veredicto en texto para cada una, más una recomendación.

```json
// body
{
  "currentALE": 469728,
  "annualLosses": [ /* opcional pero recomendado para Transferir preciso */ ],
  "mitigar": { "cost": 10000, "reductionPercent": 66, "reliability": "media", "delayDays": 30 },
  "transferir": { "premium": 15000, "deductible": 20000, "limit": 100000, "unlimited": false },
  "evitar": { "cost": 500000 },
  "currency": "USD"
}
```

### `GET /api/register`
Lista todos los riesgos guardados + Mapa de Calor, Análisis 80-20 (Pareto), y Sensibilidad
Consolidada.

### `PUT /api/register/:riskName`
Guarda o actualiza (si ya existe ese nombre) un riesgo en el registro — normalmente se
llama justo después de un `/api/simulate` exitoso, con su resultado.

### `DELETE /api/register/:riskName`
Quita un riesgo del registro.

## Notas de diseño importantes (para quien mantenga esto después)

- **`limit: 0` en el seguro significa CERO cobertura adicional, no "sin límite".** Para
  modelar una póliza sin tope hay que mandar `unlimited: true` explícitamente. Esto fue un
  bug real que se corrigió — ver la prueba en `test/lib.test.js`.
- **La sugerencia de Frecuencia NO debe depender de la Defensa** — solo de Motivación y
  Persistencia del atacante. La Defensa ya está aplicada en Vulnerabilidad; usarla también
  para ajustar la Frecuencia cuenta el mismo efecto dos veces.
- **Elegir un Nivel de Defensa Objetivo igual o peor que el actual da 0% de reducción de
  ALE** — nunca un número negativo ni premia una mala decisión.
- El motor de cálculo (`src/lib/`) no importa `express` ni nada del HTTP — se puede probar
  y reutilizar de forma completamente aislada, como hacen las pruebas en `test/`.
- `src/data/profiles.js` debe coincidir exactamente con los perfiles usados en
  `frontend/app_fair.html` (mismos factores y ponderaciones) — si difieren, el mismo riesgo
  da un resultado distinto según qué lado lo calculó. Si editas uno, edita el otro.
