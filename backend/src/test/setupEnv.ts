/**
 * Points DATABASE_URL at the test database (backend/.env.test, gitignored — copy
 * from .env.test.example) before anything imports db.ts. db.ts's own
 * `import "dotenv/config"` doesn't override an already-set env var, so as long as
 * this runs first (Vitest's setupFiles guarantee that), integration tests never
 * touch the dev database.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.test"), override: true });
