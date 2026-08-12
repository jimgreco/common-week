create extension if not exists pgcrypto;
create extension if not exists citext;

create type household_role as enum ('owner', 'member', 'viewer');
create type planning_item_type as enum ('note', 'task');
create type invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type temperature_unit as enum ('fahrenheit', 'celsius');

create table users (
  id uuid primary key default gen_random_uuid(),
  google_subject text not null unique,
  email citext not null unique,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  default_location_id uuid,
  timezone text not null default 'America/New_York',
  temperature_unit temperature_unit not null default 'fahrenheit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role household_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (user_id)
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  timezone text not null,
  is_saved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name)
);

alter table households
  add constraint households_default_location_fk
  foreign key (default_location_id) references locations(id) on delete set null;

create table categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index categories_household_name_unique_idx
  on categories (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table daily_settings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  location_id uuid not null references locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, date)
);

create table planning_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  created_by uuid not null references users(id) on delete restrict,
  planning_date date,
  week_start_date date not null,
  type planning_item_type not null,
  category_id uuid references categories(id) on delete set null,
  text text not null check (char_length(text) between 1 and 1000),
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_items_monday_week check (extract(isodow from week_start_date) = 1),
  constraint planning_items_date_in_week check (
    planning_date is null or planning_date between week_start_date and week_start_date + 6
  )
);

create table household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  email citext not null check (char_length(email::text) between 3 and 320),
  invited_by uuid not null references users(id) on delete cascade,
  status invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index invitations_household_pending_email_unique_idx
  on household_invitations (household_id, email) where status = 'pending';

create table calendar_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  google_calendar_id text not null check (char_length(google_calendar_id) between 1 and 1024),
  calendar_name text not null check (char_length(calendar_name) between 1 and 250),
  display_alias text check (display_alias is null or char_length(display_alias) between 1 and 40),
  color text not null default '#718096' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_selected boolean not null default true,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_calendar_id)
);

-- Provider credentials are encrypted in the application before they reach PostgreSQL.
create table google_connections (
  user_id uuid primary key references users(id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calendar_event_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  cache_key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  events jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, cache_key)
);

create table weather_cache (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  forecast_date date not null,
  daily jsonb not null,
  hourly jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (location_id, forecast_date)
);

create index auth_sessions_user_id_idx on auth_sessions(user_id);
create index auth_sessions_expires_at_idx on auth_sessions(expires_at);
create index household_members_user_id_idx on household_members(user_id);
create index planning_items_household_id_idx on planning_items(household_id);
create index planning_items_week_start_date_idx on planning_items(week_start_date);
create index planning_items_planning_date_idx on planning_items(planning_date);
create index planning_items_household_week_idx on planning_items(household_id, week_start_date);
create index planning_items_household_date_idx on planning_items(household_id, planning_date);
create index daily_settings_household_id_idx on daily_settings(household_id);
create index daily_settings_date_idx on daily_settings(date);
create index daily_settings_household_date_idx on daily_settings(household_id, date);
create index locations_household_id_idx on locations(household_id);
create index invitations_email_status_idx on household_invitations(email, status);
create index calendar_preferences_household_user_idx on calendar_preferences(household_id, user_id);
create index weather_cache_expiry_idx on weather_cache(expires_at);

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_updated_at before update on users
for each row execute function set_updated_at();
create trigger households_updated_at before update on households
for each row execute function set_updated_at();
create trigger locations_updated_at before update on locations
for each row execute function set_updated_at();
create trigger daily_settings_updated_at before update on daily_settings
for each row execute function set_updated_at();
create trigger planning_items_updated_at before update on planning_items
for each row execute function set_updated_at();
create trigger calendar_preferences_updated_at before update on calendar_preferences
for each row execute function set_updated_at();
create trigger google_connections_updated_at before update on google_connections
for each row execute function set_updated_at();

create or replace function notify_household_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  changed_household_id uuid;
begin
  if tg_table_name = 'households' then
    changed_household_id := coalesce(new.id, old.id);
  else
    changed_household_id := coalesce(new.household_id, old.household_id);
  end if;

  perform pg_notify(
    'common_week_changes',
    json_build_object('householdId', changed_household_id, 'table', tg_table_name)::text
  );
  return coalesce(new, old);
end;
$$;

create trigger planning_items_notify after insert or update or delete on planning_items
for each row execute function notify_household_change();
create trigger daily_settings_notify after insert or update or delete on daily_settings
for each row execute function notify_household_change();
create trigger households_notify after update on households
for each row execute function notify_household_change();
create trigger locations_notify after insert or update or delete on locations
for each row execute function notify_household_change();

insert into categories (id, household_id, name, color, sort_order) values
  ('10000000-0000-4000-8000-000000000001', null, 'Meals', '#B87946', 10),
  ('10000000-0000-4000-8000-000000000002', null, 'Kids', '#8A759F', 20),
  ('10000000-0000-4000-8000-000000000003', null, 'House', '#66867B', 30),
  ('10000000-0000-4000-8000-000000000004', null, 'Errands', '#77756E', 40),
  ('10000000-0000-4000-8000-000000000005', null, 'Social', '#B06F65', 50),
  ('10000000-0000-4000-8000-000000000006', null, 'Travel', '#657E9A', 60),
  ('10000000-0000-4000-8000-000000000007', null, 'To Do', '#9A845D', 70),
  ('10000000-0000-4000-8000-000000000008', null, 'Other', '#85827C', 80);
