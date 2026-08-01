import { assetsApi } from "./assets";
import { threatsApi } from "./threats";
import { riskScenariosApi } from "./riskScenarios";
import { treatmentsApi } from "./treatments";
import { dashboardApi } from "./dashboard";

export type { AssetInput } from "./assets";
export type { ThreatInput } from "./threats";
export type { RiskScenarioInput, SimulateOptions } from "./riskScenarios";
export type { TreatmentInput } from "./treatments";

export const api = {
  ...assetsApi,
  ...threatsApi,
  ...riskScenariosApi,
  ...treatmentsApi,
  ...dashboardApi,
};
