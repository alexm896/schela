// PHP sites: versions on offer and the system user each site runs as.
// Pure, shared by the server functions and the UI.

export const PHP_VERSIONS = ["8.1", "8.2", "8.3", "8.4"] as const;

export type PhpVersion = (typeof PHP_VERSIONS)[number];

export function systemUserFromDomain(domain: string) {
  const slug = domain
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return `s_${slug || "site"}`;
}
