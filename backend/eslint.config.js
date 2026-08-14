'use strict';

const prettierConfig = require('eslint-config-prettier');

// Backend: CommonJS + Node.js. no-undef es la regla que más vale la pena acá — detecta
// referencias a variables que no existen (typos, imports olvidados) antes de que lleguen a
// producción, sin depender de que las pruebas cubran esa línea exacta.
module.exports = [
    {
        files: ['**/*.js'],
        ignores: ['node_modules/**', 'coverage/**'],
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
                Buffer: 'readonly',
                setImmediate: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
        },
    },
    prettierConfig,
];
