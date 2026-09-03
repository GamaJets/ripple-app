// The five this file exists to stop.
//
//   1. A FAILED READ REPORTED AS AN UNSET SETTING. The tenants read is one
//      query behind four of the six items. If it is refused and the list says
//      "todo" anyway, an owner is sent to set a currency they set last week —
//      and, on the other side of the same bug, a gym whose reads all failed
//      would be reported as having nothing outstanding at all.
//
//   2. "ALL SET" SAID OVER SOMETHING NOBODY CHECKED. The summary line must
//      never claim completeness while an item is unknown.
//
//   3. THE PANEL APPEARING FOR A GYM WITH NOTHING WRONG. `needsSetup` is false
//      when the only non-done items are unknown, so a network hiccup does not
//      put a setup checklist in front of a gym that finished setting up in
//      March. A list that cries wolf is dismissed, and then it is dismissed on
//      the day it is right.
//
//   4. A GYM'S REAL NAME MISTAKEN FOR THE PROVISIONED ONE, AND VICE VERSA.
//      supabase/parts/06 writes `<full name>'s space`; the test pins that
//      string, both apostrophes, and the fact that a normal gym name passes.
//
//   5. A ZERO COUNT AND A COUNT NOBODY TOOK, TREATED ALIKE. `plans: 0` is a
//      gym with no price book. `plans: null` is a read that did not come back
//      whole. One is an instruction and the other is a silence.
//
// Compile with tsc, run with node.
import {
  SETUP_ORDER, assessGymSetup, setupTally, setupLine, needsSetup,
  looksProvisioned,
  type SetupFacts, type SetupItem, type SetupKey, type SetupState,
} from './gymSetup';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A gym that has finished setting up. Each test breaks one thing off it. */
const READY: SetupFacts = {
  tenant: { name: 'Ruoni Strength', currency: 'GBP', timezone: 'Europe/London', sessionFee: 45 },
  plans: 3,
  members: 214,
};

const stateOf = (items: SetupItem[], key: SetupKey): SetupState => {
  const it = items.find((i) => i.key === key);
  if (!it) { errors.push(`no item for ${key}`); return 'unknown'; }
  return it.state;
};

/* ── 0. the shape of the list ──────────────────────────────────────────── */
{
  const items = assessGymSetup(READY);
  eq(items.length, 6, 'six items, no more and no fewer');
  eq(items.map((i) => i.key).join(','), SETUP_ORDER.join(','),
    'the list comes back in the documented order, so two screens cannot order it two ways');
  ok(items.every((i) => i.title.length > 0 && i.breaks.length > 0),
    'every item names what to do and what breaks without it');
  ok(items.every((i) => i.state === 'done'),
    'a fully set-up gym has nothing outstanding');
  eq(needsSetup(items), false, 'and is shown no list');
  eq(setupLine(items), null, 'and no summary line either');

  const t = setupTally(items);
  eq(t.done, 6, 'six done'); eq(t.todo, 0, 'none to do'); eq(t.unknown, 0, 'none unknown');
  eq(t.total, 6, 'over six');

  // The two conditional items say so; the four universal ones do not, because
  // an "only if" on a universal setting is an invitation to skip it.
  const cond = items.filter((i) => i.onlyIf !== null).map((i) => i.key).sort();
  eq(cond.join(','), 'fee,plan', 'exactly the plan and the session fee are conditional');
}

/* ── 1. a failed tenants read is UNKNOWN, never todo ───────────────────── */
{
  const items = assessGymSetup({ ...READY, tenant: null });

  for (const k of ['currency', 'timezone', 'name', 'fee'] as SetupKey[]) {
    eq(stateOf(items, k), 'unknown', `${k} is unknown when the gym record did not come back`);
  }
  // And the two that do not depend on that read are unaffected — a refusal on
  // one query must not blank the answers of the others.
  eq(stateOf(items, 'plan'), 'done', 'the price book was still read');
  eq(stateOf(items, 'member'), 'done', 'and so was the roster');

  const unknowns = items.filter((i) => i.state === 'unknown');
  ok(unknowns.every((i) => (i.unknownWhy ?? '').length > 0),
    'every unknown says WHY, and the why names the read rather than the setting');
  ok(items.filter((i) => i.state !== 'unknown').every((i) => i.unknownWhy === null),
    'and nothing that IS known carries a reason it is not');

  eq(needsSetup(items), false,
    'four settings nobody could read is not four things to do — defect 3');
  eq(setupLine(items),
    '2 of 6 set, and 4 could not be checked, so they are not counted either way.',
    'the summary keeps the two counts apart — defect 2');
}

/* ── 2. the state of the platform, item by item ────────────────────────── */
{
  // The gym every account on this platform actually is, on the day this was
  // written: named by the sign-up trigger, no timezone, no currency, no fee,
  // no plans, no members.
  const fresh: SetupFacts = {
    tenant: { name: "Tim's space", currency: null, timezone: null, sessionFee: null },
    plans: 0,
    members: 0,
  };
  const items = assessGymSetup(fresh);
  ok(items.every((i) => i.state === 'todo'), 'a brand-new gym has all six outstanding');
  eq(needsSetup(items), true, 'and is shown the list');
  eq(setupLine(items), '0 of 6 set, 6 still to do.', 'and told where it stands');

  const name = items.find((i) => i.key === 'name');
  eq(name?.found, "Tim's space",
    'the name item carries what the gym is called now, as a value in a slot');

  // A blank currency is the same answer as a null one. `tenants.currency` is
  // nullable and nothing trims it on the way out of PostgREST.
  eq(stateOf(assessGymSetup({ ...READY, tenant: { ...READY.tenant!, currency: '   ' } }), 'currency'),
    'todo', 'whitespace is not a currency');
  eq(stateOf(assessGymSetup({ ...READY, tenant: { ...READY.tenant!, timezone: '' } }), 'timezone'),
    'todo', 'and an empty string is not a timezone');
}

/* ── 3. zero is not null ───────────────────────────────────────────────── */
{
  const noPlans = assessGymSetup({ ...READY, plans: 0 });
  eq(stateOf(noPlans, 'plan'), 'todo', 'a price book with nothing in it is something to do');

  const unread = assessGymSetup({ ...READY, plans: null });
  eq(stateOf(unread, 'plan'), 'unknown', 'a price book nobody counted is not an empty one');
  eq(unread.find((i) => i.key === 'plan')?.unknownWhy?.includes('price book'), true,
    'and the reason names the read that failed');

  eq(stateOf(assessGymSetup({ ...READY, members: 0 }), 'member'), 'todo',
    'an empty roster is something to do');
  eq(stateOf(assessGymSetup({ ...READY, members: null }), 'member'), 'unknown',
    'a roster nobody counted is not an empty one — defect 5');
}

/* ── 4. the session fee, and the one thing it cannot tell you ──────────── */
{
  eq(stateOf(assessGymSetup({ ...READY, tenant: { ...READY.tenant!, sessionFee: null } }), 'fee'),
    'todo', 'no fee is a fee to set');
  // Zero is a value somebody stored. A gym whose coaches are salaried rather
  // than paid per session prices payroll at nothing, and that is an answer:
  // `payroll30For` returns 0 rather than withholding. Treating it as unset
  // would nag such a gym forever.
  eq(stateOf(assessGymSetup({ ...READY, tenant: { ...READY.tenant!, sessionFee: 0 } }), 'fee'),
    'done', 'a fee of zero is a fee somebody set');
}

/* ── 5. the name the sign-up trigger writes ────────────────────────────── */
{
  // supabase/parts/06 writes `coalesce(full_name,'My') || '''s space'`, so
  // both of these are strings the trigger really produces.
  ok(looksProvisioned("Tim's space"), 'the trigger’s own output is recognised');
  ok(looksProvisioned("My's space"), 'including the no-name fallback for a profile with no name');
  ok(looksProvisioned("Aiofe O'Brien's space"), 'an apostrophe inside the name changes nothing');
  ok(looksProvisioned('Tim’s space'), 'and a curly apostrophe typed back in from a phone');
  ok(looksProvisioned(null), 'a gym with no name at all still needs one');
  ok(looksProvisioned('   '), 'and so does one named nothing but spaces');

  ok(!looksProvisioned('Ruoni Strength'), 'a real gym name is left alone');
  ok(!looksProvisioned('The Space'), 'and so is one that merely contains the word');
  ok(!looksProvisioned("Tim's Space Gym"), 'the suffix has to be the end of the name');
  ok(!looksProvisioned("Tim's spaces"), 'and it has to be the whole word');
  // The one direction this heuristic is wrong in, pinned so nobody discovers
  // it as a surprise: a gym genuinely called "Sara's space" reads as unnamed.
  // Documented in the module, and harmless — the row shows the name and the
  // owner ignores it.
  ok(looksProvisioned("Sara's space"), 'the known false positive, asserted rather than hidden');
}

/* ── 6. mixed: something to do AND something unread ────────────────────── */
{
  const items = assessGymSetup({
    tenant: { name: 'Ruoni Strength', currency: null, timezone: null, sessionFee: 45 },
      plans: 2,
    members: null,
  });
  eq(setupLine(items),
    '3 of 6 set, 2 still to do, and one could not be checked, so it is not counted either way.',
    'three clauses, three different facts');
  eq(needsSetup(items), true, 'and the list is shown, because two of them really are outstanding');

  const t = setupTally(items);
  eq(t.done + t.todo + t.unknown, t.total, 'the three counts partition the list');
}

if (errors.length) {
  console.error(`gymSetup: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('gymSetup: ok');
