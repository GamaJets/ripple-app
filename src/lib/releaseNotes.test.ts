// What a returning reader is told they missed — and, much more often, the
// decision to tell them nothing at all. Compile with tsc, run with node.
//
// The failure this guards is not a wrong changelog. It is a screen that appears
// when it has no business appearing: over somebody who has just made an
// account and missed nothing, over somebody who is already up to date, or over
// a coach being read a list of client features. Each of those is a small
// betrayal of the reader's attention, and each one is a rule below with both
// sides of it pinned down.
//
// The awkward cases are the point. The happy path — "you skipped a release,
// here it is" — is three lines of this file. The rest is the refusals.
import {
  CURRENT_RELEASE, RELEASES, compareVersions, isVersion, releasesFor,
  storeNotes, unseenReleases,
  type Audience, type Release,
  firstRunReleases,
} from './releaseNotes';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL: Audience[] = ['client', 'trainer', 'owner'];

// A made-up history, so the rules are tested against something that cannot
// change under them every time a real release is written.
const FIXTURE: Release[] = [
  {
    version: '2.3.0', date: '2026-09-04',
    entries: [{ kind: 'new', apps: ['owner'], title: 'Owner three', note: 'x' }],
  },
  {
    version: '2.2.0', date: '2026-09-03',
    entries: [{ kind: 'new', apps: ['client'], title: 'Client two', note: 'x' }],
  },
  {
    version: '2.1.0', date: '2026-09-02',
    entries: [
      { kind: 'new', apps: ['client'], title: 'Client one', note: 'x' },
      { kind: 'fixed', apps: ['trainer'], title: 'Trainer one', note: 'x' },
    ],
  },
  {
    version: '2.0.0', date: '2026-09-01',
    entries: [{ kind: 'new', apps: ALL, title: 'Everybody', note: 'x' }],
  },
];

const versionsFor = (seen: string | null, current: string, aud: Audience) =>
  unseenReleases(seen, current, aud, FIXTURE).map((r) => r.version).join(',');

/* ── a brand-new account is told nothing ───────────────────────────────────
 *
 * The single most common way a feature like this becomes an annoyance: the
 * first thing a new account ever sees is a list of things that used to be
 * broken, about an app they have never used. They missed none of it.
 */

eq(versionsFor(null, '2.3.0', 'client'), '', 'a brand-new account, with nothing stored, is shown nothing');
eq(versionsFor('', '2.3.0', 'client'), '', 'and an empty stored value is the same brand-new account');

/* ── somebody up to date is told nothing ───────────────────────────────── */

eq(versionsFor('2.3.0', '2.3.0', 'owner'), '', 'an owner already on this release has nothing to catch up on');
eq(unseenReleases('2.3.0', '2.3.0', 'owner', FIXTURE).length, 0, 'and the screen therefore has nothing to render');

// A reader on a build OLDER than the newest note they have already been shown
// — a rolled-back build, an update that failed to apply — is not shown that
// note twice.
eq(versionsFor('2.3.0', '2.1.0', 'client'), '', 'a reader ahead of their own build is not told the same news again');

/* ── skipping several shows all of them ────────────────────────────────── */

eq(versionsFor('2.0.0', '2.3.0', 'client'), '2.2.0,2.1.0',
  'a client who skipped three releases is shown every release that had something for them, newest first');
eq(versionsFor('2.0.0', '2.3.0', 'owner'), '2.3.0', 'the same gap shows an owner only the one that was theirs');
eq(versionsFor('2.0.0', '2.3.0', 'trainer'), '2.1.0', 'and a coach only theirs');
eq(versionsFor('2.2.0', '2.3.0', 'client'), '',
  'a client one release behind, where that release was owner-only, is shown nothing rather than an empty sheet');

/* ── a release with nothing for this app is skipped, not shown empty ───── */

const ownerRun = unseenReleases('2.0.0', '2.3.0', 'owner', FIXTURE);
eq(ownerRun.length, 1, 'the two client releases and the trainer one are gone entirely for an owner');
ok(ownerRun.every((r) => r.entries.length > 0), 'no release survives with an empty list of entries under it');
for (const aud of ALL) {
  for (const r of unseenReleases('2.0.0', '2.3.0', aud, FIXTURE)) {
    for (const e of r.entries) {
      ok(e.apps.includes(aud), `${aud} is not read a note belonging to another app ("${e.title}")`);
    }
  }
}

// The same rule from releasesFor, which is what the "show me everything" route
// in Settings uses.
ok(releasesFor('owner', FIXTURE).every((r) => r.entries.length > 0), 'the full history is filtered the same way');
eq(releasesFor('owner', FIXTURE).length, 2, 'an owner has two releases in the whole fixture history');

/* ── an unknown or corrupt stored value neither crashes nor spams ──────── */

// compareVersions reads anything it cannot parse as zero. Left alone, that
// turns one bad byte on disk into "you have seen nothing since the beginning",
// and the reader is handed every note ever written. Refusing to place the value
// is the quiet failure, and it is the right one: a value we cannot read is not
// evidence that somebody is behind.
for (const junk of ['corrupt', '{"v":1}', 'undefined', 'null', 'v2.1.0', '   ', '💥', 'NaN']) {
  eq(versionsFor(junk, '2.3.0', 'client'), '', `a stored value of ${JSON.stringify(junk)} shows nothing rather than everything`);
  eq(isVersion(junk), false, `${JSON.stringify(junk)} is not accepted as a version`);
}
ok(isVersion('2.3.0') && isVersion('1.1') && isVersion('10'), 'ordinary versions are accepted');
eq(isVersion(null), false, 'and nothing at all is not a version');
eq(isVersion(2.3 as unknown), false, 'nor is a number that merely looks like one');

// A current version we cannot place is the same refusal from the other side.
eq(versionsFor('2.0.0', 'unreleased', 'client'), '', 'an unreadable current version shows nothing rather than guessing');
eq(versionsFor('2.0.0', '', 'client'), '', 'and so does an empty one');

/* ── notes for a build the reader does not have are not shown ──────────── */

// Notes are written and committed before the build carrying them goes out, so
// the list routinely runs ahead of what is installed.
eq(versionsFor('2.0.0', '2.2.0', 'owner'), '', '2.3.0 is not announced to somebody running 2.2.0');
eq(versionsFor('2.0.0', '2.1.0', 'client'), '2.1.0', 'only as far as the build they are actually running');

/* ── the ordering the comparison rests on ──────────────────────────────── */

ok(compareVersions('2.10.0', '2.9.0') > 0, 'versions compare as numbers, not as strings');
ok(compareVersions('1.2.0', '1.1.0') > 0, 'a newer minor is newer');
eq(compareVersions('1.1', '1.1.0'), 0, 'a missing segment counts as zero');
eq(compareVersions('1.1.0', '1.1.0'), 0, 'a version equals itself');

/* ── the real list ─────────────────────────────────────────────────────── */

eq(CURRENT_RELEASE, RELEASES[0].version, 'the build is the newest release it carries — not what app.json says');
ok(RELEASES.every((r, i) => i === 0 || compareVersions(RELEASES[i - 1].version, r.version) > 0),
  'the list is newest first, which is the order every reader of it assumes');
eq(new Set(RELEASES.map((r) => r.version)).size, RELEASES.length, 'no version is listed twice');

for (const r of RELEASES) {
  for (const e of r.entries) {
    ok(e.title.length > 0 && e.title.length <= 80, `"${e.title}" is one scannable line`);
    ok(!e.title.endsWith('.'), `"${e.title}" has no trailing full stop — it is a heading, not a sentence`);
    ok(e.apps.length > 0, `"${e.title}" names at least one app`);
    ok(e.apps.every((a) => ALL.includes(a)), `"${e.title}" names only apps that exist`);
    // The house voice: say what the reader can do, not what we changed inside.
    //
    // The list grew when the release that added a database-written activity
    // feed and a redemption row was being described: every one of those words
    // was the obvious way to write the sentence, and none of them is something
    // a coach or an owner can do anything with.
    ok(!/\bRLS\b|supabase|postgrest|policy|constraint|webhook|trigger|\bRPC\b|column|migration|row.level|\bindex\b|\btable\b|endpoint/i.test(`${e.title} ${e.note ?? ''}`),
      `"${e.title}" names a mechanism the reader cannot act on`);
    ok(!/exciting|amazing|revolutionary|delighted|!/i.test(`${e.title} ${e.note ?? ''}`),
      `"${e.title}" is written at a volume the rest of the app does not use`);
  }
  // A headline is the only line most people read, so it must not promise a
  // reader something the app they are holding does not have.
  for (const [aud, line] of Object.entries(r.headlines ?? {})) {
    ok(releasesFor(aud as Audience, [r]).length > 0,
      `${r.version}: ${aud} has a headline but no entries — the sheet would never open to read it`);
    ok(line.trim().length > 0, `${r.version}: ${aud}'s headline is not blank`);
  }
}

// This release, and that it reached the three apps differently.
const latest = RELEASES[0];
eq(latest.version, '1.2.0', 'the newest release listed is the one that shipped today');
for (const aud of ALL) {
  ok(releasesFor(aud, [latest]).length === 1, `${aud} got something out of the newest release`);
}
const titlesFor = (aud: Audience) => releasesFor(aud, [latest]).flatMap((r) => r.entries.map((e) => e.title));
ok(titlesFor('client').some((t) => /injury/i.test(t)), 'a client is told they can disclose an injury');
ok(titlesFor('trainer').some((t) => /injur/i.test(t)), 'and a coach that it reaches them before they write the plan');
ok(!titlesFor('owner').some((t) => /injur/i.test(t)), 'a gym owner is not read either — there is no client of theirs to disclose one');
ok(titlesFor('trainer').some((t) => /renews every month/i.test(t)), 'a coach is told they can sell a subscription');
ok(!titlesFor('client').some((t) => /renews every month/i.test(t)), 'a client is not — selling one is not theirs to do');
ok(titlesFor('client').some((t) => /release of liability/i.test(t)), 'a client is told about the release they will be asked to sign');
ok(!titlesFor('owner').some((t) => /release of liability/i.test(t)), 'an owner does not sign it and is not told about it');
ok(titlesFor('owner').some((t) => /dash/i.test(t)), 'the owner console’s unread figures are the owner’s news');

// The gym's own activity feed is the owner's screen. A coach has no Ops tab and
// a client is not shown a log of who joined the gym.
ok(titlesFor('owner').some((t) => /activity/i.test(t)), 'an owner is told their Ops feed now has something in it');
ok(!titlesFor('trainer').some((t) => /activity/i.test(t)), 'a coach has no Ops tab and is not told about its feed');
ok(!titlesFor('client').some((t) => /activity/i.test(t)), 'nor is a member, who cannot see who else joined');

// A promo code has two halves in two different apps, and each app is told only
// its own: the member spends one, the owner counts them. Neither is the coach's.
ok(titlesFor('client').some((t) => /redeem/i.test(t)), 'a member is told they can redeem a code from their gym');
ok(!titlesFor('owner').some((t) => /redeem/i.test(t)), 'an owner does not redeem their own codes');
ok(titlesFor('owner').some((t) => /promo codes/i.test(t)), 'an owner is told the codes persist and are counted');
for (const t of titlesFor('trainer')) {
  ok(!/redeem|promo code/i.test(t), `a coach runs no gym promotions and is not told about them ("${t}")`);
}

// One release, one sentence per change. Two entries with the same title is the
// shape a stale note takes when a second person describes what already landed.
for (const r of RELEASES) {
  const seen = new Set<string>();
  for (const e of r.entries) {
    ok(!seen.has(e.title), `${r.version}: "${e.title}" is listed twice`);
    seen.add(e.title);
  }
}

// The same source feeds App Store Connect, and its field has a limit.
for (const aud of ALL) {
  const text = storeNotes(aud, latest.version);
  ok(text.length > 0, `${aud}: the newest release produces store text`);
  ok(text.length <= 4000, `${aud}: store text fits App Store Connect's 4000-character field`);
}

// ── the first run after the feature shipped ────────────────────────────────
//
// The whole point. `unseenReleases(null, …)` is empty, and null is what every
// account has the first time this code runs, so without this the release that
// INTRODUCED the changelog is the one release nobody is ever shown.
{
  const REL = [
    { version: '2.0.0', date: '2026-08-31', entries: [{ kind: 'new', apps: ['client'], title: 'A thing' }] },
    { version: '1.0.0', date: '2026-01-01', entries: [{ kind: 'new', apps: ['client'], title: 'An older thing' }] },
  ] as unknown as Parameters<typeof firstRunReleases>[3];

  // Somebody who has had an account since January was here for the change.
  eq(firstRunReleases('2026-01-15T09:00:00Z', '2.0.0', 'client', REL).length, 1,
    'an existing account is shown the release that introduced the sheet');

  // Only the current one — not everything back to the day they joined.
  eq(firstRunReleases('2025-06-01T09:00:00Z', '2.0.0', 'client', REL)[0].version, '2.0.0',
    'and only the current release, not the whole history');

  // Somebody who signed up after it shipped learns nothing from being told.
  eq(firstRunReleases('2026-09-02T09:00:00Z', '2.0.0', 'client', REL).length, 0,
    'an account created after the release is not shown it');
  eq(firstRunReleases('2026-08-31T00:00:00Z', '2.0.0', 'client', REL).length, 0,
    'nor one created the day it shipped');

  // An age we do not know is not evidence somebody is owed a changelog.
  eq(firstRunReleases(null, '2.0.0', 'client', REL).length, 0, 'unknown account age shows nothing');
  eq(firstRunReleases(undefined, '2.0.0', 'client', REL).length, 0, 'undefined account age shows nothing');
  eq(firstRunReleases('not a date', '2.0.0', 'client', REL).length, 0, 'an unparseable date shows nothing');

  // A release with nothing for this reader's app is not an empty sheet.
  eq(firstRunReleases('2026-01-15T09:00:00Z', '2.0.0', 'owner', REL).length, 0,
    'a release with no entries for this app is not shown');

  // A current version that is not in the list cannot be shown.
  eq(firstRunReleases('2026-01-15T09:00:00Z', '3.0.0', 'client', REL).length, 0,
    'a version the list does not carry shows nothing');
  eq(firstRunReleases('2026-01-15T09:00:00Z', 'nonsense', 'client', REL).length, 0,
    'an unparseable current version shows nothing');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`releaseNotes: ok (${RELEASES.length} releases, current ${CURRENT_RELEASE})`);
