'use strict';

const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/asyncHandler');

/**
 * Historial unificado de riesgos — antes esto solo vivía en localStorage del navegador (el
 * Historial de Análisis Rápido), sin ningún registro en el backend hasta que un riesgo se
 * promovía a FAIR y corría una simulación. Eso significaba que un riesgo triageado pero nunca
 * llevado a FAIR no existía para el backend, y que el Historial no sobrevivía a limpiar el
 * navegador ni se veía desde otro dispositivo.
 *
 * Se identifica por 'id' (no por nombre) por la misma razón que el Catálogo de Activos: dos
 * riesgos legítimos pueden compartir nombre, y un upsert por nombre exacto puede pisar uno con
 * otro o crear duplicados fantasma. El body es flexible a propósito (no se valida cada campo
 * uno por uno) porque este historial va a seguir creciendo con datos de FAIR/simulación en
 * fases futuras del mismo esfuerzo (ver el resto de los campos que ya maneja /api/register).
 */
function createRisksRouter(store) {
    const router = express.Router();

    // GET /api/risks — lista el historial completo
    router.get(
        '/',
        asyncHandler(async (req, res) => {
            res.json({ risks: (await store.get('risks')) || [] });
        }),
    );

    // POST /api/risks — crea un riesgo nuevo. Body mínimo: { name }, el resto pasa tal cual.
    router.post(
        '/',
        asyncHandler(async (req, res) => {
            const { name, ...rest } = req.body;
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ error: 'name es requerido.' });
            }

            const entry = {
                id: crypto.randomUUID(),
                name: name.trim(),
                ...rest,
                createdAt: new Date().toISOString(),
            };

            const risks = await store.upsertRisk(entry);
            res.status(201).json({ entry, totalRisks: risks.length });
        }),
    );

    // PUT /api/risks/:id — actualiza un riesgo existente (mismo body flexible que POST).
    router.put(
        '/:id',
        asyncHandler(async (req, res) => {
            const risks = (await store.get('risks')) || [];
            const existing = risks.find((r) => r.id === req.params.id);
            if (!existing) {
                return res.status(404).json({ error: 'Riesgo no encontrado.' });
            }

            const { name, ...rest } = req.body;
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ error: 'name es requerido.' });
            }

            const entry = { ...existing, ...rest, name: name.trim(), updatedAt: new Date().toISOString() };
            const updated = await store.upsertRisk(entry);
            res.json({ entry, totalRisks: updated.length });
        }),
    );

    // DELETE /api/risks/:id — también borra en cascada cualquier entrada del Registro
    // vinculada a este riesgo (sourceRiskId === id), ver store.deleteRisk.
    router.delete(
        '/:id',
        asyncHandler(async (req, res) => {
            const risks = await store.deleteRisk(req.params.id);
            res.json({ totalRisks: risks.length });
        }),
    );

    return router;
}

module.exports = createRisksRouter;
