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
    // Dominio "Natural": el usuario compartió el plan de entregas del Catálogo Maestro
    // AppFair (Entrega 3 — Dominio Natural, ~80 amenazas) sin un documento de contenido
    // detallado como el de Humano — confirmó que lo arme con criterio propio. La mayoría de
    // las "normas base" listadas en ese plan (ASIS SPC.1, ISO 27001, NIST CSF/SP 800-53,
    // IEC 62443, MITRE ATT&CK) son de seguridad física/ciber orientadas a actores humanos, no
    // aplican a riesgos naturales — se usan en su lugar ISO 22301 (Continuidad de Negocio,
    // el estándar que sí cubre cómo una organización responde a este tipo de disrupciones),
    // NFPA 1600/1144 (gestión de emergencias/incendio) e ISO 31000 donde no aplica ninguna de
    // las anteriores. Códigos NAT-XX / NAT-XXX-NNN, mismo esquema de trazabilidad que Humano —
    // pero completo en su totalidad por Claude, no proviene de un documento del usuario.
    'natural': {
        label: 'Natural',
        code: 'NAT',
        categories: {
            'geologico': {
                label: 'Geológico',
                code: 'NAT-01',
                threats: [
                    { key: 'sismo', name: 'Sismo / Terremoto', standard: 'ISO 22301, NFPA 1600', code: 'NAT-GEO-001', description: 'Movimiento telúrico que puede causar daño estructural, interrupción operativa y riesgo a la vida humana.' },
                    { key: 'tsunami', name: 'Tsunami', standard: 'ISO 22301, NFPA 1600', code: 'NAT-GEO-002', description: 'Ola de gran tamaño generada por un sismo submarino u otra actividad geológica.' },
                    { key: 'actividad-volcanica', name: 'Actividad Volcánica / Erupción', standard: 'ISO 22301, NFPA 1600', code: 'NAT-GEO-003', description: 'Erupción volcánica con flujo de lava, piroclastos o emisión de ceniza.' },
                    { key: 'ceniza-volcanica', name: 'Emisión de Ceniza Volcánica', standard: 'ISO 22301', code: 'NAT-GEO-004', description: 'Caída de ceniza volcánica que afecta visibilidad, maquinaria, sistemas de ventilación y transporte.' },
                    { key: 'deslizamiento-tierra', name: 'Deslizamiento de Tierra', standard: 'ISO 22301', code: 'NAT-GEO-005', description: 'Movimiento de suelo o roca que puede dañar instalaciones, vías de acceso o infraestructura crítica.' },
                    { key: 'flujo-lodo', name: 'Flujo de Lodo (Lahar)', standard: 'ISO 22301', code: 'NAT-GEO-006', description: 'Corriente de lodo y escombros, típicamente asociada a actividad volcánica o lluvia intensa sobre terreno inestable.' },
                    { key: 'subsidencia', name: 'Hundimiento de Terreno (Subsidencia)', standard: 'ISO 31000', code: 'NAT-GEO-007', description: 'Descenso gradual o súbito del nivel del suelo que puede dañar cimientos e infraestructura.' },
                    { key: 'sumidero', name: 'Formación de Sumidero (Sinkhole)', standard: 'ISO 31000', code: 'NAT-GEO-008', description: 'Colapso súbito del terreno por disolución de roca subyacente, que puede tragar infraestructura.' },
                    { key: 'licuefaccion-suelo', name: 'Licuefacción de Suelo', standard: 'ISO 22301', code: 'NAT-GEO-009', description: 'Pérdida de resistencia del suelo saturado durante un sismo, que puede hacer colapsar cimientos.' },
                    { key: 'avalancha-roca', name: 'Avalancha de Roca', standard: 'ISO 31000', code: 'NAT-GEO-010', description: 'Caída súbita y masiva de rocas por una ladera, típica en zonas montañosas.' },
                ],
            },
            'hidrometeorologico': {
                label: 'Hidrometeorológico',
                code: 'NAT-02',
                threats: [
                    { key: 'inundacion-pluvial', name: 'Inundación Pluvial', standard: 'ISO 22301, NFPA 1600', code: 'NAT-HID-001', description: 'Acumulación de agua por lluvia intensa que supera la capacidad de drenaje del terreno o de las instalaciones.' },
                    { key: 'inundacion-fluvial', name: 'Inundación Fluvial', standard: 'ISO 22301, NFPA 1600', code: 'NAT-HID-002', description: 'Desbordamiento de un río o cuerpo de agua que inunda instalaciones cercanas.' },
                    { key: 'inundacion-costera', name: 'Inundación Costera', standard: 'ISO 22301, NFPA 1600', code: 'NAT-HID-003', description: 'Entrada de agua de mar a zonas costeras por marea alta, oleaje o marea de tormenta.' },
                    { key: 'huracan-ciclon', name: 'Huracán / Ciclón Tropical', standard: 'ISO 22301, NFPA 1600', code: 'NAT-HID-004', description: 'Sistema de viento y lluvia intensa de origen tropical que daña estructuras e interrumpe operaciones.' },
                    { key: 'tormenta-tropical', name: 'Tormenta Tropical', standard: 'ISO 22301, NFPA 1600', code: 'NAT-HID-005', description: 'Sistema tropical de menor intensidad que un huracán, con viento fuerte y lluvia intensa sostenida.' },
                    { key: 'tornado', name: 'Tornado', standard: 'NFPA 1600', code: 'NAT-HID-006', description: 'Columna de viento en rotación de alta velocidad que puede destruir estructuras a su paso.' },
                    { key: 'granizada', name: 'Granizada', standard: 'ISO 22301', code: 'NAT-HID-007', description: 'Precipitación de hielo que puede dañar techos, vehículos, cristales e inventario expuesto.' },
                    { key: 'tormenta-electrica-severa', name: 'Tormenta Eléctrica Severa', standard: 'NFPA 780, ISO 22301', code: 'NAT-HID-008', description: 'Actividad eléctrica atmosférica intensa con riesgo de rayos, sobretensión e incendio.' },
                    { key: 'vendaval', name: 'Vendaval / Ráfaga de Viento Severa', standard: 'NFPA 1600', code: 'NAT-HID-009', description: 'Viento de alta velocidad no asociado a un ciclón que daña estructuras, techos o líneas eléctricas.' },
                    { key: 'nevada-severa', name: 'Nevada Severa', standard: 'ISO 22301', code: 'NAT-HID-010', description: 'Acumulación intensa de nieve que interrumpe accesos, transporte y puede colapsar techos.' },
                    { key: 'tormenta-hielo', name: 'Tormenta de Hielo', standard: 'ISO 22301', code: 'NAT-HID-011', description: 'Lluvia que se congela al contacto, formando una capa de hielo sobre estructuras, vías y líneas eléctricas.' },
                    { key: 'sequia', name: 'Sequía', standard: 'ISO 22301', code: 'NAT-HID-012', description: 'Escasez prolongada de precipitación que afecta el suministro de agua para la operación.' },
                    { key: 'lluvia-intensa-localizada', name: 'Lluvia Intensa Localizada', standard: 'ISO 22301', code: 'NAT-HID-013', description: 'Precipitación de corta duración pero muy alta intensidad, típica de tormentas convectivas.' },
                    { key: 'ciclon-extratropical', name: 'Ciclón Extratropical', standard: 'ISO 22301, NFPA 1600', code: 'NAT-HID-014', description: 'Sistema de baja presión de latitudes medias con viento fuerte y lluvia o nieve sostenida.' },
                ],
            },
            'incendio-natural': {
                label: 'Incendio Natural',
                code: 'NAT-03',
                threats: [
                    { key: 'incendio-forestal', name: 'Incendio Forestal', standard: 'NFPA 1144', code: 'NAT-INC-001', description: 'Fuego de origen natural que se propaga en zonas boscosas hacia instalaciones o terrenos de la organización.' },
                    { key: 'incendio-pastizal', name: 'Incendio de Pastizal', standard: 'NFPA 1144', code: 'NAT-INC-002', description: 'Fuego de propagación rápida en vegetación baja o pastizales cercanos a las instalaciones.' },
                    { key: 'incendio-matorral', name: 'Incendio de Matorral', standard: 'NFPA 1144', code: 'NAT-INC-003', description: 'Fuego en vegetación arbustiva densa, con alta carga combustible.' },
                    { key: 'propagacion-incendio-viento', name: 'Propagación de Incendio por Viento', standard: 'NFPA 1144', code: 'NAT-INC-004', description: 'Aceleración y cambio de dirección de un incendio natural por efecto del viento.' },
                    { key: 'reignicion-incendio-forestal', name: 'Reignición de Incendio Forestal', standard: 'NFPA 1144', code: 'NAT-INC-005', description: 'Reactivación de un incendio forestal dado por controlado, por brasas o puntos calientes remanentes.' },
                    { key: 'humo-ceniza-incendio', name: 'Humo y Ceniza de Incendio Forestal', standard: 'NFPA 1144, ISO 22301', code: 'NAT-INC-006', description: 'Deterioro de la calidad del aire y visibilidad por humo/ceniza de un incendio forestal cercano, que puede forzar cierre operativo.' },
                ],
            },
            'biologico-sanitario': {
                label: 'Biológico / Sanitario',
                code: 'NAT-04',
                threats: [
                    { key: 'pandemia', name: 'Pandemia', standard: 'ISO 22301, NFPA 1600', code: 'NAT-BIO-001', description: 'Brote de enfermedad a escala global que reduce disponibilidad de personal y puede forzar cierre de operaciones.' },
                    { key: 'epidemia-local', name: 'Epidemia Local', standard: 'ISO 22301, NFPA 1600', code: 'NAT-BIO-002', description: 'Brote de enfermedad concentrado en una región o comunidad que afecta al personal.' },
                    { key: 'brote-zoonotico', name: 'Brote de Enfermedad Zoonótica', standard: 'ISO 22301', code: 'NAT-BIO-003', description: 'Enfermedad transmitida de animales a personas que se propaga entre el personal.' },
                    { key: 'plaga-insectos', name: 'Plaga de Insectos', standard: 'ISO 22301', code: 'NAT-BIO-004', description: 'Infestación de insectos que afecta inventario, alimentos o condiciones sanitarias de las instalaciones.' },
                    { key: 'infestacion-roedores', name: 'Infestación de Roedores', standard: 'ISO 22301', code: 'NAT-BIO-005', description: 'Presencia de roedores que daña inventario, cableado o condiciones sanitarias.' },
                    { key: 'contaminacion-biologica-agua', name: 'Contaminación Biológica de Agua', standard: 'ISO 22301', code: 'NAT-BIO-006', description: 'Presencia de microorganismos patógenos en el suministro de agua de la organización.' },
                    { key: 'floracion-algas-nocivas', name: 'Floración de Algas Nocivas', standard: 'ISO 22301', code: 'NAT-BIO-007', description: 'Proliferación de algas tóxicas en cuerpos de agua cercanos, que afecta el suministro o la operación.' },
                    { key: 'enfermedad-vectores', name: 'Enfermedad Transmitida por Vectores', standard: 'ISO 22301', code: 'NAT-BIO-008', description: 'Enfermedad transmitida por mosquitos u otros vectores que afecta la disponibilidad de personal.' },
                    { key: 'proliferacion-fauna-nociva', name: 'Proliferación de Fauna Nociva', standard: 'ISO 22301', code: 'NAT-BIO-009', description: 'Aumento no controlado de fauna silvestre que representa un riesgo sanitario o de seguridad para el personal.' },
                    { key: 'enfermedad-agricola', name: 'Enfermedad Vegetal / Agrícola a Gran Escala', standard: 'ISO 22301', code: 'NAT-BIO-010', description: 'Brote de una plaga o enfermedad vegetal que afecta cultivos o insumos de origen agrícola de la organización.' },
                    { key: 'contaminacion-suelo-natural', name: 'Contaminación de Suelo por Fenómeno Natural', standard: 'ISO 22301', code: 'NAT-BIO-011', description: 'Alteración biológica o química del suelo por un evento natural (ej. inundación con sedimento contaminado).' },
                    { key: 'intoxicacion-alimentaria-natural', name: 'Intoxicación Alimentaria de Origen Natural', standard: 'ISO 22301', code: 'NAT-BIO-012', description: 'Contaminación natural (toxinas, patógenos) de alimentos que afecta al personal a gran escala.' },
                ],
            },
            'oceanico-costero': {
                label: 'Oceánico / Costero',
                code: 'NAT-05',
                threats: [
                    { key: 'marea-tormenta', name: 'Marea de Tormenta (Storm Surge)', standard: 'ISO 22301, NFPA 1600', code: 'NAT-OCE-001', description: 'Elevación anormal del nivel del mar asociada a un ciclón, que inunda zonas costeras.' },
                    { key: 'erosion-costera', name: 'Erosión Costera', standard: 'ISO 22301', code: 'NAT-OCE-002', description: 'Pérdida gradual de terreno costero por acción del oleaje y las corrientes.' },
                    { key: 'oleaje-extremo', name: 'Oleaje Extremo', standard: 'ISO 22301', code: 'NAT-OCE-003', description: 'Olas de gran altura que dañan infraestructura costera o portuaria.' },
                    { key: 'corriente-resaca', name: 'Corriente de Resaca Severa', standard: 'ISO 31000', code: 'NAT-OCE-004', description: 'Corriente marina fuerte que representa riesgo para personal u operaciones costeras.' },
                    { key: 'intrusion-agua-salada', name: 'Intrusión de Agua Salada', standard: 'ISO 22301', code: 'NAT-OCE-005', description: 'Contaminación de agua dulce subterránea o superficial por agua de mar.' },
                    { key: 'elevacion-nivel-mar', name: 'Elevación del Nivel del Mar', standard: 'ISO 31000', code: 'NAT-OCE-006', description: 'Aumento sostenido y de largo plazo del nivel del mar que incrementa el riesgo de inundación costera crónica.' },
                    { key: 'marejada-ciclonica', name: 'Marejada Ciclónica', standard: 'ISO 22301, NFPA 1600', code: 'NAT-OCE-007', description: 'Oleaje anómalo generado por un sistema ciclónico distante.' },
                    { key: 'colapso-linea-costa', name: 'Colapso de Línea de Costa', standard: 'ISO 22301', code: 'NAT-OCE-008', description: 'Falla estructural súbita de un acantilado o duna costera que protegía instalaciones cercanas.' },
                ],
            },
            'atmosferico-severo': {
                label: 'Atmosférico Severo',
                code: 'NAT-06',
                threats: [
                    { key: 'ola-calor', name: 'Ola de Calor', standard: 'ISO 22301, NFPA 1600', code: 'NAT-ATM-001', description: 'Periodo prolongado de temperatura extrema alta que afecta al personal y a equipos sensibles.' },
                    { key: 'ola-frio', name: 'Ola de Frío', standard: 'ISO 22301, NFPA 1600', code: 'NAT-ATM-002', description: 'Periodo prolongado de temperatura extrema baja que afecta al personal, tuberías y equipos.' },
                    { key: 'helada', name: 'Helada', standard: 'ISO 22301', code: 'NAT-ATM-003', description: 'Descenso de temperatura bajo el punto de congelación que daña cultivos, tuberías o infraestructura expuesta.' },
                    { key: 'neblina-densa', name: 'Neblina Densa', standard: 'ISO 31000', code: 'NAT-ATM-004', description: 'Reducción severa de visibilidad que afecta transporte, patrullaje y operaciones al aire libre.' },
                    { key: 'tormenta-polvo-arena', name: 'Tormenta de Polvo / Arena', standard: 'ISO 22301', code: 'NAT-ATM-005', description: 'Viento que levanta partículas de suelo o arena, dañando equipo y reduciendo visibilidad.' },
                    { key: 'calima', name: 'Calima / Contaminación Atmosférica Natural', standard: 'ISO 22301', code: 'NAT-ATM-006', description: 'Suspensión de partículas naturales en el aire (polvo, arena, ceniza) que afecta salud y visibilidad.' },
                    { key: 'impacto-directo-rayo', name: 'Impacto Directo de Rayo', standard: 'NFPA 780', code: 'NAT-ATM-007', description: 'Descarga eléctrica atmosférica directa sobre una persona, estructura o equipo.' },
                    { key: 'inversion-termica', name: 'Inversión Térmica Prolongada', standard: 'ISO 22301', code: 'NAT-ATM-008', description: 'Estancamiento de aire contaminado cerca del suelo que deteriora la calidad del aire de forma sostenida.' },
                    { key: 'derecho', name: 'Viento Huracanado sin Ciclón Asociado (Derecho)', standard: 'NFPA 1600', code: 'NAT-ATM-009', description: 'Línea de tormentas que produce viento sostenido de gran intensidad en línea recta, sin rotación ciclónica.' },
                    { key: 'granizo-severo-aislado', name: 'Granizo Severo Aislado', standard: 'ISO 22301', code: 'NAT-ATM-010', description: 'Evento de granizo de gran tamaño concentrado en un área reducida, con daño localizado intenso.' },
                ],
            },
            'espacial': {
                label: 'Espacial',
                code: 'NAT-07',
                threats: [
                    { key: 'tormenta-geomagnetica', name: 'Tormenta Geomagnética / Solar', standard: 'ISO 31000', code: 'NAT-ESP-001', description: 'Perturbación del campo magnético terrestre por actividad solar, con riesgo de falla eléctrica y de telecomunicaciones.' },
                    { key: 'eyeccion-masa-coronal', name: 'Eyección de Masa Coronal', standard: 'ISO 31000', code: 'NAT-ESP-002', description: 'Liberación masiva de plasma solar que puede afectar redes eléctricas y sistemas satelitales.' },
                    { key: 'impacto-meteorito', name: 'Impacto de Meteorito', standard: 'ISO 31000', code: 'NAT-ESP-003', description: 'Impacto de un cuerpo celeste contra la superficie terrestre cerca de las instalaciones.' },
                    { key: 'interrupcion-senal-satelital', name: 'Interrupción de Señal Satelital por Actividad Solar', standard: 'ISO 31000', code: 'NAT-ESP-004', description: 'Pérdida de comunicación o posicionamiento satelital por interferencia de origen solar.' },
                    { key: 'radiacion-cosmica', name: 'Radiación Cósmica Elevada', standard: 'ISO 31000', code: 'NAT-ESP-005', description: 'Exposición anómala a radiación de origen cósmico, relevante para operaciones a gran altitud.' },
                    { key: 'caida-desechos-espaciales', name: 'Caída de Desechos Espaciales', standard: 'ISO 31000', code: 'NAT-ESP-006', description: 'Impacto de fragmentos de satélites u otros objetos artificiales que reingresan a la atmósfera.' },
                ],
            },
            'geomorfologico': {
                label: 'Geomorfológico',
                code: 'NAT-08',
                threats: [
                    { key: 'erosion-suelo', name: 'Erosión de Suelo', standard: 'ISO 22301', code: 'NAT-GEM-001', description: 'Pérdida gradual de la capa superficial del suelo por agua o viento, que compromete cimientos o accesos.' },
                    { key: 'desertificacion', name: 'Desertificación', standard: 'ISO 31000', code: 'NAT-GEM-002', description: 'Degradación progresiva del suelo hacia condiciones áridas, con impacto de largo plazo en la operación.' },
                    { key: 'colapso-cavernas', name: 'Colapso de Cavernas o Minas Naturales', standard: 'ISO 31000', code: 'NAT-GEM-003', description: 'Hundimiento del terreno por colapso de una cavidad natural subterránea.' },
                    { key: 'movimiento-falla-geologica', name: 'Movimiento de Falla Geológica (Creep)', standard: 'ISO 31000', code: 'NAT-GEM-004', description: 'Desplazamiento lento y sostenido del terreno a lo largo de una falla geológica.' },
                    { key: 'expansion-suelo-arcilloso', name: 'Expansión/Contracción de Suelo Arcilloso', standard: 'ISO 31000', code: 'NAT-GEM-005', description: 'Movimiento cíclico del suelo arcilloso por cambios de humedad, que agrieta cimientos y estructuras.' },
                    { key: 'karstificacion', name: 'Karstificación', standard: 'ISO 31000', code: 'NAT-GEM-006', description: 'Formación de terreno kárstico por disolución de roca soluble, con riesgo de hundimientos.' },
                    { key: 'deshielo-permafrost', name: 'Deshielo de Permafrost', standard: 'ISO 31000', code: 'NAT-GEM-007', description: 'Descongelamiento de suelo permanentemente helado, que desestabiliza cimientos e infraestructura.' },
                    { key: 'alteracion-cauce-rio', name: 'Alteración de Cauce Natural de Río', standard: 'ISO 22301', code: 'NAT-GEM-008', description: 'Cambio en el curso natural de un río que puede exponer instalaciones a inundación o erosión.' },
                    { key: 'dunas-migratorias', name: 'Formación de Dunas Migratorias', standard: 'ISO 31000', code: 'NAT-GEM-009', description: 'Desplazamiento de dunas de arena que puede sepultar accesos o infraestructura.' },
                    { key: 'colapso-ribera-rio', name: 'Colapso de Ribera de Río', standard: 'ISO 22301', code: 'NAT-GEM-010', description: 'Falla súbita de la orilla de un río por socavación, que puede afectar infraestructura cercana.' },
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
    // Dominio "Tecnológico": placeholder — el plan de entregas del usuario lo separa de
    // "Operacional" (Entrega 2 vs. Entrega 4, cada uno con su propio target de ~120/~80
    // amenazas). Este dominio se construyó originalmente como "Tecnológico/Operacional"
    // combinado, antes de conocer ese plan — se deja aquí con su contenido original (4
    // amenazas de infraestructura/equipo) hasta que llegue el contenido completo de la
    // Entrega 2 (Dominio Tecnológico), momento en el que se expandirá.
    'tecnologico': {
        label: 'Tecnológico',
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
    // Dominio "Operacional" (Entrega 4 del plan de entregas, ~80 amenazas): sin documento de
    // contenido detallado del usuario, construido con criterio propio (mismo acuerdo que
    // Natural). Se excluyen deliberadamente ASIS/ISO 27001/NIST/IEC 62443/MITRE de la lista de
    // normas base del plan — son de seguridad física ante actores humanos o de ciberseguridad
    // de sistemas de control industrial (IEC 62443), y este dominio cubre fallas operativas de
    // proceso/mantenimiento/calidad/logística interna, no ataques deliberados ni brechas
    // digitales. Se usan en su lugar ISO 22301 (continuidad de negocio), ISO 31000 (general),
    // ISO 9001 (calidad), ISO 55001 (gestión de activos/mantenimiento), ISO 45001 (seguridad y
    // salud ocupacional) e ISO 22000 (inocuidad alimentaria, donde aplica). Se evita duplicar
    // lo que ya cubre el dominio "Cadena de Suministro" (seguridad de carga/socios
    // comerciales) — aquí la logística es interna (manejo de materiales, bodega, patio).
    'operacional': {
        label: 'Operacional',
        code: 'OPE',
        categories: {
            'procesos-produccion': {
                label: 'Procesos y Producción',
                code: 'OPE-01',
                threats: [
                    { key: 'interrupcion-linea-produccion', name: 'Interrupción de Línea de Producción', standard: 'ISO 22301', code: 'OPE-PRO-001', description: 'Detención no planeada de una línea de producción que afecta la operación.' },
                    { key: 'paro-no-programado-planta', name: 'Paro No Programado de Planta', standard: 'ISO 22301', code: 'OPE-PRO-002', description: 'Detención total de la planta fuera del calendario de operación previsto.' },
                    { key: 'cuello-botella-proceso', name: 'Cuello de Botella en Proceso Crítico', standard: 'ISO 31000', code: 'OPE-PRO-003', description: 'Punto del proceso que limita la capacidad total de producción de la operación.' },
                    { key: 'desviacion-proceso', name: 'Desviación de Proceso Fuera de Especificación', standard: 'ISO 9001', code: 'OPE-PRO-004', description: 'Ejecución de un proceso fuera de los parámetros técnicos definidos.' },
                    { key: 'sobreproduccion', name: 'Sobreproducción', standard: 'ISO 31000', code: 'OPE-PRO-005', description: 'Producción por encima de la demanda real, generando costo e inventario excedente.' },
                    { key: 'subproduccion', name: 'Subproducción', standard: 'ISO 31000', code: 'OPE-PRO-006', description: 'Producción por debajo de la demanda o del compromiso comercial asumido.' },
                    { key: 'contaminacion-cruzada-proceso', name: 'Contaminación Cruzada en Proceso', standard: 'ISO 22301', code: 'OPE-PRO-007', description: 'Mezcla no intencional de materiales o productos distintos durante el proceso productivo.' },
                    { key: 'interrupcion-cambio-turno', name: 'Interrupción por Cambio de Turno Deficiente', standard: 'ISO 31000', code: 'OPE-PRO-008', description: 'Pérdida de continuidad operativa por una transición de turno mal ejecutada.' },
                    { key: 'falla-arranque-proceso', name: 'Falla en Arranque de Proceso', standard: 'ISO 22301', code: 'OPE-PRO-009', description: 'Falla al reiniciar un proceso o línea productiva después de una detención.' },
                    { key: 'falla-parada-proceso', name: 'Falla en Parada de Proceso', standard: 'ISO 22301', code: 'OPE-PRO-010', description: 'Falla al detener un proceso de forma segura y controlada.' },
                    { key: 'error-configuracion-proceso', name: 'Error de Configuración de Proceso', standard: 'ISO 31000', code: 'OPE-PRO-011', description: 'Ajuste incorrecto de parámetros de un proceso u operación.' },
                    { key: 'contaminacion-insumos-proceso', name: 'Contaminación de Insumos en Proceso', standard: 'ISO 22301', code: 'OPE-PRO-012', description: 'Alteración accidental de un insumo durante su manejo dentro del proceso.' },
                ],
            },
            'mantenimiento': {
                label: 'Mantenimiento',
                code: 'OPE-02',
                threats: [
                    { key: 'falla-mantenimiento-diferido', name: 'Falla por Mantenimiento Diferido', standard: 'ISO 55001', code: 'OPE-MTO-001', description: 'Falla de equipo causada por posponer el mantenimiento programado.' },
                    { key: 'mantenimiento-correctivo-no-planeado', name: 'Mantenimiento Correctivo No Planeado', standard: 'ISO 55001', code: 'OPE-MTO-002', description: 'Necesidad de reparación urgente no prevista que interrumpe la operación.' },
                    { key: 'falla-repuesto-critico', name: 'Falla de Repuesto Crítico No Disponible', standard: 'ISO 55001', code: 'OPE-MTO-003', description: 'Falta de una refacción esencial que prolonga el tiempo de reparación de un equipo.' },
                    { key: 'error-ejecucion-mantenimiento', name: 'Error en Ejecución de Mantenimiento', standard: 'ISO 55001', code: 'OPE-MTO-004', description: 'Trabajo de mantenimiento mal realizado que causa una falla posterior o un incidente.' },
                    { key: 'obsolescencia-equipo', name: 'Obsolescencia de Equipo', standard: 'ISO 55001', code: 'OPE-MTO-005', description: 'Equipo que ya no cuenta con soporte, repuestos o desempeño adecuado por antigüedad.' },
                    { key: 'falla-desgaste-no-detectado', name: 'Falla por Desgaste No Detectado', standard: 'ISO 55001', code: 'OPE-MTO-006', description: 'Falla de un componente por desgaste que no fue identificado a tiempo.' },
                    { key: 'interrupcion-mantenimiento-extendido', name: 'Interrupción por Mantenimiento Programado Extendido', standard: 'ISO 22301', code: 'OPE-MTO-007', description: 'Una intervención de mantenimiento programada toma más tiempo del previsto y afecta la operación.' },
                    { key: 'falla-proveedor-mantenimiento', name: 'Falla de Proveedor de Servicio de Mantenimiento', standard: 'ISO 55001', code: 'OPE-MTO-008', description: 'Un proveedor externo de mantenimiento no cumple con el servicio contratado a tiempo.' },
                    { key: 'falla-equipo-respaldo', name: 'Falla de Equipo de Respaldo (Backup)', standard: 'ISO 22301', code: 'OPE-MTO-009', description: 'El equipo destinado a operar en caso de falla del principal también falla o no está disponible.' },
                    { key: 'incumplimiento-programa-preventivo', name: 'Incumplimiento de Programa de Mantenimiento Preventivo', standard: 'ISO 55001', code: 'OPE-MTO-010', description: 'El mantenimiento preventivo programado no se ejecuta según lo planeado.' },
                ],
            },
            'calidad': {
                label: 'Calidad',
                code: 'OPE-03',
                threats: [
                    { key: 'no-conformidad-producto', name: 'No Conformidad de Producto', standard: 'ISO 9001', code: 'OPE-CAL-001', description: 'Producto que no cumple con los requisitos de calidad establecidos.' },
                    { key: 'retiro-producto-mercado', name: 'Retiro de Producto del Mercado (Recall)', standard: 'ISO 9001', code: 'OPE-CAL-002', description: 'Necesidad de retirar producto ya distribuido por un defecto o riesgo detectado.' },
                    { key: 'reclamo-cliente-calidad', name: 'Reclamo de Cliente por Calidad', standard: 'ISO 9001', code: 'OPE-CAL-003', description: 'Queja formal de un cliente relacionada con la calidad del producto o servicio entregado.' },
                    { key: 'falla-control-calidad-materia-prima', name: 'Falla en Control de Calidad de Materia Prima', standard: 'ISO 9001', code: 'OPE-CAL-004', description: 'Ingreso de materia prima que no cumple con las especificaciones requeridas.' },
                    { key: 'falla-equipo-medicion', name: 'Falla de Equipo de Medición/Calibración', standard: 'ISO 9001', code: 'OPE-CAL-005', description: 'Instrumento de medición fuera de calibración que compromete la validez de un resultado.' },
                    { key: 'lote-produccion-defectuoso', name: 'Lote de Producción Defectuoso', standard: 'ISO 9001', code: 'OPE-CAL-006', description: 'Un lote completo de producción resulta con un defecto sistemático.' },
                    { key: 'incumplimiento-especificacion-tecnica', name: 'Incumplimiento de Especificación Técnica', standard: 'ISO 9001', code: 'OPE-CAL-007', description: 'El producto o proceso no cumple con una especificación técnica acordada con el cliente.' },
                    { key: 'falla-sistema-gestion-calidad', name: 'Falla de Sistema de Gestión de Calidad', standard: 'ISO 9001', code: 'OPE-CAL-008', description: 'El sistema documental o de control de calidad no detecta una desviación a tiempo.' },
                    { key: 'producto-fuera-vida-util', name: 'Producto Fuera de Vida Útil (Caducidad)', standard: 'ISO 22000', code: 'OPE-CAL-009', description: 'Producto que se distribuye o utiliza después de su fecha de caducidad o vida útil.' },
                    { key: 'error-formulacion-mezcla', name: 'Error de Formulación o Mezcla', standard: 'ISO 9001', code: 'OPE-CAL-010', description: 'Combinación incorrecta de ingredientes o componentes en la elaboración de un producto.' },
                ],
            },
            'capacidad-programacion': {
                label: 'Capacidad y Programación',
                code: 'OPE-04',
                threats: [
                    { key: 'sobrecarga-capacidad-instalada', name: 'Sobrecarga de Capacidad Instalada', standard: 'ISO 31000', code: 'OPE-CAP-001', description: 'Demanda que excede la capacidad máxima de producción u operación disponible.' },
                    { key: 'programacion-deficiente-produccion', name: 'Programación Deficiente de Producción', standard: 'ISO 31000', code: 'OPE-CAP-002', description: 'Mala planeación de la secuencia u horarios de producción que genera ineficiencia.' },
                    { key: 'cuello-botella-logistico-interno', name: 'Cuello de Botella Logístico Interno', standard: 'ISO 31000', code: 'OPE-CAP-003', description: 'Punto de la logística interna que limita el flujo de materiales o producto.' },
                    { key: 'retraso-cumplimiento-pedido', name: 'Retraso en Cumplimiento de Pedido', standard: 'ISO 31000', code: 'OPE-CAP-004', description: 'Incapacidad de entregar un pedido dentro del plazo comprometido.' },
                    { key: 'perdida-capacidad-ausentismo', name: 'Pérdida de Capacidad por Ausentismo', standard: 'ISO 31000', code: 'OPE-CAP-005', description: 'Reducción de la capacidad operativa por falta de personal disponible.' },
                    { key: 'desbalance-linea-produccion', name: 'Desbalance de Línea de Producción', standard: 'ISO 31000', code: 'OPE-CAP-006', description: 'Diferencia de ritmo entre estaciones de una línea que genera cuellos de botella internos.' },
                ],
            },
            'logistica-interna': {
                label: 'Logística Interna',
                code: 'OPE-05',
                threats: [
                    { key: 'dano-producto-manejo-interno', name: 'Daño de Producto en Manejo Interno', standard: 'ISO 22301', code: 'OPE-LOG-001', description: 'Deterioro de producto durante su manejo dentro de las instalaciones de la organización.' },
                    { key: 'error-picking-surtido', name: 'Error de Picking/Surtido de Pedido', standard: 'ISO 31000', code: 'OPE-LOG-002', description: 'Preparación incorrecta de un pedido (producto, cantidad o destino equivocado).' },
                    { key: 'perdida-trazabilidad-inventario', name: 'Pérdida de Trazabilidad de Inventario', standard: 'ISO 28000', code: 'OPE-LOG-003', description: 'Imposibilidad de rastrear la ubicación o el movimiento histórico de un producto en inventario.' },
                    { key: 'congestion-patio-maniobras', name: 'Congestión en Patio de Maniobras', standard: 'ISO 31000', code: 'OPE-LOG-004', description: 'Saturación del patio de carga/descarga que retrasa el flujo de vehículos.' },
                    { key: 'falla-montacargas', name: 'Falla de Montacargas u Equipo de Manejo de Materiales', standard: 'ISO 22301', code: 'OPE-LOG-005', description: 'Descompostura de un montacargas u otro equipo usado para mover materiales internamente.' },
                    { key: 'error-etiquetado-rotulado', name: 'Error en Etiquetado o Rotulado', standard: 'ISO 31000', code: 'OPE-LOG-006', description: 'Identificación incorrecta de un producto o embarque.' },
                    { key: 'extravio-mercancia-bodega', name: 'Extravío de Mercancía en Bodega', standard: 'ISO 28000', code: 'OPE-LOG-007', description: 'Producto que no puede ser localizado dentro de la bodega, sin evidencia de sustracción.' },
                    { key: 'sobreinventario-obsolescencia', name: 'Sobreinventario / Obsolescencia de Inventario', standard: 'ISO 31000', code: 'OPE-LOG-008', description: 'Acumulación de inventario por encima de lo necesario, con riesgo de volverse obsoleto.' },
                    { key: 'error-conteo-ciclico', name: 'Error de Conteo Cíclico de Inventario', standard: 'ISO 28000', code: 'OPE-LOG-009', description: 'Discrepancia entre el inventario físico y el registrado, detectada en un conteo periódico.' },
                    { key: 'colision-montacargas', name: 'Colisión de Montacargas', standard: 'ISO 45001', code: 'OPE-LOG-010', description: 'Accidente de un montacargas contra personal, estructura o mercancía dentro de las instalaciones.' },
                ],
            },
            'gestion-instalaciones': {
                label: 'Gestión de Instalaciones',
                code: 'OPE-06',
                threats: [
                    { key: 'falla-hvac', name: 'Falla de Sistema de Climatización (HVAC)', standard: 'ISO 22301', code: 'OPE-INS-001', description: 'Falla del sistema de calefacción, ventilación o aire acondicionado que afecta personal, producto o equipo.' },
                    { key: 'falla-suministro-agua', name: 'Falla de Suministro de Agua', standard: 'ISO 22301', code: 'OPE-INS-002', description: 'Interrupción del abastecimiento de agua a las instalaciones.' },
                    { key: 'falla-sistema-refrigeracion', name: 'Falla de Sistema de Refrigeración', standard: 'ISO 22301', code: 'OPE-INS-003', description: 'Falla de un sistema de frío que compromete producto o insumos que requieren cadena de frío.' },
                    { key: 'deterioro-infraestructura-mantenimiento', name: 'Deterioro de Infraestructura por Falta de Mantenimiento', standard: 'ISO 55001', code: 'OPE-INS-004', description: 'Degradación de instalaciones por ausencia o insuficiencia de mantenimiento preventivo.' },
                    { key: 'falla-iluminacion-critica', name: 'Falla de Iluminación Crítica', standard: 'ISO 22301', code: 'OPE-INS-005', description: 'Pérdida de iluminación en un área operativa o de seguridad crítica.' },
                    { key: 'saturacion-capacidad-almacenamiento', name: 'Saturación de Capacidad de Almacenamiento', standard: 'ISO 31000', code: 'OPE-INS-006', description: 'El espacio de almacenamiento disponible es insuficiente para el volumen operativo.' },
                    { key: 'falla-tratamiento-aguas-residuales', name: 'Falla de Sistema de Tratamiento de Aguas Residuales', standard: 'ISO 22301', code: 'OPE-INS-007', description: 'Falla del sistema de tratamiento que puede generar un incumplimiento ambiental u operativo.' },
                    { key: 'falla-elevador-personal', name: 'Falla de Elevador o Montacargas de Personal', standard: 'ISO 22301', code: 'OPE-INS-008', description: 'Descompostura de un elevador que afecta la movilidad del personal dentro de las instalaciones.' },
                    { key: 'filtracion-agua-techo', name: 'Filtración de Agua en Techo o Estructura', standard: 'ISO 22301', code: 'OPE-INS-009', description: 'Entrada de agua por daño estructural, sin relación con un evento climático extremo.' },
                    { key: 'falla-extraccion-humos', name: 'Falla de Sistema de Extracción de Humos o Gases', standard: 'NFPA, ISO 22301', code: 'OPE-INS-010', description: 'Falla del sistema que evacúa humos, gases o vapores de un área de proceso.' },
                ],
            },
            'recursos-humanos-operativos': {
                label: 'Recursos Humanos Operativos',
                code: 'OPE-07',
                threats: [
                    { key: 'escasez-personal-calificado', name: 'Escasez de Personal Calificado', standard: 'ISO 31000', code: 'OPE-RRH-001', description: 'Dificultad para cubrir puestos operativos con el nivel de calificación requerido.' },
                    { key: 'rotacion-personal-elevada', name: 'Rotación de Personal Elevada', standard: 'ISO 31000', code: 'OPE-RRH-002', description: 'Salida frecuente de personal que afecta la continuidad y curva de aprendizaje operativa.' },
                    { key: 'huelga-paro-laboral', name: 'Huelga o Paro Laboral', standard: 'ISO 31000', code: 'OPE-RRH-003', description: 'Suspensión colectiva de labores por parte del personal.' },
                    { key: 'ausentismo-elevado', name: 'Ausentismo Elevado', standard: 'ISO 31000', code: 'OPE-RRH-004', description: 'Inasistencia recurrente del personal que reduce la capacidad operativa disponible.' },
                    { key: 'falta-capacitacion-personal', name: 'Falta de Capacitación del Personal Operativo', standard: 'ISO 31000', code: 'OPE-RRH-005', description: 'Personal que ejecuta tareas operativas sin la capacitación adecuada.' },
                    { key: 'fatiga-personal-turnos-extendidos', name: 'Fatiga del Personal en Turnos Extendidos', standard: 'ISO 45001', code: 'OPE-RRH-006', description: 'Disminución del desempeño y aumento del riesgo de error por jornadas prolongadas.' },
                    { key: 'error-operativo-entrenamiento-insuficiente', name: 'Error Operativo por Personal Insuficientemente Entrenado', standard: 'ISO 31000', code: 'OPE-RRH-007', description: 'Equivocación en una tarea operativa causada por falta de entrenamiento previo.' },
                    { key: 'insubordinacion-conflicto-colectivo', name: 'Insubordinación o Conflicto Laboral Colectivo', standard: 'ISO 31000', code: 'OPE-RRH-008', description: 'Conflicto sostenido entre personal y dirección que afecta el desempeño operativo.' },
                    { key: 'perdida-conocimiento-critico', name: 'Pérdida de Conocimiento Crítico', standard: 'ISO 31000', code: 'OPE-RRH-009', description: 'Salida de personal clave que se lleva consigo conocimiento no documentado del proceso.' },
                    { key: 'falla-sucesion-puesto-critico', name: 'Falla en Sucesión de Puesto Crítico', standard: 'ISO 31000', code: 'OPE-RRH-010', description: 'Ausencia de un plan de reemplazo adecuado para un puesto operativo esencial.' },
                ],
            },
            'continuidad-operativa': {
                label: 'Continuidad Operativa',
                code: 'OPE-08',
                threats: [
                    { key: 'interrupcion-servicio-cliente-critico', name: 'Interrupción de Servicio a Cliente Crítico', standard: 'ISO 22301', code: 'OPE-CON-001', description: 'Falla en la entrega de producto o servicio a un cliente cuya relación es crítica para la operación.' },
                    { key: 'falla-plan-continuidad-no-probado', name: 'Falla de Plan de Continuidad No Probado', standard: 'ISO 22301', code: 'OPE-CON-002', description: 'Un plan de continuidad de negocio no funciona como se esperaba por no haberse probado previamente.' },
                    { key: 'dependencia-proveedor-unico', name: 'Dependencia de Proveedor Único', standard: 'ISO 22301', code: 'OPE-CON-003', description: 'La operación depende de un solo proveedor sin alternativa, generando un punto único de falla.' },
                    { key: 'perdida-sitio-alterno', name: 'Pérdida de Sitio Alterno de Operación', standard: 'ISO 22301', code: 'OPE-CON-004', description: 'El sitio previsto para continuar operando en caso de contingencia deja de estar disponible.' },
                    { key: 'falla-comunicacion-contingencia', name: 'Falla de Comunicación Interna en Contingencia', standard: 'ISO 22301', code: 'OPE-CON-005', description: 'Los canales de comunicación previstos para una emergencia no funcionan cuando se necesitan.' },
                    { key: 'incumplimiento-sla', name: 'Incumplimiento de Acuerdo de Nivel de Servicio (SLA)', standard: 'ISO 22301', code: 'OPE-CON-006', description: 'La organización no cumple con los tiempos o niveles de servicio comprometidos con un cliente.' },
                ],
            },
        },
    },
    // Dominio "Cadena de Suministro C-TPAT": expandido a petición del usuario para cubrir los
    // 9 Criterios Mínimos de Seguridad (MSC) del programa C-TPAT (Customs Trade Partnership
    // Against Terrorism, CBP), uno por categoría — EXCEPTO el pilar "Cybersecurity" que el
    // MSC sí incluye desde su actualización más reciente, deliberadamente omitido aquí: es de
    // ciberseguridad, fuera del alcance físico/patrimonial que ya se definió esta sesión (igual
    // que se excluyó NIST/MITRE de otros dominios). El nombre del dominio deja explícito que es
    // C-TPAT (no un dominio genérico de "riesgo de cadena de suministro" — esa distinción se
    // discutió con el usuario: el riesgo de continuidad de proveedores/logística ya vive en
    // Operacional → Continuidad Operativa; este dominio es específicamente sobre SEGURIDAD de
    // la cadena de suministro bajo ese programa de certificación).
    'cadena-suministro': {
        label: 'Cadena de Suministro C-TPAT',
        code: 'CTP',
        categories: {
            'socios-comerciales': {
                label: 'Seguridad de Socios Comerciales',
                code: 'CTP-01',
                threats: [
                    { key: 'seleccion-socio-sin-verificacion', name: 'Selección de Socio Comercial sin Verificación de Seguridad', standard: 'C-TPAT', code: 'CTP-SOC-001', description: 'Incorporación de un proveedor, transportista o socio sin evaluar su cumplimiento de criterios mínimos de seguridad.' },
                    { key: 'incumplimiento-socio-comercial', name: 'Incumplimiento de Seguridad por Socio Comercial', standard: 'C-TPAT', code: 'CTP-SOC-002', description: 'Un proveedor, transportista o socio de la cadena de suministro no cumple los criterios mínimos de seguridad exigidos.' },
                    { key: 'certificacion-ctpat-suspendida', name: 'Socio Comercial con Certificación C-TPAT Suspendida o Revocada', standard: 'C-TPAT', code: 'CTP-SOC-003', description: 'Se continúa operando con un socio cuya certificación C-TPAT fue suspendida o revocada, sin haberlo detectado.' },
                    { key: 'subcontratacion-no-autorizada', name: 'Subcontratación No Autorizada por Parte de un Socio Comercial', standard: 'C-TPAT', code: 'CTP-SOC-004', description: 'Un socio comercial delega parte del servicio a un tercero no evaluado ni autorizado.' },
                    { key: 'cambio-no-notificado-propietario', name: 'Cambio No Notificado de Propietario de un Socio Comercial', standard: 'C-TPAT', code: 'CTP-SOC-005', description: 'Un socio comercial cambia de dueño o de control sin notificarlo, alterando su perfil de riesgo.' },
                ],
            },
            'contenedores-transporte': {
                label: 'Seguridad de Contenedores y Medios de Transporte',
                code: 'CTP-02',
                threats: [
                    { key: 'manipulacion-contenedor', name: 'Manipulación No Autorizada de Contenedor', standard: 'C-TPAT', code: 'CTP-CON-001', description: 'Apertura o alteración indebida de un contenedor durante el trayecto.' },
                    { key: 'ausencia-inspeccion-7-puntos', name: 'Ausencia de Inspección de 7 Puntos del Contenedor', standard: 'C-TPAT', code: 'CTP-CON-002', description: 'El contenedor no se inspecciona (pared frontal, lados, piso, techo, puertas, exterior/chasis) antes de la carga.' },
                    { key: 'compartimento-oculto', name: 'Compartimento Oculto en Contenedor o Vehículo', standard: 'C-TPAT', code: 'CTP-CON-003', description: 'Existencia de un espacio no declarado en la estructura de un contenedor o vehículo, apto para ocultar mercancía o personas.' },
                    { key: 'contenedor-danado', name: 'Contenedor Dañado que Compromete su Integridad', standard: 'C-TPAT', code: 'CTP-CON-004', description: 'Daño estructural que facilita el acceso no autorizado al interior del contenedor.' },
                    { key: 'vehiculo-sin-verificacion-procedencia', name: 'Vehículo de Transporte sin Verificación de Procedencia', standard: 'C-TPAT', code: 'CTP-CON-005', description: 'Se recibe o despacha carga en un vehículo cuyo origen y operador no fueron verificados.' },
                    { key: 'contrabando-contenedores', name: 'Contrabando de Mercancía Ilícita en Contenedor', standard: 'C-TPAT', code: 'CTP-CON-006', description: 'Introducción de mercancía ilícita dentro de un contenedor o vehículo de carga.' },
                    { key: 'polizon-oculto', name: 'Polizón Oculto en Contenedor o Vehículo', standard: 'C-TPAT', code: 'CTP-CON-007', description: 'Una o más personas se ocultan dentro de un contenedor o vehículo de carga para cruzar una frontera sin ser detectadas.' },
                ],
            },
            'sellos-seguridad': {
                label: 'Seguridad de Sellos',
                code: 'CTP-03',
                threats: [
                    { key: 'sello-no-conforme-iso17712', name: 'Sello de Alta Seguridad No Conforme a Norma ISO 17712', standard: 'C-TPAT, ISO 17712', code: 'CTP-SEL-001', description: 'Se usa un sello que no cumple con la norma ISO 17712 para sellos de alta seguridad en contenedores de carga.' },
                    { key: 'manipulacion-sello-seguridad', name: 'Sustitución No Autorizada de Sello de Seguridad', standard: 'C-TPAT, ISO 17712', code: 'CTP-SEL-002', description: 'Un sello de seguridad es retirado y reemplazado sin autorización durante el trayecto.' },
                    { key: 'sello-aplicado-incorrectamente', name: 'Aplicación Incorrecta de Sello de Seguridad', standard: 'C-TPAT', code: 'CTP-SEL-003', description: 'El sello se coloca sin seguir el procedimiento establecido, reduciendo su efectividad.' },
                    { key: 'falta-verificacion-vvtt', name: 'Falta de Verificación VVTT del Sello al Recibir el Contenedor', standard: 'C-TPAT', code: 'CTP-SEL-004', description: 'No se aplica el procedimiento Ver-Verificar-Girar-Jalar (VVTT) al recibir un contenedor sellado.' },
                    { key: 'extravio-sellos-sin-usar', name: 'Extravío de Sellos de Seguridad sin Usar', standard: 'C-TPAT', code: 'CTP-SEL-005', description: 'Pérdida de sellos de seguridad aún no utilizados, que podrían emplearse para simular una cadena de custodia falsa.' },
                ],
            },
            'seguridad-procedimental': {
                label: 'Seguridad Procedimental',
                code: 'CTP-04',
                threats: [
                    { key: 'documentacion-embarque-incompleta', name: 'Documentación de Embarque Incompleta o Alterada', standard: 'C-TPAT', code: 'CTP-PRO-001', description: 'Los documentos de embarque están incompletos, ilegibles o muestran señales de alteración.' },
                    { key: 'discrepancia-manifiesto-carga', name: 'Discrepancia entre Manifiesto y Carga Física', standard: 'C-TPAT', code: 'CTP-PRO-002', description: 'La mercancía física no coincide con lo declarado en el manifiesto de carga.' },
                    { key: 'falta-conciliacion-inventario-ctpat', name: 'Falta de Conciliación de Inventario en Recepción o Despacho', standard: 'C-TPAT', code: 'CTP-PRO-003', description: 'No se concilia la cantidad recibida o despachada contra lo documentado.' },
                    { key: 'manejo-inadecuado-carga-alto-riesgo', name: 'Manejo Inadecuado de Carga de Alto Riesgo', standard: 'C-TPAT', code: 'CTP-PRO-004', description: 'Carga identificada como de alto riesgo no recibe el resguardo o supervisión adicional que exige el procedimiento.' },
                    { key: 'falta-procedimiento-reportar-anomalias', name: 'Falta de Procedimiento para Reportar Anomalías de Seguridad', standard: 'C-TPAT', code: 'CTP-PRO-005', description: 'No existe o no se sigue un procedimiento claro para reportar una anomalía de seguridad detectada en la cadena de suministro.' },
                ],
            },
            'controles-acceso-fisico': {
                label: 'Controles de Acceso Físico',
                code: 'CTP-05',
                threats: [
                    { key: 'ingreso-visitante-sin-registro', name: 'Ingreso de Visitante sin Registro', standard: 'C-TPAT', code: 'CTP-ACC-001', description: 'Una persona ajena ingresa a las instalaciones sin quedar registrada.' },
                    { key: 'falta-credencial-diferenciada', name: 'Falta de Credencial Diferenciada para Empleados, Visitantes y Proveedores', standard: 'C-TPAT', code: 'CTP-ACC-002', description: 'No hay forma visual de distinguir entre empleados, visitantes y proveedores dentro de las instalaciones.' },
                    { key: 'control-acceso-vehicular-deficiente', name: 'Control de Acceso Vehicular Deficiente', standard: 'C-TPAT', code: 'CTP-ACC-003', description: 'Los vehículos ingresan o salen de las instalaciones sin verificación adecuada.' },
                    { key: 'ausencia-verificacion-identidad-acceso', name: 'Ausencia de Verificación de Identidad en Punto de Acceso', standard: 'C-TPAT', code: 'CTP-ACC-004', description: 'El punto de acceso no verifica que la identidad de quien ingresa corresponda a su credencial.' },
                ],
            },
            'seguridad-fisica-instalaciones': {
                label: 'Seguridad Física de Instalaciones',
                code: 'CTP-06',
                threats: [
                    { key: 'perimetro-sin-cercado', name: 'Perímetro sin Cercado Adecuado', standard: 'C-TPAT', code: 'CTP-FIS-001', description: 'El perímetro de las instalaciones carece de una barrera física suficiente para disuadir el acceso no autorizado.' },
                    { key: 'iluminacion-perimetral-insuficiente', name: 'Iluminación Perimetral Insuficiente', standard: 'C-TPAT', code: 'CTP-FIS-002', description: 'La iluminación del perímetro y áreas críticas no es suficiente para la vigilancia nocturna.' },
                    { key: 'falla-alarma-intrusion', name: 'Falla de Sistema de Alarma de Intrusión', standard: 'C-TPAT', code: 'CTP-FIS-003', description: 'El sistema de alarma contra intrusión no funciona o no cubre un área crítica.' },
                    { key: 'punto-ciego-cctv', name: 'Punto Ciego de CCTV en Área Crítica', standard: 'C-TPAT', code: 'CTP-FIS-004', description: 'Existe un área de manejo de carga o acceso sin cobertura de cámaras.' },
                    { key: 'cerradura-baja-seguridad', name: 'Cerradura o Candado de Baja Seguridad en Puerta Crítica', standard: 'C-TPAT', code: 'CTP-FIS-005', description: 'Una puerta de acceso a carga o áreas restringidas usa un mecanismo de cierre fácil de forzar.' },
                    { key: 'estacionamiento-sin-separacion', name: 'Área de Estacionamiento sin Separación de Zonas de Carga', standard: 'C-TPAT', code: 'CTP-FIS-006', description: 'Los vehículos privados se estacionan sin separación física de las áreas de carga y descarga.' },
                ],
            },
            'seguridad-personal': {
                label: 'Seguridad de Personal',
                code: 'CTP-07',
                threats: [
                    { key: 'personal-no-verificado', name: 'Contratación sin Verificación de Antecedentes', standard: 'C-TPAT', code: 'CTP-PER-001', description: 'Personal sin verificación de antecedentes con acceso a carga, vehículos o instalaciones logísticas.' },
                    { key: 'personal-temporal-sin-verificacion', name: 'Personal Temporal sin Verificación de Antecedentes', standard: 'C-TPAT', code: 'CTP-PER-002', description: 'Personal eventual o subcontratado obtiene acceso sin pasar por el mismo proceso de verificación que el personal permanente.' },
                    { key: 'falta-baja-inmediata-acceso', name: 'Falta de Baja Inmediata de Acceso al Terminar Relación Laboral', standard: 'C-TPAT', code: 'CTP-PER-003', description: 'Los accesos y credenciales de un empleado no se cancelan de inmediato al terminar su relación laboral.' },
                    { key: 'acceso-areas-sensibles-injustificado', name: 'Acceso a Áreas Sensibles sin Necesidad Justificada', standard: 'C-TPAT', code: 'CTP-PER-004', description: 'Personal con acceso a áreas críticas de carga o seguridad sin que su función lo requiera.' },
                ],
            },
            'capacitacion-conciencia': {
                label: 'Capacitación y Conciencia de Seguridad',
                code: 'CTP-08',
                threats: [
                    { key: 'falta-capacitacion-deteccion-contrabando', name: 'Falta de Capacitación en Detección de Contrabando', standard: 'C-TPAT', code: 'CTP-CAP-001', description: 'El personal no está capacitado para reconocer indicios de contrabando en la carga.' },
                    { key: 'falta-capacitacion-manipulacion-indebida', name: 'Falta de Capacitación en Reconocimiento de Manipulación Indebida', standard: 'C-TPAT', code: 'CTP-CAP-002', description: 'El personal no está capacitado para identificar señales de que un contenedor o sello fue manipulado.' },
                    { key: 'desconocimiento-reporte-incidentes', name: 'Desconocimiento del Procedimiento de Reporte de Incidentes de Seguridad', standard: 'C-TPAT', code: 'CTP-CAP-003', description: 'El personal no sabe cómo o a quién reportar un incidente de seguridad detectado.' },
                ],
            },
            'seguridad-agricola': {
                label: 'Seguridad Agrícola',
                code: 'CTP-09',
                threats: [
                    { key: 'contaminacion-contenedor-plagas', name: 'Contaminación de Contenedor con Plagas o Material Vegetal', standard: 'C-TPAT', code: 'CTP-AGR-001', description: 'Presencia de plagas, insectos o material vegetal no declarado dentro de un contenedor de carga.' },
                    { key: 'presencia-suelo-materia-organica', name: 'Presencia de Suelo o Materia Orgánica en Contenedor', standard: 'C-TPAT', code: 'CTP-AGR-002', description: 'Se detecta tierra u otro material orgánico en un contenedor, con riesgo de introducir contaminación biológica.' },
                    { key: 'incumplimiento-limpieza-precarga', name: 'Incumplimiento de Limpieza de Contenedor Pre-Carga', standard: 'C-TPAT', code: 'CTP-AGR-003', description: 'El contenedor no se limpia conforme al procedimiento antes de cargar mercancía.' },
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
