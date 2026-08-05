'use strict';

/**
 * Express 4 no reenvía automáticamente una promesa rechazada dentro de un handler async al
 * middleware de errores (eso es una mejora de Express 5) — sin este wrapper, un fallo de red
 * hacia Postgres (mucho más probable que un fallo leyendo un archivo local) dejaría la petición
 * colgada para siempre en vez de responder 500.
 */
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
