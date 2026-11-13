import { logActivity } from "@/server/activity";
import type { Sql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { runSudoHelper } from "@/server/sudo-helper";

// Backup secrets (the S3 secret key, the SSH private key for rsync) go to
// root-only files through schela-backup-keys, which never answers one back. The
// database and state.json keep whether each is set and a hint (last four
// characters of the S3 secret, the SSH key's fingerprint).

const HELPER = "/usr/local/sbin/schela-backup-keys";

export type SecretKind = "s3" | "ssh";

const SET_COLUMN = { s3: "s3_secret_set", ssh: "rsync_key_set" } as const;
const HINT_COLUMN = { s3: "s3_secret_hint", ssh: "rsync_key_hint" } as const;

async function keysHelper(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (isVpsApply()) return runSudoHelper(HELPER, req, { label: "Backup key" });
  // Local dev: there is no root helper and backups never leave the box, so the
  // secret is dropped and only its hint is kept.
  if (req.op === "set" && req.kind === "s3") return { ok: true, hint: String(req.value).trim().slice(-4) };
  return { ok: true, hint: "" };
}

/** Stores a job's secret and records that it is set. */
export async function saveBackupSecret(sql: Sql, jobId: number, kind: SecretKind, value: string): Promise<void> {
  const answer = await keysHelper({ op: "set", job: jobId, kind, value });
  await markSecret(sql, jobId, kind, true, String(answer.hint ?? ""));
}

/** Removes a job's secrets (one kind, or all) and records that none is set. */
export async function removeBackupSecrets(sql: Sql | null, jobIds: readonly number[], kind?: SecretKind): Promise<void> {
  if (jobIds.length === 0) return;
  await keysHelper(kind ? { op: "delete", jobs: jobIds, kind } : { op: "delete", jobs: jobIds });
  if (!sql) return;
  for (const id of jobIds) {
    for (const k of kind ? [kind] : (["s3", "ssh"] as const)) {
      await markSecret(sql, id, k, false, "");
    }
  }
}

async function markSecret(sql: Sql, jobId: number, kind: SecretKind, set: boolean, hint: string) {
  await sql.query(
    `update backup_jobs set ${SET_COLUMN[kind]} = $1, ${HINT_COLUMN[kind]} = $2 where id = $3`,
    [set, hint, jobId],
  );
}

type LegacyRow = { id: number; name: string; s3_secret_key: string; rsync_ssh_key: string };

async function legacyRows(sql: Sql): Promise<LegacyRow[]> {
  return sql<LegacyRow>`
    select id, name, s3_secret_key, rsync_ssh_key from backup_jobs
    where s3_secret_key <> '' or rsync_ssh_key <> ''
    order by id
  `;
}

const globalRef = globalThis as typeof globalThis & { __schelaLegacySecretsDone__?: boolean };

/** True while a job still has an S3 secret or an SSH key path from an older panel. */
export async function hasLegacyBackupSecrets(sql: Sql): Promise<boolean> {
  if (globalRef.__schelaLegacySecretsDone__) return false;
  const left = (await legacyRows(sql)).length > 0;
  if (!left) globalRef.__schelaLegacySecretsDone__ = true;
  return left;
}

/**
 * Moves what older panels stored (the S3 secret in the database, the path of an
 * SSH key file) into the key files and empties the old columns. Runs before
 * every apply on the server, so state.json is rewritten without them in the
 * same apply. An S3 secret the helper cannot take stays for the next try; a key
 * path that holds no usable key is dropped with a note in the activity log
 * (the file itself is left where it is).
 */
export async function moveLegacyBackupSecrets(sql: Sql): Promise<void> {
  if (!isVpsApply()) return;
  for (const row of await legacyRows(sql)) {
    const id = Number(row.id);
    if (row.s3_secret_key) {
      try {
        await saveBackupSecret(sql, id, "s3", row.s3_secret_key);
        await sql`update backup_jobs set s3_secret_key = '' where id = ${id}`;
      } catch (err) {
        console.error(`[schela] backup ${id}: S3 secret not moved:`, err);
      }
    }
    if (row.rsync_ssh_key) {
      try {
        const answer = await keysHelper({ op: "import", job: id, path: row.rsync_ssh_key });
        await markSecret(sql, id, "ssh", true, String(answer.hint ?? ""));
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        await logActivity(
          sql,
          "backup",
          `Backup ${row.name}: the SSH key at ${row.rsync_ssh_key} was not moved (${why}). Paste the key in the job.`,
        );
      }
      await sql`update backup_jobs set rsync_ssh_key = '' where id = ${id}`;
    }
  }
}
