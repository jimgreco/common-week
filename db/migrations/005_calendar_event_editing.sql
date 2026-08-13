alter table calendar_preferences
  add column access_role text not null default 'reader';

alter table calendar_preferences
  add constraint calendar_preferences_access_role_valid
  check (access_role in (
    'freeBusyReader',
    'reader',
    'writer',
    'owner'
  ));
