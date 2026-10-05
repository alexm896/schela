// Node apps: versions on offer and the system user each app runs as.
// Pure, shared by the server functions and the UI.

export const NODE_VERSIONS = ["18", "20", "22"] as const;

export type NodeVersion = (typeof NODE_VERSIONS)[number];

export function nodeUserFromDomain(domain: string) {
  const slug = domain
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return `n_${slug || "app"}`;
}

/** Matches schela-apply: `sa_` + slug of the app name, max 20. */
export function appSystemUser(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  return `sa_${slug || "app"}`;
}
