import type { AccessLevel, DatabaseEngine } from "./databases";

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
