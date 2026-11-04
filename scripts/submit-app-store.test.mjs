import test from "node:test";
import assert from "node:assert/strict";
import { appleClient, submitPlatform } from "./submit-app-store.mjs";

const appId = "6801189976";
const base = { appId, version: "1.3", build: "174", platform: "IOS", notes: "New things.", releaseType: "AFTER_APPROVAL", log: () => {} };

function apple({ versions = [], submissions = [], buildAttributes = {}, localizations = [{ id: "loc-en", attributes: { locale: "en-US", whatsNew: "Old." } }], attached = null } = {}) {
  const calls = [];
  const routes = {
    [`/v1/preReleaseVersions?filter[app]=${appId}&filter[platform]=IOS&filter[version]=1.3&limit=10`]: { data: [{ id: "train" }] },
    "/v1/preReleaseVersions/train/builds?limit=200": { data: [{ id: "build-174", attributes: { version: "174", processingState: "VALID", expired: false, buildAudienceType: "APP_STORE_ELIGIBLE", ...buildAttributes } }] },
    [`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=200`]: { data: versions },
    "/v1/appStoreVersions/v13/appStoreVersionLocalizations?limit=50": { data: localizations },
    "/v1/appStoreVersions/v13/build": { data: attached },
    [`/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&limit=50`]: { data: submissions },
    "/v1/reviewSubmissions/draft/items?include=appStoreVersion&limit=50": { data: [] },
  };
  const fetcher = async (url, options) => {
    const path = url.replace("https://api.appstoreconnect.apple.com", "");
    calls.push([options.method, path, options.body ? JSON.parse(options.body) : undefined]);
    if (options.method === "GET") {
      assert.ok(routes[path], `Unexpected read ${path}`);
      return { ok: true, status: 200, text: async () => JSON.stringify(routes[path]) };
    }
    const reply = path === "/v1/appStoreVersions" ? { data: { id: "v13", attributes: { versionString: "1.3" } } }
      : path === "/v1/reviewSubmissions" ? { data: { id: "draft", attributes: { state: "READY_FOR_REVIEW" } } }
      : path === "/v1/reviewSubmissions/draft" ? { data: { id: "draft", attributes: { state: "WAITING_FOR_REVIEW" } } } : { data: {} };
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  return { calls, client: (apply) => appleClient({ fetcher, auth: async () => "token", wait: async () => {}, apply, log: () => {} }) };
}
const writes = (calls) => calls.filter(([method]) => method !== "GET").map(([method, path, body]) => [method, path, body?.data?.attributes]);

test("plan mode only reads from Apple", async () => {
  const fake = apple({ versions: [{ id: "v13", attributes: { versionString: "1.3", appVersionState: "PREPARE_FOR_SUBMISSION", releaseType: "MANUAL" } }] });
  await submitPlatform(fake.client(false), base);
  assert.deepEqual(writes(fake.calls), []);
});

test("submit creates the version, sets notes and build, then submits in order", async () => {
  const fake = apple({ versions: [{ id: "v12", attributes: { versionString: "1.2", appVersionState: "READY_FOR_DISTRIBUTION" } }] });
  const result = await submitPlatform(fake.client(true), base);
  assert.equal(result.state, "WAITING_FOR_REVIEW");
  assert.deepEqual(writes(fake.calls), [
    ["POST", "/v1/appStoreVersions", { platform: "IOS", versionString: "1.3", releaseType: "AFTER_APPROVAL" }],
    ["PATCH", "/v1/appStoreVersionLocalizations/loc-en", { whatsNew: "New things." }],
    ["PATCH", "/v1/appStoreVersions/v13/relationships/build", undefined],
    ["POST", "/v1/reviewSubmissions", { platform: "IOS" }],
    ["POST", "/v1/reviewSubmissionItems", undefined],
    ["PATCH", "/v1/reviewSubmissions/draft", { submitted: true }],
  ]);
  assert.deepEqual(fake.calls.find(([, path]) => path.endsWith("/relationships/build"))[2], { data: { type: "builds", id: "build-174" } });
});

test("an existing prepared version is updated, and a draft submission is reused", async () => {
  const fake = apple({
    versions: [{ id: "v13", attributes: { versionString: "1.3", appVersionState: "PREPARE_FOR_SUBMISSION", releaseType: "MANUAL" } }],
    submissions: [{ id: "draft", attributes: { state: "READY_FOR_REVIEW" } }],
    localizations: [{ id: "loc-en", attributes: { locale: "en-US", whatsNew: "New things." } }],
    attached: { id: "build-174" },
  });
  await submitPlatform(fake.client(true), base);
  assert.deepEqual(writes(fake.calls), [
    ["PATCH", "/v1/appStoreVersions/v13", { releaseType: "AFTER_APPROVAL" }],
    ["POST", "/v1/reviewSubmissionItems", undefined],
    ["PATCH", "/v1/reviewSubmissions/draft", { submitted: true }],
  ]);
});

test("refuses builds that are not App Store-eligible, before any change", async () => {
  for (const buildAttributes of [{ buildAudienceType: "INTERNAL_ONLY" }, { processingState: "PROCESSING" }, { expired: true }]) {
    const fake = apple({ buildAttributes });
    await assert.rejects(() => submitPlatform(fake.client(true), base), /cannot go to the App Store/);
    assert.deepEqual(writes(fake.calls), []);
  }
});

test("stops when another version is being prepared or already in review", async () => {
  const preparing = apple({ versions: [{ id: "v12", attributes: { versionString: "1.2", appVersionState: "PREPARE_FOR_SUBMISSION" } }] });
  await assert.rejects(() => submitPlatform(preparing.client(true), base), /1\.2 being prepared/);
  const inReview = apple({ versions: [{ id: "v13", attributes: { versionString: "1.3", appVersionState: "PREPARE_FOR_SUBMISSION", releaseType: "AFTER_APPROVAL" } }], submissions: [{ id: "other", attributes: { state: "IN_REVIEW" } }], localizations: [{ id: "loc-en", attributes: { locale: "en-US", whatsNew: "New things." } }], attached: { id: "build-174" } });
  await assert.rejects(() => submitPlatform(inReview.client(true), base), /IN_REVIEW/);
  for (const fake of [preparing, inReview]) assert.deepEqual(writes(fake.calls), []);
});

test("an already submitted version with the same build is left alone", async () => {
  const fake = apple({ versions: [{ id: "v13", attributes: { versionString: "1.3", appVersionState: "WAITING_FOR_REVIEW" } }], attached: { id: "build-174" } });
  assert.equal((await submitPlatform(fake.client(true), base)).changed, false);
  assert.deepEqual(writes(fake.calls), []);
});

test("Apple validation errors are reported with their details; writes are not retried", async () => {
  let posts = 0;
  const client = appleClient({ apply: true, auth: async () => "t", wait: async () => {}, log: () => {}, fetcher: async (url, options) => {
    if (options.method !== "GET") posts++;
    return { ok: false, status: 409, text: async () => JSON.stringify({ errors: [{ code: "STATE_ERROR.ENTITY_STATE_INVALID", detail: "Age rating answers are required." }] }) };
  } });
  await assert.rejects(() => client.write("PATCH", "/v1/reviewSubmissions/x", {}, "submit"), /Age rating answers are required/);
  assert.equal(posts, 1);
});
