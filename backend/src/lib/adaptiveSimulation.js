'use strict';

const { runMonteCarloSimulation, summarizeLosses } = require('./simulation');

/**
 * CUÁNTAS ITERACIONES HACEN FALTA — decidido midiendo, no por un tope fijo.
 *
 * ## Por qué 10.000 fijo está mal en las dos direcciones
 *
 * Medido con 40 semillas por perfil, a 10.000 iteraciones:
 *
 *   raro-severo  LEF 0,05   error del CVaR 4,91 %   harían falta 60.314 para ±2 %
 *   medio        LEF 0,6    error del CVaR 1,54 %   harían falta  5.893
 *   frecuente    LEF 8      error del CVaR 0,72 %   harían falta  1.294
 *
 * Un factor de 47 entre extremos. El mismo tope desperdicia 8× de cómputo en un riesgo frecuente y
 * se queda 6 veces corto en uno raro-severo — que son justo los que dominan la cola del portafolio
 * y el reparto de Euler (§8.5).
 *
 * ## La causa: la muestra útil no es `n`
 *
 * Con el modelo compuesto, un año sin eventos vale 0 exacto y **no aporta información**. La muestra
 * que de verdad sostiene las cifras es
 *
 *     n_efectivo = n · (1 − e^−LEF)
 *
 * Con LEF 0,05 y 10.000 iteraciones son ~488 años útiles, y de ahí sale el 5 % de error. De ahí sale
 * también el primer tamaño de lote de este módulo: en vez de arrancar con un número redondo, se
 * despeja `n` para llegar a una cantidad objetivo de años ÚTILES.
 *
 * ## Qué se optimiza, y qué no
 *
 * Se apunta al error del **CVaR**, no al del ALE: es el que alimenta los Criterios de Riesgo (§13.2)
 * y el reparto del portafolio. El del ALE viene de arrastre y siempre sale mejor o parecido.
 *
 * No se persigue precisión infinita a propósito. El error de muestreo **no es el error dominante**
 * de esta app: si el TEF es juicio experto con ±50 % de incertidumbre, el ALE hereda ±50 % y
 * ninguna cantidad de iteraciones lo toca (§2.4). Bajar de ~1 % sería quemar cómputo en un decimal
 * que la entrada no sostiene.
 *
 * ## Reproducibilidad
 *
 * Cada lote corre con una semilla derivada de la original, así que **la misma semilla da el mismo
 * resultado y el mismo `n`**. Verificado contra una corrida larga equivalente: 4 lotes de 10.000
 * dan el mismo ALE y CVaR que una corrida de 40.000 dentro del error de muestreo. Pero `n` deja de
 * conocerse de antemano, así que el resultado SIEMPRE viaja con `usedIterations`: sin eso, una
 * cifra guardada no se puede volver a producir.
 */

/**
 * Años con al menos un evento a los que se apunta en el primer lote. Sale de la medición: con ~2.000
 * años útiles el error del CVaR cae cerca del 2 % en los tres perfiles probados. Es un punto de
 * partida, no el criterio de parada — el bucle corrige después con el error medido de verdad.
 */
const TARGET_USEFUL_YEARS = 2000;

/** Piso del primer lote. Por debajo, el estimador del error del CVaR no tiene con qué (necesita 40
 *  escenarios por cada uno de sus 20 lotes) y la sensibilidad queda pobre. */
const MIN_BATCH = 5000;

/** Techo duro. No es estadístico: el motor sortea una magnitud por evento y corre síncrono, así que
 *  sin límite un riesgo pesado bloquea el event loop. Ver también el presupuesto de tiempo. */
const MAX_ADAPTIVE_ITERATIONS = 200000;

/** Objetivo por defecto para el error del CVaR, en %. Ver "qué se optimiza" arriba. */
const DEFAULT_TARGET_CVAR_ERROR_PERCENT = 2;

/**
 * Presupuesto de tiempo. Es la restricción REAL, más que el techo de iteraciones: medido, 200.000
 * iteraciones van de 0,8 s (riesgo raro, barato por iteración) a 3,8 s (riesgo frecuente con las 9
 * categorías de pérdida). Node corre esto en un solo hilo, así que 3,8 s son 3,8 s sin atender a
 * nadie más.
 *
 * Y hay una coincidencia afortunada que hace que esto funcione: los riesgos que necesitan MÁS
 * iteraciones son los BARATOS por iteración (el raro-severo casi no sortea magnitudes, porque casi
 * ningún año trae eventos). Los caros son los frecuentes, que necesitan pocas.
 */
const DEFAULT_TIME_BUDGET_MS = 1200;

/** Cuánto puede crecer el total en un solo paso. Evita que una estimación ruidosa del error pegue
 *  un salto de 50× y se coma el presupuesto entero de una. */
const MAX_GROWTH_FACTOR = 4;

/**
 * Semilla del lote `i`. Se mezcla con la proporción áurea en vez de usar `seed + i`: las dos dan
 * resultados equivalentes medidos contra una corrida larga (difieren 0,06 % y 0,39 % en el ALE,
 * dentro del ~0,7 % de error de muestreo a ese tamaño), pero mezclar evita tener que discutir si
 * dos semillas contiguas producen flujos correlacionados.
 */
function batchSeed(seed, i) {
    return (seed + i * 0x9e3779b9) >>> 0 || 1;
}

/**
 * Primer tamaño de lote, despejado de `n_efectivo = n · (1 − e^−LEF)`. Sin LEF utilizable cae al
 * piso, que es el comportamiento correcto: no se inventa una estimación, se arranca chico y el
 * bucle mide.
 */
function firstBatchSize(tef, vuln) {
    const lef = (tef && tef.mode) * ((vuln && vuln.mode) / 100);
    if (!Number.isFinite(lef) || lef <= 0) return MIN_BATCH;
    const fraccionUtil = 1 - Math.exp(-lef);
    if (fraccionUtil <= 0) return MIN_BATCH;
    const n = Math.ceil(TARGET_USEFUL_YEARS / fraccionUtil);
    return Math.min(MAX_ADAPTIVE_ITERATIONS, Math.max(MIN_BATCH, n));
}

/**
 * Corre Monte Carlo hasta alcanzar una precisión objetivo del CVaR, o hasta agotar el presupuesto
 * de tiempo o el techo de iteraciones — lo que pase primero.
 *
 * @param {Object} params Los mismos que runMonteCarloSimulation, más:
 * @param {number} [params.targetCvarErrorPercent=2] Error relativo del CVaR al que se apunta.
 * @param {number} [params.timeBudgetMs=1200]
 * @param {number} [params.maxIterations=200000]
 * @param {number} [params.exceedanceThreshold] Solo para medir; el resumen final lo calcula quien llama.
 * @param {() => number} [params.now] Reloj inyectable, para poder probar el corte por tiempo.
 * @returns {{annualLosses:number[], usedSeed:number, usedIterations:number, sensitivity:Array,
 *   eventCounts:number[]|null, frequencyModel:string, batches:number,
 *   achievedCvarErrorPercent:number|null, targetCvarErrorPercent:number,
 *   stoppedBy:'objetivo'|'tiempo'|'techo'}}
 */
function runAdaptiveSimulation({
    seed,
    tef,
    vuln,
    lossMagnitudes,
    sampleVuln,
    magnitudeCap,
    frequencyModel,
    targetCvarErrorPercent = DEFAULT_TARGET_CVAR_ERROR_PERCENT,
    timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
    maxIterations = MAX_ADAPTIVE_ITERATIONS,
    now = Date.now,
}) {
    const arranque = now();
    const techo = Math.min(maxIterations, MAX_ADAPTIVE_ITERATIONS);

    let annualLosses = [];
    let eventCounts = null;
    let sensitivity = null;
    let usedSeed = null;
    let usedFrequencyModel = null;
    let batches = 0;
    let siguiente = Math.min(techo, firstBatchSize(tef, vuln));
    let stoppedBy = 'objetivo';
    let achieved = null;

    for (;;) {
        const lote = runMonteCarloSimulation({
            iterations: siguiente,
            // El primer lote usa la semilla tal cual: así, cuando alcanza de una (el caso normal),
            // el resultado es idéntico bit a bit al de una corrida fija de ese tamaño.
            //
            // Los siguientes derivan de `usedSeed`, no del `seed` que llegó por parámetro. La
            // diferencia importa cuando llega 0 ("elegí una al azar"): ahí el primer lote sortea
            // una semilla real, y derivar del 0 original dejaría los lotes 2..n desligados de ella
            // — el resultado no se podría reproducir ni conociendo `usedSeed`, que es justo lo que
            // se devuelve para poder reproducirlo.
            seed: batches === 0 ? seed : batchSeed(usedSeed, batches),
            tef,
            vuln,
            lossMagnitudes,
            sampleVuln,
            magnitudeCap,
            frequencyModel,
        });
        if (batches === 0) {
            usedSeed = lote.usedSeed;
            usedFrequencyModel = lote.frequencyModel;
            // La sensibilidad sale del PRIMER lote y no del total. Es una correlación de rangos
            // usada para ORDENAR los impulsores, y con >= MIN_BATCH puntos ya es estable: no
            // necesita la precisión que sí necesita la cola. Además, en el caso normal el primer
            // lote es el único, así que cubre todo de todos modos.
            sensitivity = lote.sensitivity;
        }
        annualLosses = annualLosses.concat(lote.annualLosses);
        if (lote.eventCounts) eventCounts = (eventCounts || []).concat(lote.eventCounts);
        batches += 1;

        const resumen = summarizeLosses(annualLosses);
        achieved = resumen.cvar95StandardErrorPercent;

        if (achieved !== null && achieved <= targetCvarErrorPercent) {
            stoppedBy = 'objetivo';
            break;
        }
        if (annualLosses.length >= techo) {
            stoppedBy = 'techo';
            break;
        }
        if (now() - arranque >= timeBudgetMs) {
            stoppedBy = 'tiempo';
            break;
        }

        // Cuánto haría falta en total: el error cae como 1/√n, así que n_objetivo = n·(err/meta)².
        // Sin estimación del error (muestra insuficiente) se duplica, que es la respuesta prudente.
        const n = annualLosses.length;
        const proyectado = achieved === null ? n * 2 : Math.ceil(n * Math.pow(achieved / targetCvarErrorPercent, 2));
        const total = Math.min(techo, Math.max(n + MIN_BATCH, Math.min(proyectado, n * MAX_GROWTH_FACTOR)));
        siguiente = total - n;
        if (siguiente <= 0) {
            stoppedBy = 'techo';
            break;
        }
    }

    return {
        annualLosses,
        usedSeed,
        usedIterations: annualLosses.length,
        sensitivity: sensitivity || [],
        eventCounts,
        frequencyModel: usedFrequencyModel,
        batches,
        achievedCvarErrorPercent: achieved,
        targetCvarErrorPercent,
        stoppedBy,
    };
}

module.exports = {
    TARGET_USEFUL_YEARS,
    MIN_BATCH,
    MAX_ADAPTIVE_ITERATIONS,
    DEFAULT_TARGET_CVAR_ERROR_PERCENT,
    DEFAULT_TIME_BUDGET_MS,
    batchSeed,
    firstBatchSize,
    runAdaptiveSimulation,
};
