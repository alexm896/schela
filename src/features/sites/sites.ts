// PHP sites: the system user each site runs as.
// Pure, shared by the server functions and the UI.

export function systemUserFromDomain(domain: string) {
  const slug = domain
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return `s_${slug || "site"}`;
}
