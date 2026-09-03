"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The gym's contact log, on the coach's screen. Compile with tsc, run node.
//
// The bug every assertion here is aimed at: "nobody has contacted them" is the
// one sentence this table exists to make trustworthy, and there are four
// separate ways to produce it without it being true —
//
//   · the client is not in the coach's gym, so the read is correctly empty;
//   · the coach has no gym, so `my_tenant()` is null and nothing matches;
//   · the client has no account, so no row could ever point at them;
//   · the read failed or came back truncated.
//
// Each one ends with a coach ringing somebody the desk rang on Tuesday.
const interventions_1 = require("./interventions");
const coachContacts_1 = require("./coachContacts");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const GYM = 'tenant-gym';
const OTHER = 'tenant-personal';
const base = {
    coachTenantId: GYM, coachTenantStatus: 'ready',
    clientTenantId: GYM, clientTenantStatus: 'ready',
    clientHasAccount: true,
};
/* ── the scope ──────────────────────────────────────────────────────────── */
eq((0, coachContacts_1.contactScope)(base), 'ok', 'a member of the coach’s own gym is in scope');
eq((0, coachContacts_1.contactScope)({ ...base, clientTenantId: OTHER }), 'other-gym', 'a client in their own personal tenant is not one of the gym’s members');
eq((0, coachContacts_1.contactScope)({ ...base, clientTenantId: null }), 'other-gym', 'a client attached to no tenant is not one of the gym’s members either');
eq((0, coachContacts_1.contactScope)({ ...base, coachTenantId: null }), 'no-gym', 'a coach with no gym cannot satisfy my_tenant() whatever the client is');
eq((0, coachContacts_1.contactScope)({ ...base, clientHasAccount: false }), 'no-account', 'member_interventions.member_id references profiles(id), so a hand-added client has nothing to point at');
// A client with no account is answered as such even when everything else is
// unknown: it is a fact about the row, and the reads below it are moot.
eq((0, coachContacts_1.contactScope)({ ...base, clientHasAccount: false, coachTenantStatus: 'error', clientTenantStatus: 'error' }), 'no-account', 'no account outranks a failed tenant read');
/* ── a read that has not finished has established nothing ───────────────── */
eq((0, coachContacts_1.contactScope)({ ...base, coachTenantStatus: 'loading' }), 'reading', 'the coach’s gym is still being read');
eq((0, coachContacts_1.contactScope)({ ...base, clientTenantStatus: 'loading' }), 'reading', 'the client’s gym is still being read');
// THE bug. A failed read must not become "they are not a member of your gym",
// because that sentence hides the contact log and the coach then calls blind.
eq((0, coachContacts_1.contactScope)({ ...base, coachTenantStatus: 'error' }), 'unknown', 'a failed read is unknown, never a verdict');
eq((0, coachContacts_1.contactScope)({ ...base, clientTenantStatus: 'error' }), 'unknown', 'from either side');
eq((0, coachContacts_1.contactScope)({ ...base, clientTenantStatus: 'partial' }), 'unknown', 'a truncated read has not established a tenant id, and a tenant id is one value');
/* ── the control is offered only where it can succeed ───────────────────── */
const ALL_SCOPES = ['ok', 'reading', 'unknown', 'no-account', 'no-gym', 'other-gym'];
for (const s of ALL_SCOPES) {
    eq((0, coachContacts_1.canLogContact)(s), s === 'ok', `${s} offers the log control only when the insert policy could accept it`);
}
/* ── every scope has a sentence, and only one of them is silent ─────────── */
eq((0, coachContacts_1.contactScopeLine)('ok', 'Sam'), null, 'in scope there is nothing to explain — the rows speak');
for (const s of ALL_SCOPES.filter((x) => x !== 'ok')) {
    const line = (0, coachContacts_1.contactScopeLine)(s, 'Sam');
    ok(!!line && line.trim().length > 0, `${s} says why the log is not shown`);
    // Not one of them may claim nobody has been contacted. That claim belongs to
    // contactGapLine, and only under 'ready' — an out-of-scope log has read
    // nothing and is in no position to say who has tried.
    ok(!/[Nn]obody (?:at your gym )?has/.test(line), `${s} does not claim nobody has been contacted`);
}
eq(new Set(ALL_SCOPES.filter((x) => x !== 'ok').map((s) => (0, coachContacts_1.contactScopeLine)(s, 'Sam'))).size, 5, 'the five out-of-scope reasons read as five different sentences');
/* ── and only a whole, successful read may say nobody has tried ─────────── */
eq((0, coachContacts_1.contactGapLine)('ready', 2, 'Sam'), null, 'with contacts to show there is nothing to explain');
eq((0, coachContacts_1.contactGapLine)('error', 2, 'Sam'), null, 'rows that came back are rows, whatever else failed');
const gaps = ['loading', 'error', 'partial', 'ready']
    .map((s) => [s, (0, coachContacts_1.contactGapLine)(s, 0, 'Sam')]);
for (const [s, line] of gaps) {
    ok(!!line && line.trim().length > 0, `${s} has a sentence`);
    eq(/Nobody at your gym has recorded/.test(line), s === 'ready', `${s} states that nobody has tried only when the read actually established it`);
}
// The three that cannot answer tell the coach the thing that protects the
// member: look before you dial.
for (const [s, line] of gaps) {
    if (s === 'ready' || s === 'loading')
        continue;
    ok(/Check before you call/.test(line), `${s} tells the coach to check rather than to assume`);
}
eq(new Set(gaps.map(([, l]) => l)).size, 4, 'the four read states read as four sentences');
ok(gaps.find(([s]) => s === 'ready')[1].includes('Sam'), 'the client is named, not left as a dash');
/* ── the draft ──────────────────────────────────────────────────────────── */
eq((0, coachContacts_1.draftBlocker)({ channel: null, outcome: null, note: '' }), 'Choose how you contacted them.', 'a channel is required');
eq((0, coachContacts_1.draftBlocker)({ channel: 'call', outcome: null, note: '' }), 'Choose what came of it.', 'an outcome is required');
// A note is optional: "rang, no answer" is a complete and useful record.
eq((0, coachContacts_1.draftBlocker)({ channel: 'call', outcome: 'no_answer', note: '' }), null, 'a note is not required');
eq((0, coachContacts_1.contactInsert)({ channel: null, outcome: 'reached', note: '' }, { tenantId: GYM, memberId: 'm', byId: 'u', byName: 'Alex', at: '2026-09-01T10:00:00.000Z' }), null, 'an incomplete draft produces no row at all');
const row = (0, coachContacts_1.contactInsert)({ channel: 'call', outcome: 'no_answer', note: '  rang twice  ' }, { tenantId: GYM, memberId: 'm', byId: 'u', byName: '  Alex  ', at: '2026-09-01T10:00:00.000Z' });
eq(row.tenant_id, GYM, 'the row is scoped to the gym the insert policy checks');
eq(row.member_id, 'm', 'and to the member it is about');
// by_id is enforced in the policy's WITH CHECK, not trusted from the client:
// a coach filing a call under a colleague's name makes "who has already tried"
// unreliable exactly where it matters.
eq(row.by_id, 'u', 'the contact is filed under the caller’s own id');
eq(row.by_name, 'Alex', 'the name is written down and trimmed, so it survives them leaving the gym');
eq(row.note, 'rang twice', 'the note is trimmed');
eq(row.outcome, 'no_answer', 'the outcome is the one chosen');
const blank = (0, coachContacts_1.contactInsert)({ channel: 'text', outcome: 'unknown', note: '   ' }, { tenantId: GYM, memberId: 'm', byId: 'u', byName: '   ', at: '2026-09-01T10:00:00.000Z' });
eq(blank.note, null, 'a note of three spaces is stored as no note, not as an empty string');
eq(blank.by_name, null, 'a blank name is stored as no name — a contact made by nobody is worse than an unnamed one');
/* ── the pickers offer what the CHECK constraints accept ────────────────── */
const chans = (0, coachContacts_1.channelOptions)(interventions_1.CHANNELS);
eq(chans.length, interventions_1.CHANNELS.length, 'every channel the column accepts is offered');
ok(chans.every((c) => c.label.trim().length > 0), 'and each has a label rather than its raw value');
eq(chans[0].value, interventions_1.CHANNELS[0], 'in the order the Studio console shows, so one coach sees one list');
const outs = (0, coachContacts_1.outcomeOptions)(interventions_1.CONTACT_OUTCOMES);
eq(outs.length, interventions_1.CONTACT_OUTCOMES.length, 'every outcome the column accepts is offered');
ok(outs.some((o) => o.value === 'bounced'), 'including bounced — a dead number is a finding about the gym’s records and is invisible under no_answer');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('coachContacts: ok');
