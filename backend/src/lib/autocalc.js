'use strict';

const { confidenceSpreadFactors } = require('../data/profiles');
const { getPertRandom, mulberry32 } = require('./random');
const { runMonteCarloSimulation, summarizeLosses, buildLossExceedanceCurve } = require('./simulation');

/**
 * Promedio simple de los atributos numéricos de un perfil (Atacante o Defensa).
 * @param {Object} profile
 * @returns {number}
 */
function calculateProfileAverage(profile) {
    const values = Object.entries(profile)
        .filter(([key]) => key !== 'name')
        .map(([, value]) => value);
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function getConfidenceSpread(confidence) {
    return confidenceSpreadFactors[confidence] || confidenceSpreadFactors.medio;
}

// ---------------------------------------------------------------------------------------------
// CALIBRACIÓN DE VULNERABILIDAD — metodología propia de AppFair
// ---------------------------------------------------------------------------------------------
// `m` y el eje de contienda de abajo NO son valores curados a ojo: salen de seis anclas de juicio
// experto en seguridad patrimonial, emitidas por separado y ajustadas después contra la media
// SIMULADA (no contra la fórmula central — ver la nota de sesgo más abajo):
//
//     oportunista      vs. básica    ->  5 %       organizado     vs. estándar  -> 60 %
//     vandalismo       vs. básica    -> 35 %       organizado     vs. élite     -> 15 %
//     empleado desleal vs. avanzada  -> 30 %       estado-nación  vs. élite     -> 45 %
//
// `m` NO se eligió: queda determinado algebraicamente por las dos anclas de `organizado`, que
// comparten atacante contra dos defensas distintas — el eje de contienda se cancela y solo
// sobrevive `m`. El valor anterior (m=1, "caso base de la literatura") comprimía toda la grilla
// de 5x4 combinaciones al rango 17,7 %-76,3 %: pasar de defensa básica a élite apenas dividía la
// Vulnerabilidad a la mitad, así que la app subvaloraba sistemáticamente la inversión en
// seguridad, y eso alimentaba directo a Mitigar. Con esta calibración el rango real es 0,5 %-99,8 %.
//
// Sigue siendo deliberadamente INDEPENDIENTE del `m` que el usuario puede elegir en la sección de
// Equilibrio de Nash (nashEquilibrium.js): ese es un análisis exploratorio "qué pasaría si", nunca
// debe poder cambiar en silencio el resultado de la simulación real.
//
// Nada de esto lo prescribe ISO 31000, ISO 28000 ni ASIS: esas normas aportan el marco de proceso
// (contexto, identificación, análisis, evaluación, tratamiento), no estas cifras ni estas
// fórmulas. Es metodología cuantitativa propia de AppFair y así debe documentarse.
const TULLOCK_M = 6.8254;

// Eje de contienda: traduce el promedio SEMÁNTICO de un Perfil de Atacante (Motivación, Recursos,
// Capacidad, Persistencia, Sofisticación) a la escala en la que de verdad compite contra la
// Defensa. Hacía falta porque las dos escalas nunca se calibraron una contra otra — se venían
// comparando como si un punto de atacante valiera lo mismo que un punto de defensa, y no es así.
//
// Los cuatro nodos salen de las seis anclas de arriba. El nodo FA=60 está SOBREDETERMINADO (tres
// anclas lo fijan, un solo parámetro lo absorbe) y aun así el peor residuo de todo el conjunto es
// de 0,44 puntos porcentuales — eso es validación, no ajuste: nada obligaba a que cuadraran.
const ATTACKER_CONTEST_CALIBRATION = [
    { profileScore: 0, contestStrength: 0 },
    { profileScore: 18, contestStrength: 14.614 }, // intruso oportunista
    { profileScore: 43, contestStrength: 22.682 }, // vandalismo / hurtos comunes
    { profileScore: 60, contestStrength: 56.911 }, // empleado desleal y crimen organizado
    { profileScore: 90, contestStrength: 75.748 }, // terrorista o espía
];

/**
 * Traduce el promedio de un Perfil de Atacante al eje de contienda (ver
 * ATTACKER_CONTEST_CALIBRATION). Interpolación lineal monótona entre nodos; por encima del último
 * nodo extiende la pendiente del tramo final.
 *
 * Se aplica UNA SOLA VEZ, al promedio del perfil — nunca a cada muestra de Monte Carlo. Aplicarla
 * por muestra metía un sesgo de Jensen de hasta 11 puntos porcentuales (la curva es convexa, así
 * que el promedio de la curva supera a la curva del promedio) y descalibraba el modelo respecto a
 * las anclas. La banda de incertidumbre PERT se abre DESPUÉS, ya sobre el eje de contienda.
 *
 * @param {number} profileScore Promedio del Perfil de Atacante, 0-100.
 * @returns {number} Fuerza en el eje de contienda. NO es un porcentaje y puede pasar de 100.
 */
function attackerContestStrength(profileScore) {
    const score = Math.max(0, profileScore);
    const nodes = ATTACKER_CONTEST_CALIBRATION;
    for (let i = 1; i < nodes.length; i++) {
        if (score <= nodes[i].profileScore) {
            const prev = nodes[i - 1];
            const span = nodes[i].profileScore - prev.profileScore;
            const t = (score - prev.profileScore) / span;
            return prev.contestStrength + t * (nodes[i].contestStrength - prev.contestStrength);
        }
    }
    const last = nodes[nodes.length - 1];
    const prev = nodes[nodes.length - 2];
    const slope = (last.contestStrength - prev.contestStrength) / (last.profileScore - prev.profileScore);
    return last.contestStrength + slope * (score - last.profileScore);
}

// Cuánto puede escalar su sofisticación un atacante que decide no retirarse ante un desafío —
// 0-30% de refuerzo sobre su Capacidad de Amenaza de esta iteración.
//
// Nota honesta: esto cuenta la Persistencia dos veces, porque ya es uno de los cinco atributos que
// promedia el Factor de Amenaza. Se conserva a propósito. Se midió la calibración con y sin esta
// escalada: ambas ajustan las seis anclas con residuo prácticamente nulo y producen grillas
// equivalentes (la calibración absorbe el efecto por completo), así que quitarla sería un cambio
// de modelo sin beneficio medible y con riesgo de regresión en funciones vecinas.
const MAX_ESCALATION = 0.3;

// Ninguna defensa es perfecta. Sin este piso, las combinaciones más desparejas (oportunista contra
// defensa élite) daban 0,0 %, que afirma invulnerabilidad — una afirmación que ninguna evaluación
// de seguridad puede sostener.
const VULNERABILITY_FLOOR = 0.005;

// Versión del modelo de Vulnerabilidad. Se sube CADA vez que cambie `TULLOCK_M`,
// `ATTACKER_CONTEST_CALIBRATION`, `VULNERABILITY_FLOOR` o los atributos de un Perfil de Atacante,
// porque cualquiera de esas cosas cambia los números de una simulación.
//
// Cada simulación sella su resultado con esta versión y el Registro la guarda. Los riesgos
// guardados con una versión anterior NO se recalculan solos: en una herramienta de GRC,
// sobrescribir en silencio la evaluación guardada de un analista destruye la trazabilidad de por
// qué se decidió lo que se decidió. Se marcan como desactualizados y el analista decide cuáles
// vuelve a simular.
//   1 = Tullock m=1 sobre el promedio crudo del perfil, sin piso (hasta agosto de 2026).
//   2 = eje de contienda calibrado con 6 anclas de experto, m=6,8254, piso de 0,5 %.
//   3 = el Nivel de Confianza deja de mover la media (ver confidenceMeanCorrection): solo abre o
//       cierra el abanico. Cambia los números de todo riesgo capturado con confianza alta o baja.
const VULNERABILITY_CALIBRATION_VERSION = 3;

/**
 * Función de Éxito de Contienda de Tullock — probabilidad de que el lado "atacante" gane un
 * enfrentamiento contra el lado "defensa", en función de cuánta fuerza tiene cada uno. Fórmula
 * estándar de la economía de conflicto/teoría de juegos: `Atacante^m / (Atacante^m + Defensa^m)`.
 * A diferencia de una resta (`Atacante - Defensa`), es una RAZÓN — un empate a cualquier escala
 * (10 vs 10, o 90 vs 90) da 50% siempre, nunca depende de qué tan grandes sean los números en
 * juego. `m` controla qué tan decisiva es la diferencia: m=1 pesa la ventaja de forma
 * proporcional (caso base); m>1 hace que hasta una ventaja pequeña incline la balanza casi por
 * completo; m<1 deja al lado más débil con una probabilidad real de éxito incluso en desventaja.
 * @param {number} attackerStrength
 * @param {number} defenseStrength
 * @param {number} [m=TULLOCK_M]
 * @returns {number} decimal en [0,1]
 */
function tullockSuccessProbability(attackerStrength, defenseStrength, m = TULLOCK_M) {
    const a = Math.pow(Math.max(0, attackerStrength), m);
    const d = Math.pow(Math.max(0, defenseStrength), m);
    if (a === 0 && d === 0) return 0.5; // ambos en 0: empate por definición, evita 0/0 = NaN
    return a / (a + d);
}

/**
 * Arma los dos triángulos de la contienda a partir de los perfiles. Factorizado porque
 * sampleVulnerabilityFromProfiles y pairedVulnerabilitySample necesitan EXACTAMENTE los mismos
 * triángulos y antes los construían con código duplicado — con dos copias, cualquier ajuste de
 * calibración se aplicaba bien en una y se olvidaba en la otra.
 *
 * TCap vive en el eje de CONTIENDA (ver attackerContestStrength) y RS en la escala cruda de la
 * Defensa: ahí es donde se calibraron las anclas. TCap no lleva tope en 100 — el eje de contienda
 * no es un porcentaje.
 */
// Nivel de Acceso / Proximidad — modificador POR RIESGO, no del Perfil de Atacante.
//
// El mismo empleado desleal tiene acceso total a su bodega y ninguno al centro de datos, así que
// vive en la evaluación del riesgo concreto, no en el perfil (que se comparte entre riesgos). El
// acceso NO cambia quién es el atacante ni de qué es capaz: cambia cuánto de tu defensa llega
// realmente a interponerse, porque quien ya está adentro se salta salvaguardas enteras.
//
// Por eso modula la Fuerza de Resistencia (R_efectiva = R x alfa) y nunca la Capacidad de Amenaza.
// Bajo Tullock las dos operaciones son casi equivalentes —solo cuenta la razón C/R— pero NO del
// todo: el triángulo de Resistencia tiene un tope duro en 100 que ya muerde con defensa avanzada y
// élite, así que escalar R hacia abajo lo libera mientras que subir C no. Medido: contra defensa
// élite las dos rutas difieren hasta 4,7 puntos, y modular R da el resultado más conservador.
//
// `nulo` (alfa = 1,00) es el default y es un NO-OP exacto: las seis anclas de calibración se
// emitieron sin modificador de acceso, así que siguen valiendo tal cual y ningún riesgo ya
// guardado cambia de números.
const ACCESS_LEVELS = {
    nulo: { alpha: 1.0, name: 'Nulo / Externo' },
    bajo: { alpha: 0.8, name: 'Bajo / Perimetral' },
    medio: { alpha: 0.5, name: 'Medio / Operativo' },
    alto: { alpha: 0.25, name: 'Alto / Privilegiado' },
};
const DEFAULT_ACCESS_LEVEL = 'nulo';

function getAccessAlpha(accessLevel) {
    const level = ACCESS_LEVELS[accessLevel] || ACCESS_LEVELS[DEFAULT_ACCESS_LEVEL];
    return level.alpha;
}

// Las seis anclas de calibración se emitieron con Nivel de Confianza MEDIO, así que ese es el
// nivel de referencia: es el único en el que el modelo está anclado a un juicio experto.
const REFERENCE_CONFIDENCE = 'medio';

/**
 * Media de Vulnerabilidad de una configuración dada, con muestreo FIJO y sembrado. Es
 * determinista a propósito (misma entrada, mismo número siempre): se usa para calibrar, y una
 * calibración que cambiara de corrida en corrida haría irreproducible la simulación que alimenta.
 */
function estimateMeanVulnerability(contestStrength, defenseScore, persistence, spread, iterations = 2000) {
    const rng = mulberry32(0x5eed);
    const tcapMin = contestStrength * spread.min;
    const tcapMax = contestStrength * spread.max;
    const rsMin = defenseScore * spread.min;
    const rsMax = Math.min(100, defenseScore * spread.max);
    let sum = 0;
    for (let i = 0; i < iterations; i++) {
        const tcapSample = getPertRandom(tcapMin, contestStrength, tcapMax, 4, rng);
        const rsSample = getPertRandom(rsMin, defenseScore, rsMax, 4, rng);
        sum += resolveContest(tcapSample, rsSample, persistence, rng(), rng());
    }
    return sum / iterations;
}

// La corrección se memoiza por configuración: pairedVulnerabilitySample (ver abajo) reconstruye
// los triángulos en CADA iteración de Monte Carlo, así que sin esta caché el costo de calibrar se
// multiplicaría por 10,000.
const _confidenceCorrectionCache = new Map();

/**
 * Factor que se aplica a la Capacidad de Amenaza para que la Vulnerabilidad MEDIA no dependa del
 * Nivel de Confianza — solo su dispersión.
 *
 * El problema que resuelve: la confianza es incertidumbre EPISTÉMICA (habla de qué tan seguro está
 * el analista de su propio estimado), pero al ensanchar la banda PERT movía también el centro,
 * porque Tullock con m=6,83 es muy convexo y las iteraciones donde el atacante sale alto dominan
 * el promedio (desigualdad de Jensen). Medido antes de este arreglo: declarar confianza baja subía
 * la Vulnerabilidad de un oportunista contra defensa básica de 5,0 % a 11,8 % — 4,7 veces más
 * vulnerable por admitir que no estás seguro de tus datos, que es exactamente al revés de lo que
 * significa no estar seguro.
 *
 * Se resuelve por bisección (la media crece de forma monótona con el factor) hasta que la media de
 * ESTE nivel de confianza coincide con la del nivel de referencia. La banda sigue siendo más ancha
 * o más angosta: cambia el abanico, no el centro.
 */
function confidenceMeanCorrection(contestStrength, defenseScore, persistence, confidence) {
    if (confidence === REFERENCE_CONFIDENCE || contestStrength <= 0) return 1;
    const key = `${contestStrength}|${defenseScore}|${persistence}|${confidence}`;
    const cached = _confidenceCorrectionCache.get(key);
    if (cached !== undefined) return cached;

    const spread = getConfidenceSpread(confidence);
    const target = estimateMeanVulnerability(
        contestStrength,
        defenseScore,
        persistence,
        getConfidenceSpread(REFERENCE_CONFIDENCE),
    );

    let lo = 0.2;
    let hi = 5;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (estimateMeanVulnerability(contestStrength * mid, defenseScore, persistence, spread) < target) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    const factor = (lo + hi) / 2;
    _confidenceCorrectionCache.set(key, factor);
    return factor;
}

function buildContestTriangles(attackerProfile, defenseProfile, confidence, accessLevel) {
    const rawStrength = attackerContestStrength(calculateProfileAverage(attackerProfile));
    // El alfa de acceso se aplica ANTES de abrir el triángulo (y antes del tope de 100), para que
    // la banda de incertidumbre se abra alrededor de la Resistencia que de verdad se interpone.
    const defenseScore = calculateProfileAverage(defenseProfile) * getAccessAlpha(accessLevel);
    const persistence = attackerProfile.persistence || 0;
    const spread = getConfidenceSpread(confidence);
    // Re-centrado: el Nivel de Confianza abre o cierra el abanico, nunca mueve la media.
    const contestStrength = rawStrength * confidenceMeanCorrection(rawStrength, defenseScore, persistence, confidence);
    return {
        tcap: {
            min: contestStrength * spread.min,
            mode: contestStrength,
            max: contestStrength * spread.max,
        },
        rs: { min: defenseScore * spread.min, mode: defenseScore, max: Math.min(100, defenseScore * spread.max) },
        persistence,
    };
}

/**
 * Resuelve UNA iteración de la contienda a partir de muestras ya sorteadas de TCap y RS: aplica la
 * escalada por persistencia y devuelve la probabilidad de éxito de Tullock con el piso.
 * Compartida por el sampler y por el muestreo pareado, para que no puedan divergir.
 */
function resolveContest(tcapSample, rsSample, persistence, escalationRoll, escalationAmount) {
    // Escalada NO determinista: si la defensa va ganando ESTA iteración, un atacante persistente
    // tiene una probabilidad (proporcional a su PROPIA Persistencia, nunca a nada de la defensa)
    // de escalar su sofisticación en vez de desistir — un desafío que lo motiva más, no lo
    // disuade. Un atacante de Persistencia baja (oportunista) casi nunca escala; uno de
    // Persistencia alta (organizado, estado-nación) escala seguido. Se vuelve a tirar cada
    // iteración — nunca un `if` seco.
    let effectiveTcap = tcapSample;
    if (rsSample > tcapSample && escalationRoll < persistence / 100) {
        effectiveTcap = tcapSample * (1 + escalationAmount * MAX_ESCALATION);
    }
    return Math.max(VULNERABILITY_FLOOR, tullockSuccessProbability(effectiveTcap, rsSample));
}

/**
 * Vulnerabilidad = probabilidad de que un evento de amenaza se convierta en pérdida, modelada como
 * una contienda entre la Capacidad de Amenaza (TCap) y la Fuerza de Resistencia (RS) resuelta con
 * la Función de Éxito de Contienda de Tullock (ver tullockSuccessProbability arriba). Son dos
 * distribuciones INDEPENDIENTES que se comparan, nunca una que descuenta a la otra: tu defensa no
 * cambia quién es el atacante ni qué tan decidido está, cambia qué tan probable es que te tenga
 * éxito. (Reemplazó a `attackerScore * (1 - defenseScore/100)`, que sí hacía eso último.)
 *
 * TCap no es el promedio crudo del perfil: pasa primero por el eje de contienda calibrado
 * (attackerContestStrength), porque la escala del Atacante y la de la Defensa no son comparables
 * punto a punto.
 *
 * Devuelve un SAMPLER, no un número — compatible directo con el parámetro `sampleVuln` que
 * `runMonteCarloSimulation` (simulation.js) acepta exactamente para este propósito. Cada llamada
 * al sampler es una iteración: nunca es una fórmula fija, es una simulación real con su propia
 * incertidumbre.
 *
 * @param {Object} attackerProfile Perfil de Atacante completo (ver profiles.js) — se necesita
 *   `persistence` además del promedio, para la escalada.
 * @param {Object} defenseProfile Perfil de Defensa completo.
 * @param {'alto'|'medio'|'bajo'} confidence
 * @returns {(rng: () => number) => number} Sampler que devuelve un decimal en [0,1] por llamada.
 */
function sampleVulnerabilityFromProfiles(attackerProfile, defenseProfile, confidence, accessLevel) {
    const { tcap, rs, persistence } = buildContestTriangles(attackerProfile, defenseProfile, confidence, accessLevel);

    return (rng) => {
        const tcapSample = getPertRandom(tcap.min, tcap.mode, tcap.max, 4, rng);
        const rsSample = getPertRandom(rs.min, rs.mode, rs.max, 4, rng);
        return resolveContest(tcapSample, rsSample, persistence, rng(), rng());
    };
}

/** Resume un arreglo de muestras de Vulnerabilidad (0-100) como {min, mode, max} (percentiles
 * 10/50/90) — factorizado de summarizeVulnerabilitySamples para que calculateReduccionALEFromProfiles
 * (que arma sus muestras con pairedVulnerabilitySample, no con un sampler+rng compartido) pueda
 * reusar exactamente el mismo cálculo de percentiles sin duplicarlo. */
function summarizePercentiles(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const percentile = (p) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))];
    return {
        min: Math.round(Math.max(0, percentile(10))),
        mode: Math.round(Math.min(100, Math.max(0, percentile(50)))),
        max: Math.round(Math.min(100, percentile(90))),
    };
}

/**
 * Corre un sampler (ver sampleVulnerabilityFromProfiles) muchas veces y resume el resultado
 * como {min, mode, max} en escala 0-100 (percentiles 10/50/90) — mismo shape que devolvía la
 * vieja calculateVulnerability, para que la vista previa del Paso 2 y los reportes no tengan que
 * cambiar. No necesita una semilla reproducible (es solo una vista previa, no la simulación
 * real) — por defecto usa Math.random.
 * @param {(rng: () => number) => number} sampler
 * @param {number} [iterations=2000]
 * @param {() => number} [rng=Math.random]
 */
function summarizeVulnerabilitySamples(sampler, iterations = 2000, rng = Math.random) {
    const samples = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        samples[i] = sampler(rng) * 100;
    }
    return summarizePercentiles(samples);
}

// Sufijos que distinguen los 3 streams de rng independientes por iteración dentro de
// pairedVulnerabilitySample (ver ahí el porqué) — cualquier entero distinto sirve, son solo
// "sales" para que deriveIterationSeed no le dé el mismo seed a dos roles distintos.
const ROLE_TCAP = 0x1;
const ROLE_RS = 0x2;
const ROLE_ESCALATION = 0x3;

/** Deriva un entero de 32 bits determinista a partir de (semilla base, índice de iteración, rol)
 * — mezcla estilo Thomas Wang/Murmur (mismo estilo Math.imul-based que ya usa mulberry32 en
 * random.js), para que los 3 streams por iteración (TCap/RS/Escalada) no quedaron accidentalmente
 * correlacionados entre sí por compartir una fórmula lineal simple. */
function deriveIterationSeed(baseSeed, iteration, roleSalt) {
    let h = (baseSeed ^ Math.imul(iteration + 1, 0x9e3779b1) ^ roleSalt) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Una iteración de Vulnerabilidad (ver sampleVulnerabilityFromProfiles) para la comparación de
 * calculateReduccionALEFromProfiles — misma lógica exacta (TCap/RS independientes + escalada no
 * determinista + Tullock), pero con streams de rng INDEPENDIENTES por rol (TCap/RS/Escalada),
 * sembrados por (semilla, iteración, rol) en vez de un solo `rng` consumido secuencialmente.
 *
 * Por qué hace falta: "números aleatorios comunes" (comparar Defensa actual vs. objetivo con la
 * misma secuencia de aleatoriedad, para que el ruido de muestreo se cancele) solo funciona si
 * ambas corridas consumen esa secuencia EN EL MISMO ORDEN. Pero getPertRandom usa rejection
 * sampling (Marsaglia-Tsang, ver sampleGamma en random.js), que consume un número VARIABLE de
 * tiradas según los parámetros de forma (alpha/beta) — que dependen de defenseScore, distinto
 * entre el perfil actual y el objetivo. Con un solo rng compartido, la primera vez que el número
 * de tiradas difiere entre las dos corridas (ya desde la primera iteración) desincroniza TODO lo
 * que sigue, reintroduciendo el ruido que la técnica pretendía cancelar.
 *
 * Dándole a cada rol su PROPIO stream, sembrado por posición (semilla, iteración, rol) — no por
 * posición dentro de una secuencia compartida — TCap sale IDÉNTICO en ambas corridas (mismo
 * atacante, mismo seed, mismos parámetros → misma ejecución determinista de sampleGamma/sampleBeta
 * sin importar qué consumió RS antes o después). RS arranca del mismo punto de partida (mismo
 * seed) en ambas corridas aunque sus propios parámetros difieran (y por lo tanto también su
 * número de tiradas de rechazo) — sigue sin ser una cancelación perfecta de RS (eso exigiría
 * parámetros idénticos, lo que anularía la comparación), pero es la mejor aproximación disponible
 * a números aleatorios comunes sin reescribir sampleGamma para no usar rejection sampling.
 *
 * @param {Object} attackerProfile
 * @param {Object} defenseProfile
 * @param {'alto'|'medio'|'bajo'} confidence
 * @param {number} baseSeed
 * @param {number} iteration
 * @returns {number} decimal en [0,1] — misma Vulnerabilidad de una iteración que devolvería el
 *   sampler de sampleVulnerabilityFromProfiles.
 */
function pairedVulnerabilitySample(attackerProfile, defenseProfile, confidence, baseSeed, iteration, accessLevel) {
    const { tcap, rs, persistence } = buildContestTriangles(attackerProfile, defenseProfile, confidence, accessLevel);

    const tcapRng = mulberry32(deriveIterationSeed(baseSeed, iteration, ROLE_TCAP));
    const rsRng = mulberry32(deriveIterationSeed(baseSeed, iteration, ROLE_RS));
    const escRng = mulberry32(deriveIterationSeed(baseSeed, iteration, ROLE_ESCALATION));

    const tcapSample = getPertRandom(tcap.min, tcap.mode, tcap.max, 4, tcapRng);
    const rsSample = getPertRandom(rs.min, rs.mode, rs.max, 4, rsRng);

    return resolveContest(tcapSample, rsSample, persistence, escRng(), escRng());
}

/**
 * Dado el costo "Más Probable" de una categoría de Magnitud de Pérdida y el
 * Nivel de Confianza, deriva Mínimo y Máximo. El usuario solo da el valor
 * más probable — no tiene que adivinar el rango completo.
 * @param {number} mode
 * @param {'alto'|'medio'|'bajo'} confidence
 */
function calculateLossMagnitudeRange(mode, confidence) {
    const spread = getConfidenceSpread(confidence);
    return {
        min: Math.max(0, Math.round(mode * spread.min)),
        mode,
        max: Math.round(mode * spread.max),
    };
}

/**
 * Reducción de ALE (%) al "Mitigar": compara la Vulnerabilidad SIMULADA (ver
 * sampleVulnerabilityFromProfiles) con el Nivel de Defensa ACTUAL contra la que resultaría con
 * el Nivel de Defensa OBJETIVO que se alcanzaría con el control propuesto — mismo Perfil de
 * Atacante en los dos casos, nunca se toca. Reemplaza la vieja fórmula cerrada
 * `(objetivo-actual)/(100-actual)`, que era exacta SOLO porque la vieja Vulnerabilidad era
 * lineal en el Nivel de Defensa — con el modelo TCap vs. RS eso ya no es cierto, así que la
 * reducción real se mide corriendo la simulación en los dos escenarios y comparando.
 * Si el objetivo resulta igual o peor que el actual, la reducción es 0 (no premia una mala
 * decisión).
 * @param {Object} attackerProfile
 * @param {Object} currentDefenseProfile
 * @param {Object} targetDefenseProfile
 * @param {'alto'|'medio'|'bajo'} confidence
 */
function calculateReduccionALEFromProfiles(
    attackerProfile,
    currentDefenseProfile,
    targetDefenseProfile,
    confidence,
    accessLevel,
) {
    // "Números aleatorios comunes" de verdad: cada iteración i usa streams de rng
    // INDEPENDIENTES por rol (ver pairedVulnerabilitySample), sembrados por (semilla, i, rol) en
    // vez de compartir una sola secuencia consumida en orden — necesario porque getPertRandom usa
    // rejection sampling, que consume un número variable de tiradas según alpha/beta (distintos
    // entre el perfil de defensa actual y el objetivo); con un solo rng compartido eso
    // desincronizaba las dos corridas desde la primera iteración, reintroduciendo el ruido que la
    // técnica pretendía cancelar (ver el comentario completo en pairedVulnerabilitySample).
    const COMPARISON_SEED = 20260810;
    const COMPARISON_ITERATIONS = 2000;
    const currentSamples = new Array(COMPARISON_ITERATIONS);
    const targetSamples = new Array(COMPARISON_ITERATIONS);
    for (let i = 0; i < COMPARISON_ITERATIONS; i++) {
        currentSamples[i] =
            pairedVulnerabilitySample(attackerProfile, currentDefenseProfile, confidence, COMPARISON_SEED, i, accessLevel) * 100;
        targetSamples[i] =
            pairedVulnerabilitySample(attackerProfile, targetDefenseProfile, confidence, COMPARISON_SEED, i, accessLevel) * 100;
    }
    const currentSummary = summarizePercentiles(currentSamples);
    const targetSummary = summarizePercentiles(targetSamples);
    if (currentSummary.mode <= 0) return { currentSummary, targetSummary, reductionPercent: 0 };
    const reduccion = Math.round((1 - targetSummary.mode / currentSummary.mode) * 100);
    return { currentSummary, targetSummary, reductionPercent: Math.max(0, Math.min(100, reduccion)) };
}

// Semilla fija para calculateResidualFromSimulation — reproducible (mismo criterio que el resto
// de la app: misma entrada, mismo resultado exacto), no necesita "números aleatorios comunes"
// como calculateReduccionALEFromProfiles porque acá solo se corre UNA simulación fresca (la del
// Nivel de Defensa Objetivo), no se comparan dos corridas entre sí.
const RESIDUAL_SIMULATION_SEED = 20260811;
const RESIDUAL_SIMULATION_ITERATIONS = 10000; // mismo rigor que POST /api/simulate
// vuln nunca se muestrea de acá (sampleVuln la reemplaza por completo, ver simulation.js) — el
// valor exacto no importa, runMonteCarloSimulation solo exige que sea un rango válido.
const UNUSED_VULN_PLACEHOLDER = { min: 0, mode: 50, max: 100 };

/**
 * Residual REAL de Mitigar (ALE y CVaR), re-simulando con el Nivel de Defensa OBJETIVO — a
 * diferencia de escalar `currentALE`/`currentCVaR` por un `reductionPercent` compartido (válido
 * SOLO bajo la vieja Vulnerabilidad lineal, ver el comentario de `calculateReduccionALEFromProfiles`
 * y el hallazgo que motivó esta función), esto corre el motor Monte Carlo completo con
 * `sampleVuln = sampleVulnerabilityFromProfiles(attackerProfile, targetDefenseProfile, confidence)`
 * — el mismo mecanismo que ya usa `POST /api/simulate` — y lee `residualALE`/`residualCVaR`
 * directo de esa corrida real, sin asumir que ALE y CVaR se reducen en la misma proporción.
 *
 * `reductionPercent` se deriva de `residualALE` (no de comparar Vulnerabilidad por moda) para
 * quedar consistente con el residual real que esta misma función devuelve. Se acota a [0,100]
 * (no premia una mala decisión, mismo criterio que `calculateReduccionALEFromProfiles`) — pero
 * SOLO el porcentaje mostrado se acota; `residualALE`/`residualCVaR` siempre son el número real
 * simulado, aunque sea peor que el actual (degradar la defensa a propósito debe verse en dólares
 * reales, no ocultarse detrás de un 0%).
 *
 * @param {Object} attackerProfile
 * @param {Object} targetDefenseProfile
 * @param {'alto'|'medio'|'bajo'} confidence
 * @param {{min:number, mode:number, max:number}} tef
 * @param {Object<string,{min:number, mode:number, max:number}>} lossMagnitudes
 * @param {number} currentALE Pérdida Anual Esperada actual (ya simulada, ej. entry.ale) — el
 *   punto de comparación para derivar reductionPercent; no hace falta volver a calcularla.
 * @returns {{residualALE:number, residualCVaR:number, reductionPercent:number}}
 */
function calculateResidualFromSimulation(
    attackerProfile,
    targetDefenseProfile,
    confidence,
    tef,
    lossMagnitudes,
    currentALE,
    accessLevel,
) {
    const { annualLosses } = runMonteCarloSimulation({
        iterations: RESIDUAL_SIMULATION_ITERATIONS,
        seed: RESIDUAL_SIMULATION_SEED,
        tef,
        vuln: UNUSED_VULN_PLACEHOLDER,
        lossMagnitudes,
        sampleVuln: sampleVulnerabilityFromProfiles(attackerProfile, targetDefenseProfile, confidence, accessLevel),
    });
    const summary = summarizeLosses(annualLosses);
    const residualALE = summary.average;
    const residualCVaR = summary.cvar95;
    const reductionPercent =
        currentALE > 0 ? Math.max(0, Math.min(100, Math.round((1 - residualALE / currentALE) * 100))) : 0;
    return { residualALE, residualCVaR, reductionPercent };
}

// Semilla fija propia (distinta de RESIDUAL_SIMULATION_SEED) para
// calculateInherentRiskFromSimulation — mismo criterio de reproducibilidad que el resto de la
// app, sin compartir semilla con el residual (son corridas independientes, no se comparan entre
// sí iteración por iteración, así que no hace falta "números aleatorios comunes").
const INHERENT_SIMULATION_SEED = 20260812;
const INHERENT_SIMULATION_ITERATIONS = 10000; // mismo rigor que el resto

/**
 * Riesgo Inherente REAL (ALE y CVaR) — la exposición SIN ningún control, Vulnerabilidad al 100%.
 * Reemplaza la aproximación algebraica que usaba `computeFairRiskEquivalents`
 * (frontend/src/modules/fair-register.js: `entry.ale * (100 / vulnMean)`, "des-mitigar" el ALE
 * dividiendo entre la Vulnerabilidad media) — válida solo bajo la vieja Vulnerabilidad lineal,
 * igual que la aproximación que ya se reemplazó una vez para el residual de Mitigar (ver
 * calculateResidualFromSimulation arriba). Corre el motor Monte Carlo completo con
 * `sampleVuln` fijo en 100% en vez de reescalar un resultado ya simulado.
 *
 * A diferencia de `calculateResidualFromSimulation`, no hace falta ningún perfil de Atacante/
 * Defensa — "sin ningún control" no depende de a quién te enfrentas, es un escalar fijo.
 *
 * @param {{min:number, mode:number, max:number}} tef
 * @param {Object<string,{min:number, mode:number, max:number}>} lossMagnitudes
 * @returns {{inherentALE:number, inherentCVaR:number}}
 */
function calculateInherentRiskFromSimulation(tef, lossMagnitudes) {
    const { annualLosses } = runMonteCarloSimulation({
        iterations: INHERENT_SIMULATION_ITERATIONS,
        seed: INHERENT_SIMULATION_SEED,
        tef,
        vuln: UNUSED_VULN_PLACEHOLDER,
        lossMagnitudes,
        // No consume rng: Vulnerabilidad=100% (sin ningún control) es un escalar fijo, no hace
        // falta muestrearlo — el motor ya tolera un número variable de tiradas por iteración
        // (rejection sampling en getPertRandom/sampleGamma), esto no rompe nada nuevo.
        sampleVuln: () => 1,
    });
    const summary = summarizeLosses(annualLosses);
    // La curva del Inherente se devuelve junto al ALE/CVaR para poder superponerla a la del
    // riesgo Actual: dos curvas juntas enseñan de un vistazo cuánto separan tus controles el
    // "sin nada" del "con lo que hay hoy", que es la lectura que el waterfall da en un solo
    // número.
    return {
        inherentALE: summary.average,
        inherentCVaR: summary.cvar95,
        inherentLossExceedanceCurve: buildLossExceedanceCurve(annualLosses),
    };
}

module.exports = {
    calculateProfileAverage,
    getConfidenceSpread,
    tullockSuccessProbability,
    attackerContestStrength,
    ATTACKER_CONTEST_CALIBRATION,
    ACCESS_LEVELS,
    DEFAULT_ACCESS_LEVEL,
    getAccessAlpha,
    TULLOCK_M,
    VULNERABILITY_FLOOR,
    VULNERABILITY_CALIBRATION_VERSION,
    sampleVulnerabilityFromProfiles,
    summarizeVulnerabilitySamples,
    pairedVulnerabilitySample,
    calculateLossMagnitudeRange,
    calculateReduccionALEFromProfiles,
    calculateResidualFromSimulation,
    calculateInherentRiskFromSimulation,
};
