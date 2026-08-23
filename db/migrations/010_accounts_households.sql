-- Decouple application accounts from Google Calendar and add the durable state
-- required for Apple authorization, delivered invitations, and safe retries.
alter table users alter column google_subject drop not null;

create table user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google', 'apple')),
  provider_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject),
  unique (user_id, provider)
);

insert into user_identities (user_id, provider, provider_subject)
select id, 'google', google_subject from users where google_subject is not null
on conflict do nothing;

create table apple_connections (
  user_id uuid primary key references users(id) on delete cascade,
  refresh_token_encrypted text not null,
  client_id text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table household_invitations
  add column token_hash bytea,
  add column sent_at timestamptz,
  add column delivery_id text,
  add column delivery_error text;

create unique index household_invitations_token_hash_idx
  on household_invitations (token_hash) where token_hash is not null;

create table native_connection_codes (
  code_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  client_state_hash bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
