#!/usr/bin/env node
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing --${name}`);
  return process.argv[index + 1];
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function token() {
  const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const keyPath = process.env.APP_STORE_CONNECT_API_KEY_PATH;
  if (!keyId || !issuerId || !keyPath) throw new Error('App Store Connect API credentials are required.');
  const now = Math.floor(Date.now() / 1000);
  const input = `${base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))}.${base64url(JSON.stringify({
    iss: issuerId, aud: 'appstoreconnect-v1', iat: now, exp: now + 1200,
  }))}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: createPrivateKey(readFileSync(keyPath, 'utf8')),
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${base64url(signature)}`;
}

async function request(authToken, method, path, body) {
  if (method !== 'GET') throw new Error('Release signing inspection is read-only; request approval for Apple Developer changes separately.');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const detail = payload?.errors?.map((error) => error.detail ?? error.title).join('\n');
    throw new Error(`${method} ${path} failed (${response.status}): ${detail || text}`);
  }
  return payload;
}

async function pages(authToken, path) {
  const values = [];
  let next = path;
  while (next) {
    const response = await request(authToken, 'GET', next);
    values.push(...(response.data ?? []));
    const nextURL = response.links?.next;
    next = nextURL ? `${new URL(nextURL).pathname}${new URL(nextURL).search}` : '';
  }
  return values;
}

async function ensureBundle(authToken, identifier) {
  const found = await request(authToken, 'GET', `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&filter[platform]=IOS&limit=200`);
  const exact = found.data?.find((bundle) => bundle.attributes?.identifier === identifier);
  if (!exact) throw new Error(`Bundle ID ${identifier} does not exist in Apple Developer.`);
  return exact;
}

async function ensureAppleSignIn(authToken, bundleId) {
  const capabilities = await pages(authToken, `/bundleIds/${bundleId}/bundleIdCapabilities?fields[bundleIdCapabilities]=capabilityType`);
  const existing = capabilities.find((value) => value.attributes?.capabilityType === 'APPLE_ID_AUTH');
  if (existing) return;
  throw new Error('Sign in with Apple capability is missing; obtain approval before changing Apple Developer settings.');
}

async function ensurePushNotifications(authToken, bundleId) {
  const capabilities = await pages(authToken, `/bundleIds/${bundleId}/bundleIdCapabilities?fields[bundleIdCapabilities]=capabilityType`);
  if (capabilities.some((value) => value.attributes?.capabilityType === 'PUSH_NOTIFICATIONS')) return;
  throw new Error('Push Notifications capability is missing; obtain approval before changing Apple Developer settings.');
}

async function matchingCertificate(authToken, certificatePath) {
  const localHash = createHash('sha256').update(readFileSync(certificatePath)).digest('hex');
  const certificates = await pages(authToken, '/certificates?fields[certificates]=certificateType,displayName,certificateContent,activated,expirationDate&limit=200');
  const match = certificates.find((certificate) => {
    const type = certificate.attributes?.certificateType;
    const content = certificate.attributes?.certificateContent;
    return ['DISTRIBUTION', 'IOS_DISTRIBUTION'].includes(type)
      && certificate.attributes?.activated !== false
      && content
      && createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex') === localHash;
  });
  if (!match) throw new Error('The imported distribution certificate was not found in App Store Connect.');
  return match;
}

async function main() {
  const authToken = token();
  const bundleIdentifier = argument('bundle-id');
  const profileName = argument('profile-name');
  const profileType = argument('profile-type');
  const certificatePath = argument('certificate-der');
  const output = argument('output');
  const supportedProfileTypes = new Set(['IOS_APP_STORE', 'MAC_CATALYST_APP_STORE']);
  if (!supportedProfileTypes.has(profileType)) {
    throw new Error(`Unsupported App Store profile type ${profileType}.`);
  }
  const bundle = await ensureBundle(authToken, bundleIdentifier);
  if (!process.argv.includes('--widget')) {
    await ensureAppleSignIn(authToken, bundle.id);
    await ensurePushNotifications(authToken, bundle.id);
  }
  await matchingCertificate(authToken, certificatePath);
  const existingProfiles = await pages(
    authToken,
    `/profiles?filter[name]=${encodeURIComponent(profileName)}&fields[profiles]=name,uuid,profileType,profileState,profileContent&limit=200`,
  );
  const existingProfile = existingProfiles.find((profile) => profile.attributes?.name === profileName);
  if (existingProfile?.attributes?.profileContent) {
    if (existingProfile.attributes.profileType !== profileType) {
      throw new Error(`${profileName} is ${existingProfile.attributes.profileType}, not ${profileType}.`);
    }
    if (existingProfile.attributes.profileState !== 'ACTIVE') {
      throw new Error(`${profileName} is not active; create a new profile name before releasing.`);
    }
    writeFileSync(output, Buffer.from(existingProfile.attributes.profileContent, 'base64'));
    console.log(`Downloaded existing ${profileName} (${profileType}) for ${bundleIdentifier}.`);
    return;
  }
  throw new Error(`${profileName} (${profileType}) is missing; obtain approval to create the provisioning profile separately.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
