'use strict';

// Perfiles de Atacante: Motivación, Recursos, Capacidad, Persistencia y
// Sofisticación (0-100%). El promedio de estos 5 valores es el "Factor de
// Amenaza" (FA) que usa el motor de Vulnerabilidad.
const attackerProfiles = {
    'oportunista': { name: 'Intruso Oportunista', motivation: 30, resources: 10, capacity: 20, persistence: 20, sophistication: 10 },
    // Vandalismo/Hurtos Comunes es oportunista por definición: se va a un blanco más fácil en
    // cuanto encuentra resistencia — su Persistencia debe ser BAJA, no la más alta de los 5
    // perfiles (como quedaba con persistence=60, incluso por encima del Crimen Organizado).
    // Motivación también se baja de 70 a 55: sigue siendo notable (impulso, presión de grupo,
    // ganancia rápida) pero ya no supera a un actor premeditado como el Crimen Organizado.
    'vandalismo': { name: 'Vandalismo / Hurtos Comunes', motivation: 55, resources: 40, capacity: 50, persistence: 30, sophistication: 40 },
    'empleado-desleal': { name: 'Empleado Desleal', motivation: 80, resources: 60, capacity: 70, persistence: 70, sophistication: 60 },
    // Sesgo real encontrado: con persistence=40, el Crimen Organizado quedaba MENOS persistente
    // que el Vandalismo (60) — invertido respecto a la realidad de seguridad patrimonial, donde
    // un grupo organizado (robo de mercancía, bandas de asalto a instalaciones) case el objetivo,
    // reintenta y se adapta, a diferencia de un vándalo oportunista que se retira al primer
    // obstáculo. Se sube Persistencia a 65 y Motivación a 65 (ganancia deliberada, no impulsiva)
    // para que quede, correctamente, por encima de Vandalismo en ambas dimensiones.
    'organizado': { name: 'Grupo Criminal Organizado', motivation: 65, resources: 60, capacity: 60, persistence: 65, sophistication: 50 },
    'estado-nacion': { name: 'Terrorista o Espía', motivation: 90, resources: 90, capacity: 90, persistence: 90, sophistication: 90 },
};

// Perfiles de Defensa: Adaptabilidad, Respuesta, Prevención, Detección,
// Contención y Recuperación (0-100%). El promedio es el "Nivel de Defensa" (ENC).
const defenseProfiles = {
    'basica': { name: 'Básica', adaptability: 20, response: 30, prevention: 30, detection: 30, containment: 20, recovery: 30 },
    'estandar': { name: 'Estándar', adaptability: 50, response: 50, prevention: 60, detection: 60, containment: 50, recovery: 60 },
    'avanzada': { name: 'Avanzada', adaptability: 70, response: 70, prevention: 75, detection: 80, containment: 70, recovery: 75 },
    'elite': { name: 'Defensa Élite', adaptability: 90, response: 90, prevention: 90, detection: 95, containment: 90, recovery: 90 },
};

// Perfiles de riesgo (Análisis Rápido): factores de vulnerabilidad e impacto
// ponderado por tipo de riesgo. La app calcula únicamente riesgos de
// Seguridad Física y Patrimonial — no hay perfil de Ciberseguridad.
const riskProfiles = {
    'seguridad-fisica': {
        name: 'Seguridad Física y Patrimonial',
        vulnerabilityFactors: ['Infraestructura Física', 'Controles de Acceso', 'Vigilancia', 'Personal de Seguridad', 'Procedimientos de Emergencia'],
        impactFactors: {
            'Impacto Financiero Directo (Pérdida Material)': 40, 'Impacto Operacional y de Continuidad': 25, 'Impacto Humano y Psicológico': 15,
            'Impacto Legal, Normativo y de Cumplimiento': 10, 'Impacto Reputacional (Interno y Externo)': 10,
        },
    },
};

// Categorías de Magnitud de Pérdida (FAIR), en el orden en que se muestran.
const lossFormsKeys = ['productividad', 'respuesta', 'reemplazo', 'multas', 'reputacion', 'investigacion', 'oportunidad', 'comunitario', 'ambiental'];
const lossFormsLabels = {
    productividad: 'Pérdida de Productividad',
    respuesta: 'Costos de Respuesta',
    reemplazo: 'Costos de Reemplazo',
    multas: 'Multas y Sanciones',
    reputacion: 'Daño Reputacional',
    investigacion: 'Costos de Investigación',
    // Nombrada así (no "Pérdida de Oportunidad") a propósito: esta clave ('oportunidad') es una
    // de las 9 categorías de Magnitud de Pérdida — el costo de negocio no capturado durante el
    // evento (FAIR: "Competitive Advantage" loss) — y coincide, sin relación alguna, con el
    // valor riskType='oportunidad' (un riesgo POSITIVO completo, ver evaluation.js). Llamar a
    // esta categoría "Pérdida de Oportunidad" leía como si un riesgo tipo Oportunidad tuviera
    // que capturar cuánta "pérdida de oportunidad" sufre, una contradicción de términos.
    oportunidad: 'Negocio No Capturado (Ventaja Competitiva)',
    comunitario: 'Impacto Comunitario/Societario',
    ambiental: 'Impacto Ambiental',
};

// Catálogo de Riesgos (Análisis Rápido): lista curada, de solo lectura, en 3 niveles —
// Dominio → Categoría → Amenaza Específica — más una "standard" (referencia normativa) por
// amenaza, para llenar "Nombre del Riesgo" eligiendo en vez de escribir a mano. ISO 31000 es
// un estándar de PROCESO, no publica una lista enumerada de riesgos — de ahí se toma solo la
// lógica de categorización (riesgos de peligro/naturales vs. operacionales). El contenido
// concreto sigue la estructura de ASIS International General Security Risk Assessment
// Guideline (categorías de Dominio/Categoría), y normas específicas por amenaza cuando aplica
// (NFPA para incendio/explosivos, ISO 28000 y TAPA FSR/TSR y C-TPAT para cadena de suministro,
// COSO ERM para fraude). No es transcripción textual de ningún estándar con derechos de autor
// — es un catálogo inicial razonable, ampliable con el tiempo, que solo debe crecer con
// riesgos que correspondan a una categoría reconocida como esta (así lo pidió el usuario). Se
// excluye todo lo específico de ciberseguridad — coherente con el alcance de la app (ver
// riskProfiles arriba) — salvo, puntualmente, el dominio de "Seguridad Física y Ambiental" de
// ISO 27001 Anexo A (perímetro/acceso físico), que es física, no cyber.
const riskCatalog = {
    'natural': {
        label: 'Natural',
        categories: {
            'hidrometeorologico': {
                label: 'Hidrometeorológico',
                threats: [
                    { key: 'inundacion', name: 'Inundación', standard: 'ASIS GSRA, NFPA 1600', description: 'Entrada de agua por lluvia, desbordamiento de cuerpos de agua o falla de drenaje que daña instalaciones, inventario o equipo.' },
                    { key: 'huracan-tormenta', name: 'Huracán / Ciclón / Tormenta Severa', standard: 'ASIS GSRA, NFPA 1600', description: 'Viento extremo, lluvia intensa o granizo que daña estructuras, techos, vehículos o interrumpe operaciones.' },
                ],
            },
            'geologico': {
                label: 'Geológico',
                threats: [
                    { key: 'sismo', name: 'Sismo / Terremoto', standard: 'ASIS GSRA, NFPA 1600', description: 'Movimiento telúrico que puede causar daño estructural, interrupción operativa y riesgo a la vida humana.' },
                    { key: 'deslizamiento-tierra', name: 'Deslizamiento de Tierra', standard: 'ASIS GSRA', description: 'Movimiento de suelo o roca que puede dañar instalaciones, vías de acceso o infraestructura crítica.' },
                ],
            },
            'incendio-natural': {
                label: 'Incendio Natural',
                threats: [
                    { key: 'incendio-forestal', name: 'Incendio Forestal', standard: 'ASIS GSRA, NFPA 1144', description: 'Fuego de origen natural o ambiental que se propaga hacia instalaciones o terrenos de la organización.' },
                ],
            },
            'sanitario': {
                label: 'Sanitario',
                threats: [
                    { key: 'pandemia', name: 'Pandemia / Emergencia Sanitaria', standard: 'ISO 31000, NFPA 1600', description: 'Brote de enfermedad que reduce disponibilidad de personal y puede forzar cierre parcial o total de operaciones.' },
                ],
            },
        },
    },
    'humano-intencional': {
        label: 'Humano — Intencional',
        categories: {
            'robo': {
                label: 'Robo',
                threats: [
                    { key: 'robo-interno', name: 'Robo Interno (Hurto por Personal)', standard: 'ASIS GSRA, ISO 31000', description: 'Sustracción de bienes o valores por parte de personal con acceso legítimo a las instalaciones.' },
                    { key: 'robo-externo', name: 'Robo Externo (Intrusión)', standard: 'ASIS GSRA', description: 'Sustracción de bienes o valores mediante ingreso no autorizado de terceros ajenos a la organización.' },
                    { key: 'robo-mano-armada', name: 'Robo a Mano Armada', standard: 'ASIS GSRA', description: 'Sustracción de bienes o valores mediante violencia o amenaza con arma contra personal o instalaciones.' },
                    { key: 'robo-vehiculo', name: 'Robo de Vehículo', standard: 'ASIS GSRA', description: 'Sustracción de un vehículo de la organización, propio o de un tercero, dentro o fuera de sus instalaciones.' },
                    { key: 'robo-carga-transito', name: 'Robo de Carga en Tránsito', standard: 'ISO 28000, TAPA FSR/TSR', description: 'Sustracción de mercancía durante su transporte entre origen y destino.' },
                ],
            },
            'fraude': {
                label: 'Fraude',
                threats: [
                    { key: 'fraude-financiero', name: 'Fraude Financiero / Malversación', standard: 'ISO 31000, COSO ERM', description: 'Uso indebido deliberado de activos o recursos financieros por parte de personal con acceso legítimo.' },
                    { key: 'fraude-documental', name: 'Fraude Documental', standard: 'ISO 31000', description: 'Falsificación o alteración de documentos (facturas, contratos, registros) con fines de engaño o beneficio indebido.' },
                ],
            },
            'violencia': {
                label: 'Violencia / Actos Contra las Personas',
                threats: [
                    { key: 'secuestro-extorsion', name: 'Secuestro / Extorsión', standard: 'ASIS GSRA', description: 'Privación de la libertad o amenaza contra personal, o exigencia de pago bajo amenaza.' },
                    { key: 'violencia-laboral', name: 'Violencia en el Lugar de Trabajo', standard: 'ASIS GSRA', description: 'Agresión física o amenaza entre personal, o de terceros contra personal, dentro de las instalaciones.' },
                ],
            },
            'sabotaje-destruccion': {
                label: 'Sabotaje y Destrucción Deliberada',
                threats: [
                    { key: 'sabotaje', name: 'Sabotaje', standard: 'ASIS GSRA, ISO 31000', description: 'Daño intencional a procesos, equipo o infraestructura para interrumpir operaciones.' },
                    { key: 'vandalismo', name: 'Vandalismo', standard: 'ASIS GSRA', description: 'Daño deliberado a instalaciones, vehículos o equipo sin intención de sustraerlos.' },
                    { key: 'incendio-provocado', name: 'Incendio Provocado', standard: 'ASIS GSRA, NFPA 921', description: 'Fuego iniciado deliberadamente para causar daño o interrumpir operaciones.' },
                ],
            },
            'terrorismo': {
                label: 'Terrorismo',
                threats: [
                    { key: 'atentado-explosivo', name: 'Atentado Explosivo', standard: 'ASIS GSRA, NFPA 730', description: 'Uso de un artefacto explosivo contra instalaciones o personal con fines ideológicos o políticos.' },
                    { key: 'amenaza-bomba', name: 'Amenaza de Bomba', standard: 'ASIS GSRA, NFPA 730', description: 'Aviso, creíble o no, de un artefacto explosivo, que obliga a activar protocolos de evacuación/revisión.' },
                ],
            },
            'espionaje': {
                label: 'Espionaje',
                threats: [
                    { key: 'espionaje-industrial', name: 'Espionaje Industrial', standard: 'ASIS GSRA', description: 'Obtención no autorizada de información o ventaja competitiva mediante acceso físico indebido.' },
                    { key: 'acceso-no-autorizado', name: 'Acceso No Autorizado a Instalaciones', standard: 'ASIS GSRA, ISO 27001 Anexo A (Seguridad Física)', description: 'Ingreso de personas no autorizadas a áreas restringidas o críticas de la organización.' },
                ],
            },
        },
    },
    'humano-no-intencional': {
        label: 'Humano — No Intencional',
        categories: {
            'error-operativo': {
                label: 'Error Operativo',
                threats: [
                    { key: 'error-procedimientos', name: 'Error Humano en Procedimientos Operativos', standard: 'ISO 31000', description: 'Equivocación no deliberada de personal al ejecutar un proceso, con consecuencia de pérdida o daño.' },
                    { key: 'incumplimiento-procedimientos', name: 'Incumplimiento de Procedimientos de Seguridad', standard: 'ASIS GSRA', description: 'Personal que no sigue protocolos establecidos (accesos, custodia de llaves, rondines), aumentando la exposición sin intención maliciosa.' },
                ],
            },
            'accidente': {
                label: 'Accidente',
                threats: [
                    { key: 'accidente-laboral', name: 'Accidente Laboral', standard: 'ISO 31000, NFPA 101', description: 'Lesión o daño no intencional al personal durante el desempeño de sus funciones.' },
                ],
            },
        },
    },
    'tecnologico-operacional': {
        label: 'Tecnológico / Operacional',
        categories: {
            'infraestructura': {
                label: 'Infraestructura',
                threats: [
                    { key: 'falla-electrica', name: 'Falla Eléctrica / Corte de Energía', standard: 'ISO 31000', description: 'Interrupción del suministro eléctrico que afecta operaciones, sistemas de seguridad física o refrigeración/conservación.' },
                    { key: 'falla-estructural', name: 'Falla Estructural de Instalaciones', standard: 'ISO 31000', description: 'Deterioro o colapso de elementos estructurales por desgaste, mal mantenimiento o defecto de construcción.' },
                ],
            },
            'incendio-accidental': {
                label: 'Incendio Accidental',
                threats: [
                    { key: 'incendio-electrico', name: 'Incendio por Falla Eléctrica', standard: 'NFPA 70, ASIS GSRA', description: 'Fuego originado por corto circuito, sobrecarga o mal estado de instalaciones eléctricas.' },
                ],
            },
            'sistemas-seguridad': {
                label: 'Sistemas de Seguridad',
                threats: [
                    { key: 'falla-sistemas-seguridad', name: 'Falla de Sistemas de Seguridad Física', standard: 'ISO 27001 Anexo A (Seguridad Física y Ambiental)', description: 'Mal funcionamiento de CCTV, control de acceso o alarmas que reduce la capacidad de detección/disuasión.' },
                ],
            },
            'equipo': {
                label: 'Equipo',
                threats: [
                    { key: 'falla-equipo-critico', name: 'Falla de Equipo Crítico', standard: 'ISO 31000', description: 'Descompostura de maquinaria o equipo esencial para la operación, sin causa externa deliberada.' },
                ],
            },
        },
    },
    'cadena-suministro': {
        label: 'Cadena de Suministro',
        categories: {
            'integridad-carga': {
                label: 'Integridad de la Carga',
                threats: [
                    { key: 'contrabando-contenedores', name: 'Contrabando en Contenedores/Vehículos', standard: 'C-TPAT', description: 'Introducción de mercancía ilícita o personas no autorizadas dentro de un contenedor o vehículo de carga.' },
                    { key: 'manipulacion-sello-seguridad', name: 'Manipulación No Autorizada de Contenedor/Sello de Seguridad', standard: 'C-TPAT, ISO 28000', description: 'Apertura o alteración indebida de un contenedor o su sello de seguridad durante el trayecto.' },
                ],
            },
            'socios-comerciales': {
                label: 'Socios Comerciales',
                threats: [
                    { key: 'incumplimiento-socio-comercial', name: 'Incumplimiento de Seguridad por Socio Comercial', standard: 'C-TPAT', description: 'Un proveedor, transportista o socio de la cadena de suministro no cumple los criterios mínimos de seguridad exigidos.' },
                    { key: 'personal-no-verificado', name: 'Personal No Verificado en la Cadena de Suministro', standard: 'C-TPAT', description: 'Personal sin verificación de antecedentes con acceso a carga, vehículos o instalaciones logísticas.' },
                ],
            },
        },
    },
};

// Criterios de Riesgo por defecto (Contexto — ISO 31000, cláusula 6.3.4).
// Un cliente del API normalmente los sobreescribe con los suyos.
const defaultRiskCriteria = {
    rrtBands: { medio: 25, alto: 50, critico: 75 },
    aleAceptable: 50000,
    aleCritico: 250000,
    aleUmbralExcedencia: 100000,
};

// Factores de dispersión Mín/Máx según el Nivel de Confianza declarado. Confianza
// baja = rango ancho (más incertidumbre); confianza alta = rango angosto.
const confidenceSpreadFactors = {
    alto: { min: 0.85, max: 1.15 },
    medio: { min: 0.60, max: 1.40 },
    bajo: { min: 0.35, max: 1.80 },
};

module.exports = {
    attackerProfiles,
    defenseProfiles,
    riskProfiles,
    riskCatalog,
    lossFormsKeys,
    lossFormsLabels,
    defaultRiskCriteria,
    confidenceSpreadFactors,
};
