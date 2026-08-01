# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What AppFair is

AppFair quantifies physical/patrimonial security risk in financial terms using the FAIR model (Factor Analysis of Information Risk), instead of qualitative high/medium/low matrices. Users register assets, threats, and risk scenarios; each scenario is run through a Monte Carlo simulation to produce an Annualized Loss Expectancy (ALE), percentiles, and CVaR, so risk-mitigation decisions can be justified financially (ROSI, cost of controls vs. expected loss).

## Architecture

This is a monorepo with two independent npm projects, each with its own `package.json` and `node_modules`:

- `frontend/` — React 19 + TypeScript SPA, scaffolded with Vite. Dev server runs on port 5173.
- `backend/` — Express + TypeScript REST API. Runs on port 4000. Uses native ESM (`"type": "module"` in package.json) and NodeNext module resolution.

The two are not connected via workspaces or a root package.json — they must be installed and run separately.

Frontend-to-backend connection: `frontend/vite.config.ts` proxies `/api/*` requests to `http://localhost:4000` during development, so frontend code should call relative paths like `fetch('/api/...')` rather than hardcoding the backend origin. In production there is no proxy yet — the frontend build and backend are not currently served together, so this will need a real reverse proxy or CORS/origin setup before deploying.

Backend entry point is `backend/src/index.ts`: sets up middleware, mounts one router per resource from `backend/src/routes/`, and registers the global `errorHandler` last. Keep growing routes as separate files under `routes/`, not inline in `index.ts`.

### Data layer

PostgreSQL via Prisma, connected through the `@prisma/adapter-pg` driver adapter — Prisma 7 requires an explicit adapter, plain `new PrismaClient()` throws `PrismaClientInitializationError`. The singleton client lives in `backend/src/db.ts`, which loads `.env` itself via `import "dotenv/config"` (the Prisma CLI loads `.env` automatically for `migrate`/`generate`, but the app process does not, so this import is required for `npm run dev`/`start` to see `DATABASE_URL`).

Schema is `backend/prisma/schema.prisma`, with five models:

- `Asset`, `Threat` — reference data.
- `RiskScenario` — pairs an Asset and a Threat and holds the FAIR inputs for two parameters as PERT estimates (`min`/`mostLikely`/`max` triples): Threat Event Frequency (`tef*`, annual rate) and Vulnerability (`vuln*`, probability 0-1). These are ranges, not single numbers, because they're expert estimates, not known quantities — don't collapse them to a single value anywhere in the stack. Loss magnitude is **not** a field here — see `LossCategory`.
- `LossCategory` — one PERT estimate per named loss category (`key`, one of the fixed set in `fair/lossCategories.ts` — productividad, respuesta, reemplazo, multas, reputación, investigación, oportunidad, comunitario, ambiental), one-to-many from `RiskScenario`, `onDelete: Cascade`. A single loss event sums across all of a scenario's categories rather than using one aggregate figure — see the engine section below. Every scenario must carry exactly the fixed 9 keys (enforced by Zod in `routes/riskScenarios.ts`, not a DB constraint beyond `@@unique([riskScenarioId, key])`).
- `Treatment` — a candidate response to a `RiskScenario` (`strategy`: `MITIGATE`/`TRANSFER`/`AVOID`/`ACCEPT`, `name`, `annualCost`, optional `reductionPct`), `onDelete: Cascade`. A scenario can hold several side by side so their ROSI can be compared. See `fair/treatment.ts`.

Both `LossCategory` and `Treatment` cascade-delete with their parent `RiskScenario` — deleting a scenario that still has either would otherwise fail on the FK constraint (a real bug hit during development).

The Prisma client is generated to `backend/src/generated/prisma` (gitignored, regenerate with `npx prisma generate` after `npm install` or after editing the schema).

### FAIR Monte Carlo engine

`backend/src/fair/` is a self-contained, dependency-free simulation module — no statistics library is used on purpose, so the FAIR-specific math (PERT/Beta sampling, Poisson threat-event counts, percentiles, CVaR) stays in code we own and test directly, rather than behind a generic library's assumptions:

- `random.ts` — seedable PRNG (mulberry32) plus PERT, Gamma/Beta, and Poisson sampling built on it.
- `statistics.ts` — `quantile`, `mean`, `conditionalValueAtRisk` over a sorted sample array.
- `lossCategories.ts` — the fixed 9 `{key, label}` pairs (`LOSS_CATEGORIES`/`LOSS_CATEGORY_KEYS`/`LOSS_CATEGORY_LABEL`). Single source of truth — the frontend has its own copy at `frontend/src/fair/lossCategories.ts` that must match exactly (the API rejects a scenario that doesn't carry precisely this key set).
- `simulate.ts` — `runSimulation(input, options)`: for each of `options.iterations` (default 10,000) simulated years, samples a threat-event count from Poisson(TEF); for each threat event, rolls vulnerability to decide if it becomes a loss event, and if so samples **every** loss category and sums them into that event's loss (one incident triggers costs across several categories at once). Returns `{ ale, percentiles: {p10,p50,p90,p95,p99}, cvar95, min, max, iterations }`.
  - Pass `options.trackFactors: true` to additionally get `factorSamples` (per-iteration TEF, mean-vulnerability-that-iteration, and mean-per-category-loss-that-iteration) and `losses` (the raw per-iteration annual-loss array) — the inputs `sensitivity.ts` needs. Off by default since it's extra memory/CPU that repeat callers (the dashboard, one run per scenario) don't need. A "quiet" iteration with zero threat events has no vulnerability/loss draw to average, so it falls back to that input's `mostLikely` rather than reporting a misleading 0 — a documented compromise, not hidden.
  - Pass `options.seed` for a reproducible run (used throughout the test suite); omit it for a real, non-deterministic simulation. `simulate.ts` itself takes a plain `RiskScenarioInput` (with `lossMagnitudeCategories: {key, estimate}[]`), not a database record — the mapping from Prisma's flat `tef*`/`vuln*` columns and the related `LossCategory` rows to that nested shape happens in `routes/riskScenarios.ts` (`toDto`).
- `sensitivity.ts` — `computeSensitivity(factorSamples, labels, losses)`: Pearson correlation (`pearsonCorrelation`) between each factor's per-iteration samples and the annual loss, ranked by `|correlation|` descending — a tornado-chart view of which FAIR input actually drives the ALE's variability. Requires a simulation run with `trackFactors: true`.

`treatment.ts` — `evaluateTreatment(scenario, treatment, options)` compares a scenario's baseline ALE against its ALE with a treatment applied, reusing `runSimulation` unchanged rather than adding new engine machinery:
- `MITIGATE` scales the scenario's `vulnerability` PERT triple down by `reductionPct`% (fewer threat events become loss events), then re-simulates.
- `TRANSFER` scales **every** loss category's PERT triple down by `reductionPct`% instead (models a third party, e.g. insurance, absorbing that share of each event's cost) — a simplification of real insurance mechanics (no deductible/policy-limit modeling), chosen so this strategy reuses the exact same "scale a PERT input, re-run `runSimulation`" pattern as MITIGATE instead of needing a bespoke per-event transform inside the engine.
- `AVOID` short-circuits `aleAfter` to 0 (risk eliminated) without re-simulating.
- `ACCEPT` is the do-nothing baseline: `aleAfter = aleBefore`, and by convention `annualCost = 0`.

Before/after simulations share one seed (common random numbers) so the comparison isn't muddied by independent Monte Carlo noise. ROSI = `(aleBefore - aleAfter - annualCost) / annualCost`, `null` when `annualCost` is 0 (division by zero — ACCEPT's baseline has no ROSI, it's the thing being compared against).

### API

Validation is per-route Zod schemas (not centralized) — see `routes/*.ts`. `errorHandler.ts` maps `ZodError` to 400 (with `issues`), Prisma `P2025` (record not found on update/delete) to 404, and Prisma `P2003` (foreign key violation, e.g. an unknown `assetId`/`threatId`) to 400; anything else is logged and returned as a generic 500. Route handlers can stay `async` and throw/reject freely — Express 5 forwards rejected promises to `errorHandler` automatically.

For the two resources with any real validation/mapping complexity (`risk-scenarios`, `treatments`), each is split into three files rather than one, so a change to one concern doesn't require touching the others:
- `<resource>.schema.ts` — Zod input validation only, no Express/Prisma imports.
- `<resource>.mapping.ts` — translates Prisma rows <-> the nested API/engine shape, no HTTP concerns.
- `<resource>.ts` — the router: validate (schema) → hit Prisma → map (mapping) → respond. If a handler is doing more than that, that logic likely belongs in one of the other two files.

`treatments.ts` reuses `riskScenarios.mapping.ts`'s `toDto`/`toEngineInput` to build the engine input for `evaluateTreatment` rather than re-deriving it — a cross-resource import is fine here since "how a scenario becomes engine input" has exactly one owner (`riskScenarios.mapping.ts`). `assets.ts`/`threats.ts` stay single-file — they're plain CRUD with no comparable branching to split out.

Endpoints, all under `/api`:
- `GET/POST /assets`, `GET/PATCH/DELETE /assets/:id`
- `GET/POST /threats`, `GET/PATCH/DELETE /threats/:id`
- `GET/POST /risk-scenarios`, `GET/PATCH/DELETE /risk-scenarios/:id` — request/response bodies use the nested shape (`threatEventFrequency`/`vulnerability` as `{min, mostLikely, max}`, `lossCategories` as `[{key, label, estimate: {min,mostLikely,max}}, ...]`), not the flat DB columns/related rows. `lossCategories` must contain exactly the fixed 9 keys (Zod-validated) — PATCH replaces the whole set (delete-then-recreate in a transaction) when the field is present, not a per-category partial update. The **GET** list/detail responses additionally include a freshly-simulated `ale` (`riskScenarios.ts`'s `withAle`) so the frontend can show a criticality badge next to a scenario without a separate call; POST/PATCH don't compute it.
- `POST /risk-scenarios/:id/simulate` — body `{ iterations?, seed? }`, runs the FAIR engine (with `trackFactors: true`) against that scenario's stored parameters and returns a `SimulationResult` plus `sensitivity` (from `computeSensitivity`); the large `factorSamples`/`losses` arrays are stripped from the response before sending (only needed transiently to compute the correlations).
- `GET /dashboard` (`routes/dashboard.ts`) — for every risk scenario, runs the FAIR engine fresh (no persistence of simulation runs) and returns `{ scenarios: [...ale, cvar95, assetName, threatName, likelihood, severity], totals: { scenarioCount, ale, worstCaseCvar95, topRisk } }`. `totals.ale` is a valid sum (linearity of expectation holds regardless of correlation); deliberately **not** a summed CVaR95 (tail expectations aren't additive) — `worstCaseCvar95` is the max across scenarios instead, to avoid reporting a statistically meaningless portfolio "CVaR". `likelihood` is Loss Event Frequency (`tefMostLikely * vulnMostLikely`, annual) and `severity` is the sum of every loss category's `mostLikely` — the two axes the frontend's risk matrix bins scenarios into.
- `GET/POST /risk-scenarios/:scenarioId/treatments` (`routes/treatments.ts`, `scenarioTreatmentsRouter`) — list (each annotated with an `evaluation` from `evaluateTreatment`) and create. Mounted as its own path (not nested inside `riskScenariosRouter`) using `Router({ mergeParams: true })`; falls through to it correctly because none of `riskScenariosRouter`'s routes (`/:id`, `/:id/simulate`) match a path ending in `/treatments`.
- `PATCH/DELETE /treatments/:id` (`treatmentsRouter`) — flat, independent of the parent scenario route.

### Frontend

Client-side routing via `react-router-dom` (`BrowserRouter` in `main.tsx`, routes in `App.tsx`) — declarative mode only (`Routes`/`Route`/`Link`/`useNavigate`/`useParams`), no data router (`createBrowserRouter`), no loaders/actions, no SSR. Most of the CVEs `npm audit` reports against `react-router` target that unused surface (SSR, RSC, single-fetch, framework-mode server actions); they don't apply to how this app uses the library, which is why the dependency is pinned to latest rather than downgraded.

- `src/api/` — `types.ts` (DTOs mirroring the backend's nested shape, including `LossCategory`/`SensitivityFactor`) and `client.ts` (thin `fetch` wrapper, one function per endpoint; throws on non-2xx using the backend's `{ error }` body).
- `src/fair/lossCategories.ts` — frontend's copy of the fixed 9 categories; must match `backend/src/fair/lossCategories.ts` exactly.
- `src/fair/profiles.ts` — attacker/defense presets ported from the original prototype (`ATTACKER_PROFILES`, `DEFENSE_PROFILES`, each a named set of 0-100 factors) plus `CONFIDENCE_SPREAD` (alto/medio/bajo → a range-width multiplier). `computeVulnerability(attackerScore, defenseScore, confidence)` derives vulnerability's min/mostLikely/max automatically (`mostLikely% = attackerScore × (1 − defenseScore/100)`, clamped 1-99%, range width set by confidence) instead of the user guessing three numbers by hand — purely a frontend convenience, nothing is persisted about which profile/confidence produced the values, so it's a one-way fill-and-adjust, not a stored relationship.
- `src/components/PertEstimateInput.tsx` — the min/mostLikely/max input group, reused for TEF, vulnerability, and each of the 9 loss categories on the scenario form.
- `src/pages/` — one page per resource (`AssetsPage`, `ThreatsPage`, `ScenariosPage`) combining a single form with a list, plus `ScenarioDetailPage` (parameters, the 9-category loss table, a "run simulation" button that calls `/simulate` and renders the result + a sensitivity tornado-bar list, and `components/TreatmentsSection.tsx`). The list-page forms double as create and edit: an `editingId` state (`null` = create) is set by each row's "Editar" button; the page passes `editingScenario` (looked up from the already-loaded list) down as `initialScenario`.
- `ScenariosPage` only orchestrates (load list, wire create/update/delete to the API, render the table); the form itself is `components/ScenarioForm.tsx`, which owns its own field state seeded from `initialScenario` (or defaults) and calls back with a finished `RiskScenarioInput` on submit. The page mounts it with `key={editingId ?? "new"}` so React remounts (and resets) the form's internal state when switching between create mode and a different scenario, instead of syncing state via `useEffect`.
  - `ScenarioForm` composes two further-split pieces: `components/AttackerDefenseFields.tsx` (fully self-contained — owns its own profile/confidence selection, only calls back with the computed vulnerability estimate) and `components/LossCategoryFields.tsx` (one `PertEstimateInput` per fixed category, `value`/`onChange` as a plain `Record<key, PertEstimate>` controlled by the parent). Each piece can change independently: editing the attacker/defense formula never touches loss-category rendering, and vice versa.
- `components/TreatmentsSection.tsx` — per-scenario treatment CRUD plus a comparison table (strategy, cost, ALE before/after, risk reduction, ROSI); the reduction-% field only appears for MITIGATE/TRANSFER (AVOID/ACCEPT don't use it). Highlights the highest-ROSI treatment, including correctly picking the least-negative one when every option's cost outweighs the risk it addresses.

State management is local `useState`/`useEffect` per page, no shared cache/query library — each page re-fetches on mount. Revisit this if pages start needing to share or invalidate the same data.

### Modo Simple / Modo Técnico

A language-only global toggle (`mode/`), not a calculation difference — both modes read the exact same numbers, only the field/result labels change (Técnico: standard FAIR terminology; Simple: plain conversational Spanish, e.g. "Vulnerabilidad" ↔ "¿Qué tan probable es que funcione, si lo intentan?"). Modeled after the original HTML prototype's `Modo Simple`/`Modo Técnico` toggle.

- `mode/context.ts` — the raw `ModeContext` + types only (no components), `mode/ModeContext.tsx` — `ModeProvider` (wraps `<App>` in `main.tsx`; persists to `localStorage` under `appfair-mode`, defaults to `simple`), `mode/useMode.ts` — the `useMode()` hook. Split into three files instead of one because oxlint's `react-refresh` rule flags mixing context/hook exports with the provider component in a single file.
- `mode/labels.ts` — the `LABELS` dictionary (`{ tecnico, simple }` per key). Add new FAIR-jargon strings here rather than hardcoding them; `t(key)` in a component resolves the current mode's copy.
- Currently applied to the scenario form's PERT field labels/hints (`ScenariosPage`) and the scenario detail page's parameter table, simulate button, and result labels (`ScenarioDetailPage`) — the same scope the original prototype toggled. Plain CRUD strings (asset/threat "Nombre"/"Descripción", etc.) aren't FAIR jargon and aren't wired to it.

### Criticality badges

`components/RiskBadge.tsx` renders a small colored pill from the fixed status palette (`statusScale.ts`), used consistently wherever a *single* scenario's ALE is shown on its own: the scenario list's "Nivel" column, the scenario detail page's title and simulation result, a treatment's residual ALE, and the dashboard's "Escenario de mayor riesgo" KPI tile. Classification is `riskLevelForAle(ale)` — fixed absolute thresholds (documented in `statusScale.ts`: low ≤ $50k, critical > $250k), deliberately different from `riskLevelFor(likelihoodBin, severityBin)` used by the dashboard's risk matrix, which bins a *portfolio* of scenarios relative to each other instead of against an absolute scale. Both are provisional defaults pending a future configurable "Criterios de Riesgo" (risk acceptance thresholds) feature, not hardcoded organizational policy.

### Dashboard & charts

`DashboardPage` (`/dashboard`, the app's default route) follows the project's dataviz skill: charts are hand-built SVG/HTML (no charting library), colors come only from the documented palette, and every chart has a table-view toggle as its accessibility twin.

- `components/StatTile.tsx` — the 4 KPI tiles (portfolio ALE, scenario count, top risk, worst-case CVaR95).
- `components/ParetoChart.tsx` — bars are each scenario's ALE as a **% of portfolio total**, the line is cumulative %, both sharing one 0–100% axis. This isn't the classic dual-axis Pareto (raw ALE bars + a % line on a second axis) on purpose — a dual-axis chart invents a correlation that isn't in the data (see the dataviz skill's anti-patterns); indexing both series to a shared % axis is the fix it recommends, and it happens to be exactly what a Pareto chart needs.
- `components/RiskHeatmap.tsx` — a classic Likelihood × Severity risk matrix (4×4), styled after a reference risk-matrix image the user provided, but fed by real FAIR outputs rather than hand-picked colors: each scenario is binned into a likelihood quartile (`likelihood` = LEF) and a severity quartile (`severity` = most-likely loss magnitude) computed from whatever scenarios currently exist (`components/statusScale.ts`'s `riskLevelFor`), then the cell's Bajo/Medio/Alto/Crítico level and fixed status color (`STATUS_COLORS`) follow from that bin, not from an arbitrary per-scenario judgment call. A cell's badge shows how many scenarios fall in it; hover/focus lists them with their ALE. Uses the design system's fixed **status** palette (good/warning/serious/critical), not the categorical or sequential one — status colors are validated for both light and dark surfaces in `palette.md`, so unlike a sequential ramp this grid needs no light-only fallback.
- `components/sequentialScale.ts` / `statusScale.ts` / `colorContrast.ts` — sequential ramp + status-level color/label lookup + the shared white-or-ink contrast helper (`textColorFor`) used to pick legible label color against either fill.
- `components/useChartTooltip.ts` / `ChartTooltip.tsx` — shared hover/focus tooltip. Use `showTooltipAt(x, y, data)` when the mark's own geometry is already known (SVG bars/points — more precise than their DOM rect, and correct even when the hit target is deliberately larger than the mark); use `showTooltipFromEvent(e, data)` when it isn't (HTML cells). Tooltips render in a non-clipping wrapper *outside* the horizontally-scrollable chart area — an earlier version anchored them to the scrollable container and got clipped at its edges.
- Number formatting lives in `src/format.ts`. `currencyCompact` is a hand-rolled K/M formatter, not `Intl.NumberFormat(..., { notation: "compact" })` — `es-AR`'s compact CLDR data mixes `K`/`k` case at the 10,000 boundary (e.g. `7,3 K` vs `67,7 k`), which reads as a formatting bug on a dashboard of financial figures.

## Commands

Frontend (`cd frontend`):
- `npm install` — install deps
- `npm run dev` — start Vite dev server (http://localhost:5173)
- `npm run build` — type-check (`tsc -b`) and build production bundle to `dist/`
- `npm run lint` — run oxlint

Backend (`cd backend`):
- `npm install` — install deps
- `npm run dev` — start with `tsx watch` (auto-reload on file changes)
- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run the compiled `dist/index.js`
- `npm test` — run the Vitest suite (currently covers `src/fair/*`, no route/integration tests yet); add `-- -t <name>` to run a single test, or `npx vitest run src/fair/simulate.test.ts` for a single file
- `npx prisma migrate dev --name <description>` — create and apply a migration after editing `schema.prisma`
- `npx prisma studio` — browse the database

Backend requires a running PostgreSQL instance reachable via `DATABASE_URL` in `backend/.env` (see `backend/.env.example`). Locally: `service postgresql start`, then a one-time `createuser`/`createdb` matching that URL.

To develop with both connected, run `npm run dev` in `backend/` and `npm run dev` in `frontend/` in parallel, then open http://localhost:5173.
