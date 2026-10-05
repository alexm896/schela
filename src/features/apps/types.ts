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
