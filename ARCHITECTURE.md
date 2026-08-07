# AppFair — Documento técnico de arquitectura

> Este documento está pensado para que **otra IA** (u otro desarrollador) entienda el
> codebase sin tener que leer cada archivo desde cero: qué hace la app, cómo está
> organizada, y paso a paso cómo funciona cada pieza. Complementa a `README.md`
> (instalación/despliegue) y `backend/README.md` (endpoints/diseño del backend) — este
> archivo se enfoca en el **mecanismo interno**: fórmulas, flujo de datos, y por qué cada
> pieza está donde está.
>
> Todo el código y sus comentarios están en español; este documento sigue esa convención.

## 1. Qué es esta app

**AppFair** es una herramienta de gestión de riesgos empresariales para **seguridad física y
patrimonial** (no ciberseguridad), que combina:

- **FAIR** (Factor Analysis of Information Risk) como metodología de cuantificación de
  riesgo: en vez de una matriz cualitativa Probabilidad×Impacto, calcula una **Pérdida
  Anual Esperada (ALE)** en dólares, con una simulación **Monte Carlo** de 10,000
  iteraciones.
- **ISO 31000** como marco de proceso: Contexto (5.2/6.3.4), Evaluación, Tratamiento
  (6.5) y Gobernanza/Revisión (6.6).
- Referencias complementarias: **RIMS RA.1-2015**, **ISO 28001**, **ASIS International**
  (perfiles de atacante/defensa, catálogo de amenazas), **NFPA**, **ISO 22301** (continuidad
  de negocio), **COSO ERM**, **ISO 37001** (anticorrupción).

Es una app **full-stack de dos proyectos independientes**: el frontend **no calcula ni
persiste nada por su cuenta** — es un cliente HTTP de la API del backend, que es donde vive
todo el motor de cálculo (módulos puros de Node) y la persistencia.

```
frontend/app_fair.html (SPA estática)  ---HTTP + X-API-Key--->  backend/ (Express API REST)
        │                                                              │
        └─ frontend/src/main.js + modules/*.js (ES modules)            └─ src/lib/*.js (cálculo puro)
                                                                        └─ src/store/* (JsonStore | PostgresStore)
```

## 2. Backend (`backend/`)

### 2.1 Arranque (`server.js`)

Orden de middlewares (importa porque el orden define el comportamiento):

1. `cors()` — abierto a cualquier origen si `ALLOWED_ORIGIN` no está definida; si está,
   restringe a esa lista separada por comas.
2. `express.json({ limit: '2mb' })` — 2 MB porque el cliente puede reenviar
   `annualLosses` (10,000 números) a `/api/treatment/evaluate`.
3. `express-rate-limit` sobre `/api` completo (antes de la autenticación, a propósito, para
   frenar también intentos de adivinar la API key por fuerza bruta) — 300 peticiones / 15 min
   por defecto, configurable por `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`.
4. `GET /api/health` — **fuera** de la autenticación, para que un monitor de uptime externo
   lo pueda consultar sin credenciales. Devuelve `store: 'postgres'|'json'` (nunca la
   `DATABASE_URL` en sí) para confirmar desde afuera si un despliegue tiene persistencia real.
5. `createApiKeyAuth(apiKey)` — a partir de aquí, todo bajo `/api` exige el header
   `X-API-Key` (comparación en tiempo constante, ver 2.3).
6. Cada router se monta bajo su prefijo: `/api/config`, `/api/autocalc`, `/api/simulate`,
   `/api/treatment`, `/api/register`, `/api/assets`, `/api/risks`.
7. Manejador de errores genérico al final (evita que una excepción no controlada tumbe el
   proceso; loguea y responde 500 genérico).

Sin `API_KEY` en el entorno, se genera una temporal por proceso (se imprime en consola al
arrancar) — nunca corre sin exigir alguna key. Sin `DATABASE_URL`, usa `JsonStore` (archivo
local) — con ella, usa `PostgresStore`.

### 2.2 Persistencia (`src/store/`)

Ambos backends (`JsonStore`, `PostgresStore`) implementan la **misma interfaz** — un solo
"documento" con estas colecciones (ver `src/store/defaults.js`):

```js
{
  riskCriteria: null,      // se llena con defaultRiskCriteria si no existe (ver profiles.js)
  orgDefaults: { defenseKey, owner, dataSource, dataConfidence },
  orgContext: { nombreEmpresa, mision, naturalezaNegocio, apetitoRiesgo, partesInteresadas,
                entornoLegal, alcanceCadenaSuministro },
  riskRegister: [],        // riesgos ya simulados/guardados (ver 2.4)
  assets: [],               // Catálogo de Activos
  risks: [],                 // Historial unificado (Análisis Rápido / triage, ver 2.4)
}
```

- **`JsonStore`** (`src/store/jsonStore.js`): un archivo `backend/data/db.json`, lectura y
  escritura completas y síncronas en cada operación (`_readAll`/`_writeAll`) — sin
  concurrencia real porque Node es de un solo hilo y todo el ciclo es síncrono. Usado en
  desarrollo local y en **todos los tests** (nunca se configura `DATABASE_URL` en tests).
  Se pierde en cada redeploy si el disco es efímero (ej. Render free tier).
- **`PostgresStore`** (`src/store/postgresStore.js`): una sola fila `JSONB` (`id=1`) en la
  tabla `store_data` — mismo modelo de documento único, pero persistente. Todo método que
  hace "leer → modificar → escribir" pasa por `_withLock(mutator)`, que envuelve
  `SELECT ... FOR UPDATE` dentro de una transacción — evita una condición de carrera real que
  existía antes (dos peticiones casi simultáneas leyendo la misma foto de los datos, y la que
  escribe último borrando el cambio de la otra).
- **`registerIdentity.js`** — `findRegisterEntryIndex(register, entry)`: resuelve qué entrada
  del Registro corresponde a un `PUT`, con prioridad `id` > `sourceRiskId` > `riskName` (ver
  el comentario del archivo para el razonamiento completo — existe para que dos riesgos con
  el mismo nombre no se pisen entre sí).
- **`assetCascade.js`** — `clearDanglingAssetId(data, assetId)`: al borrar un activo, limpia
  (no borra) el vínculo `assetId` de cualquier riesgo del Registro o borrador que lo
  referenciaba, en vez de dejarlo apuntando a un activo fantasma.

### 2.3 Autenticación (`src/middleware/apiKeyAuth.js`)

Header `X-API-Key` comparado con `crypto.timingSafeEqual` (tiempo constante, para que medir
cuánto tarda una comparación fallida no filtre la key carácter por carácter). No es un
sistema de auth completo (sin usuarios/roles/expiración) — es la barrera mínima para que la
API no quede completamente abierta.

### 2.4 Rutas (`src/routes/*.js`)

| Método/Ruta | Archivo | Qué hace |
|---|---|---|
| `GET /api/config/profiles` | `config.js` | Perfiles de atacante/defensa, catálogo de riesgos, categorías de pérdida (solo lectura, viene del código, no de la base). |
| `GET/PUT /api/config/criteria` | `config.js` | Criterios de Riesgo (ISO 31000, 6.3.4): bandas Medio/Alto/Crítico, ALE Aceptable/Crítico, umbral de excedencia. |
| `GET/PUT /api/config/org-defaults` | `config.js` | Valores por defecto (defensa típica, dueño, fuente/confianza de datos). `PUT` usa `store.mergeConfig` (lee+escribe atómico). |
| `GET/PUT /api/config/org-context` | `config.js` | Contexto Organizacional (RIMS RA.1-2015, 5.2). |
| `POST /api/autocalc/vulnerability` | `autocalc.js` | Deriva rango Vulnerabilidad (min/mode/max) de `attackerKey`+`defenseKey`+`confidence`. |
| `POST /api/autocalc/loss-magnitude` | `autocalc.js` | Deriva min/max de cada categoría de pérdida a partir de su "más probable". |
| `POST /api/autocalc/reduccion-ale` | `autocalc.js` | % de reducción de ALE al pasar de un nivel de defensa actual a uno objetivo. |
| `POST /api/autocalc/attacker-defense-summary` | `autocalc.js` | Factor de Amenaza, Nivel de Defensa y su diferencial, para mostrar el resumen de perfiles. |
| `POST /api/simulate` | `simulate.js` | **El corazón de la app** — corre la simulación Monte Carlo (ver 2.5). |
| `POST /api/treatment/evaluate` | `treatment.js` | Evalúa Mitigar/Transferir/Evitar/Aceptar (+ combo Mitigar+Transferir) y recomienda (ver 2.6). |
| `GET/PUT/DELETE /api/register/:riskName` | `register.js` | CRUD del Registro de Riesgos — el `PUT` es el "guardar" que se llama justo después de simular. |
| `GET/POST/PUT/DELETE /api/assets[/:id]` | `assets.js` | CRUD del Catálogo de Activos, identificado por `id` (no por nombre — dos activos pueden compartir nombre). |
| `GET/POST/PUT/DELETE /api/risks[/:id]` | `risks.js` | Historial unificado (Análisis Rápido/triage) — un riesgo puede vivir aquí sin haber llegado nunca a FAIR. |

### 2.5 Motor de cálculo (`src/lib/`) — módulos puros, sin conocimiento de HTTP ni del store

**`random.js`** — generadores pseudoaleatorios:
- `mulberry32(seed)`: PRNG determinista — misma semilla ⇒ misma secuencia (reproducibilidad
  para auditoría).
- `getPertRandom(min, mode, max, lambda=4, rng)`: Beta-PERT, usada para **TEF** y
  **Vulnerabilidad** — concentra probabilidad alrededor de la moda (peso 4x en la media)
  en vez de tratarla como un punto más de una distribución lineal.
- `getLognormalRandom(min, mode, max, rng)`: usada para **Magnitud de Pérdida** — sin techo
  duro en `max` (una pérdida real puede superar el "peor caso" estimado). Se calibra por
  MOMENTOS: la lognormal resultante tiene la misma varianza que la triangular equivalente
  (`triangularVariance` + `solveLognormalSigmaSquared`, resuelto por bisección) y su moda es
  exactamente `mode` — preserva el "ancho de incertidumbre" que el usuario quiso decir, solo
  cambia la forma (cola realista). Cae a triangular si `mode <= 0` (lognormal no está
  definida ahí).

**`simulation.js`** — `runMonteCarloSimulation({iterations, seed, tef, vuln, lossMagnitudes})`:
por cada iteración `i` (típicamente 10,000):
```
TEF_i    ~ PERT(tef.min, tef.mode, tef.max)
Vuln_i   ~ PERT(vuln.min/100, vuln.mode/100, vuln.max/100)     // decimal, no %
LEF_i    = TEF_i * Vuln_i                                      // Frecuencia de Evento de Pérdida
LM_i     = Σ getLognormalRandom(cat.min, cat.mode, cat.max)     // suma de hasta 9 categorías
pérdida_i = LEF_i * LM_i
```
Cada variable se muestrea **independiente** dentro de la misma iteración — no hay
correlación entre TEF/Vuln/LM, ni entre riesgos distintos (cada `POST /api/simulate` es un
riesgo aislado). Además calcula `calculateSensitivity`: correlación de Pearson de cada
variable de entrada contra la pérdida final, para el ranking "qué tanto influye cada cosa"
(RIMS RA.1-2015, 6.3.4.3).

`summarizeLosses(losses, exceedanceThreshold)`: promedio, mediana, min, max, P90, **CVaR95**
(promedio del peor 5% de los escenarios — la "cola de riesgo" que el promedio no muestra) y
probabilidad de exceder un umbral.

**`autocalc.js`**:
- `calculateVulnerability(attackerScore, defenseScore, confidence)`:
  `mode = attackerScore * (1 - defenseScore/100)`, acotado a [1,99]; min/max se derivan de
  `confidenceSpreadFactors` (qué tan ancho es el rango según qué tan seguro dice estar el
  usuario).
- `calculateReduccionALE(currentDefenseScore, targetDefenseScore)`:
  `(objetivo - actual) / (100 - actual) * 100`, acotado a [0,100] — cuánto se reduciría el
  ALE al subir de un nivel de defensa a otro.

**`evaluation.js`** — clasifica un resultado FAIR contra los Criterios de Riesgo:
`evaluateFairThreat` (Crítico si `ale > aleCritico` **o** si `cvar95 > aleCritico` aunque el
promedio esté bien — la cola de riesgo cuenta aparte del promedio), `evaluateFairOpportunity`
(mismos umbrales, pero invertidos: un beneficio alto es deseable, no urgente de tratar).

**`treatment.js`** — evalúa las estrategias de tratamiento (ISO 31000, 6.5). Ver detalle en
la sección 2.6 más abajo (es el módulo más grande y con más lógica de negocio).

**`register.js`** — análisis consolidado sobre TODO el Registro:
`calculateParetoAnalysis` (80/20 de exposición — excluye riesgos `riskType: 'oportunidad'`,
cuyo "ale" es un beneficio, no una pérdida), `calculateConsolidatedSensitivity` (promedia la
sensibilidad de cada variable a través de todos los riesgos), `getRiskMatrixZones` (genera
las 7 zonas del mapa de calor 2D a partir de las bandas configuradas, en vez de colores fijos
en código).

**`validate.js`** — validación de entrada de las rutas: rangos triangulares
(`min <= mode <= max`, todos números finitos, no negativos), tope duro de iteraciones
(`MAX_ITERATIONS = 10000` — sin esto un cliente podía pedir millones de iteraciones y
bloquear el event loop, un DoS trivial), y validación del body de Tratamiento (porcentajes
0-100, montos no negativos).

**Motores nuevos (construidos esta sesión, distinto grado de conexión):**

- **`decisionTree.js`** — **conectado** a `treatment.js` (ver 2.6). Análisis de decisiones
  clásico (nodos `terminal`/`chance`/`decision`, evaluados por inducción hacia atrás — NO es
  el árbol de decisión de machine learning). `evaluateDecisionTree(node)` recorre hasta las
  hojas y calcula hacia arriba: un nodo `chance` es el valor esperado ponderado de sus ramas;
  un nodo `decision` es el máximo entre sus opciones (y reporta cuál ganó).
- **`markov.js`** — **construido pero sin conectar a ningún endpoint todavía**. Modela una
  "cascada independiente" (no una cadena de Markov de estados mutuamente excluyentes): dado
  un `rootState` y una función `getTransitions(state)`, cada transición saliente se evalúa
  independiente (`sampleActivatedTransitions`) — un padre puede activar más de un hijo a la
  vez. Pensado para el Árbol de Riesgos en Cascada (hoy solo un dibujo, ver 3.x), donde un
  riesgo padre puede desencadenar a varios hijos simultáneamente, no una cadena lineal.
  `walkMarkovChain` tiene protección contra ciclos (cada estado se activa una sola vez).
- **`bayesianNetwork.js`** — **construido pero sin conectar a ningún endpoint todavía**. Red
  bayesiana genérica por muestreo (likelihood weighting — aproximado, no eliminación de
  variables exacta): `forwardSample` (muestrea toda la red desde las raíces),
  `likelihoodWeightedSample`/`inferPosterior` (fija nodos de evidencia y pesa cada muestra
  por su probabilidad, para inferir el posterior de un nodo dado esa evidencia). Pensado para
  recalibrar el rango de Vulnerabilidad usando reportes/incidentes históricos en vez de solo
  el estimado a ojo de Atacante−Defensa.

### 2.6 Tratamiento del riesgo — el módulo con más lógica de negocio (`treatment.js`)

`evaluateTreatmentStrategies({currentALE, annualLosses, mitigar, transferir, evitar}, formatCurrency)`
evalúa, para un riesgo dado:

1. **Mitigar** — reduce el ALE en `reductionPercent`%. `avoidedLoss = currentALE - aleAfterMitigar`.
2. **Transferir** (seguro) — `calculateInsuranceRetainedALE` aplica deducible+límite (o
   cobertura ilimitada) a **cada escenario simulado** (`annualLosses[]`), no una aproximación
   sobre el promedio — necesita el arreglo completo de la simulación, que solo está
   disponible recién simulado (ver la nota sobre esto en la sección 3).
3. **Evitar** — elimina la fuente del riesgo; `avoidedLoss = currentALE` siempre (100% por
   definición).
4. **Mitigar + Transferir (combinado)** — `evaluateMitigarConTransferir`: un **árbol de
   decisión de 2 niveles**. Nivel 1 (azar): "¿Mitigar funciona?" (probabilidad = Fiabilidad
   de Mitigar). En CADA rama de ese resultado, nivel 2 (decisión): "¿aceptar el residual, o
   también transferirlo?" — con su propio nodo de azar (Fiabilidad del seguro). El seguro
   sobre el residual se calcula escalando `annualLosses` por la reducción lograda esa rama.
   Solo se evalúa si **ambos** costos (Mitigar y prima) están capturados.
5. **Aceptar/Retener** — sin costo, `residualALE = currentALE`.

**Cada estrategia con costo > 0** convierte su `avoidedLoss` determinista en un **valor
esperado** vía `expectedNetBenefit(cost, avoidedLoss, reliability)`: un árbol de decisión de
un solo nodo de azar, `p*(avoidedLoss - cost) + (1-p)*(-cost)`, donde
`p = RELIABILITY_TO_PROBABILITY[reliability]` (`alta: 0.9, media: 0.7, baja: 0.4` — una
calibración inicial razonable, no un dato medido, fácil de ajustar). Esto es lo que hace que
"Fiabilidad Baja" no sea solo un texto de advertencia — cambia el número real, y puede
cambiar cuál estrategia gana la recomendación.

**Regla "no hay estrategia gratis"**: ninguna estrategia (ni la combinación) cuenta como
"activa" para la recomendación si su costo quedó en el default (0) sin que el usuario lo haya
escrito — de lo contrario, `reductionPercent`/deducible autocalculados ANTES de escribir un
costo hacían que la app recomendara "gratis" algo que nunca lo es en la práctica.

**Recomendación**: la estrategia activa (costo > 0) con mayor `netBenefit`; si ninguna es
positiva, cae a "Aceptar".

### 2.7 Catálogos de referencia (`src/data/profiles.js`, ~1150 líneas)

- `attackerProfiles` / `defenseProfiles`: 5 perfiles de atacante y 4 de defensa, cada uno con
  5-6 atributos 0-100 cuyo promedio simple da el Factor de Amenaza / Nivel de Defensa.
- `riskCatalog`: catálogo curado de 3 niveles (Dominio → Categoría → Amenaza específica) —
  dominios `natural` (~80 amenazas: geológico, hidrometeorológico, biológico, etc.) y
  `humano` (robo, fraude, violencia, terrorismo, sabotaje, espionaje, delincuencia
  organizada, intrusión, corrupción, error humano), con referencia normativa por amenaza
  (ASIS, NFPA, ISO 22301/28000/37001, COSO, C-TPAT). Cada categoría trae
  `suggestedAssetCategories` (sugerencia editable de qué tipo de activo del Catálogo de
  Activos suele aplicar). Explícitamente **fuera de alcance**: ciberseguridad.
- `lossFormsKeys`/`lossFormsLabels`: las 9 categorías de Magnitud de Pérdida de FAIR
  (productividad, respuesta, reemplazo, multas, reputación, investigación, negocio no
  capturado, comunitario, ambiental).
- `defaultRiskCriteria`, `confidenceSpreadFactors`: valores de fábrica.

## 3. Frontend (`frontend/`)

### 3.1 Entrada y arranque

`frontend/app_fair.html` es la única página HTML (SPA de una sola vista, con secciones que
se muestran/ocultan por JS — no hay router de URLs). Todo su script es
`<script type="module" src="./src/main.js">` — **ya no hay lógica inline en el HTML** (la
migración de un único script de ~4500 líneas a ES modules reales terminó; ver "Plan de
migración" en `README.md`). Consecuencia real: abrir el HTML por doble clic (`file://`) ya
no funciona — los navegadores bloquean imports de módulos por CORS bajo `file://`; hace falta
`npm run dev` (Vite) en local, o cualquier servidor estático (GitHub Pages en producción no
se afecta, sirve HTTP normal).

`frontend/src/main.js` importa cada módulo por su efecto secundario — cada uno se
auto-registra en un namespace compartido `App` (`frontend/src/modules/app-namespace.js`,
`export const App = {}`) al importarse, ej.:
```js
// dentro de api.js:
export const Api = { ... };
App.Api = Api;   // efecto secundario del import
```
Así, un módulo puede llamar `App.OtroModulo.metodo()` sin importarlo directamente, y el
orden de los `import` en `main.js` no importa para la llamada en sí (solo para que ya esté
registrado cuando `App.init()` corre, que pasa después de todos los imports por construcción
de ES modules).

`App.init()` (definido en `main.js`, dentro de `DOMContentLoaded`):
1. `App.Api.initConnectionUI()` + `App.Api.bootstrap()` — trae perfiles/criterios/contexto
   del backend; si falla, muestra una pantalla de error ("boot-gate") y **no continúa**.
2. Si `App.OrgContext` no está completo, muestra un gate obligatorio (RIMS RA.1-2015, 5.2:
   entender la organización es un paso previo, no opcional) y espera a que se complete antes
   de seguir.
3. `App.continueInit()` — inicializa el resto de los módulos (`UIMode`, `Criteria`,
   `OrgDefaults`, `ConfigMenu`, `Autocomplete`, `Navigation`, `QuickAnalysis`, `RiskCatalog`,
   `AssetCatalog`, `RiskCascadeTree`, `Treatment`, `RiskManagement`, `FairAnalysis`) y muestra
   la página "Análisis FAIR" por defecto.

### 3.2 Estado compartido (`state.js`)

Un único objeto (`export const state = {...}`), no un store con reducers — quien lo importa
recibe la MISMA instancia, así que mutar `state.fair.x = ...` desde cualquier módulo se ve en
todos los demás. Nadie debe reasignar la variable completa. Namespaces:
`state.config` (criterios, iteraciones), `state.quick` (perfiles, catálogo, historial de
Análisis Rápido), `state.treatment`/`state.riskManagement` (entrada actual de esas páginas),
`state.fair` (todo el wizard: paso actual, riskRegister en memoria, validaciones por paso,
flags de edición manual).

### 3.3 Cliente HTTP (`api.js`)

`App.Api.request(path, {method, body})` — único punto que conoce la URL base y la API key
(guardadas en `localStorage`, configurables desde el modal "Conexión API"). Normaliza errores
a `Error` con `.userMessage` listo para mostrar (toast/modal) — 401 → "API key inválida",
error de red → "no se pudo conectar", cualquier otro `!response.ok` → el `error` que mande el
backend o un genérico. `App.Api.bootstrap()` trae perfiles + criterios + org-defaults +
org-context + assets en paralelo (`Promise.all`) al arrancar.

### 3.4 Módulos (`frontend/src/modules/*.js`) — uno por responsabilidad

| Módulo | Responsabilidad |
|---|---|
| `app-namespace.js` | El objeto `App` vacío — namespace compartido. |
| `state.js` | Estado compartido (ver 3.2). |
| `modal.js` | Modal genérico reutilizable (`Modal.alert/confirm/...`), sin dependencias de `App`/`state`. |
| `utils.js` | Utilidades sin estado: `sanitizeHTML`, `getSafeNumber`, `debounce` (con `.flush()`), `buildHistogramBins`, `sensitivityLabel`, `severityToClasses/Hex`, constantes de labels de categorías de pérdida. |
| `api.js` | Cliente HTTP (ver 3.3). |
| `navigation.js` | Cambia de página (`switchPage`) y dispara la recarga de datos de la página destino. |
| `criteria.js` | Página "Criterios de Riesgo" — `PUT /api/config/criteria`. |
| `org-defaults.js` | Página "Valores por Defecto" — `PUT /api/config/org-defaults`. |
| `org-context.js` | Página + gate obligatorio "Contexto Organizacional" — `PUT /api/config/org-context`. |
| `autocomplete.js` | Sugerencias de texto (Activo/Amenaza/Dueño) vía `<datalist>` — 100% local (`localStorage`), no llama al backend. |
| `risk-catalog.js` | Modal de 3 selects encadenados (Dominio→Categoría→Amenaza) sobre `riskCatalog` (solo lectura, del backend). |
| `asset-catalog.js` | CRUD completo del Catálogo de Activos — `/api/assets`. |
| `risk-cascade-tree.js` | Vista de árbol del vínculo "Riesgo Desencadenante" — **puramente informativa**, lee `state.fair.riskRegister` tal cual, sin combinar ni resimular nada (sumar ALEs correlacionados requeriría Monte Carlo conjunto — ver `markov.js`, no conectado todavía). |
| `treatment.js` | Página "Tratamiento del Riesgo" — `POST /api/treatment/evaluate` (ver 2.6 y 3.6). |
| `risk-management.js` | Página "Gestión de Riesgos" (Gobernanza/Revisión + Plan de Seguridad) — aplica a Amenazas y Oportunidades por igual. |
| `ui-mode.js` | Modo Simple/Técnico — cambia SOLO el lenguaje mostrado, nunca el cálculo. |
| `config-menu.js` | Router del menú "Configuración" (agrupa Criterios/Valores por Defecto/Catálogo de Activos). |
| `quick-analysis.js` | Historial unificado (`/api/risks`) — lo que queda de "Análisis Rápido" tras eliminar el cálculo duplicado de un solo punto. |
| `fair-export.js` | Genera el PDF (Informe Consolidado o de un riesgo) — re-evalúa Tratamiento contra el backend al vuelo (ver 3.7), dibuja histograma/heatmap/Pareto en un `<canvas>` offscreen. |
| `fair-register.js` (1115 líneas) | El Registro de Riesgos consolidado: dashboard (mapa de calor, Pareto, sensibilidad), guardar/borrar/re-simular un riesgo guardado. |
| `fair-wizard.js` (1618 líneas) | El formulario de 4 pasos de FAIR (Perfil Atacante/Defensa → TEF/Vulnerabilidad → Magnitud de Pérdida → Simulación), autocálculos en vivo, borrador en `localStorage`. |
| `fair-analysis.js` | Fachada delgada — solo orquesta el orden de arranque entre `FairWizard`/`FairRegister`. |

`fair-wizard.js` y `fair-register.js` tienen una dependencia circular intencional (cada uno
llama al otro) — es el motivo por el que quedaron juntos en la migración a ES modules en vez
de separarse más.

### 3.5 Flujo end-to-end de un análisis FAIR completo

1. **Paso 1** (`FairWizard`): nombre del riesgo (con catálogo opcional), activo afectado
   (con Catálogo de Activos opcional), tipo (Amenaza/Oportunidad), riesgo desencadenante
   opcional.
2. **Paso 2**: Perfil de Atacante + Nivel de Defensa → `POST /api/autocalc/vulnerability`
   sugiere el rango de Vulnerabilidad; TEF se sugiere localmente
   (`computeSuggestedTef`, en `utils.js`) salvo que el usuario ya haya editado el campo a
   mano (`state.fair.tefManuallyEdited`).
3. **Paso 3**: Magnitud de Pérdida por categoría → `POST /api/autocalc/loss-magnitude` sugiere
   min/max a partir del "más probable" que escribe el usuario.
4. **Paso 4**: `POST /api/simulate` corre Monte Carlo → muestra resumen (ALE, CVaR95, P90),
   evaluación contra criterios, histograma, sensibilidad — y, si el riesgo es Amenaza, la
   sección de Tratamiento (llama a `POST /api/treatment/evaluate`, **con** `annualLosses`
   porque el wizard todavía tiene el arreglo completo en memoria).
5. **Guardar**: `PUT /api/register/:riskName` con el resumen completo + insumos crudos
   (`tef`, `vuln`, `lossMagnitudes`, `seed`) para poder re-simular después, + los insumos de
   Tratamiento (`mitigar`/`transferir`/`evitar`) — pero **no** el arreglo `annualLosses`
   crudo (10,000 números) ni `chartLabels`/`chartData` sin agrupar; el histograma se guarda ya
   agrupado en ~20 barras.

### 3.6 Por qué Tratamiento y el PDF usan una versión "conservadora" de Transferir

Punto de diseño importante para cualquier cambio futuro: **el arreglo crudo de 10,000
pérdidas simuladas NO se persiste** (demasiado dato por riesgo). Eso significa que
`POST /api/treatment/evaluate` recibe `annualLosses` completo **solo** cuando se llama desde
dentro del wizard, recién simulado (`state.fair.lastAnnualLosses`). La página independiente
`App.Treatment` (extraída del wizard para poder tratar cualquier riesgo ya guardado sin
volver a simular) y `App.FairExport` (regenera el PDF) llaman al mismo endpoint **sin**
`annualLosses` — en ese caso, `calculateInsuranceRetainedALE` no puede correr, y Transferir
cae a una aproximación conservadora (usa el ALE promedio en vez de la distribución completa).
Es una decisión de diseño ya tomada y documentada en el código (no un bug) — cualquier mejora
que dependa de tener la distribución completa fuera del wizard necesita decidir primero si
vale la pena empezar a persistir ese arreglo (más espacio de almacenamiento) o si se acepta
que esa mejora solo aplique dentro del wizard.

### 3.7 Exportación a PDF (`fair-export.js`)

No usa una librería de PDF del lado del servidor — genera HTML fuera de pantalla (con
`Chart.js`/`html2canvas` para los gráficos, cargados por CDN) y lo imprime con el diálogo de
impresión del navegador ("Guardar como PDF"). `buildFullRiskReportSection` reconstruye el
reporte completo de un riesgo ya guardado a partir de sus insumos crudos, sin duplicar la
lógica de negocio del backend — vuelve a llamar a `/api/treatment/evaluate` en vez de
recalcular Tratamiento en el frontend. **Nota de estado actual**: esta tabla del PDF tiene 4
filas fijas (Mitigar/Transferir/Evitar/Aceptar) — no incluye todavía la estrategia combinada
`mitigarTransferir` que puede devolver el backend (gap conocido, sin resolver aún).

## 4. Testing

- **Backend** (`backend/test/`): `node:test` nativo.
  - `lib.test.js` — pruebas unitarias de los módulos puros de `src/lib/` (matemática pura,
    sin HTTP ni store) — incluye tests hand-calculados para Monte Carlo, autocálculo,
    tratamiento, y los 3 motores nuevos (Markov, red bayesiana, árbol de decisión).
  - `routes.test.js` — pruebas de integración HTTP con `supertest` contra la app Express
    completa (siempre con `JsonStore`, nunca configura `DATABASE_URL`).
  - `npm test` desde `backend/`.
- **Frontend** (`frontend/src/modules/*.test.js`): `vitest`, unitarias sobre funciones puras
  de los módulos (`utils.test.js`, `fair-register.test.js`, `risk-cascade-tree.test.js`,
  `asset-catalog.test.js`). `npm run test:unit` desde `frontend/`.
- **End-to-end** (`frontend/tests/*.spec.js`): `Playwright`, contra la app real (backend +
  frontend corriendo juntos vía `webServer` de la config de Playwright) — cubre los flujos
  completos (wizard de 4 pasos, Registro, Tratamiento, Gestión de Riesgos, Catálogo de
  Activos, exportación PDF, árbol de cascada). `npm run test:e2e` desde `frontend/`.
- Antes de dar por terminado cualquier cambio: `npm run lint` + `npm run format:check` en
  ambos proyectos, `npm test` (backend), `npm run test:unit` (frontend), `npx playwright
  test` (frontend) — en ese orden, todo en verde.

## 5. Despliegue

- **Frontend**: GitHub Pages sirve `frontend/app_fair.html` tal cual desde la rama `main`,
  sin build (estático). El repo también soporta `npm run build` (Vite) para una build de
  producción local, pero no es lo que corre en GitHub Pages actualmente.
- **Backend**: Render (nivel gratis, se duerme tras inactividad), definido por `render.yaml`
  en la raíz. Variables de entorno relevantes: `API_KEY`, `ALLOWED_ORIGIN`, `DATABASE_URL`
  (opcional, activa `PostgresStore`), `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`.

## 6. Convenciones establecidas (para mantener consistencia en cambios futuros)

- **Moneda fija a USD** en toda la app (Registro, Activos, simulación) — no es un default,
  es una decisión deliberada para que Pareto/mapa de calor nunca sumen/comparen monedas
  distintas sin convertir. No reabrir esto sin decisión explícita.
- **Identificación por `id`, no por nombre**, en toda entidad que un usuario pueda duplicar
  legítimamente (activos, riesgos del historial, entradas del Registro) — dos entidades
  pueden compartir nombre sin ser la misma.
- **Errores explícitos en vez de fallbacks silenciosos** para datos de entrada inválidos que
  afectan un cálculo financiero (ej. `decisionTree.js` revienta si las probabilidades de un
  nodo no suman 1) — el fallback silencioso solo se usa para campos categóricos de bajo
  impacto con un default razonable ya establecido en la UI (ej. `reliability` desconocida →
  trata como `'media'`).
- **Comentarios explican el PORQUÉ, no el QUÉ** — casi todo el código tiene comentarios sobre
  bugs reales que motivaron una decisión, no descripciones de lo que la línea hace.
- **`rng` inyectable con default `Math.random`** en todo generador aleatorio — permite tests
  deterministas con `mulberry32(seed)` sin cambiar la firma pública de la función.
- **Módulos de `src/lib/` (backend) son puros**: sin `require` de Express, sin conocimiento
  del store — reciben datos, devuelven datos. La glue HTTP vive solo en `src/routes/`.
- **Patrón `App.X = X` en el frontend**: cada módulo se auto-registra en el namespace
  compartido al importarse por efecto secundario — no hay un registro central manual.
- **Git**: cada cambio de negocio termina con `npm run lint`/`format:check` + suite completa
  (backend, frontend unit, E2E) en verde antes de commitear; commits con mensaje descriptivo
  del "por qué", merge `--no-ff` a `main`.

## 7. Estado de las piezas nuevas (Markov / Bayesiana / Árbol de decisión) al momento de
   escribir este documento

- **Árbol de decisión** (`decisionTree.js`): conectado a `treatment.js` (Fiabilidad de cada
  estrategia ya es una probabilidad real que afecta el beneficio neto esperado, incluyendo la
  combinación Mitigar+Transferir de 2 niveles).
- **Markov** (`markov.js`) y **Red Bayesiana** (`bayesianNetwork.js`): construidos, probados
  unitariamente, **sin ninguna conexión** a rutas ni al frontend todavía. Candidatos
  identificados (no implementados): Markov para simular en conjunto el Árbol de Riesgos en
  Cascada (hoy solo un dibujo estático); Bayesiana para recalibrar el rango de Vulnerabilidad
  con reportes históricos en vez de solo el estimado Atacante−Defensa.
