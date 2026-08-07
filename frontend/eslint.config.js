'use strict';

const prettierConfig = require('eslint-config-prettier');

// no-undef es la regla que más vale la pena acá — ya demostró su valor durante la Fase 3a del
// plan de migración, donde atrapó dos referencias a variables sin importar que las pruebas E2E
// no habían disparado. Dos entornos distintos en este mismo paquete: src/** son ES modules de
// navegador (Vite los sirve tal cual), todo lo demás (configs, scripts, tests) es CommonJS de
// Node.
module.exports = [
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                FormData: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                Blob: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                prompt: 'readonly',
                Event: 'readonly',
                crypto: 'readonly',
                // Cargados por <script src> CDN en app_fair.html — globals reales del
                // navegador, no importados por ningún módulo.
                Chart: 'readonly',
                html2canvas: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },
    {
        files: ['*.js', 'scripts/**/*.js', 'playwright.config.js'],
        ignores: ['node_modules/**', 'dist/**'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                exports: 'writable',
                __dirname: 'readonly',
                __filename: 'readonly',
                process: 'readonly',
                console: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },
    {
        // tests/fixtures/*.js son copias textuales de paquetes npm publicados (Chart.js,
        // html2canvas), a propósito byte-por-byte iguales a la versión pineada en CDN — no se
        // lintean ni se formatean.
        files: ['tests/**/*.js'],
        ignores: ['tests/fixtures/**'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                exports: 'writable',
                __dirname: 'readonly',
                process: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                // Los specs de Playwright corren en Node, pero varios pasan funciones que se
                // ejecutan DENTRO del navegador (page.evaluate/addInitScript) — esos globals de
                // navegador son legítimos ahí, aunque el archivo en sí sea CommonJS/Node.
                window: 'readonly',
                document: 'readonly',
                fetch: 'readonly',
                localStorage: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },
    prettierConfig,
];
