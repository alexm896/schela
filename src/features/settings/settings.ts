import { seedBaseFirewall } from "@/features/firewall/defaults";
import { seedModules, syncModuleCatalog } from "@/features/modules/modules";
import { logActivity } from "@/server/activity";
import type { Sql } from "@/server/db";
import type { PanelSettings } from "./types";

export async function readSettings(sql: Sql): Promise<PanelSettings> {
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

export async function ensureSetup(sql: Sql): Promise<void> {
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
  await syncModuleCatalog(sql);
}
