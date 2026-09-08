alter table planning_items add column responsible_member_id uuid;
alter table planning_items add column deadline date;
alter table planning_items add column is_backlog boolean not null default false;
alter table planning_items add constraint backlog_has_no_day check(not is_backlog or planning_date is null);
create index planning_items_deadlines on planning_items(household_id,deadline) where not is_completed;

create table item_collaboration (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references households(id) on delete cascade,
 planning_item_id uuid references planning_items(id) on delete cascade,
 calendar_preference_id uuid,
 provider_event_id text,
 foreign key(household_id,calendar_preference_id) references calendar_preferences(household_id,id) on delete cascade,
 check((planning_item_id is not null and calendar_preference_id is null and provider_event_id is null)
    or (planning_item_id is null and calendar_preference_id is not null and provider_event_id is not null)),
 unique(planning_item_id), unique(calendar_preference_id,provider_event_id)
);
create table item_collaboration_entries (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references households(id) on delete cascade,
 collaboration_id uuid not null references item_collaboration(id) on delete cascade,
 kind text not null check(kind in ('checklist','comment','file')),
 text text not null check(length(text) between 1 and 4000),
 completed boolean not null default false,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 file_data bytea,
 check(file_data is null or (kind='file' and octet_length(file_data)<=5242880))
);
create index item_collaboration_entries_resource on item_collaboration_entries(collaboration_id,created_at);
create trigger collaboration_entries_notify after insert or update or delete on item_collaboration_entries for each row execute function notify_household_change();
create function clear_task_responsibility() returns trigger as $$
begin
 if not exists(select 1 from households where id=old.household_id) then return old; end if;
 if TG_TABLE_NAME='child_profiles' then
 update planning_items set responsible_member_id=null where household_id=old.household_id and responsible_member_id=old.id;
 else
 update planning_items set responsible_member_id=null where household_id=old.household_id and responsible_member_id=old.user_id;
 end if;
 return old;
end;
$$ language plpgsql;
create trigger child_responsibility_cleanup before delete on child_profiles for each row execute function clear_task_responsibility();
create trigger adult_responsibility_cleanup before delete on household_members for each row execute function clear_task_responsibility();
create or replace function carry_over_open_tasks(
  target_household_id uuid,
  target_date date,
  target_week_start date,
  carried_at timestamptz
) returns integer as $$
declare
  carried_count integer;
begin
  if extract(isodow from target_week_start) <> 1
     or target_date < target_week_start
     or target_date > target_week_start + 6 then
    raise exception 'Carryover target must be a date inside its Monday-based week.';
  end if;

  update planning_items
     set planning_date = case
           when planning_date is not null then target_date
           else null
         end,
         week_start_date = target_week_start,
         carryover_count = carryover_count + case
           when planning_date is not null then target_date - planning_date
           else (target_week_start - week_start_date) / 7
         end,
         last_carried_at = carried_at
   where household_id = target_household_id
     and type = 'task'
     and not is_completed
     and not is_backlog
     and (
       (planning_date is not null and planning_date < target_date)
       or
       (planning_date is null and week_start_date < target_week_start)
     );

  get diagnostics carried_count = row_count;
  return carried_count;
end;
$$ language plpgsql;

