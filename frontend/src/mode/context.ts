import { createContext } from "react";
import type { LabelKey } from "./labels";

export type AppMode = "simple" | "tecnico";

export interface ModeContextValue {
  mode: AppMode;
  toggleMode: () => void;
  t: (key: LabelKey) => string;
}

export const ModeContext = createContext<ModeContextValue | null>(null);
