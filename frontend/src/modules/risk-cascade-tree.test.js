import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state.js';
import { RiskCascadeTree } from './risk-cascade-tree.js';

describe('RiskCascadeTree.buildForest', () => {
    beforeEach(() => {
        state.fair.riskRegister = [];
    });

    it('un riesgo sin triggeredByRiskName es una raíz', () => {
        const risk = { riskName: 'Pandemia', triggeredByRiskName: null };
        state.fair.riskRegister = [risk];
        const { roots, childrenOf } = RiskCascadeTree.buildForest();
        expect(roots).toEqual([{ risk, orphan: false }]);
        expect(childrenOf.size).toBe(0);
    });

    it('un riesgo cuyo desencadenante existe en el Registro cuelga de él, no es raíz', () => {
        const parent = { riskName: 'Pandemia', triggeredByRiskName: null };
        const child = { riskName: 'Interrupción Operativa', triggeredByRiskName: 'Pandemia' };
        state.fair.riskRegister = [parent, child];
        const { roots, childrenOf } = RiskCascadeTree.buildForest();
        expect(roots).toEqual([{ risk: parent, orphan: false }]);
        expect(childrenOf.get('Pandemia')).toEqual([child]);
    });

    it('un vínculo hacia un riesgo que ya no existe en el Registro (renombrado/eliminado) se trata como raíz huérfana', () => {
        const orphan = { riskName: 'Riesgo Huerfano', triggeredByRiskName: 'Incendio Inexistente' };
        state.fair.riskRegister = [orphan];
        const { roots, childrenOf } = RiskCascadeTree.buildForest();
        expect(roots).toEqual([{ risk: orphan, orphan: true, orphanParentName: 'Incendio Inexistente' }]);
        expect(childrenOf.size).toBe(0);
    });
});

describe('RiskCascadeTree.collectReachable', () => {
    it('recorre todos los descendientes a partir de una lista de riesgos de entrada', () => {
        const a = { riskName: 'A' };
        const b = { riskName: 'B' };
        const c = { riskName: 'C' };
        const childrenOf = new Map([
            ['A', [b]],
            ['B', [c]],
        ]);
        expect(RiskCascadeTree.collectReachable([a], childrenOf)).toEqual(new Set(['A', 'B', 'C']));
    });

    // Regresión: un ciclo (Ciclo A desencadenado por Ciclo B, Ciclo B desencadenado por Ciclo
    // A) sin ninguna raíz externa no aparece recorriendo desde las raíces reales — por eso
    // render() lo vuelve a buscar por separado (ver cycleEntryRoots), tratando cada ciclo sin
    // raíz como su propio punto de entrada. Antes de ese paso, ambos riesgos desaparecían del
    // árbol en silencio.
    it('un ciclo sin ninguna raíz externa no es alcanzable desde otras raíces', () => {
        const a = { riskName: 'Ciclo A' };
        const b = { riskName: 'Ciclo B' };
        const other = { riskName: 'Independiente' };
        const childrenOf = new Map([
            ['Ciclo B', [a]],
            ['Ciclo A', [b]],
        ]);
        expect(RiskCascadeTree.collectReachable([other], childrenOf)).toEqual(new Set(['Independiente']));
        expect(RiskCascadeTree.collectReachable([a], childrenOf)).toEqual(new Set(['Ciclo A', 'Ciclo B']));
    });
});
