'use strict';

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
        if (!provided || provided !== expectedKey) {
            return res.status(401).json({ error: 'API key inválida o faltante. Manda el header X-API-Key.' });
        }
        next();
    };
}

module.exports = { createApiKeyAuth };
