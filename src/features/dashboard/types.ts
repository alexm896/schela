import type { Activity } from "@/server/activity";
import type { NodeApp, Site } from "@/lib/panel/types";
import type { ModuleRow } from "@/features/modules/types";
import type { PanelSettings } from "@/features/settings/types";

export type LiveMetrics = {
  cpu: number;
  ram: number;
  disk: number;
  load: number;
  uptimeSec: number;
  spark: number[];
};

export type DashboardData = {
  settings: PanelSettings;
  modules: ModuleRow[];
  metrics: LiveMetrics;
  counts: {
    sites: number;
    apps: number;
    mailboxes: number;
    zones: number;
    firewall: number;
  };
  sites: Site[];
  apps: NodeApp[];
  activity: Activity[];
};
