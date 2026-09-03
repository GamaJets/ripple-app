// One morning's work, and how many times it is allowed to buzz.
// Compile with tsc, run with node.
//
// The assertion this file exists for is the last block: a nightly pass that
// writes nine rows for one coach costs ONE banner and not nine, and every one
// of the nine is still a row. Everything above it is the promise that the
// common case — one row, one push — did not change on the way.
import {
  BODY_MAX, digestBody, digestKey, digestNote, digestPushes, digestSaving,
  type DigestRow,
} from './notifyDigest';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (over: Partial<DigestRow> = {}): DigestRow => ({
  channel: 'book',
  title: 'An invoice has gone past its date',
  body: 'Invoice 7 to Sam was due on 01 Sep 2026, which is 3 days ago.',
  route: '/(trainer)/invoices',
  ...over,
});

/* ── one row is the row ────────────────────────────────────────────────── */
//
// The case that must not change. Every booking, every payment, every review in
// the product is a single-row statement, and if this module altered any of them
// it would be a rewrite of the whole surface rather than a fix for the mornings
// that pile up.

const one = digestPushes([row()]);
eq(one.length, 1, 'one row is one push');
eq(one[0].title, 'An invoice has gone past its date', 'with the row’s own title');
eq(one[0].body, 'Invoice 7 to Sam was due on 01 Sep 2026, which is 3 days ago.',
  'and the row’s own body, byte for byte — no clause, no count, no change');
eq(one[0].route, '/(trainer)/invoices', 'and the row’s own route');
eq(one[0].stands_for, 1, 'standing for itself');

eq(digestPushes([]).length, 0, 'nothing claimed is nothing posted');

/* ── what is never counted ─────────────────────────────────────────────── */
//
// The dispatcher refuses both of these before it ever groups. They are refused
// here too, because a digest saying "and 4 more" over rows that would never
// have been sent is a count of things nobody was told.

eq(digestPushes([row({ body: '' })]).length, 0, 'a row with no body is not a push');
eq(digestPushes([row({ body: '   ' })]).length, 0, 'and neither is whitespace');
eq(digestPushes([row({ channel: '' })]).length, 0,
  'a row nobody has classified is not dispatched at all, so it cannot inflate a count either');
eq(digestPushes([row(), row({ body: '' })])[0].stands_for, 1,
  'a bodyless row beside a real one does not make the real one a digest');

/* ── two or more become one ────────────────────────────────────────────── */

const nine = Array.from({ length: 9 }, (_, i) => row({ body: `Invoice ${i + 1} to Sam was due.` }));
const digested = digestPushes(nine);
eq(digested.length, 1, 'nine invoices in one statement are one push');
eq(digested[0].stands_for, 9, 'and it says how many rows it stands for');
eq(digested[0].title, 'An invoice has gone past its date',
  'the title is one of the rows’ own, not a plural somebody composed');
ok(digested[0].body.startsWith('Invoice 1 to Sam was due.'),
  'and the body opens with that row’s words, unaltered');
ok(/8 more like this/.test(digested[0].body), 'then counts the rest');
ok(/All 9 are in your notifications list/.test(digested[0].body),
  'and says where every one of them is — the rows are written whatever this decides');

// The saving, as a figure rather than as prose.
const saving = digestSaving(nine);
eq(saving.before, 9, 'nine banners before');
eq(saving.after, 1, 'one after');

/* ── two is two, and it is not "and 2 more" ────────────────────────────── */
//
// Off-by-one in a count somebody reads on a lock screen. Two rows stand for
// two, and the clause counts the ones NOT shown.

const two = digestPushes([row({ body: 'A' }), row({ body: 'B' })]);
eq(two[0].stands_for, 2, 'two rows stand for two');
ok(/There is one more like this/.test(two[0].body), 'and the clause counts the one not shown');
ok(/Both are in your notifications list/.test(two[0].body), 'in the words two takes');
ok(!/2 more/.test(two[0].body), 'never "2 more" over two rows');

eq(digestNote(0), '', 'nothing more is no clause at all');
eq(digestNote(-3), '', 'and neither is a nonsense count');

/* ── a group is a channel AND a route ──────────────────────────────────── */
//
// A digest has one tap. Rows that do not agree about where they open have no
// honest single destination, so they are not one digest — the same rule
// `BookAlert.route` in src/lib/coachNotify.ts states from the other side.

const mixed = digestPushes([
  row(),
  row({ route: '/(trainer)/nudges', channel: 'book', title: 'A client is past their usual gap', body: 'Sam has not been in for 12 days.' }),
]);
eq(mixed.length, 2, 'two routes on one channel are two pushes, not one digest opening one of them');
eq(mixed[0].route, '/(trainer)/invoices', 'and each opens its own screen');
eq(mixed[1].route, '/(trainer)/nudges', 'including the second');

const twoChannels = digestPushes([
  row(),
  row({ channel: 'money', route: '/(trainer)/invoices', body: 'Something about money.' }),
]);
eq(twoChannels.length, 2, 'one route on two channels is two pushes — the switches are different');

eq(digestKey(row()), digestKey(row({ title: 'Anything else', body: 'Anything else' })),
  'title and body are not part of the key: grouping by them is what produced nine posts');
ok(digestKey(row()) !== digestKey(row({ route: '/(trainer)/nudges' })), 'the route is');

// Routeless rows still group. The dispatcher already sends `data: {}` for
// these, and three server-written kinds are routeless for stated reasons.
const routeless = digestPushes([row({ route: '' }), row({ route: '' })]);
eq(routeless.length, 1, 'two routeless rows on one channel are one digest');
eq(routeless[0].route, '', 'and it carries no route, exactly as one of them would have');

/* ── the clause is never what gets cut ─────────────────────────────────── */
//
// `notifications.body` is stored as `left(<body>, 500)` everywhere in the
// numbered parts. A digest built from a body already at that ceiling has to
// give the clause its room, because the count is the one part of a digest that
// is not in the row it was built from — losing it turns a digest back into a
// single notification with no way for the reader to tell.

const long = 'x'.repeat(BODY_MAX);
const cut = digestBody(long, 40);
ok(cut.length <= BODY_MAX, `a digest of a maximum-length body still fits in ${BODY_MAX}`);
ok(/40 more like this/.test(cut), 'and the count survived');
ok(cut.includes('...'), 'the body is what was shortened, and it says so');

eq(digestBody('Short.', 0), 'Short.', 'with nothing more to count, the body is the body');
ok(digestBody(long, 0).length <= BODY_MAX, 'and a single long body is still capped');

// A body that exactly fits with its clause is not cut.
const note = digestNote(3);
const snug = 'y'.repeat(BODY_MAX - note.length);
eq(digestBody(snug, 3), snug + note, 'a body that fits beside its clause is left alone');
ok(!digestBody(snug, 3).includes('...'), 'and is not marked as shortened');

/* ── the morning this was written for ──────────────────────────────────── */
//
// A coach who bills twenty clients on the first of the month has twenty
// invoices falling due on one day and therefore twenty crossing into the '1-7'
// band on one night. Part 613 writes them in a loop, one INSERT statement each,
// and part 900's trigger is `for each statement` — so today that is twenty
// posts to send-push and twenty banners inside a minute, which is the shape of
// morning that gets a coach's notifications turned off for good.

const firstOfTheMonth: DigestRow[] = Array.from({ length: 20 }, (_, i) => row({
  body: `Invoice ${i + 1} to a client was due on 01 Sep 2026, which is 1 day ago. You have not chased it yet.`,
}));
const after = digestSaving(firstOfTheMonth);
eq(after.before, 20, 'twenty invoices');
eq(after.after, 1, 'and one banner');
const post = digestPushes(firstOfTheMonth)[0];
eq(post.stands_for, 20, 'standing for all twenty');
eq(post.route, '/(trainer)/invoices', 'opening the screen that has every one of them');
ok(post.body.length <= BODY_MAX, 'inside what the column stores');
ok(/19 more like this/.test(post.body), 'and honest about the nineteen it is not showing');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`notifyDigest: ok — a pass that writes ${after.before} rows for one coach costs ${after.after} banner, and ${after.before} rows`);
