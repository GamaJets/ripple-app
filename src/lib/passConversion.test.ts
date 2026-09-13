// Tests for the pass report behind studio-web/app/passes.
//
// Two subjects, and both of them are about a CLOCK and a REFUSAL:
//
//   · `expiringPasses` — the credits a member has paid for and is about to
//     lose. Every assertion below is a refusal: credits are never summed across
//     what they buy, a pass with no expiry is not "about to run out", a pass
//     whose last day cannot be read is a third fact rather than a safe one, and
//     a walk-in with no account is counted and never listed as a person.
//
//   · `buildPassConversion`'s `today`. Which calendar day this page is judged
//     against decides whether a holder is UNDECIDED or on the call list, and
//     therefore both the numerator and the denominator of the figure at the top
//     of the screen. The day has to come from the caller — the gym's — and the
//     assertions here are what stops the default quietly becoming the answer
//     again.
//
// Compile with tsc, run with node.
import {
  expiringPasses, expiringExclusions, EXPIRY_HORIZON_DAYS,
  buildPassConversion,
} from './passConversion';
import { sliceReady, sliceFailed } from './memberView';
import type { GymPass } from './gymPasses';
import type { Membership } from './gymRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

let n = 0;
function pass(over: Partial<GymPass> = {}): GymPass {
  n += 1;
  return {
    id: `p${n}`, passTypeId: 't1', passTypeName: 'Ten pack', kind: 'pack', covers: 'visit',
    holderId: 'u1', holderName: 'Sara Okafor', hostMemberId: null,
    issuedOn: '2026-07-01', expiresOn: '2026-09-20',
    usesTotal: 10, usesSpent: 2, paidCents: 50000, currency: 'AED', note: null,
    ...over,
  };
}

const TODAY = '2026-09-13';

/* ── the list itself ──────────────────────────────────────────────────────── */
{
  const x = expiringPasses([
    pass({ id: 'a', expiresOn: '2026-09-20' }),                    // 7 days
    pass({ id: 'b', expiresOn: '2026-09-14' }),                    // 1 day
    pass({ id: 'c', expiresOn: '2026-12-01' }),                    // outside
  ], TODAY);

  eq(x.soon.length, 2, 'only the passes inside the horizon are listed');
  eq(x.soon[0].passId, 'b', 'soonest first — that is the order the desk rings in');
  eq(x.soon[0].daysLeft, 1, 'one day out is one day, counted on plain dates');
  eq(x.soon[1].daysLeft, 7, 'and seven is seven');
  eq(x.people, 1, 'two passes held by one person is ONE phone call, not two');
  eq(x.withinDays, EXPIRY_HORIZON_DAYS, 'the horizon is reported with the answer');
}

/* ── a pass with nothing left on it has nothing to lose ───────────────────── */
{
  const x = expiringPasses([pass({ usesSpent: 10, expiresOn: '2026-09-14' })], TODAY);
  eq(x.soon.length, 0, 'a spent pass is a pass that did its job, not a loss coming');
  eq(x.neverExpire, 0, 'and it is not counted anywhere else either');
}

/* ── a pass that has already gone is a different conversation ─────────────── */
{
  const x = expiringPasses([pass({ expiresOn: '2026-09-12' })], TODAY);
  eq(x.soon.length, 0, 'yesterday is not "about to"');
  eq(x.unreadableExpiry, 0, 'and an expired pass is not an unreadable one');

  // The boundary: a pass whose last day IS today is still spendable today.
  const live = expiringPasses([pass({ expiresOn: TODAY })], TODAY);
  eq(live.soon.length, 1, 'a pass expires at the END of its last day, so today still counts');
  eq(live.soon[0].daysLeft, 0, 'nought days left, which the screen prints as "today"');
}

/* ── no expiry and an unreadable expiry are DIFFERENT FACTS ───────────────── */
{
  const x = expiringPasses([
    pass({ id: 'none', expiresOn: null }),
    pass({ id: 'junk', expiresOn: 'when the pack runs out' }),
  ], TODAY);

  eq(x.soon.length, 0, 'neither is in a list headed "about to run out"');
  eq(x.neverExpire, 1, 'a pass with no expiry is a DECISION the gym made');
  eq(x.unreadableExpiry, 1,
    'and a last day nobody can read is a broken record — never folded into the first, '
    + 'because one of them means nothing runs out and the other means we cannot tell');

  const said = expiringExclusions(x) ?? '';
  ok(/decision the gym made/.test(said), 'the sentence says which of the two the first one is');
  ok(/UNKNOWN rather than no/.test(said), 'and refuses to call the second one safe');
}

/* ── a walk-in is counted and never listed as a person ────────────────────── */
{
  const x = expiringPasses([
    pass({ id: 'anon', holderId: null, holderName: null, expiresOn: '2026-09-15' }),
    pass({ id: 'named', expiresOn: '2026-09-15' }),
  ], TODAY);

  eq(x.soon.length, 1, 'only the pass with an account behind it is a row');
  eq(x.anonymous, 1, 'the walk-in is counted');
  eq(x.people, 1, 'and is NOT a person in the count — two anonymous passes may be one person twice');
  ok(/walk-in/.test(expiringExclusions(x) ?? ''), 'and the sentence says so out loud');
}

/* ── credits are never added across what they buy ─────────────────────────── */
{
  const x = expiringPasses([
    pass({ id: 'door', covers: 'visit', usesTotal: 10, usesSpent: 2, expiresOn: '2026-09-15' }),
    pass({ id: 'pt', covers: 'pt', usesTotal: 4, usesSpent: 1, expiresOn: '2026-09-15' }),
  ], TODAY);

  eq(x.soon.length, 2, 'both are at risk');
  ok(!Object.keys(x).some((k) => /credit/i.test(k)),
    'and there is no credit TOTAL on the answer at all: eight door visits and three hours with '
    + 'a coach are not eleven of anything, which is the split MemberDossier already draws');
  eq(x.soon.find((p) => p.passId === 'door')!.covers, 'visit', 'each row says what its credits buy');
  eq(x.soon.find((p) => p.passId === 'pt')!.covers, 'pt', 'including the one that buys an hour');
}

/* ── nothing counted out means nothing said ───────────────────────────────── */
{
  const x = expiringPasses([pass({ expiresOn: '2026-09-15' })], TODAY);
  eq(expiringExclusions(x), null,
    'a clean pass book gets no paragraph — a caveat printed for every gym is a caveat nobody reads');
}

/* ── the day the page is judged on is the CALLER's, and it matters ────────── */
{
  // One pass, last day the 13th at the gym. Nobody has ever joined.
  const rec = {
    passes: sliceReady([pass({ expiresOn: '2026-09-13', holderId: 'u1' })]),
    memberships: sliceReady<Membership>([]),
    visits: sliceReady([]),
    plans: sliceReady([]),
  };

  const onTheDay = buildPassConversion(rec, { today: '2026-09-13' });
  const dayAfter = buildPassConversion(rec, { today: '2026-09-14' });

  eq(onTheDay.passes!.live, 1, 'on its last day the pass is live');
  eq(dayAfter.passes!.live, 0, 'the day after, it is not');
  eq(onTheDay.holders![0].outcome, 'undecided',
    'a holder with a live pass has not decided anything');
  eq(dayAfter.holders![0].outcome, 'no-membership',
    'and the same holder one day later is on the call list this page exists to produce');
  eq(onTheDay.counts!.decided, 0, 'so the denominator of the figure at the top is nought…');
  eq(dayAfter.counts!.decided, 1, '…and one. Which day is asked decides both.');

  // 2026-09-13T21:00Z is the 14th in Dubai and the 13th in London. A page that
  // took the day off the reader's machine rather than the gym's would put this
  // member on a call list a day early, from one desk and not the other.
  ok(onTheDay.holders![0].outcome !== dayAfter.holders![0].outcome,
    'which is why studio-web/app/passes passes the GYM day in rather than letting the default '
    + 'read the clock of whichever laptop has the tab open');
}

/* ── a failed pass read produces no list, never an empty one ──────────────── */
{
  const c = buildPassConversion({
    passes: sliceFailed<GymPass>('the read was refused'),
    memberships: sliceReady<Membership>([]),
    visits: sliceReady([]),
    plans: sliceReady([]),
  }, { today: TODAY });

  eq(c.passes, null, 'no summary at all, rather than a summary of nothing');
  eq(c.holders, null, 'and no holders — an empty call list would be a finding');
  ok((c.warning ?? '').length > 0, 'with a sentence saying which read is missing');
}

if (errors.length) {
  console.error(`passConversion: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('passConversion ok');
