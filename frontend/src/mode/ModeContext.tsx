import { useEffect, useState, type ReactNode } from "react";
import { ModeContext, type AppMode } from "./context";
import { LABELS, type LabelKey } from "./labels";

const STORAGE_KEY = "appfair-mode";

function readStoredMode(): AppMode {
  return localStorage.getItem(STORAGE_KEY) === "tecnico" ? "tecnico" : "simple";
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>(readStoredMode);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  function toggleMode() {
    setMode((current) => (current === "simple" ? "tecnico" : "simple"));
  }

  function t(key: LabelKey) {
    return LABELS[key][mode];
  }

  return <ModeContext.Provider value={{ mode, toggleMode, t }}>{children}</ModeContext.Provider>;
}
