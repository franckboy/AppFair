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

Schema is `backend/prisma/schema.prisma`, with three models:

- `Asset`, `Threat` — reference data.
- `RiskScenario` — pairs an Asset and a Threat and holds the FAIR inputs as PERT estimates (`min`/`mostLikely`/`max` triples) for three parameters: Threat Event Frequency (`tef*`, annual rate), Vulnerability (`vuln*`, probability 0-1), and Loss Magnitude (`lm*`, currency impact per event). These are ranges, not single numbers, because they're expert estimates, not known quantities — don't collapse them to a single value anywhere in the stack.

The Prisma client is generated to `backend/src/generated/prisma` (gitignored, regenerate with `npx prisma generate` after `npm install` or after editing the schema).

### FAIR Monte Carlo engine

`backend/src/fair/` is a self-contained, dependency-free simulation module — no statistics library is used on purpose, so the FAIR-specific math (PERT/Beta sampling, Poisson threat-event counts, percentiles, CVaR) stays in code we own and test directly, rather than behind a generic library's assumptions:

- `random.ts` — seedable PRNG (mulberry32) plus PERT, Gamma/Beta, and Poisson sampling built on it.
- `statistics.ts` — `quantile`, `mean`, `conditionalValueAtRisk` over a sorted sample array.
- `simulate.ts` — `runSimulation(input, options)`: for each of `options.iterations` (default 10,000) simulated years, samples a threat-event count from Poisson(TEF), rolls vulnerability per event to decide if it becomes a loss event, and sums sampled loss magnitudes into that year's annual loss. Returns `{ ale, percentiles: {p10,p50,p90,p95,p99}, cvar95, min, max, iterations }`.

Pass `options.seed` for a reproducible run (used throughout the test suite); omit it for a real, non-deterministic simulation. `simulate.ts` itself takes a plain `RiskScenarioInput`, not a database record — the mapping from Prisma's flat `tef*`/`vuln*`/`lm*` columns to that nested shape happens in `routes/riskScenarios.ts` (`toDto`).

### API

Validation is per-route Zod schemas (not centralized) — see `routes/*.ts`. `errorHandler.ts` maps `ZodError` to 400 (with `issues`), Prisma `P2025` (record not found on update/delete) to 404, and Prisma `P2003` (foreign key violation, e.g. an unknown `assetId`/`threatId`) to 400; anything else is logged and returned as a generic 500. Route handlers can stay `async` and throw/reject freely — Express 5 forwards rejected promises to `errorHandler` automatically.

Endpoints, all under `/api`:
- `GET/POST /assets`, `GET/PATCH/DELETE /assets/:id`
- `GET/POST /threats`, `GET/PATCH/DELETE /threats/:id`
- `GET/POST /risk-scenarios`, `GET/PATCH/DELETE /risk-scenarios/:id` — request/response bodies use the nested PERT shape (`threatEventFrequency`/`vulnerability`/`lossMagnitude`, each `{min, mostLikely, max}`), not the flat DB columns
- `POST /risk-scenarios/:id/simulate` — body `{ iterations?, seed? }`, runs the FAIR engine against that scenario's stored parameters and returns a `SimulationResult`
- `GET /dashboard` (`routes/dashboard.ts`) — for every risk scenario, runs the FAIR engine fresh (no persistence of simulation runs) and returns `{ scenarios: [...ale, cvar95, assetName, threatName], totals: { scenarioCount, ale, worstCaseCvar95, topRisk } }`. `totals.ale` is a valid sum (linearity of expectation holds regardless of correlation); deliberately **not** a summed CVaR95 (tail expectations aren't additive) — `worstCaseCvar95` is the max across scenarios instead, to avoid reporting a statistically meaningless portfolio "CVaR".

### Frontend

Client-side routing via `react-router-dom` (`BrowserRouter` in `main.tsx`, routes in `App.tsx`) — declarative mode only (`Routes`/`Route`/`Link`/`useNavigate`/`useParams`), no data router (`createBrowserRouter`), no loaders/actions, no SSR. Most of the CVEs `npm audit` reports against `react-router` target that unused surface (SSR, RSC, single-fetch, framework-mode server actions); they don't apply to how this app uses the library, which is why the dependency is pinned to latest rather than downgraded.

- `src/api/` — `types.ts` (DTOs mirroring the backend's nested PERT shape) and `client.ts` (thin `fetch` wrapper, one function per endpoint; throws on non-2xx using the backend's `{ error }` body).
- `src/components/PertEstimateInput.tsx` — the min/mostLikely/max input group, reused for all three FAIR parameters on the scenario form.
- `src/pages/` — one page per resource (`AssetsPage`, `ThreatsPage`, `ScenariosPage`) combining a single form with a list, plus `ScenarioDetailPage` (shows a scenario's parameters and a "run simulation" button that calls `/simulate` and renders the result). The form doubles as create and edit: an `editingId` state (`null` = create) is set by each row's "Editar" button, which pre-fills the fields and switches the submit handler to call the PATCH endpoint instead of POST; "Cancelar" clears it back to create mode.

State management is local `useState`/`useEffect` per page, no shared cache/query library — each page re-fetches on mount. Revisit this if pages start needing to share or invalidate the same data.

### Dashboard & charts

`DashboardPage` (`/dashboard`, the app's default route) follows the project's dataviz skill: charts are hand-built SVG/HTML (no charting library), colors come only from the documented palette (`components/sequentialScale.ts` for the sequential ramp, CSS custom properties in `pages/Dashboard.css` for the categorical pair), and every chart has a table-view toggle as its accessibility twin.

- `components/StatTile.tsx` — the 4 KPI tiles (portfolio ALE, scenario count, top risk, worst-case CVaR95).
- `components/ParetoChart.tsx` — bars are each scenario's ALE as a **% of portfolio total**, the line is cumulative %, both sharing one 0–100% axis. This isn't the classic dual-axis Pareto (raw ALE bars + a % line on a second axis) on purpose — a dual-axis chart invents a correlation that isn't in the data (see the dataviz skill's anti-patterns); indexing both series to a shared % axis is the fix it recommends, and it happens to be exactly what a Pareto chart needs.
- `components/RiskHeatmap.tsx` — Asset × Threat grid, cell color = sequential blue ramp by ALE (assets/threats built from whichever scenarios exist; a cell with no scenario renders as a muted "—", outside the color scale). **The heatmap card stays on a light surface even in dark mode** — `palette.md` only documents light-mode sequential ramp steps, and inventing undocumented dark steps would violate the "documented palette only" rule, so this is a deliberate, commented scope limit rather than a bug.
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
