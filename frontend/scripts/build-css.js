'use strict';

// Formaliza el paso manual de "compilar Tailwind y pegarlo en app_fair.html" (Fase 2 del plan
// de migración): corre la CLI de Tailwind sobre frontend/src/tailwind-input.css y reemplaza el
// contenido entre <style> y </style> en app_fair.html con el resultado. Un solo comando
// (`npm run build:css`) en vez de los 4 pasos manuales de antes.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FRONTEND_DIR = path.resolve(__dirname, '..');
const HTML_PATH = path.join(FRONTEND_DIR, 'app_fair.html');
const INPUT_CSS = path.join(FRONTEND_DIR, 'src', 'tailwind-input.css');
const TMP_OUTPUT = path.join(FRONTEND_DIR, '.tailwind-build-tmp.css');

execFileSync(
    process.execPath,
    [require.resolve('tailwindcss/lib/cli.js'), '-i', INPUT_CSS, '-o', TMP_OUTPUT, '--minify'],
    { cwd: FRONTEND_DIR, stdio: 'inherit' },
);

const compiledCss = fs.readFileSync(TMP_OUTPUT, 'utf8').trim();
fs.unlinkSync(TMP_OUTPUT);

const html = fs.readFileSync(HTML_PATH, 'utf8');
const openTag = '<style>\n';
const closeTag = '\n</style>';
const openIdx = html.indexOf(openTag);
const closeIdx = html.indexOf(closeTag, openIdx);

if (openIdx === -1 || closeIdx === -1) {
    console.error('No se encontró el bloque <style>...</style> en app_fair.html — revisa el formato esperado.');
    process.exit(1);
}

const before = html.slice(0, openIdx + openTag.length);
const after = html.slice(closeIdx);
const newHtml = before + compiledCss + after;

fs.writeFileSync(HTML_PATH, newHtml);
console.log(`CSS regenerado (${compiledCss.length} bytes) e insertado en ${path.relative(FRONTEND_DIR, HTML_PATH)}.`);
