#!/usr/bin/env node
// A finished feature that could never run, and an update that could never fix it.
//
// ── what this cost ────────────────────────────────────────────────────────
//
// Google Calendar sync shipped complete. The OAuth flow, the token exchange,
// the busy-span read, the push, the screen, the tests — all of it built,
// reviewed and merged. It has never worked in any build, on any phone, for any
// coach, and it never could have, because
// `EXPO_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID` was never set: not in .env, not in
// any of the fifteen build profiles in eas.json, not in app.json's `extra`, not
// in the EAS environment. There was no value anywhere for the bundler to inline.
//
// What made it expensive was the sentence the app said instead. The row was
// offered on every build with the note "Not available in this version of Repple
// yet" — which tells a coach to wait for an update, and no update was coming,
// because nothing was missing from the build. A coach who took that at face
// value checked for updates, then checked again, then asked support why the
// update had not arrived. The feature was not late; it was unconfigured, and
// the app said the one thing that could not lead anybody to the truth.
//
// ── it had already happened ───────────────────────────────────────────────
//
// src/ui/calendarSync.ts records that this was the SECOND time, and names the
// first in its own header:
//
//   "which is exactly how src/lib/spotify.ts told users the OWNER had not
//    configured a client id that was in .env and in all eight build profiles
//    the whole time."
//
// Spotify's id was set everywhere and still read as undefined, because the read
// was `(process.env as any)?.EXPO_PUBLIC_SPOTIFY_CLIENT_ID`. Expo's Babel
// plugin substitutes the LITERAL member expression `process.env.EXPO_PUBLIC_X`
// and matches that AST shape and no other. A cast, optional chaining, an alias
// or a computed key is left untouched, and reads undefined out of a bundle
// whose `process.env` is an empty object. Testers were sent looking for a
// configuration problem that did not exist.
//
// So there are two ways to ship a variable that is always undefined — not
// supplied, or supplied and not readable — and this project has now paid for
// both. They present identically to the person holding the phone: a working
// feature that says it is not set up.
//
// ── why a gate ────────────────────────────────────────────────────────────
//
// Because neither failure has a symptom anybody sees before release. The code
// compiles. Every test passes: a test runs under Node, where `process.env` is
// real and populated from the shell, so an indirect read works perfectly and a
// missing variable is whatever the developer happens to have in .env. The
// bundle is the only place either fault exists, and nothing was reading the
// bundle's inputs against its reads.
//
// Two rules, one per way of getting it wrong:
//
//   §1  every EXPO_PUBLIC_ variable read by src/ or app/ is supplied somewhere
//       a build would see it — an eas.json profile's `env`, app.json's `extra`,
//       .env or .env.example.
//
//   §2  every read is the literal `process.env.EXPO_PUBLIC_X` member
//       expression. Anything destructured, aliased, cast or computed is
//       flagged, because the plugin cannot see it.
//
// ── the two escapes, and why they are different ───────────────────────────
//
// UNSET, below, is for §1: a variable deliberately not supplied, listed WITH a
// reason. Some of these are not oversights — the value does not exist yet
// (nobody has created the Google client), or it exists and is not ours to hold
// (a Meta app id awaiting App Review). A build with such a variable unset is
// correct as long as the app STOPS OFFERING the feature rather than blaming the
// build, which is what src/ui/adSpend.ts, src/lib/billing.ts and the calendar
// row now do. The list is a ratchet, not an ignore list: an entry that has been
// supplied fails as stale, and so does one nothing reads any more, so it can
// only ever shrink.
//
// `env-indirect-ok:` is for §2, it is a marker in the source next to the read,
// and it means something narrower: this indirect read has a REAL second source.
// src/lib/wearables/oauthConfig.ts is the one place that earns it — one `env(k)`
// helper serves five vendors so the key cannot be a literal, and it falls
// through to `Constants.expoConfig.extra`, which app.config.ts bakes in. That
// fallback is precisely why the WHOOP, Oura and Fitbit ids survived the inlining
// problem that left Spotify's empty. An indirect read WITHOUT one is the bug.
// A marker with no reason after the colon does not count.
//
// ── ONE BLIND SPOT, STATED SO NOBODY TRUSTS THIS GATE FURTHER THAN IT SEES ──
//
// EAS also serves variables from a SERVER-SIDE environment, set in the Expo
// dashboard rather than in this repo. Nothing here can read those, so a variable
// supplied only that way looks unsupplied to this gate.
//
// That is not hypothetical. EXPO_PUBLIC_OCR_API_KEY is read by
// app/(client)/scans.tsx, is in .env, is in NO eas.json profile — and IS
// supplied, from the "production" environment on EAS. The build log says so:
//
//   Environment variables with visibility "Plain text" and "Sensitive" loaded
//   from the "production" environment on EAS: EXPO_PUBLIC_ENABLE_VISION,
//   EXPO_PUBLIC_OCR_API_KEY, EXPO_PUBLIC_OURA_CLIENT_ID, …
//
// So an entry in UNSET means "this repo does not supply it", not "no build has
// it". Before deleting a feature because this gate calls its variable unset,
// read a build log. The gate is a floor, not the whole truth.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];

/**
 * Where the app's code is. The console (studio-web) is a Next.js program with
 * its own inlining rules and its own variables; it is not this gate's.
 *
 * Expanded after a sweep offered the console as a root to add, because "its own
 * inlining rules" was true but too short to act on. Both halves above are
 * Expo-specific in their MECHANISM and neither transfers by widening ROOTS:
 * §1 looks for a value in eas.json's build profiles, app.json's `extra`, .env
 * or .env.example, none of which a Next build reads; §2 is about Expo's Babel
 * plugin matching the literal `process.env.EXPO_PUBLIC_X` member expression,
 * and the prefix the console needs is `NEXT_PUBLIC_`.
 *
 * The §2 ARGUMENT does transfer exactly, and that is worth writing down: Next
 * inlines through webpack's DefinePlugin, which also substitutes a literal
 * member expression and also leaves a destructured, aliased, cast or computed
 * read untouched — so the Spotify defect (`(process.env as any)?.X` reading
 * undefined out of a bundle whose process.env is empty) is reproducible in the
 * console verbatim. The sibling rule is therefore §2 with a different prefix,
 * plus a §1 that reads studio-web's own .env rather than eas.json.
 *
 * It is described and not built because the console reads exactly two variables
 * — NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, both in
 * studio-web/lib/supabase.ts, both already the literal member expression — so
 * there is no §2 offence to find, and §1 over two variables that the console
 * refuses to start without is a rule the first `npm run dev` enforces louder.
 * A third variable is what should trigger writing it.
 */
const ROOTS = ['src', 'app'];
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'build', '.next', '.tmp', '$S']);

/**
 * Variables read by the app and deliberately supplied nowhere, each with the
 * reason. See the header: this is a ratchet. Removing an entry is how a feature
 * gets turned on; adding one is a decision that the app must not offer the
 * feature at all.
 */
const UNSET = new Map([
  ['EXPO_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID',
    'The defect this gate was written for, now held deliberately. The Google Cloud project, consent screen, Calendar API and iOS client all exist (2026-09-04), but the redirect is a custom URL scheme — native config, so a new binary — and the consent screen sits in Testing, capped at 100 users with 7-day tokens, until Google verifies the sensitive scope. app/(trainer)/calendar.tsx now renders the row only when CALENDAR_SYNC_CONFIGURED, so the app says nothing rather than promising an update. Setting this brings the row back with no other change.'],
  ['EXPO_PUBLIC_GOOGLE_CALENDAR_REDIRECT',
    'The other half of the pair above, and optional even then: src/ui/calendarSync.ts derives the redirect from the client id by reversing it, which is what an iOS or Android OAuth client uses. This is only ever set for a Web-type client, whose https redirect cannot be derived from anything.'],
  ['EXPO_PUBLIC_META_ADS_CLIENT_ID',
    'Connecting a Meta ad account needs a Meta app id whose secret is a Supabase secret. src/lib/adChannels.ts names both in the screen\'s own copy and adSpend.ts gates the sign-in on the id being present, so the coach is told what is missing and who has to set it, rather than being handed a button that opens a broken consent page.'],
  ['EXPO_PUBLIC_GOOGLE_ADS_CLIENT_ID',
    'Same shape as the Meta id. Google Ads additionally needs a developer token issued against a manager account and approved before it reads a live account, so this cannot be turned on by setting a variable alone. Gated and explained in src/lib/adChannels.ts.'],
  ['EXPO_PUBLIC_TIKTOK_ADS_APP_ID',
    'Same shape again — TikTok for Business app id, with its secret as a Supabase secret. Gated and explained in src/lib/adChannels.ts.'],
  ['EXPO_PUBLIC_INSTAGRAM_CLIENT_ID',
    'Named in .env.example with an empty value on purpose, and read here as unset. One-tap Instagram posting needs instagram_content_publish through Meta App Review; until that lands the Share Kit still works via the phone\'s share sheet and the screen says "not available" in those words. The empty line in .env.example is the documentation, not a supply.'],
  ['EXPO_PUBLIC_STRIPE_PRICE_STARTER',
    'A Stripe price id for the Starter plan. src/lib/planOffer.ts states outright that no EXPO_PUBLIC_STRIPE_PRICE_* is set in any eas.json profile and that this is the project as it stands: in-app plan purchase is not offered, and src/lib/billing.ts refuses with the name of the missing variable rather than opening a checkout that cannot complete.'],
  ['EXPO_PUBLIC_STRIPE_PRICE_PRO', 'As above — the Pro plan\'s Stripe price id. src/lib/planOffer.ts and app/(trainer)/billing.tsx both document the state.'],
  ['EXPO_PUBLIC_STRIPE_PRICE_STUDIO', 'As above — the Studio plan\'s Stripe price id.'],
]);

/**
 * The source with every comment blanked to spaces, offsets and newlines kept.
 *
 * Not optional here, and not a nicety: this repository argues its decisions in
 * prose, and the prose ABOUT this defect is full of sentences naming
 * `process.env.EXPO_PUBLIC_X` and `(process.env as any)?.X` — src/lib/spotify.ts,
 * src/ui/adSpend.ts, src/ui/instagram.ts and src/ui/calendarSync.ts all quote
 * the broken shape while explaining why they do not use it. A gate that read
 * comments would fail on the four files that have thought hardest about it and
 * pass the ones that have not.
 *
 * Quote state is tracked so the `//` in an https:// URL survives. Blanking
 * rather than deleting keeps every byte offset equal to the original, which is
 * what makes the line numbers below true. Same routine as check-keyboard.mjs.
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => { for (let j = from; j < to; j++) if (out[j] !== '\n') out[j] = ' '; };
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? src.length : end + 2;
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

const files = [];
for (const root of ROOTS) {
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e)) continue;
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) files.push(p);
    }
  })(root);
}

// ── what a build actually supplies ────────────────────────────────────────
//
// Four sources, because a build reads four. eas.json is the real one for a
// binary, app.json's `extra` is the one that survives an indirect read, and the
// two dotfiles are what `expo start` and `expo export` read on a laptop.
//
// A name with an EMPTY value is not a supply and is counted separately. It is
// documentation — `EXPO_PUBLIC_INSTAGRAM_CLIENT_ID=` in .env.example says which
// variable to set, and app.json's empty `EXPO_PUBLIC_FITBIT_CLIENT_ID` says
// which vendor is next. Inlining an empty string produces exactly the phone the
// header describes, so a declaration has to go through UNSET and say why, the
// same as a variable named nowhere at all.
const supply = new Map();      // variable → [where it is named with a value]
const declared = new Map();    // variable → [where it is named, empty]
const note = (name, where, value) => {
  if (!name.startsWith('EXPO_PUBLIC_')) return;
  const target = String(value ?? '').trim() ? supply : declared;
  if (!target.has(name)) target.set(name, []);
  target.get(name).push(where);
};

let easProfiles = 0;
try {
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
  for (const [profile, cfg] of Object.entries(eas.build ?? {})) {
    easProfiles++;
    for (const [k, v] of Object.entries(cfg?.env ?? {})) note(k, `eas.json build.${profile}.env`, v);
  }
} catch { /* reported below */ }

try {
  const app = JSON.parse(readFileSync('app.json', 'utf8'));
  for (const [k, v] of Object.entries(app?.expo?.extra ?? {})) note(k, 'app.json expo.extra', v);
} catch { /* reported below */ }

for (const f of ['.env', '.env.example']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) note(m[1], f, m[2].replace(/^['"]|['"]\s*$/g, ''));
  }
}

// Fail loudly rather than open. If eas.json stopped parsing, every variable in
// the app would read as unsupplied and this gate would print a wall of noise —
// or, worse, somebody would silence it by filling UNSET.
if (!easProfiles) {
  errors.push('no build profiles were read out of eas.json. That file is where a binary\'s variables come from, so without it this gate is measuring reads against almost nothing.');
}

// ── §1: read by the app, supplied by nothing ──────────────────────────────
const reads = new Map();       // variable → ['file:line']
const LITERAL = /process\.env\.(EXPO_PUBLIC_[A-Za-z0-9_]+)/g;

for (const f of files) {
  let raw;
  try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  if (!raw.includes('EXPO_PUBLIC_')) continue;
  const code = stripComments(raw);
  for (let m; (m = LITERAL.exec(code)) !== null; ) {
    const line = code.slice(0, m.index).split('\n').length;
    const name = m[1];
    if (!reads.has(name)) reads.set(name, []);
    reads.get(name).push(`${f}:${line}`);
  }
}

// The same fail-open guard the currency gate carries. There are two dozen of
// these reads; zero means the matcher has gone stale, not that the app stopped
// reading its own configuration.
if (reads.size === 0) {
  errors.push('no process.env.EXPO_PUBLIC_* reads were found in src/ or app/ at all. There are supposed to be around twenty. Either every one has genuinely gone — in which case delete this gate — or its matcher has gone stale and it is passing on nothing.');
}

for (const [name, where] of [...reads].sort()) {
  if (supply.has(name)) {
    if (UNSET.has(name)) {
      errors.push(
        `${name} is listed in UNSET and is in fact supplied by ${supply.get(name).join(', ')}.\n` +
        `      Take it off the list. UNSET is a ratchet: an entry that overstates what is missing is how\n` +
        `      one turns into an ignore list, and the next person reads it as a reason not to look.`);
    }
    continue;
  }
  if (UNSET.has(name)) {
    const reason = String(UNSET.get(name) ?? '').trim();
    if (!reason) {
      errors.push(`${name} is in UNSET with no reason. A marker with no reason does not count — say what is missing and who has to set it, or take the entry out and fix the variable.`);
    }
    continue;
  }
  const empty = declared.get(name);
  errors.push(
    `${name} is read by the app and supplied by nothing.\n` +
    `      read at: ${where.slice(0, 4).join(', ')}${where.length > 4 ? `, +${where.length - 4} more` : ''}\n` +
    (empty
      ? `      Named with an EMPTY value in ${empty.join(', ')}, which is documentation and not a supply —\n` +
        `      an inlined empty string is indistinguishable on a phone from a variable named nowhere.\n`
      : `      Not in any eas.json profile's env, not in app.json's extra, not in .env or .env.example.\n`) +
    `      Expo inlines EXPO_PUBLIC_ variables at build time, so this is the empty string on every\n` +
    `      phone — and the feature behind it is a finished feature that cannot run. That is the Google\n` +
    `      Calendar defect exactly: coaches were told to wait for an update that could never fix it.\n` +
    `      Either supply it in the profiles that need it, or add it to UNSET WITH A REASON and make the\n` +
    `      app stop offering the feature rather than blaming the build.`);
}

for (const name of UNSET.keys()) {
  if (!reads.has(name)) {
    errors.push(
      `${name} is in UNSET and nothing in src/ or app/ reads it any more.\n` +
      `      Delete the entry. A list naming variables the app no longer wants is a list nobody trusts.`);
  }
}

// ── §2: a read the bundler cannot see ─────────────────────────────────────
//
// Every one of these is left untouched by the Babel plugin and reads undefined
// out of a bundle whose process.env is empty. They are matched on the stripped
// source, so the four files that QUOTE the broken shape while explaining it are
// not hits.
const SHAPES = [
  [/process\.env\s*\[/g, 'a computed key — `process.env[…]`'],
  [/process\.env\s*\?\./g, 'optional chaining — `process.env?.X`'],
  [/process\.env\s+as\b/g, 'a cast — `(process.env as any).X`'],
  [/\{[^{}\n]*\}\s*=\s*process\.env\b/g, 'destructuring — `const { EXPO_PUBLIC_X } = process.env`'],
  [/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]*)?=\s*process\.env\s*(?=[;,)\n]|$)/g, 'an alias — `const env = process.env`'],
];

/** A `env-indirect-ok:` with an actual reason after it, within the dozen lines
 *  above the read. Twelve because the one legitimate case in this repo explains
 *  itself at length first, which is the point of the marker. */
function excused(rawLines, line) {
  for (let i = Math.max(0, line - 13); i < line; i++) {
    const m = /env-indirect-ok:(.*)$/.exec(rawLines[i] ?? '');
    if (m && m[1].trim().length > 3) return true;
  }
  return false;
}

for (const f of files) {
  let raw;
  try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  if (!raw.includes('process.env')) continue;
  const code = stripComments(raw);
  const rawLines = raw.split('\n');
  for (const [re, what] of SHAPES) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(code)) !== null; ) {
      const line = code.slice(0, m.index).split('\n').length;
      if (excused(rawLines, line)) continue;
      errors.push(
        `${f}:${line} reads process.env through ${what}.\n` +
        `      Expo's Babel plugin substitutes the literal member expression \`process.env.EXPO_PUBLIC_X\`\n` +
        `      by matching that exact AST shape and nothing else. This one is left alone, and a bundle's\n` +
        `      process.env is an empty object — so it reads undefined however carefully the variable was\n` +
        `      set. That is how src/lib/spotify.ts told users the owner had not configured a client id\n` +
        `      that was in .env and in all eight build profiles the whole time.\n` +
        `      Write it as the literal expression, one constant per variable. If it genuinely cannot be\n` +
        `      literal — one helper over several vendors — it needs a real second source, like the\n` +
        `      Constants.expoConfig.extra fallback in src/lib/wearables/oauthConfig.ts, and an\n` +
        `      \`env-indirect-ok:\` marker above it saying what that source is.`);
    }
  }
}

if (errors.length) {
  console.error(`\ncheck-inlined-env — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  • ${e}\n`);
  console.error('An EXPO_PUBLIC_ variable is inlined at build time, so both ways of getting it wrong —');
  console.error('never supplied, or supplied and read in a shape the bundler cannot see — produce the');
  console.error('same thing on a phone: a finished feature that says it is not set up, and an update');
  console.error('that can never fix it.\n');
  process.exit(1);
}

console.log(`check-inlined-env — ok, ${reads.size} variables read across ${files.length} files; ${reads.size - UNSET.size} supplied, ${UNSET.size} deliberately unset with a reason`);
