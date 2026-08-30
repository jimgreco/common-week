alter table notification_outbox
  add column read_at timestamptz;

create index notification_outbox_inbox_idx
  on notification_outbox (user_id, created_at desc);

create index notification_outbox_unread_idx
  on notification_outbox (user_id, created_at desc)
  where read_at is null;

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references notification_outbox(id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outbox_id, channel)
);

create index notification_deliveries_due_idx
  on notification_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'failed', 'sending');

create trigger notification_deliveries_updated_at before update on notification_deliveries
for each row execute function set_updated_at();

-- Preserve the best available history for rows delivered before channel-level
-- tracking existed. Exact per-channel outcomes were not previously retained.
insert into notification_deliveries (outbox_id, channel, status, attempts, next_attempt_at, delivered_at, last_error)
select no.id, channel.name,
       case
         when no.delivered_at is not null then 'delivered'
         when channel.name = 'email' and not coalesce(np.email_enabled, true) then 'skipped'
         when channel.name = 'push' and (
           not coalesce(np.push_enabled, true)
           or not exists (select 1 from push_devices pd where pd.user_id = no.user_id)
         ) then 'skipped'
         else 'pending'
       end,
       no.attempts, no.scheduled_for, no.delivered_at,
       case
         when no.delivered_at is not null then 'Imported from aggregate delivery history.'
         when channel.name = 'email' and not coalesce(np.email_enabled, true) then 'Email is disabled in notification preferences.'
         when channel.name = 'push' and not coalesce(np.push_enabled, true) then 'Push is disabled in notification preferences.'
         when channel.name = 'push' and not exists (select 1 from push_devices pd where pd.user_id = no.user_id) then 'No iPhone is registered for push.'
         else no.last_error
       end
  from notification_outbox no
  left join notification_preferences np on np.user_id = no.user_id
 cross join (values ('email'), ('push')) as channel(name)
on conflict (outbox_id, channel) do nothing;

create table notification_scheduler_state (
  singleton boolean primary key default true check (singleton),
  last_processed_at timestamptz not null
);

insert into notification_scheduler_state (singleton, last_processed_at)
values (true, now())
on conflict (singleton) do nothing;

create trigger notification_outbox_notify after insert or update of read_at on notification_outbox
for each row execute function notify_household_change();
