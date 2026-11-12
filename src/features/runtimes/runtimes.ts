// PHP and Node versions: which ones a new site or app may pick, and which
// version switches are allowed. Pure, shared by the server functions and the UI.

export type Runtime = "php" | "node";

export type RuntimeCatalog = {
  /** Installed on new servers and offered for new sites and apps. */
  supported: readonly string[];
  /** No longer installed or offered; existing sites and apps keep running on them. */
  retired: readonly string[];
  default: string;
};

/** Supported versions, narrowed to the installed ones when the box was checked. */
export function selectableVersions(
  catalog: RuntimeCatalog,
  installed?: readonly string[],
): string[] {
  if (!installed) return [...catalog.supported];
  return catalog.supported.filter((v) => installed.includes(v));
}

/** The catalog default when it can be picked, otherwise the newest pickable version. */
export function defaultVersion(catalog: RuntimeCatalog, selectable: readonly string[]): string {
  if (selectable.includes(catalog.default)) return catalog.default;
  return selectable[selectable.length - 1] ?? catalog.default;
}

export function isRetired(catalog: RuntimeCatalog, version: string): boolean {
  return catalog.retired.includes(version);
}

/**
 * A new site or app, or a version switch, may only land on a selectable
 * version. Keeping the version a site or app already runs is always allowed,
 * so editing other settings of a site on a retired version still works.
 */
export function versionAllowed(
  selectable: readonly string[],
  requested: string,
  current?: string,
): boolean {
  if (current !== undefined && requested === current) return true;
  return selectable.includes(requested);
}

export type VersionOption = { value: string; disabled: boolean; note?: string };

/**
 * Options for a version picker: the selectable versions, plus the current one
 * when it is no longer selectable, shown but disabled so it cannot be picked
 * again once left.
 */
export function versionOptions(
  catalog: RuntimeCatalog,
  selectable: readonly string[],
  current?: string,
): VersionOption[] {
  const options: VersionOption[] = selectable.map((v) => ({ value: v, disabled: false }));
  if (current !== undefined && !selectable.includes(current)) {
    options.unshift({
      value: current,
      disabled: true,
      note: isRetired(catalog, current) ? "retired" : "not installed",
    });
  }
  return options;
}

/** Node majors from the folder names in n's cache (e.g. "24.11.1" -> "24"). */
export function nodeMajors(entries: readonly string[]): string[] {
  const majors = new Set<string>();
  for (const name of entries) {
    const m = /^(\d+)\.\d+\.\d+$/.exec(name);
    if (m) majors.add(m[1]);
  }
  return [...majors];
}

/** "8.2, 8.3, 8.4" style list for descriptions. */
export function versionsLabel(versions: readonly string[]): string {
  return versions.join(", ");
}
