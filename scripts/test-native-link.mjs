import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const databaseURL = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
const baseURL = new URL(process.env.NATIVE_LINK_TEST_BASE_URL || "http://invalid");
const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (!local(databaseURL) || !/test|audit/.test(databaseURL.pathname) || !local(baseURL)) {
  throw new Error("Native-link tests require explicit local test/audit DATABASE_URL and NATIVE_LINK_TEST_BASE_URL.");
}
const client = new pg.Client({ connectionString: databaseURL.toString(), application_name: "native-link-isolation-test" });
const users = [];
const hash = (value) => createHash("sha256").update(value).digest();
const secret = () => randomBytes(32).toString("base64url");
const pending = (subject) => ({
  subject, accessTokenEncrypted: "synthetic-encrypted-access", refreshTokenEncrypted: "synthetic-encrypted-refresh",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: "openid email calendar.events",
});
await client.connect();
try {
  async function account() {
    const id = randomUUID();
    users.push(id);
    await client.query("insert into users(id,email,display_name) values($1,$2,'Synthetic linking test')", [id, `${id}@example.invalid`]);
    const token = secret();
    await client.query("insert into auth_sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [hash(token), id]);
    return { id, token };
  }
  async function code(user, connection = null, expired = false) {
    const value = secret(), state = secret();
    await client.query("insert into native_auth_codes(code_hash,client_state_hash,user_id,expires_at,pending_google_connection) values($1,$2,$3,$4,$5::jsonb)",
      [hash(value), hash(state), user.id, new Date(Date.now() + (expired ? -60_000 : 300_000)), connection ? JSON.stringify(connection) : null]);
    return { code: value, state };
  }
  async function exchange(input, token) {
    const response = await fetch(new URL("/api/ios/auth/exchange", baseURL), {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    });
    return { status: response.status, body: await response.json() };
  }
  const original = await account(), other = await account();
  const subject = `synthetic-google-${randomUUID()}`;
  const proposal = await code(original, pending(subject));
  assert.equal((await exchange(proposal)).status, 400, "browser completion alone cannot finalize a link");
  assert.equal((await exchange(proposal, other.token)).status, 400, "a different app account cannot finalize");
  assert.equal((await exchange({ ...proposal, state: secret() }, original.token)).status, 400, "the matching account must also possess the completion state");
  assert.equal((await exchange(proposal, secret())).status, 400, "an invalid or revoked bearer cannot finalize");
  assert.equal((await client.query("select 1 from google_connections where user_id=$1", [original.id])).rowCount, 0, "rejected completion stores no provider connection");
  assert.equal((await client.query("select 1 from native_auth_codes where code_hash=$1", [hash(proposal.code)])).rowCount, 1, "rejected completion preserves code for its owner");
  const completed = await exchange(proposal, original.token);
  assert.equal(completed.status, 200, "original authenticated app can finalize");
  assert.equal(completed.body.ok, true);
  assert.equal((await client.query("select user_id from user_identities where provider='google' and provider_subject=$1", [subject])).rows[0].user_id, original.id);
  assert.equal((await exchange(proposal, original.token)).status, 400, "a lost-response retry cannot reuse a consumed completion code");
  assert.equal((await exchange(await code(original, pending(subject), true), original.token)).status, 400, "expired proposals cannot finalize");
  const normal = await code(other);
  assert.equal((await exchange(normal)).status, 200, "ordinary native sign-in remains compatible without a bearer");

  const first = await account(), second = await account();
  const racedSubject = `synthetic-race-${randomUUID()}`;
  const proposals = await Promise.all([code(first, pending(racedSubject)), code(second, pending(racedSubject))]);
  const outcomes = await Promise.all([exchange(proposals[0], first.token), exchange(proposals[1], second.token)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [200, 400], "concurrent accounts cannot both claim one provider identity");
  assert.equal((await client.query("select 1 from google_connections where user_id=any($1::uuid[])", [[first.id, second.id]])).rowCount, 1, "only the winning account receives provider credentials");
  assert.equal((await client.query("select 1 from user_identities where provider='google' and provider_subject=$1", [racedSubject])).rowCount, 1);

  const sameAccount = await account();
  const singleCode = await code(sameAccount, pending(`synthetic-single-use-${randomUUID()}`));
  const attempts = await Promise.all([exchange(singleCode, sameAccount.token), exchange(singleCode, sameAccount.token)]);
  assert.deepEqual(attempts.map((outcome) => outcome.status).sort(), [200, 400], "concurrent exchange of one code succeeds only once");
  process.stdout.write("Native Google link proof, ownership, expiry, replay, compatibility and concurrency passed.\n");
} finally {
  await client.query("delete from users where id=any($1::uuid[])", [users]);
  await client.end();
}
