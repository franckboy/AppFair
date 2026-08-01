import cors from "cors";
import express from "express";
import { errorHandler } from "./errorHandler.js";
import { assetsRouter } from "./routes/assets.js";
import { riskScenariosRouter } from "./routes/riskScenarios.js";
import { threatsRouter } from "./routes/threats.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/assets", assetsRouter);
app.use("/api/threats", threatsRouter);
app.use("/api/risk-scenarios", riskScenariosRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
