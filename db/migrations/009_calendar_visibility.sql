alter table calendar_preferences
  add column visibility text not null default 'hide';

update calendar_preferences
   set visibility = case when is_selected then 'share' else 'hide' end;

alter table calendar_preferences
  add constraint calendar_preferences_visibility_valid
  check (visibility in ('hide', 'private', 'share'));

alter table calendar_preferences
  add constraint calendar_preferences_visibility_selected_consistent
  check (is_selected = (visibility = 'share'));

comment on column calendar_preferences.visibility is
  'Hide excludes the calendar from Week of Us, private shows it only to its owner, and share shows it to the household.';

comment on column calendar_preferences.is_selected is
  'Compatibility flag that is true only when visibility is share.';
