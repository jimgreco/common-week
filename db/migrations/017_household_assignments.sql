alter table planning_items add column assigned_member_ids uuid[];

create table event_member_overrides (
  household_id uuid not null references households(id) on delete cascade,
  calendar_preference_id uuid not null,
  provider_event_id text not null,
  assigned_member_ids uuid[] not null,
  primary key (calendar_preference_id, provider_event_id),
  foreign key (household_id, calendar_preference_id) references calendar_preferences(household_id,id) on delete cascade
);
create trigger event_member_overrides_notify after insert or update or delete on event_member_overrides
for each row execute function notify_household_change();

alter table task_routines add column assigned_member_ids uuid[];

-- Deleted profiles and departed adults must not remain selectable assignments.
create function remove_household_assignment_member() returns trigger as $$
declare removed_id uuid;
begin
  if not exists(select 1 from households where id=old.household_id) then return old; end if;
  if TG_TABLE_NAME='household_members' then removed_id=old.user_id;
  else removed_id=old.id;
  end if;
  update planning_items set assigned_member_ids=array_remove(assigned_member_ids,removed_id)
    where household_id=old.household_id and removed_id=any(assigned_member_ids);
  update task_routines set assigned_member_ids=array_remove(assigned_member_ids,removed_id)
    where household_id=old.household_id and removed_id=any(assigned_member_ids);
  update event_member_overrides set assigned_member_ids=array_remove(assigned_member_ids,removed_id)
    where household_id=old.household_id and removed_id=any(assigned_member_ids);
  update week_templates set items=(select coalesce(jsonb_agg(case when jsonb_typeof(item->'assignedMemberIds')='array'
    then jsonb_set(item,'{assignedMemberIds}',(item->'assignedMemberIds')-removed_id::text) else item end),'[]'::jsonb)
    from jsonb_array_elements(items) item) where household_id=old.household_id;
  return old;
end;
$$ language plpgsql;
create trigger child_assignment_cleanup before delete on child_profiles for each row execute function remove_household_assignment_member();
create trigger adult_assignment_cleanup before delete on household_members for each row execute function remove_household_assignment_member();
