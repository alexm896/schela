import { backupJobsOf, deleteBackupJobs } from "@/features/backups/jobs";
import { cronJobLabels, deleteCronJobs } from "@/features/cron/jobs";
import { DATABASE_ENGINES } from "@/features/databases/databases";
import { databasesOwnedBy, dropDatabase } from "@/features/databases/manage";
import { hostDnsLabels, removeHostDns } from "@/features/dns/records";
import { describeKey, dropOwnerIndexes, loadSearchKeys, ownerIndexLabels, revokeOwnerKeys } from "@/features/search/manage";
import {
  assertConfirmed,
  chosen,
  group,
  option,
  type RemovalGroup,
  type RemovalPlan,
} from "@/lib/removal";
import { applyAfterChange } from "@/server/apply";
import type { Sql } from "@/server/db";
import { purge, type PurgeRequest } from "@/server/purge";
import type { HostingRemovalOption } from "./hosting";

// Deleting a site or a Node app: what goes with it, and doing it.

export type HostingAccount = {
  kind: "site" | "app";
  id: number;
  /** What the admin types to confirm: the site's domain or the app's name. */
  name: string;
  hostname: string;
  systemUser: string;
};

function owner(account: HostingAccount) {
  return account.kind === "site" ? { siteId: account.id } : { appId: account.id };
}

function searchOwner(account: HostingAccount) {
  return { kind: account.kind, id: account.id };
}

export async function hostingRemovalPlan(
  sql: Sql,
  account: HostingAccount,
  /** Removed with it too, beyond what every account has (a site's workers). */
  alsoRemoved: RemovalGroup[] = [],
): Promise<RemovalPlan<HostingRemovalOption>> {
  const cron = await cronJobLabels(sql, { kind: account.kind, id: account.id });
  const backups = await backupJobsOf(sql, { scope: account.kind, id: account.id });
  const databases = await databasesOwnedBy(sql, owner(account));
  const searchKeys = await loadSearchKeys(sql, searchOwner(account));
  const home = `/home/${account.systemUser}`;
  return {
    confirm: account.name,
    alsoRemoved: [
      ...alsoRemoved,
      ...group("Cron jobs", cron),
      ...group("Backup jobs", backups.map((b) => b.name)),
      ...group("Search keys (revoked)", searchKeys.map(describeKey)),
    ],
    options: [
      ...option("dns", "DNS records", await hostDnsLabels(sql, account.hostname), true),
      ...option(
        "databases",
        `Databases of this ${account.kind}`,
        databases.map((d) => `${d.name} (${DATABASE_ENGINES[d.engine].label})`),
        false,
      ),
      ...option("search", "Search indexes", await ownerIndexLabels(sql, searchOwner(account)), false),
      ...option("archives", "Archives of its backup jobs", backups.map((b) => b.name), false),
      ...option("files", "Files and system user", [`${home} and the user ${account.systemUser}`], false),
    ],
    notes: [`Unless you tick Files, ${home} and the user ${account.systemUser} stay on the server.`],
  };
}

/**
 * Deletes the account with what the admin ticked. `deleteRow` removes the
 * site or app row itself. Returns what could not be removed.
 */
export async function removeHostingAccount(
  sql: Sql,
  account: HostingAccount,
  plan: RemovalPlan<HostingRemovalOption>,
  requested: readonly HostingRemovalOption[],
  typed: string | undefined,
  deleteRow: () => Promise<void>,
): Promise<string[]> {
  assertConfirmed(plan, typed);
  const picked = chosen(plan, requested);
  // Databases first: dropping one can fail, and then the account is still whole.
  if (picked.has("databases")) {
    for (const db of await databasesOwnedBy(sql, owner(account))) await dropDatabase(sql, db);
  }
  // Keys are revoked before the row goes; one that cannot be (engine down) is
  // reported. It reaches only this account's own indexes, and ids are never reused.
  const warnings = await revokeOwnerKeys(sql, searchOwner(account));
  const jobs = await backupJobsOf(sql, { scope: account.kind, id: account.id });
  await deleteCronJobs(sql, { kind: account.kind, id: account.id });
  await deleteBackupJobs(sql, jobs.map((j) => j.id));
  if (picked.has("dns")) await removeHostDns(sql, account.hostname);
  await deleteRow();
  await applyAfterChange(sql);

  const purges: PurgeRequest[] = [];
  if (picked.has("files")) purges.push({ op: "account", user: account.systemUser });
  if (picked.has("archives")) purges.push(...jobs.map((j) => ({ op: "backups" as const, jobId: j.id })));
  // After the apply: schela-search refuses an owner still in the state.
  if (picked.has("search")) warnings.push(...(await dropOwnerIndexes(sql, searchOwner(account))));
  return [...warnings, ...(await purge(purges))];
}
