import { assertConfirmed, chosen, option, type RemovalPlan } from "@/lib/removal";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import type { Sql } from "@/server/db";
import { purge } from "@/server/purge";
import { mailboxDomain, type MailboxRemovalOption } from "./mail";
import { mailDnsLabels, removeMailDns } from "./mail-dns";
import { mapMailbox } from "./map";
import type { Mailbox } from "./types";

// Deleting a mailbox: its messages, and the domain's mail DNS once no mailbox
// on the domain is left.

export async function mailboxById(sql: Sql, id: number): Promise<Mailbox> {
  const rows = await sql<Record<string, unknown>>`select * from mailboxes where id = ${id}`;
  if (!rows[0]) throw new Error("Mailbox not found");
  return mapMailbox(rows[0]);
}

async function isLastOnDomain(sql: Sql, box: Mailbox): Promise<boolean> {
  const domain = mailboxDomain(box.address);
  const others = await sql<{ address: string }>`select address from mailboxes where id <> ${box.id}`;
  return !others.some((o) => mailboxDomain(o.address) === domain);
}

export async function mailboxRemovalPlan(sql: Sql, box: Mailbox): Promise<RemovalPlan<MailboxRemovalOption>> {
  const domain = mailboxDomain(box.address);
  const dns = (await isLastOnDomain(sql, box)) ? await mailDnsLabels(sql, domain) : [];
  return {
    confirm: null,
    alsoRemoved: [],
    options: [
      ...option("messages", "Messages", [`Every folder of ${box.address}`], false),
      ...option("dns", `Mail DNS records of ${domain}`, dns, true),
    ],
    notes: [],
  };
}

/** Deletes the mailbox with what the admin ticked. Returns what could not be removed. */
export async function removeMailbox(
  sql: Sql,
  box: Mailbox,
  requested: readonly MailboxRemovalOption[],
): Promise<string[]> {
  const plan = await mailboxRemovalPlan(sql, box);
  assertConfirmed(plan, undefined);
  const picked = chosen(plan, requested);
  if (picked.has("dns")) await removeMailDns(sql, mailboxDomain(box.address));
  await sql`delete from mailboxes where id = ${box.id}`;
  await logActivity(sql, "mail", `Removed mailbox ${box.address}`);
  await applyAfterChange(sql);
  return picked.has("messages") ? purge([{ op: "maildir", address: box.address }]) : [];
}
