'use strict';

/**
 * BITÁCORA DE INCIDENTES — lo único que puede contradecir al modelo.
 *
 * ## Por qué existe
 *
 * §17 del documento reconoce el agujero: nada de lo que la app calcula se ha comparado nunca
 * contra lo que de verdad pasó. Los tres factores del ALE salen de juicio experto y referencias
 * del sector; un prior alimenta al modelo, pero **solo un dato propio puede falsearlo**.
 *
 * Esto captura ese dato. Todavía NO lo mezcla con nada: no hay ponderación por credibilidad, no
 * cambia ninguna cifra del Registro, no marca nada para recalibrar. Es el enchufe puesto antes de
 * que llegue la corriente — y se hace ahora a propósito, porque meterle captura de datos a una app
 * ya desplegada es mucho más caro que dejar el hueco listo.
 *
 * ## Lo que la bitácora observa es LEF, no TEF
 *
 * Distinción crítica, y la más fácil de arruinar. El glosario define `TEF` como INTENTOS/año y
 * `LEF = TEF · V` como PÉRDIDAS/año. Una bitácora anota **robos que ocurrieron**: nadie registra al
 * ladrón que probó la puerta y se fue. O sea que un conteo de bitácora es una observación de LEF.
 *
 * Si ese número se enchufara al TEF, el motor le volvería a aplicar la Vulnerabilidad y
 * descontaría las defensas dos veces — a un robo consumado ya le fallaron las cámaras, restárselas
 * otra vez es contarlo dos veces. Con una V del 30 % subestimaría 3,3×; con una del 7 %, 14×.
 * Siempre hacia abajo, que es el lado en el que no se puede fallar. Por eso el día que se mezcle,
 * la mezcla va a nivel **LEF** — el prior es `TEF · V` (lo que la app ya calcula) y la evidencia es
 * esto, tal cual. Queda anotado acá para que no se decida distinto por olvido.
 *
 * ## Tres estados, no dos
 *
 * Es el punto de diseño que más importa. Para cada tipo de evento hay tres situaciones distintas:
 *
 *   - `sin_datos`  nadie lo midió. Ausencia de evidencia.
 *   - `cero`       se revisó y no pasó. Evidencia de ausencia, y de las fuertes.
 *   - `conteo`     pasó N veces.
 *
 * Tratar "no lo llené" como "cero" tiraría el riesgo al piso para todo lo que nadie midió. Por eso
 * `sin_datos` es el default y `cero` hay que declararlo a propósito.
 *
 * ## Un cero no siempre dice lo mismo
 *
 * La regla de los tres acota la tasa real a `3/n` con 95 % de confianza. Pero cuánto INFORMA ese
 * cero depende de lo que el modelo esperaba: con una tasa previa de 1,2/año, cero en 5 años tiene
 * probabilidad 0,2 % (evidencia demoledora); con 0,10/año tiene 61 % (no dice nada). O sea que el
 * cero es fuerte justo donde los eventos son frecuentes, y no dice nada de los raros y
 * catastróficos — que son los que dominan la cola. La interfaz muestra las dos cosas para que un
 * cero no invite a bajar el riesgo catastrófico por ausencia de evidencia.
 *
 * ## La exposición vive con cada entrada, no en un campo global
 *
 * "4 incidentes" no significa nada sin "en cuánto". Y el denominador no es el mismo para todos: un
 * robo en carretera se mide por viaje, un incendio de bodega por bodega-año, un robo de remolque
 * estacionado por noche-estacionado. Un solo `viajes_anio` global terminaría escalando un incendio
 * por viajes.
 */

/**
 * Denominadores posibles. `anios` es especial: es el único directamente comparable contra el LEF
 * del modelo, que está en eventos por AÑO. Los demás necesitan una conversión (viajes por año,
 * bodegas, unidades) que la app todavía no pide — y mientras no la tenga, el diagnóstico dice la
 * tasa en su propia unidad y se abstiene de comparar, en vez de inventar el factor.
 */
const EXPOSURE_UNITS = {
    anios: { label: 'Años observados', comparableConModelo: true },
    viajes: { label: 'Viajes', comparableConModelo: false },
    'unidad-anio': { label: 'Unidades × año', comparableConModelo: false },
    'bodega-anio': { label: 'Bodegas × año', comparableConModelo: false },
    'noche-estacionado': { label: 'Noches estacionado', comparableConModelo: false },
    cruces: { label: 'Cruces fronterizos', comparableConModelo: false },
    recolecciones: { label: 'Recolecciones', comparableConModelo: false },
};

const ESTADOS = ['sin_datos', 'cero', 'conteo'];

/** El default honesto: nadie midió esto. */
const DEFAULT_ESTADO = 'sin_datos';

/** Multiplicador de la regla de los tres: 0 eventos en n ⇒ tasa real < 3/n al 95 %. */
const RULE_OF_THREE = 3;

function normalizeEntry(raw) {
    const estado = ESTADOS.includes(raw && raw.estado) ? raw.estado : DEFAULT_ESTADO;
    const exposicionCruda = (raw && raw.exposicion) || {};
    const cantidad =
        typeof exposicionCruda.cantidad === 'number' && exposicionCruda.cantidad > 0 ? exposicionCruda.cantidad : null;
    const unidad = EXPOSURE_UNITS[exposicionCruda.unidad] ? exposicionCruda.unidad : 'anios';

    return {
        tipoEvento: typeof raw.tipoEvento === 'string' ? raw.tipoEvento.trim() : '',
        // Vínculo por NOMBRE al Registro, tolerante a roto — mismo criterio que `triggeredBy`. Sin
        // este vínculo la bitácora es dato huérfano: cuenta eventos que no le corresponden a
        // ningún riesgo, y no hay contra qué compararla.
        riskName: typeof raw.riskName === 'string' && raw.riskName.trim() ? raw.riskName.trim() : null,
        estado,
        // El conteo solo existe en estado `conteo`. En `cero` el conteo ES cero y no se guarda
        // aparte: dos campos que tienen que concordar son dos campos que se pueden contradecir.
        conteo: estado === 'conteo' && typeof raw.conteo === 'number' && raw.conteo >= 0 ? raw.conteo : null,
        exposicion: cantidad === null ? null : { cantidad, unidad },
        notas: typeof raw.notas === 'string' && raw.notas.trim() ? raw.notas.trim() : null,
    };
}

/** Siempre devuelve la misma forma, venga lo que venga del almacenamiento. */
function normalizeIncidentLog(stored) {
    const entries = Array.isArray(stored && stored.entries) ? stored.entries.map(normalizeEntry) : [];
    return {
        entries,
        actualizadoEn: (stored && typeof stored.actualizadoEn === 'string' && stored.actualizadoEn) || null,
    };
}

/**
 * Valida lo que llega por la API. Devuelve el mensaje de error, o null si es válido.
 *
 * Se rechaza al capturar y no al usar: un conteo sin exposición es inservible, y descubrirlo meses
 * después —cuando ya no se le puede preguntar a nadie en cuántos años fue— es descubrirlo tarde.
 */
function validateIncidentLog(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) return 'La bitácora debe ser un objeto.';
    const entries = value.entries;
    if (entries !== undefined && !Array.isArray(entries)) return 'incidentLog.entries debe ser un arreglo.';

    for (const [i, e] of (entries || []).entries()) {
        const donde = `entries[${i}]`;
        if (!e || typeof e !== 'object' || Array.isArray(e)) return `${donde} debe ser un objeto.`;
        if (typeof e.tipoEvento !== 'string' || !e.tipoEvento.trim()) {
            return `${donde}.tipoEvento es obligatorio: una entrada sin tipo de evento no se puede usar para nada.`;
        }
        if (e.estado !== undefined && !ESTADOS.includes(e.estado)) {
            return `${donde}.estado debe ser uno de: ${ESTADOS.join(', ')}.`;
        }
        if (e.estado === 'conteo') {
            if (typeof e.conteo !== 'number' || !Number.isFinite(e.conteo) || e.conteo < 0) {
                return `${donde}.conteo debe ser un número >= 0 cuando el estado es "conteo".`;
            }
            // Un cero declarado como conteo es la trampa: significa lo mismo que el estado `cero`
            // pero por un camino distinto, y después nadie sabe si fue medido o tecleado por
            // inercia. Se empuja al estado que lo dice explícitamente.
            if (e.conteo === 0) {
                return `${donde}: para declarar cero eventos usa el estado "cero", que dice que se revisó, en vez de un conteo de 0.`;
            }
        }
        if (e.exposicion !== undefined && e.exposicion !== null) {
            const exp = e.exposicion;
            if (typeof exp !== 'object' || Array.isArray(exp)) return `${donde}.exposicion debe ser un objeto o null.`;
            if (typeof exp.cantidad !== 'number' || !Number.isFinite(exp.cantidad) || exp.cantidad <= 0) {
                return `${donde}.exposicion.cantidad debe ser un número mayor que 0.`;
            }
            if (exp.unidad !== undefined && !EXPOSURE_UNITS[exp.unidad]) {
                return `${donde}.exposicion.unidad debe ser una de: ${Object.keys(EXPOSURE_UNITS).join(', ')}.`;
            }
        }
        // Declarar evidencia sin decir sobre cuánta exposición la deja inservible, y eso vale
        // igual para un conteo que para un cero: "cero robos" no dice nada sin "en cuántos años".
        if ((e.estado === 'conteo' || e.estado === 'cero') && !e.exposicion) {
            return `${donde}: declara la exposición (en cuánto se observó) — sin ella el dato no se puede usar.`;
        }
    }
    return null;
}

/**
 * Diagnóstico, NO mezcla. Para cada entrada con evidencia, dice qué tasa se observó y —solo cuando
 * la exposición está en años y el riesgo vinculado ya está analizado— qué decía el modelo.
 *
 * Es la primera vez que una cifra del motor se pone al lado de un dato real. No cambia nada: es
 * exactamente la comparación que §17 dice que falta.
 *
 * @param {Object} log Bitácora ya normalizada.
 * @param {Array<Object>} register Registro de Riesgos, para el vínculo por nombre.
 */
function summarizeIncidentLog(log, register) {
    const porNombre = new Map((register || []).map((r) => [r.riskName, r]));

    const diagnostics = (log.entries || []).map((e) => {
        const riesgo = e.riskName ? porNombre.get(e.riskName) : null;
        const vinculoRoto = !!e.riskName && !riesgo;
        const unidad = e.exposicion ? e.exposicion.unidad : null;
        const comparable = !!unidad && EXPOSURE_UNITS[unidad].comparableConModelo;

        const base = {
            tipoEvento: e.tipoEvento,
            riskName: e.riskName,
            estado: e.estado,
            vinculoRoto,
            unidad,
            tasaObservada: null,
            cotaSuperior95: null,
            lefModelo: null,
            probabilidadDeEseCero: null,
            comparableConModelo: comparable,
        };

        if (e.estado === 'sin_datos' || !e.exposicion) return base;

        const n = e.exposicion.cantidad;
        base.tasaObservada = e.estado === 'cero' ? 0 : e.conteo / n;
        // Regla de los tres: con 0 eventos observados, la tasa real está por debajo de 3/n al
        // 95 %. Se reporta solo para el cero, que es donde la tasa puntual (0) engaña.
        if (e.estado === 'cero') base.cotaSuperior95 = RULE_OF_THREE / n;

        // El LEF del modelo, si hay con qué. Es TEF x Vulnerabilidad, o sea PÉRDIDAS por año —
        // la misma magnitud que cuenta la bitácora. Comparar contra el TEF sería comparar
        // intentos contra consumados.
        if (riesgo && riesgo.tef && riesgo.vuln && comparable) {
            base.lefModelo = riesgo.tef.mode * (riesgo.vuln.mode / 100);
            if (e.estado === 'cero' && base.lefModelo > 0) {
                // Qué tan sorprendente es ese cero SI el modelo tuviera razón. Es lo que separa
                // "los controles funcionan" de "no pasó nada y tampoco tenía por qué pasar".
                base.probabilidadDeEseCero = Math.exp(-base.lefModelo * n);
            }
        }
        return base;
    });

    const conEvidencia = diagnostics.filter((d) => d.estado !== 'sin_datos');
    return {
        total: diagnostics.length,
        conEvidencia: conEvidencia.length,
        sinDatos: diagnostics.length - conEvidencia.length,
        cerosDeclarados: diagnostics.filter((d) => d.estado === 'cero').length,
        vinculosRotos: diagnostics.filter((d) => d.vinculoRoto).length,
        // Cuántas entradas se pueden de verdad poner al lado del modelo hoy. Es el numerador de
        // §17: mientras sea 0, nada de la app ha sido contrastado contra la realidad.
        comparables: diagnostics.filter((d) => d.lefModelo !== null).length,
        diagnostics,
    };
}

module.exports = {
    EXPOSURE_UNITS,
    ESTADOS,
    DEFAULT_ESTADO,
    RULE_OF_THREE,
    normalizeIncidentLog,
    validateIncidentLog,
    summarizeIncidentLog,
};
