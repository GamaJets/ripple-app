#!/usr/bin/env node
// Put the newest build in front of the external testers, and say what it did.
//
// ── Why this is a script and not a checkbox ────────────────────────────────
//
// App Store Connect has exactly the setting this wants: a beta group's
// `hasAccessToAllBuilds`, which Apple's own UI calls automatic distribution.
// Turn it on and every new build joins the group by itself.
//
// It cannot be turned on through the API on a group that already exists.
// PATCH /v1/betaGroups/{id} with that attribute answers:
//
//   409 — An attribute in the provided entity is not allowed for this request:
//         The attribute 'hasAccessToAllBuilds' can not be included in a
//         'UPDATE' operation
//
// It is settable only at CREATE. So the alternatives were: delete the external
// groups and rebuild them with the flag on — which changes the public link
// every existing tester joined through, and drops them — or do the distribution
// ourselves. This is the second one, and it is the better one anyway: a script
// that runs after every submit is a thing that can be read, tested and made to
// fail loudly, where a checkbox somebody ticked once is a thing nobody can see.
//
// scripts/check-testflight.mjs is the gate that ASKS whether the groups can
// receive the runtime. This is the hand that fixes it when they cannot. They
// read the same three environment variables and the same `app.json`.
//
// ── What it will not do ───────────────────────────────────────────────────
//
// It never reports success from the absence of an error. Every add is verified
// by re-reading the group afterwards, because the whole reason this file exists
// is nine days spent believing a build was released when it was not.
//
// It adds only builds at the CURRENT runtime. Back-filling an external group
// with every build ever made would put expired and superseded binaries in front
// of testers, and the question this answers is "can they install what we just
// shipped", not "what have we ever shipped".
//
// Usage:  node scripts/testflight-distribute.mjs [bundleId ...]
//         node scripts/testflight-distribute.mjs --dry-run
//         defaults to the three Repple apps.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com/v1';
const DEFAULT_BUNDLES = [
  'com.washateria.repple',
  'com.washateria.repple.coach',
  'com.washateria.repple.studio',
];

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const BUNDLES = argv.filter((a) => !a.startsWith('--'));
const bundles = BUNDLES.length ? BUNDLES : DEFAULT_BUNDLES;

/* ── credentials ─────────────────────────────────────────────────────────── */

// Unlike the gate, a MISSING key here is a failure rather than a skip. The gate
// is something everybody runs and most people have no key for; this is an act
// somebody asked for by name, and a script asked to distribute a build that
// silently distributes nothing is the exact shape of the incident above.
function creds() {
  const issuer = (process.env.ASC_ISSUER_ID ?? '').trim();
  const keyId = (process.env.ASC_KEY_ID ?? '').trim();
  const path = (process.env.ASC_KEY_PATH ?? '').trim();
  const missing = [!issuer && 'ASC_ISSUER_ID', !keyId && 'ASC_KEY_ID', !path && 'ASC_KEY_PATH'].filter(Boolean);
  if (missing.length) {
    console.error(`testflight:distribute — no App Store Connect key configured (${missing.join(', ')} unset).`);
    console.error('  This script WRITES, so it needs a key with App Manager or Admin access.');
    console.error('  A Developer-role key reads every endpoint here and answers every write with');
    console.error('  "The API key in use does not allow this request" — which is what stranded the');
    console.error('  coach app\'s external testers on 1.0.0.');
    process.exit(1);
  }
  const pem = readFileSync(path, 'utf8');
  if (!/BEGIN PRIVATE KEY/.test(pem)) {
    console.error(`testflight:distribute — ${path} is not a .p8 private key.`);
    process.exit(1);
  }
  return { issuer, keyId, pem };
}

function derToRaw(der) {
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => {
    if (der[i++] !== 0x02) throw new Error('signature is not two DER integers');
    const len = der[i++];
    let v = der.subarray(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    const out = Buffer.alloc(32);
    v.copy(out, 32 - v.length);
    return out;
  };
  return Buffer.concat([read(), read()]);
}

// Signed fresh per call rather than once at the top: this walks several apps and
// several groups, and a token minted at the start of a slow run can expire in
// the middle of it. Ten minutes is Apple's comfortable window, not its limit.
function token({ issuer, keyId, pem }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key: pem, dsaEncoding: 'der' });
  return `${head}.${body}.${derToRaw(sig).toString('base64url')}`;
}

const C = creds();

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token(C)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) {
    const text = await res.text();
    return { ok: true, body: text ? JSON.parse(text) : null };
  }
  let detail = '';
  try {
    const j = await res.json();
    detail = (j.errors ?? []).map((e) => e.detail || e.title).join('; ');
  } catch { /* a non-JSON body from Apple is not worth a second failure */ }
  return { ok: false, status: res.status, detail };
}
const get = (p) => call('GET', p);

/** The runtime this repo publishes to — read exactly as check-testflight.mjs
 *  and check-runtime-reach.mjs read it, so the three cannot disagree about
 *  which builds count. */
function runtime() {
  const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  if (app?.runtimeVersion?.policy !== 'appVersion') {
    console.error(`testflight:distribute — runtimeVersion policy is ${JSON.stringify(app?.runtimeVersion)}, not appVersion.`);
    console.error('  This script picks builds by app version and that is no longer what a runtime is.');
    process.exit(1);
  }
  return String(app.version);
}

const RUNTIME = runtime();
let failures = 0;
let added = 0;

console.log(`testflight:distribute — runtime ${RUNTIME}${DRY ? '  (dry run, nothing will be written)' : ''}`);

for (const bundle of bundles) {
  const apps = await get(`/apps?filter[bundleId]=${encodeURIComponent(bundle)}&fields[apps]=name`);
  if (!apps.ok) {
    console.error(`  ${bundle}: could not be looked up (HTTP ${apps.status}). ${apps.detail}`);
    failures += 1;
    continue;
  }
  const app = apps.body.data?.[0];
  if (!app) {
    console.error(`  ${bundle}: no app in this account has that bundle id.`);
    failures += 1;
    continue;
  }
  const name = app.attributes.name;

  // Every build at this runtime, newest first. `filter[preReleaseVersion.version]`
  // is not a filter Apple offers, so the app version is resolved through the
  // include and matched here.
  const builds = await get(
    `/builds?filter[app]=${app.id}&limit=200&sort=-version&fields[builds]=version,expired,processingState,preReleaseVersion&include=preReleaseVersion&fields[preReleaseVersions]=version`,
  );
  if (!builds.ok) {
    console.error(`  ${name}: could not list builds (HTTP ${builds.status}). ${builds.detail}`);
    failures += 1;
    continue;
  }
  const vers = new Map((builds.body.included ?? []).map((i) => [i.id, i.attributes?.version]));
  const candidates = (builds.body.data ?? [])
    .map((b) => ({
      id: b.id,
      build: Number(b.attributes?.version),
      version: vers.get(b.relationships?.preReleaseVersion?.data?.id) ?? null,
      expired: !!b.attributes?.expired,
      state: b.attributes?.processingState,
    }))
    // VALID only. A build still processing cannot be assigned, and one that
    // failed processing is not a thing to put in front of anybody.
    .filter((b) => b.version === RUNTIME && !b.expired && b.state === 'VALID')
    .sort((a, b) => b.build - a.build);

  const newest = candidates[0];
  if (!newest) {
    // Not a failure. An app with no finished build at this runtime yet is the
    // ordinary state between a version bump and a build finishing.
    console.log(`  ${name}: no finished build at ${RUNTIME} yet — nothing to distribute.`);
    continue;
  }

  const groups = await get(`/apps/${app.id}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds`);
  if (!groups.ok) {
    console.error(`  ${name}: could not read tester groups (HTTP ${groups.status}). ${groups.detail}`);
    failures += 1;
    continue;
  }
  const external = (groups.body.data ?? []).filter((g) => !g.attributes.isInternalGroup);
  if (!external.length) {
    console.log(`  ${name}: no external group — internal testers only, nothing to do.`);
    continue;
  }

  for (const g of external) {
    const gname = g.attributes.name;
    if (g.attributes.hasAccessToAllBuilds === true) {
      console.log(`  ${name} / ${gname}: automatic distribution is on at Apple's end — left alone.`);
      continue;
    }
    const held = await get(`/betaGroups/${g.id}/builds?limit=200&fields[builds]=version`);
    if (!held.ok) {
      // Never treated as "the group is empty" — that reading is the whole
      // incident this file descends from.
      console.error(`  ${name} / ${gname}: could not be read (HTTP ${held.status}). ${held.detail} This is NOT "no builds assigned".`);
      failures += 1;
      continue;
    }
    if ((held.body.data ?? []).some((b) => b.id === newest.id)) {
      console.log(`  ${name} / ${gname}: already holds build ${newest.build} — nothing to do.`);
      continue;
    }
    if (DRY) {
      console.log(`  ${name} / ${gname}: WOULD add build ${newest.build}.`);
      continue;
    }
    const put = await call('POST', `/betaGroups/${g.id}/relationships/builds`, {
      data: [{ type: 'builds', id: newest.id }],
    });
    if (!put.ok) {
      console.error(`  ${name} / ${gname}: could not add build ${newest.build} (HTTP ${put.status}). ${put.detail}`);
      if (put.status === 403) {
        console.error('    403 here is the KEY, not the build: a Developer-role key cannot write.');
      }
      failures += 1;
      continue;
    }
    // Asked again rather than believed. A 204 is Apple saying it accepted the
    // request; this is Apple saying the build is in the group.
    const after = await get(`/betaGroups/${g.id}/builds?limit=200&fields[builds]=version`);
    if (!after.ok || !(after.body.data ?? []).some((b) => b.id === newest.id)) {
      console.error(`  ${name} / ${gname}: the add was accepted but build ${newest.build} is NOT in the group when read back.`);
      failures += 1;
      continue;
    }
    console.log(`  ${name} / ${gname}: added build ${newest.build} and confirmed it is there.`);
    added += 1;
  }
}

console.log('');
if (failures) {
  console.error(`testflight:distribute — ${failures} problem${failures === 1 ? '' : 's'} above. External testers may still be on an older build.`);
  process.exit(1);
}
console.log(`testflight:distribute — ok${added ? `, ${added} build assignment${added === 1 ? '' : 's'} made` : ', nothing needed changing'}.`);
