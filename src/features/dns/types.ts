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
