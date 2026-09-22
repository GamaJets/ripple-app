// An absence is never a clearance. Compile with tsc, run with node.
//
// The defect these pin: `app/(trainer)/templates.tsx` read a hand-added client
// out of the roster, found them, called the disclosures 'ready', flattened
// `injuries: undefined` to `[]` with a `??`, and handed that to `guardInjuries`
// — which returns ALLOWED on an empty list. A person with no account who has
// never been asked about injuries opened the program gate as though they had
// been asked and had said there was nothing wrong.
//
// Every assertion below is written so that deleting the branch it covers fails
// it. The two the whole file exists for are marked MUTATION.
import { disclosureFact, neverAskedBrief, rosterInjuries, type DisclosureRow } from './disclosureFact';
import { guardInjuries } from './injuryGate';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const knee = { area: 'knee', severity: 'mild', note: 'aches on stairs' };

/** A real client with an account, asked and answering nothing. */
const clear: DisclosureRow = { handAdded: false, injuries: [] };
/** A real client with an account who has disclosed something. */
const hurt: DisclosureRow = { handAdded: false, injuries: [knee] };
/** A name the coach typed into Add Client. The roster leaves `injuries`
 *  undefined here ON PURPOSE — see src/ui/roster.tsx. */
const hand: DisclosureRow = { handAdded: true };

/* ── 1 · asked, and disclosed nothing ──────────────────────────────────── */

const none = disclosureFact('ready', clear, 'c1', 'Priya');
eq(none.kind, 'asked', 'a client who was asked and answered is asked');
eq(none.why, 'none', 'and what they answered was nothing');
eq(none.gateStatus, 'ready', 'so the gate is given a whole read');
eq(none.injuries.length, 0, 'with nothing in it');
ok(!none.warn, 'this is a statement about the person, not a warning about a hole');
ok(!!none.note && none.note.includes('Priya') && none.note.includes('asked'),
  'and it says they were ASKED — the word that separates this from the hand-added case');
ok(guardInjuries(none.gateStatus, 'ready', none.injuries, null, 'Priya').allowed,
  'the gate opens, because this is the one clearance there is');
eq(none.spoken, none.note, 'and a screen with no gate reads the same sentence aloud');

/* ── 2 · asked, and disclosed something ────────────────────────────────── */

const some = disclosureFact('ready', hurt, 'c2', 'Priya');
eq(some.kind, 'asked', 'a disclosure is also an answer');
eq(some.why, 'disclosed', 'and it is the answer with something in it');
eq(some.injuries.length, 1, 'the injury travels through to the gate');
eq(some.injuries[0].area, 'knee', 'as itself');
eq(some.injuries[0].status, 'active', 'and active, which is the only kind the roster carries');
eq(some.note, null, 'the gate has the better sentence for this one, so this module is quiet');
const held = guardInjuries(some.gateStatus, 'ready', some.injuries, null, 'Priya');
ok(!held.allowed, 'and the gate holds until the coach has read it');
ok(!!held.reason && held.reason.includes('Priya'), 'in its own words, addressed to the client');
eq(some.spoken, null, 'and on a screen with no gate the injury itself is drawn, so nothing is added beside it');

/* ── 3 · never asked ───────────────────────────────────────────────────── */

// MUTATION. Delete the `handAdded === true` branch from disclosureFact and this
// is the assertion that fails: the row is found, the roster is whole, and
// everything else about it says 'asked, disclosed none'.
const never = disclosureFact('ready', hand, 'c3', 'Priya');
eq(never.kind, 'never-asked', 'a hand-added client has never been asked, whatever the empty list looks like');
eq(never.why, 'no-account', 'because there is no account for the question to have reached');
ok(never.kind !== none.kind,
  'and it is NOT the same fact as a client who was asked and said none — that flattening is the defect');
ok(never.warn, 'it is a warning about an absence, not a report on the person');
ok(!!never.note && never.note.includes('no Repple account'),
  'the coach is told WHICH absence this is: no account');
ok(!!never.note && /never been asked/.test(never.note),
  'and that nobody has ever asked them');
ok(!!never.note && /Nothing here says they are uninjured/.test(never.note),
  'and, in as many words, that this is not a clearance — "no injuries recorded" is the sentence that caused this');
ok(!/no injuries/i.test(never.note ?? ''),
  'so the sentence must not contain the all-clear phrasing it replaces');

// Not over-corrected. A coach must still be ABLE to assign to somebody they
// added by hand — it is most of what Add Client is for — so the gate is not
// turned into a wall. What changed is that the coach is told what they are
// deciding on.
ok(guardInjuries(never.gateStatus, 'ready', never.injuries, null, 'Priya').allowed,
  'the assign stays possible for a hand-added client');
eq(never.spoken, never.note, 'a screen with no gate says the same thing, because nothing else there will');
ok(never.note !== null,
  'but never silently: a caller using gateStatus without the note has put the defect back');

/* ── 4 · the fourth shape, which is not a state of the person ──────────── */

// MUTATION. Make any of these return 'ready' with an empty list and a failed
// read is reported as "they disclosed none" — the other half of the same bug,
// and the one src/lib/injuryGate.ts was already written to refuse.
for (const s of ['error'] as const) {
  const f = disclosureFact(s, clear, 'c4', 'Priya');
  eq(f.kind, 'unread', `a roster read that failed leaves the disclosures unread (${s})`);
  eq(f.gateStatus, 'error', 'and the gate is told so');
  ok(!guardInjuries(f.gateStatus, 'ready', f.injuries, null, 'Priya').allowed,
    'so the gate holds rather than opening on the silence');
}

// MUTATION. Every unread status carries its own sentence for the screens with
// no gate to say it for them, and each one refuses OUT LOUD to be read as an
// all-clear. Blank any of them and a board draws a row with no injury badge on
// it and tells a screen reader nothing — which is the sentence "no injuries
// recorded" by another route.
for (const [status, row, label] of [
  ['error', clear, 'a failed read'],
  ['loading', null, 'a read in flight'],
  ['partial', null, 'a truncated roster'],
  ['ready', null, 'a name the roster does not contain'],
] as const) {
  const f = disclosureFact(status, row, 'c-spoken', 'Priya');
  ok(!!f.spoken && f.spoken.includes('Priya'), `${label} is spoken, and names them`);
  // The FIRST sentence is what a listener hears before they stop listening, and
  // it must never be the claim itself. "…they have disclosed none" appears only
  // inside the refusal that follows it.
  ok(!/disclosed none/.test((f.spoken ?? '').split('.')[0] ?? ''),
    `${label} never leads with the answer it does not have`);
  ok(/not a statement|nothing here says/.test(f.spoken ?? ''),
    `${label} says in as many words that it is not a clearance`);
}

// A found row does not rescue a failed read: under 'error' the roster keeps
// whatever manual rows it had, so surviving the failure says nothing about the
// read that carried the disclosures.
eq(disclosureFact('error', hurt, 'c4', 'Priya').injuries.length, 0,
  'nothing is claimed from a row that outlived a failed read');

const loading = disclosureFact('loading', null, 'c5', 'Priya');
eq(loading.why, 'loading', 'a read still in flight is its own answer');
eq(loading.gateStatus, 'loading', 'and the gate says "checking", not "none"');
ok(!guardInjuries(loading.gateStatus, 'ready', loading.injuries, null, 'Priya').allowed,
  'and holds while it is in flight');

const past = disclosureFact('partial', null, 'c6', 'Priya');
eq(past.why, 'partial', 'somebody past the cap of a truncated roster is not somebody who disclosed nothing');
eq(past.gateStatus, 'partial', 'and partial is never counted, summed, or called empty');
ok(!guardInjuries(past.gateStatus, 'ready', past.injuries, null, 'Priya').allowed,
  'so the gate holds on a prefix too');

const absent = disclosureFact('ready', null, 'c7', 'Priya');
eq(absent.kind, 'unread', 'a whole roster with no row for them answers nothing about them');
eq(absent.why, 'absent', 'and says which nothing it is');
ok(!guardInjuries(absent.gateStatus, 'ready', absent.injuries, null, 'Priya').allowed,
  'and it does not open the gate');

/* ── 5 · a row with no injury list on it at all ────────────────────────── */

// Distinct from both: the read LANDED, so "could not be read" is not quite
// true, and an absent list is still not an empty one.
const noList = disclosureFact('ready', { handAdded: false }, 'c8', 'Priya');
eq(noList.kind, 'unread', 'a row carrying no list is not a row carrying an empty one');
eq(noList.why, 'no-list', 'and it is told apart from a read that failed');
eq(noList.spoken, noList.note, 'and it is the same sentence spoken as written');
ok(!!noList.note && /absent list is not an empty one/.test(noList.note),
  'with its own sentence, because the gate would say "could not be read" and the read landed');
ok(!guardInjuries(noList.gateStatus, 'ready', noList.injuries, null, 'Priya').allowed,
  'and it does not open the gate either');

// `handAdded: undefined` is "the roster has not said", which is not knowledge
// and must not be read as false — the rule clientIsQueryable states. It is not
// read as `true` either: nothing here accuses a real client of having no
// account.
const notSaid = disclosureFact('ready', { injuries: [] }, 'c9', 'Priya');
eq(notSaid.kind, 'asked', 'a row that says nothing about handAdded is not thereby hand-added');
eq(notSaid.why, 'none', 'and its empty list, which IS present, is the answer it looks like');

/* ── 6 · the mapping the three screens had each written out ────────────── */

const mapped = rosterInjuries([knee, { area: 'shoulder', severity: 'severe' }], 'c10');
eq(mapped.length, 2, 'every row maps');
eq(mapped[0].id, 'c10-0', 'ids are positional, because the roster has none to give');
eq(mapped[1].id, 'c10-1', 'and distinct within one client');
eq(mapped[0].note, 'aches on stairs', 'the client’s own words survive');
eq(mapped[1].note, undefined, 'and an absent note stays absent rather than becoming an empty string');
eq(rosterInjuries([], 'c10').length, 0, 'an empty list maps to an empty list');

/* ── 7 · the sentence under the confirm button ─────────────────────────── */

eq(neverAskedBrief([]), null, 'nothing to say when nobody on the list was never asked');
const oneName = neverAskedBrief(['Priya']);
ok(!!oneName && oneName.includes('Priya'), 'one person is named');
ok(!!oneName && oneName.includes('has no Repple account'), 'and it is singular');
const two = neverAskedBrief(['Priya', 'Ana']);
ok(!!two && two.includes('Priya') && two.includes('Ana'), 'both are named — a count is not a name');
ok(!!two && two.includes('have no Repple account'), 'and it is plural');
ok(!!two && /never been asked/.test(two), 'and says the thing that matters in both');

/* ── done ──────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`disclosureFact: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('disclosureFact: all assertions passed');
