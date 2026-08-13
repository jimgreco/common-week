create table hidden_calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  event_id text not null check (char_length(event_id) between 1 and 2048),
  title text not null check (char_length(title) between 1 and 2048),
  calendar_name text not null check (char_length(calendar_name) between 1 and 1000),
  event_start text not null check (char_length(event_start) between 1 and 100),
  hidden_by uuid not null references users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  unique (household_id, event_id)
);

create index hidden_calendar_events_household_id_idx
  on hidden_calendar_events(household_id);

create trigger hidden_calendar_events_notify
after insert or delete on hidden_calendar_events
for each row execute function notify_household_change();
