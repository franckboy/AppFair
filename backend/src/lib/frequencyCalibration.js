'use strict';

const { normalizeExposure, annualRate } = require('./exposure');

/**
 * CALIBRACIÓN DEL TEF CON DATOS PROPIOS — el factor que no tenía autocálculo.
 *
 * ## El desbalance que corrige
 *
 * `ALE = TEF · V · E[M]` es multilineal: la elasticidad de los tres factores es 1, así que un error
 * del 50 % en el TEF es un error del 50 % en la respuesta, exactamente igual que uno en la
 * Vulnerabilidad. Pero el esfuerzo estaba repartido al revés: la Vulnerabilidad se deriva de
 * perfiles calibrados contra anclas y una función de contienda (§5), y el TEF salía de una
 * corazonada con una sugerencia del perfil de atacante. Existían /autocalc/vulnerability,
 * /loss-magnitude, /reduccion-ale, /nash-equilibrium y /deterrence — no existía /frequency.
 *
 * ## Los dos pasos que no se pueden saltar
 *
 * ### 1. La bitácora observa LEF, no TEF
 *
 * Nadie registra al ladrón que probó la puerta y se fue: un conteo de incidentes cuenta PÉRDIDAS.
 * Enchufarlo directo al TEF haría que el motor le volviera a aplicar la Vulnerabilidad y descontara
 * las defensas dos veces (con V=30 % subestima 3,3×; con V=7 %, 14× — siempre hacia abajo).
 *
 * Por eso el primer paso es la inversión: `TEF = LEF / V`. Es la única forma de subir de lo
 * observado a lo que el motor consume, y es también la razón por la que este cálculo NECESITA la
 * Vulnerabilidad como entrada. Sin ella no se puede hacer, y devolver algo igual sería devolver un
 * número mal por un factor de 1/V.
 *
 * ### 2. La exposición no siempre está en años
 *
 * "3 robos en 1.200 viajes" es una tasa por viaje. Se convierte a anual con la exposición declarada
 * del riesgo (ver exposure.js). Con la unidad neutra el factor es 1 y no pasa nada.
 *
 * ## La mezcla: Poisson-Gamma exacto, sin constantes inventadas
 *
 * Un conteo de eventos en una exposición es Poisson; el conjugado de su tasa es Gamma. Eso da una
 * fórmula cerrada, y —lo que más importa— da el PESO de la evidencia sin que nadie tenga que elegir
 * una constante de credibilidad a dedo:
 *
 *     prior λ ~ Gamma(α, β)      con  media = α/β  y  CV² = 1/α
 *     posterior tras c eventos en exposición E:  Gamma(α + c, β + E)
 *     credibilidad de lo observado:  Z = E / (β + E)
 *
 * `α` sale del ANCHO DEL TRIÁNGULO que el usuario ya declaró: si el TEF va de 5 a 18 con moda 10,
 * eso es una incertidumbre concreta y medible, no una opinión sobre cuánto vale un prior. Un
 * triángulo ancho (mucha duda) se deja mover por poca evidencia; uno angosto se resiste. Es la
 * respuesta correcta, y sale de un dato que la app ya tenía sin usar para esto.
 *
 * `β = α / λ_prior` es entonces la EXPOSICIÓN EQUIVALENTE del prior: cuántos años (o viajes) de
 * observación propia vale la corazonada. Se devuelve explícito, porque es la cifra que de verdad
 * responde "¿cuánto pesa mi dato contra lo que el modelo ya creía?".
 *
 * ## Lo que se devuelve y lo que no
 *
 * Devuelve un triángulo (min/moda/max) listo para reemplazar el del formulario, más el desglose
 * completo de cómo se llegó a él. NO escribe nada: quien llama decide si lo adopta. Igual que el
 * resto de los autocálculos de la app, el número final es del usuario.
 */

/** Ancho del triángulo PERT en desviaciones estándar: SD ≈ (max − min) / 6. */
const PERT_RANGE_SIGMAS = 6;

/**
 * Techo de α. Un triángulo degenerado (min = moda = max) implica CV = 0 y α = ∞: un prior
 * infinitamente seguro que ninguna evidencia podría mover. Es casi siempre un descuido de captura,
 * no una certeza real, así que se topa en el equivalente a 10.000 observaciones — sigue siendo
 * "prácticamente inamovible", pero no rompe la aritmética.
 */
const MAX_PRIOR_ALPHA = 10000;

/**
 * Piso de α. Por debajo de 1 el Gamma deja de tener moda interior y el posterior se vuelve muy
 * inestable con pocos datos. α = 1 es el exponencial: máxima ignorancia todavía manejable.
 */
const MIN_PRIOR_ALPHA = 1;

/**
 * Media de un PERT estándar: (min + 4·moda + max) / 6. La misma que usa el muestreador (§12), para
 * que el prior que se calibra sea el mismo que el motor simula.
 */
function pertMean(min, mode, max) {
    return (min + 4 * mode + max) / 6;
}

/**
 * Parámetros Gamma implicados por un triángulo. Es el paso que convierte "no estoy seguro, va de 5
 * a 18" en un peso numérico comparable con el de una observación real.
 * @returns {{alpha:number, beta:number, mean:number, cv:number}|null}
 */
function gammaFromTriangle(tef) {
    if (!tef || typeof tef !== 'object') return null;
    const { min, mode, max } = tef;
    if (![min, mode, max].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
    if (max < min) return null;
    const mean = pertMean(min, mode, max);
    if (mean <= 0) return null;
    const sd = (max - min) / PERT_RANGE_SIGMAS;
    const cv = sd / mean;
    // CV = 0 (triángulo degenerado) -> alpha topado, ver MAX_PRIOR_ALPHA.
    const alpha = cv > 0 ? Math.min(MAX_PRIOR_ALPHA, Math.max(MIN_PRIOR_ALPHA, 1 / (cv * cv))) : MAX_PRIOR_ALPHA;
    return { alpha, beta: alpha / mean, mean, cv };
}

/**
 * Triángulo implicado por un Gamma(α, β): se invierte gammaFromTriangle para volver a la forma que
 * el formulario y el motor entienden. La moda del triángulo se fija en la MEDIA del posterior (no
 * en la moda del Gamma) a propósito: es la media la que el PERT reproduce, así que usar la moda del
 * Gamma metería un sesgo sistemático entre lo que este cálculo dice y lo que el motor simula.
 */
function triangleFromGamma(alpha, beta) {
    const mean = alpha / beta;
    const sd = Math.sqrt(alpha) / beta;
    const half = (PERT_RANGE_SIGMAS / 2) * sd;
    return {
        min: Math.max(0, mean - half),
        mode: mean,
        max: mean + half,
    };
}

/**
 * Calibra el TEF anual de un riesgo mezclando su triángulo declarado (prior) con un conteo de
 * incidentes propio (evidencia).
 *
 * @param {Object} params
 * @param {{min:number,mode:number,max:number}} params.tef Triángulo declarado, en intentos/AÑO.
 * @param {{min:number,mode:number,max:number}|number} params.vuln Vulnerabilidad en %, para
 *   invertir de pérdidas observadas a intentos. Acepta el triángulo o un porcentaje suelto.
 * @param {number} params.observedEvents PÉRDIDAS observadas (no intentos). 0 es válido y significa
 *   "se revisó y no pasó" — evidencia real, no ausencia de dato.
 * @param {number} params.observedExposure En cuánta exposición se observaron, en la unidad de abajo.
 * @param {{unit:string, annual:number}} [params.exposure] Exposición declarada del riesgo. Sin ella
 *   se asume la unidad neutra (años), o sea el comportamiento de siempre.
 * @returns {{tef:Object, credibilidad:number, exposicionEquivalentePrior:number, ...}|{error:string}}
 */
function calibrateFrequency({ tef, vuln, observedEvents, observedExposure, exposure }) {
    const prior = gammaFromTriangle(tef);
    if (!prior) return { error: 'El TEF declarado no forma un triángulo utilizable (min/moda/max >= 0, max >= min).' };

    const vulnPercent = typeof vuln === 'number' ? vuln : vuln && typeof vuln.mode === 'number' ? vuln.mode : null;
    if (vulnPercent === null || !Number.isFinite(vulnPercent) || vulnPercent <= 0 || vulnPercent > 100) {
        return { error: 'Hace falta la Vulnerabilidad (0 < V <= 100) para convertir pérdidas observadas en intentos.' };
    }
    if (typeof observedEvents !== 'number' || !Number.isFinite(observedEvents) || observedEvents < 0) {
        return { error: 'observedEvents debe ser un número >= 0 (las pérdidas que de verdad ocurrieron).' };
    }
    if (typeof observedExposure !== 'number' || !Number.isFinite(observedExposure) || observedExposure <= 0) {
        return { error: 'observedExposure debe ser un número mayor que 0 (en cuánto se observó).' };
    }

    const exp = normalizeExposure(exposure);
    const v = vulnPercent / 100;

    // 1. Lo observado, en su propia unidad, son PÉRDIDAS.
    const tasaLefObservada = observedEvents / observedExposure;
    // 2. La inversión: de pérdidas a intentos. Sin esto se descuentan las defensas dos veces.
    const tasaTefObservada = tasaLefObservada / v;
    // 3. A intentos por AÑO, que es la unidad en la que vive el TEF.
    const tefObservadoAnual = annualRate(tasaTefObservada, exp);

    // 4. La evidencia se pesa en AÑOS de exposición equivalente, la misma escala que β.
    const exposicionAnios = observedExposure / exp.annual;
    // El conteo entra al Gamma en intentos, no en pérdidas: es el mismo cambio de escala del paso
    // 2, y omitirlo aquí le daría a la evidencia el peso de un conteo mucho más chico del real.
    const intentosEquivalentes = observedEvents / v;

    const alphaPost = prior.alpha + intentosEquivalentes;
    const betaPost = prior.beta + exposicionAnios;
    const credibilidad = exposicionAnios / betaPost;

    return {
        tef: triangleFromGamma(alphaPost, betaPost),
        // Cuánto del resultado lo pone el dato propio (0 = todo prior, 1 = todo evidencia).
        credibilidad,
        // Cuántos AÑOS de observación propia vale la corazonada declarada. Es la cifra que responde
        // "¿cuánto pesa mi dato contra lo que el modelo ya creía?" sin hablar de Gammas.
        exposicionEquivalentePrior: prior.beta,
        exposicionObservadaEnAnios: exposicionAnios,
        tefPriorAnual: prior.mean,
        tefObservadoAnual,
        // Se devuelven los dos para que la UI pueda decir "observaste 0,0025 pérdidas por viaje;
        // el modelo esperaba 0,002" sin recalcular nada por su cuenta.
        tasaLefObservada,
        tasaTefObservada,
        unidad: exp.unit,
        exposicionAnualDelRiesgo: exp.annual,
        vulnerabilidadUsada: vulnPercent,
    };
}

module.exports = {
    PERT_RANGE_SIGMAS,
    MAX_PRIOR_ALPHA,
    MIN_PRIOR_ALPHA,
    pertMean,
    gammaFromTriangle,
    triangleFromGamma,
    calibrateFrequency,
};
