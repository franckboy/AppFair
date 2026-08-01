# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

This is a monorepo with two independent npm projects, each with its own `package.json` and `node_modules`:

- `frontend/` — React 19 + TypeScript SPA, scaffolded with Vite. Dev server runs on port 5173.
- `backend/` — Express + TypeScript REST API. Runs on port 4000. Uses native ESM (`"type": "module"` in package.json) and NodeNext module resolution.

The two are not connected via workspaces or a root package.json — they must be installed and run separately.

Frontend-to-backend connection: `frontend/vite.config.ts` proxies `/api/*` requests to `http://localhost:4000` during development, so frontend code should call relative paths like `fetch('/api/...')` rather than hardcoding the backend origin. In production there is no proxy yet — the frontend build and backend are not currently served together, so this will need a real reverse proxy or CORS/origin setup before deploying.

Backend routes live in `backend/src/index.ts`. There is currently one endpoint, `GET /api/health`, used by the frontend to confirm connectivity. As routes grow, split them out of `index.ts` rather than keeping everything in one file.

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

There is no test suite in either project yet.

To develop with both connected, run `npm run dev` in `backend/` and `npm run dev` in `frontend/` in parallel, then open http://localhost:5173.
