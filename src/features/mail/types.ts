export type Mailbox = {
  id: number;
  address: string;
  quotaMb: number;
  usedMb: number;
  status: "active" | "disabled";
  hasPassword: boolean;
  createdAt: string;
};
