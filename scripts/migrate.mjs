import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const ssl = process.env.PGSSL === "true"
  ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
  : false;
const client = new Client({ connectionString, ssl, application_name: "common-week-migrations" });
const migrationsDirectory = path.join(process.cwd(), "db", "migrations");

await client.connect();
try {
  await client.query(`
    create table if not exists app_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const entries = (await fs.readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of entries) {
    const existing = await client.query("select 1 from app_schema_migrations where name = $1", [name]);
    if (existing.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationsDirectory, name), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into app_schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
