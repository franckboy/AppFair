import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { showToast } from './utils.js';

// --- Cliente API del backend ---
// Único punto que conoce la URL del servidor y la API key. El resto de los módulos
// (Criteria, OrgDefaults, OrgContext, FairAnalysis) llaman a App.Api.request(...) en vez
// de tocar localStorage o recalcular localmente — el backend es la fuente de verdad.
export const Api = {
    BASE_URL_KEY: 'apiBaseUrl',
    API_KEY_KEY: 'apiKey',
    DEFAULT_BASE_URL: 'http://localhost:3000',

    getBaseUrl() {
        return localStorage.getItem(this.BASE_URL_KEY) || this.DEFAULT_BASE_URL;
    },

    getApiKey() {
        return localStorage.getItem(this.API_KEY_KEY) || '';
    },

    setConnection(baseUrl, apiKey) {
        localStorage.setItem(this.BASE_URL_KEY, (baseUrl || this.DEFAULT_BASE_URL).replace(/\/+$/, ''));
        localStorage.setItem(this.API_KEY_KEY, apiKey || '');
    },

    /**
     * Llama al backend. Lanza un Error con `.userMessage` listo para mostrar
     * (toast/modal) en vez de dejar que el caller interprete códigos HTTP.
     */
    async request(path, { method = 'GET', body } = {}) {
        let response;
        try {
            response = await fetch(`${this.getBaseUrl()}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.getApiKey(),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch (networkError) {
            const err = new Error('network_error');
            err.userMessage =
                'No se pudo conectar con el servidor. Verifica la URL en "Conexión API" y que el backend esté corriendo.';
            throw err;
        }

        if (response.status === 401) {
            const err = new Error('unauthorized');
            err.userMessage = 'API key inválida o faltante. Ábrela en "Conexión API" y verifica tu key.';
            throw err;
        }

        let data = null;
        try {
            data = await response.json();
        } catch (e) {
            /* respuesta sin cuerpo, ej. 204 */
        }

        if (!response.ok) {
            const err = new Error('request_error');
            err.userMessage =
                data && data.error ? data.error : `Error del servidor (${response.status}). Intenta de nuevo.`;
            throw err;
        }
        return data;
    },

    async testHealth() {
        try {
            const res = await fetch(`${this.getBaseUrl()}/api/health`);
            return res.ok;
        } catch (e) {
            return false;
        }
    },

    /** Carga perfiles + configuración de la organización desde el backend hacia `state`. */
    async bootstrap() {
        this.setConnectionStatus('conectando');
        try {
            const [profiles, criteria, orgDefaults, orgContext, assetsRes] = await Promise.all([
                this.request('/api/config/profiles'),
                this.request('/api/config/criteria'),
                this.request('/api/config/org-defaults'),
                this.request('/api/config/org-context'),
                this.request('/api/assets'),
            ]);

            state.quick.attackerProfiles = profiles.attackerProfiles;
            state.quick.defenseProfiles = profiles.defenseProfiles;
            state.quick.riskCatalog = profiles.riskCatalog;
            // Catálogo curado de normas/marcos (ver backend/src/data/standardsReference.js) —
            // usado por App.RiskCascadeTree.openDetail para el "Marco Normativo" del riesgo.
            state.quick.hazardStandards = profiles.hazardStandards;
            state.quick.isoProcessClauses = profiles.isoProcessClauses;
            state.config.calibrationVersion = profiles.calibrationVersion ?? null;
            state.config.accessLevels = profiles.accessLevels || null;
            state.quick.assets = assetsRes.assets;
            state.config.riskCriteria = criteria;
            App.OrgDefaults.defaults = { ...App.OrgDefaults.defaults, ...orgDefaults };
            App.OrgContext.context = { ...App.OrgContext.context, ...orgContext };

            this.setConnectionStatus('conectado');
            this.hideBootGate();
            return true;
        } catch (e) {
            this.setConnectionStatus('error');
            this.showBootGate(e.userMessage || 'No se pudo conectar con el servidor.');
            return false;
        }
    },

    setConnectionStatus(status) {
        const el = document.getElementById('api-connection-status');
        if (!el) return;
        const labels = { conectando: '● Conectando…', conectado: '● Conectado', error: '● Sin conexión' };
        const colors = { conectando: 'bg-blue-800', conectado: 'bg-green-700', error: 'bg-red-700' };
        el.textContent = labels[status] || '';
        el.className = `text-xs px-2 py-1 rounded-full ${colors[status] || 'bg-blue-800'}`;
    },

    showBootGate(message) {
        document.querySelectorAll('.nav-requires-boot').forEach((btn) => (btn.disabled = true));
        document
            .querySelectorAll('#fairAnalysisPage, #dashboardPage, #assetsPage, #risk-summary-bar')
            .forEach((el) => el.classList.add('hidden'));
        document.getElementById('boot-gate-message').textContent = message;
        document.getElementById('boot-gate').classList.remove('hidden');
    },

    hideBootGate() {
        document.querySelectorAll('.nav-requires-boot').forEach((btn) => (btn.disabled = false));
        document.getElementById('boot-gate').classList.add('hidden');
        // Bug real: showBootGate() esconde #fairAnalysisPage, pero esto no la devolvía — al
        // conectar, la app quedaba sin NINGUNA página visible hasta que el usuario tocara un botón
        // de navegación. Se veía como una pantalla en blanco después de conectar, y de forma
        // intermitente (según ganara la carrera entre el arranque y el primer render).
        // switchPage es la única fuente de verdad de "qué página se ve": deja exactamente una
        // visible y marca su botón, en vez de quitar el `hidden` a mano y arriesgar dos a la vez.
        if (App.Navigation) App.Navigation.switchPage('fair');
        // #risk-summary-bar no se destapa aquí: tiene su propia lógica (App.RiskSummaryBar.render
        // la muestra solo si hay algo que resumir), y forzarla dejaría una barra vacía.
    },

    initConnectionUI() {
        document.getElementById('nav-api-connection').addEventListener('click', () => this.openConnectionModal());
        document
            .getElementById('boot-gate-open-connection-btn')
            .addEventListener('click', () => this.openConnectionModal());
        document.getElementById('boot-gate-retry-btn').addEventListener('click', async () => {
            const retryBtn = document.getElementById('boot-gate-retry-btn');
            retryBtn.disabled = true;
            const ok = await this.bootstrap();
            retryBtn.disabled = false;
            if (ok) location.reload(); // recarga limpia para que todos los módulos se inicialicen con datos frescos
        });
    },

    openConnectionModal() {
        const formHTML = `
            <p class="description-text mb-4">
                Esta app es cliente del backend del motor de cálculo (ver <code>backend/README.md</code>).
                La API key queda guardada en este navegador — cualquiera con acceso a las herramientas de
                desarrollador de este dispositivo podría leerla. Está bien para uso personal o una demo;
                no la uses como control de acceso multiusuario real.
            </p>
            <div class="input-group">
                <label for="api-conn-baseurl">URL del Backend:</label>
                <input type="text" id="api-conn-baseurl" class="form-input" placeholder="http://localhost:3000">
            </div>
            <div class="input-group">
                <label for="api-conn-key">API Key:</label>
                <input type="password" id="api-conn-key" class="form-input" placeholder="X-API-Key">
            </div>
            <p id="api-conn-test-result" class="text-sm mb-2"></p>
        `;
        Modal.title.textContent = 'Conexión API';
        Modal.body.innerHTML = formHTML;
        Modal.footer.innerHTML = `
            <button id="api-conn-test-btn" class="btn btn-secondary"><i class="fas fa-heartbeat mr-2"></i>Probar conexión</button>
            <button id="api-conn-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="api-conn-save-btn" class="btn btn-primary">Guardar</button>
        `;
        Modal.modal.classList.remove('hidden');
        document.getElementById('api-conn-baseurl').value = this.getBaseUrl();
        document.getElementById('api-conn-key').value = this.getApiKey();

        document.getElementById('api-conn-cancel-btn').addEventListener('click', () => Modal.hide());
        document.getElementById('api-conn-test-btn').addEventListener('click', async () => {
            const resultEl = document.getElementById('api-conn-test-result');
            const baseUrl = document.getElementById('api-conn-baseurl').value.trim();
            resultEl.textContent = 'Probando…';
            resultEl.className = 'text-sm mb-2 text-gray-600';
            const originalBaseUrl = this.getBaseUrl();
            localStorage.setItem(this.BASE_URL_KEY, (baseUrl || this.DEFAULT_BASE_URL).replace(/\/+$/, ''));
            const ok = await this.testHealth();
            localStorage.setItem(this.BASE_URL_KEY, originalBaseUrl); // no confirmar hasta "Guardar"
            resultEl.textContent = ok ? '✅ El servidor respondió correctamente.' : '❌ No se pudo alcanzar esa URL.';
            resultEl.className = `text-sm mb-2 ${ok ? 'text-green-700' : 'text-red-700'}`;
        });
        document.getElementById('api-conn-save-btn').addEventListener('click', async () => {
            const baseUrl = document.getElementById('api-conn-baseurl').value.trim();
            const apiKey = document.getElementById('api-conn-key').value.trim();
            this.setConnection(baseUrl, apiKey);
            Modal.hide();
            const ok = await this.bootstrap();
            if (ok) {
                showToast('Conexión guardada. Recargando…');
                setTimeout(() => location.reload(), 600);
            }
        });
    },
};

App.Api = Api;
