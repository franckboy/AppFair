'use strict';

/**
 * Catálogo curado de normas/marcos citados en la app — nombre + una descripción corta escrita
 * EN PALABRAS PROPIAS de qué trata cada uno, nunca el texto oficial de la norma. Los estándares
 * de aquí (ISO, NFPA, RIMS, etc.) tienen derechos de autor — reproducir su contenido real no es
 * legal sin licencia; lo que sí es una práctica normal (y lo que hace este archivo) es citar el
 * nombre/número y resumir en una frase para qué sirve, igual que cualquier software de GRC.
 *
 * Pensado como la BASE para mostrar, en la ficha de un riesgo, contra qué norma/punto del
 * proceso de gestión de riesgos se sustenta ese riesgo — todavía sin conectar a ninguna tarjeta
 * (ver la conversación de esta sesión): primero se arma el catálogo, la conexión a las tarjetas
 * queda para después.
 */

// hazardStandards: las normas que ya cita riskCatalog (ver profiles.js) en el campo `standard`
// de cada amenaza — ese campo puede traer varias separadas por ", " (ej. "ASIS, ISO 27001 Anexo
// A (Seguridad Física)"); cada token, tal cual aparece ahí, coincide EXACTO con una clave de
// aquí (verificado por un test — ver test/lib.test.js — que ningún `standard` del catálogo
// quede sin su referencia).
const hazardStandards = {
    ASIS: {
        name: 'ASIS International',
        description:
            'Asociación profesional de gestión de seguridad; publica guías y estándares de referencia para seguridad física, gestión de riesgo de cadena de suministro y continuidad de negocio.',
    },
    'C-TPAT': {
        name: 'Customs-Trade Partnership Against Terrorism',
        description:
            'Programa voluntario de la aduana de EE.UU. (CBP) que certifica buenas prácticas de seguridad en la cadena de suministro a cambio de agilizar el paso fronterizo.',
    },
    'C-TPAT (Ciberseguridad)': {
        name: 'C-TPAT — Criterios de Ciberseguridad',
        description:
            'Requisitos mínimos de ciberseguridad dentro del programa C-TPAT: protección de sistemas, control de accesos digitales y gestión de incidentes en la cadena de suministro.',
    },
    COSO: {
        name: 'COSO (Committee of Sponsoring Organizations)',
        description:
            'Marco de gestión de riesgo empresarial (ERM) y control interno, ampliamente usado como referencia de gobierno corporativo.',
    },
    'IEC 60839': {
        name: 'IEC 60839',
        description: 'Norma internacional para sistemas de alarma y electrónica de seguridad (detección de intrusión, control de acceso).',
    },
    'IEC 62676': {
        name: 'IEC 62676',
        description: 'Norma internacional para sistemas de videovigilancia (CCTV) usados en aplicaciones de seguridad.',
    },
    'ISO 14001': {
        name: 'ISO 14001',
        description: 'Sistema de gestión ambiental — requisitos para identificar y controlar el impacto ambiental de una organización.',
    },
    'ISO 17712': {
        name: 'ISO 17712',
        description: 'Norma para sellos de seguridad mecánicos usados en contenedores de carga, parte de la cadena de custodia en transporte.',
    },
    'ISO 22000': {
        name: 'ISO 22000',
        description: 'Sistema de gestión de inocuidad alimentaria a lo largo de toda la cadena de suministro.',
    },
    'ISO 22301': {
        name: 'ISO 22301',
        description: 'Sistema de gestión de continuidad de negocio — cómo una organización se prepara, responde y se recupera de una interrupción.',
    },
    'ISO 27001 Anexo A (Seguridad Física)': {
        name: 'ISO 27001 — Anexo A (Seguridad Física)',
        description: 'Controles de seguridad física y ambiental del anexo de controles de ISO 27001: perímetro, acceso a instalaciones y protección de equipos.',
    },
    'ISO 28000': {
        name: 'ISO 28000',
        description: 'Sistema de gestión de seguridad para la cadena de suministro.',
    },
    'ISO 31000': {
        name: 'ISO 31000',
        description: 'Marco y directrices genéricas de gestión del riesgo, aplicable a cualquier tipo de organización y de riesgo — el estándar base de toda esta app.',
    },
    'ISO 37001': {
        name: 'ISO 37001',
        description: 'Sistema de gestión antisoborno.',
    },
    'ISO 37301': {
        name: 'ISO 37301',
        description: 'Sistema de gestión de cumplimiento normativo (compliance).',
    },
    'ISO 45001': {
        name: 'ISO 45001',
        description: 'Sistema de gestión de seguridad y salud en el trabajo.',
    },
    'ISO 55001': {
        name: 'ISO 55001',
        description: 'Sistema de gestión de activos físicos.',
    },
    'ISO 9001': {
        name: 'ISO 9001',
        description: 'Sistema de gestión de calidad.',
    },
    NFPA: {
        name: 'NFPA (National Fire Protection Association)',
        description: 'Organización que publica códigos y normas de prevención de incendios y de los riesgos relacionados.',
    },
    'NFPA 101': {
        name: 'NFPA 101 — Código de Seguridad Humana',
        description: 'Requisitos de salidas de emergencia y protección de vida en edificaciones.',
    },
    'NFPA 110': {
        name: 'NFPA 110',
        description: 'Normas para sistemas de energía de emergencia y respaldo (generadores).',
    },
    'NFPA 1144': {
        name: 'NFPA 1144',
        description: 'Norma para reducir el riesgo de incendio estructural por exposición a incendios de vegetación/forestales.',
    },
    'NFPA 13': {
        name: 'NFPA 13',
        description: 'Norma para el diseño e instalación de sistemas de rociadores automáticos contra incendio.',
    },
    'NFPA 1600': {
        name: 'NFPA 1600',
        description: 'Norma para programas de gestión de continuidad, emergencias y manejo de desastres.',
    },
    'NFPA 20': {
        name: 'NFPA 20',
        description: 'Norma para bombas estacionarias de protección contra incendios.',
    },
    'NFPA 2001': {
        name: 'NFPA 2001',
        description: 'Norma para sistemas de extinción de incendios con agentes limpios (gases, sin agua).',
    },
    'NFPA 25': {
        name: 'NFPA 25',
        description: 'Norma para inspección, prueba y mantenimiento de sistemas de protección contra incendios a base de agua.',
    },
    'NFPA 51B': {
        name: 'NFPA 51B',
        description: 'Norma para prevención de incendios durante trabajos en caliente (soldadura, corte).',
    },
    'NFPA 70': {
        name: 'NFPA 70 — Código Eléctrico Nacional',
        description: 'Instalación segura de sistemas eléctricos.',
    },
    'NFPA 72': {
        name: 'NFPA 72',
        description: 'Código Nacional de Alarmas de Incendio y Señalización.',
    },
    'NFPA 730': {
        name: 'NFPA 730',
        description: 'Guía de prácticas de seguridad física de instalaciones.',
    },
    'NFPA 780': {
        name: 'NFPA 780',
        description: 'Norma para sistemas de protección contra rayos (pararrayos).',
    },
    'NFPA 921': {
        name: 'NFPA 921',
        description: 'Guía para investigación de incendios y explosiones.',
    },
    OEA: {
        name: 'Operador Económico Autorizado (OEA)',
        description: 'Certificación aduanera (equivalente latinoamericano de C-TPAT) que reconoce buenas prácticas de seguridad en el comercio exterior.',
    },
    'OEA (Marco SAFE de la OMA)': {
        name: 'OEA — Marco SAFE (Organización Mundial de Aduanas)',
        description: 'El programa OEA basado en el Marco Normativo SAFE de la OMA, para asegurar y facilitar el comercio internacional.',
    },
    'UL 294': {
        name: 'UL 294',
        description: 'Norma de Underwriters Laboratories para sistemas de control de acceso.',
    },
    'UL 325': {
        name: 'UL 325',
        description: 'Norma de UL para puertas y portones motorizados (dispositivos de seguridad anti-atrapamiento).',
    },
    'UL 827': {
        name: 'UL 827',
        description: 'Norma de UL para estaciones centrales de monitoreo de sistemas de alarma.',
    },
};

// isoProcessClauses: la cláusula 6 ("Proceso") de ISO 31000:2018 — en qué parte del proceso de
// gestión de riesgos encaja cada funcionalidad de la app. Los números ya se usaban sueltos en
// comentarios por todo el código (ver config.js, treatment.js, fair-wizard.js, risk-management.js,
// state.js) — este archivo los centraliza por primera vez para poder mostrárselos al usuario.
const isoProcessClauses = {
    '6.2': {
        title: 'Comunicación y consulta',
        summary: 'Involucrar a las partes interesadas durante todo el proceso, para que sus perspectivas informen la gestión del riesgo.',
    },
    '6.3.4': {
        title: 'Definición de criterios de riesgo',
        summary: 'Declarar, antes de evaluar cualquier riesgo, cuánta pérdida es aceptable para la organización (Apetito de Riesgo) y contra qué umbrales se va a clasificar — ver Criterios de Riesgo.',
    },
    '6.4.2': {
        title: 'Identificación del riesgo',
        summary: 'Reconocer y describir el riesgo: qué podría pasar, a qué activo, por qué agente de amenaza.',
    },
    '6.4.3': {
        title: 'Análisis del riesgo',
        summary: 'Entender el riesgo en profundidad: estimar su frecuencia y el impacto que tendría si ocurre.',
    },
    '6.4.4': {
        title: 'Evaluación del riesgo',
        summary: 'Comparar el resultado del análisis contra los criterios de riesgo declarados, para decidir si requiere tratamiento y con qué prioridad.',
    },
    '6.5': {
        title: 'Tratamiento del riesgo',
        summary: 'Seleccionar e implementar opciones para modificar el riesgo: Mitigar, Transferir, Evitar o Aceptar.',
    },
    '6.6': {
        title: 'Monitoreo y revisión',
        summary: 'Volver a revisar el riesgo con el tiempo, para confirmar que el análisis sigue vigente o detectar que cambió.',
    },
    '6.7': {
        title: 'Registro e informe',
        summary: 'Documentar el proceso y sus resultados, para trazabilidad y para reportar a quien corresponda.',
    },
};

// rimsClauses: el otro marco de proceso que ya cita la app (RIMS Risk Maturity Model / RA.1-2015),
// para Contexto Organizacional, Análisis de Sensibilidad y Registro de Riesgos.
const rimsClauses = {
    '5.2': {
        title: 'Entender la organización y su contexto',
        summary: 'Conocer la misión, objetivos y naturaleza del negocio antes de apreciar sus riesgos — ver Contexto Organizacional.',
    },
    '6.3.4.3': {
        title: 'Análisis de sensibilidad',
        summary: 'Identificar qué variables de entrada influyen más en el resultado simulado, para saber dónde vale la pena mejorar la calidad del dato.',
    },
    '6.4.4.3': {
        title: 'Registro de riesgos',
        summary: 'Mantener un registro consolidado de todos los riesgos ya analizados, con su evaluación y tratamiento.',
    },
};

module.exports = { hazardStandards, isoProcessClauses, rimsClauses };
