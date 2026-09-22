// The member app's navigation is one list, and these are the things that have
// to be true of it. Compile with tsc, run with node.
//
// scripts/check-client-index.mjs asks the question this file cannot: whether a
// FILE on disk is in the list. It reads the source with regexes, so it cannot
// see what the list evaluates to. This file is the other half — it imports the
// real arrays and asks what the Me screen will actually render out of them.
//
// Both exist because the same defect shipped twice: navigation was written out
// by hand in two places, CLIENT_FEATURES here and HUB_GROUPS in
// app/(client)/profile.tsx, and a screen was reachable if it was in either.
// Eighteen screens fell into the gap between them across two incidents, one of
// them the screen that changes a member's password. HUB_GROUPS is deleted and
// the hub renders from `meGroup`, so there is one list; these assertions are
// what stop it quietly becoming no list.
import {
  CLIENT_FEATURES, ME_GROUPS, ME_QUICK, ME_QUICK_TITLE, CLIENT_UNLISTED,
  meGroupFeatures, searchFeatures, type MeGroupKey,
} from './features';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── one list, and one row per destination ─────────────────────────────── */

{
  const seen = new Map<string, number>();
  for (const f of CLIENT_FEATURES) seen.set(f.route, (seen.get(f.route) ?? 0) + 1);
  for (const [route, n] of seen) {
    ok(n === 1, `${route} appears ${n} times in CLIENT_FEATURES. Two rows for one screen is two lists in one file.`);
  }
  const keys = new Set(CLIENT_FEATURES.map((f) => f.key));
  eq(keys.size, CLIENT_FEATURES.length, 'every feature key is distinct');
}

/* ── the six groups ────────────────────────────────────────────────────── */

{
  const keys = ME_GROUPS.map((g) => g.key);
  eq(new Set(keys).size, keys.length, 'ME_GROUPS keys are distinct');
  eq(keys.length, 6, 'the Me screen is six cards');

  // A group with nothing in it draws as a heading over nothing, or does not
  // draw at all — which is exactly how the first incident hid ten screens.
  for (const g of ME_GROUPS) {
    ok(meGroupFeatures(g.key).length > 0, `ME_GROUPS '${g.key}' is empty; the Me screen would draw a card leading nowhere`);
  }

  // Every group is reachable from the hub, and nothing is in two of them.
  const filed = CLIENT_FEATURES.filter((f) => f.meGroup);
  const total = ME_GROUPS.reduce((n, g) => n + meGroupFeatures(g.key).length, 0);
  eq(total, filed.length, 'every feature with a meGroup is drawn under exactly one card');

  // `area` says which tab owns a screen; `meGroup` says which Me card lists
  // it. A screen the Me tab OWNS and the Me screen does not list has search as
  // its only way in, which is the half-reachable state both incidents ended in.
  for (const f of CLIENT_FEATURES) {
    if (f.area === 'me') ok(!!f.meGroup, `${f.route} is area 'me' with no meGroup; the Me screen would not list it`);
  }
}

{
  // The filter is a filter, not a coincidence.
  const money = meGroupFeatures('money').map((f) => f.route);
  ok(money.includes('/(client)/invoices'), 'Invoices is under Money');
  ok(money.includes('/(client)/receipts'), 'Payments is under Money');
  ok(!money.includes('/(client)/injuries'), 'Injuries is not under Money');
  eq(meGroupFeatures('money', []).length, 0, 'meGroupFeatures reads the list it is given');
  const bogus = meGroupFeatures('not-a-group' as MeGroupKey);
  eq(bogus.length, 0, 'an unknown group is empty rather than everything');
}

/* ── the three shortcuts ───────────────────────────────────────────────── */

{
  eq(ME_QUICK.length, 3, 'three shortcuts');
  eq(new Set(ME_QUICK).size, 3, 'three DIFFERENT shortcuts');
  for (const route of ME_QUICK) {
    const f = CLIENT_FEATURES.find((x) => x.route === route);
    ok(!!f, `ME_QUICK names ${route}, which is not in CLIENT_FEATURES — the row would render with no label and no icon`);
    ok(!!f?.meGroup, `ME_QUICK names ${route}, which is not on the Me screen at all`);
  }

  // The heading is the whole point of the judgement call recorded above
  // ME_QUICK. Nothing in this app records which screens a member opens, so a
  // heading that CLAIMS to know is a false statement about that member. If
  // opens are ever recorded, on purpose, this assertion is the thing to change
  // deliberately rather than the thing to discover afterwards.
  ok(!/\byou\b/i.test(ME_QUICK_TITLE),
    `ME_QUICK_TITLE is "${ME_QUICK_TITLE}". These three are fixed, so a heading in the second person claims a history this app does not record.`);
}

/* ── exclusions are decisions, and say so ──────────────────────────────── */

{
  const routes = new Set(CLIENT_FEATURES.map((f) => f.route));
  for (const [key, reason] of Object.entries(CLIENT_UNLISTED)) {
    ok(reason.trim().length > 20, `CLIENT_UNLISTED['${key}'] has no real reason. A bare exclusion is how a screen goes missing.`);
    ok(!routes.has(`/(client)/${key}`), `CLIENT_UNLISTED excludes '${key}' and CLIENT_FEATURES lists it. Two lists disagreeing about one screen is the defect.`);
  }
}

/* ── search still reads the same list ──────────────────────────────────── */

{
  // The Me screen's field opens Explore, which searches CLIENT_FEATURES. A
  // member searching the name of a thing on their own Me screen has to find it.
  for (const g of ME_GROUPS) {
    for (const f of meGroupFeatures(g.key)) {
      ok(searchFeatures(CLIENT_FEATURES, f.label).some((x) => x.route === f.route),
        `"${f.label}" is on the Me screen and searching its own name does not find it`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
