import { isVpsApply } from "./env";
import { runSudoHelper } from "./sudo-helper";

// Data a delete leaves behind unless the admin asks for it to go, removed by
// schela-purge as root. Call it after the delete is applied: the helper
// refuses anything still in state.json.

const HELPER = "/usr/local/sbin/schela-purge";

export type PurgeRequest =
  | { op: "account"; user: string }
  | { op: "maildir"; address: string }
  | { op: "backups"; jobId: number };

/**
 * Runs each request and returns one warning per failure. The delete itself
 * has already happened by then, so a failure here is reported, not thrown.
 */
export async function purge(requests: readonly PurgeRequest[]): Promise<string[]> {
  if (!isVpsApply()) return [];
  const warnings: string[] = [];
  for (const req of requests) {
    try {
      await runSudoHelper(HELPER, req, { label: "Removing data", timeoutMs: 120_000 });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(`${describe(req)} could not be removed: ${reason}`);
    }
  }
  return warnings;
}

function describe(req: PurgeRequest): string {
  if (req.op === "account") return `The files of ${req.user}`;
  if (req.op === "maildir") return `The messages of ${req.address}`;
  return `The archives of backup job ${req.jobId}`;
}
