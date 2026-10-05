import type { Sql } from "@/server/db";

/** SSH, HTTP and HTTPS open on a fresh install. Does nothing once any rule exists. */
export async function seedBaseFirewall(sql: Sql) {
  const existing = await sql<{ n: number }>`select count(*)::int as n from firewall_rules`;
  if ((existing[0]?.n ?? 0) > 0) return;
  const rules: Array<[string, string, string, string, string, string]> = [
    ["in", "allow", "tcp", "22", "any", "SSH"],
    ["in", "allow", "tcp", "80", "any", "HTTP"],
    ["in", "allow", "tcp", "443", "any", "HTTPS"],
  ];
  for (const [direction, action, protocol, port, source, comment] of rules) {
    await sql`
      insert into firewall_rules (direction, action, protocol, port, source, comment, enabled)
      values (${direction}, ${action}, ${protocol}, ${port}, ${source}, ${comment}, true)
    `;
  }
}
