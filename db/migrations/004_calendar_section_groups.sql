alter table calendar_preferences
  add column section_group text not null default 'critical';

alter table calendar_preferences
  add constraint calendar_preferences_section_group_valid
  check (section_group in ('critical', 'supplemental'));
