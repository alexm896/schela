import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { bootstrapAdminIfNeeded } from "@/auth/bootstrap-admin";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { seedBaseFirewall } from "@/features/firewall/defaults";
import { readModules, seedModules } from "@/features/modules/modules";
import { ensureSetup, readSettings } from "./settings";
import type { PanelState } from "./types";

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
      const modules = await readModules(sql);
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
      const modules = await readModules(sql);
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
    const modules = await readModules(sql);
    await applyAfterChange(sql);
    return { settings, modules };
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
