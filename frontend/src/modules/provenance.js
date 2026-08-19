// Procedencia por factor: de dónde salió cada uno de los tres números que se multiplican para dar
// la pérdida anual esperada. Ver backend/src/lib/provenance.js para el porqué completo.
//
// Vive aparte del wizard porque lo tocan cinco lugares distintos (arrancar, retomar un riesgo
// guardado, restaurar el borrador del navegador, guardar el borrador, guardar en el Registro) y
// duplicar el mismo render/lectura en cada uno es como se desincronizan las cosas.
//
// Funciones puras sobre el DOM que se les pasa — no conocen `state` ni `App`, así que se prueban
// solas.

// Sin el acrónimo a propósito: la etiqueta técnica ya vive en el Análisis de Sensibilidad, y aquí
// la columna se lee igual de bien sin ella.
export const PROVENANCE_FACTORS = [
    { key: 'tef', label: 'Frecuencia' },
    { key: 'vulnerabilidad', label: 'Vulnerabilidad' },
    { key: 'magnitud', label: 'Magnitud de Pérdida' },
];

// El orden es el mismo que en el backend: de más a menos sostenido por evidencia.
export const PROVENANCE_ORIGINS = [
    { value: 'historico-propio', label: 'Histórico propio' },
    { value: 'benchmark-sector', label: 'Referencia del sector' },
    { value: 'catalogo', label: 'Catálogo de la app' },
    { value: 'juicio-experto', label: 'Juicio experto' },
];

export const DEFAULT_ORIGIN = 'juicio-experto';

/** La procedencia de un riesgo que no declaró ninguna: los tres factores a juicio experto. */
export function emptyProvenance() {
    const salida = {};
    PROVENANCE_FACTORS.forEach(({ key }) => {
        salida[key] = { origen: DEFAULT_ORIGIN, observaciones: null, exposicion: null, fuente: null };
    });
    return salida;
}

const numeroOVacio = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * Pinta las tres filas dentro del `<tbody>` que se le pase.
 * @param {HTMLElement} tbody
 * @param {Object} provenance Forma normalizada (ver emptyProvenance).
 */
export function renderProvenanceRows(tbody, provenance) {
    if (!tbody) return;
    const p = provenance || emptyProvenance();
    tbody.innerHTML = PROVENANCE_FACTORS.map(({ key, label }) => {
        const actual = p[key] || {};
        // El origen se NORMALIZA antes de armar las opciones. Sin esto, un valor que la lista no
        // reconoce (dato viejo, typo, algo de otra versión) no marca ninguna opción como
        // `selected`, y el <select> se queda con la PRIMERA — que es "Histórico propio", la
        // afirmación más fuerte de todas. O sea que un dato ilegible se convertiría en silencio en
        // "esto lo respalda nuestro propio histórico", que es exactamente el lado hacia el que no
        // se puede fallar. Lo encontró un test, no una revisión.
        const origen = PROVENANCE_ORIGINS.some((o) => o.value === actual.origen) ? actual.origen : DEFAULT_ORIGIN;
        const opciones = PROVENANCE_ORIGINS.map(
            (o) => `<option value="${o.value}"${origen === o.value ? ' selected' : ''}>${o.label}</option>`,
        ).join('');
        return `
            <tr class="border-b last:border-0" data-provenance-row="${key}">
                <td class="py-1 pr-2 align-middle">${label}</td>
                <td class="py-1 pr-2"><select class="form-select text-sm" data-provenance-field="origen">${opciones}</select></td>
                <td class="py-1 pr-2"><input type="number" min="0" step="1" class="form-input text-sm" data-provenance-field="observaciones" placeholder="—" value="${numeroOVacio(actual.observaciones)}"></td>
                <td class="py-1 pr-2"><input type="number" min="0" step="any" class="form-input text-sm" data-provenance-field="exposicion" placeholder="—" value="${numeroOVacio(actual.exposicion)}"></td>
                <td class="py-1"><input type="text" class="form-input text-sm" data-provenance-field="fuente" placeholder="Opcional" value="${(actual.fuente || '').replace(/"/g, '&quot;')}"></td>
            </tr>`;
    }).join('');
}

/**
 * Lee las tres filas de vuelta a la forma que espera la API.
 *
 * Un campo vacío se lee como `null`, nunca como 0: "cero observaciones" y "no lo declaré" son cosas
 * distintas, y confundirlas haría que un riesgo sin datos pareciera uno medido con resultado cero.
 * @param {HTMLElement} tbody
 */
export function readProvenanceRows(tbody) {
    const salida = emptyProvenance();
    if (!tbody) return salida;
    PROVENANCE_FACTORS.forEach(({ key }) => {
        const fila = tbody.querySelector(`[data-provenance-row="${key}"]`);
        if (!fila) return;
        const leer = (campo) => {
            const el = fila.querySelector(`[data-provenance-field="${campo}"]`);
            return el ? el.value.trim() : '';
        };
        const obs = leer('observaciones');
        const exp = leer('exposicion');
        const fuente = leer('fuente');
        salida[key] = {
            origen: leer('origen') || DEFAULT_ORIGIN,
            observaciones: obs === '' ? null : Number(obs),
            exposicion: exp === '' ? null : Number(exp),
            fuente: fuente === '' ? null : fuente,
        };
    });
    return salida;
}

/**
 * ¿Esta procedencia dice algo, o es el default? Sirve para no persistir ruido: un riesgo que nadie
 * tocó se guarda sin el campo, y el backend lo normaliza igual al leer. Así el Registro distingue
 * "no declarado" de "declarado como juicio experto a propósito"… que en la práctica son lo mismo,
 * pero uno ensucia el JSON de todos los riesgos y el otro no.
 */
export function provenanceIsEmpty(p) {
    if (!p) return true;
    return PROVENANCE_FACTORS.every(({ key }) => {
        const f = p[key];
        if (!f) return true;
        return (
            (f.origen || DEFAULT_ORIGIN) === DEFAULT_ORIGIN &&
            f.observaciones === null &&
            f.exposicion === null &&
            !f.fuente
        );
    });
}

/**
 * Valida lo mismo que el backend, para poder decirlo ANTES de mandar: declarar observaciones sin
 * los años en que se observaron deja el dato inservible.
 * @returns {string|null} mensaje de error, o null si está bien
 */
export function validateProvenance(p) {
    if (!p) return null;
    for (const { key, label } of PROVENANCE_FACTORS) {
        const f = p[key];
        if (!f) continue;
        if (typeof f.observaciones === 'number' && f.observaciones > 0 && typeof f.exposicion !== 'number') {
            return `${label}: declaraste ${f.observaciones} observaciones pero no en cuántos años. Sin eso el conteo no se puede usar.`;
        }
        if (typeof f.exposicion === 'number' && !(f.exposicion > 0)) {
            return `${label}: los años observados tienen que ser mayores que 0.`;
        }
        if (typeof f.observaciones === 'number' && f.observaciones < 0) {
            return `${label}: las observaciones no pueden ser negativas.`;
        }
    }
    return null;
}
