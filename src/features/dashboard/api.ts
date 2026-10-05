import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/auth/middleware";
import { mapActivity } from "@/server/activity";
import { getSql } from "@/server/db";
import { mapApp, mapSite } from "@/lib/panel/map";
import { readModules } from "@/features/modules/modules";
import { ensureSetup, readSettings } from "@/features/settings/settings";
import { liveMetrics } from "./metrics";
import type { DashboardData } from "./types";

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async (): Promise<DashboardData> => {
      const sql = await getSql();
      await ensureSetup(sql);
      const settings = await readSettings(sql);
      const modules = await readModules(sql);
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
