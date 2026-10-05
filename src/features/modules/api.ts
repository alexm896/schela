import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { mapModule } from "./map";
import { readModules } from "./modules";

export const listModules = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return readModules(sql);
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
