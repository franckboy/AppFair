import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import {
    buildHistogramBins,
    computeCoveredIsoClauses,
    getSafeNumber,
    sanitizeHTML,
    severityToClasses,
    shortMetricLabel,
    showToast,
    simpleEvaluationMessage,
} from './utils.js';

// ============================================================
// App.RiskCascadeTree — vista de árbol/grafo del vínculo "Riesgos Desencadenantes" (Paso 1,
// opcional, ver App.FairWizard.renderTriggeredByRows): quién desencadena a quién, entre los
// riesgos ya guardados en el Registro — un riesgo puede tener MÁS de una causa a la vez (ver
// buildGraph, triggeredBy es un array). El árbol en sí es puramente informativo — lee
// state.fair.riskRegister tal cual quedó guardado, sin combinar ni recalcular ningún ALE por su
// cuenta. Combinar los riesgos vinculados SÍ existe, pero como una acción aparte y explícita
// ("Simular Familia", ver simulateFamily): simula de forma correlacionada (misma iteración Monte
// Carlo) para no sobreestimar por doble conteo (Broder, 1984) — el árbol nunca lo hace solo, sin
// que el usuario lo pida.
//
// Motor de dibujo: Cytoscape.js (+ cytoscape-dagre para el layout jerárquico, +
// cytoscape-node-html-label para superponer las tarjetas Tailwind reales sobre el grafo dibujado
// en <canvas>) — cargados como <script> CDN en app_fair.html. Reemplaza al motor anterior (CSS
// <ul>/<li> con pseudo-elementos como conectores), que era estructuralmente incapaz de mostrar un
// nodo con más de un padre sin duplicar su tarjeta. buildGraph() (abajo) es la única fuente de
// verdad del grafo; buildCyElements() solo la traduce al formato que espera Cytoscape.
// ============================================================
const formatAle = (value) =>
    typeof value === 'number'
        ? new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
          }).format(value)
        : '—';

// Zoom con botones (ver App.RiskCascadeTree.setZoom) — además, Cytoscape trae gratis pan por
// arrastre y zoom con rueda del mouse, que el motor CSS anterior no tenía (ese solo daba scroll
// de navegador). ZOOM_MIN/MAX/STEP acotan únicamente los 3 botones — el zoom nativo de Cytoscape
// (rueda/pellizco) no está limitado a este rango, ni el fit() inicial (ver render()).
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

// Se mantiene top-down (igual que el motor anterior) — cambiar la disposición visual junto con el
// motor de dibujo mezclaría dos decisiones en un solo diff. fit:false porque el encuadre inicial
// del visor lo maneja render() aparte (cy.fit()), no el layout en sí — así el mismo config sirve
// también para toggleBranch() (colapsar/expandir), donde SÍ queremos que los hermanos se
// reacomoden pero NO queremos que cada toggle también reencuadre el zoom/pan del usuario.
const DAGRE_LAYOUT = {
    name: 'dagre',
    rankDir: 'TB',
    nodeSep: 40,
    rankSep: 70,
    edgeSep: 10,
    ranker: 'network-simplex',
    fit: false,
    padding: 40,
    animate: false,
};

export const RiskCascadeTree = {
    _zoom: 1,
    // Instancia viva de Cytoscape, si el árbol tiene al menos 1 riesgo (ver render()) — null
    // mientras el Registro está vacío. render() la destruye y crea una nueva desde cero en cada
    // llamada (mismo espíritu que el innerHTML de siempre: reconstruir todo es más simple de
    // razonar que actualizar un grafo existente de forma incremental).
    _cy: null,
    // Guardián contra condición de carrera de red (mismo patrón que App.Treatment, ver el
    // comentario junto a _reduccionALERequestId ahí): si el usuario abre "Simular Familia" de un
    // riesgo, y antes de que llegue la respuesta abre el detalle de OTRO riesgo y también pide
    // "Simular Familia", no hay garantía de que las respuestas HTTP lleguen en el mismo orden en
    // que se pidieron. Sin esto, una respuesta vieja podía llegar después y pintar los números
    // de un riesgo bajo el título de otro.
    _familySimRequestId: 0,

    init() {
        document
            .getElementById('risk-tree-zoom-in-btn')
            .addEventListener('click', () => this.setZoom(this._zoom + ZOOM_STEP));
        document
            .getElementById('risk-tree-zoom-out-btn')
            .addEventListener('click', () => this.setZoom(this._zoom - ZOOM_STEP));
        document.getElementById('risk-tree-zoom-reset-btn').addEventListener('click', () => this.setZoom(1));
        document.getElementById('risk-tree-family-sim-close').addEventListener('click', () => {
            document.getElementById('risk-tree-family-simulation').classList.add('hidden');
        });

        // Un solo listener delegado, registrado UNA vez aquí — no dentro de render(). Cytoscape
        // reconstruye el CONTENIDO del contenedor en cada render() (destruye/crea una instancia
        // cy nueva), pero el propio #risk-cascade-tree-container nunca se reemplaza, así que este
        // listener sigue funcionando sin volver a engancharse. Los 4 casos son mutuamente
        // excluyentes por closest('[data-tree-*]'), sin necesidad de stopPropagation (a
        // diferencia del motor anterior, donde cada botón vivía dentro de un <li> reconstruido en
        // cada render y necesitaba su propio listener + stopPropagation).
        document.getElementById('risk-cascade-tree-container').addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('[data-tree-toggle]');
            const addChildBtn = e.target.closest('[data-tree-add-child]');
            const changeTriggerBtn = e.target.closest('[data-tree-change-trigger]');
            const card = e.target.closest('[data-tree-card]');

            if (toggleBtn) {
                const riskName = toggleBtn.closest('[data-tree-card]').querySelector('.risk-tree-name').textContent;
                this.toggleBranch(riskName, toggleBtn);
            } else if (addChildBtn) {
                const riskName = addChildBtn.closest('[data-tree-card]').querySelector('.risk-tree-name').textContent;
                this.openCreateChildModal(riskName);
            } else if (changeTriggerBtn) {
                const riskName = changeTriggerBtn
                    .closest('[data-tree-card]')
                    .querySelector('.risk-tree-name').textContent;
                this.openChangeTriggerModal(riskName);
            } else if (card) {
                this.openDetail(card.querySelector('.risk-tree-name').textContent);
            }
        });
    },

    setZoom(value) {
        this._zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
        if (this._cy) {
            // Zoom centrado en el visor (no en el origen del modelo) — mismo comportamiento que
            // un usuario esperaría de los botones +/−, y consistente con el zoom nativo de
            // rueda del mouse que Cytoscape ya da gratis.
            this._cy.zoom({
                level: this._zoom,
                renderedPosition: { x: this._cy.width() / 2, y: this._cy.height() / 2 },
            });
        }
        this._syncZoomLabel();
    },

    _syncZoomLabel() {
        document.getElementById('risk-tree-zoom-reset-btn').textContent = `${Math.round(this._zoom * 100)}%`;
    },

    // El zoom se reinicia a 100% cada vez que se entra a la página — un valor que quedó de la
    // visita anterior (ej. muy alejado) haría que el árbol se viera vacío/roto al volver, sin
    // ninguna pista de por qué. Si el Registro no está vacío, render() vuelve a ajustar el zoom
    // real al terminar (cy.fit(), ver más abajo) para que el árbol completo entre en el visor.
    async load() {
        this.setZoom(1);
        await App.FairRegister.loadRiskRegister(false);
        this.render();
    },

    // Arma el grafo completo a partir de triggeredBy — un riesgo puede tener MÁS DE UNA causa
    // (ej. un incendio en bodega puede venir de una falla eléctrica Y de mal almacenamiento de
    // inflamables, dos causas independientes), así que esto ya no es un bosque de árboles (un
    // nodo puede tener más de un padre) sino un grafo dirigido. `edges` es la forma plana que
    // consume directamente Cytoscape (ver buildCyElements) — cada arista es una causa VÁLIDA (el
    // padre existe en el Registro); una causa declarada hacia un riesgo que ya no existe
    // (borrado/renombrado) no genera arista, se anota en `node.broken` en su lugar.
    buildGraph() {
        const register = state.fair.riskRegister || [];
        const byName = new Map(register.map((r) => [r.riskName, r]));
        const edges = []; // { source: parentName, target: childName, probability }
        const brokenBy = new Map(); // riskName -> string[] (causas declaradas que ya no existen)

        register.forEach((r) => {
            (r.triggeredBy || []).forEach(({ riskName: parentName, probability }) => {
                if (!parentName || parentName === r.riskName) return;
                if (!byName.has(parentName)) {
                    if (!brokenBy.has(r.riskName)) brokenBy.set(r.riskName, []);
                    brokenBy.get(r.riskName).push(parentName);
                    return;
                }
                edges.push({ source: parentName, target: r.riskName, probability });
            });
        });

        const nodes = register.map((r) => ({ id: r.riskName, risk: r, broken: brokenBy.get(r.riskName) || [] }));
        return { nodes, edges };
    },

    // Todos los nombres alcanzables recorriendo `edges` a partir de una lista de nombres de
    // entrada (incluye a los propios nombres de entrada) — usado para (a) detectar riesgos que
    // NUNCA aparecen bajo ninguna raíz declarada (ver buildCyElements: un ciclo sin ninguna raíz
    // externa, ej. A desencadenado por B y B desencadenado por A, no cuelga de ningún root real y
    // quedaría fuera del árbol si no se busca aparte), (b) excluir los propios descendientes de
    // un riesgo al elegirle una nueva causa (ver openChangeTriggerModal — evita crear un ciclo
    // nuevo a propósito), y (c) calcular qué tarjetas ocultar al colapsar una rama (ver
    // toggleBranch).
    collectReachable(startRiskNames, edges) {
        const seen = new Set();
        const stack = [...startRiskNames];
        while (stack.length) {
            const cur = stack.pop();
            if (seen.has(cur)) continue;
            seen.add(cur);
            edges.filter((e) => e.source === cur).forEach((e) => stack.push(e.target));
        }
        return seen;
    },

    // Traduce buildGraph() (nodos + aristas planas) al formato de elementos que espera Cytoscape
    // — un array mixto de { data: {...} } para nodos y aristas. Detección de ciclos sin raíz:
    // mismo cálculo que antes (recorrer collectReachable desde las raíces reales, lo que quede
    // fuera forma parte de un ciclo), pero ahora se anota en TODOS los miembros del ciclo — ya no
    // hace falta elegir un único "punto de entrada" arbitrario como con el motor CSS anterior
    // (Cytoscape no recorre nada, solo dibuja lo que se le da).
    buildCyElements() {
        const { nodes, edges } = this.buildGraph();
        const roots = nodes.filter((n) => !edges.some((e) => e.target === n.id));
        const handled = this.collectReachable(
            roots.map((n) => n.id),
            edges,
        );
        const cycleNodes = new Set(nodes.filter((n) => !handled.has(n.id)).map((n) => n.id));

        const cyNodes = nodes.map((n) => ({ data: this.nodeData(n, edges, cycleNodes) }));
        const cyEdges = edges.map((e) => ({
            data: { id: `${e.source}=>${e.target}`, source: e.source, target: e.target },
        }));
        return [...cyNodes, ...cyEdges];
    },

    // `data` de un nodo Cytoscape — todo lo que cardHtml() necesita para pintar la tarjeta, más
    // `height`: un bucket fijo (100px normal / 140px con alguna nota) que dagre necesita ANTES de
    // que exista DOM real que medir (cytoscape-node-html-label superpone el HTML DESPUÉS de que
    // el layout ya corrió).
    nodeData(node, edges, cycleNodes) {
        const risk = node.risk;
        const isOpportunity = risk.riskType === 'oportunidad';
        // Un riesgo creado desde el botón "+" (ver openCreateChildModal) nace como stub, sin
        // TEF/Vulnerabilidad todavía — su ale es literalmente 0 porque nadie lo ha simulado, no
        // porque de verdad valga $0. Mostrarlo como "Aceptable"/verde (o azul, si es Oportunidad)
        // sería indistinguible de un riesgo YA evaluado — se fuerza gris (el mismo respaldo que
        // ya usa severityToClasses para severidad desconocida) y "Sin analizar" en vez del ALE.
        const neverSimulated = !risk.tef && !risk.vuln;
        const classes = neverSimulated
            ? 'bg-gray-50 border-gray-400 text-gray-700'
            : isOpportunity
              ? 'bg-blue-50 border-blue-500 text-blue-800'
              : severityToClasses(risk.severity);
        const typeLabel = isOpportunity ? 'Oportunidad' : 'Amenaza';
        const aleLabel = neverSimulated ? 'Sin analizar' : `${formatAle(risk.ale)}/año`;
        const hasChildren = edges.some((e) => e.source === node.id);
        const isCycle = cycleNodes.has(node.id);
        const hasNote = node.broken.length > 0 || isCycle;

        return {
            id: node.id,
            riskName: risk.riskName,
            classes,
            typeLabel,
            aleLabel,
            hasChildren,
            broken: node.broken,
            isCycle,
            height: hasNote ? 140 : 100,
            // Estado de colapso — vive en `data()` (no en el DOM ni en una clase Cytoscape
            // aparte) a propósito: cytoscape-node-html-label vuelve a pintar una tarjeta desde
            // cero (tpl(data), ver cardHtml) cada vez que el nodo dispara un evento "style"/
            // "data" — cosa que TAMBIÉN pasa por simples efectos colaterales del layout (dagre
            // reposiciona nodos vecinos al colapsar una rama), no solo por los cambios que hace
            // toggleBranch() a propósito. Cualquier cambio de DOM hecho por fuera de `data()` se
            // pierde en la siguiente repintada — guardar el estado AQUÍ, para que cada repintada
            // (sin importar qué la disparó) lo lea de la misma fuente y siempre salga correcto,
            // en vez de perseguir el momento exacto en que ya no lo va a sobreescribir.
            collapsed: false,
            hiddenByCollapse: false,
        };
    },

    // El HTML de una tarjeta — usado como tpl() de cytoscape-node-html-label (ver render()), que
    // lo superpone en una posición absoluta sincronizada con el nodo correspondiente del grafo.
    // Mismo contenido que antes armaba renderNode(), sin el <li>/<ul> envolvente (ya no hace
    // falta: Cytoscape no dibuja con listas anidadas). `data.collapsed`/`data.hiddenByCollapse`
    // (ver toggleBranch) determinan el estado visible de la tarjeta en CADA repintada — nunca se
    // parchea el DOM ya pintado a mano (ver el comentario en nodeData).
    cardHtml(data) {
        return `
            <div class="risk-tree-card cursor-pointer ${data.classes}${data.hiddenByCollapse ? ' hidden' : ''}" data-tree-card>
                <p class="risk-tree-name">${sanitizeHTML(data.riskName)}</p>
                <p class="risk-tree-meta">${data.typeLabel} · ${data.aleLabel}</p>
                ${data.broken
                    .map(
                        (parentName) =>
                            `<p class="risk-tree-orphan-note">⚠️ Vinculado a "${sanitizeHTML(parentName)}", que ya no está en el Registro (renombrado o eliminado).</p>`,
                    )
                    .join('')}
                ${
                    data.isCycle
                        ? `<p class="risk-tree-orphan-note">⚠️ Forma parte de un ciclo de desencadenantes (ej. A⟶B⟶A) sin ninguna raíz externa.</p>`
                        : ''
                }
                <div class="risk-tree-card-actions">
                    ${
                        data.hasChildren
                            ? `<button type="button" class="risk-tree-toggle" data-tree-toggle aria-expanded="${data.collapsed ? 'false' : 'true'}" title="Colapsar/expandir">${data.collapsed ? '▸' : '▾'}</button>`
                            : ''
                    }
                    <button type="button" class="risk-tree-add-child" data-tree-add-child title="Crear riesgo desencadenado por este">+</button>
                    <button type="button" class="risk-tree-change-trigger" data-tree-change-trigger title="Cambiar quién causó este riesgo">🔗</button>
                </div>
            </div>`;
    },

    render() {
        const container = document.getElementById('risk-cascade-tree-container');
        const scrollWrap = document.getElementById('risk-cascade-tree-scroll');
        const empty = document.getElementById('risk-cascade-tree-empty');
        if (!container) return;

        if (this._cy) {
            this._cy.destroy();
            this._cy = null;
        }

        const register = state.fair.riskRegister || [];
        if (register.length === 0) {
            container.innerHTML = '';
            scrollWrap.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        scrollWrap.classList.remove('hidden');

        this._cy = cytoscape({
            container,
            elements: this.buildCyElements(),
            layout: DAGRE_LAYOUT,
            // Los nodos son transparentes (el HTML real superpuesto por node-html-label es lo
            // único que se ve) — Cytoscape solo reserva el espacio/posición. width/height fijos
            // (mismo ancho que .risk-tree-card en tailwind-input.css) para que el rectángulo que
            // dagre usa para el layout coincida con el tamaño real de la tarjeta. Las aristas van
            // en ángulo recto (curve-style: taxi) sin flecha, mismo estilo visual que los
            // conectores CSS del motor anterior. `display` es una función leyendo
            // data(hiddenByCollapse) (ver toggleBranch/nodeData) en vez de una clase CSS — mismo
            // criterio que cardHtml: todo lo visual de una rama colapsada sale de `data()`, nunca
            // de un parche de DOM aparte.
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-opacity': 0,
                        'border-width': 0,
                        width: 210,
                        height: 'data(height)',
                        shape: 'rectangle',
                        display: (ele) => (ele.data('hiddenByCollapse') ? 'none' : 'element'),
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'taxi',
                        'taxi-direction': 'vertical',
                        'line-color': '#cbd5e1',
                        width: 2,
                        'target-arrow-shape': 'none',
                        display: (ele) => (ele.data('hiddenByCollapse') ? 'none' : 'element'),
                    },
                },
            ],
            boxSelectionEnabled: false,
            // Los nodos ya están posicionados por dagre — dejarlos arrastrables invitaría a
            // desalinear el árbol sin querer (el motor anterior tampoco permitía mover tarjetas).
            autoungrabify: true,
        });

        // enablePointerEvents:true es obligatorio — sin esto, cytoscape-node-html-label pone
        // pointer-events:none en las tarjetas superpuestas (pensado para etiquetas puramente
        // decorativas) y ninguno de los 3 botones ni el clic en la tarjeta funcionarían.
        this._cy.nodeHtmlLabel(
            [
                {
                    query: 'node',
                    halign: 'center',
                    valign: 'center',
                    halignBox: 'center',
                    valignBox: 'center',
                    tpl: (data) => this.cardHtml(data),
                },
            ],
            { enablePointerEvents: true },
        );

        // Encuadra el árbol completo en el visor sin scroll manual — mejora real sobre el motor
        // anterior, donde un árbol grande quedaba cortado hasta hacer scroll a mano. El zoom
        // resultante puede caer fuera de [ZOOM_MIN, ZOOM_MAX] (esos límites solo aplican a los 3
        // botones, ver setZoom) — se refleja tal cual en el botón "100%"/label.
        this._cy.fit(this._cy.elements(), 40);
        this._zoom = this._cy.zoom();
        this._syncZoomLabel();
    },

    // Colapsa/expande la rama de `riskName` — oculta (o vuelve a mostrar) todos sus
    // descendientes, calculados con collectReachable sobre las ARISTAS salientes de riskName (ya
    // no un `childrenOf.get()` de un solo padre por nodo).
    //
    // Todo el estado se escribe en `data()` (`collapsed` en el propio nodo, `hiddenByCollapse` en
    // sus descendientes y las aristas que los alcanzan) — nunca se parchea el DOM ya pintado.
    // Motivo real, no preferencia de estilo: cytoscape-node-html-label vuelve a pintar una
    // tarjeta desde cero (tpl(data), ver cardHtml) cada vez que su nodo dispara un evento
    // "style"/"data" en Cytoscape — y layout(...).run() dispara justo esos eventos en CUALQUIER
    // nodo que reposicione, no solo en los que toggleClass tocó a propósito (confirmado leyendo
    // su fuente: updateDataOrStyleCyHandler, con su propio setTimeout(fn, 0), reacciona a ambos).
    // Parchear el DOM directamente después de correr el layout es una carrera imposible de ganar
    // de forma confiable (no hay forma de saber cuántas de esas repinturas quedan pendientes ni
    // cuándo termina la última). Escribir el estado en `data()` la evita por completo: sin
    // importar cuándo o por qué se repinte una tarjeta, cardHtml() siempre lee la verdad vigente.
    toggleBranch(riskName, btnEl) {
        if (!this._cy) return;
        const { edges } = this.buildGraph();
        const descendants = this.collectReachable([riskName], edges);
        descendants.delete(riskName);
        const willCollapse = btnEl.getAttribute('aria-expanded') !== 'false';

        this._cy.getElementById(riskName).data('collapsed', willCollapse);
        this._cy.nodes().forEach((node) => {
            if (descendants.has(node.id())) node.data('hiddenByCollapse', willCollapse);
        });
        this._cy.edges().forEach((edge) => {
            if (descendants.has(edge.data('target'))) edge.data('hiddenByCollapse', willCollapse);
        });

        // Corre el layout SOLO sobre lo que sigue visible — así los hermanos de la rama
        // colapsada se reacomodan para llenar el espacio libre, en vez de que dagre siga
        // reservando el hueco de nodos ocultos que ya no participan del layout. `.filter()` (no
        // un selector de Cytoscape) para no depender de la sintaxis exacta de selectores sobre
        // campos booleanos de `data()`.
        this._cy
            .elements()
            .filter((ele) => !ele.data('hiddenByCollapse'))
            .layout(DAGRE_LAYOUT)
            .run();
    },

    // Crea un riesgo NUEVO, ya vinculado como desencadenado por `parentRiskName` — a diferencia
    // de armar el análisis completo en el wizard, esto solo reserva el lugar del riesgo en el
    // árbol (nace como stub: ale 0, sin TEF/Vulnerabilidad/Magnitud) para completarlo después
    // desde su propia tarjeta. Se guarda DIRECTO en el Registro (PUT /api/register/:nombre), no
    // como borrador de Análisis Rápido (/api/risks) — el árbol solo lee state.fair.riskRegister
    // (ver buildGraph), así que un borrador nunca aparecería aquí.
    // La probabilidad (0-100) que se captura aquí es la probabilidad condicional de esta arista
    // padre→hijo (triggeredBy[].probability) — el dato que usa runFamilyCascadeSimulation
    // (lib/cascadeSimulation.js, "Simular Familia") para simular la cascada correlacionada.
    openCreateChildModal(parentRiskName) {
        Modal.title.textContent = 'Crear riesgo desencadenado';
        Modal.body.innerHTML = `
            <p class="description-text mb-3">
                Este riesgo quedará vinculado como consecuencia de "${sanitizeHTML(parentRiskName)}". Nace sin
                analizar — puedes completar su FAIR completo después, desde su propia tarjeta.
            </p>
            <p id="tree-create-child-error" class="text-red-600 text-sm mb-3 hidden"></p>
            <div class="input-group">
                <label for="tree-child-name">Nombre del riesgo:</label>
                <input type="text" id="tree-child-name" class="form-input" placeholder="Ej. Daño reputacional">
                <button type="button" id="tree-child-open-catalog-btn" class="btn btn-secondary text-sm mt-2">📋 Elegir del Catálogo de Riesgos</button>
            </div>
            <div class="input-group">
                <label for="tree-child-description">Descripción (opcional):</label>
                <textarea id="tree-child-description" class="form-textarea" rows="2"></textarea>
            </div>
            <div class="input-group">
                <label for="tree-child-type">Tipo:</label>
                <select id="tree-child-type" class="form-select">
                    <option value="amenaza">Amenaza (riesgo negativo)</option>
                    <option value="oportunidad">Oportunidad (riesgo positivo)</option>
                </select>
            </div>
            <div class="input-group">
                <label for="tree-child-probability">
                    ¿Qué tan probable es que esto ocurra SI "${sanitizeHTML(parentRiskName)}" ocurre? (%)
                </label>
                <input type="number" id="tree-child-probability" class="form-input" value="50" min="0" max="100">
            </div>
        `;
        Modal.footer.innerHTML = `
            <button id="tree-create-child-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="tree-create-child-save-btn" class="btn btn-primary">Crear riesgo</button>
        `;
        Modal.modal.classList.remove('hidden');

        document.getElementById('tree-child-open-catalog-btn').addEventListener('click', () => {
            // openPicker reemplaza Modal.body/footer por completo (mismo modal compartido) para
            // mostrar el catálogo — eso destruye tree-child-name/tree-child-description mientras
            // el catálogo está abierto, así que el picker no puede escribirles directo (a
            // diferencia de fair-riskName en el Paso 1, que vive FUERA del modal). Por eso se usa
            // el modo callback de openPicker: reabrimos "Crear riesgo desencadenado" desde cero y
            // ahí sí volvemos a rellenar todo, incluyendo lo que ya tenía Tipo/Probabilidad.
            const nameInput = document.getElementById('tree-child-name');
            const previousName = nameInput.value;
            const previousDescription = document.getElementById('tree-child-description').value;
            const previousType = document.getElementById('tree-child-type').value;
            const previousProbability = document.getElementById('tree-child-probability').value;
            // catalogStandard/catalogCode del threat elegido (si se eligió alguno) viajan en el
            // dataset de tree-child-name en vez de en una variable — este handler se vuelve a
            // registrar desde cero cada vez que reopenWith llama a openCreateChildModal, así que
            // una variable normal no sobreviviría a un segundo viaje por el catálogo.
            const previousCatalogStandard = nameInput.dataset.catalogStandard || '';
            const previousCatalogCode = nameInput.dataset.catalogCode || '';
            const reopenWith = (name, description, catalogStandard, catalogCode) => {
                this.openCreateChildModal(parentRiskName);
                const newNameInput = document.getElementById('tree-child-name');
                newNameInput.value = name;
                newNameInput.dataset.catalogStandard = catalogStandard || '';
                newNameInput.dataset.catalogCode = catalogCode || '';
                document.getElementById('tree-child-description').value = description;
                document.getElementById('tree-child-type').value = previousType;
                document.getElementById('tree-child-probability').value = previousProbability;
            };
            App.RiskCatalog.openPicker('tree-child-name', 'tree-child-description', {
                onSelect: (threat) =>
                    reopenWith(
                        threat.name,
                        previousDescription.trim() ? previousDescription : threat.description,
                        threat.standard,
                        threat.code,
                    ),
                onCancel: () =>
                    reopenWith(previousName, previousDescription, previousCatalogStandard, previousCatalogCode),
            });
        });
        document.getElementById('tree-create-child-cancel-btn').addEventListener('click', () => Modal.hide());
        document.getElementById('tree-create-child-save-btn').addEventListener('click', async (e) => {
            const nameInput = document.getElementById('tree-child-name');
            const name = nameInput.value.trim();
            const description = document.getElementById('tree-child-description').value.trim();
            const riskType = document.getElementById('tree-child-type').value;
            const probability = getSafeNumber(document.getElementById('tree-child-probability'));
            const catalogStandard = nameInput.dataset.catalogStandard || null;
            const catalogCode = nameInput.dataset.catalogCode || null;
            const errorEl = document.getElementById('tree-create-child-error');

            if (!name) {
                errorEl.textContent = 'El nombre del riesgo es obligatorio.';
                errorEl.classList.remove('hidden');
                return;
            }
            if (!(probability >= 0 && probability <= 100)) {
                errorEl.textContent = 'La probabilidad debe estar entre 0 y 100.';
                errorEl.classList.remove('hidden');
                return;
            }

            const saveBtn = e.target;
            saveBtn.disabled = true;
            try {
                await App.Api.request(`/api/register/${encodeURIComponent(name)}`, {
                    method: 'PUT',
                    body: {
                        id: crypto.randomUUID(),
                        ale: 0,
                        cvar95: 0,
                        riskType,
                        description: description || null,
                        triggeredBy: [{ riskName: parentRiskName, probability }],
                        catalogStandard,
                        catalogCode,
                    },
                });
                Modal.hide();
                showToast(`"${name}" creado y vinculado a "${parentRiskName}".`);
                await App.FairRegister.loadRiskRegister(false);
                this.render();
            } catch (err) {
                errorEl.textContent = err.userMessage || 'No se pudo crear el riesgo. Intenta de nuevo.';
                errorEl.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
            }
        });
    },

    // Cambia (agrega/quita) las causas ("Riesgo Desencadenante") de un riesgo YA guardado,
    // directo desde su tarjeta — a diferencia de openCreateChildModal (crea un riesgo NUEVO ya
    // vinculado), esto reasigna el vínculo de uno que ya existe: sirve tanto para darle causa a
    // un huérfano como para "adoptar" un riesgo existente como hijo (abriendo esto desde la
    // tarjeta del futuro hijo, no la del padre — "hermano" no necesita nada aparte: dos riesgos
    // con la misma causa ya lo son). Un riesgo puede tener MÁS de una causa a la vez (ej. un
    // incendio en bodega puede venir de una falla eléctrica Y de mal almacenamiento de
    // inflamables) — de ahí la lista de filas en vez de un solo <select>, mismo patrón que
    // App.Treatment.openControlsModal (treatment.js: array de trabajo `working`,
    // syncWorkingFromDom() antes de cada re-render, filas con botón "✕", "+ Agregar" al final).
    //
    // Guarda con PUT /api/register/:nombre, igual que el resto de la app (Treatment.
    // persistTreatment, RiskManagement.persist, adoptStrategy) — ese endpoint REEMPLAZA la
    // entrada completa, así que el body parte de `{...risk}` (todo lo demás intacto) y solo pisa
    // triggeredBy. No hace falta volver a simular: es el mismo campo que ya guarda el Paso 1 del
    // wizard, sin tocar ningún cálculo.
    openChangeTriggerModal(riskName) {
        const register = state.fair.riskRegister || [];
        const risk = register.find((r) => r.riskName === riskName);
        if (!risk) {
            showToast('No se encontró este riesgo en el Registro.');
            return;
        }

        // Bug real que este modal evita, a diferencia del Paso 1 del wizard (que solo excluye el
        // propio nombre): elegir aquí a uno de los DESCENDIENTES del riesgo actual como una de
        // sus causas crearía un ciclo (A causado por B, B causado por A) de forma directa e
        // inmediata, no un caso raro de renombrar/borrar más tarde. Se calculan con
        // collectReachable (mismo helper que ya usa buildCyElements para detectar ciclos
        // existentes) — fijo durante la vida del modal, no cambia entre filas.
        const { edges } = this.buildGraph();
        const descendants = this.collectReachable([riskName], edges);
        const working = (risk.triggeredBy || []).map((t) => ({ ...t }));

        // A diferencia de `descendants` (fijo), qué otros riesgos ya están elegidos en OTRAS
        // filas sí cambia en cada render — evita repetir la misma causa dos veces en el array.
        const optionsFor = (rowIndex) => {
            const chosenElsewhere = new Set(
                working.map((t, i) => (i === rowIndex ? null : t.riskName)).filter(Boolean),
            );
            return register.filter(
                (r) => r.riskName !== riskName && !descendants.has(r.riskName) && !chosenElsewhere.has(r.riskName),
            );
        };

        const renderRow = (cause, i) => `
            <tr data-cause-row data-index="${i}">
                <td class="px-2 py-1">
                    <select class="form-select" data-field="riskName">
                        <option value="">— Elige un riesgo —</option>
                        ${optionsFor(i)
                            .map(
                                (r) =>
                                    `<option value="${sanitizeHTML(r.riskName)}" ${r.riskName === cause.riskName ? 'selected' : ''}>${sanitizeHTML(r.riskName)}</option>`,
                            )
                            .join('')}
                    </select>
                </td>
                <td class="px-2 py-1">
                    <input type="number" class="form-input" data-field="probability" min="0" max="100"
                        placeholder="%" value="${typeof cause.probability === 'number' ? cause.probability : ''}">
                </td>
                <td class="py-1"><button type="button" class="btn btn-danger text-xs" data-remove-cause title="Quitar esta causa">✕</button></td>
            </tr>`;

        const render = () => {
            Modal.title.textContent = 'Cambiar Riesgo Desencadenante';
            Modal.body.innerHTML = `
                <p class="description-text mb-3">
                    Elige qué riesgo(s) causaron a "${sanitizeHTML(riskName)}" — puede ser más de uno. Déjalo sin
                    ninguno si es un punto de partida (no lo causó otro riesgo ya guardado). Los riesgos que ya
                    dependen de este (sus propios hijos/nietos) no aparecen en la lista, para no crear un ciclo.
                </p>
                <p id="tree-change-trigger-error" class="text-red-600 text-sm mb-3 hidden"></p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-left border-b">
                                <th class="px-2 py-1">Causado por</th>
                                <th class="px-2 py-1">Probabilidad (%)</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="tree-change-trigger-body">${working.map(renderRow).join('')}</tbody>
                    </table>
                </div>
                <button type="button" id="tree-change-trigger-add-btn" class="btn btn-secondary text-sm mt-3">+ Agregar causa</button>
            `;
            Modal.footer.innerHTML = `
                <button id="tree-change-trigger-cancel-btn" class="btn btn-secondary">Cancelar</button>
                <button id="tree-change-trigger-save-btn" class="btn btn-primary">Guardar</button>
            `;
            Modal.modal.classList.remove('hidden');

            document.getElementById('tree-change-trigger-add-btn').addEventListener('click', () => {
                // Sin esto, agregar una fila pintaba TODAS desde `working` sin haber leído antes
                // lo que el usuario ya había escrito en pantalla — perdía ediciones en curso.
                syncWorkingFromDom();
                working.push({ riskName: '', probability: null });
                render();
            });
            document.querySelectorAll('[data-remove-cause]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    syncWorkingFromDom();
                    const i = Number(btn.closest('[data-cause-row]').dataset.index);
                    working.splice(i, 1);
                    render();
                });
            });
            document.getElementById('tree-change-trigger-cancel-btn').addEventListener('click', () => Modal.hide());
            document.getElementById('tree-change-trigger-save-btn').addEventListener('click', async (e) => {
                syncWorkingFromDom();
                const errorEl = document.getElementById('tree-change-trigger-error');
                const finalCauses = working.filter((t) => t.riskName);

                for (const t of finalCauses) {
                    if (!(t.probability === null || (t.probability >= 0 && t.probability <= 100))) {
                        errorEl.textContent = `La probabilidad de "${t.riskName}" debe estar entre 0 y 100.`;
                        errorEl.classList.remove('hidden');
                        return;
                    }
                }

                const saveBtn = e.target;
                saveBtn.disabled = true;
                try {
                    await App.Api.request(`/api/register/${encodeURIComponent(riskName)}`, {
                        method: 'PUT',
                        body: { ...risk, triggeredBy: finalCauses },
                    });
                    Modal.hide();
                    showToast(
                        finalCauses.length > 0
                            ? `"${riskName}" ahora está vinculado como consecuencia de ${
                                  finalCauses.length === 1
                                      ? `"${finalCauses[0].riskName}"`
                                      : `${finalCauses.length} riesgos`
                              }.`
                            : `"${riskName}" ya no tiene ningún riesgo desencadenante.`,
                    );
                    await App.FairRegister.loadRiskRegister(false);
                    this.render();
                } catch (err) {
                    errorEl.textContent = err.userMessage || 'No se pudo guardar el vínculo. Intenta de nuevo.';
                    errorEl.classList.remove('hidden');
                } finally {
                    saveBtn.disabled = false;
                }
            });
        };

        // Relee los inputs de cada fila hacia `working` — se usa antes de cualquier acción que
        // vuelva a renderizar (agregar/quitar fila) o que guarde, para no perder ediciones en
        // curso en las filas que no cambiaron.
        const syncWorkingFromDom = () => {
            document.querySelectorAll('[data-cause-row]').forEach((row) => {
                const i = Number(row.dataset.index);
                const rawProbability = row.querySelector('[data-field="probability"]').value.trim();
                working[i] = {
                    riskName: row.querySelector('[data-field="riskName"]').value,
                    probability: rawProbability === '' ? null : Number(rawProbability),
                };
            });
        };

        render();
    },

    // Detalle completo de un riesgo al hacer clic en su tarjeta (mismo `Modal` que ya usan el
    // Catálogo de Riesgos y el Catálogo de Activos) — evita tener que salir del árbol para ver
    // la descripción/estatus completos. "Tratar" manda a #treatmentPage (App.Treatment) con
    // este riesgo ya elegido — se omite para una Oportunidad, que esa página tampoco acepta
    // (un beneficio esperado no es una pérdida a reducir, ver App.Treatment.populateRiskSelect).
    openDetail(riskName) {
        const risk = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!risk) {
            showToast('No se encontró este riesgo en el Registro.');
            return;
        }
        const isOpportunity = risk.riskType === 'oportunidad';
        // Mismo criterio que nodeData: un riesgo creado desde "+" (ver openCreateChildModal)
        // nace sin TEF/Vulnerabilidad — su ale de $0 es "nadie lo ha simulado todavía", no un
        // resultado real. "Tratar" tampoco tiene sentido sin un ALE real que reducir — se ofrece
        // "Continuar en FAIR" en su lugar, que retoma exactamente donde el "+" lo dejó.
        const neverSimulated = !risk.tef && !risk.vuln;
        const badgeClasses = neverSimulated
            ? 'bg-gray-50 border-gray-400 text-gray-700'
            : isOpportunity
              ? 'bg-blue-50 border-blue-500 text-blue-800'
              : risk.evaluationClasses || severityToClasses(risk.severity);
        const badgeLabel = neverSimulated
            ? 'Sin analizar'
            : isOpportunity
              ? 'Oportunidad'
              : risk.evaluationLevel || '—';

        Modal.title.textContent = risk.riskName;
        Modal.body.innerHTML = `
            <div class="flex justify-between items-start flex-wrap gap-2 mb-3">
                <span class="px-2 py-1 rounded text-xs border-l-4 ${badgeClasses}">${sanitizeHTML(badgeLabel)}</span>
            </div>
            <p class="description-text mb-3">${sanitizeHTML(risk.description || 'Sin descripción.')}</p>
            ${
                neverSimulated
                    ? `<p class="description-text mb-3">Todavía no se ha corrido un análisis FAIR completo para este riesgo — usa "Continuar en FAIR" para completarlo.</p>`
                    : `
            <ul class="text-sm text-gray-700 space-y-1 mb-3">
                <li><strong>Activo:</strong> ${sanitizeHTML(risk.asset || '—')}</li>
                <li><strong>Agente de Amenaza:</strong> ${sanitizeHTML(risk.threat || '—')}</li>
                <li><strong>Responsable:</strong> ${sanitizeHTML(risk.owner || '—')}</li>
                <li><strong>${isOpportunity ? 'Beneficio' : 'Pérdida'} Anual Esperada:</strong> ${formatAle(risk.ale)}</li>
                <li><strong>Mediana:</strong> ${formatAle(risk.median)}</li>
                <li><strong>${shortMetricLabel('p90', 'P90')}:</strong> ${formatAle(risk.p90)}</li>
                <li><strong>${shortMetricLabel('cvar95', 'CVaR 95%')}:</strong> ${formatAle(risk.cvar95)}</li>
                ${risk.evaluationJustification ? `<li><strong>Justificación:</strong> ${sanitizeHTML(risk.evaluationJustification)}</li>` : ''}
            </ul>`
            }
            ${this.renderMarcoNormativo(risk)}
        `;
        Modal.body.querySelectorAll('[data-chip-toggle]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const desc = btn.nextElementSibling;
                if (desc) desc.classList.toggle('hidden');
            });
        });
        // "Simular Familia" solo tiene sentido para un riesgo YA analizado (necesita su propio
        // tef/vuln para poder re-simularse) y de tipo Amenaza (ver runFamilyCascadeSimulation en
        // el backend: una Oportunidad se excluye de la suma de familia, así que ofrecer el botón
        // en una no llevaría a nada útil). No depende de tener hijos — simular la "familia" de un
        // riesgo sin descendientes es válido, da el mismo resultado que simularlo solo.
        const canSimulateFamily = !neverSimulated && !isOpportunity;
        Modal.footer.innerHTML = `
            <button id="risktree-detail-close-btn" class="btn btn-secondary">Cerrar</button>
            ${canSimulateFamily ? '<button id="risktree-detail-simulate-family-btn" class="btn btn-secondary">Simular Familia</button>' : ''}
            ${
                neverSimulated
                    ? '<button id="risktree-detail-continue-btn" class="btn btn-primary">Continuar en FAIR</button>'
                    : isOpportunity
                      ? ''
                      : '<button id="risktree-detail-tratar-btn" class="btn btn-primary">Tratar</button>'
            }
        `;
        Modal.modal.classList.remove('hidden');

        document.getElementById('risktree-detail-close-btn').addEventListener('click', () => Modal.hide());
        if (canSimulateFamily) {
            document.getElementById('risktree-detail-simulate-family-btn').addEventListener('click', () => {
                Modal.hide();
                this.simulateFamily(risk.riskName);
            });
        }
        if (neverSimulated) {
            document.getElementById('risktree-detail-continue-btn').addEventListener('click', () => {
                Modal.hide();
                App.Navigation.switchPage('fair');
                App.FairWizard.loadRegisteredRiskIntoForm(risk.riskName);
            });
        } else if (!isOpportunity) {
            document.getElementById('risktree-detail-tratar-btn').addEventListener('click', () => {
                Modal.hide();
                App.Navigation.switchPage('treatment');
                App.Treatment.load(risk.riskName);
            });
        }
    },

    // "Marco Normativo": la norma de la amenaza elegida del catálogo (risk.catalogStandard, ver
    // App.RiskCatalog.useSelected) + los puntos de ISO 31000 que este riesgo ya cubrió, según lo
    // que de verdad tiene guardado (ver computeCoveredIsoClauses en utils.js — nunca una casilla
    // marcada a mano). Cada uno se pinta como un chip; el texto vacío ('') hace que no aparezca
    // nada si el riesgo no tiene ni norma ni ningún punto cubierto (ej. un stub "Sin analizar").
    // Los chips se resuelven contra state.quick.hazardStandards/isoProcessClauses (cargados en
    // el bootstrap, ver App.Api.bootstrap) — si un token no está en el catálogo (no debería
    // pasar, hay un test de consistencia en el backend) se muestra igual, solo sin descripción.
    renderMarcoNormativo(risk) {
        const standardTokens = (risk.catalogStandard || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        const clauseCodes = computeCoveredIsoClauses(risk);
        if (standardTokens.length === 0 && clauseCodes.length === 0) return '';

        const hazardStandards = state.quick.hazardStandards || {};
        const isoProcessClauses = state.quick.isoProcessClauses || {};

        const renderChip = (label, description) => `
            <span class="marco-normativo-chip-wrap">
                <button type="button" class="marco-normativo-chip" data-chip-toggle>${sanitizeHTML(label)}</button>
                ${description ? `<span class="marco-normativo-chip-desc hidden">${sanitizeHTML(description)}</span>` : ''}
            </span>`;

        const standardChips = standardTokens
            .map((token) => {
                const ref = hazardStandards[token];
                return renderChip(ref ? ref.name : token, ref ? ref.description : '');
            })
            .join('');
        const clauseChips = clauseCodes
            .map((code) => {
                const ref = isoProcessClauses[code];
                return renderChip(ref ? `${code} — ${ref.title}` : code, ref ? ref.summary : '');
            })
            .join('');

        return `
            <div class="mt-3 pt-3 border-t border-gray-200">
                <p class="text-sm font-semibold text-gray-700 mb-1">Marco Normativo</p>
                ${
                    standardChips
                        ? `<p class="marco-normativo-group-label">Norma de la amenaza:</p><div class="mb-2">${standardChips}</div>`
                        : ''
                }
                ${
                    clauseChips
                        ? `<p class="marco-normativo-group-label">ISO 31000 — Proceso de gestión de riesgos (cláusula 6):</p><div>${clauseChips}</div>`
                        : ''
                }
            </div>`;
    },

    // Simula, de forma correlacionada, la pérdida anual combinada de `riskName` y todos sus
    // descendientes en el Árbol de Riesgos (POST /api/cascade/:riskName/simulate-family, ver
    // runFamilyCascadeSimulation en el backend) — mismo patrón visual que
    // App.FairRegister.simulateRegisteredRisk (loader/body/histograma/Chart.js), pero en su
    // propia sección de esta página (#risk-tree-family-simulation), no en un modal: un
    // <canvas> de Chart.js necesita vivir en el DOM de forma persistente, no dentro del Modal
    // compartido (que se reemplaza por completo cada vez que se abre otra cosa).
    async simulateFamily(riskName) {
        const section = document.getElementById('risk-tree-family-simulation');
        const loading = document.getElementById('risk-tree-family-sim-loading');
        const body = document.getElementById('risk-tree-family-sim-body');
        document.getElementById('risk-tree-family-sim-title').textContent = `Simulación de Familia: ${riskName}`;
        section.classList.remove('hidden');
        loading.classList.remove('hidden');
        loading.textContent = 'Simulando la familia completa (10,000 escenarios)…';
        body.classList.add('hidden');
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });

        const requestId = ++this._familySimRequestId;
        let result;
        try {
            result = await App.Api.request(`/api/cascade/${encodeURIComponent(riskName)}/simulate-family`, {
                method: 'POST',
                body: { iterations: 10000, seed: 0 },
            });
        } catch (err) {
            if (requestId !== this._familySimRequestId) return; // ver el guardián documentado arriba, junto a RiskCascadeTree
            loading.textContent = err.userMessage || 'No se pudo simular la familia de este riesgo.';
            return;
        }
        if (requestId !== this._familySimRequestId) return; // respuesta vieja, ya superada por otra más nueva

        loading.classList.add('hidden');
        body.classList.remove('hidden');

        const formatCurrency = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
        document.getElementById('risk-tree-family-sim-ale').textContent = formatCurrency(result.summary.average);
        document.getElementById('risk-tree-family-sim-median').textContent = formatCurrency(result.summary.median);
        document.getElementById('risk-tree-family-sim-p90').textContent = formatCurrency(result.summary.p90);
        document.getElementById('risk-tree-family-sim-cvar').textContent = formatCurrency(result.summary.cvar95);

        const banner = document.getElementById('risk-tree-family-sim-evaluation');
        banner.className = `p-4 rounded-lg mb-4 border-l-4 ${severityToClasses(result.evaluation.severity)}`;
        const familyJustification =
            App.UIMode.mode === 'simple'
                ? simpleEvaluationMessage(
                      result.evaluation,
                      result.summary.average,
                      result.summary.cvar95,
                      'amenaza',
                      formatCurrency,
                  )
                : result.evaluation.justification;
        banner.innerHTML = `
            <p class="font-bold">Evaluación de familia: ${sanitizeHTML(result.evaluation.level)}</p>
            <p class="text-sm mt-1">${sanitizeHTML(familyJustification)}</p>
        `;

        const membersEl = document.getElementById('risk-tree-family-sim-members');
        const isSimpleMode = App.UIMode.mode === 'simple';
        const includedItems = (result.includedRiskNames || [])
            .map((name) => {
                const rate = Math.round(result.activationRates[name] || 0);
                const activationText = isSimpleMode
                    ? `ocurrió en ${rate} de cada 100 años simulados`
                    : `se activó en el ${rate}% de los escenarios`;
                return `<li>✅ ${sanitizeHTML(name)} — ${activationText}</li>`;
            })
            .join('');
        const excludedItems = (result.excludedRiskNames || [])
            .map((e) => `<li>⚪ ${sanitizeHTML(e.riskName)} — excluido: ${sanitizeHTML(e.reason)}</li>`)
            .join('');
        membersEl.innerHTML = `<ul class="text-sm space-y-1">${includedItems}${excludedItems}</ul>`;

        const ctx = document.getElementById('risk-tree-family-sim-chart').getContext('2d');
        const { labels, binCounts } = buildHistogramBins(result.annualLosses, result.summary.max);
        if (state.fair.familyCascadeChart) state.fair.familyCascadeChart.destroy();
        state.fair.familyCascadeChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Frecuencia de Pérdida Anual (familia)',
                        data: binCounts,
                        backgroundColor: 'rgba(147, 51, 234, 0.6)',
                        borderColor: 'rgba(147, 51, 234, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Nº de Simulaciones' } },
                    x: {
                        title: { display: true, text: 'Pérdida Anual Estimada (miles de USD)' },
                        ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 },
                    },
                },
            },
        });
    },
};

App.RiskCascadeTree = RiskCascadeTree;
