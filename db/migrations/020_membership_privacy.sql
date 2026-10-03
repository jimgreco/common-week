-- Revoke membership access without deleting historical collaboration or files.
-- This migration was revised before any production release. Do not deploy the
-- superseded audit commit that used membership foreign-key deletion cascades.
-- Each household retains its own historical calendar record. Never move its
-- collaboration/files when the same provider calendar is discovered elsewhere.
alter table calendar_preferences drop constraint calendar_preferences_user_id_google_calendar_id_key;
alter table calendar_preferences add constraint calendar_preferences_household_user_calendar_key
  unique (household_id, user_id, google_calendar_id);

alter table notification_reminders
  add column membership_revoked_at timestamptz,
  -- Legacy active reminders keep their existing dedupe identity. A fresh value
  -- is assigned only when the user explicitly restores a quarantined reminder.
  add column delivery_version uuid;
alter table notification_outbox add column membership_revoked_at timestamptz;

-- Retain orphan preferences and their dependent files/ownership for recovery,
-- while requiring fresh sharing consent if the owner later rejoins.
update calendar_preferences cp set visibility = 'hide', is_selected = false
 where not exists (
   select 1 from household_members hm
    where hm.household_id = cp.household_id and hm.user_id = cp.user_id
 );
update notification_reminders nr set membership_revoked_at = now()
 where not exists (
   select 1 from household_members hm
    where hm.household_id = nr.household_id and hm.user_id = nr.user_id
 ) or exists (
   select 1 from calendar_preferences cp
    where cp.id = nr.calendar_preference_id
      and not exists (select 1 from household_members hm
                       where hm.household_id = cp.household_id and hm.user_id = cp.user_id)
 );
update notification_outbox no set membership_revoked_at = now()
 where not exists (
   select 1 from household_members hm
    where hm.household_id = no.household_id and hm.user_id = no.user_id
 ) or exists (
   select 1 from notification_reminders nr
    where nr.membership_revoked_at is not null
      and left(no.dedupe_key, char_length('reminder:' || nr.id::text || ':')) = 'reminder:' || nr.id::text || ':'
 );
update notification_deliveries nd
   set status = 'skipped', last_error = 'Household membership access was revoked.'
  from notification_outbox no
 where no.id = nd.outbox_id and no.membership_revoked_at is not null
   and nd.status <> 'delivered';
-- Invalidate derived provider responses; retain their bytes until normal refresh.
update calendar_event_cache set expires_at = least(expires_at, now());

-- Lock membership during new writes so a concurrent departure either waits and
-- quarantines that write, or finishes first and makes the new write fail closed.
create function require_record_household_member() returns trigger as $$
begin
  perform 1 from household_members hm
   where hm.household_id = new.household_id and hm.user_id = new.user_id
   for key share;
  if not found then
    raise exception 'Current household membership is required.' using errcode = '23503';
  end if;
  if tg_table_name = 'notification_reminders' then
   if new.resource_kind = 'calendar_event' then
    perform 1 from calendar_preferences cp
      join household_members hm on hm.household_id = cp.household_id and hm.user_id = cp.user_id
     where cp.id = new.calendar_preference_id and cp.household_id = new.household_id
       and (cp.visibility = 'share' or (cp.visibility = 'private' and cp.user_id = new.user_id))
     for key share of hm;
    if not found then
      raise exception 'Current calendar access is required.' using errcode = '23503';
    end if;
  end if;
  end if;
  if tg_table_name = 'notification_outbox' then
   if new.kind = 'reminder' and new.dedupe_key like 'reminder:%' then
    perform 1 from notification_reminders nr
     where nr.id::text = split_part(new.dedupe_key, ':', 2)
       and nr.user_id = new.user_id and nr.household_id = new.household_id
       and nr.membership_revoked_at is null
       and (nr.resource_kind = 'planning_item' or exists (
         select 1 from calendar_preferences cp join household_members hm
           on hm.household_id = cp.household_id and hm.user_id = cp.user_id
          where cp.id = nr.calendar_preference_id and cp.household_id = new.household_id
            and (cp.visibility = 'share' or (cp.visibility = 'private' and cp.user_id = new.user_id))
          for key share of hm
       )) for share of nr;
    if not found then
      raise exception 'Current reminder access is required.' using errcode = '23503';
    end if;
  end if;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger calendar_preferences_current_member before insert or update on calendar_preferences
for each row execute function require_record_household_member();
create trigger notification_reminders_current_member before insert or update of household_id, user_id on notification_reminders
for each row execute function require_record_household_member();
create trigger notification_outbox_current_member before insert or update of household_id, user_id on notification_outbox
for each row execute function require_record_household_member();

create function quarantine_departed_calendar_data() returns trigger as $$
begin
  -- A BEFORE trigger retains membership while the guarded preference update runs.
  update calendar_preferences set visibility = 'hide', is_selected = false
   where household_id = old.household_id and user_id = old.user_id;
  update calendar_event_cache set expires_at = least(expires_at, now()) where user_id = old.user_id;
  update notification_reminders nr set membership_revoked_at = coalesce(membership_revoked_at, now())
   where (nr.household_id = old.household_id and nr.user_id = old.user_id)
      or exists (select 1 from calendar_preferences cp where cp.id = nr.calendar_preference_id
                  and cp.household_id = old.household_id and cp.user_id = old.user_id);
  update notification_outbox no set membership_revoked_at = coalesce(membership_revoked_at, now())
   where (no.household_id = old.household_id and no.user_id = old.user_id)
      or exists (select 1 from notification_reminders nr where nr.membership_revoked_at is not null
                  and left(no.dedupe_key, char_length('reminder:' || nr.id::text || ':')) = 'reminder:' || nr.id::text || ':');
  update notification_deliveries nd
     set status = 'skipped', last_error = 'Household membership access was revoked.'
    from notification_outbox no
   where no.id = nd.outbox_id and no.membership_revoked_at is not null and nd.status <> 'delivered';
  return old;
end;
$$ language plpgsql;
create trigger departed_calendar_data before delete on household_members
for each row execute function quarantine_departed_calendar_data();
