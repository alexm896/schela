import type { Sql } from "@/server/db";
import { mapModule } from "./map";
import type { ModuleRow } from "./types";

// The modules the panel knows about. Rows in `modules` hold whether each one is
// enabled; name, description, version and order always come from this list.

export const MODULES = [
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
  {
    slug: "mariadb",
    name: "MariaDB",
    description: "MySQL-compatible databases for PHP sites. Off by default. Disable stops it; data and package stay.",
    version: "1.0",
    core: false,
    sort: 9,
  },
  {
    slug: "postgresql",
    name: "PostgreSQL",
    description: "PostgreSQL databases for Node apps and Laravel. Off by default. Disable stops it; data and package stay.",
    version: "1.0",
    core: false,
    sort: 10,
  },
] as const;

export async function seedModules(sql: Sql, enabledSlugs: string[]) {
  const existing = new Set((await sql<{ slug: string }>`select slug from modules`).map((r) => r.slug));
  const fresh = existing.size === 0;
  for (const mod of MODULES) {
    if (existing.has(mod.slug)) continue;
    // A module added in a later release starts off on an existing install.
    const enabled = fresh && enabledSlugs.includes(mod.slug);
    await sql`
      insert into modules (slug, name, description, version, enabled, core, sort_order)
      values (${mod.slug}, ${mod.name}, ${mod.description}, ${mod.version}, ${enabled}, ${mod.core}, ${mod.sort})
      on conflict (slug) do nothing
    `;
  }
}

/** Refresh name, description, version and order from MODULES on every start. */
export async function syncModuleCatalog(sql: Sql) {
  for (const mod of MODULES) {
    await sql`
      update modules
      set name = ${mod.name}, description = ${mod.description}, version = ${mod.version}, sort_order = ${mod.sort}
      where slug = ${mod.slug}
    `;
  }
}

export async function readModules(sql: Sql): Promise<ModuleRow[]> {
  return (await sql<Record<string, unknown>>`select * from modules order by sort_order`).map(mapModule);
}
