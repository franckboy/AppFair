// @ts-check
const { resolve } = require('path');
const { defineConfig } = require('vite');

// Fase 1 del plan de migración: Vite se usa solo como servidor de desarrollo y build local
// todavía. Producción sigue sirviendo `app_fair.html` tal cual desde `main` (GitHub Pages,
// "Deploy from a branch", sin build) — ver README.md, sección "Plan de migración". Por eso:
//   - el entry point se llama explícitamente `app_fair.html` (no se renombra a `index.html`),
//     para no romper la URL de producción el día que sí se decida servir el build.
//   - `base` queda en el valor por defecto ('/'): no hace falta fijar el subpath de GitHub
//     Pages porque este build no se despliega todavía.
module.exports = defineConfig({
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: resolve(__dirname, 'app_fair.html'),
        },
    },
});
