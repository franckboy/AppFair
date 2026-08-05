// --- Custom Modal Logic ---
export const Modal = {
    modal: document.getElementById('customModal'),
    title: document.getElementById('modalTitle'),
    body: document.getElementById('modalBody'),
    footer: document.getElementById('modalFooter'),

    alert(message, title = 'Notificación') {
        this.title.textContent = title;
        this.body.innerHTML = message;
        this.footer.innerHTML = `<button id="modal-ok-btn" class="btn btn-primary">Aceptar</button>`;
        this.modal.classList.remove('hidden');
        document.getElementById('modal-ok-btn').addEventListener('click', () => this.hide());
        document.getElementById('modal-ok-btn').focus();
    },

    confirm(message, onConfirm, title = 'Confirmación') {
        this.title.textContent = title;
        this.body.innerHTML = message;
        this.footer.innerHTML = `
            <button id="modal-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="modal-confirm-btn" class="btn btn-danger">Confirmar</button>
        `;
        this.modal.classList.remove('hidden');

        const confirmBtn = document.getElementById('modal-confirm-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        const confirmHandler = () => {
            this.hide();
            if (onConfirm) onConfirm();
            this.removeListeners();
        };

        const cancelHandler = () => {
            this.hide();
            this.removeListeners();
        };

        confirmBtn.addEventListener('click', confirmHandler);
        cancelBtn.addEventListener('click', cancelHandler);

        confirmBtn.focus();

        this.removeListeners = () => {
            confirmBtn.removeEventListener('click', confirmHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
        };
    },

    hide() {
        this.modal.classList.add('hidden');
    },

    // Menú simple de opciones (ver App.ConfigMenu) — cada botón cierra el modal y ejecuta su
    // propia acción (abrir otro modal, cambiar de página, etc.).
    menu(title, options) {
        this.title.textContent = title;
        this.body.innerHTML = `<div class="space-y-2">${options
            .map(
                (opt, i) => `
            <button type="button" class="btn btn-secondary w-full" style="justify-content:flex-start;text-align:left;" data-menu-option="${i}">
                <i class="fas ${opt.icon} mr-2"></i>${opt.label}
            </button>
        `,
            )
            .join('')}</div>`;
        this.footer.innerHTML = `<button id="modal-menu-close-btn" class="btn btn-secondary">Cerrar</button>`;
        this.modal.classList.remove('hidden');

        this.body.querySelectorAll('[data-menu-option]').forEach((btn, i) => {
            btn.addEventListener('click', () => {
                this.hide();
                options[i].onClick();
            });
        });
        document.getElementById('modal-menu-close-btn').addEventListener('click', () => this.hide());
    },
};
