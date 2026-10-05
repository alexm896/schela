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
