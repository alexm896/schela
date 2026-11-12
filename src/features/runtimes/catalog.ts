// The version catalog shared with the installer and schela-apply.
import versions from "../../../installer/versions.json" with { type: "json" };
import type { Runtime, RuntimeCatalog } from "./runtimes";

export const RUNTIME_CATALOG: Record<Runtime, RuntimeCatalog> = versions;
export const PHP_CATALOG = RUNTIME_CATALOG.php;
export const NODE_CATALOG = RUNTIME_CATALOG.node;
