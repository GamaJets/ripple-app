// An enquiry is a stranger's name and a way to reach them, and the four ways
// this module can lie about one.
// Compile with tsc, run with node.
//
// Four blocks, and three of them are about a refusal rather than a result:
//
//   REACH     what somebody typed is an email, a phone number, or NEITHER, and
//     'unknown' is a real answer that is never guessed away. A coach who taps
//     a tel: link built over an Instagram handle finds out after they have
//     tapped it. The mutations these kill are the ones that widen the digit
//     bounds, drop the leading-anchor on the email test, or reorder the two
//     tests so that 'joe+ads@x.com' reads as a phone number.
//
//   ORDER     the person waiting on the coach is at the top, and the list does
//     not reorder between two reads of the same rows. A row with an unreadable
//     timestamp is the interesting case: every comparison against NaN is false,
//     so the naive sort leaves those wherever they happened to land.
//
//   COUNT     nothing states a figure it cannot stand behind. An empty list
//     under 'error' is UNKNOWN and must never read as an empty inbox, and a
//     truncated page must never print its own length as a total. This is the
//     rule src/lib/joinCodes.ts wrote down about join counts, arriving at the
//     other end of the same funnel.
//
//   ATTRIBUTION  an enquiry is filed against a code by the SAME rule ad spend
//     is — uppercase, exact, and a code that is not the coach's is unknown
//     rather than guessed. Two rules for the same six characters would let one
//     screen say a campaign cost £400 and another file its enquiries elsewhere.
//
// No expectation is built against a hardcoded "today": the ordering is by
// parsed timestamp, and the fixtures are built relative to one NOW.
//
// ── The two mutations this suite cannot kill, and why ─────────────────────
//
// `node scripts/mutate.mjs --file src/lib/leads.ts` reports 97.0% (64 killed,
// 2 survived). Both survivors are the same change in the two sort
// comparators — `return av ? -1 : 1` becoming `return av ? -1 : 0` — and
// neither is reachable from any assertion about the ORDER of a sorted list.
// Array.prototype.sort only ever asks whether the comparator returned a value
// below zero; 0 and 1 are the same answer to it, so no arrangement of rows
// distinguishes them. Killing them would mean asserting on V8's sort internals
// rather than on this module, so they are recorded here instead of chased.
import {
  contactKind, shapeLeads, shapeFollowUps, leadCountLine, leadProblem, followUpProblem,
  LEAD_STATES, LEAD_STATE_LABEL, FOLLOW_UP_IS_MANUAL, ENQUIRY_IS_ANNOUNCED, MISTYPED_CODE_NOTE,
  FOLLOW_UP_LABEL, FOLLOW_UP_WHEN, followUpDraft, followUpLink, followUpRecord,
  senderName, type FollowUpKind,
  MAX_LEAD_NAME, MAX_LEAD_CONTACT, MAX_LEAD_NOTE, MAX_FOLLOW_UP,
  type RawLead, type RawFollowUp, type LeadRow,
} from './leads';
import type { KnownCode } from './adMatch';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 1, 12, 0).getTime();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const CODES: KnownCode[] = [
  { id: null, code: 'K7M2QX', label: 'Your main code' },
  { id: 'c1', code: 'FLYER7', label: 'Gym flyer' },
  { id: 'c2', code: 'IGBIO9', label: 'Instagram bio' },
];

/* ── REACH ──────────────────────────────────────────────────────────────── */

eq(contactKind('joe@example.com'), 'email', 'a plain address is an email');
eq(contactKind('  Joe.Bloggs@sub.example.co.uk '), 'email', 'so is one with dots, a subdomain and stray spacing');
// The ordering trap. This has digits, a '+' and no spaces, so a phone test run
// first claims it — and the coach gets a dial button that dials nothing.
eq(contactKind('joe+ads@x.com'), 'email', 'a plus-addressed inbox is an email, not a phone number');
eq(contactKind('joe@example'), 'unknown', 'an address with no dot after the @ is not something a mail app can take');
eq(contactKind('a@b.c d@e.f'), 'unknown', 'and two addresses with a space between them are not one address');

eq(contactKind('+44 7700 900123'), 'phone', 'an international number with spaces is a phone number');
eq(contactKind('(020) 7946 0958'), 'phone', 'so is one written with brackets and a dash');
eq(contactKind('07700-900123'), 'phone', 'and a local one with a dash');
// The bounds, from both sides. Seven digits is the shortest real subscriber
// number and fifteen is E.164's ceiling; widening either is how an order number
// or an account id becomes a dial button.
eq(contactKind('123456'), 'unknown', 'six digits is not a phone number');
eq(contactKind('1234567'), 'phone', 'seven is');
eq(contactKind('123456789012345'), 'phone', 'fifteen still is');
eq(contactKind('1234567890123456'), 'unknown', 'sixteen is not — that is an account number');

eq(contactKind('@joebloggs'), 'unknown', 'an Instagram handle is neither, and is not made into one');
eq(contactKind('ask for joe'), 'unknown', 'nor is a sentence');
eq(contactKind(''), 'unknown', 'nor is nothing');
eq(contactKind(null), 'unknown', 'nor is a null the database says cannot happen');

/* ── ATTRIBUTION ────────────────────────────────────────────────────────── */

const one = (over: Partial<RawLead>): RawLead => ({
  id: 'l1', name: 'Sam', contact: 'sam@example.com', note: null,
  via_code: 'FLYER7', at: ago(1), state: 'new', ...over,
});

{
  const rows = shapeLeads([one({ via_code: 'flyer7' })], CODES);
  eq(rows.length, 1, 'a lowercase code on the row still resolves');
  eq(rows[0].viaCode, 'FLYER7', 'and is stored uppercased, the way adMatch compares them');
  eq(rows[0].campaign, 'Gym flyer', 'against the coach’s own name for it');
}
{
  const rows = shapeLeads([one({ via_code: 'K7M2QX' })], CODES);
  eq(rows[0].campaign, 'Your main code', 'the default code has no id and still attributes');
}
{
  // A rotated default code. The string stops existing anywhere and the
  // enquiries it brought in stay true, so the campaign is UNKNOWN and the row
  // is kept — never dropped, and never filed under whichever code is nearest.
  const rows = shapeLeads([one({ via_code: 'OLDGONE' })], CODES);
  eq(rows.length, 1, 'an enquiry off a code the coach no longer holds is kept');
  eq(rows[0].campaign, null, 'and its campaign is unknown rather than invented');
  eq(rows[0].viaCode, 'OLDGONE', 'with the code it really arrived on still on the row');
}
{
  // The read that failed. Passing no codes must not silently rename every
  // campaign — it makes them all unknown, which is what the screen gates on.
  const rows = shapeLeads([one({}), one({ id: 'l2', via_code: 'IGBIO9' })], []);
  eqJson(rows.map((r) => r.campaign), [null, null], 'with no codes read, no enquiry claims a campaign');
}

/* ── ORDER ──────────────────────────────────────────────────────────────── */

{
  const rows = shapeLeads([
    one({ id: 'closed-old', state: 'closed', at: ago(30) }),
    one({ id: 'contacted-new', state: 'contacted', at: ago(0.5) }),
    one({ id: 'new-old', state: 'new', at: ago(9) }),
    one({ id: 'new-today', state: 'new', at: ago(0.1) }),
    one({ id: 'closed-new', state: 'closed', at: ago(0.2) }),
  ], CODES);
  eqJson(rows.map((r) => r.id),
    ['new-today', 'new-old', 'contacted-new', 'closed-new', 'closed-old'],
    'what still needs doing comes first, newest first inside each state');
}
{
  // A timestamp nothing can parse. It must land at the BOTTOM of its own state
  // and in a stable place, not wherever the comparator's NaN left it.
  const rows = shapeLeads([
    one({ id: 'b-undated', at: null }),
    one({ id: 'dated', at: ago(40) }),
    one({ id: 'a-undated', at: 'not a date' }),
  ], CODES);
  eqJson(rows.map((r) => r.id), ['dated', 'a-undated', 'b-undated'],
    'an unreadable date sorts last within its state, and ties break on the id so the list does not reshuffle');
}
{
  const first = shapeLeads([
    one({ id: 'zzz', at: ago(3) }),
    one({ id: 'aaa', at: ago(3) }),
  ], CODES);
  eqJson(first.map((r) => r.id), ['aaa', 'zzz'],
    'two enquiries in the same instant read in the same order every time');
}

/* ── The rows that are not rows ─────────────────────────────────────────── */

{
  const rows = shapeLeads([
    one({ id: '' }),
    one({ id: 'l2', name: '   ' }),
    one({ id: 'l3', contact: '' }),
    one({ id: 'l4' }),
  ], CODES);
  eqJson(rows.map((r) => r.id), ['l4'],
    'a row with no id, no name or no contact is dropped rather than drawn blank');
}
{
  const rows = shapeLeads([one({ name: '  Sam   Vimes  ', note: '   ' })], CODES);
  eq(rows[0].name, 'Sam Vimes', 'runs of whitespace in a name are collapsed');
  eq(rows[0].note, null, 'and a message that is only spaces is nothing, not an empty line');
}
{
  const long = 'x'.repeat(MAX_LEAD_NAME + 40);
  const rows = shapeLeads([one({
    name: long,
    contact: `${'c'.repeat(MAX_LEAD_CONTACT + 40)}@x.com`,
    note: 'y'.repeat(MAX_LEAD_NOTE + 40),
  })], CODES);
  eq(rows[0].name.length, MAX_LEAD_NAME, 'a name past the server’s limit is cut to it');
  eq(rows[0].contact.length, MAX_LEAD_CONTACT, 'and so is a contact string');
  eq(rows[0].note?.length, MAX_LEAD_NOTE, 'and so is a message — at the server’s length and not at some other one');
}
{
  // A row with the column ABSENT rather than null. PostgREST omits a key it was
  // not asked for, and `undefined` on this field renders as nothing at all
  // rather than as the dash `when()` gives a null.
  const rows = shapeLeads([{ id: 'l9', name: 'Sam', contact: 'sam@example.com', note: null, via_code: 'FLYER7', state: 'new' } as unknown as RawLead], CODES);
  eq(rows[0].at, null, 'a row with no `at` key at all carries null, never undefined');
}
{
  const rows = shapeLeads([one({ state: 'joined' })], CODES);
  eq(rows[0].state, 'new', 'a state this app does not have falls back to new, never to a fourth state');
  ok(!LEAD_STATES.includes('joined' as never), 'and there is no ‘joined’ state to fall into');
  eqJson(LEAD_STATES.map((s) => LEAD_STATE_LABEL[s]), ['New', 'Contacted', 'Closed'],
    'the three states are labelled in Title Case, as buttons and filters');
}
eqJson(shapeLeads(null, CODES), [], 'a null read shapes to nothing rather than throwing');

/* ── COUNT ──────────────────────────────────────────────────────────────── */

const ready = shapeLeads([
  one({ id: 'a', state: 'new' }),
  one({ id: 'b', state: 'new' }),
  one({ id: 'c', state: 'closed' }),
], CODES);

{
  const line = leadCountLine('error', []);
  ok(!/^0 |\b0 enquiries\b/.test(line), 'a failed read never prints a zero');
  ok(/could not be read/.test(line), 'it says the read failed');
  ok(/not an empty inbox/i.test(line), 'and says out loud that this is not an empty inbox');
}
{
  // The whole point of 'partial': the rows are real and the LENGTH is not the
  // answer. A screen that prints its own page size as a total is the bug
  // src/ui/loadStatus.ts exists for.
  const line = leadCountLine('partial', ready);
  ok(/not the whole list/.test(line), 'a truncated read says it is not the whole list');
  ok(/no figure on this screen is a total/.test(line), 'and refuses every total on the screen');
}
{
  const line = leadCountLine('loading', ready);
  ok(!/\b3\b/.test(line), 'nothing is counted while the read is still in flight');
}
{
  const line = leadCountLine('ready', []);
  ok(/Nobody has left their details yet/.test(line), 'an empty list under ready may say so');
}
{
  const line = leadCountLine('ready', ready);
  eq(line, '3 enquiries · 2 waiting on you.', 'a whole read states the count and who is waiting');
}
{
  const done = shapeLeads([one({ id: 'a', state: 'closed' })], CODES);
  eq(leadCountLine('ready', done), '1 enquiry, all of them dealt with.',
    'one enquiry is singular, and none waiting is said rather than left off');
}
{
  const big: LeadRow[] = [];
  for (let i = 0; i < 1200; i++) big.push(...shapeLeads([one({ id: `n${i}`, state: 'closed' })], CODES));
  ok(leadCountLine('ready', big).includes('1,200'),
    'a four-figure count carries its thousands separator');
}

/* ── What a person is told before it is too late to fix ─────────────────── */

eq(leadProblem('', 'joe@example.com'), 'Put in a name, so the coach knows who is asking.',
  'a blank name is refused HERE, because the server answers every input identically');
ok((leadProblem('x'.repeat(MAX_LEAD_NAME + 1), 'joe@example.com') || '').includes(String(MAX_LEAD_NAME)),
  'a name past the limit names the limit');
ok((leadProblem('Sam', '') || '').includes('no way to answer'),
  'no contact is refused, and the reason is the coach cannot reply');
ok((leadProblem('Sam', '@joebloggs') || '').includes('reach you on'),
  'something that is neither an email nor a number is refused before it is sent');
eq(leadProblem('Sam', '+44 7700 900123'), null, 'a name and a number is enough');
eq(leadProblem('  Sam  ', ' joe@example.com '), null, 'and stray spacing is not a reason to refuse anybody');

// The limits are inclusive on both sides, here and in the CHECK constraint in
// supabase/parts/157 — `between 1 and 80`. A form that refuses the eightieth
// character while the database accepts it turns a limit into an off-by-one a
// person meets while typing their own name.
eq(leadProblem('n'.repeat(MAX_LEAD_NAME), 'joe@example.com'), null,
  'a name of exactly the limit is accepted, not refused one character early');
eq(leadProblem('Sam', `${'a'.repeat(MAX_LEAD_CONTACT - '@example.io'.length)}@example.io`), null,
  'and so is a contact string of exactly the limit');

eq(followUpProblem('   '), 'Write what you did, so the next time you open this you know where it got to.',
  'an empty follow-up is refused rather than filed as a note nobody wrote');
ok((followUpProblem('x'.repeat(MAX_FOLLOW_UP + 1)) || '').includes(String(MAX_FOLLOW_UP)),
  'and one past the limit names the limit');
eq(followUpProblem('x'.repeat(MAX_FOLLOW_UP)), null, 'one of exactly the limit saves — the bound is inclusive, as the CHECK is');
eq(followUpProblem('Rang, left a voicemail.'), null, 'a real note saves');

// The four limits, written out against the numbers the CHECK constraints in
// supabase/parts/157 allow. This is the only place the two are compared: the
// app truncates to these and the database refuses past them, so a constant
// edited here alone would start silently cutting text a coach could see was
// there a moment ago — or would send a write the server rejects outright.
eq(MAX_LEAD_NAME, 80, 'a name is 80 characters, as `char_length(name) between 1 and 80` allows');
eq(MAX_LEAD_CONTACT, 120, 'a contact string is 120, as the CHECK allows');
eq(MAX_LEAD_NOTE, 500, 'a message is 500 — long enough for a real enquiry, and what the CHECK allows');
eq(MAX_FOLLOW_UP, 1000, 'a follow-up note is 1,000, as coach_lead_notes_sane allows');

/* ── Follow-ups ─────────────────────────────────────────────────────────── */

{
  const notes = shapeFollowUps([
    { id: 'n1', body: 'Rang, no answer.', at: ago(4) },
    { id: 'n2', body: '  ', at: ago(1) },
    { id: '', body: 'orphan', at: ago(0) },
    { id: 'n0', body: 'Written up months later, with no date on it.', at: null },
    { id: 'n3', body: 'Texted them the address.', at: ago(0.5) },
  ]);
  eqJson(notes.map((n) => n.id), ['n3', 'n1', 'n0'],
    'follow-ups read newest first, an undated one comes last, and an empty one or one with no id is not a record of anything');
  eq(notes[0].body, 'Texted them the address.',
    'and the words come through whole — a note missing its first character is a note somebody wrote and cannot read back');
}
{
  // The column ABSENT rather than null, as PostgREST leaves a key it was not
  // asked for. `undefined` here renders as nothing where `when()` would give a
  // dash, so a note with no date would look like a note with no heading.
  const notes = shapeFollowUps([{ id: 'n1', body: 'Rang them.' } as unknown as RawFollowUp]);
  eq(notes[0].at, null, 'a follow-up row with no `at` key carries null, never undefined');
}
{
  // Two notes written in the same second — an ordinary thing when a coach
  // catches up on three calls at once. The tie must break on something stable,
  // or the history reorders itself between two openings of the same enquiry.
  const stamp = ago(2);
  const notes = shapeFollowUps([
    { id: 'zzz', body: 'Second call.', at: stamp },
    { id: 'aaa', body: 'First call.', at: stamp },
  ]);
  eqJson(notes.map((n) => n.id), ['aaa', 'zzz'], 'two notes in the same instant read in the same order every time');
}

/* ── The promise this feature does not make ─────────────────────────────── */

ok(/does not contact these people/i.test(FOLLOW_UP_IS_MANUAL),
  'the screen says plainly that Repple contacts nobody');
ok(/nothing will be/i.test(FOLLOW_UP_IS_MANUAL),
  'and that it is not going to start — there is no email channel to start it with');
ok(!/(sequence|automat|schedul|drip)/i.test(FOLLOW_UP_IS_MANUAL),
  'and it does not use a word that implies one');

// R5 — being TOLD one arrived is a different promise from one being answered,
// and the two live in two sentences on purpose. A coach who read them as one
// would believe the enquirer had been acknowledged by something.
ok(String(ENQUIRY_IS_ANNOUNCED) !== String(FOLLOW_UP_IS_MANUAL),
  'the notification sentence is its own, and does not replace the one saying nothing is sent');
ok(!/(sent to them|reply|replied|acknowledg|respond)/i.test(ENQUIRY_IS_ANNOUNCED),
  'and it never implies the enquirer has heard anything');
ok(/name/i.test(ENQUIRY_IS_ANNOUNCED) && /lock screen/i.test(ENQUIRY_IS_ANNOUNCED),
  'it says what the notification carries and why it carries no more: a push is drawn on a lock screen and the contact string is a stranger\u2019s typing');
ok(!/(sequence|automat|schedul|drip)/i.test(ENQUIRY_IS_ANNOUNCED),
  'and it promises no sequence either');
ok(/no coach to give them to/i.test(MISTYPED_CODE_NOTE),
  'the cost of dropping an unresolvable code is stated rather than hidden');


/* ── following one up, from the coach's own phone ───────────────────────── */

// The rule that decides this whole feature: NOTHING in a draft may name this
// software. A prospect reading their first message from a coach must not meet
// the coach's supplier in it, and a chain's member must not meet a competitor.
// That is the same violation the join page was fixed for, on the one message
// somebody reads before they are anybody's customer.
const KINDS: FollowUpKind[] = ['first', 'second', 'last'];
const lead = { name: 'Sarah Ahmed', note: 'I want to get back into lifting.', contact: 'sarah@example.com', contactKind: 'email' as const };

for (const k of KINDS) {
  const d = followUpDraft(k, lead, 'Tim Rodgers', 'Northside Strength');
  ok(!/repple/i.test(d.body + d.subject), `the ${k} draft never names the software`);
  ok(d.body.includes('Sarah'), `the ${k} draft greets them by name`);
  ok(d.body.includes('Tim'), `and signs off as the coach`);
  ok(d.subject.length > 0 && d.subject.length < 60, `the ${k} subject is a subject`);
  ok(!d.body.includes('!'), `the ${k} draft does not shout`);
  // The same refusals `NEVER_SAYS` makes mechanical for a nudge, applied by
  // hand here: a stranger who left a number must not be sent a promise.
  ok(!/guarantee|transform|results in \d|lose \d|\bfree trial\b/i.test(d.body),
    `the ${k} draft promises nothing`);
  ok(!/[£$€]|\bAED\b|\bper (month|session)\b/i.test(d.body),
    `and states no price — this product has no default currency and a draft is the wrong place to invent one`);
}

// The business name is the COACH's trading name, never the app's, and it is
// simply absent when they have not set one.
ok(followUpDraft('first', lead, 'Tim', 'Northside Strength').body.includes('Northside Strength'),
  'a coach with a trading name writes from it');
ok(!/ at \b/.test(followUpDraft('first', lead, 'Tim', null).body.split('\n')[2] ?? ''),
  'and a coach without one simply does not name a business');
ok(!/undefined|null/.test(followUpDraft('first', { name: '', note: null }, null, null).body),
  'a nameless lead and a nameless coach still produce a readable message');

// Their own words are quoted only when they left some. "Thanks for your
// message" said to somebody who left a name and a number is the app inventing
// a message they did not write.
ok(followUpDraft('first', lead, 'Tim', null).body.includes('back into lifting'),
  'a note they left is quoted back');
ok(!/You mentioned/.test(followUpDraft('first', { name: 'Sarah', note: null }, 'Tim', null).body),
  'and nothing is quoted when they left nothing');

// The sender's name, on the same rule `greetingName` keeps.
eq(senderName('Tim Rodgers'), 'Tim', 'first word only');
eq(senderName('  '), null, 'whitespace is nobody');
eq(senderName('tim@example.com'), null, 'an email address is not a name');
eq(senderName('7f3a9c21-0000'), null, 'and neither is a uuid');

/* ── the link that opens their own mail app ─────────────────────────────── */

const draft = followUpDraft('first', lead, 'Tim', null);
const mail = followUpLink(lead, draft);
ok(mail !== null && mail.startsWith('mailto:sarah%40example.com?'), 'an email opens a mailto');
ok((mail ?? '').includes('subject='), 'with a subject');
ok((mail ?? '').includes('body='), 'and a body');
// A raw newline or ampersand in the query truncates the body in some mail apps,
// and the coach sends half a message without noticing.
ok(!/\n/.test(mail ?? ''), 'nothing in the link is a raw newline');
ok(((mail ?? '').match(/&/g) || []).length === 1, 'and the only ampersand is the one separating the two fields');

const phoneLead = { ...lead, contact: '+44 (0)7700 900-123', contactKind: 'phone' as const };
const sms = followUpLink(phoneLead, draft);
// `+44 (0)7700 900-123` is the ordinary British way of writing a number that
// is dialled as +447700900123 from abroad. Keeping the bracketed trunk zero
// gives +4407700900123, which is not a number anywhere, and the message
// silently fails to send.
ok((sms ?? '').startsWith('sms:+447700900123?'), 'an international number drops its bracketed trunk prefix');
ok(!/[()\s-]/.test((sms ?? '').split('?')[0]), 'because brackets and spaces silently fail to open on some builds');
// And a domestic number keeps every digit: (0161) is an area code, not a trunk
// prefix, and dropping it would dial a number in another city.
ok((followUpLink({ contact: '(0161) 496 0000', contactKind: 'phone' }, draft) ?? '')
  .startsWith('sms:01614960000?'), 'a domestic number keeps its area code');
eq(followUpLink({ contact: '+++', contactKind: 'phone' }, draft), null, 'and a number with no digits opens nothing');
ok(!(sms ?? '').includes('subject='), 'and a text has no subject — inventing one puts the word Subject in an SMS');

// THE refusal. `contactKind` returns 'unknown' rather than guessing, and this
// is where that pays: a button that dials an Instagram handle does nothing, and
// the coach finds out after they have tapped it.
eq(followUpLink({ contact: '@sarahlifts', contactKind: 'unknown' }, draft), null,
  'there is nothing to open an Instagram handle with, and nothing is offered');
eq(followUpLink({ contact: '', contactKind: 'email' }, draft), null, 'and nothing for an empty contact');

/* ── the record afterwards ──────────────────────────────────────────────── */

// It says "opened", which is the only thing this app actually observed — the
// coach may have edited the draft to nothing or closed the mail app.
ok(/^Opened the first reply/.test(followUpRecord('first', 'email')), 'the note names which draft');
ok(followUpRecord('second', 'text').includes('a text'), 'and which channel');
ok(!/sent/i.test(followUpRecord('last', 'email')),
  'and never says "sent" — nothing here observed a send');

// The buttons and their captions.
for (const k of KINDS) {
  ok(/^[A-Z]/.test(FOLLOW_UP_LABEL[k]), `${k}'s label is Title Case — it is a button`);
  ok(FOLLOW_UP_WHEN[k][0] === FOLLOW_UP_WHEN[k][0].toLowerCase(), `${k}'s caption is sentence case`);
  ok(FOLLOW_UP_WHEN[k].endsWith('.'), `${k}'s caption is a sentence`);
}
eq(new Set(Object.values(FOLLOW_UP_LABEL)).size, KINDS.length, 'no two buttons read the same');


if (errors.length) {
  console.error(`leads.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('leads.test.ts — all assertions passed.');
