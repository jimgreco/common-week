-- Keep one durable task identity while unfinished work advances through days
-- and weeks. Original placement remains available for carryover context.
alter table planning_items
  add column original_planning_date date,
  add column original_week_start_date date,
  add column carryover_count integer not null default 0,
  add column last_carried_at timestamptz;

update planning_items
   set original_planning_date = planning_date,
       original_week_start_date = week_start_date;

alter table planning_items
  alter column original_week_start_date set not null,
  add constraint planning_items_original_monday_week check (
    extract(isodow from original_week_start_date) = 1
  ),
  add constraint planning_items_original_date_in_week check (
    original_planning_date is null
    or original_planning_date between original_week_start_date and original_week_start_date + 6
  ),
  add constraint planning_items_nonnegative_carryover_count check (carryover_count >= 0);

create function set_planning_item_origins() returns trigger as $$
begin
  if new.original_week_start_date is null then
    new.original_week_start_date := new.week_start_date;
  end if;
  if new.original_planning_date is null and new.planning_date is not null then
    new.original_planning_date := new.planning_date;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger planning_items_set_origins before insert on planning_items
for each row execute function set_planning_item_origins();

create function carry_over_open_tasks(
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
     and (
       (planning_date is not null and planning_date < target_date)
       or
       (planning_date is null and week_start_date < target_week_start)
     );

  get diagnostics carried_count = row_count;
  return carried_count;
end;
$$ language plpgsql;

create index planning_items_open_daily_carryover_idx
  on planning_items (household_id, planning_date)
  where type = 'task' and not is_completed and planning_date is not null;

create index planning_items_open_weekly_carryover_idx
  on planning_items (household_id, week_start_date)
  where type = 'task' and not is_completed and planning_date is null;
