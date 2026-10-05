import type { NodeApp } from "@/features/apps/types";
import type { ModuleRow } from "@/features/modules/types";
import type { PanelSettings } from "@/features/settings/types";
import type { Site } from "@/features/sites/types";
import type { Activity } from "@/server/activity";

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
