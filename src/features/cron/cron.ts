// Cron jobs that run as a site or app user. Pure, shared by the server
// functions, the state dump, the UI and the tests.

import { appSystemUser } from "../apps/apps.ts";

const CRON_FIELD = /^(\*(\/[1-9]\d*)?|([0-9]{1,2})(-[0-9]{1,2})?(\/[1-9]\d*)?)(,(([0-9]{1,2})(-[0-9]{1,2})?(\/[1-9]\d*)?|\*(\/[1-9]\d*)?))*$/;

export function assertCronSchedule(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  const parts = s.split(" ");
  if (parts.length !== 5) throw new Error("Schedule must be five cron fields (min hour day month weekday)");
  if (parts.some((p) => !CRON_FIELD.test(p))) {
    throw new Error("Invalid cron field — use *, numbers, commas, ranges, or /step");
  }
  return s;
}

export function assertCronCommand(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error("Command required");
  if (s.length > 400) throw new Error("Command is too long");
  if (/[\n\r%]/.test(s)) throw new Error("Command cannot contain newlines or %");
  return s;
}

export const CRON_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily at 03:00", value: "0 3 * * *" },
  { label: "Weekly, Sunday 03:00", value: "0 3 * * 0" },
  { label: "Monthly, 1st 03:00", value: "0 3 1 * *" },
] as const;

/** The system user a job runs as: the site's jail user, or the app's `sa_` user. */
export function cronUser(kind: "site" | "app", siteUser: string | null, appName: string | null): string {
  if (kind === "site") return siteUser || "";
  return appSystemUser(appName || "app");
}
