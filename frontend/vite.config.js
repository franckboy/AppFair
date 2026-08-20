// @ts-check
const { resolve } = require('path');
const { defineConfig } = require('vite');

/** Subpath de GitHub Pages: el sitio vive en https://franckboy.github.io/AppFair/, no en la raíz. */
const GITHUB_PAGES_BASE = '/AppFair/';

// Producción SÍ sirve este build desde GitHub Pages (ver .github/workflows/deploy-pages.yml).
// Antes se publicaba el repositorio entero desde `main` con "Deploy from a branch", así que la app
// se cargaba como árbol de módulos sin compilar y el backend, las pruebas y los docs quedaban
// accesibles por web. Ahora se publica solo `dist/`.
//
// El entry point se sigue llamando `app_fair.html` (no se renombra a `index.html`): es la URL que
// el README documenta y la que puede estar en un marcador. `public/index.html` y
// `public/frontend/app_fair.html` son redirecciones que cubren la raíz y la URL vieja.
module.exports = defineConfig(({ command }) => ({
    // `base` SOLO en el build. Fijarlo también en desarrollo movería el servidor de `vite` a
    // /AppFair/ y rompería las 91 pruebas E2E, que navegan a `/app_fair.html` en la raíz.
    base: command === 'build' ? GITHUB_PAGES_BASE : '/',
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: resolve(__dirname, 'app_fair.html'),
        },
    },
    // Vitest (pruebas unitarias de lógica pura, co-ubicadas con el código que prueban —
    // *.test.js dentro de src/modules/, para no chocar con los specs de Playwright en tests/,
    // que usan la extensión *.spec.js). jsdom porque algunas funciones puras (ej. sanitizeHTML)
    // usan `document`, aunque no manipulan una página real.
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.js'],
    },
}));
