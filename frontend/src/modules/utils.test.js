import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app-namespace.js';
import {
    LOSS_FORMS_KEYS,
    LOSS_FORM_LABELS,
    debounce,
    getSafeNumber,
    sanitizeHTML,
    sensitivityLabel,
    severityToClasses,
    severityToHex,
    buildHistogramBins,
} from './utils.js';

describe('LOSS_FORMS_KEYS / LOSS_FORM_LABELS consistency', () => {
    it('tiene una etiqueta técnica y una simple para cada categoría de pérdida', () => {
        LOSS_FORMS_KEYS.forEach((key) => {
            expect(LOSS_FORM_LABELS.tecnico[key], `falta LOSS_FORM_LABELS.tecnico.${key}`).toBeTruthy();
            expect(LOSS_FORM_LABELS.simple[key], `falta LOSS_FORM_LABELS.simple.${key}`).toBeTruthy();
        });
    });
});

describe('getSafeNumber', () => {
    it('devuelve el número si el input tiene un valor válido', () => {
        expect(getSafeNumber({ value: '42' })).toBe(42);
    });

    it('devuelve 0 para un valor no numérico', () => {
        expect(getSafeNumber({ value: 'abc' })).toBe(0);
    });

    it('recorta valores negativos a 0 (no se permiten pérdidas/frecuencias negativas)', () => {
        expect(getSafeNumber({ value: '-5' })).toBe(0);
    });

    it('devuelve 0 si el input no existe', () => {
        expect(getSafeNumber(null)).toBe(0);
        expect(getSafeNumber(undefined)).toBe(0);
    });
});

describe('sanitizeHTML', () => {
    it('escapa etiquetas HTML en vez de dejarlas ejecutar', () => {
        expect(sanitizeHTML('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('deja pasar texto plano sin cambios', () => {
        expect(sanitizeHTML('Robo a mano armada')).toBe('Robo a mano armada');
    });
});

describe('debounce', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('solo llama a la función una vez, tras el delay, aunque se invoque varias veces seguidas', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced('a');
        debounced('b');
        debounced('c');
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('c');
    });
});

describe('severityToClasses / severityToHex', () => {
    it('mapean cada severidad conocida a sus clases/color', () => {
        expect(severityToClasses('critico')).toContain('bg-red-50');
        expect(severityToClasses('bajo')).toContain('bg-green-50');
        expect(severityToHex('critico')).toBe('#DC2626');
        expect(severityToHex('bajo')).toBe('#22C55E');
    });

    it('devuelven un valor de reserva para una severidad desconocida', () => {
        expect(severityToClasses('no-existe')).toContain('bg-gray-50');
        expect(severityToHex('no-existe')).toBe('#7C3AED');
    });
});

describe('sensitivityLabel', () => {
    beforeEach(() => {
        App.UIMode = { mode: 'simple' };
    });

    it('en Modo Simple, usa la etiqueta corta si existe para la key del factor', () => {
        expect(sensitivityLabel({ key: 'tef', name: 'Frecuencia de Evento de Amenaza' })).toBe('Qué tan seguido pasa');
    });

    it('en Modo Técnico, siempre usa el nombre técnico aunque haya etiqueta corta', () => {
        App.UIMode.mode = 'tecnico';
        expect(sensitivityLabel({ key: 'tef', name: 'Frecuencia de Evento de Amenaza' })).toBe(
            'Frecuencia de Evento de Amenaza',
        );
    });

    it('usa el nombre técnico si la key no tiene etiqueta corta (o no hay key)', () => {
        expect(sensitivityLabel({ name: 'Algo sin key' })).toBe('Algo sin key');
        expect(sensitivityLabel({ key: 'no-existe', name: 'Fallback' })).toBe('Fallback');
    });
});

describe('buildHistogramBins', () => {
    it('reparte las pérdidas en 20 cubetas de igual ancho por defecto', () => {
        const { labels, binCounts } = buildHistogramBins([0, 1000, 2000], 2000);
        expect(labels).toHaveLength(20);
        expect(binCounts).toHaveLength(20);
        expect(binCounts.reduce((a, b) => a + b, 0)).toBe(3);
    });

    it('acumula un valor igual al máximo en la última cubeta (no se sale del arreglo)', () => {
        const { binCounts } = buildHistogramBins([1000], 1000, 4);
        expect(binCounts).toEqual([0, 0, 0, 1]);
    });

    it('con maxLoss 0, no revienta (usa un ancho de cubeta de reserva)', () => {
        const { labels, binCounts } = buildHistogramBins([0, 0], 0, 5);
        expect(labels).toHaveLength(5);
        expect(binCounts[0]).toBe(2);
    });

    it('respeta un numBins distinto al default', () => {
        const { labels, binCounts } = buildHistogramBins([], 1000, 10);
        expect(labels).toHaveLength(10);
        expect(binCounts).toEqual(new Array(10).fill(0));
    });
});
