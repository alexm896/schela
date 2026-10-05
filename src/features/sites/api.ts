import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { normalizeDomain } from "@/lib/utils";
import { ensureHostDns } from "@/lib/panel/dns-auto";
import { mapSite } from "./map";
import { normalizeWebRoot, siteRootFor, webRootFromRoot } from "./site-root";
import { systemUserFromDomain } from "./sites";
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
