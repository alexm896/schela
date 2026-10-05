export type DnsCheckRow = {
  type: string;
  name: string;
  expected: string;
  live: string[];
  ok: boolean;
};

export type DnsCheckResult = {
  domain: string;
  ok: boolean;
  checkedAt: string;
  source: "cloudflare-dns";
  mxtoolbox: string;
  records: DnsCheckRow[];
};

const TYPE_NUM: Record<string, number> = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16 };

export function normalizeDnsValue(type: string, raw: string): string {
  let s = raw.trim().toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  s = s.replace(/\.$/, "");
  if (type === "MX") {
    s = s.replace(/^\d+\s+/, "").replace(/\.$/, "");
  }
  return s;
}

export function dnsValuesMatch(type: string, expected: string, live: string[]): boolean {
  const want = normalizeDnsValue(type, expected);
  if (!want) return false;
  return live.some((item) => {
    const got = normalizeDnsValue(type, item);
    if (got === want) return true;
    if (type === "TXT" && got.includes(want)) return true;
    if (type === "TXT" && want.includes(got) && got.length > 12) return true;
    if (type === "MX" && (got === want || got.endsWith(want) || want.endsWith(got))) return true;
    return false;
  });
}

type DohAnswer = { name?: string; type?: number; data?: string };

export async function dohLookup(name: string, type: "A" | "MX" | "TXT"): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const body = (await res.json()) as { Answer?: DohAnswer[]; Status?: number };
  const want = TYPE_NUM[type];
  return (body.Answer ?? [])
    .filter((a) => a.type === want && typeof a.data === "string")
    .map((a) => String(a.data));
}

function fqdn(domain: string, host: string): string {
  if (host === "@" || host === "") return domain;
  return `${host}.${domain}`;
}

export async function checkMailDnsLive(
  domain: string,
  expected: { type: string; name: string; value: string }[],
): Promise<DnsCheckResult> {
  const records: DnsCheckRow[] = [];
  for (const rec of expected) {
    const type = rec.type === "A" || rec.type === "MX" || rec.type === "TXT" ? rec.type : null;
    if (!type) continue;
    const name = fqdn(domain, rec.name);
    let live: string[] = [];
    try {
      live = await dohLookup(name, type);
    } catch {
      live = [];
    }
    records.push({
      type: rec.type,
      name: rec.name,
      expected: rec.value,
      live,
      ok: dnsValuesMatch(type, rec.value, live),
    });
  }
  return {
    domain,
    ok: records.length > 0 && records.every((r) => r.ok),
    checkedAt: new Date().toISOString(),
    source: "cloudflare-dns",
    mxtoolbox: `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${encodeURIComponent(domain)}&run=toolpage`,
    records,
  };
}
