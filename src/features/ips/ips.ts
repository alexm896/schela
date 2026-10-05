// Extra IPv4 addresses bound to sites and apps. Pure, shared by the server
// functions, the UI and the tests.

export function isIpv4(raw: string): boolean {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

export function normalizeIp(raw: string): string {
  const s = raw.trim();
  if (!isIpv4(s)) throw new Error("Enter an IPv4 address, like 203.0.113.10");
  return s;
}
