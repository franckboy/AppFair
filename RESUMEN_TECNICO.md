# Motor de Riesgos FAIR — Resumen Técnico

> Documento de contexto para retomar o explicar este proyecto a otra IA o
> desarrollador. Cubre: objetivo, matemática/metodología, arquitectura
> full-stack (frontend + backend) y la estructura de código de ambos.

## 1. Objetivo del proyecto

Herramienta de análisis cuantitativo de riesgos de seguridad patrimonial y
ciberseguridad, para una consultora de seguridad en Monterrey (BASC/CTPAT).
Combina:

- **FAIR** (Factor Analysis of Information Risk) como motor cuantitativo.
- **Simulación Monte Carlo** para modelar incertidumbre en vez de estimados
  puntuales.
- Alineación explícita con **ISO 31000**, **RIMS RA.1-2015**, y (parcial)
  **ISO 28001**.

Prioridad declarada del usuario: minimizar el sesgo en las evaluaciones
(rangos en vez de números únicos, trazabilidad de supuestos,
reproducibilidad).

**Arquitectura: full-stack, no un solo archivo.**

- `frontend/app_fair.html` (~4,500 líneas): HTML + CSS (Tailwind) + JS.
  Cliente de la API — ya **no calcula FAIR por su cuenta**. Análisis Rápido,
  autocompletado de texto y la preferencia Modo Simple/Técnico siguen siendo
  100% locales a propósito (el backend no tiene ni necesita endpoint para
  eso).
- `backend/`: API REST en Express con el motor de cálculo (FAIR + Monte
  Carlo + evaluación + tratamiento + registro) como módulos puros de Node,
  protegida por API key, con persistencia en archivo JSON (`data/db.json`).

## 2. La matemática y la metodología (el corazón del proyecto)

**No cambió nada aquí** al pasar de frontend-only a full-stack — es la misma
lógica, ahora vive en `backend/src/lib/` en vez de dentro de
`app_fair.html`, y el frontend la consume por HTTP.

### 2.1 Modelo FAIR

Por cada riesgo:

- **LEF** (Frecuencia de Pérdida) = TEF (Frecuencia de Evento de Amenaza) ×
  Vulnerabilidad
- **Pérdida anual** = LEF × Magnitud de Pérdida (suma de hasta 9 categorías)

Las 9 categorías de Magnitud de Pérdida: Productividad, Respuesta,
Reemplazo, Multas, Reputación, Investigación, Oportunidad, Comunitario,
Ambiental.

Cada variable de entrada (TEF, Vulnerabilidad, cada categoría de Magnitud)
se captura como rango de 3 puntos: Mínimo, Más Probable, Máximo — no un
número único. Esto es deliberado: es la base de la reducción de sesgo
(evita la falsa precisión de un solo dato).

### 2.2 Simulación Monte Carlo (`backend/src/lib/simulation.js`)

- 10,000 iteraciones por corrida (configurable, con tope duro de 50,000 en
  el backend — ver §7).
- Cada iteración muestrea un valor de cada variable usando una distribución
  triangular (fórmula estándar de transformación inversa) a partir de su
  rango Mín/Modo/Máx.
- Generador pseudoaleatorio con semilla (**mulberry32**, en
  `backend/src/lib/random.js`) — no `Math.random()` — para que la misma
  semilla + mismos inputs reproduzcan exactamente los mismos 10,000
  resultados (auditoría/reproducibilidad). Semilla = 0 genera una nueva al
  azar.
- De las 10,000 pérdidas simuladas se calculan: promedio (ALE), mediana,
  mínimo, máximo, P90 (percentil 90), CVaR 95% (Expected Shortfall —
  promedio del peor 5% de los escenarios), y probabilidad de exceder un
  umbral configurable.
- El cliente llama `POST /api/simulate` con los rangos y recibe de vuelta
  `summary`, `evaluation`, `sensitivity` y el arreglo completo de
  `annualLosses`.

### 2.3 Auto-cálculo (`backend/src/lib/autocalc.js`, vía `/api/autocalc/*`)

Para no pedirle al usuario números que ya puede inferir el sistema:

- **Vulnerabilidad** = Factor de Amenaza × (1 − Nivel de Defensa/100), donde
  Factor de Amenaza y Nivel de Defensa son el promedio de 5 y 6 atributos
  (0-100%) de perfiles predefinidos de Atacante y Defensa que el usuario
  solo selecciona (no escribe números).
- El ancho del rango (Mín/Máx alrededor del Modo) se deriva del "Nivel de
  Confianza" declarado (Alto/Medio/Bajo) — confianza baja = rango más
  ancho. Se aplica igual a Vulnerabilidad y a las 9 categorías de Magnitud
  de Pérdida.
- **Reducción de ALE al Mitigar** = (Defensa_Objetivo − Defensa_Actual) /
  (100 − Defensa_Actual) × 100, acotado a [0,100]. Elegir un objetivo igual
  o peor que el actual da 0%.
- La sugerencia de Frecuencia (TEF) usa solo Motivación y Persistencia del
  atacante — **no** la Defensa (ya está en Vulnerabilidad; usarla también
  ahí contaría el mismo efecto dos veces). Esta sugerencia sigue siendo
  cálculo local en el frontend (no llama al backend).
- Perfiles de Atacante/Defensa/Riesgo: antes vivían hardcodeados por
  duplicado en frontend y backend (y se desincronizaron — ver §7). Ahora el
  backend es la única fuente (`GET /api/config/profiles`); el frontend los
  carga al arrancar.

### 2.4 Evaluación del riesgo (ISO 31000, 6.4.4)

Compara el resultado simulado contra Criterios de Riesgo configurables (no
hardcodeados — `GET/PUT /api/config/criteria`, con persistencia en el
backend):

- **Riesgo Residual** (%, Análisis Rápido — sigue siendo cálculo local):
  bandas Medio/Alto/Crítico configurables.
- **ALE (FAIR)**: umbrales Aceptable/Crítico configurables, calculados por
  el backend. Clasifica también por CVaR 95% — si el promedio es aceptable
  pero la cola es alta, marca "Crítico (riesgo de cola)".
- Para riesgos tipo Oportunidad (riesgo positivo), la lógica se invierte: un
  valor alto es deseable.
- El backend devuelve un campo `severity` (`critico`/`alto`/`medio`/`bajo`)
  en vez de clases CSS — el frontend traduce eso a Tailwind
  (`severityToClasses`), porque el backend correctamente no sabe nada de
  CSS.

### 2.5 Análisis de Sensibilidad

Durante la simulación (backend) se guardan los valores muestreados de cada
una de las 11 variables (TEF, Vulnerabilidad, 9 categorías). Se calcula la
correlación de Pearson de cada una contra la pérdida final, y se rankean —
dice qué variable "mueve" más el resultado.

### 2.6 Tratamiento del riesgo (ISO 31000, 6.5 / Broder 1984, cap. 4-5)

`POST /api/treatment/evaluate` — 4 estrategias evaluadas en paralelo, cada
una con Costo, Fiabilidad y Tiempo de Implementación (Broder, 1984, cap. 5):

- **Mitigar** — reduce el ALE un % (derivado del cambio de nivel de
  defensa, §2.3).
- **Transferir (seguro)** — aplica deducible y límite de cobertura a cada
  uno de los escenarios simulados (no una aproximación sobre el promedio;
  el cliente manda `annualLosses` completo). Límite = 0 significa cero
  cobertura adicional, no "sin límite" — hay que marcar explícitamente la
  casilla "Cobertura ilimitada" para ese caso.
- **Evitar** — elimina la fuente, residual = 0 por definición.
- **Aceptar** — sin costo, requiere justificación documentada en texto
  (este campo sigue siendo local/borrador hasta guardarse).

Cada estrategia calcula ROSI (Return on Security Investment) = (Pérdida
Evitada − Costo) / Costo × 100, y un veredicto (`conviene`/`no_conviene`/
`neutro`/`sin_datos` + mensaje) que el frontend traduce a texto con
emoji/color. Los campos de este paso están atados a `input` de texto libre,
así que el frontend aplica un `debounce` de 400ms antes de llamar al
backend.

### 2.7 Registro de Riesgos consolidado (`/api/register/*`)

Cada riesgo FAIR simulado se guarda automáticamente en el backend
(`PUT /api/register/:riskName`, idempotente por nombre):

- **Mapa de calor**: eje X = Impacto (ALE como % del umbral Crítico), eje Y
  = Probabilidad de exceder el umbral de excedencia. Zonas de color
  (`heatmapZones`) generadas de las mismas bandas de Criterios de Riesgo,
  calculadas por el backend.
- **Análisis 80-20 (Pareto)**: riesgos ordenados por ALE descendente + %
  acumulado — ya viene calculado en `GET /api/register`.
- **Sensibilidad consolidada**: promedio de correlación de cada variable
  entre todos los riesgos guardados — también precalculado por el backend.
- Export a un solo PDF con todo el registro (sigue siendo `window.print()`
  en el cliente, sin librerías externas).

## 3. Estructura de módulos

### Frontend (`app_fair.html`) — patrón `App.NombreModulo = { init(), ... }`

- **`App.Api`** *(nuevo)* — cliente HTTP centralizado: `request()` con
  header `X-API-Key` y manejo de errores (red/401/400/500), `bootstrap()`
  que carga perfiles + Criterios + Valores por Defecto + Contexto desde el
  backend al arrancar, y el modal "Conexión API" (URL + key, guardadas en
  `localStorage` solo como credencial de conexión).
- **`App.UIMode`** — Interruptor Modo Simple/Técnico: traduce etiquetas y
  esconde secciones avanzadas (CSS `.advanced-only`/`.simple-only`). Nunca
  toca el cálculo. Modo Simple es el default. Sigue siendo 100% local.
- **`App.Navigation`** — Cambia entre páginas (Análisis Rápido, FAIR,
  Registro).
- **`App.Criteria`** — Modal de Criterios de Riesgo, ahora respaldado por
  `PUT /api/config/criteria`. Conserva `evaluateResidualRisk` (para Análisis
  Rápido, local); `evaluateFairALE`/`evaluateFairOpportunity` se eliminaron
  del frontend — esa evaluación ahora la hace el backend.
- **`App.OrgDefaults`** — Valores por defecto (moneda, defensa típica,
  dueño), respaldado por `/api/config/org-defaults`.
- **`App.OrgContext`** — Contexto Organizacional (misión, apetito de
  riesgo, alcance de cadena de suministro — ISO 28001), respaldado por
  `/api/config/org-context`.
- **`App.Autocomplete`** — `<datalist>` con sugerencias de texto ya usado.
  Sigue siendo local (el backend no tiene endpoint para esto).
- **`App.QuickAnalysis`** — Análisis Rápido (Riesgo Inherente/Residual), con
  su propio historial y mapa de calor. Sigue siendo 100% local, a propósito.
- **`App.FairAnalysis`** — El módulo grande: wizard de 4 pasos, ahora todos
  respaldados por el backend (autocálculo, simulación, tratamiento,
  registro), export a PDF, "Duplicar como Plantilla" (esta plantilla sigue
  siendo un borrador local, no compite con el backend).

### Backend (`backend/`)

```
server.js                  Arranca Express, monta rutas, exige X-API-Key
src/
  lib/
    random.js               mulberry32 + muestreo triangular
    simulation.js            Motor Monte Carlo + sensibilidad (Pearson)
    evaluation.js             Evalúa contra Criterios de Riesgo
    treatment.js               Las 4 estrategias + ROSI + veredicto
    autocalc.js                 Vulnerabilidad, rangos de Magnitud, Reducción ALE
    register.js                  Mapa de calor, Pareto, sensibilidad consolidada
    validate.js                   Validación de rangos/iterations/seed
  data/profiles.js          Perfiles de Atacante/Defensa/Riesgo (constantes)
  store/jsonStore.js        Persistencia en archivo JSON
  middleware/apiKeyAuth.js  Exige X-API-Key en todo /api/* salvo /api/health
  routes/                   config.js, autocalc.js, simulate.js, treatment.js, register.js
test/lib.test.js            13 pruebas (node --test), solo del motor puro
```

### Wizard FAIR (4 pasos, sin cambios en el flujo)

1. Escenario + Tipo de Riesgo (Amenaza/Oportunidad) + Gobernanza + Calidad
   de la Información + Perfil de Atacante/Defensa + Plan de Seguridad.
2. Frecuencia (con sugerencia local según Motivación/Persistencia) +
   Vulnerabilidad (automática, vía backend).
3. Magnitud de Pérdida — 9 categorías, solo el "Más Probable" es manual (el
   resto lo calcula el backend).
4. Simulación (backend) + Resultados + Evaluación + Sensibilidad +
   Tratamiento (backend) + Historial de Revisiones + guardado automático en
   el Registro (backend).

## 4. Bugs reales encontrados y corregidos (verificados con pruebas en navegador real)

### De antes de la integración (seguían corregidos, verificado en el código actual)

1. Botón de simulación completamente roto — `stepValidations[4]` no
   existía, tronaba con `TypeError` al hacer clic en "Ejecutar Simulación".
2. Doble conteo de Defensa — se aplicaba tanto en Vulnerabilidad como en la
   sugerencia de Frecuencia.
3. Límite de cobertura de seguro = 0 se interpretaba como cobertura
   ilimitada, en vez de cero cobertura adicional.
4. Vulnerabilidad se sobreescribía en silencio al transferir un riesgo de
   Análisis Rápido a FAIR.
5. Sin validación de ALE Aceptable < ALE Crítico en Criterios de Riesgo.

### Encontrados y corregidos en esta sesión (frontend + backend + integración)

6. **2 XSS almacenados** (frontend): `App.OrgContext.openEditor` y
   `App.OrgDefaults.openEditor` insertaban texto de usuario sin sanitizar
   directamente en `innerHTML` — uno vía ruptura de `</textarea>`, otro vía
   ruptura del atributo `value="..."`. Verificado con Playwright: ya no
   ejecutan script.
7. **API completamente abierta** (backend): no había ninguna autenticación
   en `/api/*` — cualquier origen podía leer/escribir Criterios, Contexto y
   Registro sin credenciales. Se agregó auth por `X-API-Key`.
8. **`iterations` sin límite ni validación** en `/api/simulate`: un cliente
   podía pedir millones de iteraciones (bloqueaba el event loop de Node) o
   mandar valores no numéricos (resultados con `NaN` en silencio). Se
   agregó validación y un tope de 50,000.
9. **Perfiles desincronizados** entre frontend y backend: el perfil
   "seguridad-fisica" de Análisis Rápido tenía factores y ponderaciones
   distintas en cada lado. Se sincronizaron, y luego se eliminó la
   duplicación de raíz (el frontend ahora carga los perfiles del backend en
   vez de tener su propia copia).
10. **Condición de carrera** al conectar el autocálculo de Magnitud de
    Pérdida: es asíncrono ahora (llama al backend), pero un segundo
    listener duplicado en los mismos campos reordenaba min/mode/max de
    forma síncrona antes de que la respuesta llegara, pisando el valor que
    el usuario acababa de escribir. Se eliminó el listener duplicado.

## 5. Alineación con estándares

Sin cambios respecto a antes — solo cambió dónde vive el código, no qué
cubre:

- **ISO 31000**: Contexto → Identificación → Análisis (FAIR+Monte Carlo) →
  Evaluación → Tratamiento → Monitoreo. Cobertura casi completa.
- **RIMS RA.1-2015**: Análisis de Sensibilidad, Análisis de Oportunidades,
  contenido del informe (Anexo D).
- **Broder (1984)**: la Matriz de Decisión clásica (Frecuencia × Severidad
  → Tratamiento) es el origen conceptual del motor de Tratamiento actual.
  Fiabilidad + Tiempo de Implementación (cap. 5).
- **ISO 28001** (parcial): Alcance de Cadena de Suministro y Plan de
  Seguridad por riesgo. Pendiente: Registro de Incidentes (cláusula 10) y
  Plan de Respuesta (cláusula 8).

## 6. Decisiones de diseño clave

- Generador de números determinista con semilla, no `Math.random()`, para
  reproducibilidad de auditoría — ahora vive solo en el backend.
- Ningún umbral de evaluación hardcodeado — todo sale de "Criterios de
  Riesgo", configurable, con validación de coherencia, ahora persistido en
  el backend.
- "Modo Simple" nunca cambia un cálculo, solo el texto visible y qué se
  muestra — sin cambios, sigue siendo puramente local.
- Todo auto-cálculo tiene opción de "ajustar manualmente" — nunca le quita
  el control a quien lo quiera usar.
- **Cambio de fondo respecto a la versión anterior de este documento**: ya
  no hay "persistencia 100% en localStorage, los datos nunca salen del
  navegador". Ahora el backend es la fuente de verdad para Criterios,
  Contexto, Valores por Defecto, simulaciones y Registro — viajan por red,
  protegidos por una API key simple (pensada para uso personal/demo, no
  para multiusuario real con roles). `localStorage` se sigue usando, pero
  solo para: la URL/API key de conexión, Análisis Rápido y su historial, el
  autocompletado de texto, la preferencia Simple/Técnico, y un borrador del
  wizard FAIR a medio llenar (red de seguridad ante un refresh accidental,
  no fuente de verdad).

## 7. Estado del repositorio

- Rama `claude/new-session-l3z5a1`, PR abierto:
  `https://github.com/franckboy/AppFair/pull/1`.
- `backend/test/lib.test.js`: 13 pruebas automatizadas (`node --test`),
  cubren el motor de cálculo puro — no las rutas HTTP.
- Sin CI configurado en el repo todavía (no hay `.github/workflows`).
- Backend no desplegado en ningún lado — corre local
  (`cd backend && npm install && npm start`). El frontend no necesita
  servidor propio, se abre `frontend/app_fair.html` directo en el
  navegador y se conecta a la URL del backend vía el botón "Conexión API".
