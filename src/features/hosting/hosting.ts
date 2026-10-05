// Sites and Node apps are both hosting accounts: a system user with a home,
// a hostname, and the cron jobs, backup jobs and databases that belong to it.
// Pure, shared by the server functions and the UI.

/** What may go with a deleted site or app besides its configuration. */
export const HOSTING_REMOVAL_OPTIONS = ["dns", "databases", "archives", "files"] as const;
export type HostingRemovalOption = (typeof HOSTING_REMOVAL_OPTIONS)[number];
