#!/usr/bin/env node
// Sixteen updates published to a runtime version no phone was running.
//
// ── what this cost ────────────────────────────────────────────────────────
//
// On 4 September commit feb454d moved `app.json`'s version from 1.1.0 to
// 1.3.0. `runtimeVersion` is `{"policy": "appVersion"}`, so from that commit
// on, every `eas update` was addressed to runtime 1.3.0. An install only
// accepts an update whose runtime matches its own; there is no fallback and no
// error, the update is simply not offered.
//
// The client's TestFlight external group had exactly one build assigned —
// 1.0.0 (28). Builds 38, 39, 43, 44 and 45 were made, submitted and approved,
// and none of them was ever added to that group. So the only client install in
// existence was runtime 1.0.0, and the sixteen updates published after the
// bump reached zero devices. Every one of them printed an Update group ID and
// exited 0.
//
// What the member reported was not "no updates". It was that features had been
// ROLLED BACK and the exercise catalogue had gone missing — because the app
// they were holding was nine days of work behind, and looked exactly like a
// regression. Nine days were spent looking for a regression that did not
// exist. The cause was found by reading a screenshot of the TestFlight group.
//
// Fifty-three gates were green throughout. scripts/publish.sh published into
// the void sixteen times and reported success sixteen times, because nothing
// in this repo had ever asked the question this file asks: does a build exist
// that could receive what we are about to send?
//
// ── what this gate asserts ────────────────────────────────────────────────
//
// For each channel about to be published to: there is a FINISHED EAS build
// whose app version equals the runtime version this repo would publish under.
// Not a build in progress, not an errored one, and not a simulator build —
// none of those is an install on somebody's phone.
//
// The runtime is read from `app.json`. Under the `appVersion` policy the
// runtime IS the version, which is why the two words are used interchangeably
// below. If that policy is ever changed, or the block removed, this gate stops
// and says so rather than assuming: every sentence it prints depends on that
// equivalence, and a gate that guesses about the address updates are delivered
// to is worse than no gate.
//
// A build reports the channel it listens on (`updateChannel.name`), baked in
// when it was built. `eas.json`'s `build.<profile>.channel` says what a build
// made from that profile TODAY would listen on. Both are accepted, because
// either alone can be stale in a way that fails a channel that is actually
// reachable: the file can have been edited since the build, and older builds
// may not carry the field at all.
//
// ── what this gate CANNOT check, and must not be read as proving ──────────
//
// THIS IS THE WHOLE POINT, so it is also printed on success.
//
// A finished build is not a build anybody can install. Between "FINISHED" in
// EAS and "installed on a tester's phone" there are three more steps, all of
// them in App Store Connect: submitted, approved, and RELEASED TO A TESTER
// GROUP. The incident was entirely the third one. Builds 38 through 45 were
// finished, submitted and approved — and the external group still had only
// 1.0.0 (28) assigned to it, so approval had bought precisely nothing.
//
// Reading that state needs an App Store Connect API key. This repo does not
// have one and this gate does not ask for one. So a green line from this file
// means "a binary at this version exists"; it does not mean, and must never be
// read as meaning, that one human being can install it. That check is a person
// opening TestFlight › the group › Builds and looking. Nothing here replaces
// it.
//
// Which has a blunt consequence, and it is stated here rather than discovered
// later: THIS GATE WOULD NOT HAVE CAUGHT 4 SEPTEMBER ON iOS. The bump landed
// at 05:55 UTC and the first finished iOS build carrying 1.3.0 completed at
// 05:49 — six minutes earlier, because `appVersionSource` is remote and the
// build already held the new version. Builds 44 and 45 finished on the 4th and
// 5th. Every channel would have shown green, correctly, throughout the nine
// days, because a binary really did exist. What did not exist was that binary
// in the tester's group, and that is the part no check in this repo can see.
//
// What this gate does catch is the other two shapes of the same accident: the
// window between a bump and a build, when nothing at the new version has been
// made at all; and a platform where the build never followed. The second is
// not hypothetical — on 7 September 2026, with the iOS answer green,
// `REPPLE_REACH_PLATFORM=android` failed on `preview`, `coach-preview` and
// `owner-preview`, which per scripts/publish.sh are the ONLY installable
// Android artifacts. None has been built since the bump. Every OTA to an
// Android tester since 4 September has gone to a runtime no Android install is
// running, and that one this gate says out loud.
//
// It is also one platform at a time. It reads iOS by default because iOS is
// where the incident happened; `REPPLE_REACH_PLATFORM=android` asks the same
// question of the Android artifacts, and the answer today is not the same one.
//
// And it sees a window — the newest 40 builds. A channel with no finished
// build ANYWHERE in that window is reported and does not fail, because "never
// built for this platform" and "last built more than 40 builds ago" cannot be
// told apart from here, and only one of them is a problem. It is still printed:
// publishing to a channel with no build behind it on this platform reaches
// nobody, which is the same zero as the one that cost nine days.
//
// ── why a network failure is a SKIP and not a FAIL ────────────────────────
//
// This gate is in `check:all`, which runs on a CI worker holding no Expo
// credentials, and in `scripts/publish.sh`, which runs on a laptop that may be
// on a train. If an unauthenticated or offline `eas` failed this gate, the
// first response would be to take it out of `check:all` — and a gate nobody
// runs is not a gate, it is a file. So it skips, loudly, naming the reason,
// and exits 0. A skip is not a pass and does not print the success line.
//
// Usage:  node scripts/check-runtime-reach.mjs [channel ...]
//         defaults to REPPLE_REACH_CHANNELS, then to the six channels
//         scripts/publish.sh publishes to.
//
// The env var exists because this gate runs twice during a publish — once
// inside `npm run check:all`, which cannot be given arguments, and once by
// name — and a narrowed publish must narrow both. `scripts/publish.sh` exports
// it from its own channel list. Without that, publishing to the one channel
// that IS reachable would be refused on account of the five that are not,
// which is precisely the choice that script's "six channels, not three" note
// exists to keep available.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// The six channels scripts/publish.sh sends to when it is not narrowed. Kept
// in step with that list on purpose: this gate answers a question about a
// publish, and the publish is the one that decides where a bundle goes.
const DEFAULT_CHANNELS = [
  'production', 'coach-production', 'owner-production',
  'preview', 'coach-preview', 'owner-preview',
];

const PLATFORM = process.env.REPPLE_REACH_PLATFORM === 'android' ? 'android' : 'ios';
const LIMIT = 40;

const fromArgv = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const fromEnv = (process.env.REPPLE_REACH_CHANNELS ?? '').split(/[\s,]+/).filter(Boolean);
const WANT = fromArgv.length ? fromArgv : fromEnv.length ? fromEnv : DEFAULT_CHANNELS;

const die = (...lines) => {
  console.error(`\ncheck-runtime-reach — ${lines[0]}\n`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
};

const skip = (why) => {
  console.log(`check-runtime-reach — SKIPPED, ${why}`);
  console.log('  Nothing was proved. No build was shown to exist for any channel.');
  process.exit(0);
};

// ── the runtime we would publish under ────────────────────────────────────
const app = JSON.parse(readFileSync('app.json', 'utf8'));
const version = app?.expo?.version;
const rtv = app?.expo?.runtimeVersion;

if (typeof version !== 'string' || !version) {
  die('app.json has no expo.version.',
    'The version is the address every OTA update is delivered to. Without it there',
    'is nothing to compare a build against and no way to know what a publish would',
    'target, so this gate stops rather than assume one.');
}
if (!rtv || typeof rtv !== 'object' || rtv.policy !== 'appVersion') {
  die('app.json\'s runtimeVersion is not { policy: "appVersion" }.',
    `It is: ${JSON.stringify(rtv)}`,
    '',
    'Every sentence this gate prints rests on runtime == expo.version. Under any',
    'other policy — an explicit string, "fingerprint", "nativeVersion" — that is',
    'false, and comparing a build\'s appVersion to app.json\'s version would be',
    'comparing the wrong two things while sounding certain. Teach this gate the',
    'new policy before publishing under it.');
}
const RUNTIME = version;

// ── eas.json: profile → channel ───────────────────────────────────────────
//
// eas.json carries `//` comments, so it is not JSON and JSON.parse chokes on
// it. Stripped as text, respecting strings, because a URL's `//` is not a
// comment and eating one would silently drop a whole profile.
function stripLineComments(text) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

let profileChannel = new Map();
try {
  const eas = JSON.parse(stripLineComments(readFileSync('eas.json', 'utf8')));
  for (const [profile, cfg] of Object.entries(eas?.build ?? {})) {
    if (cfg && typeof cfg.channel === 'string') profileChannel.set(profile, cfg.channel);
  }
} catch (e) {
  die('eas.json could not be read.',
    String(e.message),
    '',
    'It is the map from a build profile to the channel that profile listens on.',
    'Without it this gate cannot say which builds belong to which channel, and a',
    'guess would be an answer about where updates land.');
}
if (profileChannel.size === 0) {
  die('eas.json named no channels at all.',
    'Every build.<profile> either has no `channel` or the file\'s shape has moved.',
    'Either way this gate can no longer map a build to a channel, which is the',
    'only thing it does. That is a failure and not a pass.');
}

// ── the builds ────────────────────────────────────────────────────────────
let builds;
try {
  const out = execFileSync('npx', [
    'eas', 'build:list',
    '--platform', PLATFORM,
    '--limit', String(LIMIT),
    '--json', '--non-interactive',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('[');
  if (start < 0) throw new Error('eas printed no JSON array');
  builds = JSON.parse(out.slice(start));
  if (!Array.isArray(builds)) throw new Error('eas did not return a list of builds');
} catch (e) {
  // Offline, unauthenticated, rate-limited, timed out, or a CLI whose output
  // shape has moved. None of those is evidence about a build, so none of them
  // is a failure here. See the header.
  skip(`\`eas build:list\` could not answer: ${String(e.message).split('\n')[0]}`);
}

// Which channels a build can serve. Both sources, because either can be stale
// on its own — see the header.
const channelsOf = (b) => {
  const set = new Set();
  const baked = b?.updateChannel?.name;
  if (typeof baked === 'string' && baked) set.add(baked);
  const mapped = profileChannel.get(b?.buildProfile);
  if (mapped) set.add(mapped);
  return set;
};

// FINISHED only, and never a simulator build: an .app that runs on a Mac is
// not an install anybody can receive an update on. The `sim-coach` profile
// publishes to coach-production and would otherwise vouch for it.
const usable = builds.filter((b) => b?.status === 'FINISHED' && !b?.isForIosSimulator);

const unreachable = [];
const unknown = [];
const reached = [];

for (const ch of WANT) {
  const onChannel = usable.filter((b) => channelsOf(b).has(ch));
  if (onChannel.length === 0) {
    unknown.push(ch);
    continue;
  }
  const atRuntime = onChannel.filter((b) => b.appVersion === RUNTIME);
  if (atRuntime.length === 0) {
    const versions = [...new Set(onChannel.map((b) => b.appVersion))].join(', ');
    unreachable.push({ ch, versions, count: onChannel.length });
  } else {
    const newest = atRuntime[0];
    reached.push({ ch, build: `${newest.appVersion} (${newest.appBuildVersion})` });
  }
}

if (unreachable.length) {
  console.error(`\ncheck-runtime-reach — ${unreachable.length} channel${unreachable.length === 1 ? '' : 's'} cannot receive runtime ${RUNTIME}:\n`);
  for (const u of unreachable) {
    console.error(`  • ${u.ch} — no finished ${PLATFORM} build at ${RUNTIME}.`);
    console.error(`    Its ${u.count} finished build${u.count === 1 ? ' is' : 's are'} at: ${u.versions}`);
    console.error(`    An install on any of those runtimes will not be offered an update`);
    console.error(`    addressed to ${RUNTIME}. It will not error. It will show nothing at all.\n`);
  }
  console.error('This is the 4 September failure exactly: app.json moved to a version no');
  console.error('binary had been built at, and sixteen updates went to zero devices while');
  console.error('every publish reported success.');
  console.error('');
  console.error('Either build at this version and RELEASE IT TO THE TESTER GROUP, or move');
  console.error('app.json back to a version that has builds behind it. Publishing now sends');
  console.error('a bundle to an address nobody lives at.');
  console.error('');
  process.exit(1);
}

// ── the success line ──────────────────────────────────────────────────────
//
// It says what was proved and, at the same length, what was not. A reader who
// takes "ok" as "the testers have it" is the reader this whole file exists for.
const summary = reached.map((r) => `${r.ch} ${r.build}`).join(', ');
console.log(`check-runtime-reach — ok, runtime ${RUNTIME} has a finished ${PLATFORM} build on ${reached.length}/${WANT.length} channel${WANT.length === 1 ? '' : 's'}: ${summary || 'none'}`);
if (unknown.length) {
  console.log(`  no finished ${PLATFORM} build in the newest ${LIMIT} for: ${unknown.join(', ')}.`);
  console.log('  Not a failure — a build older than the window and a channel never built for');
  console.log(`  this platform look identical from here. But if it is the second, a publish to`);
  console.log(`  ${unknown.length === 1 ? 'it reaches' : 'them reaches'} nobody on ${PLATFORM}.`);
}
console.log('  This proves a BINARY EXISTS. It does not prove anyone can install it:');
console.log('  released-to-a-tester-group lives in App Store Connect and needs an ASC API');
console.log('  key this repo does not have. Submitted and approved is NOT released — that');
console.log('  distinction is the entire nine-day incident. Check the group by eye.');
