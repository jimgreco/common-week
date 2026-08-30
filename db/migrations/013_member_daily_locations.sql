create table daily_member_settings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  member_id uuid not null references household_members(id) on delete cascade,
  date date not null,
  location_id uuid not null references locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, member_id, date)
);

insert into daily_member_settings (household_id, member_id, date, location_id)
select ds.household_id, hm.id, ds.date, ds.location_id
from daily_settings ds
join household_members hm on hm.household_id = ds.household_id
on conflict (household_id, member_id, date) do nothing;

create index daily_member_settings_household_date_idx
  on daily_member_settings(household_id, date);

create trigger daily_member_settings_updated_at before update on daily_member_settings
for each row execute function set_updated_at();

create trigger daily_member_settings_notify after insert or update or delete on daily_member_settings
for each row execute function notify_household_change();
