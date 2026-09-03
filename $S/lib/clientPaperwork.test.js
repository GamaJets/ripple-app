"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Whether one named person has signed the coach's paperwork.
//
// What is defended here is the sentence "they are covered", which is a legal
// claim and not a figure. Every assertion below is about a way that sentence
// could be produced by an accident: a read that failed, a read that stopped at
// its row limit, a withdrawn document, or a document that was never in front of
// this person at all.
const clientPaperwork_1 = require("./clientPaperwork");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ZOE = 'client-zoe';
const SAM = 'client-sam';
const doc = (o) => ({ title: o.id, required: true, retired: false, createdAt: '2026-01-01T00:00:00Z', ...o });
const WAIVER = doc({ id: 'waiver', title: 'Studio waiver', createdAt: '2026-03-01T00:00:00Z' });
const TERMS = doc({ id: 'terms', title: 'Training agreement', createdAt: '2026-02-01T00:00:00Z' });
/* ── the ordinary answer ────────────────────────────────────────────────── */
{
    const items = (0, clientPaperwork_1.paperworkFor)({
        docs: [WAIVER, TERMS],
        recipients: [],
        acceptances: [{ documentId: 'terms', acceptedAt: '2026-04-01T09:00:00Z' }],
        clientId: ZOE,
    });
    eq(items.length, 2, 'both open documents are this client’s');
    eq(items[0]?.id, 'waiver', 'what is owed comes first — that is what the coach is standing there to find out');
    eq(items[1]?.acceptedAt, '2026-04-01T09:00:00Z', 'and what was signed carries the day it was signed');
    eq((0, clientPaperwork_1.unsignedCount)(items), 1, 'one outstanding');
    eq((0, clientPaperwork_1.paperworkLine)('ready', items, 'Zoe'), 'Zoe has NOT accepted 1 of the 2 documents you require.', 'and the sentence names the person and both numbers');
    eq((0, clientPaperwork_1.paperworkOutstanding)('ready', items), true, 'which is worth flagging');
}
/* ── a withdrawn document is not a debt ─────────────────────────────────── */
{
    const items = (0, clientPaperwork_1.paperworkFor)({
        docs: [doc({ id: 'old', retired: true }), WAIVER],
        recipients: [],
        acceptances: [{ documentId: 'waiver', acceptedAt: '2026-04-01T09:00:00Z' }],
        clientId: ZOE,
    });
    eq(items.length, 1, 'a retired document is not chased');
    eq((0, clientPaperwork_1.paperworkLine)('ready', items, 'Zoe'), 'Zoe has accepted the one document you require.', 'so this client is not permanently flagged for a waiver nobody uses any more');
    eq((0, clientPaperwork_1.paperworkOutstanding)('ready', items), false, 'and nothing is flagged');
}
/* ── an optional document is not a debt either ──────────────────────────── */
{
    const items = (0, clientPaperwork_1.paperworkFor)({
        docs: [doc({ id: 'reading', required: false })],
        recipients: [], acceptances: [], clientId: ZOE,
    });
    eq(items.length, 0, 'a document that does not have to be signed is not listed as unsigned');
}
/* ── a document that was never in front of them ─────────────────────────── */
//
// The mistake a naive join makes first, and the worst one available here: it
// tells a coach that a real person has not signed something they were never
// shown.
{
    const sent = (0, clientPaperwork_1.paperworkFor)({
        docs: [WAIVER, TERMS],
        // The waiver has been ADDRESSED — to Sam, and to nobody else.
        recipients: [{ documentId: 'waiver', clientId: SAM }],
        acceptances: [],
        clientId: ZOE,
    });
    eq(sent.length, 1, 'an addressed document is not Zoe’s to sign');
    eq(sent[0]?.id, 'terms', 'only the open one is');
    ok(!(0, clientPaperwork_1.paperworkLine)('ready', sent, 'Zoe').includes('2 documents'), 'and it is not counted against her');
    const his = (0, clientPaperwork_1.paperworkFor)({
        docs: [WAIVER, TERMS],
        recipients: [{ documentId: 'waiver', clientId: SAM }],
        acceptances: [],
        clientId: SAM,
    });
    eq(his.length, 2, 'the person it WAS sent to owes both');
}
/* ── the three reads that are not an answer ─────────────────────────────── */
//
// Each of these arrives with an empty list, which is exactly what "everything
// is signed" also looks like.
const NONE = [];
{
    const loading = (0, clientPaperwork_1.paperworkLine)('loading', NONE, 'Zoe');
    ok(/reading/i.test(loading), 'a read in flight says so');
    ok(!/accepted|no paperwork/i.test(loading), 'and states nothing about the paperwork');
    const failed = (0, clientPaperwork_1.paperworkLine)('error', NONE, 'Zoe');
    ok(/could not be read/i.test(failed), 'a failed read says so');
    ok(/not a record of them having signed nothing/i.test(failed), 'and refuses the reading a coach would otherwise take from an empty list');
    eq((0, clientPaperwork_1.paperworkOutstanding)('error', NONE), false, 'a failed read is not a warning either — a red flag over an unknown is the same lie as a green one');
    const part = (0, clientPaperwork_1.paperworkLine)('partial', NONE, 'Zoe');
    ok(/more paperwork than this could bring back/i.test(part), 'a truncated read says what happened');
    ok(!/has accepted|no paperwork that has to be signed/i.test(part), 'and makes no claim over it');
    eq((0, clientPaperwork_1.paperworkOutstanding)('partial', [{ id: 'a', title: 'a', acceptedAt: null }]), false, 'nothing is flagged from a part of a set either');
}
// A truncated read that happens to contain an unsigned document still may not
// be counted, because the count is over an unknown fraction.
ok(!(0, clientPaperwork_1.paperworkLine)('partial', [{ id: 'a', title: 'a', acceptedAt: null }], 'Zoe').includes('1 of the 1'), 'a partial read never states a total');
/* ── a coach who requires nothing ───────────────────────────────────────── */
{
    const line = (0, clientPaperwork_1.paperworkLine)('ready', NONE, 'Zoe');
    ok(/no paperwork that has to be signed/i.test(line), 'says the coach requires none');
    ok(!/Zoe/.test(line), 'and does not make it a statement about the client');
}
/* ── the per-document line ──────────────────────────────────────────────── */
const day = (iso) => iso.slice(0, 10);
eq((0, clientPaperwork_1.paperworkItemLine)({ id: 'a', title: 'a', acceptedAt: '2026-04-01T09:00:00Z' }, day), 'Accepted 2026-04-01', 'a signed document carries the date');
eq((0, clientPaperwork_1.paperworkItemLine)({ id: 'a', title: 'a', acceptedAt: null }, day), 'Not accepted', 'and an unsigned one says so plainly');
/* ── nothing renders as a gap ───────────────────────────────────────────── */
for (const read of ['loading', 'ready', 'partial', 'error']) {
    for (const items of [NONE, [{ id: 'a', title: 'a', acceptedAt: null }], [{ id: 'a', title: 'a', acceptedAt: '2026-04-01T09:00:00Z' }]]) {
        const line = (0, clientPaperwork_1.paperworkLine)(read, items, 'this client');
        ok(line.length > 0 && !line.includes('undefined') && !line.includes('null'), `${read} with ${items.length} item(s) is a real sentence`);
    }
}
if (errors.length) {
    console.error(`clientPaperwork.test.ts — ${errors.length} failure(s):`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('clientPaperwork.test.ts — ok: “they are covered” cannot be produced by a failed, partial or naive read');
