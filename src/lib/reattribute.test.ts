// The five this file exists to stop.
//
//   1. A REFUND LEFT BEHIND. `reversePayment` copies the member onto the
//      correction it writes, so a partly-refunded payment is two rows against
//      one person. Moving the positive one alone files a −40.00 against a
//      member who never paid it and leaves the +100.00 with the one who did.
//
//   2. A MOVE MADE OVER A READ THAT FAILED. The corrections are found in the
//      list on screen. A null list is not a payment with no corrections, and
//      treating it as one is defect 1 arriving by the other door.
//
//   3. A MEMBERSHIP LEFT POINTING AT SOMEBODY ELSE. `membership_id` is the one
//      hard link between a payment and what it was for, and a payment
//      attributed to one member while settling another's membership is a row
//      that contradicts itself in the register /accounting reconciles from.
//
//   4. A CORRECTION MOVED ON ITS OWN. It belongs to the payment it undoes.
//      Re-attributing it by itself is the same split as defect 1, made
//      deliberately.
//
//   5. A CONFIRMATION THAT UNDER-REPORTS. A refund quietly moving with its
//      payment is right, and it is still a change to a second row of somebody's
//      money. The sentence says how many rows moved.
//
// Compile with tsc, run with node.
import {
  reattributeBlocker, reattributeRows, reattributedNote,
} from './reattribute';
import type { GymPayment, Membership } from './gymRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const blocked = (why: string | null, msg: string) =>
  ok(why != null && why.trim().endsWith('.'), `${msg} — got ${JSON.stringify(why)}`);

const pay = (p: Partial<GymPayment> & { id: string }): GymPayment => ({
  memberId: null, memberName: null, amountCents: 10000, currency: 'GBP',
  method: 'card', takenAt: '2026-08-04T10:00:00.000Z', note: null,
  kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: null,
  ...p,
});

const held = (m: Partial<Membership> & { id: string; memberId: string }): Membership => ({
  memberName: null, planId: null, planName: null, status: 'active',
  startedOn: '2026-01-01', endsOn: null,
  ...m,
} as Membership);

/* ── 1. the ordinary correction: a payment against the wrong person ────── */
{
  const p = pay({ id: 'p1', memberId: 'wrong' });
  const all = [p];
  eq(reattributeBlocker(p, { memberId: 'right', membershipId: null }, all, []), null,
    'moving a payment from one member to another is allowed');
  eq(reattributeBlocker(p, { memberId: null, membershipId: null }, all, []), null,
    'and so is moving it to nobody, which is an honest gap rather than a false name');

  const un = pay({ id: 'p2', memberId: null });
  eq(reattributeBlocker(un, { memberId: 'right', membershipId: null }, [un], []), null,
    'an unattributed payment is the case this exists for');
}

/* ── 2. the corrections move with it ───────────────────────────────────── */
{
  const p = pay({ id: 'p1', memberId: 'wrong' });
  const refund = pay({ id: 'c1', memberId: 'wrong', kind: 'refund', amountCents: -4000, reversesPaymentId: 'p1' });
  const other = pay({ id: 'p9', memberId: 'somebody' });
  const otherRefund = pay({ id: 'c9', kind: 'refund', reversesPaymentId: 'p9' });

  eq(reattributeRows(p, [p, refund, other, otherRefund]).join(','), 'p1,c1',
    'the payment and its own corrections move, and nobody else’s');
  eq(reattributeRows(p, [p, refund])[0], 'p1',
    'the payment is first, so a partial write is legible in the order it was asked for');
  eq(reattributeRows(other, [p, refund, other]).join(','), 'p9',
    'a payment with no correction against it is one row');
}

/* ── 3. a read that failed is not a payment with no corrections ────────── */
{
  const p = pay({ id: 'p1', memberId: 'wrong' });
  blocked(reattributeBlocker(p, { memberId: 'right', membershipId: null }, null, []),
    'a null payment list refuses the move rather than assuming there is nothing to bring along');

  // The membership half, separately. "Not this member's membership" and "the
  // memberships did not load" are two different facts.
  blocked(reattributeBlocker(p, { memberId: 'right', membershipId: 'm1' }, [p], null),
    'a null membership list refuses a move that names a membership');
  eq(reattributeBlocker(p, { memberId: 'right', membershipId: null }, [p], null), null,
    'but it does not refuse a move that names none — there is nothing to check');
}

/* ── 4. the membership has to be the member's ──────────────────────────── */
{
  const p = pay({ id: 'p1', memberId: 'wrong' });
  const mine = held({ id: 'm1', memberId: 'right' });
  const theirs = held({ id: 'm2', memberId: 'somebody' });

  eq(reattributeBlocker(p, { memberId: 'right', membershipId: 'm1' }, [p], [mine, theirs]), null,
    'a membership held by the chosen member is fine');
  blocked(reattributeBlocker(p, { memberId: 'right', membershipId: 'm2' }, [p], [mine, theirs]),
    'a membership held by somebody else is refused');
  blocked(reattributeBlocker(p, { memberId: 'right', membershipId: 'm404' }, [p], [mine, theirs]),
    'a membership this screen never read is refused rather than assumed');
  blocked(reattributeBlocker(p, { memberId: null, membershipId: 'm1' }, [p], [mine]),
    'a payment cannot settle a membership and belong to nobody');
}

/* ── 5. a correction may not be moved on its own ───────────────────────── */
{
  const refund = pay({ id: 'c1', memberId: 'wrong', kind: 'refund', reversesPaymentId: 'p1' });
  const why = reattributeBlocker(refund, { memberId: 'right', membershipId: null }, [refund], []);
  blocked(why, 'a correction row is refused');
  ok(!!why && /payment/i.test(why), 'and the refusal says to move the payment instead');
}

/* ── 6. a write that would change nothing is refused, not announced ────── */
{
  const p = pay({ id: 'p1', memberId: 'right', membershipId: 'm1' });
  blocked(reattributeBlocker(p, { memberId: 'right', membershipId: 'm1' }, [p], [held({ id: 'm1', memberId: 'right' })]),
    're-attributing a payment to where it already is changes nothing and says so');

  const none = pay({ id: 'p2', memberId: null });
  blocked(reattributeBlocker(none, { memberId: null, membershipId: null }, [none], []),
    'and so does leaving an unattributed payment unattributed');

  // The empty string is what an unset <select> hands back, and it is the same
  // answer as null. Reading the two as different would make "leave it alone"
  // look like a change and write a row for nothing.
  blocked(reattributeBlocker(none, { memberId: '', membershipId: '' }, [none], []),
    'an empty option is nobody, not a new value');

  // Changing only the membership, with the member staying put, IS a change.
  const keep = pay({ id: 'p3', memberId: 'right', membershipId: null });
  eq(reattributeBlocker(keep, { memberId: 'right', membershipId: 'm1' }, [keep], [held({ id: 'm1', memberId: 'right' })]), null,
    'naming the membership on a payment already against the right member is a real change');
}

/* ── 7. the sentence says what actually moved ──────────────────────────── */
{
  ok(reattributedNote(1, 'Ada Green').includes('Ada Green'),
    'the confirmation names who the payment is now against');
  ok(!/correction/.test(reattributedNote(1, 'Ada Green')),
    'a payment with nothing against it does not mention corrections');
  ok(/2 corrections/.test(reattributedNote(3, 'Ada Green')),
    'and one with two mentions both of them');
  ok(/1 correction[^s]/.test(reattributedNote(2, 'Ada Green')),
    'singular for one');
  ok(/nobody/.test(reattributedNote(1, null)),
    'a payment moved to nobody says so rather than leaving a gap in the sentence');
  for (const n of [1, 2, 3]) {
    ok(reattributedNote(n, null).trim().endsWith('.'), 'every confirmation is a sentence');
    ok(!/\s{2}/.test(reattributedNote(n, 'Ada Green')), 'with no hole in it');
  }
}

if (errors.length) { for (const e of errors) console.error('FAIL ' + e); process.exit(1); }
console.log('reattribute: ok');
