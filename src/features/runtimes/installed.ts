// Which supported PHP and Node versions are present on this machine. Server only.
// Relative .ts imports keep this file loadable by the node:test runner.
import { isVpsApply } from "../../server/env.ts";
import { NODE_CATALOG, PHP_CATALOG } from "./catalog.ts";
import { nodeMajors, selectableVersions, versionAllowed, type Runtime } from "./runtimes.ts";

async function exists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installed versions on the VPS. Local dev has no PHP or Node set up the way
 * the installer does it, so there every supported version counts as present.
 */
export async function installedVersions(runtime: Runtime): Promise<string[] | undefined> {
  if (!isVpsApply()) return undefined;
  if (runtime === "php") {
    const found: string[] = [];
    for (const v of PHP_CATALOG.supported) {
      if (await exists(`/usr/sbin/php-fpm${v}`)) found.push(v);
    }
    return found;
  }
  const { readdir } = await import("node:fs/promises");
  try {
    return nodeMajors(await readdir("/usr/local/n/versions/node"));
  } catch {
    return [];
  }
}

export async function selectableFor(runtime: Runtime): Promise<string[]> {
  const catalog = runtime === "php" ? PHP_CATALOG : NODE_CATALOG;
  return selectableVersions(catalog, await installedVersions(runtime));
}

/** Throws unless `requested` may be used for a new site/app or a switch. */
export async function assertVersionAllowed(
  runtime: Runtime,
  requested: string,
  current?: string,
): Promise<void> {
  const selectable = await selectableFor(runtime);
  if (versionAllowed(selectable, requested, current)) return;
  const name = runtime === "php" ? "PHP" : "Node";
  const offered = selectable.length ? selectable.join(", ") : "none installed";
  throw new Error(`${name} ${requested} is not available. Choose one of: ${offered}`);
}
