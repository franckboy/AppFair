import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state.js';
import { RiskCascadeTree } from './risk-cascade-tree.js';

describe('RiskCascadeTree.buildGraph', () => {
    beforeEach(() => {
        state.fair.riskRegister = [];
    });

    it('un riesgo sin triggeredBy (o vacío) es un nodo sin aristas entrantes', () => {
        const risk = { riskName: 'Pandemia', triggeredBy: [] };
        state.fair.riskRegister = [risk];
        const { nodes, edges } = RiskCascadeTree.buildGraph();
        expect(nodes).toEqual([{ id: 'Pandemia', risk, broken: [] }]);
        expect(edges).toEqual([]);
    });

    it('un riesgo cuya causa existe en el Registro genera una arista causa→riesgo', () => {
        const parent = { riskName: 'Pandemia', triggeredBy: [] };
        const child = { riskName: 'Interrupción Operativa', triggeredBy: [{ riskName: 'Pandemia', probability: 70 }] };
        state.fair.riskRegister = [parent, child];
        const { edges } = RiskCascadeTree.buildGraph();
        expect(edges).toEqual([{ source: 'Pandemia', target: 'Interrupción Operativa', probability: 70 }]);
    });

    it('una causa declarada hacia un riesgo que ya no existe (renombrado/eliminado) no genera arista, se anota en broken', () => {
        const orphan = {
            riskName: 'Riesgo Huerfano',
            triggeredBy: [{ riskName: 'Incendio Inexistente', probability: 50 }],
        };
        state.fair.riskRegister = [orphan];
        const { nodes, edges } = RiskCascadeTree.buildGraph();
        expect(edges).toEqual([]);
        expect(nodes.find((n) => n.id === 'Riesgo Huerfano').broken).toEqual(['Incendio Inexistente']);
    });

    it('un riesgo con DOS causas válidas genera DOS aristas — la razón de ser de este cambio', () => {
        const a = { riskName: 'Falla Eléctrica', triggeredBy: [] };
        const b = { riskName: 'Mal Almacenamiento', triggeredBy: [] };
        const c = {
            riskName: 'Incendio en Bodega',
            triggeredBy: [
                { riskName: 'Falla Eléctrica', probability: 30 },
                { riskName: 'Mal Almacenamiento', probability: 60 },
            ],
        };
        state.fair.riskRegister = [a, b, c];
        const { edges } = RiskCascadeTree.buildGraph();
        expect(edges).toEqual([
            { source: 'Falla Eléctrica', target: 'Incendio en Bodega', probability: 30 },
            { source: 'Mal Almacenamiento', target: 'Incendio en Bodega', probability: 60 },
        ]);
    });

    it('un riesgo con UNA causa válida y OTRA rota reporta ambas por separado (arista + broken)', () => {
        const a = { riskName: 'Causa Real', triggeredBy: [] };
        const b = {
            riskName: 'Hijo Mixto',
            triggeredBy: [
                { riskName: 'Causa Real', probability: 40 },
                { riskName: 'Causa Borrada', probability: 20 },
            ],
        };
        state.fair.riskRegister = [a, b];
        const { nodes, edges } = RiskCascadeTree.buildGraph();
        expect(edges).toEqual([{ source: 'Causa Real', target: 'Hijo Mixto', probability: 40 }]);
        expect(nodes.find((n) => n.id === 'Hijo Mixto').broken).toEqual(['Causa Borrada']);
    });

    it('un riesgo no puede ser su propia causa — se ignora silenciosamente, no genera arista ni broken', () => {
        const risk = { riskName: 'Auto Referencia', triggeredBy: [{ riskName: 'Auto Referencia', probability: 100 }] };
        state.fair.riskRegister = [risk];
        const { edges, nodes } = RiskCascadeTree.buildGraph();
        expect(edges).toEqual([]);
        expect(nodes[0].broken).toEqual([]);
    });
});

describe('RiskCascadeTree.collectReachable', () => {
    it('recorre todos los descendientes a partir de una lista de nombres de entrada', () => {
        const edges = [
            { source: 'A', target: 'B' },
            { source: 'B', target: 'C' },
        ];
        expect(RiskCascadeTree.collectReachable(['A'], edges)).toEqual(new Set(['A', 'B', 'C']));
    });

    // Regresión: un ciclo (Ciclo A desencadenado por Ciclo B, Ciclo B desencadenado por Ciclo
    // A) sin ninguna raíz externa no aparece recorriendo desde las raíces reales — por eso
    // render() lo vuelve a buscar por separado (ver cycleEntryRoots), tratando cada ciclo sin
    // raíz como su propio punto de entrada. Antes de ese paso, ambos riesgos desaparecían del
    // árbol en silencio.
    it('un ciclo sin ninguna raíz externa no es alcanzable desde otras raíces', () => {
        const edges = [
            { source: 'Ciclo B', target: 'Ciclo A' },
            { source: 'Ciclo A', target: 'Ciclo B' },
        ];
        expect(RiskCascadeTree.collectReachable(['Independiente'], edges)).toEqual(new Set(['Independiente']));
        expect(RiskCascadeTree.collectReachable(['Ciclo A'], edges)).toEqual(new Set(['Ciclo A', 'Ciclo B']));
    });

    // Multi-causa: un nodo con DOS padres es alcanzable recorriendo desde CUALQUIERA de los dos
    // — la razón real por la que openChangeTriggerModal necesita esto: al elegir un nuevo padre
    // para un riesgo, hay que excluir a TODOS sus descendientes sin importar por cuál de sus
    // (posiblemente varias) causas se llegue a ellos.
    it('un nodo con dos padres es alcanzable desde cualquiera de los dos', () => {
        const edges = [
            { source: 'Raiz', target: 'A' },
            { source: 'Raiz', target: 'B' },
            { source: 'A', target: 'C' },
            { source: 'B', target: 'C' },
        ];
        expect(RiskCascadeTree.collectReachable(['A'], edges)).toEqual(new Set(['A', 'C']));
        expect(RiskCascadeTree.collectReachable(['B'], edges)).toEqual(new Set(['B', 'C']));
        expect(RiskCascadeTree.collectReachable(['Raiz'], edges)).toEqual(new Set(['Raiz', 'A', 'B', 'C']));
    });
});
