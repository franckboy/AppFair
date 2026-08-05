// Namespace compartido de la app (Fase 3a del plan de migración). Cada módulo extraído se
// auto-registra acá al ser importado (ej. `App.Api = Api;` al final de api.js) — así el resto
// del código que todavía no se movió a su propio archivo (FairWizard, FairRegister, Fase 3b)
// sigue llamando `App.Api.foo()` exactamente como antes, sin tener que reescribir esos
// call-sites en esta ronda.
export const App = {};
