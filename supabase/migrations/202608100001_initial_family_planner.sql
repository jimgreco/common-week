begin;

create extension if not exists pgcrypto;

create type public.household_role as enum ('owner', 'member', 'viewer');
create type public.planning_item_type as enum ('note', 'task');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.temperature_unit as enum ('fahrenheit', 'celsius');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  default_location_id uuid,
  timezone text not null default 'America/New_York',
  temperature_unit public.temperature_unit not null default 'fahrenheit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (user_id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  timezone text not null,
  is_saved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name)
);

alter table public.households
  add constraint households_default_location_fk
  foreign key (default_location_id) references public.locations(id) on delete set null;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (household_id, name)
);

create table public.daily_settings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, date)
);

create table public.planning_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  planning_date date,
  week_start_date date not null,
  type public.planning_item_type not null,
  category_id uuid references public.categories(id) on delete set null,
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

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  invited_by uuid not null references auth.users(id) on delete cascade,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (household_id, email)
);

create table public.calendar_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
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

-- Service-role only: OAuth credentials are never readable through the browser client.
create table public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.calendar_event_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  events jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, cache_key)
);

create table public.weather_cache (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  forecast_date date not null,
  daily jsonb not null,
  hourly jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (location_id, forecast_date)
);

create index household_members_user_id_idx on public.household_members(user_id);
create index planning_items_household_id_idx on public.planning_items(household_id);
create index planning_items_week_start_date_idx on public.planning_items(week_start_date);
create index planning_items_planning_date_idx on public.planning_items(planning_date);
create index planning_items_household_week_idx on public.planning_items(household_id, week_start_date);
create index planning_items_household_date_idx on public.planning_items(household_id, planning_date);
create index daily_settings_household_id_idx on public.daily_settings(household_id);
create index daily_settings_date_idx on public.daily_settings(date);
create index daily_settings_household_date_idx on public.daily_settings(household_id, date);
create index locations_household_id_idx on public.locations(household_id);
create index invitations_email_status_idx on public.household_invitations(lower(email), status);
create unique index invitations_household_email_unique_idx on public.household_invitations(household_id, lower(email));
create index calendar_preferences_household_user_idx on public.calendar_preferences(household_id, user_id);
create index weather_cache_expiry_idx on public.weather_cache(expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger households_updated_at before update on public.households
for each row execute function public.set_updated_at();
create trigger locations_updated_at before update on public.locations
for each row execute function public.set_updated_at();
create trigger daily_settings_updated_at before update on public.daily_settings
for each row execute function public.set_updated_at();
create trigger planning_items_updated_at before update on public.planning_items
for each row execute function public.set_updated_at();
create trigger calendar_preferences_updated_at before update on public.calendar_preferences
for each row execute function public.set_updated_at();
create trigger google_connections_updated_at before update on public.google_connections
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'Family member'), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id and user_id = auth.uid()
  );
$$;

create or replace function public.create_household(
  household_name text,
  household_timezone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(trim(household_name)) not between 1 and 80 then
    raise exception 'Household name must be between 1 and 80 characters';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'User already belongs to a household';
  end if;

  insert into public.households (name, timezone)
  values (trim(household_name), household_timezone)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, auth.uid(), 'owner');

  return new_household_id;
end;
$$;

create or replace function public.accept_household_invitation()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
  matched_invitation public.household_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    select household_id into matched_invitation.household_id
    from public.household_members where user_id = auth.uid();
    return matched_invitation.household_id;
  end if;

  user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into matched_invitation
  from public.household_invitations
  where lower(email) = user_email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1
  for update skip locked;

  if matched_invitation.id is null then
    return null;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (matched_invitation.household_id, auth.uid(), 'member');
  update public.household_invitations
  set status = 'accepted', accepted_at = now()
  where id = matched_invitation.id;
  return matched_invitation.household_id;
end;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.accept_household_invitation() from public, anon;
revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.accept_household_invitation() to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;

insert into public.categories (id, household_id, name, color, sort_order) values
  ('10000000-0000-4000-8000-000000000001', null, 'Meals', '#B87946', 10),
  ('10000000-0000-4000-8000-000000000002', null, 'Kids', '#8A759F', 20),
  ('10000000-0000-4000-8000-000000000003', null, 'House', '#66867B', 30),
  ('10000000-0000-4000-8000-000000000004', null, 'Errands', '#77756E', 40),
  ('10000000-0000-4000-8000-000000000005', null, 'Social', '#B06F65', 50),
  ('10000000-0000-4000-8000-000000000006', null, 'Travel', '#657E9A', 60),
  ('10000000-0000-4000-8000-000000000007', null, 'To Do', '#9A845D', 70),
  ('10000000-0000-4000-8000-000000000008', null, 'Other', '#85827C', 80);

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.locations enable row level security;
alter table public.categories enable row level security;
alter table public.daily_settings enable row level security;
alter table public.planning_items enable row level security;
alter table public.household_invitations enable row level security;
alter table public.calendar_preferences enable row level security;
alter table public.google_connections enable row level security;
alter table public.calendar_event_cache enable row level security;
alter table public.weather_cache enable row level security;

-- Supabase projects no longer assume browser grants for newly created tables.
-- Grant only the operations the V1 client actually needs; RLS still filters every row.
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant select on public.profiles, public.households, public.household_members, public.locations,
  public.categories, public.daily_settings, public.planning_items, public.household_invitations,
  public.calendar_preferences, public.weather_cache to authenticated;
grant insert on public.locations, public.categories, public.daily_settings, public.planning_items,
  public.household_invitations, public.calendar_preferences to authenticated;
grant delete on public.locations, public.categories, public.daily_settings, public.planning_items,
  public.household_invitations, public.calendar_preferences to authenticated;
grant update (name, default_location_id, timezone, temperature_unit) on public.households to authenticated;
grant update (name, latitude, longitude, timezone, is_saved) on public.locations to authenticated;
grant update (name, color, sort_order) on public.categories to authenticated;
grant update on public.daily_settings to authenticated;
grant update (is_selected, display_alias) on public.calendar_preferences to authenticated;

create policy profiles_select_household on public.profiles for select to authenticated
using (
  id = auth.uid() or exists (
    select 1 from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy households_select_member on public.households for select to authenticated
using (public.is_household_member(id));
create policy households_update_member on public.households for update to authenticated
using (public.is_household_member(id)) with check (
  public.is_household_member(id)
  and (
    default_location_id is null
    or exists (
      select 1 from public.locations
      where locations.id = households.default_location_id
        and locations.household_id = households.id
    )
  )
);

create policy members_select_household on public.household_members for select to authenticated
using (public.is_household_member(household_id));

create policy locations_select_member on public.locations for select to authenticated
using (public.is_household_member(household_id));
create policy locations_insert_member on public.locations for insert to authenticated
with check (public.is_household_member(household_id));
create policy locations_update_member on public.locations for update to authenticated
using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy locations_delete_member on public.locations for delete to authenticated
using (public.is_household_member(household_id));

create policy categories_select_available on public.categories for select to authenticated
using (household_id is null or public.is_household_member(household_id));
create policy categories_insert_member on public.categories for insert to authenticated
with check (household_id is not null and public.is_household_member(household_id));
create policy categories_update_member on public.categories for update to authenticated
using (household_id is not null and public.is_household_member(household_id));
create policy categories_delete_member on public.categories for delete to authenticated
using (household_id is not null and public.is_household_member(household_id));

create policy daily_settings_select_member on public.daily_settings for select to authenticated
using (public.is_household_member(household_id));
create policy daily_settings_insert_member on public.daily_settings for insert to authenticated
with check (
  public.is_household_member(household_id)
  and exists (select 1 from public.locations where id = location_id and locations.household_id = daily_settings.household_id)
);
create policy daily_settings_update_member on public.daily_settings for update to authenticated
using (public.is_household_member(household_id))
with check (
  public.is_household_member(household_id)
  and exists (select 1 from public.locations where id = location_id and locations.household_id = daily_settings.household_id)
);
create policy daily_settings_delete_member on public.daily_settings for delete to authenticated
using (public.is_household_member(household_id));

create policy planning_items_select_member on public.planning_items for select to authenticated
using (public.is_household_member(household_id));
create policy planning_items_insert_member on public.planning_items for insert to authenticated
with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
  and (
    category_id is null
    or exists (
      select 1 from public.categories
      where categories.id = planning_items.category_id
        and (categories.household_id is null or categories.household_id = planning_items.household_id)
    )
  )
);
create policy planning_items_update_member on public.planning_items for update to authenticated
using (public.is_household_member(household_id))
with check (
  public.is_household_member(household_id)
  and (
    category_id is null
    or exists (
      select 1 from public.categories
      where categories.id = planning_items.category_id
        and (categories.household_id is null or categories.household_id = planning_items.household_id)
    )
  )
);
create policy planning_items_delete_member on public.planning_items for delete to authenticated
using (public.is_household_member(household_id));

create policy invitations_select_member on public.household_invitations for select to authenticated
using (public.is_household_member(household_id));
create policy invitations_insert_member on public.household_invitations for insert to authenticated
with check (public.is_household_member(household_id) and invited_by = auth.uid());
create policy invitations_delete_member on public.household_invitations for delete to authenticated
using (public.is_household_member(household_id));

create policy calendar_preferences_select_own on public.calendar_preferences for select to authenticated
using (user_id = auth.uid() and public.is_household_member(household_id));
create policy calendar_preferences_insert_own on public.calendar_preferences for insert to authenticated
with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy calendar_preferences_update_own on public.calendar_preferences for update to authenticated
using (user_id = auth.uid() and public.is_household_member(household_id))
with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy calendar_preferences_delete_own on public.calendar_preferences for delete to authenticated
using (user_id = auth.uid() and public.is_household_member(household_id));

create policy weather_cache_select_member on public.weather_cache for select to authenticated
using (exists (
  select 1 from public.locations
  where locations.id = weather_cache.location_id
    and public.is_household_member(locations.household_id)
));

revoke all on public.google_connections from anon, authenticated;
revoke all on public.calendar_event_cache from anon, authenticated;
revoke update on table public.planning_items from authenticated;
grant update (planning_date, week_start_date, type, category_id, text, is_completed, sort_order)
  on public.planning_items to authenticated;

alter table public.planning_items replica identity full;
alter table public.daily_settings replica identity full;
alter table public.households replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.planning_items;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.daily_settings;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.households;
exception when duplicate_object then null;
end $$;

commit;
