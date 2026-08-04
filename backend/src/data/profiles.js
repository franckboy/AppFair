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
    // Dominio "Humano": basado en el Catálogo Maestro de Amenazas v1.0 (Dominio 1: Amenazas
    // Humanas) que compartió el usuario — normas base declaradas ahí: ASIS SPC.1-2023, ISO
    // 31000, NFPA 730, ISO 28000 (se omite NIST CSF de esa lista de normas base porque los
    // únicos ítems que lo citaban eran de ciberseguridad, ver abajo). Se preserva el sistema de
    // códigos del documento (HUM / HUM-01 / HUM-ROB-001) para trazabilidad. "Intencional" vs.
    // "No Intencional" ya NO son dominios separados — un solo dominio "Humano" con 10
    // categorías, porque esa distinción ya existe en la app vía el interruptor "Amenaza
    // Deliberada" (Análisis Rápido/FAIR), no hace falta duplicarla en el catálogo.
    //
    // Se excluyeron del documento original, por ser específicos de ciberseguridad (NIST CSF) —
    // fuera del alcance de esta app (ver riskProfiles arriba): HUM-ROB-012 Robo de información,
    // HUM-ROB-013 Robo de identidad, HUM-ROB-014 Robo de propiedad intelectual, HUM-FRA-005
    // Falsificación de identidad, HUM-FRA-006 Fraude electrónico, y "ciberterrorismo" dentro de
    // HUM-TER. Los códigos de esos ítems excluidos se dejan sin usar (no se reasignan) para no
    // perder la trazabilidad con el documento original si se reconsideran más adelante.
    //
    // El documento original solo daba el rango de código para HUM-05 a HUM-10 (Sabotaje,
    // Espionaje, Delincuencia Organizada, Intrusión, Corrupción, Error Humano), sin los nombres
    // de las amenazas específicas — esas 6 categorías se completaron con criterio propio,
    // siguiendo el mismo estilo y las mismas familias de normas (ASIS/ISO/NFPA), continuando la
    // numeración de código del documento (no son parte de la fuente original verbatim).
    'humano': {
        label: 'Humano',
        code: 'HUM',
        categories: {
            'robo': {
                label: 'Robo',
                code: 'HUM-01',
                threats: [
                    { key: 'robo-interno', name: 'Robo Interno', standard: 'ASIS, ISO 31000', code: 'HUM-ROB-001', description: 'Sustracción de bienes por parte de personal con acceso legítimo a las instalaciones.' },
                    { key: 'robo-externo', name: 'Robo Externo', standard: 'ASIS', code: 'HUM-ROB-002', description: 'Sustracción de bienes mediante ingreso no autorizado de terceros ajenos a la organización.' },
                    { key: 'robo-armado', name: 'Robo Armado', standard: 'ASIS', code: 'HUM-ROB-003', description: 'Sustracción de bienes mediante uso o amenaza de un arma.' },
                    { key: 'robo-con-violencia', name: 'Robo con Violencia', standard: 'ASIS', code: 'HUM-ROB-004', description: 'Sustracción de bienes mediante fuerza física contra las personas, sin arma.' },
                    { key: 'hurto-simple', name: 'Hurto Simple', standard: 'ASIS', code: 'HUM-ROB-005', description: 'Sustracción de bienes sin violencia ni intimidación.' },
                    { key: 'robo-efectivo', name: 'Robo de Efectivo', standard: 'ISO 31000', code: 'HUM-ROB-006', description: 'Sustracción de dinero en efectivo de cajas, bóvedas o áreas de resguardo.' },
                    { key: 'robo-inventario', name: 'Robo de Inventario', standard: 'ISO 28000', code: 'HUM-ROB-007', description: 'Sustracción de existencias almacenadas en bodega o centro de distribución.' },
                    { key: 'robo-mercancia', name: 'Robo de Mercancía', standard: 'ISO 28000', code: 'HUM-ROB-008', description: 'Sustracción de producto terminado destinado a la venta o distribución.' },
                    { key: 'robo-carga', name: 'Robo de Carga', standard: 'ISO 28000', code: 'HUM-ROB-009', description: 'Sustracción de mercancía consolidada para su despacho o embarque.' },
                    { key: 'robo-vehiculo', name: 'Robo de Vehículo', standard: 'ASIS', code: 'HUM-ROB-010', description: 'Sustracción de un vehículo propio o de un tercero, dentro o fuera de las instalaciones.' },
                    { key: 'robo-combustible', name: 'Robo de Combustible', standard: 'ISO 28000', code: 'HUM-ROB-011', description: 'Sustracción de combustible de tanques, vehículos o instalaciones de almacenamiento.' },
                    { key: 'robo-durante-transporte', name: 'Robo durante Transporte', standard: 'ISO 28000', code: 'HUM-ROB-015', description: 'Sustracción de mercancía mientras se encuentra en tránsito entre origen y destino.' },
                ],
            },
            'fraude': {
                label: 'Fraude',
                code: 'HUM-02',
                threats: [
                    { key: 'fraude-financiero', name: 'Fraude Financiero', standard: 'ISO 31000', code: 'HUM-FRA-001', description: 'Manipulación deliberada de recursos financieros para beneficio propio o de terceros.' },
                    { key: 'fraude-contable', name: 'Fraude Contable', standard: 'COSO', code: 'HUM-FRA-002', description: 'Alteración deliberada de registros contables para ocultar pérdidas o inflar resultados.' },
                    { key: 'fraude-documental', name: 'Fraude Documental', standard: 'ISO 31000', code: 'HUM-FRA-003', description: 'Uso de documentos alterados o falsos para obtener un beneficio indebido.' },
                    { key: 'falsificacion-documentos', name: 'Falsificación de Documentos', standard: 'ISO 31000', code: 'HUM-FRA-004', description: 'Creación o modificación de documentos oficiales sin autorización.' },
                    { key: 'apropiacion-indebida', name: 'Apropiación Indebida', standard: 'ISO 31000', code: 'HUM-FRA-007', description: 'Uso o disposición de bienes o fondos ajenos sin autorización.' },
                    { key: 'desvio-activos', name: 'Desvío de Activos', standard: 'ISO 31000', code: 'HUM-FRA-008', description: 'Redirección no autorizada de activos de la organización hacia terceros.' },
                    { key: 'manipulacion-registros', name: 'Manipulación de Registros', standard: 'ISO 9001', code: 'HUM-FRA-009', description: 'Alteración de bitácoras, inventarios o registros operativos para ocultar una irregularidad.' },
                    { key: 'colusion-interna', name: 'Colusión Interna', standard: 'ASIS', code: 'HUM-FRA-010', description: 'Acuerdo entre dos o más personas, internas o con terceros, para cometer un fraude.' },
                ],
            },
            'violencia': {
                label: 'Violencia',
                code: 'HUM-03',
                threats: [
                    { key: 'agresion-fisica', name: 'Agresión Física', standard: 'ASIS', code: 'HUM-VIO-001', description: 'Uso de fuerza física contra una persona dentro o en relación con las instalaciones.' },
                    { key: 'homicidio', name: 'Homicidio', standard: 'ASIS', code: 'HUM-VIO-002', description: 'Privación de la vida de una persona dentro o en relación con las instalaciones.' },
                    { key: 'lesiones', name: 'Lesiones', standard: 'ASIS', code: 'HUM-VIO-003', description: 'Daño físico a una persona como resultado de un acto violento.' },
                    { key: 'amenazas', name: 'Amenazas', standard: 'ASIS', code: 'HUM-VIO-004', description: 'Manifestación de intención de causar daño a una persona o a la organización.' },
                    { key: 'acoso-laboral', name: 'Acoso Laboral', standard: 'ISO 45001', code: 'HUM-VIO-005', description: 'Conducta hostil o intimidatoria sostenida contra un trabajador.' },
                    { key: 'acoso-sexual', name: 'Acoso Sexual', standard: 'ISO 45001', code: 'HUM-VIO-006', description: 'Conducta de naturaleza sexual no consentida dentro del entorno laboral.' },
                    { key: 'violencia-clientes', name: 'Violencia de Clientes', standard: 'ASIS', code: 'HUM-VIO-007', description: 'Agresión física o verbal de un cliente o visitante contra personal de la organización.' },
                    { key: 'violencia-domestica-trabajo', name: 'Violencia Doméstica Trasladada al Trabajo', standard: 'ASIS', code: 'HUM-VIO-008', description: 'Un conflicto doméstico que se manifiesta violentamente en el lugar de trabajo.' },
                    { key: 'rinas', name: 'Riñas', standard: 'ASIS', code: 'HUM-VIO-009', description: 'Enfrentamiento físico entre dos o más personas dentro de las instalaciones.' },
                    { key: 'ataque-arma-blanca', name: 'Ataque con Arma Blanca', standard: 'ASIS', code: 'HUM-VIO-010', description: 'Agresión con un objeto punzocortante.' },
                    { key: 'ataque-arma-fuego', name: 'Ataque con Arma de Fuego', standard: 'ASIS', code: 'HUM-VIO-011', description: 'Agresión con un arma de fuego.' },
                    { key: 'toma-rehenes', name: 'Toma de Rehenes', standard: 'ASIS', code: 'HUM-VIO-012', description: 'Retención forzada de una o más personas dentro de las instalaciones.' },
                ],
            },
            'terrorismo': {
                label: 'Terrorismo',
                code: 'HUM-04',
                threats: [
                    { key: 'atentado-explosivo', name: 'Atentado Explosivo', standard: 'ASIS, NFPA 730', code: 'HUM-TER-001', description: 'Uso de un artefacto explosivo con fines ideológicos o políticos.' },
                    { key: 'ataque-quimico', name: 'Ataque Químico', standard: 'ASIS', code: 'HUM-TER-002', description: 'Uso deliberado de una sustancia química peligrosa contra personas o instalaciones.' },
                    { key: 'ataque-biologico', name: 'Ataque Biológico', standard: 'ASIS', code: 'HUM-TER-003', description: 'Uso deliberado de un agente biológico contra personas o instalaciones.' },
                    { key: 'ataque-radiologico', name: 'Ataque Radiológico', standard: 'ASIS', code: 'HUM-TER-004', description: 'Uso deliberado de material radiológico contra personas o instalaciones.' },
                    { key: 'atentado-incendiario', name: 'Atentado Incendiario', standard: 'ASIS, NFPA 921', code: 'HUM-TER-005', description: 'Uso deliberado del fuego, con fines ideológicos o políticos.' },
                    { key: 'atentado-suicida', name: 'Atentado Suicida', standard: 'ASIS', code: 'HUM-TER-006', description: 'Ataque ejecutado por un agresor dispuesto a morir en el acto.' },
                    { key: 'amenaza-bomba', name: 'Amenaza de Bomba', standard: 'ASIS, NFPA 730', code: 'HUM-TER-007', description: 'Aviso, creíble o no, de un artefacto explosivo.' },
                    { key: 'financiamiento-terrorismo', name: 'Financiamiento al Terrorismo', standard: 'ASIS, ISO 31000', code: 'HUM-TER-008', description: 'Provisión de recursos económicos, consciente o no, a una organización terrorista.' },
                ],
            },
            'sabotaje': {
                label: 'Sabotaje',
                code: 'HUM-05',
                threats: [
                    { key: 'sabotaje-infraestructura', name: 'Sabotaje a Infraestructura', standard: 'ASIS, ISO 31000', code: 'HUM-SAB-001', description: 'Daño intencional a instalaciones o infraestructura crítica para interrumpir operaciones.' },
                    { key: 'sabotaje-maquinaria', name: 'Sabotaje a Maquinaria o Equipo', standard: 'ASIS', code: 'HUM-SAB-002', description: 'Daño intencional a maquinaria o equipo para interrumpir la operación.' },
                    { key: 'sabotaje-sistemas-seguridad', name: 'Sabotaje a Sistemas de Seguridad Física', standard: 'ASIS', code: 'HUM-SAB-003', description: 'Manipulación o daño deliberado a CCTV, control de acceso o alarmas.' },
                    { key: 'vandalismo', name: 'Vandalismo', standard: 'ASIS', code: 'HUM-SAB-004', description: 'Daño deliberado a instalaciones, vehículos o equipo sin intención de sustraerlos.' },
                    { key: 'incendio-provocado', name: 'Incendio Provocado', standard: 'ASIS, NFPA 921', code: 'HUM-SAB-005', description: 'Fuego iniciado deliberadamente, sin motivación terrorista, para causar daño.' },
                    { key: 'contaminacion-deliberada-producto', name: 'Contaminación Deliberada de Producto', standard: 'ASIS', code: 'HUM-SAB-006', description: 'Alteración intencional de un producto para causar daño o pérdida.' },
                    { key: 'interrupcion-suministros', name: 'Interrupción Deliberada de Suministros', standard: 'ASIS', code: 'HUM-SAB-007', description: 'Corte intencional de agua, energía u otro insumo crítico para la operación.' },
                    { key: 'destruccion-documentacion', name: 'Destrucción de Documentación Crítica', standard: 'ASIS', code: 'HUM-SAB-008', description: 'Eliminación deliberada de registros o documentos necesarios para la operación.' },
                    { key: 'manipulacion-inventario', name: 'Manipulación Deliberada de Inventario', standard: 'ASIS', code: 'HUM-SAB-009', description: 'Alteración intencional de existencias o registros de inventario para ocultar una irregularidad.' },
                    { key: 'dano-flota', name: 'Daño Deliberado a Flota Vehicular', standard: 'ASIS', code: 'HUM-SAB-010', description: 'Daño intencional a los vehículos de la organización.' },
                ],
            },
            'espionaje': {
                label: 'Espionaje',
                code: 'HUM-06',
                threats: [
                    { key: 'espionaje-industrial', name: 'Espionaje Industrial', standard: 'ASIS', code: 'HUM-ESP-001', description: 'Obtención no autorizada de información o ventaja competitiva mediante acceso físico indebido.' },
                    { key: 'espionaje-competitivo', name: 'Espionaje Competitivo', standard: 'ASIS', code: 'HUM-ESP-002', description: 'Recolección encubierta de información estratégica por parte de un competidor.' },
                    { key: 'infiltracion-personal', name: 'Infiltración de Personal', standard: 'ASIS', code: 'HUM-ESP-003', description: 'Colocación de una persona dentro de la organización con el fin de obtener información.' },
                    { key: 'vigilancia-no-autorizada', name: 'Vigilancia No Autorizada', standard: 'ASIS', code: 'HUM-ESP-004', description: 'Observación o seguimiento encubierto de instalaciones o personal.' },
                    { key: 'interceptacion-comunicaciones-fisicas', name: 'Interceptación de Comunicaciones Físicas', standard: 'ASIS', code: 'HUM-ESP-005', description: 'Sustracción o revisión no autorizada de correspondencia o documentos en tránsito.' },
                    { key: 'grabacion-no-autorizada', name: 'Grabación No Autorizada de Instalaciones', standard: 'ASIS', code: 'HUM-ESP-006', description: 'Fotografía o grabación de áreas restringidas sin autorización.' },
                    { key: 'reclutamiento-personal', name: 'Reclutamiento de Personal para Obtener Información', standard: 'ASIS', code: 'HUM-ESP-007', description: 'Persuasión o soborno a un empleado para que entregue información.' },
                    { key: 'extraccion-documentos', name: 'Extracción No Autorizada de Documentos', standard: 'ASIS', code: 'HUM-ESP-008', description: 'Sustracción física de documentos con información sensible.' },
                ],
            },
            'delincuencia-organizada': {
                label: 'Delincuencia Organizada',
                code: 'HUM-07',
                threats: [
                    { key: 'secuestro', name: 'Secuestro', standard: 'ASIS', code: 'HUM-ORG-001', description: 'Privación de la libertad de una persona por parte de un grupo criminal organizado.' },
                    { key: 'extorsion', name: 'Extorsión', standard: 'ASIS', code: 'HUM-ORG-002', description: 'Exigencia de pago bajo amenaza por parte de un grupo criminal organizado.' },
                    { key: 'cobro-piso', name: 'Cobro de Piso', standard: 'ASIS', code: 'HUM-ORG-003', description: 'Exigencia recurrente de pago a cambio de no causar daño a la operación.' },
                    { key: 'robo-mercancia-banda-organizada', name: 'Robo de Mercancía por Banda Organizada', standard: 'ASIS, ISO 28000', code: 'HUM-ORG-004', description: 'Sustracción planeada y coordinada de mercancía por un grupo criminal.' },
                    { key: 'trafico-mercancia-ilicita', name: 'Tráfico de Mercancía Ilícita', standard: 'ASIS, C-TPAT', code: 'HUM-ORG-005', description: 'Uso de las instalaciones o la cadena logística para mover mercancía ilegal.' },
                    { key: 'contrabando-organizacion-criminal', name: 'Contrabando Facilitado por Organización Criminal', standard: 'ASIS, C-TPAT', code: 'HUM-ORG-006', description: 'Introducción de mercancía o personas no declaradas con apoyo de un grupo organizado.' },
                    { key: 'extorsion-transportistas', name: 'Extorsión a Transportistas', standard: 'ASIS', code: 'HUM-ORG-007', description: 'Exigencia de pago o amenaza contra personal de transporte de carga.' },
                    { key: 'corrupcion-organizacion-criminal', name: 'Corrupción de Personal por Organización Criminal', standard: 'ASIS', code: 'HUM-ORG-008', description: 'Soborno o coacción a personal para facilitar actividad criminal.' },
                ],
            },
            'intrusion': {
                label: 'Intrusión',
                code: 'HUM-08',
                threats: [
                    { key: 'acceso-no-autorizado', name: 'Acceso No Autorizado a Instalaciones', standard: 'ASIS, ISO 27001 Anexo A (Seguridad Física)', code: 'HUM-INT-001', description: 'Ingreso de personas no autorizadas a áreas restringidas o críticas de la organización.' },
                    { key: 'allanamiento', name: 'Allanamiento', standard: 'ASIS', code: 'HUM-INT-002', description: 'Ingreso forzado a instalaciones fuera de horario o sin autorización.' },
                    { key: 'escalamiento-perimetro', name: 'Escalamiento de Perímetro', standard: 'ASIS', code: 'HUM-INT-003', description: 'Superación de bardas, cercas u otras barreras perimetrales.' },
                    { key: 'credenciales-falsas-robadas', name: 'Uso de Credenciales Falsas o Robadas', standard: 'ASIS', code: 'HUM-INT-004', description: 'Ingreso mediante una identificación o credencial de acceso falsificada o sustraída.' },
                    { key: 'tailgating', name: 'Ingreso Detrás de Personal Autorizado (Tailgating)', standard: 'ASIS', code: 'HUM-INT-005', description: 'Ingreso de una persona no autorizada aprovechando el acceso de alguien autorizado.' },
                    { key: 'ocupacion-ilegal', name: 'Ocupación Ilegal de Instalaciones', standard: 'ASIS', code: 'HUM-INT-006', description: 'Ocupación no autorizada y sostenida de un inmueble o área de la organización.' },
                    { key: 'ingreso-areas-restringidas', name: 'Ingreso de Personal Ajeno a Áreas Restringidas', standard: 'ASIS', code: 'HUM-INT-007', description: 'Ingreso de un visitante o proveedor a un área para la que no tiene autorización.' },
                ],
            },
            'corrupcion': {
                label: 'Corrupción',
                code: 'HUM-09',
                threats: [
                    { key: 'soborno', name: 'Soborno', standard: 'ISO 37001', code: 'HUM-COR-001', description: 'Ofrecimiento o aceptación de un beneficio indebido a cambio de una acción u omisión.' },
                    { key: 'cohecho-personal-seguridad', name: 'Cohecho a Personal de Seguridad', standard: 'ISO 37001, ASIS', code: 'HUM-COR-002', description: 'Pago indebido a personal de seguridad para facilitar un acto ilícito.' },
                    { key: 'trafico-influencias', name: 'Tráfico de Influencias', standard: 'ISO 37001', code: 'HUM-COR-003', description: 'Uso de una posición de influencia para obtener un beneficio indebido para un tercero.' },
                    { key: 'conflicto-interes', name: 'Conflicto de Interés No Declarado', standard: 'ISO 37001, ISO 31000', code: 'HUM-COR-004', description: 'Situación en la que el interés personal de un colaborador compromete su objetividad, sin haberla declarado.' },
                    { key: 'pago-indebido-autoridades', name: 'Pago Indebido a Autoridades', standard: 'ISO 37001', code: 'HUM-COR-005', description: 'Entrega de dinero o beneficios a un funcionario público para obtener trato favorable.' },
                    { key: 'favoritismo-contrataciones', name: 'Favoritismo en Contrataciones', standard: 'ISO 37001', code: 'HUM-COR-006', description: 'Selección de proveedores o personal por relación personal en vez de mérito.' },
                ],
            },
            'error-humano': {
                label: 'Error Humano',
                code: 'HUM-10',
                threats: [
                    { key: 'error-procedimientos', name: 'Error en Procedimientos Operativos', standard: 'ISO 31000', code: 'HUM-ERR-001', description: 'Equivocación no deliberada de personal al ejecutar un proceso, con consecuencia de pérdida o daño.' },
                    { key: 'incumplimiento-procedimientos', name: 'Incumplimiento de Procedimientos de Seguridad', standard: 'ASIS', code: 'HUM-ERR-002', description: 'Personal que no sigue protocolos establecidos, sin intención maliciosa.' },
                    { key: 'accidente-laboral', name: 'Accidente Laboral', standard: 'ISO 31000, NFPA 101', code: 'HUM-ERR-003', description: 'Lesión o daño no intencional al personal durante el desempeño de sus funciones.' },
                    { key: 'negligencia-custodia-credenciales', name: 'Negligencia en Custodia de Llaves o Credenciales', standard: 'ASIS', code: 'HUM-ERR-004', description: 'Pérdida o manejo descuidado de llaves, tarjetas o credenciales de acceso.' },
                    { key: 'error-verificacion-identidad', name: 'Error en Verificación de Identidad', standard: 'ASIS', code: 'HUM-ERR-005', description: 'Falla del personal de control de acceso al validar la identidad de una persona.' },
                    { key: 'fatiga-distraccion-personal', name: 'Fatiga o Distracción del Personal de Seguridad', standard: 'ASIS', code: 'HUM-ERR-006', description: 'Disminución de la vigilancia por cansancio o falta de atención.' },
                    { key: 'comunicacion-deficiente-turnos', name: 'Comunicación Deficiente en Cambios de Turno', standard: 'ASIS', code: 'HUM-ERR-007', description: 'Pérdida de información relevante al transferir responsabilidades entre turnos.' },
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
