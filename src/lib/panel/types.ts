import type { AccessLevel, DatabaseEngine } from "./databases";

export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;

export type DnsType = (typeof DNS_TYPES)[number];

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
