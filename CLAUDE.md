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

Backend routes live in `backend/src/index.ts`. There is currently one endpoint, `GET /api/health`, used by the frontend to confirm connectivity. As routes grow, split them out of `index.ts` rather than keeping everything in one file.

### Data layer

PostgreSQL via Prisma. Schema is `backend/prisma/schema.prisma`, with three models:

- `Asset`, `Threat` — reference data.
- `RiskScenario` — pairs an Asset and a Threat and holds the FAIR inputs as PERT estimates (`min`/`mostLikely`/`max` triples) for three parameters: Threat Event Frequency (`tef*`, annual rate), Vulnerability (`vuln*`, probability 0-1), and Loss Magnitude (`lm*`, currency impact per event). These are ranges, not single numbers, because they're expert estimates, not known quantities — don't collapse them to a single value anywhere in the stack.

The Prisma client is generated to `backend/src/generated/prisma` (gitignored, regenerate with `npx prisma generate` after `npm install` or after editing the schema).

### FAIR Monte Carlo engine

`backend/src/fair/` is a self-contained, dependency-free simulation module — no statistics library is used on purpose, so the FAIR-specific math (PERT/Beta sampling, Poisson threat-event counts, percentiles, CVaR) stays in code we own and test directly, rather than behind a generic library's assumptions:

- `random.ts` — seedable PRNG (mulberry32) plus PERT, Gamma/Beta, and Poisson sampling built on it.
- `statistics.ts` — `quantile`, `mean`, `conditionalValueAtRisk` over a sorted sample array.
- `simulate.ts` — `runSimulation(input, options)`: for each of `options.iterations` (default 10,000) simulated years, samples a threat-event count from Poisson(TEF), rolls vulnerability per event to decide if it becomes a loss event, and sums sampled loss magnitudes into that year's annual loss. Returns `{ ale, percentiles: {p10,p50,p90,p95,p99}, cvar95, min, max, iterations }`.

Pass `options.seed` for a reproducible run (used throughout the test suite); omit it for a real, non-deterministic simulation. This module is not yet wired to an API endpoint or to Prisma — it takes a plain `RiskScenarioInput`, not a database record.

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
- `npm test` — run the Vitest suite (currently covers `src/fair/*`); add `-- -t <name>` to run a single test, or `npx vitest run src/fair/simulate.test.ts` for a single file
- `npx prisma migrate dev --name <description>` — create and apply a migration after editing `schema.prisma`
- `npx prisma studio` — browse the database

Backend requires a running PostgreSQL instance reachable via `DATABASE_URL` in `backend/.env` (see `backend/.env.example`). Locally: `service postgresql start`, then a one-time `createuser`/`createdb` matching that URL.

To develop with both connected, run `npm run dev` in `backend/` and `npm run dev` in `frontend/` in parallel, then open http://localhost:5173.
