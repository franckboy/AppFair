import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state.js';
import { AssetCatalog } from './asset-catalog.js';

describe('AssetCatalog.linkedRisksFor', () => {
    beforeEach(() => {
        state.fair.riskRegister = [];
        state.quick.history = [];
    });

    it('devuelve un arreglo vacío si ningún riesgo referencia el activo', () => {
        expect(AssetCatalog.linkedRisksFor('asset-1')).toEqual([]);
    });

    it('encuentra riesgos ya simulados en el Registro por assetId', () => {
        state.fair.riskRegister = [
            { riskName: 'Robo en bodega', assetId: 'asset-1' },
            { riskName: 'Incendio en planta', assetId: 'asset-2' },
        ];
        expect(AssetCatalog.linkedRisksFor('asset-1')).toEqual(['Robo en bodega']);
    });

    it('también encuentra borradores (Análisis Rápido/Paso 1) sin simular todavía, por fullData.assetId', () => {
        state.quick.history = [
            { name: 'Robo en bodega (borrador)', fullData: { assetId: 'asset-1' } },
            { name: 'Sin activo vinculado', fullData: { assetId: null } },
            { name: 'Sin fullData', fullData: undefined },
        ];
        expect(AssetCatalog.linkedRisksFor('asset-1')).toEqual(['Robo en bodega (borrador)']);
    });

    it('no repite un riesgo que ya está en el Registro aunque siga apareciendo en el historial de borradores', () => {
        state.fair.riskRegister = [{ riskName: 'Robo en bodega', assetId: 'asset-1' }];
        state.quick.history = [{ name: 'Robo en bodega', fullData: { assetId: 'asset-1' } }];
        expect(AssetCatalog.linkedRisksFor('asset-1')).toEqual(['Robo en bodega']);
    });

    it('junta riesgos del Registro y borradores distintos para el mismo activo', () => {
        state.fair.riskRegister = [{ riskName: 'Robo en bodega', assetId: 'asset-1' }];
        state.quick.history = [{ name: 'Incendio en la misma bodega', fullData: { assetId: 'asset-1' } }];
        expect(AssetCatalog.linkedRisksFor('asset-1')).toEqual(['Robo en bodega', 'Incendio en la misma bodega']);
    });
});
