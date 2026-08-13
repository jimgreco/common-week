create table native_auth_codes (
  code_hash bytea primary key,
  client_state_hash bytea not null,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index native_auth_codes_expires_at_idx on native_auth_codes(expires_at);
