-- API keys Schela made in the local Meilisearch and Typesense for a site or a
-- Node app. The key itself is shown once and never stored: only its id on the
-- engine (to revoke it) and its first characters (to recognise it). Each key
-- reaches only the indexes named "<site|app><id>_...".

create table if not exists search_keys (
  id serial primary key,
  engine text not null check (engine in ('meilisearch', 'typesense')),
  site_id integer references sites(id) on delete cascade,
  app_id integer references node_apps(id) on delete cascade,
  access text not null check (access in ('admin', 'search')),
  key_id text not null,
  key_hint text not null,
  created_at timestamptz not null default now(),
  unique (engine, key_id),
  check ((site_id is null) <> (app_id is null))
);

create index if not exists search_keys_site_idx on search_keys (site_id);
create index if not exists search_keys_app_idx on search_keys (app_id);
