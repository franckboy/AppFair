'use strict';

const { runMonteCarloSimulation, summarizeLosses, buildLossExceedanceCurve } = require('./simulation');
const { mulberry32 } = require('./random');
const { walkMarkovChain } = require('./markov');
const { normalizeTriggeredBy } = require('./register');
const { sampleVulnerabilityFromProfiles } = require('./autocalc');
const { attackerProfiles, defenseProfiles } = require('../data/profiles');

/**
 * Simulación Monte Carlo ACOPLADA del portafolio completo.
 *
 * El problema que resuelve: hasta ahora el CVaR95 y el p90 del portafolio se obtenían SUMANDO los
 * de cada riesgo (`totalResidualCVaR += residualCVaR` en register.js). El ALE sí se puede sumar —la
 * esperanza es lineal— pero un percentil NO: `p90(X + Y) ≠ p90(X) + p90(Y)`.
 *
 * CVaR es una medida coherente, así que es SUBADITIVA: `CVaR(X+Y) ≤ CVaR(X) + CVaR(Y)`. Sumarlos
 * por tanto SOBRESTIMA la cola del portafolio, salvo que todos los riesgos se materialicen el mismo
 * año. El atajo era conservador, no peligroso, pero tenía un costo real de negocio: la app no podía
 * mostrar NINGÚN beneficio de diversificación, así que un portafolio de 20 riesgos independientes
 * aparecía con una cola tan gorda como si los 20 ocurrieran a la vez.
 *
 * La solución correcta es simular todos los riesgos a la vez y sumar POR ITERACIÓN: cada iteración
 * es "un año posible" del portafolio entero, y de esa distribución conjunta salen percentiles de
 * verdad.
 *
 * SUPUESTO DE INDEPENDENCIA — declarado, no escondido: cada riesgo se muestrea con su propia
 * semilla derivada, así que se asumen mutuamente independientes. Eso es lo que produce el beneficio
 * de diversificación, y es una hipótesis fuerte: dos riesgos que comparten causa (un apagón que
 * dispara robo Y parada de producción) están correlacionados y esta simulación los subestimaría.
 * El Árbol de Riesgos en Cascada (cascadeSimulation.js) ya modela esas dependencias explícitamente
 * y es la fuente natural de correlación para una versión futura; hasta entonces, la independencia
 * queda documentada como limitación conocida.
 */

const PORTFOLIO_ITERATIONS = 10000;
const PORTFOLIO_BASE_SEED = 20260813;

/**
 * Reconstruye el sampler de Vulnerabilidad de un riesgo guardado. Si tiene Perfil de Atacante y
 * Defensa, se usa la contienda calibrada (mismo camino que POST /api/simulate); si no, cae al
 * triángulo capturado a mano, que `runMonteCarloSimulation` ya sabe muestrear.
 */
function buildVulnSampler(risk, defenseKeyOverride) {
    if (risk.vulnManualOverride) return null;
    const attackerProfile = attackerProfiles[risk.attackerKey];
    // El override existe para el estado RESIDUAL: ahí la Vulnerabilidad no es la del riesgo hoy
    // sino la que tendría con el Nivel de Defensa OBJETIVO del tratamiento adoptado, exactamente
    // como la simuló la página de Tratamiento (ver residualSpecOf).
    const defenseProfile = defenseProfiles[defenseKeyOverride || risk.defenseKey];
    if (!attackerProfile || !defenseProfile) return null;
    return sampleVulnerabilityFromProfiles(
        attackerProfile,
        defenseProfile,
        risk.dataConfidence || 'medio',
        risk.accessLevel,
    );
}

/** Un riesgo solo entra a la simulación conjunta si trae los tres insumos que la alimentan. */
function hasCompleteInputs(risk) {
    return !!(risk && risk.tef && risk.vuln && risk.lossMagnitudes);
}

/**
 * Factor `k` con el que se escala la Vulnerabilidad de un riesgo para simular su estado RESIDUAL
 * (después del Tratamiento adoptado). 1 = sin cambio.
 *
 * Se deriva de `residualALE / ale`, NO del `reductionPercent` del formulario de Mitigar: la
 * decisión adoptada solo persiste el residual (ver treatmentDecision en routes/register.js), y
 * derivarlo del residual es además autoconsistente con lo que de verdad se adoptó — no con lo que
 * quedara escrito en el formulario después. Sale sin casos especiales para las cuatro estrategias:
 * Evitar da 0, Aceptar da 1.
 *
 * Por qué escalar la Vulnerabilidad reproduce el residual: cada pérdida anual simulada es
 * `LEF x Magnitud` con `LEF = TEF x Vulnerabilidad`, así que multiplicar la Vulnerabilidad por k
 * multiplica cada una de las 10.000 pérdidas por k — y escalar una distribución entera por una
 * constante escala TODAS sus estadísticas por igual (la media tanto como el promedio de la cola).
 * Es el mismo argumento que ya justifica `residualCVaR = currentCVaR x (1 - reducción)` en
 * lib/treatment.js.
 *
 * TRANSFERIR queda fuera a propósito (devuelve 1, es decir: se simula sin tratamiento). El
 * deducible y el límite no son un escalado sino una TRUNCACIÓN de la cola escenario por escenario
 * — una transformación no lineal, sin ningún k que la represente. Simularlo como si nada se
 * hubiera hecho es conservador (nunca subestima), que es el mismo criterio que ya sigue la página
 * de Tratamiento cuando no puede calcular el beneficio real de una póliza.
 */
function residualScaleFactor(risk) {
    const decision = risk && risk.treatmentDecision;
    if (!decision) return 1;
    if (decision.strategy === 'transferir' || decision.strategy === 'mitigarTransferir') return 1;
    if (!(risk.ale > 0)) return 1;
    const k = decision.residualALE / risk.ale;
    if (!Number.isFinite(k) || k < 0) return 1;
    return Math.min(1, k);
}

/**
 * Cómo hay que simular un riesgo para obtener su estado RESIDUAL: `{ scale, defenseKey, damageCap }`.
 *
 * Por qué no basta un número. La Decisión de Tratamiento guardaba solo el RESULTADO
 * (`residualALE`), y de un solo número no se puede reconstruir una distribución: fija la media,
 * nunca la forma. Mitigar tiene DOS palancas que producen la misma media y colas completamente
 * distintas — prevenir escala la frecuencia, contener trunca la magnitud de cada evento — así que
 * el portafolio reconstruía cualquier tratamiento como si hubiera sido prevención pura. Medido
 * sobre un riesgo tratado con un tope de daño: el ALE salía bien ($43.018 real contra $42.918
 * reconstruido) y la cola salía casi al triple ($181.141 real contra $517.514). El error iba hacia
 * el lado conservador, pero 3x en la cifra con la que se decide si un tratamiento sirvió no es
 * aceptable.
 *
 * Por eso la decisión ahora guarda la RECETA (`residualInputs`) y esto solo la traduce:
 *  - `targetDefenseKey` (modo automático): con qué Nivel de Defensa se simuló el residual. Se
 *    reconstruye el mismo sampler calibrado TCap vs. RS, no una aproximación.
 *  - `preventionScale` (modo manual): la Vulnerabilidad escalada por 1 − r/100.
 *  - `damageCap`: el tope por evento. Va DENTRO de la decisión y no se lee de `mitigar.damageCap`
 *    a propósito — si se leyera el campo vivo, editar el tope después de adoptar cambiaría la cola
 *    del portafolio mientras `residualALE` sigue congelado, y los dos números se contradirían.
 *
 * Sin receta (decisiones adoptadas antes de que existiera) se cae al comportamiento anterior:
 * escalar por `residualALE / ale`. Exacto para prevención pura, aproximado si hubo contención.
 */
function residualSpecOf(risk) {
    const decision = risk && risk.treatmentDecision;
    const receta = decision && decision.residualInputs;
    if (!receta) return { scale: residualScaleFactor(risk) };
    if (decision.strategy === 'transferir' || decision.strategy === 'mitigarTransferir') return { scale: 1 };

    const spec = { scale: 1 };
    if (typeof receta.preventionScale === 'number' && Number.isFinite(receta.preventionScale)) {
        spec.scale = Math.max(0, Math.min(1, receta.preventionScale));
    }
    if (receta.targetDefenseKey && defenseProfiles[receta.targetDefenseKey]) {
        spec.defenseKey = receta.targetDefenseKey;
    }
    if (typeof receta.damageCap === 'number' && Number.isFinite(receta.damageCap) && receta.damageCap > 0) {
        spec.damageCap = receta.damageCap;
    }
    return spec;
}

/** Un tratamiento cuya cola NO se puede representar escalando (ver residualScaleFactor). */
function isNonScalableTreatment(risk) {
    const strategy = risk && risk.treatmentDecision && risk.treatmentDecision.strategy;
    return strategy === 'transferir' || strategy === 'mitigarTransferir';
}

/**
 * Decisión HEREDADA: adoptada antes de que existiera `residualInputs`, así que el portafolio tiene
 * que reconstruir su residual escalando por `residualALE / ale` en vez de re-simular con la receta.
 *
 * Solo MITIGAR se ve afectado, y eso importa para no alarmar de más:
 *   - `aceptar` da k = 1 y `evitar` da k = 0 — el escalado es EXACTO en los dos casos, no una
 *     aproximación;
 *   - `transferir` y `mitigarTransferir` ya se reportan aparte (nonScalableRiskNames);
 *   - solo `mitigar` puede haber usado un tope de daño, y ahí el escalado proporcional reconstruye
 *     una contención como si hubiera sido prevención pura.
 *
 * La DIRECCIÓN del error está medida y es lo que hace que esto se pueda decir con tranquilidad: el
 * ALE sale bien ($43.018 real contra $42.918 reconstruido) y la cola se SOBREESTIMA — $517.514
 * reconstruidos contra $181.141 reales, casi el triple. Es conservador, no peligroso, y por eso la
 * interfaz lo dice así en vez de limitarse a pedir que se recalcule.
 *
 * Se arregla volviendo a adoptar la estrategia en Tratamiento: al adoptar se persiste la receta.
 */
function hasLegacyResidual(risk) {
    const decision = risk && risk.treatmentDecision;
    return !!decision && decision.strategy === 'mitigar' && !decision.residualInputs;
}

/**
 * @param {Array<Object>} risks Entradas del Registro (ver routes/register.js).
 * @param {Object} [options]
 * @param {number} [options.iterations=10000]
 * @param {number} [options.seed] Semilla base; fija por defecto para que el resultado sea
 *   reproducible entre corridas (una cifra de portafolio que baila sin que cambien los datos es
 *   imposible de auditar).
 * @param {(risk:Object) => {scale:number, defenseKey?:string, damageCap?:number}} [options.specOf]
 *   Cómo simular cada riesgo. Por defecto `{ scale: 1 }` (sin cambio): la corrida ACTUAL.
 *   `simulateResidualPortfolio` le pasa residualSpecOf para obtener el estado después del
 *   Tratamiento, con la MISMA semilla — ver ahí por qué el pareo importa.
 * @returns {{summary:Object, lossExceedanceCurve:Array, includedCount:number, skippedCount:number,
 *   skippedRiskNames:string[], sumOfIndividualCVaR:number|null, diversificationBenefit:number|null}}
 */
/**
 * ¿De quién es el año malo? — asignación de Euler del CVaR95 del portafolio.
 *
 * El CVaR conjunto es SUBADITIVO: vale menos que la suma de los individuales, porque los riesgos
 * no ocurren todos el mismo año. Eso deja una pregunta sin responder, y es la que un comité hace
 * primero: de ese año malo conjunto, ¿cuánto pone cada riesgo?
 *
 * La respuesta NO es su CVaR individual. Un riesgo enorme que nunca coincide con los demás aporta
 * poco al año malo del portafolio; dos riesgos medianos que siempre caen juntos —porque uno
 * dispara al otro en el Árbol de Cascada— aportan mucho más de lo que sugieren por separado.
 *
 * La asignación correcta es condicionar a la cola CONJUNTA y promediar ahí lo que puso cada uno:
 *
 *     contribución_i = E[ pérdida_i | pérdida_total está en el 5 % de años peores ]
 *
 * Su propiedad clave es que **suma exactamente al CVaR95 del portafolio**, sin residuo que
 * repartir a ojo. No es una convención cómoda: es el teorema de Euler aplicado a una medida de
 * riesgo homogénea de grado 1, y es el mismo criterio con el que una aseguradora asigna capital
 * entre líneas de negocio. El test de la suite lo verifica como igualdad, no como aproximación.
 *
 * Detalle que hay que respetar o el total no cuadra: la cola tiene que ser EXACTAMENTE el mismo
 * conjunto de iteraciones que usa summarizeLosses para su cvar95 — las `n - floor(0,95n)` peores.
 * Por eso se ordenan ÍNDICES y no valores. Con empates da igual cuál de los empatados entre (su
 * valor es el mismo por definición), así que la suma no depende del criterio de desempate.
 *
 * @param {number[]} totalLosses Pérdida del portafolio por iteración (ya acoplada).
 * @param {Map<string, number[]>} contributionByRisk Lo que puso cada riesgo en cada iteración.
 *   Tiene que sumar `totalLosses` iteración por iteración, o la asignación no cuadra.
 * @returns {Array} Riesgos ordenados por contribución al año malo, de mayor a menor.
 */
function allocateTailContributions(totalLosses, contributionByRisk) {
    const n = totalLosses.length;
    if (n === 0 || contributionByRisk.size === 0) return [];

    const orden = Array.from({ length: n }, (_, i) => i).sort((a, b) => totalLosses[a] - totalLosses[b]);
    const cola = orden.slice(Math.floor(n * 0.95));
    if (cola.length === 0) return [];

    let cvarTotal = 0;
    for (const i of cola) cvarTotal += totalLosses[i];
    cvarTotal /= cola.length;
    let aleTotal = 0;
    for (let i = 0; i < n; i++) aleTotal += totalLosses[i];
    aleTotal /= n;

    const filas = [];
    contributionByRisk.forEach((serie, riskName) => {
        let enCola = 0;
        for (const i of cola) enCola += serie[i];
        const contribution = enCola / cola.length;
        let esperada = 0;
        for (let i = 0; i < n; i++) esperada += serie[i];
        const expectedLoss = esperada / n;
        filas.push({
            riskName,
            // Cuánto pone este riesgo en el año malo del PORTAFOLIO.
            contribution,
            sharePercent: cvarTotal > 0 ? (100 * contribution) / cvarTotal : 0,
            // Cuánto pone en un año promedio. La comparación entre las dos cuotas es el dato que
            // de verdad ordena un presupuesto: un riesgo que es el 8 % del promedio y el 31 % del
            // año malo es un problema de COLA, y se trata distinto que un costo recurrente.
            expectedLoss,
            expectedSharePercent: aleTotal > 0 ? (100 * expectedLoss) / aleTotal : 0,
            // Su propio año malo, a solas. Comparado con `contribution` dice qué parte de su cola
            // coincide con la de los demás: muy por debajo = su mal año casi nunca es el mal año
            // de todos.
            standaloneCVaR: summarizeLosses(serie).cvar95,
        });
    });
    return filas.sort((a, b) => b.contribution - a.contribution);
}

function simulatePortfolio(
    risks,
    { iterations = PORTFOLIO_ITERATIONS, seed = PORTFOLIO_BASE_SEED, specOf = () => ({ scale: 1 }) } = {},
) {
    const threats = (risks || []).filter((r) => r && r.riskType !== 'oportunidad');
    const usable = threats.filter(hasCompleteInputs);
    const skipped = threats.filter((r) => !hasCompleteInputs(r));

    if (usable.length === 0) {
        return {
            summary: null,
            lossExceedanceCurve: [],
            includedCount: 0,
            skippedCount: skipped.length,
            skippedRiskNames: skipped.map((r) => r.riskName),
            sumOfIndividualCVaR: null,
            diversificationBenefit: null,
            tailContributors: [],
        };
    }

    // Pérdida del portafolio por iteración: cada índice es "un año posible" vivido por TODOS los
    // riesgos a la vez. Sumar aquí (y no al final) es la diferencia entre un percentil real y la
    // suma de percentiles que se hacía antes.
    const portfolioLosses = new Array(iterations).fill(0);
    let sumOfIndividualCVaR = 0;

    // Dependencias declaradas por el usuario en el Árbol de Riesgos en Cascada. Cada arista dice
    // "si ocurre el padre, con esta probabilidad le sigue el hijo" — es la ÚNICA fuente de
    // correlación del portafolio, y viene de su criterio, no de un supuesto estadístico nuestro.
    const byName = new Map(usable.map((r) => [r.riskName, r]));
    const childrenOf = new Map();
    normalizeTriggeredBy(usable).forEach((risk) => {
        (risk.triggeredBy || []).forEach(({ riskName: parent, probability }) => {
            if (!byName.has(parent) || parent === risk.riskName) return;
            if (!childrenOf.has(parent)) childrenOf.set(parent, []);
            childrenOf.get(parent).push({
                state: risk.riskName,
                probability: Math.max(0, Math.min(1, (probability ?? 0) / 100)),
            });
        });
    });
    const hasCascade = childrenOf.size > 0;

    // lefSamples por riesgo: hace falta para decidir, iteración por iteración, si el riesgo
    // ocurrió "este año" y puede arrastrar a sus hijos.
    const lossesByRisk = new Map();
    // Lo que cada riesgo pone en CADA iteración del total. Con cascada se reescribe más abajo con
    // la contribución ya acoplada (adelgazada + arrastrada). Es lo que alimenta la asignación del
    // año malo, así que tiene que sumar `coupledLosses` iteración por iteración.
    const contributionByRisk = new Map();
    const lefByRisk = new Map();
    const magnitudeByRisk = new Map();
    // Cuántos eventos trajo cada año — lo necesita el adelgazamiento de la cascada para saber si
    // "quitar el 30% de las ocurrencias" significa tirar una moneda (un año de UN evento) o
    // multiplicar por 0,7 (un año de veinte). Es null con el modelo de valor esperado, donde la
    // pregunta no tiene respuesta.
    const eventCountByRisk = new Map();

    usable.forEach((risk, index) => {
        // Semilla derivada por posición: reproducible, y distinta para cada riesgo (con la misma
        // semilla para todos, los riesgos quedarían perfectamente correlacionados por accidente y
        // el resultado sería idéntico a la suma que estamos corrigiendo).
        // El escalado se aplica a los DOS caminos de Vulnerabilidad para que den lo mismo: al
        // triángulo capturado a mano (que muestrea runMonteCarloSimulation) y a la salida del
        // sampler calibrado por perfiles, si el riesgo tiene Atacante/Defensa. Escalar solo el
        // triángulo dejaría sin efecto el tratamiento en todo riesgo con perfiles — que son la
        // mayoría.
        // Las DOS palancas de Mitigar, cada una donde le toca (ver residualSpecOf): prevenir mueve
        // la Vulnerabilidad —por el Nivel de Defensa objetivo, o por un factor en modo manual— y
        // contener entra como tope por evento. Reconstruir la contención como si fuera prevención
        // acertaba el ALE y triplicaba la cola.
        const spec = specOf(risk);
        const k = spec.scale;
        const baseSampler = buildVulnSampler(risk, spec.defenseKey);
        const { annualLosses, lefSamples, magnitudeSamples, eventCounts } = runMonteCarloSimulation({
            iterations,
            seed: seed + index * 7919,
            tef: risk.tef,
            vuln: k === 1 ? risk.vuln : { min: risk.vuln.min * k, mode: risk.vuln.mode * k, max: risk.vuln.max * k },
            lossMagnitudes: risk.lossMagnitudes,
            sampleVuln: baseSampler && k !== 1 ? (rng) => k * baseSampler(rng) : baseSampler,
            magnitudeCap: spec.damageCap,
        });
        for (let i = 0; i < iterations; i++) portfolioLosses[i] += annualLosses[i];
        sumOfIndividualCVaR += summarizeLosses(annualLosses).cvar95;
        contributionByRisk.set(risk.riskName, annualLosses);
        if (hasCascade) {
            lossesByRisk.set(risk.riskName, annualLosses);
            lefByRisk.set(risk.riskName, lefSamples);
            magnitudeByRisk.set(risk.riskName, magnitudeSamples);
            eventCountByRisk.set(risk.riskName, eventCounts);
        }
    });

    // --- Correlación por cascada -------------------------------------------------------------
    // Instantánea ANTES de acoplar: sin ella no se pueden separar los dos efectos, que van en
    // direcciones opuestas. Diversificar BAJA la cola; correlacionar la SUBE. Reportar solo la
    // resta contra la suma los revuelve en un número que no mide ninguno de los dos.
    const independentSummary = summarizeLosses(portfolioLosses);

    // Cómo se acopla, y por qué ya NO se suma encima.
    //
    // El TEF capturado es la frecuencia PROPIA del riesgo, estimada de datos de incidentes — y
    // esos datos no vienen etiquetados por causa: ya incluyen las veces que el hijo ocurrió PORQUE
    // ocurrió el padre. Sumar la cascada encima contaba esas veces DOS veces. Con pocas aristas
    // era un detalle; con el árbol denso pasa a ser el efecto dominante, y peor en los riesgos
    // raros y severos (un hijo de 0,02/año arrastrado por un padre frecuente podía multiplicar su
    // aporte por decenas).
    //
    // La cascada no AÑADE ocurrencias: EXPLICA una parte de las que el hijo ya tenía. Se mide
    // empíricamente cuántas veces lo arrastra un padre sobre estas mismas iteraciones, se adelgaza
    // su parte espontánea en esa proporción, y se añade la arrastrada. El total esperado de cada
    // riesgo queda igual al declarado — su ALE individual no se mueve y el Registro no cambia —
    // pero esas ocurrencias caen EL MISMO AÑO que las del padre, que es lo que engorda la cola
    // conjunta. El efecto de la cascada pasa a verse donde de verdad está: en la cola, no en la
    // media.
    let coupledLosses = portfolioLosses;
    const overCoupledRiskNames = [];
    let inducedLoss = 0;
    if (hasCascade) {
        const cascadeRng = mulberry32(seed + 104729);
        const parents = [...childrenOf.keys()];
        const getTransitions = (name) => childrenOf.get(name) || [];
        // Solo pueden ser arrastrados los que tienen algún padre declarado.
        const arrastrables = new Set();
        childrenOf.forEach((hijos) => hijos.forEach((h) => arrastrables.add(h.state)));
        const reached = new Map([...arrastrables].map((name) => [name, new Uint8Array(iterations)]));

        for (let i = 0; i < iterations; i++) {
            // Un padre "ocurre este año" con probabilidad 1 - e^(-LEF), misma conversión de
            // frecuencia a ocurrencia que usa el Árbol de Cascada.
            const activos = parents.filter((name) => {
                const lef = lefByRisk.get(name);
                const p = lef ? 1 - Math.exp(-Math.max(0, lef[i])) : 0;
                return cascadeRng() < p;
            });
            if (activos.length === 0) continue;
            walkMarkovChain(activos, getTransitions, cascadeRng).forEach((name) => {
                // Los padres activos ocurrieron por su cuenta, no arrastrados.
                if (activos.includes(name)) return;
                const marca = reached.get(name);
                if (marca) marca[i] = 1;
            });
        }

        coupledLosses = new Array(iterations).fill(0);
        usable.forEach((risk) => {
            const propias = lossesByRisk.get(risk.riskName);
            const marca = reached.get(risk.riskName);
            // Contribución ACOPLADA de este riesgo: lo que de verdad aporta al total una vez
            // adelgazada su parte espontánea y sumada la que le arrastran sus padres. Sin esto, la
            // asignación del año malo repartiría sobre las pérdidas PREVIAS al acoplamiento y no
            // sumaría el CVaR conjunto.
            const aporte = new Array(iterations).fill(0);
            contributionByRisk.set(risk.riskName, aporte);
            if (!marca) {
                for (let i = 0; i < iterations; i++) {
                    coupledLosses[i] += propias[i];
                    aporte[i] = propias[i];
                }
                return;
            }
            // Ocurrencias/año que le inducen sus padres, medidas sobre estas mismas iteraciones.
            let veces = 0;
            for (let i = 0; i < iterations; i++) veces += marca[i];
            const inducedRate = veces / iterations;
            // Con cuántas ocurrencias/año contaba ya por su cuenta (LEF medio declarado).
            const lef = lefByRisk.get(risk.riskName);
            let ownRate = 0;
            for (let i = 0; i < iterations; i++) ownRate += lef[i];
            ownRate /= iterations;

            // Contradicción en los datos: los padres declarados inducen MÁS ocurrencias de las que
            // el hijo dice tener. Antes se sumaba en silencio e inflaba el portafolio; ahora su
            // parte espontánea se acota a cero y se reporta para poder revisarlo.
            const share = ownRate > 0 ? inducedRate / ownRate : 1;
            if (share > 1) overCoupledRiskNames.push(risk.riskName);
            const espontanea = Math.max(0, 1 - share);

            // Adelgazar un proceso de ocurrencias es quedarse con CADA evento con probabilidad
            // `espontanea` — no multiplicar la cifra del año por esa fracción. La diferencia es la
            // misma que motivó el modelo compuesto: un año con UN evento adelgazado al 30% no
            // cuesta el 30% de un incendio, cuesta un incendio el 30% de las veces y cero el resto.
            // Multiplicar inventaba años imposibles y, de paso, aplanaba la cola justo donde la
            // cascada debía engordarla.
            //
            // Con muchos eventos en el año las dos cosas convergen (la fracción que sobrevive
            // tiende a `espontanea`), así que arriba de este número se multiplica y ya — sortear
            // cientos de Bernoullis por año no cambiaría el resultado y sí el tiempo.
            const MAX_BERNOULLIS = 30;
            const conteos = eventCountByRisk.get(risk.riskName);
            const magnitudes = magnitudeByRisk.get(risk.riskName);
            for (let i = 0; i < iterations; i++) {
                const n = conteos ? conteos[i] : 0;
                if (conteos && n > 0 && n <= MAX_BERNOULLIS) {
                    let sobreviven = 0;
                    for (let j = 0; j < n; j++) if (cascadeRng() < espontanea) sobreviven++;
                    coupledLosses[i] += (sobreviven / n) * propias[i];
                    aporte[i] += (sobreviven / n) * propias[i];
                } else {
                    // Sin conteo de eventos (modelo de valor esperado, donde el año trae una
                    // fracción continua de evento) o con demasiados: multiplicar es lo correcto.
                    coupledLosses[i] += espontanea * propias[i];
                    aporte[i] += espontanea * propias[i];
                }
                if (marca[i]) {
                    coupledLosses[i] += magnitudes[i];
                    aporte[i] += magnitudes[i];
                    inducedLoss += magnitudes[i];
                }
            }
        });
    }

    const summary = summarizeLosses(coupledLosses);
    // Los dos efectos, medidos por separado contra la MISMA referencia:
    //   diversificationBenefit = cuánto sobrestimaba sumar colas (siempre >= 0)
    //   correlationPenalty     = cuánto mueve la cola la correlación declarada
    // Antes esto era una sola resta contra la suma, que los revolvía: con cascada declarada, el
    // "beneficio de diversificación" salía artificialmente bajo porque le habían restado la
    // correlación sin decirlo.
    //
    // `correlationPenalty` decía aquí "siempre >= 0" y ES FALSO — medido al construir la
    // asignación del año malo. Con aristas de probabilidad alta se vuelve NEGATIVA, y la causa es
    // una limitación real del arrastre: `marca` es un indicador 0/1, así que un padre arrastra a
    // su hijo COMO MUCHO UNA VEZ POR AÑO aunque haya ocurrido tres veces. Cuando casi toda la
    // ocurrencia del hijo pasa a ser inducida (espontánea ~ 0), esa regla le borra sus años de
    // VARIOS eventos, que son justo los que le engordaban la cola: concentrarlo con el padre sube
    // la cola, taparle los años múltiples la baja, y a probabilidad alta gana lo segundo.
    //
    // Se deja el comportamiento tal cual y se nombra la limitación, en vez de taparla con un
    // Math.max(0, ...) que escondería el síntoma. Arreglarlo de verdad es hacer el arrastre
    // MULTI-EVENTO (proporcional al conteo del padre), que es un cambio de modelo con su propia
    // calibración — no un parche. La suite lo fija en un test para que el día que se cambie, avise.
    const diversificationBenefit = sumOfIndividualCVaR - independentSummary.cvar95;
    const correlationPenalty = summary.cvar95 - independentSummary.cvar95;

    return {
        summary,
        lossExceedanceCurve: buildLossExceedanceCurve(coupledLosses),
        includedCount: usable.length,
        skippedCount: skipped.length,
        skippedRiskNames: skipped.map((r) => r.riskName),
        sumOfIndividualCVaR,
        diversificationBenefit,
        correlationPenalty,
        independentCVaR: independentSummary.cvar95,
        cascadeEdgeCount: [...childrenOf.values()].reduce((n, c) => n + c.length, 0),
        // Pérdida esperada que la cascada REUBICA (de espontánea a inducida por un padre). No es
        // pérdida nueva: la media del portafolio se preserva por construcción — el efecto de la
        // cascada vive en la cola, no en el promedio.
        cascadeInducedALE: inducedLoss / iterations,
        // Riesgos cuyos padres declarados inducen más ocurrencias de las que el propio riesgo
        // declara tener: contradicción de datos que antes se sumaba en silencio.
        overCoupledRiskNames,
        // De quién es el año malo: cuánto pone cada riesgo en la cola CONJUNTA. Suma exactamente
        // el `summary.cvar95` de arriba (ver allocateTailContributions).
        tailContributors: allocateTailContributions(coupledLosses, contributionByRisk),
    };
}

/**
 * Simulación conjunta del portafolio en su estado RESIDUAL: después del Tratamiento adoptado de
 * cada riesgo. Los que no tienen decisión adoptada entran tal cual (k = 1), igual que hoy.
 *
 * MISMA SEMILLA que la corrida actual, y no es un detalle: es lo que convierte "cuánto ahorra el
 * tratamiento" en una cifra exacta en vez de una estimación ruidosa. Con semillas distintas, la
 * resta entre las dos colas mezclaría el efecto del tratamiento con ruido de muestreo (a 10.000
 * iteraciones el error estándar ronda el 0,6% — suficiente para ensuciar un ahorro pequeño). Con
 * la misma, las dos corridas quedan PAREADAS: cada iteración es el mismo "año posible" vivido con
 * y sin tratamiento, y la diferencia es atribuible solo a la mitigación.
 *
 * El pareo es exacto, no aproximado: en getPertRandom (lib/random.js) escalar min/mode/max por k
 * deja alpha y beta idénticos, así que el sorteo Beta subyacente es el MISMO y el resultado es
 * exactamente k veces el original.
 *
 * @returns Lo mismo que simulatePortfolio, más `treatedCount` (cuántos riesgos traían una decisión
 *   adoptada), `nonScalableRiskNames` (los tratados con Transferir, que entran sin escalar porque
 *   su cola no se puede representar con un factor — ver residualScaleFactor) y
 *   `legacyResidualRiskNames` (mitigaciones sin receta, cuya cola sale sobreestimada — ver
 *   hasLegacyResidual).
 */
function simulateResidualPortfolio(risks, options = {}) {
    const threats = (risks || []).filter((r) => r && r.riskType !== 'oportunidad' && hasCompleteInputs(r));
    const result = simulatePortfolio(risks, { ...options, specOf: residualSpecOf });
    return {
        ...result,
        treatedCount: threats.filter((r) => r.treatmentDecision).length,
        nonScalableRiskNames: threats.filter(isNonScalableTreatment).map((r) => r.riskName),
        // Mitigaciones adoptadas sin receta: su cola viene SOBREESTIMADA (ver hasLegacyResidual).
        // Antes esto no se reportaba en ningún lado — el portafolio hacía el respaldo en silencio.
        legacyResidualRiskNames: threats.filter(hasLegacyResidual).map((r) => r.riskName),
    };
}

module.exports = {
    simulatePortfolio,
    allocateTailContributions,
    hasLegacyResidual,
    simulateResidualPortfolio,
    residualScaleFactor,
    residualSpecOf,
    PORTFOLIO_ITERATIONS,
    PORTFOLIO_BASE_SEED,
};
