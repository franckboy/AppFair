import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app-namespace.js';
import {
    LOSS_FORMS_KEYS,
    LOSS_FORM_LABELS,
    classifyPointSeverity,
    computeCoveredIsoClauses,
    debounce,
    formatCurrency,
    getSafeNumber,
    sanitizeHTML,
    sensitivityLabel,
    severityToClasses,
    severityToHex,
    shortMetricLabel,
    simpleEvaluationMessage,
    buildHistogramBins,
    computeSuggestedTef,
    sortTriangularRange,
    pertMean,
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

describe('formatCurrency', () => {
    it('formatea un número positivo en dólares enteros, sin centavos', () => {
        expect(formatCurrency(1234)).toBe('$1,234');
    });

    it('redondea en vez de mostrar centavos', () => {
        expect(formatCurrency(1234.56)).toBe('$1,235');
    });

    it('formatea negativos con el signo antes del símbolo ($, no al revés)', () => {
        expect(formatCurrency(-500)).toBe('-$500');
    });

    it('devuelve "—" para null/undefined/NaN en vez de "$NaN"', () => {
        expect(formatCurrency(null)).toBe('—');
        expect(formatCurrency(undefined)).toBe('—');
        expect(formatCurrency(NaN)).toBe('—');
    });

    it('formatea 0 como $0, no como "—"', () => {
        expect(formatCurrency(0)).toBe('$0');
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

    it('.flush() dispara ya la llamada pendiente, con los últimos argumentos, y cancela el timer', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced('a');
        debounced.flush();
        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('a');

        // El timer original ya se canceló — que no vuelva a llamar a fn cuando habría vencido.
        vi.advanceTimersByTime(300);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('.flush() no hace nada si no hay ninguna llamada pendiente', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced.flush();
        expect(fn).not.toHaveBeenCalled();
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

describe('classifyPointSeverity', () => {
    // Mismas zonas que devuelve getRiskMatrixZones (backend) con las bandas por defecto
    // (alto:50, critico:75) — se copian aquí tal cual en vez de importar el backend, porque
    // este archivo es 100% frontend y esas zonas ya le llegan calculadas desde /api/register.
    const zones = [
        { level: 'Bajo', x: [0, 50], y: [0, 50] },
        { level: 'Medio', x: [50, 100], y: [0, 50] },
        { level: 'Medio', x: [0, 50], y: [50, 100] },
        { level: 'Alto', x: [50, 100], y: [50, 100] },
        { level: 'Crítico', x: [75, 100], y: [75, 100] },
        { level: 'Alto', x: [75, 100], y: [50, 75] },
        { level: 'Alto', x: [50, 75], y: [75, 100] },
    ];

    it('clasifica un punto en cada esquina con la zona que le corresponde', () => {
        expect(classifyPointSeverity(0, 0, zones)).toBe('bajo');
        expect(classifyPointSeverity(100, 100, zones)).toBe('critico');
    });

    // Bug real reportado: un riesgo con impactPercent alto (ej. 90, cerca del umbral Crítico
    // en dólares) pero probabilityPercent baja (ej. 5, rara vez supera el umbral de
    // excedencia) cae en la zona "Medio" del mapa (mitad derecha, mitad inferior) — el punto
    // debe pintarse 'medio' (amarillo), NO 'critico' (rojo) solo porque su ALE en dólares sea
    // alto. Antes el punto se coloreaba con r.severity (evaluateFairThreat, un cálculo
    // completamente distinto que ni siquiera puede devolver 'medio'), así que salía rojo
    // sentado sobre una zona amarilla — visualmente contradictorio.
    it('un punto de impacto alto pero probabilidad baja cae en la zona Medio, no Crítico', () => {
        expect(classifyPointSeverity(90, 5, zones)).toBe('medio');
    });

    // Zonas cuyos rangos se tocan/solapan en el borde (ej. Alto x:[50,100] y Crítico
    // x:[75,100], ambas dentro de la misma esquina) deben resolverse a favor de la que
    // getRiskMatrixZones dibuja MÁS TARDE en el canvas (la más específica, que queda pintada
    // encima) — no la primera que aparece en la lista.
    it('en un borde compartido, gana la zona que se dibuja más tarde (la más específica)', () => {
        expect(classifyPointSeverity(50, 50, zones)).toBe('alto'); // esquina de "Alto" x:[50,100] y:[50,100]
        expect(classifyPointSeverity(75, 75, zones)).toBe('alto'); // esquina de "Crítico", pero justo en su propio borde inferior
    });

    it('sin zonas (aún no cargaron), no revienta y devuelve null', () => {
        expect(classifyPointSeverity(50, 50, null)).toBeNull();
        expect(classifyPointSeverity(50, 50, [])).toBeNull();
    });
});

describe('computeCoveredIsoClauses', () => {
    it('sin ningún dato, no cubre nada', () => {
        expect(computeCoveredIsoClauses({})).toEqual([]);
        expect(computeCoveredIsoClauses(null)).toEqual([]);
    });

    it('con tef/vuln/lossMagnitudes, cubre 6.4.2/6.4.3/6.4.4', () => {
        const risk = { tef: { min: 1, mode: 2, max: 3 }, vuln: { min: 1, mode: 2, max: 3 }, lossMagnitudes: {} };
        expect(computeCoveredIsoClauses(risk)).toEqual(['6.4.2', '6.4.3', '6.4.4']);
    });

    it('un tratamiento en su default (costo/prima en 0) NO cuenta como 6.5 cubierto', () => {
        const risk = { mitigar: { cost: 0 }, transferir: { premium: 0 }, evitar: { cost: 0 } };
        expect(computeCoveredIsoClauses(risk)).toEqual([]);
    });

    it('un tratamiento con costo/prima real SÍ cubre 6.5', () => {
        expect(computeCoveredIsoClauses({ mitigar: { cost: 5000 } })).toEqual(['6.5']);
        expect(computeCoveredIsoClauses({ transferir: { premium: 1200 } })).toEqual(['6.5']);
        expect(computeCoveredIsoClauses({ aceptarJustificacion: 'Riesgo residual bajo, se acepta.' })).toEqual(['6.5']);
    });

    it('menos de 2 revisiones en el historial NO cubre 6.6 (necesita al menos 2 para ser "historial")', () => {
        expect(computeCoveredIsoClauses({ reviewHistory: [{ date: 'a' }] })).toEqual([]);
    });

    it('2 o más revisiones en el historial SÍ cubre 6.6', () => {
        expect(computeCoveredIsoClauses({ reviewHistory: [{ date: 'a' }, { date: 'b' }] })).toEqual(['6.6']);
    });

    it('un riesgo completo (FAIR + tratamiento + historial) cubre las 5 cláusulas, en orden', () => {
        const risk = {
            tef: { min: 1, mode: 2, max: 3 },
            vuln: { min: 1, mode: 2, max: 3 },
            lossMagnitudes: {},
            mitigar: { cost: 5000 },
            reviewHistory: [{ date: 'a' }, { date: 'b' }],
        };
        expect(computeCoveredIsoClauses(risk)).toEqual(['6.4.2', '6.4.3', '6.4.4', '6.5', '6.6']);
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

describe('shortMetricLabel', () => {
    beforeEach(() => {
        App.UIMode = { mode: 'simple' };
    });

    it('en Modo Simple, usa la etiqueta corta para cada key conocida', () => {
        expect(shortMetricLabel('ale', 'ALE')).toBe('Pérdida Promedio');
        expect(shortMetricLabel('cvar95', 'CVaR 95%')).toBe('Peor Caso Típico (5%)');
        expect(shortMetricLabel('p90', 'P90')).toBe('Peor 10% de los Casos');
        expect(shortMetricLabel('pareto', 'Pareto')).toBe('Los Que Más Pesan');
    });

    it('en Modo Técnico, siempre devuelve el texto técnico pasado como fallback', () => {
        App.UIMode.mode = 'tecnico';
        expect(shortMetricLabel('ale', 'ALE')).toBe('ALE');
        expect(shortMetricLabel('cvar95', 'CVaR 95%')).toBe('CVaR 95%');
    });

    it('con una key desconocida, devuelve el texto técnico aunque esté en Modo Simple', () => {
        expect(shortMetricLabel('no-existe', 'Texto original')).toBe('Texto original');
    });
});

describe('simpleEvaluationMessage', () => {
    const fmt = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

    it('Amenaza crítica por ALE (no por cola): menciona el monto y que hay que actuar ya', () => {
        const evaluation = { level: 'Crítico — Requiere Acción Inmediata', severity: 'critico' };
        const msg = simpleEvaluationMessage(evaluation, 300000, 350000, 'amenaza', fmt);
        expect(msg).toContain('$300,000');
        expect(msg).not.toMatch(/CVaR|percentil/i);
    });

    it('Amenaza crítica por cola (CVaR): menciona AMBOS montos sin nombrar CVaR/percentiles', () => {
        const evaluation = { level: 'Crítico (riesgo de cola) — Requiere Atención', severity: 'critico' };
        const msg = simpleEvaluationMessage(evaluation, 50000, 400000, 'amenaza', fmt);
        expect(msg).toContain('$50,000');
        expect(msg).toContain('$400,000');
        expect(msg).not.toMatch(/CVaR|percentil/i);
    });

    it('Amenaza alto/medio/aceptable: devuelve un mensaje distinto por banda', () => {
        const alto = simpleEvaluationMessage(
            { level: 'Alto — Requiere Tratamiento', severity: 'alto' },
            100000,
            100000,
            'amenaza',
            fmt,
        );
        const medio = simpleEvaluationMessage(
            { level: 'Medio — Vigilar', severity: 'medio' },
            50000,
            50000,
            'amenaza',
            fmt,
        );
        const bajo = simpleEvaluationMessage({ level: 'Aceptable', severity: 'bajo' }, 10000, 10000, 'amenaza', fmt);
        expect(alto).not.toBe(medio);
        expect(medio).not.toBe(bajo);
        [alto, medio, bajo].forEach((msg) => expect(msg).not.toMatch(/CVaR|percentil/i));
    });

    it('Oportunidad: usa un mensaje de beneficio, no de pérdida', () => {
        const msg = simpleEvaluationMessage(
            { level: 'Oportunidad Significativa — Recomendable Perseguir', severity: 'bajo' },
            80000,
            80000,
            'oportunidad',
            fmt,
        );
        expect(msg).toMatch(/beneficiar/);
        expect(msg).not.toMatch(/costar|perder/);
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

describe('computeSuggestedTef', () => {
    // Anclas de juicio experto (ver TEF_ANCHORS_BY_PROFILE_SCORE en utils.js): la frecuencia de
    // INTENTOS es inversa a la capacidad del atacante — un oportunista prueba puertas todo el
    // tiempo, un actor estatal monta una campaña dirigida cada varios años.
    const oportunista = {
        name: 'Intruso Oportunista',
        motivation: 30,
        resources: 10,
        capacity: 20,
        persistence: 20,
        sophistication: 10,
    };
    const organizado = {
        name: 'Grupo Criminal Organizado',
        motivation: 65,
        resources: 60,
        capacity: 60,
        persistence: 65,
        sophistication: 50,
    };
    const estadoNacion = {
        name: 'Terrorista o Espía',
        motivation: 90,
        resources: 90,
        capacity: 90,
        persistence: 90,
        sophistication: 90,
    };

    it('con el deslizador en neutro reproduce el ancla de hurto oportunista (18 intentos/año)', () => {
        expect(computeSuggestedTef(oportunista, 'oportunista', 0.7, true).mode).toBe(18);
    });

    it('reproduce el ancla de robo de carga por crimen organizado (1,2 intentos/año)', () => {
        expect(computeSuggestedTef(organizado, 'organizado', 0.7, true).mode).toBe(1.2);
    });

    it('reproduce el ancla de amenaza catastrófica (0,02 = 1 cada 50 años) SIN piso en 1', () => {
        const result = computeSuggestedTef(estadoNacion, 'estado-nacion', 0.7, true);
        expect(result.mode).toBe(0.02);
        // El modelo anterior tenía Math.max(1, ...), que hacía imposible expresar una amenaza de
        // baja frecuencia y alto impacto: cualquier sugerencia se aplastaba a 1 evento/año.
        expect(result.min).toBeLessThan(1);
        expect(result.max).toBeLessThan(1);
    });

    it('un atacante MÁS capaz sugiere MENOS intentos al año, no más (premisa corregida)', () => {
        // El modelo anterior asumía lo contrario: partía de 10 intentos/año para todos y los subía
        // con Motivación y Persistencia. La frecuencia con la que TU activo recibe intentos la
        // manda cuántos actores de ese tipo hay y qué tan indiscriminados son — no el empeño de
        // cada uno, que es lo que determina si el intento tiene ÉXITO (eso es la Vulnerabilidad).
        const oport = computeSuggestedTef(oportunista, 'oportunista', 0.7, true).mode;
        const org = computeSuggestedTef(organizado, 'organizado', 0.7, true).mode;
        const estado = computeSuggestedTef(estadoNacion, 'estado-nacion', 0.7, true).mode;
        expect(oport).toBeGreaterThan(org);
        expect(org).toBeGreaterThan(estado);
    });

    it('el rango respeta min <= mode <= max en los tres órdenes de magnitud', () => {
        for (const [perfil, key] of [
            [oportunista, 'oportunista'],
            [organizado, 'organizado'],
            [estadoNacion, 'estado-nacion'],
        ]) {
            const r = computeSuggestedTef(perfil, key, 0.7, true);
            expect(r.min).toBeLessThanOrEqual(r.mode);
            expect(r.mode).toBeLessThanOrEqual(r.max);
        }
    });

    it('el deslizador sube y baja la sugerencia alrededor del ancla', () => {
        const bajo = computeSuggestedTef(oportunista, 'oportunista', 0.35, true).mode;
        const neutro = computeSuggestedTef(oportunista, 'oportunista', 0.7, true).mode;
        const alto = computeSuggestedTef(oportunista, 'oportunista', 1.4, true).mode;
        expect(bajo).toBeLessThan(neutro);
        expect(alto).toBeGreaterThan(neutro);
    });

    it('sin amenaza deliberada ignora el deslizador y deja el ancla del perfil', () => {
        const conDeslizador = computeSuggestedTef(oportunista, 'oportunista', 2, false).mode;
        const neutro = computeSuggestedTef(oportunista, 'oportunista', 0.7, true).mode;
        expect(conDeslizador).toBe(neutro);
    });

    it('usa la key del atacante en la explicación si el perfil no tiene name', () => {
        const result = computeSuggestedTef({ motivation: 50, persistence: 50 }, 'perfil-sin-nombre', 0.7, true);
        expect(result.explanation).toContain('perfil-sin-nombre');
    });
});

describe('sortTriangularRange', () => {
    it('ordena min/más probable/max de menor a mayor', () => {
        expect(sortTriangularRange([50, 10, 30])).toEqual([10, 30, 50]);
    });

    it('no altera un rango que ya está bien ordenado', () => {
        expect(sortTriangularRange([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('no modifica el arreglo original (no tiene efectos secundarios)', () => {
        const original = [30, 10, 20];
        sortTriangularRange(original);
        expect(original).toEqual([30, 10, 20]);
    });
});

describe('pertMean', () => {
    it('con un rango simétrico, la media coincide con la moda', () => {
        expect(pertMean(10, 20, 30)).toBe(20);
    });

    it('con un rango asimétrico, la media NO coincide con la moda', () => {
        // min 10 / moda 20 / max 45, lambda=4 → media = (10+80+45)/6 = 22.5
        expect(pertMean(10, 20, 45)).toBeCloseTo(22.5);
    });

    it('es la fórmula estándar (min+lambda·mode+max)/(lambda+2), no la de la triangular', () => {
        expect(pertMean(0, 90, 100)).toBeCloseTo((0 + 4 * 90 + 100) / 6);
    });

    it('con lambda mayor, la media se acerca más a la moda (más peso al valor "más probable")', () => {
        const meanLambda4 = pertMean(0, 90, 100, 4);
        const meanLambda8 = pertMean(0, 90, 100, 8);
        expect(Math.abs(meanLambda8 - 90)).toBeLessThan(Math.abs(meanLambda4 - 90));
    });
});
