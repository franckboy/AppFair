import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state.js';
import { FairRegister } from './fair-register.js';

describe('FairRegister.classifyAleAgainstCriteria', () => {
    beforeEach(() => {
        state.config.riskCriteria = { aleAceptablePercent: 20, aleCritico: 250000 };
    });

    it('clasifica como bajo un ALE por debajo del umbral aceptable', () => {
        expect(FairRegister.classifyAleAgainstCriteria(10000)).toBe('bajo');
    });

    it('clasifica como bajo un ALE exactamente igual al umbral aceptable (no lo supera)', () => {
        expect(FairRegister.classifyAleAgainstCriteria(50000)).toBe('bajo');
    });

    // El tramo entre aceptable (50000) y crítico (250000) se parte a la mitad exacta
    // (aleMedio=150000) en medio/alto — mismo criterio que evaluateFairThreat en el backend,
    // sin un tercer umbral configurado aparte.
    it('clasifica como medio un ALE en la mitad inferior del tramo aceptable-crítico', () => {
        expect(FairRegister.classifyAleAgainstCriteria(100000)).toBe('medio');
        expect(FairRegister.classifyAleAgainstCriteria(150000)).toBe('medio'); // límite inclusive
    });

    it('clasifica como alto un ALE en la mitad superior del tramo aceptable-crítico', () => {
        expect(FairRegister.classifyAleAgainstCriteria(150001)).toBe('alto');
        expect(FairRegister.classifyAleAgainstCriteria(250000)).toBe('alto'); // no supera crítico todavía
    });

    it('clasifica como crítico un ALE por encima del umbral crítico', () => {
        expect(FairRegister.classifyAleAgainstCriteria(300000)).toBe('critico');
    });

    it('devuelve null si no hay criterios cargados', () => {
        state.config.riskCriteria = null;
        expect(FairRegister.classifyAleAgainstCriteria(100000)).toBeNull();
    });

    it('devuelve null si el ALE no es un número', () => {
        expect(FairRegister.classifyAleAgainstCriteria('100000')).toBeNull();
        expect(FairRegister.classifyAleAgainstCriteria(null)).toBeNull();
    });
});

describe('FairRegister.computeFairRiskEquivalents', () => {
    beforeEach(() => {
        state.config.riskCriteria = { aleAceptablePercent: 20, aleCritico: 250000 };
    });

    it('devuelve null para una entrada de tipo oportunidad (es un beneficio, no una pérdida)', () => {
        expect(FairRegister.computeFairRiskEquivalents({ riskType: 'oportunidad', ale: 10000 })).toBeNull();
    });

    it('devuelve null si no hay entrada o el ALE no es numérico', () => {
        expect(FairRegister.computeFairRiskEquivalents(null)).toBeNull();
        expect(FairRegister.computeFairRiskEquivalents({ ale: 'no-numero' })).toBeNull();
    });

    it('calcula el Riesgo Inherente a partir de la MEDIA de Beta-PERT de Vulnerabilidad, no de la moda', () => {
        // Rango asimétrico min 10 / moda 20 / max 45, lambda=4 → media = (10+4·20+45)/6 =
        // 22.5%, distinta de la moda (20%) a propósito, para probar que sí se usa la media
        // (la que realmente simula el backend con getPertRandom) y no la moda.
        // ale actual = 10,000 / 0.225 = 44,444.44...
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 10000,
            severity: 'bajo',
            vuln: { min: 10, mode: 20, max: 45 },
        });
        expect(result.actualMoney).toBe('$10,000');
        expect(result.inherentMoney).toBe('$44,444');
        expect(result.controlEffectiveness).toBe('77.5%');
        expect(result.actualSeverity).toBe('bajo');
        // 44,444 <= 50,000 (20% de aleCritico=250000 → aleAceptable derivado) → bajo
        expect(result.inherentSeverity).toBe('bajo');
    });

    it('el Riesgo Residual sale de la decisión de Tratamiento adoptada, y es null mientras no se decida nada', () => {
        // Sin decisión: null, no "igual al actual". Es una distinción real — ISO 31000 exige que
        // tratar un riesgo (incluso aceptarlo) sea una decisión documentada, así que "sin tratar"
        // y "tratado con residual = actual" son estados distintos.
        const sinDecidir = FairRegister.computeFairRiskEquivalents({ ale: 10000, severity: 'bajo' });
        expect(sinDecidir.residualMoney).toBeNull();
        expect(sinDecidir.residualSeverity).toBeNull();
        expect(sinDecidir.residualStrategy).toBeNull();

        // Con decisión adoptada: el residual real, clasificado contra el mismo criterio.
        const tratado = FairRegister.computeFairRiskEquivalents({
            ale: 10000,
            severity: 'bajo',
            treatmentDecision: { strategy: 'mitigar', residualALE: 4000 },
        });
        expect(tratado.actualMoney).toBe('$10,000');
        expect(tratado.residualMoney).toBe('$4,000');
        expect(tratado.residualStrategy).toBe('mitigar');
        expect(tratado.residualSeverity).toBe('bajo');
    });

    it('el Riesgo Residual respeta el Apetito de Riesgo propio del riesgo (riskCriteriaOverride)', () => {
        // Contra el criterio global (aleCritico 250,000) un residual de 60,000 es "bajo"; con un
        // override mucho más estricto para ESE riesgo, el mismo monto pasa a "crítico". Las tres
        // etapas deben clasificarse contra el mismo criterio para poder compararse entre sí.
        const conOverride = FairRegister.computeFairRiskEquivalents({
            ale: 100000,
            severity: 'critico',
            riskCriteriaOverride: { aleCritico: 50000, aleAceptablePercent: 20 },
            treatmentDecision: { strategy: 'mitigar', residualALE: 60000 },
        });
        expect(conOverride.residualMoney).toBe('$60,000');
        expect(conOverride.residualSeverity).toBe('critico');
    });

    it('sin datos de Vulnerabilidad, no calcula el equivalente inherente (solo el actual)', () => {
        const result = FairRegister.computeFairRiskEquivalents({ ale: 10000, severity: 'bajo' });
        expect(result.actualMoney).toBe('$10,000');
        expect(result.inherentMoney).toBeNull();
        expect(result.inherentSeverity).toBeNull();
        expect(result.controlEffectiveness).toBeNull();
    });

    it('con un rango incompleto (falta min/max), tampoco calcula el equivalente inherente', () => {
        const result = FairRegister.computeFairRiskEquivalents({ ale: 10000, severity: 'bajo', vuln: { mode: 25 } });
        expect(result.inherentMoney).toBeNull();
        expect(result.controlEffectiveness).toBeNull();
    });

    it('con entry.inherentALE real (post-resimulación), lo usa DIRECTO en vez de la aproximación algebraica', () => {
        // vuln daría 44,444 por la aproximación algebraica (ver el test de arriba) — con
        // inherentALE real persistido, debe ignorarse por completo esa aproximación y usar el
        // número real de la simulación.
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 10000,
            severity: 'bajo',
            vuln: { min: 10, mode: 20, max: 45 },
            inherentALE: 60000,
        });
        expect(result.actualMoney).toBe('$10,000');
        expect(result.inherentMoney).toBe('$60,000');
        // Efectividad = (60000-10000)/60000 = 83.3%, NO el 77.5% que daría la aproximación vieja.
        expect(result.controlEffectiveness).toBe('83.3%');
    });

    it('con entry.inherentALE === 0 (guard de división por cero), controlEffectiveness es null sin tronar', () => {
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 0,
            severity: 'bajo',
            inherentALE: 0,
        });
        expect(result.inherentMoney).toBe('$0');
        expect(result.controlEffectiveness).toBeNull();
    });

    it('con entry.inherentSeverity persistido, lo usa DIRECTO en vez de reclasificar con classifyAleAgainstCriteria (bug real corregido)', () => {
        // aleCritico=250000, aleAceptablePercent=20 -> aleAceptable=50000, aleMedio=150000.
        // classifyAleAgainstCriteria(60000) daría 'medio' (50000 < 60000 <= 150000) — pero el
        // backend YA clasificó este riesgo como 'critico' de verdad (ej. por CVaR95 > aleCritico,
        // el caso "cola de riesgo" que la copia local nunca puede ver porque solo recibe el ALE).
        // Con inherentSeverity persistido, debe ganar ese valor real, no el recalculado a mano.
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 10000,
            severity: 'bajo',
            inherentALE: 60000,
            inherentSeverity: 'critico',
        });
        expect(result.inherentMoney).toBe('$60,000');
        expect(result.inherentSeverity).toBe('critico');
    });

    it('con entry.inherentALE real pero SIN inherentSeverity (riesgo guardado antes de que existiera ese campo), cae a classifyAleAgainstCriteria', () => {
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 10000,
            severity: 'bajo',
            inherentALE: 60000,
        });
        // 60000 > aleAceptable (50000) y <= aleMedio (150000) -> 'medio', vía la copia local.
        expect(result.inherentSeverity).toBe('medio');
    });

    it('con entry.residualSeverity del backend, lo usa DIRECTO — el residual también tiene cola', () => {
        // El mismo defecto que ya se había corregido para el inherente, vivo todavía en el
        // residual: la copia local solo recibe el ALE, así que un residual cuya COLA supera el
        // criterio Crítico se pintaba en verde. El backend ahora lo clasifica con las dos cosas
        // (ver residualPair + evaluateFairThreat en GET /api/register).
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 200000,
            severity: 'alto',
            treatmentDecision: { strategy: 'mitigar', residualALE: 20000, residualCVaR: 900000 },
            residualSeverity: 'critico',
        });
        expect(result.residualMoney).toBe('$20,000');
        // classifyAleAgainstCriteria(20000) habría dicho 'bajo': 20.000 < aleAceptable (50.000).
        expect(result.residualSeverity).toBe('critico');
    });

    it('sin residualSeverity (respuesta de un backend anterior), cae a la copia local', () => {
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 200000,
            severity: 'alto',
            treatmentDecision: { strategy: 'mitigar', residualALE: 20000 },
        });
        expect(result.residualSeverity).toBe('bajo');
    });
});

describe('FairRegister.buildConcentratedList', () => {
    beforeEach(() => {
        state.config.riskCriteria = { aleAceptablePercent: 20, aleCritico: 250000 };
    });

    it('marca como "triage" un riesgo de Análisis Rápido sin entrada de FAIR vinculada', () => {
        const risks = [{ id: 'r1', name: 'Robo en bodega', createdAt: '2026-01-01', ri: 5000, rrt: 3000 }];
        const list = FairRegister.buildConcentratedList(risks, []);
        expect(list).toHaveLength(1);
        expect(list[0].stage).toBe('triage');
        expect(list[0].riesgoInherente).toBe(5000);
        expect(list[0].riesgoActual).toBe(3000);
    });

    it('fusiona en una sola fila un riesgo de triage con su entrada de FAIR (por sourceRiskId)', () => {
        const risks = [{ id: 'r1', name: 'Robo en bodega', createdAt: '2026-01-01' }];
        const register = [
            {
                id: 'reg1',
                sourceRiskId: 'r1',
                riskName: 'Robo en bodega (FAIR)',
                date: '2026-01-02',
                ale: 10000,
                severity: 'bajo',
                vuln: { min: 10, mode: 20, max: 45 },
            },
        ];
        const list = FairRegister.buildConcentratedList(risks, register);
        expect(list).toHaveLength(1);
        expect(list[0].stage).toBe('fair');
        expect(list[0].rowKey).toBe('reg1');
        expect(list[0].riskName).toBe('Robo en bodega (FAIR)');
        expect(list[0].riesgoInherente).toBe('$44,444');
    });

    it('incluye una entrada de FAIR sin ningún riesgo de triage vinculado', () => {
        const register = [{ id: 'reg1', sourceRiskId: null, riskName: 'Análisis directo', date: '2026-01-01' }];
        const list = FairRegister.buildConcentratedList([], register);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBeNull();
        expect(list[0].stage).toBe('fair');
    });

    it('numera las filas en orden cronológico (createdAt/date ascendente)', () => {
        const risks = [{ id: 'r1', name: 'Segundo', createdAt: '2026-02-01' }];
        const register = [{ id: 'reg1', sourceRiskId: null, riskName: 'Primero', date: '2026-01-01' }];
        const list = FairRegister.buildConcentratedList(risks, register);
        expect(list.map((item) => item.riskName)).toEqual(['Primero', 'Segundo']);
        expect(list.map((item) => item.number)).toEqual([1, 2]);
    });
});
