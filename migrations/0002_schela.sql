-- Schela hosting panel schema. Unowned rows (auth off).

create table if not exists panel_settings (
  id integer primary key check (id = 1),
  hostname text not null default 'panel.schela.local',
  isolation boolean not null default true,
  setup_complete boolean not null default false,
  ssh_port integer not null default 22,
  auto_updates boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists modules (
  id serial primary key,
  slug text not null unique,
  name text not null,
  description text not null,
  version text not null,
  enabled boolean not null default false,
  core boolean not null default false,
  sort_order integer not null default 0
);

create table if not exists sites (
  id serial primary key,
  domain text not null unique,
  php_version text not null default '8.3',
  root text not null,
  ssl boolean not null default true,
  force_https boolean not null default true,
  isolated boolean not null default true,
  jail_user text not null,
  pool text not null,
  status text not null default 'active',
  memory_limit text not null default '256M',
  created_at timestamptz not null default now()
);

create table if not exists node_apps (
  id serial primary key,
  name text not null,
  domain text not null unique,
  node_version text not null default '22',
  port integer not null,
  status text not null default 'running',
  entry text not null default 'server.js',
  instances integer not null default 1,
  memory_mb integer not null default 256,
  created_at timestamptz not null default now()
);

create table if not exists firewall_rules (
  id serial primary key,
  direction text not null default 'in',
  action text not null default 'allow',
  protocol text not null default 'tcp',
  port text not null,
  source text not null default 'any',
  comment text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mailboxes (
  id serial primary key,
  address text not null unique,
  quota_mb integer not null default 2048,
  used_mb integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists dns_zones (
  id serial primary key,
  name text not null unique,
  serial integer not null default 1,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists dns_records (
  id serial primary key,
  zone_id integer not null references dns_zones(id) on delete cascade,
  type text not null,
  name text not null,
  value text not null,
  ttl integer not null default 300,
  priority integer
);

create table if not exists activity (
  id serial primary key,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists dns_records_zone_idx on dns_records (zone_id);
create index if not exists activity_created_idx on activity (created_at desc);
