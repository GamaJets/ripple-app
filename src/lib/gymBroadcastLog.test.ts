// Reading back the record of who a message went to. Compile with tsc, run with
// node.
//
// The table has been written since part 691 and read by nothing, so every
// assertion here is about a sentence that had never been said out loud. Three
// of them are the ones that matter: an unknown delivery count is not zero, a
// name that could not be looked up is not a deleted account, and a page of the
// fifty most recent is not a count of what the gym has sent.
import {
  senderLine, deliveredLine, logCaption, splitRecipients, recipientLine,
  type Broadcast, type BroadcastLog,
} from './gymBroadcastLog';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const sent = (over: Partial<Broadcast> = {}): Broadcast => ({
  id: 'b1', sentAt: '2026-09-01T09:00:00Z', sentBy: 'owner-1', sentByName: 'Dana Reyes',
  segmentId: 'unseen', segmentLabel: 'Not seen in 30 days', memberIds: ['m1', 'm2'],
  recipients: 2, delivered: 2, body: 'We miss you.', ...over,
});
const log = (rows: Broadcast[], over: Partial<BroadcastLog> = {}): BroadcastLog =>
  ({ rows, truncated: false, namesError: null, ...over });

/* ── who sent it: three silences that are not each other ──────────────────── */

eq(senderLine(sent(), { meId: 'owner-1' }), 'Sent by you.', 'the reader is named as themselves');
eq(senderLine(sent(), { meId: 'owner-2' }), 'Sent by Dana Reyes.', 'and everybody else by name');

// `on delete set null` is deliberate in part 691: a member of staff leaving
// must not delete the record of what they sent. The row then says the account
// has gone — which is a different sentence from "nobody sent it".
ok(senderLine(sent({ sentBy: null, sentByName: null }), { meId: 'owner-1' }).includes('removed'),
  'a deleted account is named as a deleted account');

// The lookup failing looks identical in the data and means something else
// entirely. Reporting it as a deleted account is how an audit trail starts
// lying quietly.
const unread = senderLine(sent({ sentByName: null }), { meId: 'owner-2', namesError: 'permission denied' });
ok(unread.includes('could not be read'), 'a failed name lookup says so');
ok(!unread.includes('removed'), 'and is never reported as a removed account');

// A failed lookup does not override the two facts the row itself carries.
eq(senderLine(sent(), { meId: 'owner-1', namesError: 'permission denied' }), 'Sent by you.',
  'the reader is still the reader when the lookup failed');
ok(senderLine(sent({ sentBy: null }), { meId: 'owner-2', namesError: 'permission denied' }).includes('removed'),
  'and a null sender is still a removed account');

ok(senderLine(sent({ sentByName: '' }), { meId: 'owner-2' }).includes('no name'),
  'an account with a blank name is neither removed nor unreadable');

/* ── how many it reached: null is unknown, not none ───────────────────────── */

// The whole reason `delivered` is nullable. `logBroadcast` refuses to round an
// unknown up to the intended count, and this is where that refusal becomes
// visible to the person who has to answer for the message.
const unknown = deliveredLine(sent({ recipients: 40, delivered: null }));
ok(unknown.includes('unknown'), 'an unrecorded delivery count is called unknown');
ok(!/\b0\b|none of/.test(unknown), 'and is never stated as none');

ok(deliveredLine(sent({ recipients: 40, delivered: 40 })).includes('every inbox'),
  'a complete delivery says so');
ok(deliveredLine(sent({ recipients: 40, delivered: 37 })).includes('3 people were not reached'),
  'a short delivery names how many were missed');
ok(deliveredLine(sent({ recipients: 2, delivered: 1 })).includes('1 person was not reached'),
  'and counts one person as one person');
ok(deliveredLine(sent({ recipients: 1, delivered: 0 })).includes('1 person was not reached'),
  'nobody reached is stated plainly, because zero here is a recorded zero');
// Not silently tidied away: a delivered count above the addressed count is a
// disagreement between two writes, and the screen is where somebody notices it.
ok(deliveredLine(sent({ recipients: 2, delivered: 5 })).includes('cannot explain'),
  'more delivered than addressed is reported rather than hidden');

/* ── what the list may say about itself ───────────────────────────────────── */

eq(logCaption(log([sent()])), 'One notice has been posted to a group from this console.',
  'one notice is one notice');
ok(logCaption(log([sent(), sent({ id: 'b2' })])).startsWith('2 notices'), 'and two are two');

// A count over a cut-off page is a subtotal. Saying "50 notices have been
// posted" over the fifty most recent of two hundred is the exact shape of
// failure this codebase keeps writing down.
const cut = logCaption(log([sent(), sent({ id: 'b2' })], { truncated: true }));
ok(cut.includes('most recent'), 'a truncated page says it is a page');
ok(cut.includes('more than that'), 'and says there are older ones it is not showing');
ok(!cut.includes('have been posted to a group'), 'and never phrases itself as a total');

/* ── who got it ───────────────────────────────────────────────────────────── */

const names = new Map<string, string>([['m1', 'Sarah Ng'], ['m2', 'Tom Hale'], ['m3', '']]);

same(splitRecipients(['m1', 'm2'], names), { named: ['Sarah Ng', 'Tom Hale'], nameless: 0, gone: 0 },
  'two members who are still here');
// No foreign key on `member_ids`, on purpose: the list is a statement about who
// was addressed AT THE TIME and stays true after somebody leaves. An id with no
// profile behind it is that, and not a broken row.
same(splitRecipients(['m1', 'gone-1', 'gone-2'], names), { named: ['Sarah Ng'], nameless: 0, gone: 2 },
  'ids with no profile left are counted as departed, not dropped');
same(splitRecipients(['m3'], names), { named: [], nameless: 1, gone: 0 },
  'an account with a blank name is not a departed one');

eq(recipientLine({ named: ['Sarah Ng', 'Tom Hale'], nameless: 0, gone: 0 }), 'Sarah Ng, Tom Hale.',
  'a short list is just the names');
ok(recipientLine({ named: ['A', 'B', 'C'], nameless: 0, gone: 0 }, 2)!.includes('and 1 more'),
  'a long list says how many it did not print');
ok(recipientLine({ named: ['A'], nameless: 0, gone: 2 })!.includes('since been removed'),
  'departed accounts are named beside the ones still here');
eq(recipientLine({ named: [], nameless: 0, gone: 0 }), null,
  'an empty recipient list says nothing here, so the caller can say why in its own words');

if (errors.length) {
  console.error(`gymBroadcastLog: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('gymBroadcastLog: all assertions passed');
