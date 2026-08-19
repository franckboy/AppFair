'use strict';

/**
 * REPORTE Y GUARDA de la tabla de referencia del sector.
 *
 * Por qué es un script y no un comentario en el JSON. De las 20 entradas, solo 6 se pueden usar
 * hoy: 10 están en cuarentena por tres motivos distintos (falta el denominador, falta el factor
 * de escala, o el dato está censurado) y 4 no son magnitudes sino evidencia sobre Transferir.
 * Una nota que diga "ojo, no uses estas" se ignora sola en cuanto alguien copia y pega. Esto en
 * cambio FALLA — sale con
 * código 1 — si una entrada en cuarentena queda marcada como usable, si un ratio no cierra, o si
 * una entrada apunta a un riesgo que el manifiesto no declara.
 *
 * No toca la app. No lee ni escribe en el backend. Es un archivo de datos con su verificador.
 *
 *   node tools/referencia-sector/reportar.js
 */

const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, 'referencia-sector.json');
const { bloque_referencia_sector: bloque } = JSON.parse(fs.readFileSync(RUTA, 'utf8'));

/** Los cinco arreglos que contienen entradas de dato (el manifiesto no es dato, es índice). */
const BUCKETS = [
    'anclas_magnitud',
    'tasas_por_viaje',
    'colas_referencia_sector',
    'cotas_censuradas',
    'ratios_recuperacion_seguro',
];

const entradas = (nombre) => bloque[nombre] || [];
const todas = () => BUCKETS.flatMap((b) => entradas(b).map((e) => ({ ...e, bucket: b })));

const usd = (x) => {
    if (x === null || x === undefined) return '—';
    if (x >= 1e9) return `$${(x / 1e9).toFixed(2)} mil M`;
    if (x >= 1e6) return `$${(x / 1e6).toFixed(1)} M`;
    return `$${Math.round(x / 1e3)} k`;
};
const pad = (s, n) => String(s).padEnd(n);

const problemas = [];

// ---------------------------------------------------------------------------------------------
// GUARDAS. Cada una existe porque su violación ya ocurrió una vez en alguna versión del bloque.
// ---------------------------------------------------------------------------------------------

// 1. Nada en cuarentena puede estar marcado usable, y nada usable puede tener requisitos abiertos.
const faltantes = new Set((bloque.faltantes_bloqueantes || []).map((f) => f.id));
todas().forEach((e) => {
    const requiere = e.requiere || [];
    if (e.usable === true && requiere.length > 0) {
        problemas.push(`${e.id}: marcada usable pero requiere ${requiere.join(', ')}.`);
    }
    requiere.forEach((r) => {
        // `motor_de_censura` es una capacidad del motor, no un dato que el usuario deba mandar,
        // así que no vive en faltantes_bloqueantes — pero sí tiene que ser un nombre conocido.
        if (!faltantes.has(r) && r !== 'motor_de_censura') {
            problemas.push(`${e.id}: requiere "${r}", que no está declarado en faltantes_bloqueantes.`);
        }
    });
});

// 2. Ninguna cota censurada puede haberse colado a las anclas de magnitud: es el error que sesga
//    el ajuste lognormal hacia abajo (tratar "al menos 500 M" como "exactamente 500 M").
entradas('anclas_magnitud').forEach((e) => {
    if (e.tipo_cota || e.censura) problemas.push(`${e.id}: entrada censurada dentro de anclas_magnitud.`);
    const m = e.magnitud_usd || {};
    if (typeof m.min !== 'number' || typeof m.mode !== 'number' || typeof m.max !== 'number') {
        problemas.push(`${e.id}: ancla de magnitud sin triángulo completo (min/mode/max).`);
    }
});

// 3. La tasa por viaje no puede componerse con p_denuncia. Se comprueba la aritmética que lo
//    prohíbe, no la intención: una tasa por viaje mayor que 1 es imposible por definición.
entradas('tasas_por_viaje').forEach((e) => {
    if (e.usable === true) problemas.push(`${e.id}: tasa por viaje activa sin denominador.`);
    const compuesta = e.tasa_por_viaje.mode / e.p_denuncia;
    if (compuesta > 0.2) {
        // No es un error del archivo: es la razón POR LA QUE p_denuncia está marcado metadato.
        // Se imprime como recordatorio, no como problema.
        e._aviso = `componer con p_denuncia daría ${compuesta.toFixed(2)} eventos por viaje`;
    }
});

// 4. Los ratios de recuperación tienen que cerrar contra sus montos, y `respondio` tiene que ser
//    coherente con el ratio: un ratio > 0 sin haber respondido es una contradicción.
entradas('ratios_recuperacion_seguro').forEach((e) => {
    if (typeof e.perdida_bruta_usd === 'number' && e.perdida_bruta_usd > 0) {
        const calc = e.recuperacion_usd / e.perdida_bruta_usd;
        if (Math.abs(calc - e.ratio_recuperacion) > 1e-9) {
            problemas.push(`${e.id}: ratio declarado ${e.ratio_recuperacion} pero los montos dan ${calc}.`);
        }
    }
    if (e.respondio === false && e.ratio_recuperacion > 0) {
        problemas.push(`${e.id}: declara que la póliza no respondió pero recuperó ${e.ratio_recuperacion}.`);
    }
});

// 5. Toda entrada tiene que apuntar a un riesgo del manifiesto, y todo riesgo del manifiesto
//    tiene que tener al menos una entrada. Es la guarda que habría cazado la colisión de R182.
const enManifiesto = new Set((bloque.manifiesto_riesgos || []).map((m) => m.riesgo));
const citados = new Set(todas().map((e) => e.riesgo));
[...citados]
    .filter((r) => !enManifiesto.has(r))
    .forEach((r) => problemas.push(`Riesgo ${r} citado pero ausente del manifiesto.`));
[...enManifiesto]
    .filter((r) => !citados.has(r))
    .forEach((r) => problemas.push(`Riesgo ${r} en el manifiesto pero sin ninguna entrada de dato.`));

// ---------------------------------------------------------------------------------------------
// REPORTE
// ---------------------------------------------------------------------------------------------

console.log(`\nTabla de referencia del sector — versión ${bloque.version}`);
console.log(`Origen: ${bloque.origen}   Z de credibilidad: ${bloque.Z_credibilidad}`);
console.log(`${bloque.nota_Z}\n`);

const usables = todas().filter((e) => e.usable === true);
const cuarentena = todas().filter((e) => e.usable === false);
const ratios = entradas('ratios_recuperacion_seguro');
console.log(
    `Entradas: ${todas().length} — usables ${usables.length}, en cuarentena ${cuarentena.length}, ratios de seguro ${ratios.length}`,
);

console.log('\n── Usables hoy (anclas de magnitud)');
usables.forEach((e) =>
    console.log(
        `   ${pad(e.id, 8)} ${pad(e.riesgo, 6)} ${pad(usd(e.magnitud_usd.mode), 10)} ${pad('[' + e.linaje + ']', 26)} ${e.fuente}`,
    ),
);

// Linajes repetidos: dos entradas que citan la misma fuente primaria no son dos confirmaciones.
const porLinaje = {};
usables.forEach((e) => (porLinaje[e.linaje] = (porLinaje[e.linaje] || []).concat(e.id)));
const repetidos = Object.entries(porLinaje).filter(([, ids]) => ids.length > 1);
if (repetidos.length) {
    console.log('\n   Linajes compartidos (NO cuentan como fuentes independientes):');
    repetidos.forEach(([l, ids]) => console.log(`     ${pad(l, 26)} ${ids.join(', ')}`));
}

console.log('\n── En cuarentena, por qué');
const porMotivo = {};
cuarentena.forEach((e) =>
    (e.requiere || ['(sin motivo declarado)']).forEach((r) => (porMotivo[r] = (porMotivo[r] || []).concat(e.id))),
);
Object.entries(porMotivo).forEach(([motivo, ids]) =>
    console.log(`   ${pad(motivo, 22)} ${ids.length} — ${ids.join(', ')}`),
);
entradas('tasas_por_viaje')
    .filter((e) => e._aviso)
    .forEach((e) => console.log(`   ${e.id}: ${e._aviso} — por eso p_denuncia es metadato.`));

console.log('\n── Recuperación de seguro, separada en los dos parámetros que de verdad son');
const respondieron = ratios.filter((e) => e.respondio);
console.log(`   ¿Respondió la póliza?  sí ${respondieron.length}, no ${ratios.length - respondieron.length}`);
console.log(
    `     → esto es FIABILIDAD (el nodo Bernoulli de Transferir): p observada ≈ ${(respondieron.length / ratios.length).toFixed(2)}`,
);
console.log('   De las que respondieron, cuánto pagaron:');
respondieron.forEach((e) =>
    console.log(`     ${pad(e.id, 6)} ${pad(e.ratio_recuperacion, 6)} ${e.cobertura.join(' + ')}`),
);
console.log('     → esto es ESTRUCTURA DE COBERTURA (deducible / límite / coaseguro), no fiabilidad.');

console.log('\n── Falta para levantar la cuarentena');
(bloque.faltantes_bloqueantes || []).forEach((f) => {
    console.log(`   ${pad(f.id, 22)} ${f.descripcion}`);
    console.log(`   ${pad('', 22)} desbloquea: ${f.desbloquea.join(', ')}`);
    console.log(`   ${pad('', 22)} ${f.impacto}\n`);
});

if (problemas.length) {
    console.error(`\n✗ ${problemas.length} problema(s):`);
    problemas.forEach((p) => console.error(`   - ${p}`));
    process.exit(1);
}
console.log('✓ Sin contradicciones: la cuarentena es coherente y los ratios cierran.\n');
