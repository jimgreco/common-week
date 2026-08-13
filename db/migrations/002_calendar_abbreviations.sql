alter table calendar_preferences
  add column display_abbreviation text;

alter table calendar_preferences
  add constraint calendar_preferences_display_abbreviation_length
  check (
    display_abbreviation is null
    or char_length(display_abbreviation) between 1 and 2
  );
