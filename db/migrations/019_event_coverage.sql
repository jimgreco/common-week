create table event_coverage (
 household_id uuid not null references households(id) on delete cascade,
 calendar_preference_id uuid not null,
 provider_event_id text not null,
 child_id uuid not null,
 drop_off_user_id uuid,
 pickup_user_id uuid,
 drop_off_needed boolean not null default true,
 pickup_needed boolean not null default true,
 drop_off_confirmed boolean not null default false,
 pickup_confirmed boolean not null default false,
 travel_minutes integer not null default 20 check(travel_minutes between 0 and 180),
 notes text not null default '' check(length(notes)<=1000),
 revision integer not null default 0,
 primary key(calendar_preference_id,provider_event_id,child_id),
 foreign key(household_id,child_id) references child_profiles(household_id,id) on delete cascade,
 foreign key(household_id,calendar_preference_id) references calendar_preferences(household_id,id) on delete cascade,
 foreign key(household_id,drop_off_user_id) references household_members(household_id,user_id),
 foreign key(household_id,pickup_user_id) references household_members(household_id,user_id)
);
create function clear_departed_coverage() returns trigger as $$
begin
 if not exists(select 1 from households where id=old.household_id) then return old; end if;
 update event_coverage set drop_off_user_id=null,drop_off_confirmed=false,revision=revision+1 where household_id=old.household_id and drop_off_user_id=old.user_id;
 update event_coverage set pickup_user_id=null,pickup_confirmed=false,revision=revision+1 where household_id=old.household_id and pickup_user_id=old.user_id;
 return old;
end;
$$ language plpgsql;
create trigger departed_coverage before delete on household_members for each row execute function clear_departed_coverage();
create trigger event_coverage_notify after insert or update or delete on event_coverage for each row execute function notify_household_change();
