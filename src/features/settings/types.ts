import type { ModuleRow } from "@/features/modules/types";

export type PanelSettings = {
  hostname: string;
  isolation: boolean;
  setupComplete: boolean;
  sshPort: number;
  autoUpdates: boolean;
};

export type PanelState = {
  settings: PanelSettings;
  modules: ModuleRow[];
};
