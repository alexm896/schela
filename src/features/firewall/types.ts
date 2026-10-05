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
