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

// Zoom con botones sobre el árbol ya existente (ver .risk-tree-zoom-wrap en tailwind-input.css)
// — el pellizco de dos dedos en móvil ya lo da el navegador gratis (el <meta name="viewport">
// de la app no lo bloquea), esto es solo para desktop/cuando el gesto no es cómodo. Puro
// transform: scale() sobre el wrapper, sin ninguna librería de canvas/pan-zoom: el árbol sigue
// siendo el mismo <ul>/<li> con conectores CSS de siempre, solo que ahora vive en un visor con
// su propio alto y scroll (ver .risk-tree-viewport) en vez de mezclado en el flujo de la página.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

export const RiskCascadeTree = {
    _zoom: 1,
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
    },

    setZoom(value) {
        this._zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
        document.getElementById('risk-cascade-tree-zoom-wrap').style.transform = `scale(${this._zoom})`;
        document.getElementById('risk-tree-zoom-reset-btn').textContent = `${Math.round(this._zoom * 100)}%`;
    },

    // El zoom se reinicia a 100% cada vez que se entra a la página — un valor que quedó de la
    // visita anterior (ej. muy alejado) haría que el árbol se viera vacío/roto al volver, sin
    // ninguna pista de por qué.
    async load() {
        this.setZoom(1);
        await App.FairRegister.loadRiskRegister(false);
        this.render();
    },

    // Arma el grafo completo a partir de triggeredBy — un riesgo puede tener MÁS DE UNA causa
    // (ej. un incendio en bodega puede venir de una falla eléctrica Y de mal almacenamiento de
    // inflamables, dos causas independientes), así que esto ya no es un bosque de árboles (un
    // nodo puede tener más de un padre) sino un grafo dirigido. `edges` es la forma plana que
    // consume directamente Cytoscape (ver el plan de migración) — cada arista es una causa
    // VÁLIDA (el padre existe en el Registro); una causa declarada hacia un riesgo que ya no
    // existe (borrado/renombrado) no genera arista, se anota en `node.broken` en su lugar.
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

    // TEMPORAL, mientras el motor de dibujo siga siendo el <ul>/<li> CSS de render()/renderNode()
    // (ver el plan de migración a Cytoscape.js, que sí soporta múltiples padres por nodo de
    // forma nativa): esa técnica de dibujo solo puede mostrar UN padre por tarjeta, así que
    // buildForest() sigue existiendo como una vista DERIVADA de buildGraph() que colapsa a "solo
    // la primera causa declarada" por riesgo — un riesgo con 2+ causas reales se dibuja aquí bajo
    // la primera nada más, sin perder el dato (buildGraph()/el Registro sí las guarda todas). Se
    // retira en cuanto Cytoscape reemplace a render()/renderNode().
    buildForest() {
        const { nodes, edges } = this.buildGraph();
        const childrenOf = new Map();
        const roots = [];

        nodes.forEach((n) => {
            const firstEdge = edges.find((e) => e.target === n.id);
            if (!firstEdge) {
                roots.push({
                    risk: n.risk,
                    orphan: n.broken.length > 0,
                    orphanParentName: n.broken[0] || null,
                });
                return;
            }
            if (!childrenOf.has(firstEdge.source)) childrenOf.set(firstEdge.source, []);
            childrenOf.get(firstEdge.source).push(n.risk);
        });

        return { roots, childrenOf };
    },

    // Todos los nombres alcanzables recorriendo `edges` a partir de una lista de nombres de
    // entrada — usado para (a) detectar riesgos que NUNCA aparecen bajo ninguna raíz declarada
    // (ver render(): un ciclo sin ninguna raíz externa, ej. A desencadenado por B y B
    // desencadenado por A, no cuelga de ningún root real y quedaría fuera del árbol si no se
    // busca aparte) y (b) excluir los propios descendientes de un riesgo al elegirle una nueva
    // causa (ver openChangeTriggerModal — evita crear un ciclo nuevo a propósito).
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

    render() {
        const container = document.getElementById('risk-cascade-tree-container');
        const scrollWrap = document.getElementById('risk-cascade-tree-scroll');
        const empty = document.getElementById('risk-cascade-tree-empty');
        if (!container) return;

        const register = state.fair.riskRegister || [];
        if (register.length === 0) {
            container.innerHTML = '';
            scrollWrap.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        scrollWrap.classList.remove('hidden');

        const { roots, childrenOf } = this.buildForest();
        // Aristas del grafo REAL (no el `childrenOf` colapsado a un padre de buildForest, ver su
        // comentario) — la detección de ciclos debe considerar TODAS las causas declaradas, no
        // solo la primera de cada riesgo.
        const { edges } = this.buildGraph();

        // Riesgos que forman un ciclo sin ninguna raíz externa (ver collectReachable) — nunca
        // se alcanzan recorriendo desde `roots`, así que sin este paso desaparecerían del
        // árbol en silencio en vez de mostrarse con la advertencia de ciclo. Se elige el
        // primero de cada ciclo (en el orden del Registro) como punto de entrada arbitrario;
        // el resto del mismo ciclo ya queda cubierto al recorrerlo desde ahí.
        const handled = this.collectReachable(
            roots.map((r) => r.risk.riskName),
            edges,
        );
        const cycleEntryRoots = [];
        register.forEach((r) => {
            if (handled.has(r.riskName)) return;
            cycleEntryRoots.push(r);
            this.collectReachable([r.riskName], edges).forEach((name) => handled.add(name));
        });

        const rootEntries = [
            ...roots.map((r) => ({
                risk: r.risk,
                orphanParentName: r.orphan ? r.orphanParentName : null,
                isCycleEntry: false,
            })),
            ...cycleEntryRoots.map((r) => ({ risk: r, orphanParentName: null, isCycleEntry: true })),
        ];

        container.innerHTML = `
            <ul class="risk-tree">
                ${rootEntries.map((e) => this.renderNode(e.risk, childrenOf, new Set(), e.orphanParentName, e.isCycleEntry)).join('')}
            </ul>
        `;

        container.querySelectorAll('[data-tree-toggle]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                // Sin esto, el clic también le llega al listener de la tarjeta (ver abajo,
                // [data-tree-card]) y abre el detalle al mismo tiempo que colapsa la rama — el
                // botón vive DENTRO de la tarjeta, así que el evento burbujea por defecto.
                e.stopPropagation();
                const subtree = btn.closest('li').querySelector(':scope > ul');
                if (!subtree) return;
                const collapsed = subtree.classList.toggle('hidden');
                btn.textContent = collapsed ? '▸' : '▾';
                btn.setAttribute('aria-expanded', String(!collapsed));
            });
        });

        container.querySelectorAll('[data-tree-card]').forEach((card) => {
            // El nombre sale del texto ya renderizado (.risk-tree-name), no de un atributo —
            // sanitizeHTML escapa &/</> para texto, pero no comillas dobles, así que un nombre
            // de riesgo con " rompería un atributo data-tree-card="...". textContent no tiene
            // ese problema: siempre devuelve el string original tal cual, sin importar qué
            // caracteres tenga.
            card.addEventListener('click', () => this.openDetail(card.querySelector('.risk-tree-name').textContent));
        });

        container.querySelectorAll('[data-tree-add-child]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                // Mismo motivo que [data-tree-toggle] arriba: el botón vive dentro de la
                // tarjeta, sin esto también abriría el detalle al mismo tiempo.
                e.stopPropagation();
                const parentName = btn.closest('.risk-tree-card').querySelector('.risk-tree-name').textContent;
                this.openCreateChildModal(parentName);
            });
        });

        container.querySelectorAll('[data-tree-change-trigger]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                // Mismo motivo que [data-tree-toggle]/[data-tree-add-child] arriba.
                e.stopPropagation();
                const riskName = btn.closest('.risk-tree-card').querySelector('.risk-tree-name').textContent;
                this.openChangeTriggerModal(riskName);
            });
        });
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
        // collectReachable (mismo helper que ya usa render() para detectar ciclos existentes) —
        // fijo durante la vida del modal, no cambia entre filas.
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
        // Mismo criterio que renderNode: un riesgo creado desde "+" (ver openCreateChildModal)
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

    // `visited`: nombres ya recorridos en esta rama — corta cualquier ciclo (A desencadena B,
    // B desencadena A, directa o indirectamente) sin recursión infinita. El select de "Riesgo
    // Desencadenante" solo excluye el propio nombre del riesgo que se está editando en ese
    // momento, no toda la cadena — así que un ciclo indirecto entre varios riesgos guardados
    // en momentos distintos sí es posible y hay que tolerarlo, no asumir que nunca pasa.
    renderNode(risk, childrenOf, visited, orphanParentName = null, isCycleEntry = false) {
        const isCycle = visited.has(risk.riskName);
        const children = isCycle ? [] : childrenOf.get(risk.riskName) || [];
        const nextVisited = new Set(visited).add(risk.riskName);
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
        const hasChildren = children.length > 0;

        return `
            <li>
                <div class="risk-tree-card cursor-pointer ${classes}" data-tree-card>
                    <p class="risk-tree-name">${sanitizeHTML(risk.riskName)}</p>
                    <p class="risk-tree-meta">${typeLabel} · ${aleLabel}</p>
                    ${
                        orphanParentName
                            ? `<p class="risk-tree-orphan-note">⚠️ Vinculado a "${sanitizeHTML(orphanParentName)}", que ya no está en el Registro (renombrado o eliminado).</p>`
                            : ''
                    }
                    ${
                        isCycleEntry
                            ? `<p class="risk-tree-orphan-note">⚠️ Forma parte de un ciclo de desencadenantes (ej. A⟶B⟶A) sin ninguna raíz externa — se muestra aquí como punto de entrada.</p>`
                            : ''
                    }
                    ${
                        isCycle
                            ? `<p class="risk-tree-orphan-note">⚠️ Ciclo detectado: este riesgo ya aparece más arriba en esta misma rama.</p>`
                            : ''
                    }
                    <div class="risk-tree-card-actions">
                        ${
                            hasChildren
                                ? `<button type="button" class="risk-tree-toggle" data-tree-toggle aria-expanded="true" title="Colapsar/expandir">▾</button>`
                                : ''
                        }
                        <button type="button" class="risk-tree-add-child" data-tree-add-child title="Crear riesgo desencadenado por este">+</button>
                        <button type="button" class="risk-tree-change-trigger" data-tree-change-trigger title="Cambiar quién causó este riesgo">🔗</button>
                    </div>
                </div>
                ${hasChildren ? `<ul>${children.map((c) => this.renderNode(c, childrenOf, nextVisited)).join('')}</ul>` : ''}
            </li>
        `;
    },
};

App.RiskCascadeTree = RiskCascadeTree;
