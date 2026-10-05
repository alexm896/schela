// Where the panel runs. On the VPS (SCHELA_APPLY=1) every change is written to
// the box through schela-apply; anywhere else (local dev) state only lives in
// the database.

export function isVpsApply(): boolean {
  return process.env.SCHELA_APPLY === "1";
}

export function publicIp(): string {
  return process.env.SCHELA_PUBLIC_IP?.trim() || "127.0.0.1";
}

/** The IP written into DNS records: the server's own on the VPS, a documentation address elsewhere. */
export function dnsRecordIp(): string {
  return isVpsApply() ? publicIp() : "203.0.113.10";
}
