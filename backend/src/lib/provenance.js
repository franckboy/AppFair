'use strict';

/**
 * PROCEDENCIA POR FACTOR — de dónde salió cada número que alimenta el ALE.
 *
 * Por qué existe. `ALE = TEF x Vulnerabilidad x E[Magnitud]` es MULTILINEAL: la elasticidad de los
 * tres factores es exactamente 1, así que un error del 50 % en cualquiera de ellos es un error del
 * 50 % en la respuesta. Pero el esfuerzo de calibración de la app está repartido de forma muy
 * desigual:
 *
 *   Vulnerabilidad  9 anclas de experto, análisis de sensibilidad, 7 versiones de calibración
 *   TEF             3 anclas declaradas "sugerencia editable", sin validación ni sensibilidad
 *   Magnitud        la teclea el usuario; min/max derivados de un factor de confianza
 *
 * O sea, dos tercios del modelo —que pesan igual que el primero— no tienen ni un ancla ni una
 * prueba. Antes de poder arreglar eso hace falta saber de dónde viene cada número, y hoy la app no
 * lo sabe: `dataSource` es UNO POR RIESGO y en texto libre, sin cuántas observaciones lo respaldan.
 *
 * Esto no calcula nada ni cambia ningún número. Es la precondición de tres cosas que sí:
 *
 *   1. Responderle a un auditor "¿de dónde salió que el TEF es 1,2?" con algo que no sea un
 *      encogimiento de hombros.
 *   2. Ponderar por CREDIBILIDAD (Bühlmann): mezclar la experiencia propia con una referencia
 *      externa pesando por cuántos datos hay — `Z = n / (n + k)`. Sin `n` no hay `Z`.
 *   3. Medir cuánto del Registro está sostenido por datos y cuánto por corazonada, que es una
 *      cifra que cambia una conversación con un comité por sí sola.
 */

/** Los tres factores del ALE. En este orden, que es el de la fórmula. */
const FACTOR_KEYS = ['tef', 'vulnerabilidad', 'magnitud'];

const FACTOR_LABELS = {
    tef: 'Frecuencia (TEF)',
    vulnerabilidad: 'Vulnerabilidad',
    magnitud: 'Magnitud de Pérdida',
};

/**
 * De dónde puede venir un factor, de más a menos sostenido por evidencia. El orden IMPORTA: es el
 * que usa `weakestOrigin` para decidir cuál es el eslabón más débil de un riesgo.
 */
const PROVENANCE_ORIGINS = ['historico-propio', 'benchmark-sector', 'catalogo', 'juicio-experto'];

const ORIGIN_LABELS = {
    'historico-propio': 'Histórico propio',
    'benchmark-sector': 'Referencia del sector',
    catalogo: 'Catálogo de la app',
    'juicio-experto': 'Juicio experto',
};

/** El default honesto: sin decir nada, un número es un juicio sin observaciones detrás. */
const DEFAULT_ORIGIN = 'juicio-experto';

/**
 * Mapa del `dataSource` viejo (uno por riesgo) a un origen por factor. Sirve para que los riesgos
 * ya guardados estrenen procedencia sin que nadie los toque, en vez de aparecer todos como
 * "desconocido" — que sería tirar a la basura lo poco que el usuario sí había declarado.
 */
const LEGACY_DATA_SOURCE_TO_ORIGIN = {
    historico: 'historico-propio',
    benchmark: 'benchmark-sector',
    'experto-calibrado': 'juicio-experto',
    'experto-sin-calibrar': 'juicio-experto',
};

function emptyProvenance(origen) {
    return { origen, observaciones: null, exposicion: null, fuente: null };
}

/**
 * Normaliza la procedencia de un riesgo: siempre devuelve los tres factores, siempre con la misma
 * forma. Si el riesgo no trae `factorProvenance` (todos los guardados antes de que existiera), se
 * deriva del `dataSource` que sí tenga.
 *
 * `observaciones` y `exposicion` quedan en null a propósito en ese caso derivado: el `dataSource`
 * viejo decía de qué TIPO era la fuente, nunca CUÁNTA evidencia había. Inventar un número ahí sería
 * exactamente la falsa precisión que este módulo existe para poder medir.
 *
 * @param {Object} risk Entrada del Registro.
 * @returns {Object<string, {origen:string, observaciones:number|null, exposicion:number|null, fuente:string|null}>}
 */
function normalizeFactorProvenance(risk) {
    const derivado = LEGACY_DATA_SOURCE_TO_ORIGIN[risk && risk.dataSource] || DEFAULT_ORIGIN;
    const guardado = (risk && risk.factorProvenance) || {};
    const salida = {};
    FACTOR_KEYS.forEach((key) => {
        const p = guardado[key];
        if (!p || typeof p !== 'object') {
            salida[key] = emptyProvenance(derivado);
            return;
        }
        salida[key] = {
            origen: PROVENANCE_ORIGINS.includes(p.origen) ? p.origen : derivado,
            observaciones: typeof p.observaciones === 'number' && p.observaciones >= 0 ? p.observaciones : null,
            exposicion: typeof p.exposicion === 'number' && p.exposicion > 0 ? p.exposicion : null,
            fuente: typeof p.fuente === 'string' && p.fuente.trim() ? p.fuente.trim() : null,
        };
    });
    return salida;
}

/**
 * Valida lo que llega por la API. Devuelve el mensaje de error, o null si es válido.
 *
 * `null`/ausente es válido: la procedencia es opcional, y no declararla es en sí una declaración
 * (se normaliza a juicio experto). Lo que NO se acepta es declarar algo inconsistente.
 */
function validateFactorProvenance(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        return 'factorProvenance debe ser un objeto o null.';
    }
    for (const key of Object.keys(value)) {
        if (!FACTOR_KEYS.includes(key)) {
            return `factorProvenance.${key} no es un factor válido (${FACTOR_KEYS.join(', ')}).`;
        }
        const p = value[key];
        if (p === null || p === undefined) continue;
        if (typeof p !== 'object' || Array.isArray(p)) {
            return `factorProvenance.${key} debe ser un objeto o null.`;
        }
        if (p.origen !== undefined && p.origen !== null && !PROVENANCE_ORIGINS.includes(p.origen)) {
            return `factorProvenance.${key}.origen debe ser uno de: ${PROVENANCE_ORIGINS.join(', ')}.`;
        }
        if (
            p.observaciones !== undefined &&
            p.observaciones !== null &&
            (typeof p.observaciones !== 'number' || !Number.isFinite(p.observaciones) || p.observaciones < 0)
        ) {
            return `factorProvenance.${key}.observaciones debe ser un número >= 0 o null.`;
        }
        if (
            p.exposicion !== undefined &&
            p.exposicion !== null &&
            (typeof p.exposicion !== 'number' || !Number.isFinite(p.exposicion) || p.exposicion <= 0)
        ) {
            return `factorProvenance.${key}.exposicion debe ser un número > 0 o null.`;
        }
        if (p.fuente !== undefined && p.fuente !== null && typeof p.fuente !== 'string') {
            return `factorProvenance.${key}.fuente debe ser texto o null.`;
        }
        // Declarar observaciones sin exposición deja el dato inservible para ponderar por
        // credibilidad: "4 incidentes" no dice nada sin "en cuántos años". Se rechaza al capturar
        // en vez de descubrirlo cuando ya no se pueda preguntar.
        if (typeof p.observaciones === 'number' && p.observaciones > 0 && !(typeof p.exposicion === 'number')) {
            return `factorProvenance.${key}: si declaras observaciones, declara también la exposición (en años) — sin ella el conteo no se puede usar.`;
        }
    }
    return null;
}

/** El eslabón más débil de un riesgo: el factor peor sostenido de los tres. */
function weakestOrigin(provenance) {
    let peor = PROVENANCE_ORIGINS[0];
    FACTOR_KEYS.forEach((key) => {
        const origen = (provenance[key] && provenance[key].origen) || DEFAULT_ORIGIN;
        if (PROVENANCE_ORIGINS.indexOf(origen) > PROVENANCE_ORIGINS.indexOf(peor)) peor = origen;
    });
    return peor;
}

/**
 * Resumen del Registro entero: cuánto está sostenido por datos y cuánto por juicio, factor por
 * factor. Es la cifra que se muestra en el Dashboard, y la respuesta corta a "¿qué tan sólido es
 * este análisis?".
 *
 * Se cuenta sobre AMENAZAS analizadas. Una oportunidad no alimenta el ALE del portafolio, y un
 * riesgo sin FAIR completo no tiene números cuya procedencia importe todavía.
 *
 * @param {Array<Object>} risks
 */
function summarizeProvenance(risks) {
    const analizadas = (risks || []).filter(
        (r) => r && r.riskType !== 'oportunidad' && r.tef && r.vuln && r.lossMagnitudes,
    );

    const porFactor = {};
    FACTOR_KEYS.forEach((key) => {
        porFactor[key] = { conDatos: 0, total: analizadas.length, observaciones: 0 };
        PROVENANCE_ORIGINS.forEach((o) => {
            porFactor[key][o] = 0;
        });
    });

    let conAlgunDato = 0;
    analizadas.forEach((risk) => {
        const p = normalizeFactorProvenance(risk);
        let alguno = false;
        FACTOR_KEYS.forEach((key) => {
            const origen = p[key].origen;
            porFactor[key][origen] += 1;
            // "Sostenido por datos" es histórico propio o referencia del sector — algo observado
            // fuera de esta app. El catálogo y el juicio experto no lo son: el catálogo es una
            // lista curada de escenarios, no una medición.
            if (origen === 'historico-propio' || origen === 'benchmark-sector') {
                porFactor[key].conDatos += 1;
                alguno = true;
            }
            if (typeof p[key].observaciones === 'number') porFactor[key].observaciones += p[key].observaciones;
        });
        if (alguno) conAlgunDato += 1;
    });

    return {
        total: analizadas.length,
        conAlgunDato,
        porFactor,
        // El porcentaje del MODELO sostenido por algo observado: los tres factores pesan igual en el
        // ALE (elasticidad 1 cada uno), así que se promedian los tres sin ponderar. Un 33 % significa
        // "uno de los tres factores tiene datos detrás", no "un tercio de la respuesta es correcta".
        porcentajeSostenido:
            analizadas.length === 0
                ? 0
                : (100 * FACTOR_KEYS.reduce((suma, key) => suma + porFactor[key].conDatos, 0)) /
                  (analizadas.length * FACTOR_KEYS.length),
    };
}

module.exports = {
    FACTOR_KEYS,
    FACTOR_LABELS,
    PROVENANCE_ORIGINS,
    ORIGIN_LABELS,
    DEFAULT_ORIGIN,
    normalizeFactorProvenance,
    validateFactorProvenance,
    weakestOrigin,
    summarizeProvenance,
};
