-- Backup jobs: local archive plus optional rsync and/or S3 in the same run.

create table if not exists backup_jobs (
  id serial primary key,
  name text not null,
  scope text not null default 'all',
  target_id integer,
  include_mail boolean not null default true,
  schedule text not null default '0 3 * * *',
  retain integer not null default 7,
  enabled boolean not null default true,
  rsync_enabled boolean not null default false,
  rsync_dest text not null default '',
  rsync_ssh_key text not null default '',
  s3_enabled boolean not null default false,
  s3_bucket text not null default '',
  s3_prefix text not null default 'schela/',
  s3_region text not null default 'us-east-1',
  s3_access_key text not null default '',
  s3_secret_key text not null default '',
  s3_endpoint text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists backup_jobs_enabled_idx on backup_jobs (enabled);
