import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { normalizeDomain, systemUserFromDomain } from "@/lib/utils";
import { applyAfterChange, isVpsApply, publicIp, readHostMetrics } from "./apply";
import { bootstrapAdminIfNeeded, hasAdminUser } from "./bootstrap-admin";
import { displayUsername, toAuthEmail } from "./admin-id";
import { checkMailDnsLive } from "./dns-check";
import { describeMailDns, ensureHostDns, ensureMailDns, mailboxDomain, mailDnsBlueprint } from "./dns-auto";
import { hashMailboxPassword } from "./mail-pass";
import {
  mapActivity,
  mapApp,
  mapMailbox,
  mapModule,
  mapRecord,
  mapRule,
  mapSite,
  mapZone,
} from "./map";
import { normalizeWebRoot, siteRootFor, webRootFromRoot } from "./site-root";
import type {
  CertInfo,
  DashboardData,
  LiveMetrics,
  PanelSettings,
  PanelState,
} from "./types";

const MODULES = [
  {
    slug: "php",
    name: "PHP",
    description: "Multi-version PHP-FPM with per-site pools.",
    version: "8.4",
    core: true,
    sort: 1,
  },
  {
    slug: "node",
    name: "Node.js",
    description: "Process manager, reverse proxy, and Node 18–22.",
    version: "22",
    core: true,
    sort: 2,
  },
  {
    slug: "firewall",
    name: "Firewall",
    description: "Default-deny firewall and Fail2ban intrusion prevention.",
    version: "1.2",
    core: true,
    sort: 3,
  },
  {
    slug: "mail",
    name: "Mail",
    description: "Mailboxes, aliases, and DKIM/SPF/DMARC.",
    version: "1.0",
    core: false,
    sort: 4,
  },
  {
    slug: "dns",
    name: "DNS",
    description: "Authoritative zones and record editor.",
    version: "1.0",
    core: false,
    sort: 5,
  },
  {
    slug: "ssl",
    name: "TLS",
    description: "Automatic certificates on every site.",
    version: "1.1",
    core: true,
    sort: 6,
  },
  {
    slug: "backups",
    name: "Backups",
    description: "Local archives, plus rsync and S3 in the same run.",
    version: "1.0",
    core: false,
    sort: 7,
  },
  {
    slug: "redis",
    name: "Redis",
    description: "Local cache on 127.0.0.1. Off by default. Disable stops it; the package stays.",
    version: "1.0",
    core: false,
    sort: 8,
  },
] as const;

async function logActivity(sql: Sql, kind: string, message: string) {
  await sql`insert into activity (kind, message) values (${kind}, ${message})`;
}

async function liveMetrics(): Promise<LiveMetrics> {
  const real = await readHostMetrics();
  if (real) return real;
  const t = Date.now() / 1000;
  const cpu = Math.max(6, Math.min(42, 16 + Math.sin(t / 17) * 8 + Math.sin(t / 5) * 3));
  const ram = Math.max(28, Math.min(62, 41 + Math.sin(t / 23) * 6));
  const disk = 34.2;
  const load = Math.max(0.12, 0.42 + Math.sin(t / 11) * 0.18);
  const spark = Array.from({ length: 24 }, (_, i) => {
    const x = t - (23 - i) * 40;
    return Math.max(4, 16 + Math.sin(x / 17) * 8 + Math.sin(x / 5) * 3);
  });
  return {
    cpu: Math.round(cpu * 10) / 10,
    ram: Math.round(ram * 10) / 10,
    disk,
    load: Math.round(load * 100) / 100,
    uptimeSec: 86400 * 4 + Math.floor(t % 86400),
    spark: spark.map((n) => Math.round(n * 10) / 10),
  };
}

async function readSettings(sql: Sql): Promise<PanelSettings> {
  const rows = await sql<Record<string, unknown>>`select * from panel_settings where id = 1`;
  const row = rows[0];
  if (!row) {
    return {
      hostname: process.env.SCHELA_HOSTNAME?.trim() || "panel.schela.local",
      isolation: true,
      setupComplete: false,
      sshPort: 22,
      autoUpdates: true,
    };
  }
  return {
    hostname: String(row.hostname),
    isolation: row.isolation === true || row.isolation === "t",
    setupComplete: row.setup_complete === true || row.setup_complete === "t",
    sshPort: Number(row.ssh_port),
    autoUpdates: row.auto_updates === true || row.auto_updates === "t",
  };
}

async function seedModules(sql: Sql, enabledSlugs: string[]) {
  const existing = await sql<{ slug: string }>`select slug from modules`;
  if (existing.length > 0) return;
  for (const mod of MODULES) {
    const enabled = enabledSlugs.includes(mod.slug);
    await sql`
      insert into modules (slug, name, description, version, enabled, core, sort_order)
      values (${mod.slug}, ${mod.name}, ${mod.description}, ${mod.version}, ${enabled}, ${mod.core}, ${mod.sort})
    `;
  }
}

async function seedBaseFirewall(sql: Sql) {
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

async function ensureSetup(sql: Sql): Promise<void> {
  const existing = await sql<{ id: number }>`select id from panel_settings where id = 1`;
  if (existing.length === 0) {
    const hostname = process.env.SCHELA_HOSTNAME?.trim() || "panel.schela.local";
    await sql`
      insert into panel_settings (id, hostname, isolation, setup_complete, ssh_port, auto_updates)
      values (1, ${hostname}, true, true, 22, true)
    `;
    await logActivity(sql, "setup", "Schela is ready");
  }
  await seedModules(sql, ["php", "node", "firewall", "ssl", "mail", "dns", "backups"]);
  await seedBaseFirewall(sql);
  for (const mod of MODULES) {
    await sql`
      update modules
      set name = ${mod.name}, description = ${mod.description}, version = ${mod.version}, sort_order = ${mod.sort}
      where slug = ${mod.slug}
    `;
  }
}

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { hasAdmin: await hasAdminUser() };
});

export const sessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const user = await getSessionUser();
  return user ? { id: user.id, email: user.email } : null;
});

/**
 * The only panel data shown before sign-in: the hostname on the login page.
 * Also runs first-boot setup and creates the bootstrap admin, which must
 * happen before anyone can sign in.
 */
export const getLoginInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ hostname: string }> => {
    const sql = await getSql();
    await ensureSetup(sql);
    await bootstrapAdminIfNeeded();
    const settings = await readSettings(sql);
    return { hostname: settings.hostname };
  },
);

export const getPanelState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async (): Promise<PanelState> => {
      const sql = await getSql();
      await ensureSetup(sql);
      await bootstrapAdminIfNeeded();
      const settings = await readSettings(sql);
      const modules = (await sql<Record<string, unknown>>`
        select * from modules order by sort_order
      `).map(mapModule);
      return { settings, modules };
    },
  );

const setupSchema = z.object({
  hostname: z.string().min(1).max(120),
  isolation: z.boolean(),
  modules: z.array(z.string()),
});

export const completeSetup = createServerFn({ method: "POST" })
  .validator(setupSchema)
  .handler(async ({ data }): Promise<PanelState> => {
    const sql = await getSql();
    const existing = await readSettings(sql);
    if (existing.setupComplete) {
      const modules = (await sql<Record<string, unknown>>`
        select * from modules order by sort_order
      `).map(mapModule);
      return { settings: existing, modules };
    }
    const hostname = data.hostname.trim().toLowerCase();
    await sql`
      insert into panel_settings (id, hostname, isolation, setup_complete, ssh_port, auto_updates)
      values (1, ${hostname}, ${data.isolation}, true, 22, true)
    `;
    const enabled = new Set(["ssl", ...data.modules]);
    await seedModules(sql, [...enabled]);
    await seedBaseFirewall(sql);
    await logActivity(sql, "setup", "Schela is ready");
    const settings = await readSettings(sql);
    const modules = (await sql<Record<string, unknown>>`
      select * from modules order by sort_order
    `).map(mapModule);
    await applyAfterChange(sql);
    return { settings, modules };
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async (): Promise<DashboardData> => {
      const sql = await getSql();
      await ensureSetup(sql);
      const settings = await readSettings(sql);
      const modules = (await sql<Record<string, unknown>>`
        select * from modules order by sort_order
      `).map(mapModule);
      const sites = (await sql<Record<string, unknown>>`
        select sites.*, ip_addresses.address as ip_address
        from sites
        left join ip_addresses on ip_addresses.id = sites.ip_id
        order by sites.created_at desc
      `).map(mapSite);
      const apps = (await sql<Record<string, unknown>>`
        select node_apps.*, ip_addresses.address as ip_address
        from node_apps
        left join ip_addresses on ip_addresses.id = node_apps.ip_id
        order by node_apps.created_at desc
      `).map(mapApp);
      const activity = (await sql<Record<string, unknown>>`
        select * from activity order by created_at desc limit 8
      `).map(mapActivity);
      const siteCount = await sql<{ n: number }>`select count(*)::int as n from sites`;
      const appCount = await sql<{ n: number }>`select count(*)::int as n from node_apps`;
      const mailCount = await sql<{ n: number }>`select count(*)::int as n from mailboxes`;
      const zoneCount = await sql<{ n: number }>`select count(*)::int as n from dns_zones`;
      const fwCount = await sql<{ n: number }>`select count(*)::int as n from firewall_rules`;
      return {
        settings,
        modules,
        metrics: await liveMetrics(),
        counts: {
          sites: siteCount[0]?.n ?? 0,
          apps: appCount[0]?.n ?? 0,
          mailboxes: mailCount[0]?.n ?? 0,
          zones: zoneCount[0]?.n ?? 0,
          firewall: fwCount[0]?.n ?? 0,
        },
        sites,
        apps,
        activity,
      };
    },
  );

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

export const listFirewall = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select * from firewall_rules order by id
    `).map(mapRule);
  });

export const createFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      action: z.enum(["allow", "deny"]),
      protocol: z.enum(["tcp", "udp", "any"]),
      port: z.string().min(1).max(20),
      source: z.string().min(1).max(80),
      comment: z.string().max(80),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      insert into firewall_rules (direction, action, protocol, port, source, comment, enabled)
      values ('in', ${data.action}, ${data.protocol}, ${data.port}, ${data.source}, ${data.comment}, true)
      returning *
    `;
    await logActivity(
      sql,
      "firewall",
      `${data.action} ${data.protocol}/${data.port} from ${data.source}`,
    );
    await applyAfterChange(sql);
    return mapRule(rows[0]);
  });

export const toggleFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      update firewall_rules set enabled = ${data.enabled} where id = ${data.id} returning *
    `;
    await applyAfterChange(sql);
    return rows[0] ? mapRule(rows[0]) : null;
  });

export const deleteFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from firewall_rules where id = ${data.id}`;
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
    const ip = isVpsApply() ? publicIp() : "203.0.113.10";
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

export const listModules = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`select * from modules order by sort_order`).map(
      mapModule,
    );
  });

export const toggleModule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      update modules set enabled = ${data.enabled} where id = ${data.id} returning *
    `;
    if (rows[0]) {
      await logActivity(
        sql,
        "module",
        `${data.enabled ? "Enabled" : "Disabled"} ${String(rows[0].name)}`,
      );
    }
    await applyAfterChange(sql);
    return rows[0] ? mapModule(rows[0]) : null;
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      hostname: z.string().min(1).max(120).optional(),
      isolation: z.boolean().optional(),
      sshPort: z.number().min(1).max(65535).optional(),
      autoUpdates: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const current = await readSettings(sql);
    const hostname = data.hostname ?? current.hostname;
    const isolation = data.isolation ?? current.isolation;
    const sshPort = data.sshPort ?? current.sshPort;
    const autoUpdates = data.autoUpdates ?? current.autoUpdates;
    await sql`
      update panel_settings
      set hostname = ${hostname},
          isolation = ${isolation},
          ssh_port = ${sshPort},
          auto_updates = ${autoUpdates}
      where id = 1
    `;
    await applyAfterChange(sql);
    return readSettings(sql);
  });

export const getAdminIdentity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ email: string }>`
      select email from "user" where id = ${context.userId}
    `;
    const email = rows[0]?.email ?? "admin@schela.local";
    return { username: displayUsername(email), email };
  });

export const updateAdminIdentity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ username: z.string().min(1).max(120) }))
  .handler(async ({ data, context }) => {
    const email = toAuthEmail(data.username);
    const name = displayUsername(email);
    const sql = await getSql();
    await sql`
      update "user" set email = ${email}, name = ${name} where id = ${context.userId}
    `;
    await sql`
      update "account"
      set "accountId" = ${email}
      where "userId" = ${context.userId} and "providerId" = 'credential'
    `;
    return { username: name, email };
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
    const ip = isVpsApply() ? publicIp() : "203.0.113.10";
    const expected = mailDnsBlueprint(domain, ip).map((r) => ({
      type: r.type,
      name: r.name,
      value: r.value,
    }));
    return checkMailDnsLive(domain, expected);
  });
