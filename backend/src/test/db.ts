import { prisma } from "../db.js";

/** Wipes every table an integration test could have touched. RiskScenario's children (LossCategory, Treatment) cascade-delete with it. */
export async function resetDb() {
  await prisma.riskScenario.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.threat.deleteMany();
}
