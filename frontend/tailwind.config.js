/** @type {import('tailwindcss').Config} */
module.exports = {
    // Los módulos de src/ arman HTML en plantillas de JavaScript (badges, filas de tablas,
    // cuerpos de modales), así que sus clases TIENEN que escanearse aquí. Sin esto, una clase
    // usada solo desde JS no se compila y el elemento sale sin estilo, en silencio — sin romper
    // nada, solo viéndose mal. Caso real que esto destapó: `.input-error` (el borde rojo de
    // validación, definido en tailwind-input.css) solo se aplica desde JS, así que nunca se
    // emitía y los errores del formulario no marcaban ningún campo. Las pruebas quedan fuera a
    // propósito: no las ve ningún usuario.
    content: ['./app_fair.html', './src/**/*.js'],
    theme: {
        extend: {},
    },
    plugins: [],
};
