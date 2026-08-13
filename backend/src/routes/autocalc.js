'use strict';

const express = require('express');
const { attackerProfiles, defenseProfiles, lossFormsKeys } = require('../data/profiles');
const {
    calculateProfileAverage,
    tullockSuccessProbability,
    attackerContestStrength,
    sampleVulnerabilityFromProfiles,
    summarizeVulnerabilitySamples,
    calculateLossMagnitudeRange,
    calculateReduccionALEFromProfiles,
    calculateResidualFromSimulation,
} = require('../lib/autocalc');
const { solveNashEquilibrium } = require('../lib/nashEquilibrium');
const { validatePositiveNumber, validateLossMagnitudes, validateTriangularRange } = require('../lib/validate');

function createAutocalcRouter() {
    const router = express.Router();

    // POST /api/autocalc/vulnerability { attackerKey, defenseKey, confidence }
    // Vulnerabilidad = P(Capacidad de Amenaza > Fuerza de Resistencia), simulada — ver
    // sampleVulnerabilityFromProfiles (backend/src/lib/autocalc.js). El atacante y la defensa
    // nunca se descuentan entre sí; cada uno viene solo de su propio perfil.
    router.post('/vulnerability', (req, res) => {
        const { attackerKey, defenseKey, confidence = 'medio' } = req.body;
        const attackerProfile = attackerProfiles[attackerKey];
        const defenseProfile = defenseProfiles[defenseKey];
        if (!attackerProfile || !defenseProfile) {
            return res.status(400).json({ error: 'attackerKey o defenseKey inválido.' });
        }
        const attackerScore = calculateProfileAverage(attackerProfile);
        const defenseScore = calculateProfileAverage(defenseProfile);
        const summary = summarizeVulnerabilitySamples(
            sampleVulnerabilityFromProfiles(attackerProfile, defenseProfile, confidence),
        );
        res.json({ ...summary, attackerScore, defenseScore });
    });

    // POST /api/autocalc/loss-magnitude { items: [{ key, mode }], confidence }
    router.post('/loss-magnitude', (req, res) => {
        const { items, confidence = 'medio' } = req.body;
        if (!Array.isArray(items))
            return res.status(400).json({ error: 'items debe ser un arreglo de { key, mode }.' });

        const result = {};
        items.forEach(({ key, mode }) => {
            result[key] = calculateLossMagnitudeRange(Number(mode) || 0, confidence);
        });
        res.json(result);
    });

    // POST /api/autocalc/reduccion-ale { attackerKey, currentDefenseKey, targetDefenseKey, confidence,
    //   currentALE, tef, lossMagnitudes }
    // attackerKey es obligatorio: con el modelo TCap vs. RS, la reducción real depende de CONTRA
    // QUIÉN se compara la defensa (ver calculateReduccionALEFromProfiles) — la vieja fórmula
    // cerrada solo dependía de los dos Niveles de Defensa porque era lineal; ya no lo es.
    //
    // currentALE/tef/lossMagnitudes son OPCIONALES: si los 3 vienen (y tef/lossMagnitudes son
    // válidos), reductionPercent se deriva de una re-simulación REAL con el Nivel de Defensa
    // Objetivo (ver calculateResidualFromSimulation) en vez de solo comparar la MODA de
    // Vulnerabilidad entre los dos escenarios — y la respuesta incluye residualALE/residualCVaR,
    // el resultado real de esa simulación (no una escala proporcional de un ALE/CVaR ya
    // conocido). Sin ellos, cae al camino de siempre (comparación por moda, sin residualALE/
    // residualCVaR) — retrocompatible con cualquier otro consumidor de esta ruta.
    router.post('/reduccion-ale', (req, res) => {
        const {
            attackerKey,
            currentDefenseKey,
            targetDefenseKey,
            confidence = 'medio',
            currentALE,
            tef,
            lossMagnitudes,
        } = req.body;
        const attackerProfile = attackerProfiles[attackerKey];
        const currentProfile = defenseProfiles[currentDefenseKey];
        const targetProfile = defenseProfiles[targetDefenseKey];
        if (!attackerProfile || !currentProfile || !targetProfile) {
            return res.status(400).json({ error: 'attackerKey, currentDefenseKey o targetDefenseKey inválido.' });
        }
        const currentScore = calculateProfileAverage(currentProfile);
        const targetScore = calculateProfileAverage(targetProfile);

        if (typeof currentALE === 'number' && tef && lossMagnitudes) {
            const tefError = validateTriangularRange(tef, 'tef');
            if (tefError) return res.status(400).json({ error: tefError });
            const lossMagnitudesError = validateLossMagnitudes(lossMagnitudes, lossFormsKeys);
            if (lossMagnitudesError) return res.status(400).json({ error: lossMagnitudesError });

            const { residualALE, residualCVaR, reductionPercent } = calculateResidualFromSimulation(
                attackerProfile,
                targetProfile,
                confidence,
                tef,
                lossMagnitudes,
                currentALE,
            );
            return res.json({ currentScore, targetScore, reductionPercent, residualALE, residualCVaR });
        }

        const { reductionPercent } = calculateReduccionALEFromProfiles(
            attackerProfile,
            currentProfile,
            targetProfile,
            confidence,
        );
        res.json({ currentScore, targetScore, reductionPercent, residualALE: null, residualCVaR: null });
    });

    // POST /api/autocalc/attacker-defense-summary { attackerKey, defenseKey }
    // Devuelve el Factor de Amenaza y Nivel de Defensa — usado para mostrar el resumen de
    // perfiles sin tener que duplicar la lógica en el front. Sin ningún diferencial (resta) entre
    // los dos: Vulnerabilidad no es una resta desde el modelo TCap vs. RS (ver
    // sampleVulnerabilityFromProfiles, lib/autocalc.js) — devolver esa resta invitaba a leerla
    // como si lo fuera.
    router.post('/attacker-defense-summary', (req, res) => {
        const { attackerKey, defenseKey } = req.body;
        const attackerProfile = attackerProfiles[attackerKey];
        const defenseProfile = defenseProfiles[defenseKey];
        if (!attackerProfile || !defenseProfile) {
            return res.status(400).json({ error: 'attackerKey o defenseKey inválido.' });
        }
        const attackerScore = calculateProfileAverage(attackerProfile);
        const defenseScore = calculateProfileAverage(defenseProfile);
        res.json({ attackerProfile, defenseProfile, attackerScore, defenseScore });
    });

    // POST /api/autocalc/nash-equilibrium { attackerKey, defenseKey, m, costAttacker, costDefense, lossMagnitudes }
    // Equilibrio de Nash del juego de contienda de Tullock (ver solveNashEquilibrium,
    // backend/src/lib/nashEquilibrium.js): en vez de asumir un esfuerzo fijo (los perfiles
    // curados), modela a Atacante y Defensa como jugadores racionales que ELIGEN cuánto esfuerzo
    // invertir, dado el Valor en Juego y su propio costo por unidad de esfuerzo. Independiente
    // del cálculo automático de Vulnerabilidad de arriba — es un análisis exploratorio "qué
    // pasaría si", nunca alimenta la simulación en vivo.
    router.post('/nash-equilibrium', (req, res) => {
        const { attackerKey, defenseKey, m = 1, costAttacker, costDefense, lossMagnitudes = {} } = req.body;
        const attackerProfile = attackerProfiles[attackerKey];
        const defenseProfile = defenseProfiles[defenseKey];
        if (!attackerProfile || !defenseProfile) {
            return res.status(400).json({ error: 'attackerKey o defenseKey inválido.' });
        }

        const mError = validatePositiveNumber(m, 'm');
        if (mError) return res.status(400).json({ error: mError });
        const costAttackerError = validatePositiveNumber(costAttacker, 'costAttacker');
        if (costAttackerError) return res.status(400).json({ error: costAttackerError });
        const costDefenseError = validatePositiveNumber(costDefense, 'costDefense');
        if (costDefenseError) return res.status(400).json({ error: costDefenseError });
        const lossMagnitudesError = validateLossMagnitudes(lossMagnitudes, lossFormsKeys);
        if (lossMagnitudesError) return res.status(400).json({ error: lossMagnitudesError });

        // Valor en Juego (V): suma del valor "Más Probable" de las 9 categorías de Magnitud de
        // Pérdida — no distingue qué parte de eso es realmente "el botín" que se llevaría el
        // atacante (ej. Multas y Daño Reputacional son pérdidas para la organización, no un
        // beneficio directo para él) — simplificación conocida, no resuelta aquí.
        const valueAtStake = Object.values(lossMagnitudes).reduce((sum, range) => sum + range.mode, 0);

        const attackerScore = calculateProfileAverage(attackerProfile);
        const defenseScore = calculateProfileAverage(defenseProfile);
        // Punto de comparación "esfuerzo fijo": los mismos perfiles de siempre, con el MISMO m
        // que el usuario eligió para esta corrida — para no mezclar dos `m` distintos (este y el
        // TULLOCK_M calibrado que usa la Vulnerabilidad del Paso 2) en la misma comparación.
        //
        // El Atacante SÍ pasa por el eje de contienda calibrado (attackerContestStrength), igual
        // que en el Paso 2: la escala semántica del perfil y la de la Defensa no son comparables
        // punto a punto, y compararlas crudas era un error que aquí quedaba escondido mientras
        // TULLOCK_M valía 1 y no existía el eje. Aun así este número NO tiene por qué coincidir
        // con el del Paso 2 — usa la `m` de este panel, no la calibrada — y la interfaz lo dice.
        const fixedEffortVulnerability =
            tullockSuccessProbability(attackerContestStrength(attackerScore), defenseScore, m) * 100;

        const equilibrium = solveNashEquilibrium({ m, valueAtStake, costAttacker, costDefense });

        res.json({
            attackerEffort: equilibrium.attackerEffort,
            defenseEffort: equilibrium.defenseEffort,
            equilibriumVulnerability: equilibrium.equilibriumVulnerability * 100,
            fixedEffortVulnerability,
            attackerScore,
            defenseScore,
            valueAtStake,
            attackerPayoff: equilibrium.attackerPayoff,
            defenseLoss: equilibrium.defenseLoss,
            converged: equilibrium.converged,
            iterations: equilibrium.iterations,
        });
    });

    return router;
}

module.exports = createAutocalcRouter;
