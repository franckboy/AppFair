'use strict';

const crypto = require('crypto');

/**
 * Compara dos strings en tiempo constante (ni más rápido ni más lento según cuántos
 * caracteres iniciales coincidan) — usa crypto.timingSafeEqual, que exige buffers del MISMO
 * largo o revienta con RangeError. El chequeo de largo de abajo es seguro hacerlo con `!==`
 * normal: el LARGO de la key correcta no es el secreto que hay que proteger (es trivial de
 * adivinar por fuerza bruta igual), solo su contenido — comparar el contenido siempre en el
 * mismo tiempo es lo que evita que alguien deduzca la key caracter por caracter midiendo
 * cuánto tarda cada intento en fallar.
 */
function timingSafeEqualStrings(a, b) {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Autenticación mínima por API key (header `X-API-Key`). Sin esto, cualquier
 * origen que pudiera alcanzar el servidor (CORS está abierto) podía leer y
 * escribir los Criterios de Riesgo, el Contexto Organizacional y el Registro
 * de Riesgos sin ninguna credencial — ver README para más contexto.
 *
 * No pretende ser un sistema de auth completo (no hay usuarios, roles ni
 * expiración) — es la barrera mínima para que la API deje de estar
 * completamente abierta. Para multiusuario real, reemplázalo por JWT/OAuth.
 *
 * @param {string} expectedKey
 * @returns {import('express').RequestHandler}
 */
function createApiKeyAuth(expectedKey) {
    return function apiKeyAuth(req, res, next) {
        const provided = req.header('x-api-key');
        if (!provided || !timingSafeEqualStrings(provided, expectedKey)) {
            return res.status(401).json({ error: 'API key inválida o faltante. Manda el header X-API-Key.' });
        }
        next();
    };
}

module.exports = { createApiKeyAuth, timingSafeEqualStrings };
