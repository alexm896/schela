-- Managed MariaDB and PostgreSQL databases, their login users and per-database
-- access levels. Passwords are never stored: only the hash each engine accepts
-- (mysql_native_password for MariaDB, a SCRAM-SHA-256 verifier for PostgreSQL).

create table if not exists databases (
  id serial primary key,
  engine text not null check (engine in ('mariadb', 'postgresql')),
  name text not null,
  site_id integer references sites(id) on delete set null,
  app_id integer references node_apps(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (engine, name),
  check (site_id is null or app_id is null)
);

create table if not exists database_users (
  id serial primary key,
  engine text not null check (engine in ('mariadb', 'postgresql')),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  unique (engine, name)
);

create table if not exists database_grants (
  user_id integer not null references database_users(id) on delete cascade,
  database_id integer not null references databases(id) on delete cascade,
  level text not null check (level in ('full', 'readwrite', 'readonly')),
  primary key (user_id, database_id)
);

create index if not exists databases_site_idx on databases (site_id);
create index if not exists databases_app_idx on databases (app_id);
create index if not exists database_grants_database_idx on database_grants (database_id);
