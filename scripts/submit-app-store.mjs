#!/usr/bin/env node
// Submit an already-uploaded, App Store-eligible build for App Store review.
// ASC_SUBMIT_MODE=plan (default) only reads and prints every change it would make.
// ASC_SUBMIT_MODE=submit performs those changes. Writes are never retried.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { importPKCS8, SignJWT } from "jose";

const API_BASE = "https://api.appstoreconnect.apple.com";
const policy = JSON.parse(readFileSync(new URL("../.github/scripts/release-policy.json", import.meta.url)));
// Apple's appVersionState values in which a version's build, notes and release type can still change.
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const SUBMITTED = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "PENDING_APPLE_RELEASE", "PROCESSING_FOR_DISTRIBUTION", "READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);
const PLATFORM_LABEL = { IOS: "iPhone", MAC_OS: "Mac" };

const check = (ok, message) => { if (!ok) throw new Error(message); };
const state = (version) => version?.attributes?.appVersionState ?? version?.attributes?.appStoreState;

function required(name) {
  const value = process.env[name]?.trim();
  check(value, `Missing ${name}`);
  return value;
}

async function token() {
  let key = required("APP_STORE_CONNECT_API_KEY").replace(/\\n/g, "\n");
  if (!key.includes("BEGIN PRIVATE KEY")) key = Buffer.from(key, "base64").toString("utf8");
  check(key.includes("BEGIN PRIVATE KEY"), "APP_STORE_CONNECT_API_KEY is not a PEM or base64-encoded PEM key");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: required("APP_STORE_CONNECT_KEY_ID"), typ: "JWT" })
    .setIssuer(required("APP_STORE_CONNECT_ISSUER_ID")).setAudience("appstoreconnect-v1")
    .setIssuedAt().setExpirationTime("15m").sign(await importPKCS8(key, "ES256"));
}

export function appleClient({ fetcher = fetch, auth = token, wait = (ms) => new Promise((r) => setTimeout(r, ms)), apply = false, log = console.log } = {}) {
  let authorization;
  async function send(method, path, body) {
    authorization ||= await auth();
    for (let attempt = 1; ; attempt++) {
      let response;
      try {
        response = await fetcher(`${API_BASE}${path}`, { method, redirect: "error", headers: { Authorization: `Bearer ${authorization}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      } catch {
        if (method === "GET" && attempt < 5) { await wait(2000 * 2 ** (attempt - 1)); continue; }
        throw new Error(`${method} ${path} could not reach Apple${method === "GET" ? "" : "; the change may or may not have applied, so run plan before retrying"}.`);
      }
      if (method === "GET" && (response.status === 429 || response.status >= 500) && attempt < 5) { await wait(2000 * 2 ** (attempt - 1)); continue; }
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        // Apple's error codes and details are public validation messages (for example missing age-rating answers).
        const details = payload?.errors?.map((e) => `${e.code}: ${e.detail || e.title}`).join("; ") || `HTTP ${response.status}`;
        throw new Error(`${method} ${path} was rejected: ${details}`);
      }
      return payload;
    }
  }
  return {
    get: (path) => send("GET", path),
    async write(method, path, body, description) {
      if (!apply) { log(`PLAN would ${description}`); return null; }
      log(`${description}…`);
      return send(method, path, body);
    },
  };
}

export async function eligibleBuild(client, { appId, version, build, platform }) {
  const trains = (await client.get(`/v1/preReleaseVersions?filter[app]=${appId}&filter[platform]=${platform}&filter[version]=${encodeURIComponent(version)}&limit=10`)).data;
  check(trains.length === 1, `${PLATFORM_LABEL[platform]} has no TestFlight version ${version}.`);
  const builds = (await client.get(`/v1/preReleaseVersions/${trains[0].id}/builds?limit=200`)).data.filter((b) => b.attributes?.version === String(build));
  check(builds.length === 1, `${PLATFORM_LABEL[platform]} build ${build} of ${version} was not found in App Store Connect.`);
  const a = builds[0].attributes;
  check(a.processingState === "VALID" && a.expired === false && a.buildAudienceType === "APP_STORE_ELIGIBLE",
    `${PLATFORM_LABEL[platform]} build ${build} cannot go to the App Store: ${JSON.stringify({ processingState: a.processingState, expired: a.expired, buildAudienceType: a.buildAudienceType })}.`);
  return builds[0];
}

export async function submitPlatform(client, { appId, version, build, platform, notes, releaseType, log = console.log }) {
  const label = PLATFORM_LABEL[platform];
  check(label, "Unknown platform.");
  check(notes.trim().length > 0 && notes.length <= 4000, "Release notes must be 1–4000 characters.");
  const target = await eligibleBuild(client, { appId, version, build, platform });
  log(`${label}: build ${build} is processed and App Store-eligible.`);

  const versions = (await client.get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=200`)).data;
  let current = versions.find((v) => v.attributes?.versionString === version);
  const otherEditable = versions.find((v) => v !== current && EDITABLE.has(state(v)));
  check(!otherEditable, `${label} already has version ${otherEditable?.attributes?.versionString} being prepared (${state(otherEditable)}); finish or remove it in App Store Connect first.`);

  if (current && SUBMITTED.has(state(current))) {
    const attached = (await client.get(`/v1/appStoreVersions/${current.id}/build`)).data;
    check(attached?.id === target.id, `${label} ${version} is already ${state(current)} with a different build; it cannot be changed now.`);
    log(`${label}: ${version} with build ${build} is already ${state(current)}. Nothing to do.`);
    return { platform, state: state(current), changed: false };
  }
  check(!current || EDITABLE.has(state(current)), `${label} ${version} is ${state(current)}, which cannot be submitted.`);

  if (!current) {
    const created = await client.write("POST", "/v1/appStoreVersions", { data: { type: "appStoreVersions", attributes: { platform, versionString: version, releaseType }, relationships: { app: { data: { type: "apps", id: appId } } } } },
      `create ${label} App Store version ${version} (release ${releaseType})`);
    if (!created) {
      log(`PLAN would then set ${label} release notes, attach build ${build}, and submit ${version} for review.`);
      return { platform, state: "PLANNED", changed: true };
    }
    current = created.data;
  } else if (current.attributes?.releaseType !== releaseType) {
    await client.write("PATCH", `/v1/appStoreVersions/${current.id}`, { data: { type: "appStoreVersions", id: current.id, attributes: { releaseType } } },
      `set ${label} ${version} to release ${releaseType}`);
  }

  const localizations = (await client.get(`/v1/appStoreVersions/${current.id}/appStoreVersionLocalizations?limit=50`)).data;
  check(localizations.length > 0, `${label} ${version} has no store localizations to hold release notes.`);
  for (const localization of localizations) {
    if (localization.attributes?.whatsNew === notes) continue;
    await client.write("PATCH", `/v1/appStoreVersionLocalizations/${localization.id}`, { data: { type: "appStoreVersionLocalizations", id: localization.id, attributes: { whatsNew: notes } } },
      `set ${label} ${localization.attributes?.locale} release notes`);
  }

  const attached = (await client.get(`/v1/appStoreVersions/${current.id}/build`)).data;
  if (attached?.id !== target.id) {
    await client.write("PATCH", `/v1/appStoreVersions/${current.id}/relationships/build`, { data: { type: "builds", id: target.id } },
      `attach build ${build} to ${label} ${version}`);
  }

  // Reuse an unsubmitted draft for this platform; never touch a submission already with Apple.
  const submissions = (await client.get(`/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${platform}&limit=50`)).data;
  const active = submissions.find((s) => ["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES", "CANCELING"].includes(s.attributes?.state));
  check(!active, `${label} already has a review submission that is ${active?.attributes?.state}; resolve it in App Store Connect first.`);
  let draft = submissions.find((s) => s.attributes?.state === "READY_FOR_REVIEW");
  if (!draft) {
    const created = await client.write("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform }, relationships: { app: { data: { type: "apps", id: appId } } } } },
      `open a ${label} review submission`);
    draft = created?.data ?? { id: "(new)" };
  }
  const items = draft.id === "(new)" ? [] : (await client.get(`/v1/reviewSubmissions/${draft.id}/items?include=appStoreVersion&limit=50`)).data;
  if (!items.some((item) => item.relationships?.appStoreVersion?.data?.id === current.id)) {
    await client.write("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: draft.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: current.id } } } } },
      `add ${label} ${version} to the review submission`);
  }
  const submitted = await client.write("PATCH", `/v1/reviewSubmissions/${draft.id}`, { data: { type: "reviewSubmissions", id: draft.id, attributes: { submitted: true } } },
    `submit ${label} ${version} build ${build} for App Store review`);
  const result = submitted?.data?.attributes?.state ?? "PLANNED";
  log(`${label}: ${submitted ? `submitted; review submission is ${result}.` : "plan complete; nothing was changed."}`);
  return { platform, state: result, changed: true };
}

async function main() {
  const mode = process.env.ASC_SUBMIT_MODE?.trim() || "plan";
  check(["plan", "submit"].includes(mode), "ASC_SUBMIT_MODE must be plan or submit.");
  const build = required("BUILD_NUMBER");
  check(/^[1-9][0-9]*$/.test(build), "BUILD_NUMBER must be a positive build number.");
  const version = process.env.APP_VERSION?.trim() || policy.marketingVersion;
  const releaseType = process.env.RELEASE_TYPE?.trim() || "AFTER_APPROVAL";
  check(["AFTER_APPROVAL", "MANUAL"].includes(releaseType), "RELEASE_TYPE must be AFTER_APPROVAL or MANUAL.");
  const platforms = (process.env.PLATFORMS?.trim() || "IOS,MAC_OS").split(",").map((p) => p.trim()).filter(Boolean);
  check(platforms.length && platforms.every((p) => PLATFORM_LABEL[p]), "PLATFORMS must list IOS and/or MAC_OS.");
  const notes = readFileSync(new URL(`../app-store/release-notes/${version}.txt`, import.meta.url), "utf8").trim();
  const client = appleClient({ apply: mode === "submit" });
  console.log(`${mode === "submit" ? "Submitting" : "Planning"} Week of Us ${version} build ${build} for ${platforms.map((p) => PLATFORM_LABEL[p]).join(" and ")}; release ${releaseType}.`);
  // Validate every platform before changing any, so one bad build never leaves a half-submitted release.
  for (const platform of platforms) await eligibleBuild(client, { appId: policy.appId, version, build, platform });
  for (const platform of platforms) await submitPlatform(client, { appId: policy.appId, version, build, platform, notes, releaseType });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
