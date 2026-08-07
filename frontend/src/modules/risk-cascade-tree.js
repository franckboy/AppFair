import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { sanitizeHTML, severityToClasses, showToast } from './utils.js';

// ============================================================
// App.RiskCascadeTree — vista de árbol del vínculo "Riesgo Desencadenante" (Paso 1, opcional,
// ver App.FairWizard.populateTriggeredByOptions): quién desencadena a quién, entre los riesgos
// ya guardados en el Registro. Puramente informativo — lee state.fair.riskRegister tal cual
// quedó guardado, sin combinar ni recalcular ningún ALE. Sumar/restar los riesgos vinculados
// se descartó explícitamente en esta misma sesión: requeriría simular ambos de forma
// correlacionada (misma iteración Monte Carlo) para no sobreestimar por doble conteo (Broder,
// 1984) — fuera del alcance de esta vista, que solo dibuja la relación ya guardada.
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

    init() {
        document
            .getElementById('risk-tree-zoom-in-btn')
            .addEventListener('click', () => this.setZoom(this._zoom + ZOOM_STEP));
        document
            .getElementById('risk-tree-zoom-out-btn')
            .addEventListener('click', () => this.setZoom(this._zoom - ZOOM_STEP));
        document.getElementById('risk-tree-zoom-reset-btn').addEventListener('click', () => this.setZoom(1));
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

    // Arma el bosque de árboles a partir de triggeredByRiskName — cada riesgo elige como
    // máximo UN desencadenante (select de selección única), así que la estructura real es un
    // árbol multi-hijo por raíz, nunca un nodo con dos padres.
    buildForest() {
        const register = state.fair.riskRegister || [];
        const byName = new Map(register.map((r) => [r.riskName, r]));
        const childrenOf = new Map();
        const roots = [];

        register.forEach((r) => {
            const parentName = r.triggeredByRiskName;
            // Raíz si no tiene desencadenante, o si el que tiene ya no existe en el Registro —
            // el vínculo se guarda por NOMBRE, no por id (a diferencia de assetId); si el
            // riesgo padre se borró o se renombró después, el vínculo queda huérfano. Se trata
            // como raíz (con una nota aparte) en vez de ocultar el riesgo del árbol.
            if (!parentName || parentName === r.riskName) {
                roots.push({ risk: r, orphan: false });
                return;
            }
            if (!byName.has(parentName)) {
                roots.push({ risk: r, orphan: true, orphanParentName: parentName });
                return;
            }
            if (!childrenOf.has(parentName)) childrenOf.set(parentName, []);
            childrenOf.get(parentName).push(r);
        });

        return { roots, childrenOf };
    },

    // Todos los nombres alcanzables recorriendo childrenOf a partir de una lista de riesgos de
    // entrada — usado para detectar riesgos que NUNCA aparecen bajo ninguna raíz declarada
    // (ver render(): un ciclo sin ninguna raíz externa, ej. A desencadenado por B y B
    // desencadenado por A, no cuelga de ningún root real y quedaría fuera del árbol si no se
    // busca aparte).
    collectReachable(entryRisks, childrenOf) {
        const seen = new Set();
        const stack = [...entryRisks];
        while (stack.length) {
            const cur = stack.pop();
            if (seen.has(cur.riskName)) continue;
            seen.add(cur.riskName);
            (childrenOf.get(cur.riskName) || []).forEach((c) => stack.push(c));
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

        // Riesgos que forman un ciclo sin ninguna raíz externa (ver collectReachable) — nunca
        // se alcanzan recorriendo desde `roots`, así que sin este paso desaparecerían del
        // árbol en silencio en vez de mostrarse con la advertencia de ciclo. Se elige el
        // primero de cada ciclo (en el orden del Registro) como punto de entrada arbitrario;
        // el resto del mismo ciclo ya queda cubierto al recorrerlo desde ahí.
        const handled = this.collectReachable(
            roots.map((r) => r.risk),
            childrenOf,
        );
        const cycleEntryRoots = [];
        register.forEach((r) => {
            if (handled.has(r.riskName)) return;
            cycleEntryRoots.push(r);
            this.collectReachable([r], childrenOf).forEach((name) => handled.add(name));
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
        const badgeClasses = isOpportunity
            ? 'bg-blue-50 border-blue-500 text-blue-800'
            : risk.evaluationClasses || severityToClasses(risk.severity);
        const badgeLabel = isOpportunity ? 'Oportunidad' : risk.evaluationLevel || '—';

        Modal.title.textContent = risk.riskName;
        Modal.body.innerHTML = `
            <div class="flex justify-between items-start flex-wrap gap-2 mb-3">
                <span class="px-2 py-1 rounded text-xs border-l-4 ${badgeClasses}">${sanitizeHTML(badgeLabel)}</span>
            </div>
            <p class="description-text mb-3">${sanitizeHTML(risk.description || 'Sin descripción.')}</p>
            <ul class="text-sm text-gray-700 space-y-1 mb-3">
                <li><strong>Activo:</strong> ${sanitizeHTML(risk.asset || '—')}</li>
                <li><strong>Agente de Amenaza:</strong> ${sanitizeHTML(risk.threat || '—')}</li>
                <li><strong>Responsable:</strong> ${sanitizeHTML(risk.owner || '—')}</li>
                <li><strong>${isOpportunity ? 'Beneficio' : 'Pérdida'} Anual Esperada:</strong> ${formatAle(risk.ale)}</li>
                <li><strong>Mediana:</strong> ${formatAle(risk.median)}</li>
                <li><strong>P90:</strong> ${formatAle(risk.p90)}</li>
                <li><strong>CVaR 95%:</strong> ${formatAle(risk.cvar95)}</li>
                ${risk.evaluationJustification ? `<li><strong>Justificación:</strong> ${sanitizeHTML(risk.evaluationJustification)}</li>` : ''}
            </ul>
        `;
        Modal.footer.innerHTML = `
            <button id="risktree-detail-close-btn" class="btn btn-secondary">Cerrar</button>
            ${isOpportunity ? '' : '<button id="risktree-detail-tratar-btn" class="btn btn-primary">Tratar</button>'}
        `;
        Modal.modal.classList.remove('hidden');

        document.getElementById('risktree-detail-close-btn').addEventListener('click', () => Modal.hide());
        if (!isOpportunity) {
            document.getElementById('risktree-detail-tratar-btn').addEventListener('click', () => {
                Modal.hide();
                App.Navigation.switchPage('treatment');
                App.Treatment.load(risk.riskName);
            });
        }
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
        const classes = isOpportunity ? 'bg-blue-50 border-blue-500 text-blue-800' : severityToClasses(risk.severity);
        const typeLabel = isOpportunity ? 'Oportunidad' : 'Amenaza';
        const hasChildren = children.length > 0;

        return `
            <li>
                <div class="risk-tree-card cursor-pointer ${classes}" data-tree-card>
                    <p class="risk-tree-name">${sanitizeHTML(risk.riskName)}</p>
                    <p class="risk-tree-meta">${typeLabel} · ${formatAle(risk.ale)}/año</p>
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
                    ${
                        hasChildren
                            ? `<button type="button" class="risk-tree-toggle" data-tree-toggle aria-expanded="true" title="Colapsar/expandir">▾</button>`
                            : ''
                    }
                </div>
                ${hasChildren ? `<ul>${children.map((c) => this.renderNode(c, childrenOf, nextVisited)).join('')}</ul>` : ''}
            </li>
        `;
    },
};

App.RiskCascadeTree = RiskCascadeTree;
