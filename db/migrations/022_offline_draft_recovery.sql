-- Recovery is an explicit user action. Keep its receipt after item deletion so
-- a delayed callback/retry cannot resurrect the item. No historical rows move.
create table offline_draft_recoveries (
  user_id uuid not null references users(id) on delete cascade,
  source_mutation_id uuid not null,
  household_id uuid not null references households(id) on delete cascade,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  draft_digest text not null check (draft_digest ~ '^[a-f0-9]{64}$'),
  item_id uuid not null,
  recovered_at timestamptz not null default now(),
  primary key (user_id, source_mutation_id),
  unique (user_id, item_id)
);
-- Deliberately no item FK: receipts outlive removal of the recovered item.
-- Migrations and the API use the same dedicated database/table owner login.
-- That owner is exempt from non-FORCE RLS; other roles are default-denied.
-- Do not grant BYPASSRLS, add an allow-all policy, or apply this as a different
-- migration owner. See scripts/check-offline-recovery-role.mjs and release notes.
alter table offline_draft_recoveries enable row level security;
