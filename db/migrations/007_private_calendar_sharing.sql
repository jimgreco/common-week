-- Calendars are shared with the household only after their owner explicitly
-- selects them in Settings. Existing choices predate that consent boundary, so
-- reset them once and clear provider-derived data that may include calendars
-- the member now intends to keep private.
alter table calendar_preferences
  alter column is_selected set default false;

create trigger calendar_preferences_notify
after insert or update or delete on calendar_preferences
for each row execute function notify_household_change();

update calendar_preferences
   set is_selected = false
 where is_selected = true;

delete from calendar_event_cache;
delete from hidden_calendar_events;

comment on column calendar_preferences.is_selected is
  'True only when the calendar owner explicitly shares this calendar with the household planner.';
