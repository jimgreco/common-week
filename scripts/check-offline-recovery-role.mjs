// Run inside the existing app container so credentials never leave its environment.
// Prints catalog metadata only; never reads user rows, environment values or passwords.
import pg from "pg";
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: "offline-recovery-role-readonly-check",
  connectionTimeoutMillis: 5000,
  options: "-c default_transaction_read_only=on -c statement_timeout=5000",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } : false,
});
try {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error(), { code: "MISSING_DATABASE_URL" });
  await client.connect();
  const role = await client.query(`select current_user as runtime_role, session_user as login_role,
    current_database() as database_name, current_setting('role') as effective_role_setting,
    current_setting('transaction_read_only') as transaction_read_only,
    r.rolsuper as superuser, r.rolbypassrls as bypass_rls, r.rolinherit as inherits_roles,
    pg_get_userbyid(d.datdba) as database_owner,
    has_schema_privilege(current_user,'public','CREATE') as can_create_in_public
    from pg_roles r join pg_database d on d.datname=current_database() where r.rolname=current_user`);
  const tables = await client.query(`select c.relname as table_name, pg_get_userbyid(c.relowner) as owner,
    c.relowner=(select oid from pg_roles where rolname=current_user) as directly_owned,
    pg_has_role(current_user,c.relowner,'USAGE') as has_owner_privileges,
    c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
    row_security_active(c.oid) as runtime_rls_active,
    has_table_privilege(current_user,c.oid,'SELECT') as can_select,
    has_table_privilege(current_user,c.oid,'INSERT') as can_insert,
    (select count(*)::integer from pg_policy p where p.polrelid=c.oid) as policy_count
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('users','households','household_members','auth_sessions','planning_items','app_schema_migrations','offline_draft_recoveries')
    order by c.relname`);
  const runtime = role.rows[0];
  const receipts = tables.rows.find((table) => table.table_name === "offline_draft_recoveries");
  const compatible = Boolean(runtime && !runtime.superuser && !runtime.bypass_rls
    && runtime.runtime_role === runtime.login_role && runtime.effective_role_setting === "none"
    && receipts?.directly_owned && receipts.rls_enabled && !receipts.force_rls
    && !receipts.runtime_rls_active && receipts.can_select && receipts.can_insert && receipts.policy_count === 0);
  const requiredTables = ["users", "households", "household_members", "auth_sessions", "planning_items", "app_schema_migrations"];
  const migrationCompatible = Boolean(runtime && !runtime.superuser && !runtime.bypass_rls
    && runtime.runtime_role === runtime.login_role && runtime.effective_role_setting === "none"
    && runtime.database_owner === runtime.runtime_role && runtime.can_create_in_public
    && requiredTables.every((name) => tables.rows.some((table) => table.table_name === name && table.directly_owned && !table.runtime_rls_active))
    && (!receipts || compatible));
  console.log(JSON.stringify({ role: runtime, tables: tables.rows, recovery_role_compatible: compatible,
    recovery_migration_role_compatible: migrationCompatible }, null, 2));
  if ((process.argv.includes("--require-compatible") && !compatible)
    || (process.argv.includes("--before-migration") && !migrationCompatible)) {
    throw Object.assign(new Error(), { code: "INCOMPATIBLE_RECOVERY_ROLE" });
  }
} catch (error) {
  console.error(JSON.stringify({ error: "Read-only role inspection failed", code: typeof error?.code === "string" ? error.code : "UNKNOWN" }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
