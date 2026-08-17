#!/usr/bin/env node
'use strict';

/**
 * ANÁLISIS DE SENSIBILIDAD DE LAS ANCLAS
 *
 * Toda la calibración de Vulnerabilidad de AppFair descansa en ocho juicios de un experto (ver
 * §6 de docs/modelo-de-riesgo.md). Nadie había medido qué pasa si ese experto se equivocó.
 *
 * Esta herramienta responde eso: perturba cada ancla ±3, ±5 y ±8 puntos, RE-DERIVA el parámetro
 * que esa ancla determina, y mide cuánto se mueve la grilla completa de 5×4 combinaciones.
 *
 * Es diagnóstico: no escribe nada, no toca la app, no se integra a la suite. Corre offline.
 *
 *     node tools/anchor-sensitivity/analizar.js [--iteraciones 20000] [--json]
 *
 * ---------------------------------------------------------------------------------------------
 * CÓMO SE DERIVA CADA PARÁMETRO (y por qué el análisis tiene que respetarlo)
 *
 * Las anclas 3 y 4 comparten atacante (organizado) contra dos defensas distintas, así que el eje
 * de contienda se cancela entre ellas y solo sobrevive `m`: son las que lo IDENTIFICAN. Con `m`
 * fijo, cada ancla restante despeja su propio nodo del eje.
 *
 *     ancla 1 (oportunista vs básica)      → nodo FA=18
 *     ancla 2 (vandalismo vs básica)       → nodo FA=43
 *     anclas 3 y 4 (organizado)            → m  +  nodo FA=60
 *     ancla 5 (empleado desleal vs avanz.) → nodo FA=54,2  (con acceso MEDIO, ver abajo)
 *     ancla 6 (estado-nación vs élite)     → nodo FA=90
 *
 * TODO se ajusta contra la MEDIA SIMULADA, nunca contra la fórmula central. Es la advertencia más
 * importante del documento: con una función convexa la media de la simulación no coincide con la
 * función de la media, y ajustar sobre la fórmula desplaza los resultados varios puntos. Por eso
 * aquí no hay álgebra: hay bisección sobre corridas Monte Carlo reales.
 *
 * Todas las corridas usan la MISMA semilla (números aleatorios comunes). Sin eso, la diferencia
 * entre dos calibraciones se confundiría con el ruido de muestreo y el análisis no mediría nada.
 */

const { mulberry32 } = require('../../backend/src/lib/random');
const {
    sampleVulnerabilityFromProfiles,
    calculateProfileAverage,
    ATTACKER_CONTEST_CALIBRATION,
    TULLOCK_M,
} = require('../../backend/src/lib/autocalc');
const { attackerProfiles, defenseProfiles } = require('../../backend/src/data/profiles');

// Las anclas se emitieron todas con confianza media (§6). A confianza media la corrección por
// confianza vale 1 exacto, así que no interfiere con la re-derivación.
const CONFIANZA = 'medio';
// Nivel de Acceso de referencia para la GRILLA que se compara (nunca para las anclas, que traen el
// suyo). Es el default de la app, así que la grilla que se mide es la que el analista ve al elegir
// dos perfiles sin tocar nada más.
const ACCESO_GRILLA = 'nulo';
const SEMILLA = 0x5eed;

// `acceso` es el del ancla: cinco se emitieron con acceso nulo, la del empleado desleal con acceso
// medio (un insider sin ningún acceso es una contradicción de términos — ver el bloque de
// calibración en autocalc.js).
const ANCLAS = [
    { n: 1, atacante: 'oportunista', defensa: 'basica', acceso: 'nulo', valor: 5, determina: 'nodo18' },
    { n: 2, atacante: 'vandalismo', defensa: 'basica', acceso: 'nulo', valor: 35, determina: 'nodo43' },
    { n: 3, atacante: 'organizado', defensa: 'estandar', acceso: 'nulo', valor: 60, determina: 'm+nodo60' },
    { n: 4, atacante: 'organizado', defensa: 'elite', acceso: 'nulo', valor: 15, determina: 'm+nodo60' },
    { n: 5, atacante: 'empleado-desleal', defensa: 'avanzada', acceso: 'medio', valor: 30, determina: 'nodo54' },
    { n: 6, atacante: 'estado-nacion', defensa: 'elite', acceso: 'nulo', valor: 45, determina: 'nodo90' },
];

const DELTAS = [-8, -5, -3, 3, 5, 8];

// Una perturbación que empuja el ancla fuera del rango ALCANZABLE del modelo no se puede
// re-derivar: la bisección satura y devuelve un número que parece una medición y no lo es. El piso
// de Vulnerabilidad es 0,5 % y el techo práctico ronda 99,8 %, así que "oportunista vs básica al
// 5 % menos 8 puntos" pide un −3 % imposible. Esas filas se marcan, no se inventan.
const V_MIN_ALCANZABLE = 0.6;
const V_MAX_ALCANZABLE = 99.4;

/** Media simulada de Vulnerabilidad (%) de una celda, con una calibración dada. */
function mediaCelda(atacanteKey, defensaKey, calib, iteraciones, acceso = ACCESO_GRILLA) {
    const draw = sampleVulnerabilityFromProfiles(
        attackerProfiles[atacanteKey],
        defenseProfiles[defensaKey],
        CONFIANZA,
        acceso,
        calib,
    );
    const rng = mulberry32(SEMILLA);
    let suma = 0;
    for (let i = 0; i < iteraciones; i++) suma += draw(rng);
    return (suma / iteraciones) * 100;
}

/** Copia de los nodos del eje con UNO de ellos movido. */
function conNodo(nodes, profileScore, contestStrength) {
    return nodes.map((nd) => (nd.profileScore === profileScore ? { ...nd, contestStrength } : nd));
}

/**
 * Bisección sobre el valor de un nodo del eje hasta que la media simulada de su ancla dé en el
 * blanco. El eje es monótono creciente en la fuerza del atacante, así que más nodo = más
 * Vulnerabilidad y la bisección converge siempre.
 */
function resolverNodo(ancla, objetivo, calibBase, profileScore, iteraciones) {
    let lo = 0.01;
    let hi = 400;
    for (let i = 0; i < 34; i++) {
        const mid = (lo + hi) / 2;
        const calib = { ...calibBase, contestNodes: conNodo(calibBase.contestNodes, profileScore, mid) };
        if (mediaCelda(ancla.atacante, ancla.defensa, calib, iteraciones, ancla.acceso) < objetivo) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Re-deriva `m` junto con el nodo FA=60. Anidado, no 2-D: para cada `m` candidato se despeja el
 * nodo que hace acertar el ancla 3, y se mira el residuo que queda en el ancla 4. Ese residuo es
 * monótono en `m` (subir `m` agudiza la contienda y castiga más a la defensa élite del ancla 4),
 * así que basta una bisección exterior.
 */
function resolverMyNodo60(v3, v4, iteraciones) {
    const a3 = ANCLAS[2];
    const a4 = ANCLAS[3];
    const residuo = (m) => {
        const base = { m, contestNodes: ATTACKER_CONTEST_CALIBRATION };
        const nodo60 = resolverNodo(a3, v3, base, 60, iteraciones);
        const calib = { m, contestNodes: conNodo(ATTACKER_CONTEST_CALIBRATION, 60, nodo60) };
        return { r: mediaCelda(a4.atacante, a4.defensa, calib, iteraciones, a4.acceso) - v4, nodo60 };
    };

    let lo = 1.5;
    let hi = 20;
    let mejor = residuo(TULLOCK_M);
    for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        const res = residuo(mid);
        mejor = res;
        // Más `m` ⇒ el ancla 4 (defensa élite) baja: residuo decreciente en m.
        if (res.r > 0) lo = mid;
        else hi = mid;
    }
    const m = (lo + hi) / 2;
    return { m, nodo60: mejor.nodo60 };
}

/** La grilla completa 5×4 con una calibración dada. */
function grilla(calib, iteraciones) {
    const salida = {};
    for (const a of Object.keys(attackerProfiles)) {
        salida[a] = {};
        for (const d of Object.keys(defenseProfiles)) {
            salida[a][d] = mediaCelda(a, d, calib, iteraciones);
        }
    }
    return salida;
}

function compararGrillas(base, otra) {
    let maxAbs = 0;
    let celdaMax = null;
    let suma2 = 0;
    let n = 0;
    for (const a of Object.keys(base)) {
        for (const d of Object.keys(base[a])) {
            const dif = otra[a][d] - base[a][d];
            suma2 += dif * dif;
            n++;
            if (Math.abs(dif) > Math.abs(maxAbs)) {
                maxAbs = dif;
                celdaMax = `${a} vs ${d}`;
            }
        }
    }
    return { maxAbs, celdaMax, rmse: Math.sqrt(suma2 / n) };
}

/** Re-deriva la calibración completa con UNA ancla perturbada. */
function recalibrarCon(ancla, delta, iteraciones) {
    const objetivo = ancla.valor + delta;

    if (ancla.determina === 'm+nodo60') {
        const v3 = ancla.n === 3 ? objetivo : ANCLAS[2].valor;
        const v4 = ancla.n === 4 ? objetivo : ANCLAS[3].valor;
        const { m, nodo60 } = resolverMyNodo60(v3, v4, iteraciones);
        return { m, contestNodes: conNodo(ATTACKER_CONTEST_CALIBRATION, 60, nodo60) };
    }

    const profileScore = { nodo18: 18, nodo43: 43, nodo54: 54.2, nodo60: 60, nodo90: 90 }[ancla.determina];
    const base = { m: TULLOCK_M, contestNodes: ATTACKER_CONTEST_CALIBRATION };
    const nodo = resolverNodo(ancla, objetivo, base, profileScore, iteraciones);
    return { m: TULLOCK_M, contestNodes: conNodo(ATTACKER_CONTEST_CALIBRATION, profileScore, nodo) };
}

function main() {
    const args = process.argv.slice(2);
    const iteraciones = Number(args[args.indexOf('--iteraciones') + 1]) || 20000;
    const comoJson = args.includes('--json');

    const calibActual = { m: TULLOCK_M, contestNodes: ATTACKER_CONTEST_CALIBRATION };
    const base = grilla(calibActual, iteraciones);

    if (!comoJson) {
        console.log(`\nANÁLISIS DE SENSIBILIDAD DE LAS ANCLAS — ${iteraciones.toLocaleString('es-MX')} iteraciones\n`);
        console.log(`Calibración vigente: m = ${TULLOCK_M}`);
        console.log(
            `Nodos del eje: ${ATTACKER_CONTEST_CALIBRATION.map((n) => `${n.profileScore}→${n.contestStrength}`).join('  ')}\n`,
        );
        console.log('Si el experto se hubiera equivocado en un ancla, ¿cuánto se mueve la grilla?\n');
        console.log('ancla                         Δ    m re-derivado   máx. cambio   RMSE   celda más movida');
        console.log('─'.repeat(100));
    }

    // Autoconsistencia: sin perturbar nada, el método tiene que RECUPERAR la calibración vigente.
    // Si no la recupera, todo lo de abajo mide el error del método y no la sensibilidad del modelo.
    const control = resolverMyNodo60(ANCLAS[2].valor, ANCLAS[3].valor, iteraciones);
    const errM = Math.abs(control.m / TULLOCK_M - 1) * 100;
    const errNodo = Math.abs(control.nodo60 / 56.911 - 1) * 100;
    // El nodo 54,2 (empleado desleal) se despeja de su propia ancla, así que entra al control por
    // separado: no lo tocan ni `m` ni el nodo 60.
    const nodo54 = resolverNodo(
        ANCLAS[4],
        ANCLAS[4].valor,
        { m: TULLOCK_M, contestNodes: ATTACKER_CONTEST_CALIBRATION },
        54.2,
        iteraciones,
    );
    const errNodo54 = Math.abs(nodo54 / 40.911 - 1) * 100;
    if (!comoJson) {
        console.log(
            `Control de autoconsistencia — sin perturbar: m = ${control.m.toFixed(4)} (${errM.toFixed(1)} % de ` +
                `desviación), nodo 60 = ${control.nodo60.toFixed(3)} (${errNodo.toFixed(1)} %), ` +
                `nodo 54,2 = ${nodo54.toFixed(3)} (${errNodo54.toFixed(1)} %)\n`,
        );
        if (errM > 5 || errNodo > 5 || errNodo54 > 5) {
            console.log('  ⚠ El método NO recupera la calibración vigente. Lo de abajo no es fiable.\n');
        }
    }

    const resultados = [];
    for (const ancla of ANCLAS) {
        for (const delta of DELTAS) {
            const objetivo = ancla.valor + delta;
            if (objetivo < V_MIN_ALCANZABLE || objetivo > V_MAX_ALCANZABLE) {
                if (!comoJson) {
                    const etiqueta = `${ancla.n}. ${ancla.atacante} vs ${ancla.defensa} (${ancla.valor}%)`;
                    console.log(
                        etiqueta.padEnd(30) +
                            String(delta > 0 ? `+${delta}` : delta).padStart(4) +
                            '   — fuera del rango alcanzable del modelo (pediría ' +
                            objetivo +
                            ' %)',
                    );
                }
                continue;
            }
            const calib = recalibrarCon(ancla, delta, iteraciones);
            const cmp = compararGrillas(base, grilla(calib, iteraciones));
            const fila = {
                ancla: ancla.n,
                descripcion: `${ancla.atacante} vs ${ancla.defensa}`,
                valorOriginal: ancla.valor,
                delta,
                m: calib.m,
                maxAbs: cmp.maxAbs,
                rmse: cmp.rmse,
                celdaMax: cmp.celdaMax,
            };
            resultados.push(fila);
            if (!comoJson) {
                const etiqueta = `${ancla.n}. ${ancla.atacante} vs ${ancla.defensa} (${ancla.valor}%)`;
                console.log(
                    etiqueta.padEnd(30) +
                        String(delta > 0 ? `+${delta}` : delta).padStart(4) +
                        calib.m.toFixed(4).padStart(15) +
                        `${cmp.maxAbs >= 0 ? '+' : ''}${cmp.maxAbs.toFixed(2)} pp`.padStart(14) +
                        cmp.rmse.toFixed(2).padStart(8) +
                        '   ' +
                        cmp.celdaMax,
                );
            }
        }
        if (!comoJson) console.log('─'.repeat(100));
    }

    if (comoJson) {
        console.log(JSON.stringify({ iteraciones, m: TULLOCK_M, base, resultados }, null, 2));
        return;
    }

    // Ranking de criticidad: qué ancla mueve más el modelo por punto de error del experto.
    const porAncla = ANCLAS.map((a) => {
        const suyos = resultados.filter((r) => r.ancla === a.n);
        if (suyos.length === 0) return { ancla: a, sensibilidad: 0, peor: 0 };
        const porPunto = suyos.map((r) => Math.abs(r.maxAbs) / Math.abs(r.delta));
        return {
            ancla: a,
            sensibilidad: porPunto.reduce((x, y) => x + y, 0) / porPunto.length,
            peor: Math.max(...suyos.map((r) => Math.abs(r.maxAbs))),
        };
    }).sort((x, y) => y.sensibilidad - x.sensibilidad);

    console.log('\nRANKING DE CRITICIDAD — cuánto mueve la grilla cada punto de error del experto\n');
    console.log('ancla                              pp de grilla por punto de ancla    peor caso (±8)');
    console.log('─'.repeat(90));
    porAncla.forEach((p) => {
        console.log(
            `${p.ancla.n}. ${p.ancla.atacante} vs ${p.ancla.defensa}`.padEnd(38) +
                p.sensibilidad.toFixed(2).padStart(20) +
                `${p.peor.toFixed(1)} pp`.padStart(22),
        );
    });
    console.log(
        '\nLectura: un valor de 1,00 significa que equivocarse un punto en el ancla mueve la\n' +
            'grilla un punto porcentual. Por encima de 1 el error se AMPLIFICA.\n',
    );
}

main();
