-- Better Auth twoFactor plugin schema (TOTP secret and recovery codes).
--
-- Generated with Better Auth 1.7.22's getMigrations() for the Postgres adapter
-- against a database at 0007, with twoFactor() added to the plugins; only
-- "if not exists" was added. Columns are camelCase and MUST stay double-quoted
-- so Postgres preserves the case Better Auth queries by.
--
-- Existing accounts get "twoFactorEnabled" = false, so they sign in as before
-- until the admin turns two-factor on in Settings.

alter table "user" add column if not exists "twoFactorEnabled" boolean default false;

create table if not exists "twoFactor" (
  "id" text not null primary key,
  "secret" text not null,
  "backupCodes" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);

create index if not exists "twoFactor_secret_idx" on "twoFactor" ("secret");
create index if not exists "twoFactor_userId_idx" on "twoFactor" ("userId");
