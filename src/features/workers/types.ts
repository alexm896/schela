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
