import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sqlFile = (name: string) =>
  readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8");

describe("migration 0010_firewall", () => {
  it("drops the seeded SSH, HTTP and HTTPS rows and keeps the admin's own rules", async () => {
    const pg = new PGlite();
    await pg.exec(sqlFile("0002_schela.sql"));
    // What seedBaseFirewall wrote on first boot, then rules of the admin's own.
    await pg.exec(`
      insert into firewall_rules (action, protocol, port, source, comment) values
        ('allow', 'tcp', '22', 'any', 'SSH'),
        ('allow', 'tcp', '80', 'any', 'HTTP'),
        ('allow', 'tcp', '443', 'any', 'HTTPS'),
        ('allow', 'tcp', '8080', 'any', 'app'),
        ('allow', 'tcp', '22', '203.0.113.0/24', 'office'),
        ('deny', 'tcp', '80', '192.0.2.1', 'abuse'),
        ('allow', 'udp', '443', 'any', 'quic');
    `);
    await pg.exec(sqlFile("0010_firewall.sql"));
    const rows = await pg.query<{ action: string; protocol: string; port: string; source: string }>(
      "select action, protocol, port, source from firewall_rules order by id",
    );
    assert.deepEqual(
      rows.rows.map((r) => `${r.action} ${r.protocol}/${r.port} ${r.source}`),
      [
        "allow tcp/8080 any",
        "allow tcp/22 203.0.113.0/24",
        "deny tcp/80 192.0.2.1",
        "allow udp/443 any",
      ],
    );
    await pg.close();
  });
});
