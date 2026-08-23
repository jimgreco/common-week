import { importPKCS8, SignJWT } from "jose";

const API_BASE = "https://api.appstoreconnect.apple.com";
const bundleId = process.env.IOS_BUNDLE_ID || "com.jimgreco.commonweek";
const mode = process.env.ASC_SYNC_MODE || "audit";
const locale = "en-US";

const appInfoAttributes = {
  name: "Week of Us",
  subtitle: "Plan life together",
  privacyPolicyUrl: "https://weekofus.com/privacy",
  privacyChoicesUrl: "https://weekofus.com/privacy",
};

const versionAttributes = {
  description: [
    "Week of Us is a calm, shared weekly planner for households.",
    "",
    "Plan the week together, keep private items private, and see what matters without juggling group texts or scattered lists. Add plans and tasks directly in the app, invite household members, and choose exactly what everyone can see.",
    "",
    "Google Calendar is optional. If you connect it, each calendar starts hidden and can be kept private or explicitly shared with your household. Calendar editing is a separate opt-in.",
    "",
    "Features include:",
    "• A shared weekly household planner",
    "• Private and shared planning controls",
    "• Invitations and household roles",
    "• Optional Google Calendar connection",
    "• Offline access to recent planner data on iPhone",
    "• Weather context for saved locations",
    "• In-app account deletion and provider disconnection",
  ].join("\n"),
  keywords: "family planner,shared calendar,weekly planner,household,tasks,organization",
  marketingUrl: "https://weekofus.com",
  promotionalText: "A calmer way for households to plan the week, share what matters, and keep personal calendars private.",
  supportUrl: "https://weekofus.com/support",
};

const reviewNotes = [
  "Week of Us is fully usable with Sign in with Apple; Google Calendar is optional.",
  "",
  "Review path:",
  "1. Sign in with Apple.",
  "2. The app creates a household and opens the native planner without requiring Google.",
  "3. Add a planner item from the week view.",
  "4. Optional Google Calendar connection is available in Settings and requests calendar write access only after a separate opt-in.",
  "5. Account deletion is in Settings > Account > Delete Account. A sole-member household is deleted with the account.",
  "",
  "Privacy policy: https://weekofus.com/privacy",
  "Support: https://weekofus.com/support",
].join("\n");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function privateKeyText() {
  const raw = required("APP_STORE_CONNECT_API_KEY").replace(/\\n/g, "\n");
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  if (!decoded.includes("BEGIN PRIVATE KEY")) throw new Error("APP_STORE_CONNECT_API_KEY is not a PEM or base64-encoded PEM key");
  return decoded;
}

async function token() {
  const keyId = required("APP_STORE_CONNECT_KEY_ID");
  const issuer = required("APP_STORE_CONNECT_ISSUER_ID");
  const key = await importPKCS8(privateKeyText(), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}

let authorization;

async function request(path, { method = "GET", body } = {}) {
  authorization ||= await token();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authorization}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const details = payload?.errors?.map((error) => `${error.status} ${error.code}: ${error.detail || error.title}`).join("; ") || text;
    throw new Error(`${method} ${path} failed: ${details}`);
  }
  return payload;
}

function update(type, id, attributes) {
  if (mode !== "apply") {
    console.log(`AUDIT would update ${type}/${id}: ${Object.keys(attributes).join(", ")}`);
    return Promise.resolve();
  }
  return request(`/v1/${type}/${id}`, { method: "PATCH", body: { data: { type, id, attributes } } });
}

async function main() {
  if (!["audit", "apply"].includes(mode)) throw new Error("ASC_SYNC_MODE must be audit or apply");

  const apps = await request(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=2`);
  if (apps.data.length !== 1) throw new Error(`Expected one App Store Connect app for ${bundleId}; found ${apps.data.length}`);
  const app = apps.data[0];
  console.log(`App: ${app.attributes.name} (${app.id}), bundle ${app.attributes.bundleId}, mode ${mode}`);

  const infos = await request(`/v1/apps/${app.id}/appInfos?limit=10`);
  if (!infos.data.length) throw new Error("App Store Connect has no appInfo record for this app");
  const info = infos.data.find((item) => ["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "DEVELOPER_REJECTED", "REJECTED"].includes(item.attributes.appStoreState)) || infos.data[0];
  console.log(`App info: ${info.id}, state ${info.attributes.appStoreState}`);

  const infoLocalizations = await request(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`);
  const infoLocalization = infoLocalizations.data.find((item) => item.attributes.locale === locale);
  if (infoLocalization) {
    await update("appInfoLocalizations", infoLocalization.id, appInfoAttributes);
  } else if (mode === "apply") {
    await request("/v1/appInfoLocalizations", {
      method: "POST",
      body: { data: { type: "appInfoLocalizations", attributes: { locale, ...appInfoAttributes }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } } },
    });
  } else {
    console.log(`AUDIT would create ${locale} app info localization`);
  }

  const versions = await request(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=50`);
  let version = versions.data.find((item) => ["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "DEVELOPER_REJECTED", "REJECTED"].includes(item.attributes.appStoreState));
  if (!version && mode === "apply") {
    const created = await request("/v1/appStoreVersions", {
      method: "POST",
      body: { data: { type: "appStoreVersions", attributes: { platform: "IOS", versionString: "1.0", releaseType: "MANUAL" }, relationships: { app: { data: { type: "apps", id: app.id } } } } },
    });
    version = created.data;
  }
  if (!version) {
    console.log("AUDIT would create editable iOS App Store version 1.0 with manual release");
    return;
  }

  console.log(`Version: ${version.attributes.versionString} (${version.id}), state ${version.attributes.appStoreState}`);
  await update("appStoreVersions", version.id, { copyright: "2026 James Greco", releaseType: "MANUAL", usesIdfa: false });

  const versionLocalizations = await request(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  const versionLocalization = versionLocalizations.data.find((item) => item.attributes.locale === locale);
  if (versionLocalization) {
    await update("appStoreVersionLocalizations", versionLocalization.id, versionAttributes);
  } else if (mode === "apply") {
    await request("/v1/appStoreVersionLocalizations", {
      method: "POST",
      body: { data: { type: "appStoreVersionLocalizations", attributes: { locale, ...versionAttributes }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } },
    });
  } else {
    console.log(`AUDIT would create ${locale} version localization`);
  }

  try {
    const detail = await request(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
    if (detail.data) {
      await update("appStoreReviewDetails", detail.data.id, { demoAccountRequired: false, notes: reviewNotes });
    } else {
      console.log("App Review contact details do not exist yet; leaving them for the account holder because Apple requires a verified phone and email.");
    }
  } catch (error) {
    if (!String(error.message).includes("404")) throw error;
    console.log("App Review contact details do not exist yet; leaving them for the account holder because Apple requires a verified phone and email.");
  }

  console.log(`${mode === "apply" ? "Applied" : "Audited"} App Store Connect metadata successfully.`);
}

await main();
