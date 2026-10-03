-- Calendar sharing and future notifications end with household membership.
-- Remove legacy orphan rows before enforcing the same rule for every writer.
delete from calendar_preferences cp
 where not exists (
   select 1 from household_members hm
    where hm.household_id = cp.household_id and hm.user_id = cp.user_id
 );

delete from notification_reminders nr
 where not exists (
   select 1 from household_members hm
    where hm.household_id = nr.household_id and hm.user_id = nr.user_id
 );

delete from notification_outbox no
 where not exists (
   select 1 from household_members hm
    where hm.household_id = no.household_id and hm.user_id = no.user_id
 );

delete from hidden_calendar_events hce
 where not exists (
   select 1 from calendar_preferences cp
    where cp.household_id = hce.household_id
      and left(hce.event_id, char_length(cp.google_calendar_id) + 1) = cp.google_calendar_id || ':'
 );

-- Cached responses predate the new membership boundary and are cheap to rebuild.
delete from calendar_event_cache;

alter table calendar_preferences
  add constraint calendar_preferences_current_member_fk
  foreign key (household_id, user_id)
  references household_members (household_id, user_id) on delete cascade;

alter table notification_reminders
  add constraint notification_reminders_current_member_fk
  foreign key (household_id, user_id)
  references household_members (household_id, user_id) on delete cascade;

alter table notification_outbox
  add constraint notification_outbox_current_member_fk
  foreign key (household_id, user_id)
  references household_members (household_id, user_id) on delete cascade;

create function clear_departed_calendar_data() returns trigger as $$
begin
  delete from calendar_event_cache where user_id = old.user_id;
  delete from hidden_calendar_events hce
   where hce.household_id = old.household_id
     and exists (
       select 1 from calendar_preferences cp
        where cp.household_id = old.household_id and cp.user_id = old.user_id
          and left(hce.event_id, char_length(cp.google_calendar_id) + 1) = cp.google_calendar_id || ':'
     )
     and not exists (
       select 1 from calendar_preferences cp
        where cp.household_id = old.household_id and cp.user_id <> old.user_id
          and left(hce.event_id, char_length(cp.google_calendar_id) + 1) = cp.google_calendar_id || ':'
     );
  return old;
end;
$$ language plpgsql;

create trigger departed_calendar_data before delete on household_members
for each row execute function clear_departed_calendar_data();
