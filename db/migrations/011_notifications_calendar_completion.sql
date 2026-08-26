create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  morning_digest_enabled boolean not null default false,
  morning_digest_time time not null default '07:00',
  sunday_planning_enabled boolean not null default false,
  sunday_planning_time time not null default '18:00',
  household_change_alerts boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_token text not null check (device_token ~ '^[0-9A-Fa-f]{64,}$'),
  environment text not null check (environment in ('sandbox', 'production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_token, environment)
);

create table notification_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('planning_item', 'calendar_event')),
  planning_item_id uuid references planning_items(id) on delete cascade,
  calendar_preference_id uuid references calendar_preferences(id) on delete cascade,
  provider_event_id text,
  resource_title text not null check (char_length(resource_title) between 1 and 1000),
  resource_start timestamptz,
  remind_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_reminders_resource_check check (
    (resource_kind = 'planning_item' and planning_item_id is not null and calendar_preference_id is null and provider_event_id is null)
    or
    (resource_kind = 'calendar_event' and planning_item_id is null and calendar_preference_id is not null and provider_event_id is not null)
  )
);

create unique index notification_reminders_planning_item_idx
  on notification_reminders (user_id, planning_item_id)
  where resource_kind = 'planning_item';

create unique index notification_reminders_calendar_event_idx
  on notification_reminders (user_id, calendar_preference_id, provider_event_id)
  where resource_kind = 'calendar_event';

create index notification_reminders_due_idx
  on notification_reminders (remind_at)
  where delivered_at is null;

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  dedupe_key text not null unique,
  kind text not null check (kind in ('reminder', 'morning_digest', 'sunday_planning', 'household_change')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 4000),
  deep_link text not null default '/planner' check (deep_link like '/%'),
  scheduled_for timestamptz not null,
  delivered_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index notification_outbox_due_idx
  on notification_outbox (scheduled_for)
  where delivered_at is null;

create trigger notification_preferences_updated_at before update on notification_preferences
for each row execute function set_updated_at();

create trigger push_devices_updated_at before update on push_devices
for each row execute function set_updated_at();

create trigger notification_reminders_updated_at before update on notification_reminders
for each row execute function set_updated_at();
