// Blocking and reporting, on the one surface in this product that carries
// photographs and video between two people.
// Compile with tsc, run with node.
//
// The assertions here are about the two failures that would make the feature
// worse than nothing: a screen that says "you have not blocked anybody" off a
// read that failed, and a report path that quietly reports nothing.
import {
  blockStateOf, canSendInto, blockedComposerNote, blockActionLabel,
  blockConfirm, unblockConfirm, looksLikeThreadRefusal, reportCategoryLabel,
  reportFiledLine, REPORT_OPTIONS, REPORT_EXPLAINER, reportFailedNote,
  SEND_REFUSED_NOTE, type BlockState, type ReportCategory,
} from './threadSafety';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ME = 'me-uuid';
const THEM = 'them-uuid';

/* ── the state, and the read behind it ─────────────────────────────────── */

eq(blockStateOf('ready', [], ME), 'open', 'a completed read with no rows is an open thread');
eq(blockStateOf('ready', [{ blockerId: ME }], ME), 'blocked-by-me', 'my own row is my own block');
eq(blockStateOf('ready', [{ blockerId: THEM }], ME), 'blocked-by-them', 'their row is theirs');
eq(blockStateOf('ready', [{ blockerId: THEM }, { blockerId: ME }], ME), 'blocked-by-me',
  'both blocking resolves to mine — it is the half this reader can lift');

// The whole reason this is not a boolean. An empty list under 'error' is
// UNKNOWN, and a screen that read it as "open" would tell somebody who blocked
// their coach last night that they had not blocked anybody.
eq(blockStateOf('error', [], ME), 'unknown', 'an empty list under error is not an open thread');
eq(blockStateOf('loading', [], ME), 'unknown', 'nor is one still being read');
eq(blockStateOf('partial', [], ME), 'unknown', 'nor a truncated one');
eq(blockStateOf('ready', null, ME), 'unknown', 'nor a null list under any status');
eq(blockStateOf('ready', [{ blockerId: THEM }], null), 'unknown',
  'not knowing who I am is not evidence that somebody blocked me');

/* ── what the composer does with each ──────────────────────────────────── */

// 'unknown' must NOT silence the composer: the server refuses a blocked write
// anyway, and disabling it on a failed read gags somebody nobody has blocked.
ok(canSendInto('unknown'), 'a failed read does not gag anybody');
ok(canSendInto('open'), 'an open thread sends');
ok(!canSendInto('blocked-by-me'), 'my own block stops me sending too — it is not a mute');
ok(!canSendInto('blocked-by-them'), 'and theirs stops me');

eq(blockedComposerNote('open', 'your coach'), null, 'nothing to say on an open thread');
eq(blockedComposerNote('unknown', 'your coach'), null, 'and nothing claimed on an unread one');
const mine = blockedComposerNote('blocked-by-me', 'your coach')!;
ok(mine.includes('You blocked'), 'my own block says it was mine');
ok(/unblock/i.test(mine), 'and says how to undo it');
ok(/stays/.test(mine), 'and that the history is not deleted');
const theirs = blockedComposerNote('blocked-by-them', 'your coach')!;
ok(!/they blocked|blocked you/i.test(theirs),
  'the blocked side is not handed an accusation — only the fact that nothing sends');
ok(/stays/.test(theirs), 'and is told the history is still there, so it can still be reported');

/* ── the confirm in front of the block ─────────────────────────────────── */

const c = blockConfirm('your coach');
ok(/Your coach/.test(c.body), 'the description is capitalised at the head of a sentence, never left as a dash');
ok(/photos|photo/.test(c.body) && /video/.test(c.body),
  'names what actually stops, on a thread whose whole risk is the attachments');
ok(/not deleted|Nothing already/.test(c.body), 'says the conversation is kept');
ok(/report/i.test(c.body), 'and that it can still be reported — a block must not read as the only option');
// The sentence somebody most needs at eleven at night: this is not the button
// that cancels Tuesday.
ok(/does not end your coaching/.test(c.body), 'says it does not end the coaching');
ok(/cancel any session/.test(c.body), 'nor cancel a session');
ok(/move any money/.test(c.body), 'nor move money');
ok(/unblock at any time/.test(c.body), 'and that it is reversible');
ok(/stays/.test(unblockConfirm('your coach').body), 'unblocking does not withdraw a report');

eq(blockActionLabel('open', 'your coach'), 'Block your coach', 'the control offers the block');
eq(blockActionLabel('blocked-by-me', 'your coach'), 'Unblock your coach', 'and the undo when there is one');
eq(blockActionLabel('unknown', 'your coach'), 'Block your coach',
  'an unread thread still offers the block — the safe direction when nothing is known');
eq(blockActionLabel('blocked-by-them', 'your coach'), 'Block your coach',
  'and being blocked does not take away your own ability to block them back');

/* ── the refusal ───────────────────────────────────────────────────────── */

ok(looksLikeThreadRefusal({ code: '42501' }), 'the RLS code is recognised');
ok(looksLikeThreadRefusal({ message: 'new row violates row-level security policy for table "messages"' }),
  'and the message when the code did not come through');
ok(!looksLikeThreadRefusal({ code: '23505', message: 'duplicate key' }), 'an unrelated error is not a refusal');
ok(!looksLikeThreadRefusal(null), 'and neither is nothing at all');
ok(/not been sent/.test(SEND_REFUSED_NOTE), 'the refusal sentence states plainly that nothing was sent');
ok(/blocked/.test(SEND_REFUSED_NOTE) && /no longer connected/.test(SEND_REFUSED_NOTE),
  'and names both causes rather than asserting the one it would rather be');

/* ── reporting ─────────────────────────────────────────────────────────── */

eq(REPORT_OPTIONS.length, 5, 'five categories, matching the check constraint in part 240');
eq(REPORT_OPTIONS[REPORT_OPTIONS.length - 1].id, 'other',
  'the vaguest option is last — a list whose first entry is "other" is a list people pick "other" from');
const ids = REPORT_OPTIONS.map((o) => o.id).join(',');
eq(ids, 'threat,sexual,harassment,spam,other', 'ordered by severity, and pinned so the constraint cannot drift');
for (const o of REPORT_OPTIONS) {
  ok(/^[A-Z]/.test(o.label), `${o.id}: the label is a button, so it is Title Case`);
  ok(/[.]$/.test(o.note), `${o.id}: the note is prose, so it is a sentence`);
}
eq(reportCategoryLabel('threat'), 'Threats or Violence', 'a category names itself');
eq(reportCategoryLabel('nonsense' as ReportCategory), 'Something Else',
  'and an unknown one falls back rather than rendering an empty label');

ok(/even if it is deleted/.test(REPORT_EXPLAINER),
  'the explainer promises what part 240 actually implements: the message is copied into the report');
ok(/not told/.test(REPORT_EXPLAINER), 'that the other person is not notified');
ok(/does not stop them messaging you/.test(REPORT_EXPLAINER),
  'and — the sentence that matters most — that a report is not a block');

const filed = reportFiledLine('sexual', 'open');
ok(/on record/.test(filed), 'the receipt states the row exists');
ok(/Block them/.test(filed), 'and offers the block to somebody who has not made one');
ok(!/Block them/.test(reportFiledLine('sexual', 'blocked-by-me')),
  'but does not nag somebody who already has');
ok(/still blocked/.test(reportFiledLine('sexual', 'blocked-by-me')),
  'it confirms the block is still in force instead');
for (const r of ['unknown', 'online', 'offline'] as const) {
  ok(/not been filed|nothing has been filed/.test(reportFailedNote(r)),
    `${r}: a failed report says plainly that nothing was recorded — somebody who believes one is filed stops looking for help`);
  ok(/email us/.test(reportFailedNote(r)),
    `${r}: and the escalation is still there, last, after whatever the retry sentence says`);
}

/* The middle sentence, which is the whole of why this stopped being a const.
 *
 * `report_abuse` raises on every refusal, so half of what reaches this note is
 * the server having read the report and declined it — and telling THAT person
 * to check their connection sends them to their router instead of to the other
 * way of getting help the last sentence offers. See src/lib/reachability.ts. */
ok(!/check your connection/i.test(reportFailedNote('online')),
  'a report the server read and refused does not blame the phone');
ok(/did not accept/.test(reportFailedNote('online')),
  'it says the server answered and declined, which is the fact that changes what they do next');
ok(/signal/.test(reportFailedNote('offline')),
  'a report that never left the phone says so, and says what to wait for');
ok(/Check your connection and try again/.test(reportFailedNote('unknown')),
  'and knowing nothing keeps the sentence that claims nothing — the one this note printed unconditionally before');

/* ── every state has a sentence ────────────────────────────────────────── */
//
// A state added later with no branch here renders as nothing on the screen,
// which on this screen is a person who cannot tell whether they are protected.
const STATES: BlockState[] = ['unknown', 'open', 'blocked-by-me', 'blocked-by-them'];
for (const s of STATES) {
  ok(typeof blockActionLabel(s, 'your coach') === 'string', `${s}: has a control label`);
  const note = blockedComposerNote(s, 'your coach');
  ok(note === null || note.length > 20, `${s}: has either nothing to say or something worth reading`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('threadSafety.test.ts — ok');
