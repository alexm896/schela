-- Long-running processes per site (Laravel queue workers, Horizon, scheduler).
-- Each row becomes a systemd template unit that runs as the site's user.

create table if not exists site_workers (
  id serial primary key,
  site_id integer not null references sites(id) on delete cascade,
  name text not null,
  preset text not null default 'custom',
  command text not null,
  processes integer not null default 1 check (processes between 1 and 8),
  stop_timeout integer not null default 3600 check (stop_timeout between 5 and 7200),
  memory_mb integer not null default 512 check (memory_mb between 64 and 8192),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists site_workers_site_idx on site_workers (site_id);
