#!/usr/bin/env node
// The question scripts/check-runtime-reach.mjs prints and cannot answer.
//
// ── what this is for ──────────────────────────────────────────────────────
//
// That gate proves a BINARY EXISTS at the runtime version we are about to
// publish to. It says so, and then says the thing it cannot check:
//
//   "This proves a BINARY EXISTS. It does not prove anyone can install it:
//    released-to-a-tester-group lives in App Store Connect and needs an ASC
//    API key this repo does not have. Submitted and approved is NOT released —
//    that distinction is the entire nine-day incident. Check the group by eye."
//
// The nine-day incident is in that file's header: builds 38, 39, 43, 44 and 45
// were made, submitted and approved, and none was ever ADDED TO THE TESTER
// GROUP. The only install in existence was build 28 at runtime 1.0.0, so
// sixteen updates published after the version bump reached zero devices, every
// one of them printing an Update group ID and exiting 0. The member reported it
// as features being rolled back, because the app in their hand was nine days
// behind. Nine days were spent looking for a regression that did not exist.
//
// "Check the group by eye" is the right instruction when there is no key. It is
// also the instruction that failed sixteen times, because a human checks a
// thing they believe is fine roughly never. This asks Apple directly.
//
// ── what it asserts ───────────────────────────────────────────────────────
//
// For the app whose bundle id it is given: list the TestFlight beta groups, and
// for each one name the builds actually assigned to it and their app versions.
// Then compare against the runtime this repo would publish to — the same
// `app.json` version, read the same way — and say outright whether any group
// holds a build that could receive it.
//
// It never says "released" from the absence of an error. A group with no builds
// and a group we could not read are different answers and are printed
// differently, which is the whole discipline of this codebase applied to the
// one fact nobody could see.
//
// ── credentials, and where they are NOT ────────────────────────────────────
//
// Three values, all from the environment, none of them in this repo:
//
//   ASC_ISSUER_ID   the UUID at the top of App Store Connect → Users and
//                   Access → Integrations → App Store Connect API
//   ASC_KEY_ID      the 10-character id in the key's own row
//   ASC_KEY_PATH    path to the downloaded AuthKey_<KEY_ID>.p8
//
// The .p8 is a private key for the whole team. It is read, used to sign a
// ten-minute JWT, and never printed — and if it is missing this exits 0 with a
// sentence saying so rather than failing, because a repo that cannot be cloned
// and checked without somebody's Apple key is a repo nobody can contribute to.
// An App Manager role is enough; this only reads.
//
// ── THE BUG THIS FILE SHIPPED WITH, found 2 Oct 2026 ──────────────────────
//
// Two mistakes, and together they meant the gate answered for an app nobody
// asked it about and never answered for two of the three at all.
//
//   · `filter[bundleId]` IS A PREFIX MATCH. Asking for `com.washateria.repple`
//     returns the member app, the coach app AND Repple Studio, and the code
//     took `data[0]`. Apple returned Studio first, so every run of this gate
//     read Studio's groups while printing the member app's bundle id beside
//     Studio's name — a line that reads as a cosmetic label and was the only
//     clue on screen.
//
//   · There are THREE apps and the gate checked one. The coach app and the
//     member app — the two with actual testers on them — have never been
//     checked by the thing written to check them.
//
// This file exists because of a nine-day incident in which sixteen updates
// reached zero devices while every run printed a success. It then spent its own
// life reporting on the wrong app. Selecting `data[0]` out of a prefix match is
// the same shape of mistake as reading "no error" as "released".
//
// Usage:  node scripts/check-testflight.mjs [bundleId ...]
//         defaults to ALL THREE variants.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com/v1';

/** The three env values, or null with the reason. Never throws on absence. */
function creds() {
  const issuer = (process.env.ASC_ISSUER_ID ?? '').trim();
  const keyId = (process.env.ASC_KEY_ID ?? '').trim();
  const path = (process.env.ASC_KEY_PATH ?? '').trim();
  const missing = [
    !issuer && 'ASC_ISSUER_ID',
    !keyId && 'ASC_KEY_ID',
    !path && 'ASC_KEY_PATH',
  ].filter(Boolean);
  if (missing.length) return { ok: false, missing };
  let pem;
  try {
    pem = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, unreadable: `${path} could not be read (${e.code ?? 'error'})` };
  }
  if (!/BEGIN PRIVATE KEY/.test(pem)) {
    return { ok: false, unreadable: `${path} is not a .p8 private key` };
  }
  return { ok: true, issuer, keyId, pem };
}

/**
 * A ten-minute ES256 token, signed here.
 *
 * Apple refuses anything over twenty minutes and refuses a token whose `aud`
 * is not exactly this string. Both are written out rather than configurable:
 * a wrong value here produces a 401 that reads like a bad key, which is a
 * long way to travel for a typo.
 */
function token({ issuer, keyId, pem }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64({
    iss: issuer,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    aud: 'appstoreconnect-v1',
  });
  const sig = createSign('SHA256')
    .update(`${head}.${body}`)
    .sign({ key: pem, dsaEncoding: 'der' });
  // Apple wants the raw 64-byte r||s, and Node signs DER. Converted here
  // rather than reached for from a library, because this is the only thing in
  // the file that would need one.
  const raw = derToRaw(sig);
  return `${head}.${body}.${raw.toString('base64url')}`;
}

/** DER (SEQUENCE of two INTEGERs) to the fixed 64 bytes JOSE specifies. */
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

async function get(jwt, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.errors ?? []).map((e) => e.detail || e.title).join('; ');
    } catch { /* a non-JSON body from Apple is not worth a second failure */ }
    return { ok: false, status: res.status, detail };
  }
  return { ok: true, body: await res.json() };
}

/**
 * Every build of this app, by id, with the APP VERSION each one belongs to.
 *
 * Two different numbers are both called "version" here and the distinction is
 * the whole check: `build.attributes.version` is the BUILD NUMBER (45), and the
 * app version it belongs to (1.3.0) lives on its preReleaseVersion. The runtime
 * an install accepts is the app version, so that is what has to be matched.
 *
 * Read from the TOP-LEVEL builds collection with `filter[app]`, and not from
 * either relationship endpoint, because both refuse the one parameter that
 * makes this a single request: `/betaGroups/{id}/builds?include=…` and
 * `/apps/{id}/builds?include=…` both answer 400 "The parameter 'include' can
 * not be used with this request". The first version of this file used the
 * group relationship and reported two perfectly healthy groups as unreadable;
 * the second used the app relationship and failed outright. Established
 * against the live API, not from the documentation.
 */
async function buildIndex(jwt, appId) {
  const res = await get(
    jwt,
    `/builds?filter[app]=${appId}&limit=200&fields[builds]=version,expired,preReleaseVersion&include=preReleaseVersion&fields[preReleaseVersions]=version`,
  );
  if (!res.ok) return res;
  const versions = new Map((res.body.included ?? []).map((i) => [i.id, i.attributes?.version]));
  const byId = new Map();
  for (const b of res.body.data ?? []) {
    byId.set(b.id, {
      build: b.attributes?.version,
      version: versions.get(b.relationships?.preReleaseVersion?.data?.id) ?? null,
      expired: !!b.attributes?.expired,
    });
  }
  // Said rather than silently trusted: 200 is the API's page size and this
  // reads one page. A build older than the newest 200 is unknown to the map,
  // and a group holding only such a build must not be reported as empty.
  return { ok: true, byId, all: [...byId.values()], truncated: (res.body.data ?? []).length >= 200 };
}

/** The runtime this repo would publish to. Same file and same policy check as
 *  check-runtime-reach.mjs — the two must not disagree about what a build has
 *  to match, so both read `app.json` and both refuse an unexpected policy. */
function runtime() {
  const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  const policy = app?.runtimeVersion?.policy;
  if (policy !== 'appVersion') {
    return { ok: false, why: `runtimeVersion policy is ${JSON.stringify(app?.runtimeVersion)}, not appVersion — this check reads the version as the runtime and that is no longer true` };
  }
  return { ok: true, version: String(app.version) };
}

/**
 * Every app this repo builds, because it builds three and an unchecked app is
 * the state this gate exists to make impossible.
 */
const ALL_BUNDLES = [
  'com.washateria.repple',
  'com.washateria.repple.coach',
  'com.washateria.repple.studio',
];
const BUNDLES = process.argv.slice(2).length ? process.argv.slice(2) : ALL_BUNDLES;

const c = creds();
if (!c.ok) {
  // Exit 0. See the header: this is a check that becomes available when
  // somebody supplies a key, not a wall in front of everybody who has not.
  if (c.missing) {
    console.log(`check:testflight — skipped, no App Store Connect key configured (${c.missing.join(', ')} unset).`);
    console.log('  App Store Connect → Users and Access → Integrations → App Store Connect API.');
    console.log('  An App Manager key is enough; this only reads.');
  } else {
    console.log(`check:testflight — skipped, ${c.unreadable}.`);
  }
  process.exit(0);
}

const rt = runtime();
if (!rt.ok) {
  console.error(`check:testflight — ${rt.why}`);
  process.exit(1);
}

const jwt = token(c);

/**
 * One app, start to finish. Returns false when this app cannot receive the
 * runtime, rather than exiting — with three apps to check, the first failure
 * must not hide the other two.
 */
async function checkApp(BUNDLE) {
  const apps = await get(jwt, `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}&fields[apps]=name,bundleId`);
  if (!apps.ok) {
    console.error(`check:testflight — App Store Connect refused the app lookup (HTTP ${apps.status}). ${apps.detail}`);
    console.error('  A 401 here is the key, the key id or the issuer id — not the app.');
    return false;
  }
  /* EXACT, not data[0]. `filter[bundleId]` is a prefix match, so this list
     holds every app whose id STARTS WITH the one asked for — all three of ours
     for the member app's id — and taking the first gave whichever Apple felt
     like returning first. See the header. */
  const matches = apps.body.data ?? [];
  const app = matches.find((a) => a.attributes?.bundleId === BUNDLE);
  if (!app) {
    console.error(`check:testflight — no app in this account has bundle id exactly ${BUNDLE}.`);
    if (matches.length) {
      console.error(`  The prefix match returned ${matches.length}: ${matches.map((a) => a.attributes?.bundleId).join(', ')}. None is an exact match.`);
    }
    return false;
  }

  const groups = await get(jwt, `/apps/${app.id}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,publicLinkEnabled`);
  if (!groups.ok) {
    console.error(`check:testflight — could not read the tester groups (HTTP ${groups.status}). ${groups.detail}`);
    return false;
  }

  const index = await buildIndex(jwt, app.id);
  if (!index.ok) {
    console.error(`check:testflight — could not list this app's builds (HTTP ${index.status}). ${index.detail}`);
    return false;
  }

  let reachable = 0;
  /**
   * External groups that hold no build at this runtime.
   *
   * Tracked separately from `reachable`, because the first run of this gate found
   * why that distinction matters. "Team (Expo)" is the internal group — Expo's
   * own, holding every build ever made — so an app whose EXTERNAL testers are two
   * versions behind still has one group that can receive an update, and a check
   * that passes on "any group" reports that app as fine.
   *
   * That is the nine-day incident exactly: the external group had build 28 while
   * internal had everything. So an external group behind the runtime is a
   * failure of its own, and scripts/deploy-functions.sh states the doctrine this
   * follows — "a warning that scrolls past a success line is a warning nobody
   * reads. Here it is a failure."
   */
  const staleExternal = [];
  /** What each external group holds at this runtime, for the binary-gap note. */
  const externalBuilds = [];
  const lines = [];
  for (const g of groups.body.data ?? []) {
    const builds = await get(jwt, `/betaGroups/${g.id}/builds?limit=200&fields[builds]=version`);
    if (!builds.ok) {
      // Named WITH APPLE'S OWN REASON, not swallowed, and never counted as empty.
      // A group we could not read is the one state that must not be reported as a
      // group with nothing in it — that reading is what the nine days were spent
      // on. The first version of this file printed the status and dropped the
      // detail, and the detail was the entire diagnosis: a rejected parameter,
      // which read on screen as two unreadable groups.
      lines.push(`  ${g.attributes.name}: could not be read (HTTP ${builds.status}). ${builds.detail} This is NOT "no builds assigned".`);
      continue;
    }
    const rows = (builds.body.data ?? []).map((b) => {
      const known = index.byId.get(b.id);
      return {
        build: b.attributes?.version ?? known?.build,
        // Null, not '?', when the build is outside the page read above. It is
        // printed as "version not read" and never counted as a match.
        version: known?.version ?? null,
        expired: known?.expired ?? false,
      };
    });
    const live = rows.filter((r) => !r.expired);
    const matching = live.filter((r) => r.version === rt.version);
    if (matching.length) reachable += 1;
    const kind = g.attributes.isInternalGroup ? 'internal' : 'external';
    if (!g.attributes.isInternalGroup) {
      externalBuilds.push({ name: g.attributes.name, builds: matching.map((r) => r.build) });
    }
    if (!g.attributes.isInternalGroup && !matching.length) {
      staleExternal.push({
        name: g.attributes.name,
        has: live.map((r) => `${r.version ?? '?'} (${r.build})`).join(', ') || 'nothing',
      });
    }
    if (!rows.length) {
      lines.push(`  ${g.attributes.name} (${kind}): NO BUILDS ASSIGNED — nobody in this group can install anything.`);
    } else {
      const shown = live.length
        ? live.map((r) => `${r.version ?? 'version not read'} (${r.build})`).join(', ')
        : 'all expired';
      lines.push(`  ${g.attributes.name} (${kind}): ${shown}${matching.length ? '  ← can receive this runtime' : '  ← CANNOT receive runtime ' + rt.version}`);
    }
  }

  console.log(`check:testflight — ${app.attributes.name} (${app.attributes.bundleId}), publishing to runtime ${rt.version}`);
  for (const l of lines) console.log(l);

  if (!lines.length) {
    console.error('  This app has no TestFlight groups at all, so no update can reach anybody through TestFlight.');
    return false;
  }
  if (reachable === 0) {
    console.error('');
    console.error(`  NO group holds a live build at ${rt.version}. An update published to this app`);
    console.error('  reaches nobody, and it will still print an Update group ID and exit 0.');
    console.error('  Add the build to the group in App Store Connect before publishing.');
    return false;
  }
  /* ── a group on the right RUNTIME but an old BINARY ───────────────────
     Distinct from `staleExternal`, and the distinction is the point. This gate
     asks whether an OTA update can reach a group, so it compares the app
     VERSION — and an external group holding 1.3.0 (20) can indeed receive an
     OTA published to 1.3.0, which is why it passes and should.

     What it cannot receive is a NATIVE change. On 2 Oct 2026 the coach app's
     external group held build 20 while build 36 had just been submitted:
     sixteen builds of native work — a voice-note recorder among them — that
     the group's testers could not install, with every line above reading "can
     receive this runtime" because the version matched.

     So it is reported, loudly, and it is NOT a failure: blocking an OTA
     publish over this would be wrong, since the OTA genuinely does reach them.
     It is the native round that needs the action. */
  const newestAtRuntime = Math.max(0, ...index.all
    .filter((r) => r.version === rt.version && !r.expired)
    .map((r) => Number(r.build) || 0));
  for (const g of externalBuilds) {
    const theirs = Math.max(0, ...g.builds.map((b) => Number(b) || 0));
    if (newestAtRuntime && theirs && theirs < newestAtRuntime) {
      console.log('');
      console.log(`  NOTE — external group "${g.name}" holds build ${theirs}; build ${newestAtRuntime} is the newest at ${rt.version}.`);
      console.log(`  An OTA to ${rt.version} does reach them, so this is not a failure. A NATIVE change in`);
      console.log(`  builds ${theirs + 1}-${newestAtRuntime} cannot: they have to install the binary.`);
      console.log('  Fix it with:  npm run testflight:distribute');
    }
  }

  if (staleExternal.length) {
    // The escape is an environment variable rather than a flag, named so that
    // typing it is an act. It prints what it is allowing, because a suppressed
    // check that says nothing is the thing this file replaced.
    const allowed = (process.env.REPPLE_TESTFLIGHT_STALE_EXTERNAL_OK ?? '').trim() === '1';
    const say = allowed ? console.log : console.error;
    say('');
    for (const g of staleExternal) {
      say(`  EXTERNAL group "${g.name}" holds ${g.has} — not ${rt.version}.`);
    }
    say('  Everybody outside your own team who tests this app is on that build, and an');
    say(`  update published to runtime ${rt.version} will not be offered to any of them.`);
    say('  Fix it with:  npm run testflight:distribute');
    say('  which adds the newest finished build at this runtime to every external group');
    say('  and reads each one back to prove it landed. It needs an App Manager or Admin');
    say('  key — a Developer-role one answers every write with "does not allow this');
    say('  request". By hand it is App Store Connect → TestFlight → that group → add the');
    say('  build, which needs no new review if the build is already approved.');
    if (!allowed) {
      console.error('  Set REPPLE_TESTFLIGHT_STALE_EXTERNAL_OK=1 to publish anyway, knowingly.');
      return false;
    }
    console.log('  Allowed by REPPLE_TESTFLIGHT_STALE_EXTERNAL_OK=1.');
  }
  console.log(`  ${reachable} group${reachable === 1 ? '' : 's'} can receive runtime ${rt.version}.`);
  return true;
}

let allOk = true;
for (const b of BUNDLES) {
  if (!(await checkApp(b))) allOk = false;
  console.log('');
}
if (!allOk) {
  console.error(`check:testflight — one or more of ${BUNDLES.length} apps cannot receive runtime ${rt.version}. See above.`);
  process.exit(1);
}
// Only when there is something to summarise. scripts/publish.sh calls this
// once per bundle with the id as an argument, so a summary line here printed
// "all 1 apps" three times in a row down the middle of a publish.
if (BUNDLES.length > 1) {
  console.log(`check:testflight — all ${BUNDLES.length} apps have a group that can receive runtime ${rt.version}.`);
}
