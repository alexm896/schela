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
