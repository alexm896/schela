import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { dnsRecordIp, isVpsApply } from "@/server/env";
import { normalizeDomain, systemUserFromDomain } from "@/lib/utils";
import { checkMailDnsLive } from "./dns-check";
import { describeMailDns, ensureHostDns, ensureMailDns, mailboxDomain, mailDnsBlueprint } from "./dns-auto";
import { hashMailboxPassword } from "./mail-pass";
import { mapApp, mapMailbox, mapRecord, mapSite, mapZone } from "./map";
import { normalizeWebRoot, siteRootFor, webRootFromRoot } from "./site-root";
import type { CertInfo } from "./types";

export const listSites = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select sites.*, ip_addresses.address as ip_address
      from sites
      left join ip_addresses on ip_addresses.id = sites.ip_id
      order by domain
    `).map(mapSite);
  });

async function certFor(domain: string, ssl: boolean): Promise<CertInfo> {
  if (!ssl) return { status: "off", message: "TLS is off for this site", expires: null };
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile("/var/lib/schela/certs.json", "utf8");
    const all = JSON.parse(raw) as Record<
      string,
      { status?: string; message?: string; expires?: string }
    >;
    const row = all[domain];
    if (!row) {
      return { status: "pending", message: "Certificate not issued yet", expires: null };
    }
    const status =
      row.status === "live" || row.status === "error" || row.status === "pending"
        ? row.status
        : "pending";
    return {
      status,
      message: row.message || "",
      expires: row.expires || null,
    };
  } catch {
    return { status: "pending", message: "Certificate not issued yet", expires: null };
  }
}

export const getSite = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      select sites.*, ip_addresses.address as ip_address
      from sites
      left join ip_addresses on ip_addresses.id = sites.ip_id
      where sites.id = ${data.id}
    `;
    const site = rows[0] ? mapSite(rows[0]) : null;
    if (!site) return null;
    return { ...site, cert: await certFor(site.domain, site.ssl) };
  });

const siteCreateSchema = z.object({
  domain: z.string().min(3).max(120),
  phpVersion: z.string(),
  memoryLimit: z.string().default("256M"),
  isolated: z.boolean().default(true),
  ssl: z.boolean().default(true),
});

export const createSite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(siteCreateSchema)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const domain = normalizeDomain(data.domain);
    const user = systemUserFromDomain(domain);
    const pool = `php${data.phpVersion.replace(".", "")}-${user}`;
    const root = `/home/${user}/www`;
    const rows = await sql<Record<string, unknown>>`
      insert into sites (domain, php_version, root, ssl, force_https, isolated, jail_user, pool, status, memory_limit)
      values (${domain}, ${data.phpVersion}, ${root}, ${data.ssl}, ${data.ssl}, ${data.isolated}, ${user}, ${pool}, 'active', ${data.memoryLimit})
      returning *
    `;
    await logActivity(sql, "site", `Created isolated site ${domain} on PHP ${data.phpVersion}`);
    await ensureHostDns(sql, domain);
    await applyAfterChange(sql);
    return mapSite(rows[0]);
  });

export const updateSite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.number(),
      phpVersion: z.string().optional(),
      memoryLimit: z.string().optional(),
      isolated: z.boolean().optional(),
      ssl: z.boolean().optional(),
      forceHttps: z.boolean().optional(),
      status: z.enum(["active", "stopped"]).optional(),
      webRoot: z.string().max(300).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const currentRows = await sql<Record<string, unknown>>`
      select * from sites where id = ${data.id}
    `;
    if (!currentRows[0]) throw new Error("Site not found");
    const current = mapSite(currentRows[0]);
    const phpVersion = data.phpVersion ?? current.phpVersion;
    const user = current.systemUser;
    const pool = `php${phpVersion.replace(".", "")}-${user}`;
    const memoryLimit = data.memoryLimit ?? current.memoryLimit;
    const isolated = data.isolated ?? current.isolated;
    const ssl = data.ssl ?? current.ssl;
    const forceHttps = data.forceHttps ?? current.forceHttps;
    const status = data.status ?? current.status;
    const root =
      data.webRoot === undefined ? current.root : siteRootFor(user, normalizeWebRoot(data.webRoot));
    const rows = await sql<Record<string, unknown>>`
      update sites
      set php_version = ${phpVersion},
          memory_limit = ${memoryLimit},
          isolated = ${isolated},
          ssl = ${ssl},
          force_https = ${forceHttps},
          status = ${status},
          pool = ${pool},
          root = ${root}
      where id = ${data.id}
      returning *
    `;
    if (data.phpVersion && data.phpVersion !== current.phpVersion) {
      await logActivity(
        sql,
        "php",
        `Switched ${current.domain} to PHP ${data.phpVersion}`,
      );
    }
    if (root !== current.root) {
      const folder = webRootFromRoot(user, root);
      await logActivity(sql, "site", `Document root of ${current.domain} set to www${folder ? `/${folder}` : ""}`);
    }
    await applyAfterChange(sql);
    return mapSite(rows[0]);
  });

export const retrySiteTls = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await applyAfterChange(sql);
    const rows = await sql<Record<string, unknown>>`
      select * from sites where id = ${data.id}
    `;
    const site = rows[0] ? mapSite(rows[0]) : null;
    if (!site) return null;
    return { ...site, cert: await certFor(site.domain, site.ssl) };
  });

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      delete from sites where id = ${data.id} returning domain
    `;
    if (rows[0]) {
      await logActivity(sql, "site", `Removed site ${String(rows[0].domain)}`);
    }
    await applyAfterChange(sql);
    return { ok: true };
  });

export const listApps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select node_apps.*, ip_addresses.address as ip_address
      from node_apps
      left join ip_addresses on ip_addresses.id = node_apps.ip_id
      order by name
    `).map(mapApp);
  });

export const createApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(80).optional(),
      domain: z.string().min(3).max(120),
      nodeVersion: z.string(),
      port: z.number().min(1024).max(65535).optional(),
      entry: z.string().min(1).max(80),
      instances: z.number().min(1).max(8),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const domain = normalizeDomain(data.domain);
    const name = (data.name?.trim() || domain).slice(0, 80);
    const used = await sql<{ port: number }>`select port from node_apps`;
    const taken = new Set(used.map((r) => r.port));
    let port = data.port ?? 0;
    if (!port) {
      for (let p = 3000; p < 4000; p++) {
        if (!taken.has(p)) {
          port = p;
          break;
        }
      }
    }
    if (!port) throw new Error("No free port in 3000–3999");
    const rows = await sql<Record<string, unknown>>`
      insert into node_apps (name, domain, node_version, port, status, entry, instances, memory_mb)
      values (${name}, ${domain}, ${data.nodeVersion}, ${port}, 'running', ${data.entry}, ${data.instances}, 256)
      returning *
    `;
    await logActivity(sql, "node", `Started ${name} on ${domain} (Node ${data.nodeVersion})`);
    await ensureHostDns(sql, domain);
    await applyAfterChange(sql);
    return mapApp(rows[0]);
  });

export const updateApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.number(),
      nodeVersion: z.string().optional(),
      status: z.enum(["running", "stopped"]).optional(),
      instances: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const currentRows = await sql<Record<string, unknown>>`
      select * from node_apps where id = ${data.id}
    `;
    if (!currentRows[0]) throw new Error("App not found");
    const current = mapApp(currentRows[0]);
    const nodeVersion = data.nodeVersion ?? current.nodeVersion;
    const status = data.status ?? current.status;
    const instances = data.instances ?? current.instances;
    const rows = await sql<Record<string, unknown>>`
      update node_apps
      set node_version = ${nodeVersion}, status = ${status}, instances = ${instances}
      where id = ${data.id}
      returning *
    `;
    await applyAfterChange(sql);
    return mapApp(rows[0]);
  });

export const deleteApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      delete from node_apps where id = ${data.id} returning name
    `;
    if (rows[0]) {
      await logActivity(sql, "node", `Removed app ${String(rows[0].name)}`);
    }
    await applyAfterChange(sql);
    return { ok: true };
  });

export const listMailboxes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select id, address, quota_mb, used_mb, status, created_at,
        (password_hash is not null and password_hash <> '') as has_password
      from mailboxes
      order by address
    `).map(mapMailbox);
  });

export const createMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      address: z.string().min(3).max(120),
      quotaMb: z.number().min(128).max(51200),
      password: z.string().min(8).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const address = data.address.trim().toLowerCase();
    if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) {
      throw new Error("Enter a full address like hello@example.com");
    }
    const hash = hashMailboxPassword(data.password);
    const rows = await sql<Record<string, unknown>>`
      insert into mailboxes (address, quota_mb, used_mb, status, password_hash)
      values (${address}, ${data.quotaMb}, 0, 'active', ${hash})
      returning id, address, quota_mb, used_mb, status, created_at
    `;
    await logActivity(sql, "mail", `Created mailbox ${address}`);
    await ensureMailDns(sql, address);
    await applyAfterChange(sql);
    return mapMailbox({ ...rows[0], has_password: true });
  });

export const setMailboxPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.number(),
      password: z.string().min(8).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const hash = hashMailboxPassword(data.password);
    const rows = await sql<Record<string, unknown>>`
      update mailboxes set password_hash = ${hash} where id = ${data.id}
      returning id, address, quota_mb, used_mb, status, created_at
    `;
    if (!rows[0]) throw new Error("Mailbox not found");
    await logActivity(sql, "mail", `Set password for ${String(rows[0].address)}`);
    await applyAfterChange(sql);
    return mapMailbox({ ...rows[0], has_password: true });
  });

export const toggleMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), status: z.enum(["active", "disabled"]) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      update mailboxes set status = ${data.status} where id = ${data.id} returning *
    `;
    await applyAfterChange(sql);
    return rows[0] ? mapMailbox(rows[0]) : null;
  });

export const deleteMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from mailboxes where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true };
  });

export const listDns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const zones = (await sql<Record<string, unknown>>`select * from dns_zones order by name`).map(
      mapZone,
    );
    const records = (await sql<Record<string, unknown>>`select * from dns_records order by type, name`).map(
      mapRecord,
    );
    return { zones, records };
  });

export const createDnsZone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().min(3).max(120) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const name = data.name.trim().toLowerCase();
    const serial = Number(
      new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01",
    );
    const rows = await sql<Record<string, unknown>>`
      insert into dns_zones (name, serial, status) values (${name}, ${serial}, 'active')
      returning *
    `;
    const zone = mapZone(rows[0]);
    const ip = dnsRecordIp();
    const ns = isVpsApply() ? `ns1.${name}` : "ns1.schela.local";
    await sql`
      insert into dns_records (zone_id, type, name, value, ttl, priority)
      values
        (${zone.id}, 'A', '@', ${ip}, 300, null),
        (${zone.id}, 'NS', '@', ${ns}, 3600, null)
    `;
    await logActivity(sql, "dns", `Added zone ${name}`);
    await applyAfterChange(sql);
    return zone;
  });

export const createDnsRecord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      zoneId: z.number(),
      type: z.string(),
      name: z.string().min(1).max(80),
      value: z.string().min(1).max(255),
      ttl: z.number().min(60).max(86400),
      priority: z.number().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      insert into dns_records (zone_id, type, name, value, ttl, priority)
      values (${data.zoneId}, ${data.type}, ${data.name}, ${data.value}, ${data.ttl}, ${data.priority})
      returning *
    `;
    await applyAfterChange(sql);
    return mapRecord(rows[0]);
  });

export const deleteDnsRecord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from dns_records where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true };
  });

export const listMailDns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const boxes = await sql<{ address: string }>`select address from mailboxes`;
    const domains = [
      ...new Set(boxes.map((b) => mailboxDomain(b.address)).filter((d) => d.includes("."))),
    ];
    const result = [];
    for (const domain of domains) {
      result.push(await describeMailDns(sql, domain));
    }
    return result;
  });

export const checkMailDns = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ domain: z.string().min(3).max(120) }))
  .handler(async ({ data }) => {
    const domain = data.domain.trim().toLowerCase();
    const ip = dnsRecordIp();
    const expected = mailDnsBlueprint(domain, ip).map((r) => ({
      type: r.type,
      name: r.name,
      value: r.value,
    }));
    return checkMailDnsLive(domain, expected);
  });
