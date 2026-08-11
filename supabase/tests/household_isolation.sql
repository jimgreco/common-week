-- Run against a disposable Supabase database after applying migrations.
-- This script documents the minimum isolation assertions expected in CI.
begin;

select plan(6);

select has_table('public', 'households', 'households exists');
select has_table('public', 'planning_items', 'planning_items exists');
select has_table('public', 'google_connections', 'google connections exists');
select row_security_active('public.households'::regclass, 'households has RLS');
select row_security_active('public.planning_items'::regclass, 'planning items has RLS');
select row_security_active('public.google_connections'::regclass, 'OAuth token storage has RLS');

select * from finish();
rollback;
