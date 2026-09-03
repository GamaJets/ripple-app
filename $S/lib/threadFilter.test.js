"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for threadFilter — finding one conversation, or the queue of people
// waiting on a reply, among forty threads.
//
// The defect these exist for: app/(trainer)/messages.tsx had no query field and
// no unread filter, on the screen whose own header says it was built because "a
// coach with twenty clients had no way to see who had written to them". The
// roster next door already draws "3 unread" on its rows, so the app computed
// the answer and would not let the coach filter to it.
//
// The load-bearing assertions here are all about the NULL. `CoachThread.unread`
// is `number | null` on purpose — null means the count did not come back, and
// coachThreads.ts refuses to collapse it into zero because "zero is a claim
// that nobody is waiting, made on the one screen whose entire job is to say who
// is". A filter written `(t.unread ?? 0) > 0` would take that null and drop the
// row, which is strictly worse than having no filter: before, the client was on
// screen wearing a dash; after, they are not on screen at all.
//
// Compile with tsc then run with node, like rosterSearch.test.ts.
const threadFilter_1 = require("./threadFilter");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ALL = ['loading', 'ready', 'partial', 'error'];
const thread = (o) => ({
    name: 'Someone', avatar: null, lastBody: 'hello', lastSender: 'client',
    lastKind: null, lastAt: '2026-08-01T09:00:00.000Z', unread: 0, ...o,
});
const sarah = thread({ clientId: 'a', name: 'Sarah Jones', unread: 3 });
const jose = thread({ clientId: 'b', name: 'José Álvarez', unread: 0 });
const oneill = thread({ clientId: 'c', name: 'Ana O’Neill', unread: null });
const withheld = thread({ clientId: 'd', name: null, unread: 0 });
const BOOK = [sarah, jose, oneill, withheld];
/* ── the filter is not a filter until somebody uses it ────────────────────── */
ok(!(0, threadFilter_1.threadFilterActive)(threadFilter_1.NO_THREAD_FILTER), 'the starting state narrows nothing');
ok(!(0, threadFilter_1.threadFilterActive)({ mode: 'all', query: '   ' }), 'whitespace is not a query');
ok((0, threadFilter_1.threadFilterActive)({ mode: 'unread', query: '' }), 'the chip alone is a filter');
ok((0, threadFilter_1.threadFilterActive)({ mode: 'all', query: 'sar' }), 'and so is the field alone');
eq((0, threadFilter_1.filterThreads)(BOOK, threadFilter_1.NO_THREAD_FILTER).length, BOOK.length, 'and an inactive filter returns the whole list');
/* ── THE NULL ─────────────────────────────────────────────────────────────── */
ok((0, threadFilter_1.keptWhenUnread)(sarah), 'a positive count is kept — somebody is waiting');
ok(!(0, threadFilter_1.keptWhenUnread)(jose), 'a zero that actually came back is dropped');
ok((0, threadFilter_1.keptWhenUnread)(oneill), 'AND A COUNT THAT DID NOT COME BACK IS KEPT');
{
    const shown = (0, threadFilter_1.filterThreads)(BOOK, { mode: 'unread', query: '' });
    const ids = shown.map((t) => t.clientId);
    ok(ids.includes('a'), 'the unread chip lists the client with three unopened messages');
    ok(!ids.includes('b'), 'and not the one whose count came back as zero');
    ok(ids.includes('c'), 'and it lists the client whose count could not be read, because hiding them answers for them');
    ok(!ids.includes('d'), 'a row with a read zero is dropped whatever else is missing from it');
}
eq((0, threadFilter_1.unknownUnread)(BOOK), 1, 'one row in the book has no readable unread count');
eq((0, threadFilter_1.knownUnread)(BOOK), 1, 'and one has a count that came back above zero');
ok((0, threadFilter_1.unknownUnread)(BOOK) + (0, threadFilter_1.knownUnread)(BOOK) < BOOK.length, 'the two are not complements — a read zero is in neither, which is the whole point');
/* ── the chip label never prints a confident zero ─────────────────────────── */
eq((0, threadFilter_1.unreadChipLabel)(4, false), 'Unread · 4', 'a whole count is shown on the chip');
eq((0, threadFilter_1.unreadChipLabel)(0, false), 'Unread', 'and a zero is not — the chip says what it does, not "0"');
eq((0, threadFilter_1.unreadChipLabel)(4, true), 'Unread', 'and no figure at all is offered while any count is unknown, because 4 would be a claim');
/* ── searching by name, through the roster matcher ────────────────────────── */
{
    const hit = (0, threadFilter_1.filterThreads)(BOOK, { mode: 'all', query: 'jones sarah' });
    eq(hit.length, 1, 'terms out of order still find the name');
    eq(hit[0].clientId, 'a', 'and it is the right person');
}
eq((0, threadFilter_1.filterThreads)(BOOK, { mode: 'all', query: 'jose' })[0]?.clientId, 'b', 'an unaccented query finds an accented name, the same as it does on the roster');
eq((0, threadFilter_1.filterThreads)(BOOK, { mode: 'all', query: 'oneill' })[0]?.clientId, 'c', 'and an apostrophe nobody types is folded away');
ok(!(0, threadFilter_1.filterThreads)(BOOK, { mode: 'all', query: 'sarah' }).some((t) => t.name === null), 'a thread with no readable name cannot match a name query');
eq((0, threadFilter_1.withheldNames)(BOOK), 1, 'and the screen is told how many rows are in that position');
/* ── the two controls compose ─────────────────────────────────────────────── */
{
    const both = (0, threadFilter_1.filterThreads)(BOOK, { mode: 'unread', query: 'sarah' });
    eq(both.length, 1, 'the chip and the field narrow together rather than replacing each other');
    eq(both[0].clientId, 'a', 'and the survivor answers both');
}
/* ── the order is never touched ───────────────────────────────────────────── */
{
    // `sortThreads` puts these newest-first and deliberately NOT unread-first;
    // a filter that re-ranked would move a row under the coach's thumb.
    const ordered = [oneill, sarah, jose];
    const out = (0, threadFilter_1.filterThreads)(ordered, { mode: 'unread', query: '' });
    eq(out.map((t) => t.clientId).join(''), 'ca', 'the caller’s order survives the filter');
}
/* ── what the sentence may and may not say ────────────────────────────────── */
const line = (o) => (0, threadFilter_1.threadFilterLine)({ matched: 0, searched: 0, unknown: 0, withheld: 0, ...o });
for (const status of ALL) {
    eq(line({ status, filter: threadFilter_1.NO_THREAD_FILTER }), null, `a list nobody has narrowed owes no explanation (${status})`);
}
{
    // Only 'ready' may say a person is not there.
    const say = (status) => line({ status, filter: { mode: 'all', query: 'sarah' }, matched: 0, searched: 9 });
    ok(/does not mean they are not on your book/.test(say('error') ?? ''), 'a failed read says the absence is not a fact about the coach’s book');
    ok(!/Nobody on your book matches/.test(say('error') ?? ''), 'and never states the absence itself');
    ok(!/Nobody on your book matches/.test(say('loading') ?? ''), 'a read still in flight may not state an absence either');
    ok(!/Nobody on your book matches/.test(say('partial') ?? ''), 'nor may a read that came back short');
    ok(/Nobody on your book matches “sarah”/.test(say('ready') ?? ''), 'and only a whole read says nobody matches');
}
ok(/9 threads that arrived/.test(line({ status: 'partial', filter: { mode: 'unread', query: '' }, matched: 2, searched: 9 }) ?? ''), 'a short read names how many rows the filter actually ran over');
ok(/1 thread that arrived/.test(line({ status: 'partial', filter: { mode: 'unread', query: '' }, matched: 1, searched: 1 }) ?? ''), 'and says "1 thread", not "1 threads"');
{
    // The rows on screen for a reason that is not a match.
    const one = line({ status: 'ready', filter: { mode: 'unread', query: '' }, matched: 3, unknown: 1 }) ?? '';
    ok(/One of these is listed because its unread count could not be read/.test(one), 'a kept-because-unknown row is explained rather than passed off as unread');
    const many = line({ status: 'ready', filter: { mode: 'unread', query: '' }, matched: 5, unknown: 2 }) ?? '';
    ok(/2 of these are listed/.test(many), 'and the plural agrees');
    eq(line({ status: 'ready', filter: { mode: 'all', query: 'sar' }, matched: 3, unknown: 2 }), null, 'while under the name field alone an unknown count explains nothing and is not mentioned');
}
{
    const s = line({ status: 'ready', filter: { mode: 'all', query: 'sar' }, matched: 2, withheld: 1 }) ?? '';
    ok(/One more thread could not be searched/.test(s), 'a row whose name never came back is spoken about rather than silently absent');
    eq(line({ status: 'ready', filter: { mode: 'unread', query: '' }, matched: 2, withheld: 3 }), null, 'and it is only said where somebody typed a name, since that is the only thing it could have matched');
}
{
    const empty = line({ status: 'ready', filter: { mode: 'unread', query: '' }, matched: 0 }) ?? '';
    ok(/Every message your clients have sent you has been opened/.test(empty), 'an empty unread queue is good news said as good news');
    ok(!/Nobody on your book/.test(empty), 'and is not confused with nobody matching a name');
    const both = line({ status: 'ready', filter: { mode: 'unread', query: 'ana' }, matched: 0 }) ?? '';
    ok(/Nobody matching “ana” has an unopened message/.test(both), 'and the two together get their own sentence, about the intersection');
}
if (errors.length) {
    console.error(`threadFilter.test: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('threadFilter.test: all good');
