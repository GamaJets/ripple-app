// Session packs: the balance a client is shown, and whether a credit moved.
// Compile with tsc, run with node.
//
// Five things are defended here, and every one of them is a sentence that would
// look entirely ordinary on the packages screen while being false about
// somebody's money:
//
// 1. A HISTORY THAT WAS NOT READ IS NOT A BALANCE OF ZERO. `packBalance(null)`
//    gives `left: null`. It gave `0` in three earlier functions in this
//    codebase — `fetchMyPurchases`, `sessionsRemaining`, `redeemSession` — and
//    each was fixed by hand after "0 sessions left" reached a client holding
//    ten. `0` is a figure a screen prints; `null` is a dash.
//
// 2. ZERO ROWS BACK FROM THE WRITE IS NOT A SUCCESSFUL WRITE. Proven against
//    the live database: as the signed-in client, an UPDATE that matched nothing
//    came back `error: null`. `readDraw([])` is therefore 'unknown', not
//    'drawn' and not 'no_pack' — the app says "we could not tell", which is the
//    only honest thing it knows.
//
// 3. AN OUTCOME WORD THIS BUILD DOES NOT KNOW IS ALSO 'unknown'. The database
//    can be migrated ahead of an app in the field. A word from a newer schema
//    must not fall through into the success branch.
//
// 4. A MEMBERSHIP IS NOT A PACK WITH NOTHING LEFT. It has no credits at all, so
//    it contributes no line and no zero. "Used up" beside a membership is the
//    sentence that has a client buying a second one.
//
// 5. CREDITS ARE SPENT OLDEST FIRST, AND THE SCREEN SAYS SO IN THAT ORDER.
//    `redeem_pack_session` (supabase/parts/123) draws from the oldest pack with
//    room; a screen listing them newest-first would point at the wrong pack as
//    the one the next booking comes off.
//
// No formatted date is asserted against a literal — `npm test` runs three times
// under three timezones (`test:zones`) — and every date here is an explicit
// ISO instant.
import {
  packBalance, packLabel, readDraw, drew, drawReason,
  type PackPurchase, type Draw,
} from './packDraw';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const P = (over: Partial<PackPurchase>): PackPurchase => ({
  id: 'p1', package_id: 'k1', sessions_total: 10, sessions_used: 0,
  status: 'paid', created_at: '2026-01-01T00:00:00.000Z', ...over,
});

/* ── 1. unread is not empty, and empty is not unread ──────────────────────── */

// The whole reason this returns a nullable number. A screen may print a 0; it
// must render a null as a dash and say the read failed.
eq(packBalance(null).left, null, 'a purchase history that could not be read has an UNKNOWN balance, not a zero');
eq(packBalance(undefined).left, null, 'and so does one that never arrived at all');
eq(packBalance(null).lines.length, 0, 'an unread history lists no packs');
eq(packBalance(null).live, 0, 'and counts none as live — there is nothing to count');
eq(packBalance(null).exhausted, 0, 'and none as used up, which would be a claim about packs nobody read');
eq(packBalance([]).left, 0, 'somebody who has bought nothing genuinely has nothing — that zero is real and printable');
eq(packBalance([]).lines.length, 0, 'and lists no packs either');

// The two above are the same shape and opposite sentences. Nothing else in this
// file matters if a caller cannot tell them apart.
ok(packBalance(null).left !== packBalance([]).left, 'the unread balance and the empty balance must not be the same value');

/* ── 2. what the balance actually counts ──────────────────────────────────── */

const held = packBalance([
  P({ id: 'a', sessions_total: 10, sessions_used: 3 }),
  P({ id: 'b', sessions_total: 5, sessions_used: 5 }),
]);
eq(held.left, 7, 'seven left across a ten-pack with three gone and a five-pack with nothing');
eq(held.live, 1, 'one pack still has something on it');
eq(held.exhausted, 1, 'and one is used up');

// A membership has no credits. Counting it as a pack with zero left would put
// "used up" beside a thing that was never a countdown.
const withMembership = packBalance([
  P({ id: 'a', sessions_total: 10, sessions_used: 2 }),
  P({ id: 'm', sessions_total: null }),
]);
eq(withMembership.lines.length, 1, 'a membership is not a session pack and gets no pack line');
eq(withMembership.left, 8, 'and contributes nothing to the balance');
eq(withMembership.exhausted, 0, 'and is never counted as used up');

// A checkout that never completed has not been paid for.
eq(packBalance([P({ status: 'pending' })]).lines.length, 0, 'an unpaid purchase is not a pack the client is holding');
eq(packBalance([P({ status: 'pending' })]).left, 0, 'and grants no credits');

// Defence in depth for rows written before part 123's constraint existed.
eq(packBalance([P({ sessions_total: 10, sessions_used: 14 })]).left, 0, 'an overdrawn row reads as nothing left, never as a negative balance');
eq(packBalance([P({ sessions_total: 10, sessions_used: -4 })]).left, 10, 'and a negative usage never grants more than the pack holds');
eq(packBalance([P({ sessions_total: 10, sessions_used: Number.NaN })]).left, 10,
  'a usage that is not a number is treated as none used — a pack we cannot read the usage of is not a pack we may quietly spend one off');

/* ── 5. spent oldest first, listed oldest first ───────────────────────────── */

const ordered = packBalance([
  P({ id: 'new', created_at: '2026-08-01T00:00:00.000Z' }),
  P({ id: 'old', created_at: '2026-02-01T00:00:00.000Z' }),
  P({ id: 'mid', created_at: '2026-05-01T00:00:00.000Z' }),
]);
eq(ordered.lines.map((l) => l.id).join(','), 'old,mid,new',
  'packs list oldest first, the order redeem_pack_session actually spends them in');

// A pack somebody paid for whose date is unreadable still holds credits.
const undated = packBalance([
  P({ id: 'good', created_at: '2026-02-01T00:00:00.000Z' }),
  P({ id: 'bad', created_at: 'not a date' }),
]);
eq(undated.lines.length, 2, 'a pack with an unparseable date is not dropped — its credits are real');
eq(undated.lines[1].id, 'bad', 'it sorts last rather than jumping to the front of the queue');
eq(undated.left, 20, 'and it is counted');

// Two of them. Neither can be ordered against the other, and neither may be
// dropped for it.
const bothUndated = packBalance([
  P({ id: 'x', created_at: 'not a date' }),
  P({ id: 'y', created_at: '' }),
]);
eq(bothUndated.lines.length, 2, 'two undated packs are both kept');
eq(bothUndated.lines.map((l) => l.id).join(','), 'x,y', 'and keep the order they arrived in rather than being shuffled');

/* ── labels: described, never invented ────────────────────────────────────── */

// pkg_read is `active or trainer_id = auth.uid()`, so a client cannot read a
// package their coach has withdrawn — including one they bought.
eq(packLabel(10, 'Kickstart Ten').label, 'Kickstart Ten', 'a readable package is called what the coach called it');
ok(packLabel(10, 'Kickstart Ten').named, 'and is marked as a real name');
eq(packLabel(10, null).label, '10-session pack', 'an unreadable one is described by its size, not given a name we made up');
ok(!packLabel(10, null).named, 'and is marked as not a real name');
eq(packLabel(10, '   ').label, '10-session pack', 'a blank name is no name');
eq(packLabel(null, null).label, 'Membership', 'a thing with no session count is a membership');
eq(packLabel(Number.NaN, null).label, 'Membership', 'and so is one whose session count is not a number — "NaN-session pack" is not a label');

const names = new Map<string, string | null>([['k1', 'Kickstart Ten']]);
eq(packBalance([P({ package_id: 'k1' })], names).lines[0].label, 'Kickstart Ten', 'the balance uses the name when it has one');
eq(packBalance([P({ package_id: 'gone' })], names).lines[0].label, '10-session pack', 'and describes the pack when the package is unreadable');
eq(packBalance([P({ package_id: 'k1' })]).lines[0].label, '10-session pack', 'no name map at all is the same as an unreadable package');

/* ── 2 & 3. the row count, which is the whole point ───────────────────────── */

// PostgREST resolves a zero-row write with error null. This is the assertion
// that stands between that and the app saying a credit came off.
eq(readDraw([]).outcome, 'unknown', 'no row back is NOT a successful redemption');
eq(readDraw(null).outcome, 'unknown', 'and neither is no answer at all');
eq(readDraw(undefined).outcome, 'unknown', 'nor an undefined one');
eq(readDraw([{ outcome: 'drawn' }, { outcome: 'drawn' }]).outcome, 'unknown',
  'two rows is not a contract this function produces, and no winner is picked from them');
ok(!drew(readDraw([])), 'nothing moved, so nothing may be reported as moving');

// 'unknown' must never collapse into 'no_pack'. One says we could not tell; the
// other says the client never bought anything — and the booking screen stays
// SILENT for no_pack, which would bury the failure completely.
ok(readDraw([]).outcome !== 'no_pack', 'we-could-not-tell is not the same answer as you-never-had-one');
ok(drawReason(readDraw([])) !== undefined, 'and it is said out loud rather than passed over in silence');

// A database migrated ahead of a build in the field.
eq(readDraw([{ outcome: 'partially_drawn', sessions_left: 4 }]).outcome, 'unknown',
  'an outcome word this build has never heard of is not believed');
eq(readDraw([{ outcome: 'partially_drawn', sessions_left: 4 }]).remaining, null,
  'and no figure is taken off a row whose outcome was not understood');

const drawn = readDraw([{ outcome: 'drawn', purchase_id: 'p9', sessions_left: 6, pack_total: 10 }]);
eq(drawn.outcome, 'drawn', 'one row naming a known outcome is believed');
eq(drawn.remaining, 6, 'and the balance is the one the database returned');
eq(drawn.total, 10, 'along with the size of the pack it came off');
eq(drawn.purchaseId, 'p9', 'and which pack that was');
ok(drew(drawn), 'a credit moved');

const returned = readDraw([{ outcome: 'returned', purchase_id: 'p9', sessions_left: 7, pack_total: 10 }]);
ok(drew(returned), 'a refund moves a credit too');
eq(returned.remaining, 7, 'and reports the balance after it went back');

// The three outcomes where nothing moved and nothing was wrong.
ok(!drew(readDraw([{ outcome: 'no_pack' }])), 'a client with no pack had no credit to spend');
ok(!drew(readDraw([{ outcome: 'exhausted', sessions_left: 0 }])), 'an exhausted pack spends nothing');
ok(!drew(readDraw([{ outcome: 'nothing_to_return' }])), 'an untouched pack has nothing to give back');
eq(readDraw([{ outcome: 'exhausted', sessions_left: 0 }]).remaining, 0, 'exhausted reports a real zero, because it was read');

// A figure that is not a number is not a figure.
eq(readDraw([{ outcome: 'drawn', sessions_left: '6' }]).remaining, null, 'a string is not a balance');
eq(readDraw([{ outcome: 'drawn', sessions_left: null }]).remaining, null, 'and neither is a null');

/* ── the clause the booking screen puts in parentheses ────────────────────── */

// A pay-per-session client must not be handed an explanation about a pack they
// never bought.
eq(drawReason(readDraw([{ outcome: 'no_pack' }])), undefined, 'somebody with no pack is told nothing — nothing was supposed to happen');
eq(drawReason(readDraw([{ outcome: 'drawn', sessions_left: 6 }])), undefined, 'a successful redemption needs no explanation at all');
eq(drawReason(readDraw([{ outcome: 'returned', sessions_left: 7 }])), undefined, 'and neither does a successful refund');

ok((drawReason(readDraw([{ outcome: 'exhausted', sessions_left: 0 }])) || '').length > 0,
  'a client whose pack is used up IS told why, because their next session is not covered');
ok((drawReason(readDraw([{ outcome: 'nothing_to_return' }])) || '').length > 0,
  'and so is one whose cancellation returned nothing, so they do not go looking for a credit that is not there');
ok((drawReason({ outcome: 'unknown', remaining: null, purchaseId: null, total: null } as Draw) || '').includes('could not'),
  'an unknown outcome says we could not confirm it — never that they have none left');

// The clause is dropped into "…your session pack (HERE) — check your package…",
// so it must not arrive with a capital or a full stop of its own.
for (const o of ['exhausted', 'nothing_to_return', 'unknown'] as const) {
  const s = drawReason({ outcome: o, remaining: null, purchaseId: null, total: null } as Draw) as string;
  ok(s === s.replace(/\.$/, ''), `the ${o} clause carries no full stop — the sentence around it continues`);
  ok(s[0] === s[0].toLowerCase(), `the ${o} clause starts lower-case — it is a parenthetical, not a sentence`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('packDraw: ok (unread balance is null, zero rows is not a redemption, oldest pack spends first)');
