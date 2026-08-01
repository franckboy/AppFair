import cors from "cors";
import express from "express";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
