import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/auth/middleware";
import { NODE_CATALOG, PHP_CATALOG } from "./catalog";
import { selectableFor } from "./installed";
import { defaultVersion, type RuntimeCatalog } from "./runtimes";

export type RuntimeChoices = {
  catalog: RuntimeCatalog;
  selectable: string[];
  default: string;
};

async function choices(catalog: RuntimeCatalog, runtime: "php" | "node"): Promise<RuntimeChoices> {
  const selectable = await selectableFor(runtime);
  return { catalog, selectable, default: defaultVersion(catalog, selectable) };
}

export const getRuntimes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({
    php: await choices(PHP_CATALOG, "php"),
    node: await choices(NODE_CATALOG, "node"),
  }));
