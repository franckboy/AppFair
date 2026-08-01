/**
 * The configured Express app, with no `listen()` call — importable directly by
 * integration tests (via supertest) without binding a real port. `index.ts` is
 * the only thing that starts it listening.
 */
import cors from "cors";
import express from "express";
import { errorHandler } from "./errorHandler.js";
import { assetsRouter } from "./routes/assets.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { riskScenariosRouter } from "./routes/riskScenarios.js";
import { threatsRouter } from "./routes/threats.js";
import { scenarioTreatmentsRouter, treatmentsRouter } from "./routes/treatments.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/assets", assetsRouter);
app.use("/api/threats", threatsRouter);
app.use("/api/risk-scenarios", riskScenariosRouter);
app.use("/api/risk-scenarios/:scenarioId/treatments", scenarioTreatmentsRouter);
app.use("/api/treatments", treatmentsRouter);
app.use("/api/dashboard", dashboardRouter);

app.use(errorHandler);
