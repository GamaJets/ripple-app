// The rules about "which gym is this" — and the one about a figure that covers
// two places.
//
// Two claims are being defended here and they pull in opposite directions.
//
//   1. A SINGLE-SITE OWNER CANNOT TELL ANY OF THIS EXISTS. Every copy function
//      returns null for a settled read of one gym, so nothing new renders. That
//      is asserted first and asserted hardest, because supabase/parts/290 is
//      applied to a live database with real gyms on it and "additive" is a
//      claim somebody has to be able to check.
//
//   2. NOTHING MAY CLAIM A SCOPE IT DID NOT ESTABLISH. A failed read of the
//      site list is not "one gym"; a truncated read of a class window is not
//      "one branch". Both come back as unknown, and unknown refuses.
//
// The block at the bottom is a mutation check: it asserts that the obvious
// wrong simplifications — treating an unknown count as 1, treating 'partial'
// as 'ready', letting unlabelled rows sit quietly beside a labelled one —
// actually fail here, so they cannot be reintroduced as tidying.
import {
  sitesFrom, siteCount, currentSite, showsSitePicker, siteRailLine, siteNotice,
  branchSpan, mayPresentAsOneSite, branchNote, SITES_UNREAD_NOTE,
  type SiteScope, type BranchSpan,
} from './ownedSites';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const one = sitesFrom([{ id: A, name: 'Ruoni Fitness', current: true }], 'ready');
const two = sitesFrom(
  [{ id: A, name: 'Ruoni Fitness', current: true }, { id: B, name: 'Ruoni North', current: false }],
  'ready',
);
const three = sitesFrom(
  [
    { id: B, name: 'Ruoni North', current: false },
    { id: A, name: 'Ruoni Fitness', current: true },
    { id: C, name: 'Ruoni Marina', current: false },
  ],
  'ready',
);

// ── 1 · the single-site owner, who must see nothing new ─────────────────────
eq(siteCount(one), 1, 'one gym is one gym');
eq(showsSitePicker(one), false, 'a single-site owner is offered no picker');
eq(siteRailLine(one), null, 'and no extra line in the rail');
eq(siteNotice(one), null, 'and no paragraph over their figures');
eq(currentSite(one)?.id, A, 'the one gym is the one being shown');

// An account with no gym at all. The Overview already says "not linked to a
// gym"; this must not add a second sentence about it.
const none = sitesFrom([], 'ready');
eq(siteCount(none), 0, 'no gyms is a settled zero');
eq(siteRailLine(none), null, 'nothing in the rail for an unlinked account');
eq(siteNotice(none), null, 'and no paragraph either — the page already says it');
eq(showsSitePicker(none), false, 'no picker over no gyms');
eq(currentSite(none), null, 'and no current site');

// While it is in flight nothing is said at all, in either direction.
const loading = sitesFrom(null, 'loading');
eq(siteCount(loading), null, 'a count is not known while the read is in flight');
eq(siteRailLine(loading), null, 'nothing in the rail while loading');
eq(siteNotice(loading), null, 'and no notice while loading');
eq(showsSitePicker(loading), false, 'no picker while loading');

// ── 2 · a failed read is not a single-site owner ────────────────────────────
//
// The whole house rule, on the one read where getting it wrong tells somebody
// their business is smaller than it is.
const failed = sitesFrom(null, 'error');
eq(failed.sites.length, 0, 'a failed read holds no sites');
eq(siteCount(failed), null, 'and an empty list under error is UNKNOWN, not zero');
eq(showsSitePicker(failed), false, 'a picker is not built out of a failed read');
eq(siteRailLine(failed), null, 'the rail says nothing rather than guessing');
eq(siteNotice(failed), SITES_UNREAD_NOTE, 'but the page says the count is not known');
// It may say the FIGURES are one gym's — that is true and is the point. What it
// may not do is tell somebody how many gyms they own, which is the one thing the
// failed read established nothing about.
ok(!/owns? (one|1|two|2|no)\b/i.test(SITES_UNREAD_NOTE), 'the unread note must not assert a number of gyms owned');
ok(/not known/i.test(SITES_UNREAD_NOTE), 'and it must say the count is unknown in words');

// A read that came back truncated is unknown too. `my_sites()` returns a single
// jsonb value and cannot truncate, so this is defence against a future caller
// that folds this into a paginated read and keeps the status.
const partial = sitesFrom([{ id: A, name: 'Ruoni Fitness', current: true }], 'partial');
eq(siteCount(partial), null, 'a truncated site list has no count');
eq(currentSite(partial), null, 'and names no current site');
eq(siteNotice(partial), SITES_UNREAD_NOTE, 'a truncated read is unknown, like a failed one');

// ── 3 · the two-site owner, who must be told which one they are looking at ──
eq(siteCount(two), 2, 'two gyms is two gyms');
eq(showsSitePicker(two), true, 'and a choice of site is worth offering');
eq(siteRailLine(two), '1 of 2 sites', 'the rail says which of how many');
eq(siteRailLine(three), '1 of 3 sites', 'and counts them all');

const noteTwo = siteNotice(two);
ok(!!noteTwo && noteTwo.includes('Ruoni Fitness'), 'the notice names the gym being shown');
ok(!!noteTwo && noteTwo.includes('2 gyms'), 'and says how many there are');
ok(!!noteTwo && /own sign-in/.test(noteTwo), 'and that the other one needs its own sign-in');
ok(!!noteTwo && /no figure on this page includes them/i.test(noteTwo),
  'and states outright that the figures beside it exclude the other site');
ok(!!noteTwo && /The other one has/.test(noteTwo), 'one other gym is "the other one", not "the other 1"');
const noteThree = siteNotice(three);
ok(!!noteThree && /The other 2 have/.test(noteThree), 'two others are counted and take a plural verb');

// A gym nobody has named. The name must not become the SUBJECT of the sentence
// — a missing subject reads as a broken screen, which is what
// scripts/check-prose.mjs is written against.
const unnamed = sitesFrom(
  [{ id: A, name: null, current: true }, { id: B, name: 'Ruoni North', current: false }],
  'ready',
);
const noteUnnamed = siteNotice(unnamed);
ok(!!noteUnnamed && noteUnnamed.startsWith('Showing one of the 2 gyms'),
  'an unnamed gym is described rather than named');
ok(!!noteUnnamed && !noteUnnamed.includes('undefined') && !noteUnnamed.includes('null'),
  'and no placeholder leaks into the copy');

// Recorded against gyms, signed in to none of them. Should not happen — it
// needs an owner_sites row against a profile whose role is not owner — but a
// state the data can be in is a state that gets a branch.
const adrift = sitesFrom(
  [{ id: A, name: 'Ruoni Fitness', current: false }, { id: B, name: 'Ruoni North', current: false }],
  'ready',
);
eq(currentSite(adrift), null, 'nothing is marked readable, so nothing is being shown');
const noteAdrift = siteNotice(adrift);
ok(!!noteAdrift && /not signed in to any of them/.test(noteAdrift),
  'and the notice says so rather than naming a gym it is not showing');
ok(!!noteAdrift && !/no figure on this page includes them/.test(noteAdrift),
  'and does not promise the figures exclude the others when it cannot say which one they are');

// ── 4 · parsing what jsonb actually hands over ──────────────────────────────
eq(sitesFrom([{ name: 'Nameless', current: true }], 'ready').sites.length, 0,
  'an entry with no id names no gym and is dropped');
eq(sitesFrom([{ id: '   ', name: 'Blank', current: true }], 'ready').sites.length, 0,
  'nor does a blank one');
eq(sitesFrom([{ id: ` ${A} `, name: '  Ruoni  ', current: true }], 'ready').sites[0].name, 'Ruoni',
  'padding is not part of a name');
eq(sitesFrom([{ id: ` ${A} `, name: '  Ruoni  ', current: true }], 'ready').sites[0].id, A,
  'nor part of an id');
eq(sitesFrom([{ id: A, name: '   ', current: true }], 'ready').sites[0].name, null,
  'a whitespace name is no name');
// `current: "false"` is a string, and a string is truthy. This is the flag that
// decides which gym the console claims to be showing.
eq(sitesFrom([{ id: A, name: 'X', current: 'false' }], 'ready').sites[0].current, false,
  'only a real boolean true marks the readable site');
eq(sitesFrom([{ id: A, name: 'X', current: 1 }], 'ready').sites[0].current, false,
  'and a number does not either');
eq(sitesFrom('not an array', 'ready').sites.length, 0, 'a shape nobody wrote yields no sites');
eq(sitesFrom(undefined, 'ready').sites.length, 0, 'and neither does nothing at all');
eq(sitesFrom([null, undefined, 7, { id: A, name: 'X', current: true }], 'ready').sites.length, 1,
  'junk entries are skipped rather than throwing');

// A duplicate id keeps the readable copy whichever order it arrived in.
eq(sitesFrom([{ id: A, name: 'X', current: false }, { id: A, name: 'X', current: true }], 'ready').sites[0].current,
  true, 'a duplicated gym keeps the readable flag');
eq(sitesFrom([{ id: A, name: 'X', current: true }, { id: A, name: 'X', current: false }], 'ready').sites[0].current,
  true, 'in either order');
eq(sitesFrom([{ id: A, name: 'X', current: true }, { id: A, name: 'X', current: false }], 'ready').sites.length,
  1, 'and is counted once');

// Readable first, then by name, then by id — a total order, so two gyms with
// the same name cannot swap places between two reads of the same data.
eq(three.sites[0].id, A, 'the readable gym sorts first');
eq(three.sites[1].name, 'Ruoni Marina', 'then the rest by name');
eq(three.sites[2].name, 'Ruoni North', 'alphabetically');
const sameName = sitesFrom(
  [{ id: B, name: 'Ruoni', current: false }, { id: A, name: 'Ruoni', current: false }],
  'ready',
);
eq(sameName.sites[0].id, A, 'two gyms with one name are ordered by id, not by luck');

// ── 5 · a figure that covers more than one place ────────────────────────────
//
// Production today: studio-web writes `branch: ''` on every class it creates,
// so every gym in the live database is this case and every figure is one
// place's.
const blank = [{ branch: '' }, { branch: null }, {}];
eq(branchSpan(blank, 'ready').kind, 'none', 'no class carries a place, so nothing is blended');
eq(mayPresentAsOneSite(branchSpan(blank, 'ready')), true, 'and the figure is the gym’s');
eq(branchNote(branchSpan(blank, 'ready')), null, 'and nothing is said about it');
eq(branchSpan([], 'ready').kind, 'none', 'an empty window blends nothing');
eq(mayPresentAsOneSite(branchSpan([], 'ready')), true, 'and may be reported as the gym’s');

// One place, named. Still the gym's own figure.
const single = [{ branch: 'Al Quoz' }, { branch: ' Al Quoz ' }];
eq(branchSpan(single, 'ready').kind, 'one', 'one label across every class is one place');
eq((branchSpan(single, 'ready') as { branch: string }).branch, 'Al Quoz', 'and it is named');
eq(mayPresentAsOneSite(branchSpan(single, 'ready')), true, 'so the figure is that place’s');
eq(branchNote(branchSpan(single, 'ready')), null, 'and needs no qualification');

// Two places. THE DEFECT: `summariseClassRows` returns one fill rate over this
// set and /classes prints it under one gym's name.
const mixed = branchSpan([{ branch: 'DIFC' }, { branch: 'Al Quoz' }], 'ready');
eq(mixed.kind, 'mixed', 'two labels are two places');
eq(mayPresentAsOneSite(mixed), false, 'and a total over them is not one place’s figure');
const mixedNote = branchNote(mixed);
ok(!!mixedNote && mixedNote.includes('Al Quoz') && mixedNote.includes('DIFC'),
  'the note names the places it covers');
ok(!!mixedNote && /more than one place/.test(mixedNote), 'and says outright that it is a blend');
eq((mixed as { branches: string[] }).branches[0], 'Al Quoz', 'the places are listed in a stable order');

// A labelled place and some unlabelled classes is ALSO two places: the
// unlabelled ones are not known to have happened at the labelled one.
const halfLabelled = branchSpan([{ branch: 'DIFC' }, { branch: '' }], 'ready');
eq(halfLabelled.kind, 'mixed', 'unlabelled classes beside a labelled one are a second bucket');
eq(mayPresentAsOneSite(halfLabelled), false, 'so that total is not DIFC’s');
ok(!!branchNote(halfLabelled) && /no place recorded/.test(branchNote(halfLabelled)!),
  'and the note says some classes have no place on them');

// An unsettled read answers nothing. 'partial' is the sharp one: a truncated
// window can be missing exactly the branch that made the set mixed.
for (const st of ['loading', 'partial', 'error'] as const) {
  eq(branchSpan([{ branch: 'DIFC' }], st).kind, 'unknown', `a ${st} read spans an unknown set`);
  eq(mayPresentAsOneSite(branchSpan([{ branch: 'DIFC' }], st)), false,
    `and a ${st} read may not be reported as one place’s`);
  eq(branchNote(branchSpan([{ branch: 'DIFC' }], st)), null,
    `and says nothing — the screen's own unread banner is the sentence for a ${st} read`);
}

// ── 6 · the simplifications that must not pass ──────────────────────────────
//
// Each of these is a plausible tidy-up, and each one puts back a specific wrong
// sentence on a real screen.

// "An unknown count is one gym." Puts a single-site owner's silence over a
// two-site owner's console.
const treatUnknownAsOne = (s: SiteScope) => (siteCount(s) ?? 1) > 1;
eq(treatUnknownAsOne(failed), false, 'the wrong version is quiet about a failed read');
ok(siteNotice(failed) !== null, 'and the right one is not — this file fails if that is simplified away');

// "'partial' is close enough to 'ready'." Answers 'one place' from a window
// that stopped at the row cap.
const looseSpan = (rows: readonly { branch?: string | null }[], st: 'ready' | 'partial'): BranchSpan =>
  branchSpan(rows, st === 'partial' ? 'ready' : st);
eq(looseSpan([{ branch: 'DIFC' }], 'partial').kind, 'one', 'the wrong version calls a truncated read one place');
eq(branchSpan([{ branch: 'DIFC' }], 'partial').kind, 'unknown', 'and the right one refuses to');

// "Ignore the unlabelled rows and answer on the labels." Reports a two-place
// total as DIFC's.
const labelsOnly = (rows: readonly { branch?: string | null }[]) =>
  new Set(rows.map((r) => (r.branch ?? '').trim()).filter(Boolean)).size <= 1;
eq(labelsOnly([{ branch: 'DIFC' }, { branch: '' }]), true, 'the wrong version sees one place');
eq(mayPresentAsOneSite(halfLabelled), false, 'and the right one sees two');

// "current: r.current" — truthiness instead of a boolean test. Marks a gym as
// the one being shown on the strength of the string "false".
eq(Boolean('false'), true, 'the string false is truthy, which is the trap');
eq(sitesFrom([{ id: A, name: 'X', current: 'false' }], 'ready').sites[0].current, false,
  'and this file fails if the test is loosened to truthiness');

if (errors.length) {
  console.error(`ownedSites.test.ts — ${errors.length} failed:`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('ownedSites.test.ts — ok');
