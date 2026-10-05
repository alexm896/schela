import type { Activity } from "@/server/activity";
import type { AccessLevel, DatabaseEngine } from "./databases";

export const PHP_VERSIONS = ["8.1", "8.2", "8.3", "8.4"] as const;
export const NODE_VERSIONS = ["18", "20", "22"] as const;
export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;

export type PhpVersion = (typeof PHP_VERSIONS)[number];
export type NodeVersion = (typeof NODE_VERSIONS)[number];
export type DnsType = (typeof DNS_TYPES)[number];

export type ModuleRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  core: boolean;
  sortOrder: number;
};

export type Site = {
  id: number;
  domain: string;
  phpVersion: string;
  root: string;
  ssl: boolean;
  forceHttps: boolean;
  isolated: boolean;
  systemUser: string;
  pool: string;
  status: "active" | "stopped";
  memoryLimit: string;
  ipId: number | null;
  ipAddress: string | null;
  createdAt: string;
};

export type CertInfo = {
  status: "live" | "pending" | "error" | "off";
  message: string;
  expires: string | null;
};

export type NodeApp = {
  id: number;
  name: string;
  domain: string;
  nodeVersion: string;
  port: number;
  status: "running" | "stopped";
  entry: string;
  instances: number;
  memoryMb: number;
  ipId: number | null;
  ipAddress: string | null;
  createdAt: string;
};

export type FirewallRule = {
  id: number;
  direction: "in" | "out";
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "any";
  port: string;
  source: string;
  comment: string;
  enabled: boolean;
};

export type Mailbox = {
  id: number;
  address: string;
  quotaMb: number;
  usedMb: number;
  status: "active" | "disabled";
  hasPassword: boolean;
  createdAt: string;
};

export type IpAddress = {
  id: number;
  address: string;
  label: string;
  siteId: number | null;
  appId: number | null;
  assignedTo: string | null;
  createdAt: string;
};

export type { BackupJob, BackupRun, BackupScope } from "./backup";

export type SiteWorker = {
  id: number;
  siteId: number;
  name: string;
  preset: string;
  command: string;
  processes: number;
  stopTimeout: number;
  memoryMb: number;
  enabled: boolean;
  createdAt: string;
};

export type ManagedDatabase = {
  id: number;
  engine: DatabaseEngine;
  name: string;
  siteId: number | null;
  siteDomain: string | null;
  appId: number | null;
  appName: string | null;
  createdAt: string;
};

export type DatabaseGrant = {
  databaseId: number;
  databaseName: string;
  level: AccessLevel;
};

export type DatabaseUser = {
  id: number;
  engine: DatabaseEngine;
  name: string;
  grants: DatabaseGrant[];
  createdAt: string;
};

export type CronJob = {
  id: number;
  kind: "site" | "app";
  targetId: number;
  targetLabel: string;
  user: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  createdAt: string;
};

export type DnsZone = {
  id: number;
  name: string;
  serial: number;
  status: string;
};

export type DnsRecord = {
  id: number;
  zoneId: number;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
};

export type PanelSettings = {
  hostname: string;
  isolation: boolean;
  setupComplete: boolean;
  sshPort: number;
  autoUpdates: boolean;
};

export type LiveMetrics = {
  cpu: number;
  ram: number;
  disk: number;
  load: number;
  uptimeSec: number;
  spark: number[];
};

export type PanelState = {
  settings: PanelSettings;
  modules: ModuleRow[];
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
