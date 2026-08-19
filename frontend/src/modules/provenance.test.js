import { describe, expect, it, beforeEach } from 'vitest';
import {
    PROVENANCE_FACTORS,
    emptyProvenance,
    renderProvenanceRows,
    readProvenanceRows,
    provenanceIsEmpty,
    validateProvenance,
} from './provenance.js';

// Ida y vuelta DOM: lo que se pinta se tiene que poder leer igual. Es lo único que puede romperse
// en silencio aquí — un `data-provenance-field` mal escrito no revienta nada, solo hace que el
// dato se pierda al guardar.
describe('provenance: pintar y leer', () => {
    let tbody;
    beforeEach(() => {
        document.body.innerHTML = '<table><tbody id="p"></tbody></table>';
        tbody = document.getElementById('p');
    });

    it('pinta una fila por factor', () => {
        renderProvenanceRows(tbody, emptyProvenance());
        expect(tbody.querySelectorAll('[data-provenance-row]')).toHaveLength(PROVENANCE_FACTORS.length);
    });

    it('lo que se pinta se lee idéntico (ida y vuelta)', () => {
        const original = emptyProvenance();
        original.tef = {
            origen: 'historico-propio',
            observaciones: 6,
            exposicion: 4,
            fuente: 'Bitácora 2022-2025',
        };
        original.magnitud = { origen: 'benchmark-sector', observaciones: null, exposicion: null, fuente: null };
        renderProvenanceRows(tbody, original);
        expect(readProvenanceRows(tbody)).toEqual(original);
    });

    it('un campo vacío se lee como null, NUNCA como 0', () => {
        // "cero observaciones" y "no lo declaré" son cosas distintas: confundirlas haría que un
        // riesgo sin datos pareciera uno medido con resultado cero.
        renderProvenanceRows(tbody, emptyProvenance());
        const leido = readProvenanceRows(tbody);
        expect(leido.tef.observaciones).toBeNull();
        expect(leido.tef.exposicion).toBeNull();
        expect(leido.tef.fuente).toBeNull();
    });

    it('un origen desconocido no rompe el render: cae al default', () => {
        const raro = emptyProvenance();
        raro.tef.origen = 'origen-que-no-existe';
        renderProvenanceRows(tbody, raro);
        expect(readProvenanceRows(tbody).tef.origen).toBe('juicio-experto');
    });

    it('una fuente con comillas no rompe el atributo value', () => {
        const p = emptyProvenance();
        p.tef.fuente = 'Informe "anual" 2025';
        renderProvenanceRows(tbody, p);
        expect(readProvenanceRows(tbody).tef.fuente).toBe('Informe "anual" 2025');
    });
});

describe('provenanceIsEmpty', () => {
    it('el default no dice nada', () => {
        expect(provenanceIsEmpty(emptyProvenance())).toBe(true);
        expect(provenanceIsEmpty(null)).toBe(true);
    });

    it('declarar cualquier cosa ya no es vacío', () => {
        const p = emptyProvenance();
        p.vulnerabilidad.origen = 'benchmark-sector';
        expect(provenanceIsEmpty(p)).toBe(false);
    });
});

describe('validateProvenance', () => {
    it('observaciones sin años es un dato inservible, y se dice antes de mandarlo', () => {
        const p = emptyProvenance();
        p.tef = { origen: 'historico-propio', observaciones: 4, exposicion: null, fuente: null };
        expect(validateProvenance(p)).toMatch(/años/);
    });

    it('con los años declarados, pasa', () => {
        const p = emptyProvenance();
        p.tef = { origen: 'historico-propio', observaciones: 4, exposicion: 3, fuente: null };
        expect(validateProvenance(p)).toBeNull();
    });

    it('cero años observados no tiene sentido', () => {
        const p = emptyProvenance();
        p.magnitud = { origen: 'historico-propio', observaciones: 2, exposicion: 0, fuente: null };
        expect(validateProvenance(p)).toBeTruthy();
    });

    it('el default es válido', () => {
        expect(validateProvenance(emptyProvenance())).toBeNull();
    });
});
