'use strict';

const express = require('express');
const { attackerProfiles, defenseProfiles } = require('../data/profiles');
const { calculateProfileAverage, calculateVulnerability, calculateLossMagnitudeRange, calculateReduccionALE } = require('../lib/autocalc');

function createAutocalcRouter() {
    const router = express.Router();

    // POST /api/autocalc/vulnerability { attackerKey, defenseKey, confidence }
    router.post('/vulnerability', (req, res) => {
        const { attackerKey, defenseKey, confidence = 'medio' } = req.body;
        const attackerProfile = attackerProfiles[attackerKey];
        const defenseProfile = defenseProfiles[defenseKey];
        if (!attackerProfile || !defenseProfile) {
            return res.status(400).json({ error: 'attackerKey o defenseKey inválido.' });
        }
        const attackerScore = calculateProfileAverage(attackerProfile);
        const defenseScore = calculateProfileAverage(defenseProfile);
        const result = calculateVulnerability(attackerScore, defenseScore, confidence);
        res.json(result);
    });

    // POST /api/autocalc/loss-magnitude { items: [{ key, mode }], confidence }
    router.post('/loss-magnitude', (req, res) => {
        const { items, confidence = 'medio' } = req.body;
        if (!Array.isArray(items)) return res.status(400).json({ error: 'items debe ser un arreglo de { key, mode }.' });

        const result = {};
        items.forEach(({ key, mode }) => {
            result[key] = calculateLossMagnitudeRange(Number(mode) || 0, confidence);
        });
        res.json(result);
    });

    // POST /api/autocalc/reduccion-ale { currentDefenseKey, targetDefenseKey }
    router.post('/reduccion-ale', (req, res) => {
        const { currentDefenseKey, targetDefenseKey } = req.body;
        const currentProfile = defenseProfiles[currentDefenseKey];
        const targetProfile = defenseProfiles[targetDefenseKey];
        if (!currentProfile || !targetProfile) {
            return res.status(400).json({ error: 'currentDefenseKey o targetDefenseKey inválido.' });
        }
        const currentScore = calculateProfileAverage(currentProfile);
        const targetScore = calculateProfileAverage(targetProfile);
        const reductionPercent = calculateReduccionALE(currentScore, targetScore);
        res.json({ currentScore, targetScore, reductionPercent });
    });

    // POST /api/autocalc/attacker-defense-summary { attackerKey, defenseKey }
    // Devuelve el Factor de Amenaza, Nivel de Defensa y su diferencial — usado
    // para mostrar el resumen de perfiles sin tener que duplicar la lógica en el front.
    router.post('/attacker-defense-summary', (req, res) => {
        const { attackerKey, defenseKey } = req.body;
        const attackerProfile = attackerProfiles[attackerKey];
        const defenseProfile = defenseProfiles[defenseKey];
        if (!attackerProfile || !defenseProfile) {
            return res.status(400).json({ error: 'attackerKey o defenseKey inválido.' });
        }
        const attackerScore = calculateProfileAverage(attackerProfile);
        const defenseScore = calculateProfileAverage(defenseProfile);
        res.json({
            attackerProfile, defenseProfile, attackerScore, defenseScore,
            differential: attackerScore - defenseScore,
        });
    });

    return router;
}

module.exports = createAutocalcRouter;
