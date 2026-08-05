'use strict';

const express = require('express');
const crypto = require('crypto');
const { isFiniteNumber } = require('../lib/validate');

/**
 * Catálogo de Activos — a diferencia de riskCatalog (curado en código, solo
 * lectura), esto es información propia de cada organización que cambia con
 * el tiempo, así que necesita CRUD real igual que el Registro de Riesgos.
 * Se identifica por 'id' (no por nombre, a propósito: dos activos legítimos
 * pueden compartir nombre — ej. "Bodega 3" en dos sucursales distintas — y
 * un upsert por nombre exacto, como el que ya tiene /api/register, puede
 * pisar uno con otro o crear duplicados fantasma si el nombre cambia).
 */
function createAssetsRouter(store) {
    const router = express.Router();

    // GET /api/assets — lista todos los activos registrados
    router.get('/', (req, res) => {
        res.json({ assets: store.get('assets') || [] });
    });

    /**
     * POST /api/assets — crea un activo nuevo.
     * Body esperado: { nombre, valorEstimado, categoria?, ubicacion?, notas? }
     */
    router.post('/', (req, res) => {
        const { nombre, valorEstimado, categoria = '', ubicacion = '', notas = '' } = req.body;

        if (typeof nombre !== 'string' || !nombre.trim()) {
            return res.status(400).json({ error: 'nombre es requerido.' });
        }
        if (!isFiniteNumber(valorEstimado) || valorEstimado < 0) {
            return res.status(400).json({ error: 'valorEstimado debe ser un número mayor o igual a 0.' });
        }

        const entry = {
            id: crypto.randomUUID(),
            nombre: nombre.trim(),
            valorEstimado,
            categoria,
            ubicacion,
            notas,
            date: new Date().toISOString(),
        };

        const assets = store.upsertAsset(entry);
        res.status(201).json({ entry, totalAssets: assets.length });
    });

    /**
     * PUT /api/assets/:id — actualiza un activo existente. Mismo body que POST.
     */
    router.put('/:id', (req, res) => {
        const assets = store.get('assets') || [];
        const existing = assets.find((a) => a.id === req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Activo no encontrado.' });
        }

        const { nombre, valorEstimado, categoria = '', ubicacion = '', notas = '' } = req.body;
        if (typeof nombre !== 'string' || !nombre.trim()) {
            return res.status(400).json({ error: 'nombre es requerido.' });
        }
        if (!isFiniteNumber(valorEstimado) || valorEstimado < 0) {
            return res.status(400).json({ error: 'valorEstimado debe ser un número mayor o igual a 0.' });
        }

        const entry = { ...existing, nombre: nombre.trim(), valorEstimado, categoria, ubicacion, notas };
        const updated = store.upsertAsset(entry);
        res.json({ entry, totalAssets: updated.length });
    });

    // DELETE /api/assets/:id
    router.delete('/:id', (req, res) => {
        const assets = store.deleteAsset(req.params.id);
        res.json({ totalAssets: assets.length });
    });

    return router;
}

module.exports = createAssetsRouter;
