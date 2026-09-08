alter table calendar_preferences add constraint calendar_preferences_household_id_key unique (household_id, id);

create table adult_calendar_links (
  household_id uuid not null,
  user_id uuid not null,
  calendar_preference_id uuid not null,
  primary key (household_id, user_id, calendar_preference_id),
  foreign key (household_id, user_id) references household_members(household_id, user_id) on delete cascade,
  foreign key (household_id, calendar_preference_id) references calendar_preferences(household_id, id) on delete cascade
);

-- Preserve the existing person filter initially. Assignments can then be edited
-- independently of the Google account that supplies the calendar.
insert into adult_calendar_links
select cp.household_id, cp.user_id, cp.id from calendar_preferences cp
join household_members hm on hm.household_id=cp.household_id and hm.user_id=cp.user_id;

create function assign_new_calendar_to_connected_adult() returns trigger as $$
begin
  insert into adult_calendar_links(household_id,user_id,calendar_preference_id)
  select new.household_id,new.user_id,new.id
  where exists(select 1 from household_members where household_id=new.household_id and user_id=new.user_id)
  on conflict do nothing;
  return new;
end;
$$ language plpgsql;
create trigger calendar_preferences_default_adult after insert on calendar_preferences
for each row execute function assign_new_calendar_to_connected_adult();
create trigger adult_calendar_links_notify after insert or update or delete on adult_calendar_links
for each row execute function notify_household_change();
