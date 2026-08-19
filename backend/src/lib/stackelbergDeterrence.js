'use strict';

const { tullockSuccessProbability } = require('./autocalc');
const { mulberry32, getPertRandom } = require('./random');

/**
 * DISUASIÓN: ¿a partir de qué inversión deja de convenirle atacarme?
 *
 * ## Qué le falta al modelo sin esto
 *
 * El motor de simulación asume que la frecuencia de ataque es un dato fijo: subir las defensas
 * baja la Vulnerabilidad (cuántos lo logran) pero deja intacto el TEF (cuántos lo intentan). Los
 * ladrones siguen viniendo la misma cantidad de veces aunque la bodega parezca un búnker.
 *
 * La consecuencia práctica es que el modelo NUNCA puede decir "con esto alcanza": cada peso de
 * defensa baja la pérdida un poco, en línea recta, para siempre. Más siempre es mejor, así que lo
 * único que decide cuándo parar es el presupuesto. En el mundo real existe un punto donde el
 * atacante hace la cuenta y se va al vecino.
 *
 * ## Por qué es Stackelberg y no Nash
 *
 * Nash (ver nashEquilibrium.js) asume que los dos eligen a la vez, a ciegas. Pero en seguridad
 * física el defensor juega PRIMERO y A LA VISTA: el atacante ve la barda, la custodia y la
 * certificación antes de decidir. Eso es un juego de líder-seguidor, y su concepto de solución es
 * el equilibrio de Stackelberg. La diferencia no es académica — el líder hace estrictamente mejor
 * que bajo Nash, porque comprometerse visiblemente vale. Esa ventaja de compromiso ES la
 * disuasión, formalizada.
 *
 * ## El parámetro que hace toda la diferencia: la alternativa del atacante
 *
 * Un atacante ataca si su mejor resultado acá supera lo que consigue EN OTRO LADO con el mismo
 * esfuerzo. La disuasión no es una propiedad de tus defensas: es una propiedad de tus defensas
 * RELATIVA a lo que el atacante puede hacer con su tiempo. Contra alguien sin alternativas, la
 * inversión compra otra cosa (que le cueste más lograrlo), no que se vaya.
 *
 * ## Dos motivos distintos para no atacar, y conviene no confundirlos
 *
 * Al construir esto apareció un caso que rompía la afirmación fácil ("al insider no lo disuade
 * nada"): con un activo chico y un costo de intento alto, hasta un atacante SIN alternativa deja
 * de atacar. Pero eso no es disuasión. Son dos fenómenos:
 *
 *  - `alternativa`  — se va porque le conviene más otro objetivo. Disuasión de verdad. Necesita
 *    que su alternativa valga algo: si vale 0, no hay "otro lado" al que irse.
 *  - `no-rentable`  — no se va a ningún lado; simplemente el botín no cubre el esfuerzo.
 *
 * La diferencia importa para decidir, no solo para nombrar. Un oportunista disuadido se fue y no
 * vuelve mientras el vecino siga siendo más barato. Un insider que desistió sigue adentro: en
 * cuanto suba el valor del activo o se afloje un control, vuelve a rentarle. Por eso el resultado
 * dice CUÁL de los dos es, y por eso la afirmación defendible sobre el empleado desleal es la
 * precisa: **a alternativa cero, nunca se lo disuade — a lo sumo desiste.** Eso sí es invariante
 * del modelo y está en las pruebas, junto con la monotonía del umbral respecto de la alternativa.
 *
 * ## Lo que este módulo NO es
 *
 * No está validado. Los pagos del atacante —cuánto le vale el botín, cuánto le cuesta el
 * operativo, qué consigue en otro lado— no se observan en ninguna bitácora: nunca vas a registrar
 * al ladrón que miró la reja y se fue. Por eso todos esos parámetros son ENTRADAS explícitas y
 * editables, nunca constantes escondidas: si quedaran enterradas, esto sería una máquina de
 * justificar cualquier inversión moviendo un supuesto que nadie ve.
 *
 * Análisis exploratorio. No alimenta ninguna cifra del Registro (mismo deslinde que Nash).
 */

/** Mismo rango de esfuerzo 0-100 que nashEquilibrium.js — ver la nota de MAX_EFFORT ahí. */
const MAX_EFFORT = 100;
const TERNARY_TOLERANCE = 0.01;
const TERNARY_MAX_ITERATIONS = 200;
const BISECTION_MAX_ITERATIONS = 60;
const BISECTION_TOLERANCE = 0.001;

/**
 * Cuánto vale, para cada perfil, lo que el atacante consigue EN OTRO LADO — expresado como
 * fracción del Valor en Juego de este activo, porque un atacante compara objetivos comparables.
 *
 * ESTO ES JUICIO DECLARADO, NO MEDICIÓN. Son el punto de partida editable de la pantalla, y el
 * razonamiento de cada uno importa más que el número:
 *
 *  - `oportunista`: casi todo su valor está en otro lado. Hay mil objetivos igual de fáciles y
 *    elige el más barato; la reja lo manda al vecino sin que lo piense.
 *  - `vandalismo`: parecido, algo menos móvil (suele actuar cerca de donde está).
 *  - `organizado`: te eligió A VOS, por tu carga y tu ruta. Cambiar de objetivo le cuesta
 *    inteligencia, contactos y tiempo, así que su alternativa es chica pero no nula.
 *  - `estado-nacion`: te eligió por lo que sos. Prácticamente no hay sustituto.
 *  - `empleado-desleal`: CERO, y no es un número prudente sino una definición. Ya está adentro y
 *    no puede "ir a robarle al vecino" — su acceso es a ESTE activo. Con alternativa cero nunca
 *    aparece como disuadido: a lo sumo desiste porque el botín dejó de cubrirle el esfuerzo, que
 *    es un estado mucho más frágil (ver la nota de los dos motivos, arriba).
 */
const DEFAULT_OUTSIDE_OPTION_FRACTION = {
    oportunista: 0.5,
    vandalismo: 0.4,
    organizado: 0.15,
    'estado-nacion': 0.05,
    'empleado-desleal': 0,
};

/** Ganancia neta del atacante: botín esperado menos el costo de su propio esfuerzo. */
function attackerPayoff(a, d, m, valueAtStake, costAttacker) {
    return tullockSuccessProbability(a, d, m) * valueAtStake - costAttacker * a;
}

function ternarySearchMax(f, lo, hi) {
    for (let i = 0; i < TERNARY_MAX_ITERATIONS && hi - lo > TERNARY_TOLERANCE; i++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (f(m1) < f(m2)) lo = m1;
        else hi = m2;
    }
    return (lo + hi) / 2;
}

/**
 * La mejor respuesta del atacante a una defensa YA COMPROMETIDA y visible. Es el paso que
 * distingue Stackelberg de Nash: acá `d` no es una conjetura simultánea, es un hecho que el
 * atacante observa antes de mover.
 *
 * @returns {{effort:number, payoff:number}} El esfuerzo óptimo y lo que gana con él.
 */
function attackerBestResponse(d, m, valueAtStake, costAttacker) {
    const effort = ternarySearchMax((x) => attackerPayoff(x, d, m, valueAtStake, costAttacker), 0, MAX_EFFORT);
    // No invertir esfuerzo siempre está disponible y da exactamente 0, así que la mejor respuesta
    // nunca puede valer menos que eso. Sin este piso, un óptimo interior mal encontrado podría
    // devolver una ganancia negativa y hacer parecer disuadido a quien no lo está.
    const payoff = Math.max(0, attackerPayoff(effort, d, m, valueAtStake, costAttacker));
    return { effort: payoff > 0 ? effort : 0, payoff };
}

/**
 * ¿Se va el atacante ante esta defensa? Ataca solo si lo mejor que puede sacar acá supera lo que
 * consigue en otro lado.
 */
function isDeterred(d, { m, valueAtStake, costAttacker, outsideOption }) {
    return attackerBestResponse(d, m, valueAtStake, costAttacker).payoff <= outsideOption;
}

/**
 * EL UMBRAL DE DISUASIÓN: el esfuerzo de defensa más chico que hace que atacarte deje de
 * convenirle. Es el número que el modelo actual no puede dar — un punto de corte, no una
 * pendiente.
 *
 * Se resuelve por bisección y no por muestreo: la ganancia del atacante decrece de forma monótona
 * con la defensa (más defensa, menos probabilidad de éxito, mismo costo), así que "el primer `d`
 * que alcanza" está bien definido y se encuentra exacto. Sortear pares al azar buscando el punto
 * no funciona: es un punto en un continuo, tiene probabilidad cero de salir sorteado.
 *
 * @returns {{threshold:number|null, reachable:boolean, payoffAtMax:number, reason:string|null}}
 *   `threshold` es null cuando ni la defensa máxima alcanza — que es la respuesta correcta y no un
 *   error: a ese atacante no se lo saca con inversión, hay que contenerlo. `reason` distingue por
 *   qué dejó de atacar: 'alternativa' (se fue a otro objetivo: disuasión real) o 'no-rentable'
 *   (no se fue a ningún lado, el botín dejó de cubrir el esfuerzo). Ver la nota del encabezado.
 */
function deterrenceThreshold({ m, valueAtStake, costAttacker, outsideOption }) {
    const payoffAtMax = attackerBestResponse(MAX_EFFORT, m, valueAtStake, costAttacker).payoff;
    if (payoffAtMax > outsideOption) {
        return { threshold: null, reachable: false, payoffAtMax, reason: null };
    }

    // Motivo de la salida, evaluado en la defensa máxima (donde ya sabemos que no ataca): si su
    // mejor ganancia posible ahí es exactamente 0, no hay nada que "preferir en otro lado" — el
    // ataque dejó de rentar. Si es positiva pero no supera su alternativa, entonces sí se fue.
    const reason = payoffAtMax > 0 ? 'alternativa' : 'no-rentable';

    // Con outsideOption >= la ganancia sin ninguna defensa, ya está fuera en cero.
    if (isDeterred(0, { m, valueAtStake, costAttacker, outsideOption })) {
        return { threshold: 0, reachable: true, payoffAtMax, reason };
    }

    let lo = 0; // ataca
    let hi = MAX_EFFORT; // no ataca
    for (let i = 0; i < BISECTION_MAX_ITERATIONS && hi - lo > BISECTION_TOLERANCE; i++) {
        const mid = (lo + hi) / 2;
        if (isDeterred(mid, { m, valueAtStake, costAttacker, outsideOption })) hi = mid;
        else lo = mid;
    }
    return { threshold: hi, reachable: true, payoffAtMax, reason };
}

/**
 * MONTE CARLO ALREDEDOR DEL SOLVER, no en lugar del solver.
 *
 * El umbral no se busca sorteando: se resuelve (ver deterrenceThreshold). Lo que sí es incierto
 * son los PAGOS — cuánto vale el botín, cuánto cuesta el operativo, cuánto consigue en otro lado.
 * Así que cada iteración sortea un mundo posible, RESUELVE el umbral exacto de ese mundo, y se
 * repite. Lo que sale no es un umbral: es una distribución de umbrales.
 *
 * Eso responde la pregunta que de verdad se lleva a un comité — "¿con cuánto estamos tranquilos?"
 * — con un porcentaje de escenarios en vez de un número único que se desarma si movés un supuesto.
 *
 * @param {Object} params
 * @param {number} params.m Decisividad de Tullock.
 * @param {{min:number,mode:number,max:number}} params.valueAtStake Rango del botín.
 * @param {{min:number,mode:number,max:number}} params.costAttacker Rango del costo por unidad de
 *   esfuerzo del atacante.
 * @param {{min:number,mode:number,max:number}} params.outsideOptionFraction Rango de la
 *   alternativa del atacante, como fracción del botín.
 * @param {number} [params.iterations=10000]
 * @param {number} [params.seed=0] 0 = elegir una al azar (se devuelve, para poder repetir).
 * @returns {Object} Distribución de umbrales + la curva "probabilidad de disuadir" por nivel de
 *   defensa, que es la salida que de verdad se muestra.
 */
function simulateDeterrence({ m, valueAtStake, costAttacker, outsideOptionFraction, iterations = 10000, seed = 0 }) {
    const usedSeed = seed && seed > 0 ? seed : Math.floor(Math.random() * 2147483647);
    const rng = mulberry32(usedSeed);

    const thresholds = [];
    let noDeterrable = 0;
    let alreadyDeterred = 0;
    // Se cuenta APARTE por qué deja de atacar en cada mundo sorteado: irse a otro objetivo y
    // dejar de rentarle son cosas distintas y sostienen decisiones distintas (ver el encabezado).
    let porAlternativa = 0;
    let porNoRentable = 0;

    for (let i = 0; i < iterations; i++) {
        const v = getPertRandom(valueAtStake.min, valueAtStake.mode, valueAtStake.max, 4, rng);
        const c = getPertRandom(costAttacker.min, costAttacker.mode, costAttacker.max, 4, rng);
        const f = getPertRandom(
            outsideOptionFraction.min,
            outsideOptionFraction.mode,
            outsideOptionFraction.max,
            4,
            rng,
        );
        const { threshold, reason } = deterrenceThreshold({
            m,
            valueAtStake: v,
            costAttacker: c,
            outsideOption: f * v,
        });
        if (threshold === null) {
            noDeterrable += 1;
            continue;
        }
        if (threshold === 0) alreadyDeterred += 1;
        if (reason === 'alternativa') porAlternativa += 1;
        else porNoRentable += 1;
        thresholds.push(threshold);
    }

    // La curva que se muestra: para cada nivel de defensa, en qué porcentaje de los mundos
    // sorteados el atacante ya se fue. Los mundos donde NO se lo puede disuadir cuentan como no
    // disuadidos en todos los niveles — omitirlos inflaría la curva justo donde importa.
    const deterrenceCurve = [];
    for (let d = 0; d <= MAX_EFFORT; d += 5) {
        const disuadidos = thresholds.filter((t) => t <= d).length;
        deterrenceCurve.push({ defenseEffort: d, deterredPercent: (100 * disuadidos) / iterations });
    }

    const ordenados = [...thresholds].sort((a, b) => a - b);
    const cuantil = (p) =>
        ordenados.length === 0 ? null : ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))];

    return {
        usedSeed,
        iterations,
        // Porcentaje de mundos donde ninguna defensa alcanza. No es un fallo del cálculo: es la
        // respuesta, y es la que importa para el insider.
        neverDeterredPercent: (100 * noDeterrable) / iterations,
        alreadyDeterredPercent: (100 * alreadyDeterred) / iterations,
        // De los mundos donde sí deja de atacar, en cuántos se FUE (disuasión real) y en cuántos
        // solo dejó de rentarle. Un atacante que desistió sigue ahí: vuelve si sube el valor.
        byAlternativePercent: (100 * porAlternativa) / iterations,
        byUnprofitablePercent: (100 * porNoRentable) / iterations,
        thresholdP10: cuantil(0.1),
        thresholdMedian: cuantil(0.5),
        thresholdP90: cuantil(0.9),
        deterrenceCurve,
    };
}

module.exports = {
    MAX_EFFORT,
    DEFAULT_OUTSIDE_OPTION_FRACTION,
    attackerPayoff,
    attackerBestResponse,
    isDeterred,
    deterrenceThreshold,
    simulateDeterrence,
};
