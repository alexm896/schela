-- Backup secrets (S3 secret key, SSH private key) live in root-only files under
-- /var/lib/schela/backup-keys, written by schela-backup-keys. The panel keeps
-- whether each one is set and a hint that is not the secret.
--
-- s3_secret_key and rsync_ssh_key (the path of a key file) are what older
-- panels stored. The panel moves them to the key files through the helper,
-- which SQL cannot call, and then empties them (src/features/backups/secrets.ts).

alter table backup_jobs add column if not exists s3_secret_set boolean not null default false;
alter table backup_jobs add column if not exists s3_secret_hint text not null default '';
alter table backup_jobs add column if not exists rsync_key_set boolean not null default false;
alter table backup_jobs add column if not exists rsync_key_hint text not null default '';
