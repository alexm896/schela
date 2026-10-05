import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { dnsRecordIp } from "@/server/env";
import { checkMailDnsLive } from "./dns-check";
import { mailboxDomain } from "./mail";
import { describeMailDns, ensureMailDns, mailDnsBlueprint } from "./mail-dns";
import { mapMailbox } from "./map";
import { hashMailboxPassword } from "./password";

export const listMailboxes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select id, address, quota_mb, used_mb, status, created_at,
        (password_hash is not null and password_hash <> '') as has_password
      from mailboxes
      order by address
    `).map(mapMailbox);
  });

export const createMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      address: z.string().min(3).max(120),
      quotaMb: z.number().min(128).max(51200),
      password: z.string().min(8).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const address = data.address.trim().toLowerCase();
    if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) {
      throw new Error("Enter a full address like hello@example.com");
    }
    const hash = hashMailboxPassword(data.password);
    const rows = await sql<Record<string, unknown>>`
      insert into mailboxes (address, quota_mb, used_mb, status, password_hash)
      values (${address}, ${data.quotaMb}, 0, 'active', ${hash})
      returning id, address, quota_mb, used_mb, status, created_at
    `;
    await logActivity(sql, "mail", `Created mailbox ${address}`);
    await ensureMailDns(sql, address);
    await applyAfterChange(sql);
    return mapMailbox({ ...rows[0], has_password: true });
  });

export const setMailboxPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.number(),
      password: z.string().min(8).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const hash = hashMailboxPassword(data.password);
    const rows = await sql<Record<string, unknown>>`
      update mailboxes set password_hash = ${hash} where id = ${data.id}
      returning id, address, quota_mb, used_mb, status, created_at
    `;
    if (!rows[0]) throw new Error("Mailbox not found");
    await logActivity(sql, "mail", `Set password for ${String(rows[0].address)}`);
    await applyAfterChange(sql);
    return mapMailbox({ ...rows[0], has_password: true });
  });

export const toggleMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), status: z.enum(["active", "disabled"]) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      update mailboxes set status = ${data.status} where id = ${data.id} returning *
    `;
    await applyAfterChange(sql);
    return rows[0] ? mapMailbox(rows[0]) : null;
  });

export const deleteMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from mailboxes where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true };
  });

export const listMailDns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const boxes = await sql<{ address: string }>`select address from mailboxes`;
    const domains = [
      ...new Set(boxes.map((b) => mailboxDomain(b.address)).filter((d) => d.includes("."))),
    ];
    const result = [];
    for (const domain of domains) {
      result.push(await describeMailDns(sql, domain));
    }
    return result;
  });

export const checkMailDns = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ domain: z.string().min(3).max(120) }))
  .handler(async ({ data }) => {
    const domain = data.domain.trim().toLowerCase();
    const ip = dnsRecordIp();
    const expected = mailDnsBlueprint(domain, ip).map((r) => ({
      type: r.type,
      name: r.name,
      value: r.value,
    }));
    return checkMailDnsLive(domain, expected);
  });
