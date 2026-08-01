import type { Dashboard } from "./types";
import { request } from "./request";

export const dashboardApi = {
  getDashboard: () => request<Dashboard>("/dashboard"),
};
