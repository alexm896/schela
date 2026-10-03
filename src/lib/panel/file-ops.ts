import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { appSystemUser } from "@/lib/utils";
import {
  chmodAt,
  copyAt,
  createFileAt,
  deleteAt,
  listDir,
  mkdirAt,
  moveAt,
  readFileAt,
  renameAt,
  writeFileAt,
} from "./files";
import { virtJoin, virtNormalize, virtParent, type FileTarget } from "./file-types";
import { mapApp, mapSite } from "./map";
import { siteFilesRoot } from "./site-root";

const targetSchema = z.object({
  kind: z.enum(["site", "app"]),
  id: z.number().int().positive(),
});

const relSchema = z.string().max(1024);

const nameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !/[\\/\0]/.test(s) && s !== "." && s !== "..", "Invalid name");

type Resolved = {
  virtRoot: string;
  seed: { kind: "site" | "app"; domain: string };
  target: FileTarget;
};

async function resolveTarget(
  kind: "site" | "app",
  id: number,
): Promise<Resolved> {
  const sql = await getSql();
  if (kind === "site") {
    const rows = await sql<Record<string, unknown>>`
      select * from sites where id = ${id}
    `;
    if (!rows[0]) throw new Error("Site not found");
    const site = mapSite(rows[0]);
    const virtRoot = siteFilesRoot(site.systemUser);
    return {
      virtRoot,
      seed: { kind: "site", domain: site.domain },
      target: {
        kind: "site",
        id: site.id,
        label: site.domain,
        domain: site.domain,
        user: site.systemUser,
        virtRoot,
      },
    };
  }
  const rows = await sql<Record<string, unknown>>`
    select * from node_apps where id = ${id}
  `;
  if (!rows[0]) throw new Error("App not found");
  const app = mapApp(rows[0]);
  const user = appSystemUser(app.name);
  const virtRoot = `/home/${user}/app`;
  return {
    virtRoot,
    seed: { kind: "app", domain: app.domain },
    target: {
      kind: "app",
      id: app.id,
      label: app.domain,
      domain: app.domain,
      user,
      virtRoot,
    },
  };
}

export const listFileTargets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<FileTarget[]> => {
    const sql = await getSql();
    const sites = (await sql<Record<string, unknown>>`
      select * from sites order by domain
    `).map(mapSite);
    const apps = (await sql<Record<string, unknown>>`
      select * from node_apps order by name
    `).map(mapApp);
    const targets: FileTarget[] = [
      ...sites.map((site) => ({
        kind: "site" as const,
        id: site.id,
        label: site.domain,
        domain: site.domain,
        user: site.systemUser,
        virtRoot: siteFilesRoot(site.systemUser),
      })),
      ...apps.map((app) => ({
        kind: "app" as const,
        id: app.id,
        label: app.domain,
        domain: app.domain,
        user: appSystemUser(app.name),
        virtRoot: `/home/${appSystemUser(app.name)}/app`,
      })),
    ];
    return targets;
  });

export const listFiles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ ...targetSchema.shape, path: relSchema.optional() }))
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    const path = virtNormalize(data.path || "/");
    const listing = await listDir(resolved.virtRoot, path, resolved.seed);
    return { ...listing, target: resolved.target };
  });

export const readFile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      binary: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return readFileAt(resolved.virtRoot, virtNormalize(data.path), {
      binary: data.binary,
    });
  });

export const writeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      content: z.string(),
      encoding: z.enum(["utf8", "base64"]).default("utf8"),
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return writeFileAt(
      resolved.virtRoot,
      virtNormalize(data.path),
      data.content,
      data.encoding,
    );
  });

export const createFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      name: nameSchema,
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return createFileAt(resolved.virtRoot, virtJoin(data.path || "/", data.name));
  });

export const createDir = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      name: nameSchema,
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return mkdirAt(resolved.virtRoot, virtJoin(data.path || "/", data.name));
  });

export const renameFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      name: nameSchema,
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    const from = virtNormalize(data.path);
    const parent = virtParent(from) ?? "/";
    return renameAt(resolved.virtRoot, from, virtJoin(parent, data.name));
  });

export const deleteFiles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      paths: z.array(relSchema).min(1).max(50),
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    for (const p of data.paths) {
      await deleteAt(resolved.virtRoot, virtNormalize(p));
    }
    return { ok: true as const, count: data.paths.length };
  });

export const chmodFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      mode: z.string().min(3).max(5),
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return chmodAt(resolved.virtRoot, virtNormalize(data.path), data.mode);
  });

export const copyFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      to: relSchema,
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return copyAt(resolved.virtRoot, virtNormalize(data.path), virtNormalize(data.to));
  });

export const moveFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      to: relSchema,
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return moveAt(resolved.virtRoot, virtNormalize(data.path), virtNormalize(data.to));
  });

export const uploadFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...targetSchema.shape,
      path: relSchema,
      name: nameSchema,
      content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const resolved = await resolveTarget(data.kind, data.id);
    return writeFileAt(
      resolved.virtRoot,
      virtJoin(data.path || "/", data.name),
      data.content,
      "base64",
    );
  });
