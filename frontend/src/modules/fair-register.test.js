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
        // ale residual = 10,000 / 0.225 = 44,444.44...
        const result = FairRegister.computeFairRiskEquivalents({
            ale: 10000,
            severity: 'bajo',
            vuln: { min: 10, mode: 20, max: 45 },
        });
        expect(result.residualMoney).toBe('$10,000');
        expect(result.inherentMoney).toBe('$44,444');
        expect(result.controlEffectiveness).toBe('77.5%');
        expect(result.residualSeverity).toBe('bajo');
        // 44,444 <= 50,000 (20% de aleCritico=250000 → aleAceptable derivado) → bajo
        expect(result.inherentSeverity).toBe('bajo');
    });

    it('sin datos de Vulnerabilidad, no calcula el equivalente inherente (solo el residual)', () => {
        const result = FairRegister.computeFairRiskEquivalents({ ale: 10000, severity: 'bajo' });
        expect(result.residualMoney).toBe('$10,000');
        expect(result.inherentMoney).toBeNull();
        expect(result.inherentSeverity).toBeNull();
        expect(result.controlEffectiveness).toBeNull();
    });

    it('con un rango incompleto (falta min/max), tampoco calcula el equivalente inherente', () => {
        const result = FairRegister.computeFairRiskEquivalents({ ale: 10000, severity: 'bajo', vuln: { mode: 25 } });
        expect(result.inherentMoney).toBeNull();
        expect(result.controlEffectiveness).toBeNull();
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
        expect(list[0].riesgoResidual).toBe(3000);
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
