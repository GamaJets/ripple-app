// Owner · Financial checks. KPIs, retention and a RULE-BASED read of the
// figures the owner has typed in, with the thresholds each finding crossed.
//
// ── Not an AI review, on this screen or anywhere else ─────────────────────
//
// This screen was headed "AI Financial Review" over a subtitle promising "an
// AI review of where to improve", and the module behind it was called
// `financialAI.ts`. There is no model call anywhere in it and there never was:
// src/lib/finReview.ts is an if/else chain over eight typed numbers and a
// fixed set of thresholds. The header of that file is the long version of why
// the name mattered — the short version is that `grade >= 'A'` compared
// strings, every gym was told it was in strong financial health, and an owner
// who thinks a model read their books has no way to catch that. Rules they can
// read, they can argue with.
//
// The review runs ONLY on figures the owner has entered. This screen previously
// rendered `sampleFinances()` — an invented AED 214,000/mo, 1,940-member gym —
// behind a one-line footnote, so a real owner opened it and was told, with a
// grade and a verdict, that their business was in strong financial health.
// Until figures are entered it now shows an entry form and no analysis at all.
//
// ── The figures never leave this phone, and the screen says so three times ─
//
// They are one AsyncStorage key under `KEY`. No row, no sync, no backup. An
// owner typing a real P&L into a phone is entitled to know that before they
// treat it as a record, so `storageNote()` is said in the empty state, in the
// entry form and under the review — the three places somebody can be standing
// when they decide whether this is somewhere their numbers live.
// docs/OWNER-PORTAL.md:89 offers two ways out of this: connect real accounting,
// or rename the screen to what it is. Accounting is a Xero/QuickBooks OAuth
// app, a token store, a sync worker and a chart-of-accounts mapping, none of
// which exists. So this is the other one, done honestly.
//
// ── Two things on this screen are NOT the typed figures ──────────────────
//
// The month-end verdict and the costs form, both added above the P&L and both
// reading the gym's own records rather than this phone's AsyncStorage key.
//
// They are here because this is the owner's money screen and they were on no
// phone screen at all: whether the month can be closed, and what is stopping
// it, existed only on the web console, and `gym_costs` had only the console's
// form — so an owner paying a supplier at a counter carried the line in their
// head until they were next at a desk.
//
// Neither is ever combined with what the owner typed below. The costs list and
// the "Total Expenses / Mo" field are two different records of two different
// things, and src/lib/gymCosts.ts refuses netting under a heading in capitals.
// The close is read-only here; see src/lib/ownerClose.ts for why.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional, handler, route and the
// AsyncStorage persistence are preserved — only the presentation changed: the
// health score became the screen's one hero figure (in the "has figures" state
// only — the empty state shows no hero of zeros), the bordered KPI grid became
// hairline-divided KPI rows, the flag boxes became a hairline-divided list with
// a tone dot beside ink-coloured text, and the Georgia serif header is gone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, KpiRow, ListRow, Cta, Ghost, Notice, Spark, fig, PageHead, FigureCard, ActionBlock } from '../../src/ui/kit';
import { useMrrHistory } from '../../src/ui/useMrrHistory';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { emptyFinances, hasFigures, anyEntered, reviewFinances, reviewBasis, storageNote, type FinInputs, type FinFlag } from '../../src/lib/finReview';
import { reconcile, reconcileNote, unreadable } from '../../src/lib/finReconcile';
import { fetchPlans, fetchMemberships, fetchPayments, summarise, sharedCurrency } from '../../src/lib/gymRecord';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { deltaLabel, deltaSign } from '../../src/lib/deltaLabel';
import { readNumber } from '../../src/lib/units';
// A minor-unit integer from the register, as the whole-unit number the owner
// typed into the form beside it — scaled by the currency, never by a hundred.
import { wholeFromMinor, NO_CURRENCY_CHECK_NOTE } from '../../src/lib/wholeUnits';
// What money a SUM is in — the rule this screen held and breached six lines
// apart. See the header of src/lib/sumCurrency.ts.
import { totalMoney, emptyTotalMoney, MIXED_CURRENCY_NOTE, type TotalMoney } from '../../src/lib/sumCurrency';
// Whose figures these are. The key the eight numbers below live under carries
// the account; the legacy unqualified one is removed unread. See the header of
// src/lib/ownerFinancialsCache.ts for what the shared key did on a handset two
// gyms sign into, and src/lib/deviceAccountCache.ts for the rule it breached.
import {
  LEGACY_OWNER_FINANCIALS_KEY, ownerFinancialsCache,
  parseOwnerFinancials, ownerFinancialsBlob, readFinancialsDraft, reviewBlocker,
  type EnteredFields,
} from '../../src/lib/ownerFinancialsCache';
import { cacheHydrated, mayWriteCache, type DeviceCache } from '../../src/lib/deviceAccountCache';
// What a MOUNTED screen does when the account under it changes. This one is
// registered `href: null`, so it mounts once and is never torn down — the wipe
// happens on the way IN, before the read lands and whatever it decides.
import { accountStateStep } from '../../src/lib/accountScopedState';
// Who is signed in, with the failure kept rather than collapsed into "signed
// out". `supabase.auth.getUser()` resolves on a dropped connection, so a
// discarded error is an outage read as a sign-out.
import { signedInUid } from '../../src/lib/signedInUid';
import { type AuthReadFate } from '../../src/lib/authReadFate';
import { useAuthRevision } from '../../src/ui/authRevision';
import { USE_SUPABASE } from '../../src/lib/config';
import { num, num1 } from '../../src/lib/format';
// The calendar month, not a rolling thirty days. See the note on `basisMonth`.
//
// And the month cut on the GYM's clock, not this phone's. `monthWindow`'s
// `firstDay`/`lastDay` are pure string arithmetic and are right in every zone —
// which is why the joiners check below needs no timezone at all — but its
// `fromIso`/`toIso` come out of `new Date(y, mo - 1, 1)`, the phone's own
// midnight, and those are the bounds the PAYMENTS read is filtered on.
// `gym_payments.taken_at` is a `timestamptz`, so an owner in London reading a
// Dubai gym asked for a window four hours off the gym's own month at both ends:
// the figure that came back was offered under a "Use It" button that writes it
// into the owner's scorecard, where it is 25 of the 100 points behind the grade
// this screen prints.
import { monthAtGym, gymRecentMonths } from '../../src/lib/gymMonth';
import { fetchGymZone } from '../../src/lib/gymZone';
// When the register was read, whether the phone can reach us, and a way to ask
// again — the three things nineteen of the twenty owner screens did without.
// Which of this owner's gyms the register below belongs to, and whether there
// are others. Renders nothing for a single-site owner — see ownerSiteScope.ts.
import { fetchOwnerSites, SITES_LOADING } from '../../src/lib/ownerSiteScope';
import { siteNotice, type SiteScope } from '../../src/lib/ownedSites';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
/* ── whether this month can be closed ──────────────────────────────────────
 *
 * The whole verdict — 'closeable' or 'blocked', and the blockers in the words
 * `closeBlockers` writes them — already existed and lived on a laptop. An owner
 * anywhere else could not find out whether their month was signed off, whether
 * it could be, or which sessions nobody had marked. The card reads; it does not
 * close, and it says why.
 */
import { useOwnerMonthClose } from '../../src/ui/gymMonthClose';
import { MonthCloseCard } from '../../src/ui/MonthCloseCard';
/* ── what the gym paid for, written down where it was paid ─────────────────
 *
 * `gym_costs` had one writer in the product and it was the console, so an owner
 * paying a supplier at a counter carried the amount, the payee and the day in
 * their head until they were next at a desk — and part 182 LOCKS a month, so a
 * line that misses the close cannot be added at all until the month is
 * reopened. Deliberate capture with the console's own fields and the console's
 * own gate; never a quick-add. See src/lib/ownerCostEntry.ts, and part 2730 for
 * why nothing may ever create one of these rows on somebody's behalf.
 */
import { useOwnerCosts } from '../../src/ui/ownerCosts';
import { GymCostEntry } from '../../src/ui/GymCostEntry';

/*
 * The key these figures live under is no longer a constant at module scope,
 * because it is no longer one key. It is `repple.owner.financials:<uid>`, built
 * per account by `ownerFinancialsCache`, and the unqualified
 * `repple.owner.financials` that used to be here is now
 * LEGACY_OWNER_FINANCIALS_KEY, removed unread. src/lib/ownerFinancialsCache.ts
 * carries the argument; the short version is that a key with no account in it
 * is a key the next account inherits, and what this one holds is one gym's
 * books, redrawn in the next gym's currency, graded, and offered for
 * overwriting from the next gym's register.
 */
// One formatter for the whole owner app, rather than 'AED ' typed here and '$'
// typed on Revenue — the two screens read the same gym, and a demo that tabs
// between them showed one business in two currencies. Every figure on this
// screen is one the owner typed into the form below, so it is never null; the
// dash is there because gymMoney refuses to render an unknown as 0.00.
// Takes the gym's currency, and there is no fallback behind it: part 99 added
// `tenants.currency` nullable on purpose, so a gym that never set one gets the
// dash rather than somebody else's money. GYM_CURRENCY is no longer a render
// fallback anywhere — see the note on it in src/ui/tenant.tsx.
const moneyIn = (n: number, cur: string | null) => gymMoney(n, cur) ?? '—';

// `hint` is optional now. A money field's hint IS the gym's currency, and the
// gym is not known at module scope — it was printing GYM_CURRENCY, the module
// default, to every gym including the ones part 99 gave a currency of their
// own. Absent means "money, in this gym's currency", filled in at render.
const FIELDS: { key: keyof FinInputs; label: string; hint?: string }[] = [
  { key: 'revenue', label: 'Total Revenue / Mo' },
  { key: 'expenses', label: 'Total Expenses / Mo' },
  { key: 'mrr', label: 'Recurring Membership Revenue' },
  { key: 'members', label: 'Active Members', hint: 'count' },
  { key: 'newMembers', label: 'Joined This Month', hint: 'count' },
  { key: 'churnedMembers', label: 'Left This Month', hint: 'count' },
  { key: 'ptRevenue', label: 'Personal-training Revenue' },
  { key: 'classRevenue', label: 'Class Revenue' },
];

export default function Financials() {
  const t = useTheme();
  const router = useRouter();
  const { tenant, status: tenantStatus } = useTenant();
  // `?? null`, not `|| GYM_CURRENCY`. Every figure on this screen is one the
  // owner typed, so the amounts are known — but the money they are in is the
  // gym's own answer or nothing, and a form whose fields are headed "(AED)" at
  // a gym billing in pounds invites the owner to type pounds into a dirham
  // field. The header below names the missing setting instead.
  const cur = tenant?.currency ?? null;
  const money = (n: number) => moneyIn(n, cur);
  /* ── the month end, read-only ────────────────────────────────────────────
   * The verdict `buildClose` computes for the console, on the phone. Its own
   * hook rather than reads written here: it needs seven of them — the five
   * `CLOSE_PARTS`, the per-coach rates and the record of closed months — and
   * every decision about what each silence means is in src/lib/ownerClose.ts
   * with a test under plain node. */
  const monthClose = useOwnerMonthClose();
  const { refresh: refreshMonthClose } = monthClose;
  /* The gym's outgoings for the month it is in, and the one write on this
   * screen. Handed the close's own zone and its record of closed months rather
   * than reading either again: one answer to "is August filed" per screen, or
   * the card and the form disagree about whether a cost may be dated into it. */
  const costs = useOwnerCosts(monthClose.zone, monthClose.closes);
  const { refresh: refreshCosts } = costs;
  const [fin, setFin] = useState<FinInputs>(emptyFinances);
  /**
   * WHICH of the eight the owner actually typed.
   *
   * `FinInputs` is eight `number`s with no null in it and the form says "Leave
   * a field blank if you don't track it", so the figures alone cannot tell a
   * blank from a zero — and this screen used to resolve that with `n ?? 0`.
   * src/lib/ownerFinancialsCache.ts carries the argument and the numbers; the
   * short version is that an owner who typed revenue 30,000 and nothing else
   * was shown a health score of 100, a Grade A, and the sentence "Your gym is
   * in strong financial health (A). 30,000/mo profit on a 100% margin, low
   * churn and positive growth" — a margin built from expenses nobody entered,
   * and churn and growth over member counts nobody entered either.
   *
   * Empty is the honest start: before a read lands, nothing has been entered.
   */
  const [entered, setEntered] = useState<EnteredFields>(() => new Set());
  const [hydrated, setHydrated] = useState(false);
  /**
   * The stored P&L could not be READ back.
   *
   * The catch below swallowed it and set `hydrated` anyway, so a corrupt or
   * refused `AsyncStorage` read left `fin` at `emptyFinances()` — and this
   * screen headed itself "No Figures Yet" and said "Nothing is shown until it
   * comes from you" to an owner who typed a full month last week. Worse, the
   * next save writes that blank object back over the key, so the sentence
   * becomes true by having been said.
   */
  const [hydrateFailed, setHydrateFailed] = useState(false);
  /**
   * Which account's cache this screen may read and write, and whether a read of
   * THAT key has come back.
   *
   * A ref rather than state because nothing on screen is derived from it and it
   * has to be settable synchronously, before the first `await` of the effect
   * below: the window between "the account changed" and "the new account's read
   * landed" is precisely the window in which a write must not fire.
   *
   * `hydrated` on this record is not the `hydrated` useState above. That one
   * gates the RENDER — whether there is anything to show yet. This one gates
   * the WRITE, and `cacheForAccount` hands it back false with no setter that
   * leaves the old flag standing.
   */
  const store = useRef<DeviceCache>(ownerFinancialsCache(null));
  /** The key of the account whose figures are in `fin` right now — null when
   *  the screen holds nobody's. What `accountStateStep` compares against. */
  const onScreenKey = useRef<string | null>(null);
  /**
   * Why there is no account to scope the figures to, when there is not.
   *
   * Two answers and not one. src/lib/authReadFate.ts is the long version:
   * `supabase.auth.getUser()` RESOLVES on a dropped connection with
   * `{ data: { user: null }, error }`, so an outage and a genuine sign-out
   * arrive as the same null. Telling an owner in a basement that their figures
   * are gone, over a read that never happened, is the sentence that file exists
   * to stop.
   */
  const [noAccount, setNoAccount] = useState<AuthReadFate | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  // What the records themselves say. MRR and the active-member count are both
  // things the database already knows — memberships on priced plans give one,
  // memberships with status 'active' give the other — so asking an owner to
  // type them creates two sources for one number that nothing compares.
  //
  // The derived figures are NOT written over what was typed. An owner entering
  // a different number is usually right about something the records do not
  // hold: a corporate contract invoiced offline, a price that changed
  // mid-month. Overwriting that would swap one wrong number for another and
  // lose what the owner knows. The screen names both and lets them decide.
  const [derivedMrr, setDerivedMrr] = useState<number | null>(null);
  const [derivedMembers, setDerivedMembers] = useState<number | null>(null);
  /**
   * Two more of the eight the register already holds.
   *
   * `revenue` is what `gym_payments` says was banked in the last 30 days —
   * whatever it was for — and `newMembers` is memberships whose `started_on`
   * falls in the same window. Both were being typed by hand beside a database
   * that already knew them, which is two sources for one number and nothing
   * comparing them.
   *
   * CHURN is deliberately not derived, and the reason is worth stating: nothing
   * in `memberships` records WHEN a membership was cancelled. `status` moves to
   * 'cancelled' in place and `ends_on` is only set on a fixed term, so any
   * derived churn would be a guess dressed as a check — and a check that is
   * wrong is worse than no check, because this screen exists to be believed.
   */
  const [derivedRevenue, setDerivedRevenue] = useState<number | null>(null);
  const [derivedNew, setDerivedNew] = useState<number | null>(null);
  /**
   * Which month the register figures above are OVER — 'August 2026'.
   *
   * On the sentence rather than in a comment, because the figure is offered
   * under a button that writes it into the owner's own numbers. A register
   * figure quoted with no period named is how a rolling thirty days came to be
   * filed as a calendar month's joiners.
   */
  const [basisMonth, setBasisMonth] = useState<string | null>(null);
  /** The same month, named with the clock caveat the revenue check needs.
   *  See where it is set for why the joiners check must NOT carry it. */
  const [basisClock, setBasisClock] = useState<string | null>(null);
  /**
   * The register could not be read.
   *
   * `fetchPlans`/`fetchMemberships`/`fetchPayments` all throw on a PostgREST
   * error, and the catch below only logged it — which left both derived figures
   * null, which is the same state an empty register produces. So `reconcile`
   * returned 'no_record' and the screen told an owner "Nothing recorded yet, so
   * your MRR cannot be checked against the register": a specific claim about
   * their own gym, in the same type used when it is true, arrived at by code
   * that never read a row. On a screen whose entire purpose is checking the
   * owner's figures against the register, that is the worst available sentence.
   */
  const [derivedFailed, setDerivedFailed] = useState(false);
  /**
   * The register holds more than one currency, so there is no figure to check
   * against — for the recurring total, for the thirty-day takings, or for both.
   *
   * A third and a fourth silence, kept apart from the other two for the reason
   * the second one exists. A null derived figure already means either "nothing
   * recorded" or "the read failed"; a register that is full, was read, and
   * states two moneys is neither. Folding it into `no_record` tells an owner
   * their register is empty when it is not, and folding it into the
   * currency-blind sentence sends them to Ops to set a field that is already
   * set.
   *
   * The fourth is a register in ONE currency that is not the gym's. The form
   * beside these checks is headed in the gym's own currency and that is what an
   * owner types into it, so comparing the two would be arithmetic across two
   * moneys — "your records show 43,000, which is 8,000 more than the 35,000
   * entered here", where the two figures are dirhams and pounds. That is the
   * same class of number this screen exists to refuse, arrived at one step
   * later, and it is reachable at exactly the gyms `sharedCurrency` was written
   * for: the ones that changed currency and still hold rows in the old one.
   */
  const [mrrCcy, setMrrCcy] = useState<TotalMoney | null>(null);
  const [revCcy, setRevCcy] = useState<TotalMoney | null>(null);

  // Bumped by the Refresh control under the title. A counter, so two taps are
  // two reads.
  const [again, setAgain] = useState(0);
  /** When the register read LANDED. A refused read leaves it alone — the
   *  figures beside it are still from the earlier read. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** The register read, asked for again. The typed P&L beside it is this
   *  phone's own AsyncStorage and has nothing to re-read; the four checks on
   *  this screen are that local figure against the register, and the register
   *  is the half that can be out of date. */
  const reread = useCallback(() => {
    setAgain((n) => n + 1);
    // The month-end card reads seven more things, none of them through the
    // effect `again` drives. A Refresh that left them alone would put a
    // yesterday's verdict under a line claiming the screen was read just now.
    refreshMonthClose();
    refreshCosts();
  }, [refreshMonthClose, refreshCosts]);

  // The zone read that used to sit here is gone with the thing it was for.
  // It existed to cut ONE instant — "thirty days ago" — into the gym's own
  // calendar day, so that a rolling window could be compared against
  // `memberships.started_on`. The window is now a calendar month and its two
  // ends are already days, so there is no instant left to cut and no zone left
  // to need. A read nothing consumes is a trap for the next person, which is
  // why it is removed rather than left holding a value in a ref.
  const pull = usePullToRefresh(reread);

  useEffect(() => {
    let live = true;
    (async () => {
      // A tenant that could not be READ is not a gym with no register.
      //
      // This used to be `if (!tenant?.id) return;` alone, and the early return
      // left `derivedFailed` false with all four derived figures null — which is
      // byte for byte the state an empty register produces. `reconcile` then
      // returned 'no_record' and this screen told an owner "Nothing recorded
      // yet, so your MRR cannot be checked against the register", on all four
      // checks at once. The comment on `derivedFailed` above calls that the
      // worst available sentence on this screen, and the machinery built to
      // prevent it was reachable only through the register read's own catch —
      // so a failure one level up, in the TENANT read, walked straight past it.
      //
      // 'loading' takes the same branch on purpose. Between mount and the
      // tenant landing there is a window in which the register genuinely cannot
      // be checked, and "we could not read it" is true of that window while
      // "you have recorded nothing" is not.
      if (!tenant?.id) {
        if (!live) return;
        setDerivedMrr(null); setDerivedMembers(null);
        setDerivedRevenue(null); setDerivedNew(null);
        // Cleared alongside the figures. A mixed-ledger sentence left standing
        // over a read that never happened is a claim about a register nobody
        // looked at, which is the same class of mistake as the one above it.
        setMrrCcy(null); setRevCcy(null);
        setDerivedFailed(tenantStatus !== 'ready');
        return;
      }
      setBusy(true);
      try {
        /**
         * ── The payments read is BOUNDED, and this is why ──────────────────
         *
         * It used to be `fetchPayments(supabase, tenant.id)` — every payment
         * the gym has ever taken — to compute a THIRTY-DAY figure. src/lib/
         * gymRecord.ts caps that read at a thousand rows and throws past it, so
         * on a gym that crosses a thousand payments (a 600-member gym does that
         * in under two months) the catch below fired, `derivedFailed` went
         * true, and ALL FOUR reconciliation checks went dead — on the screen
         * whose only job is checking the owner's typed P&L against the
         * register, at exactly the gym size where checking it starts to matter.
         *
         * Every use of `payments` on this screen is inside the thirty-day
         * window: `summarise` takes it for `takenCents`, which this screen does
         * not read (MRR comes off the memberships and the price book), and the
         * revenue check filters to `since` two lines later. So the read now
         * asks for the window it always wanted, which is a bounded set that
         * cannot outgrow the cap the way "all of history" does.
         */
        /**
         * ── And it is a MONTH, which it was not ────────────────────────────
         *
         * The window was `Date.now() - 30 days`, and every field it is checked
         * against is monthly: "Total Revenue / Mo", "Joined This Month". On the
         * 3rd of a month a rolling thirty days is almost entirely the PREVIOUS
         * month, so the register figure offered under "Joined This Month" was
         * made of somebody else's month — and the sentence beside it read "Your
         * records show 37. Use that, or type your own figure." One tap wrote 37
         * into `newMembers`, which is the numerator of `growthPct` in
         * src/lib/finReview.ts and 25 of the 100 points behind the grade this
         * screen prints. The owner who had typed the right number was told
         * their records disagreed and offered the wrong one.
         *
         * The LAST FULL month, not the running one, and that is the second half
         * of the fix. A month-to-date total compared against a figure somebody
         * typed for a whole month always reads short, so a correct entry would
         * be flagged as disagreeing every day of every month — which teaches an
         * owner to ignore the one sentence on this screen that matters. A
         * finished month is the only period where the register's figure and a
         * monthly figure are the same kind of thing, and `basisMonth` below
         * puts its name in the sentence so nobody has to guess which.
         *
         * The day columns are compared as day STRINGS against the month's own
         * `firstDay`/`lastDay`, which need no timezone at all: the days of a
         * month are the days of that month wherever it is read. Only the
         * payments read takes instants, and those come from `monthWindow` —
         * local midnight, shared with /close and /accounting.
         */
        /**
         * ── And it is cut on the GYM's clock ───────────────────────────────
         *
         * The zone read this screen used to hold was removed when the window
         * became a calendar month, on the argument that "its two ends are
         * already days, so there is no instant left to cut". That is true of
         * the joiners check below and false of the payments read here: this
         * line hands `fromIso`/`toIso` to `fetchPayments`, and those are the
         * one part of a `MonthWindow` that a zone still decides.
         *
         * So the read is back, with a consumer. `fetchGymZone` is the narrow
         * read written for screens that need the zone and nothing else — it
         * does not drag the gym's pay policy and brand colour along with it —
         * and it keeps "the gym has not said" apart from "we could not ask".
         * Both arrive here as null, which is the honest basis for each: neither
         * is a gym whose month is known, and `at.basis` below says so out loud
         * in the sentence that quotes the figure.
         *
         * Which MONTH is the last full one is the gym's fact too, so it comes
         * from `gymRecentMonths` rather than `recentMonths`: for four hours on
         * the 1st those two name different months at a Gulf gym, and this
         * screen would have compared an owner's August entry against July.
         */
        const { zone } = await fetchGymZone(supabase, tenant.id);
        if (!live) return;
        const at = monthAtGym(gymRecentMonths(2, zone).keys[1] ?? '', zone);
        const mw = at?.window ?? null;
        const [plans, memberships, payments] = await Promise.all([
          fetchPlans(supabase, tenant.id),
          fetchMemberships(supabase, tenant.id),
          // Bounded at BOTH ends now. The read is one finished month, which is
          // a smaller and firmer set than thirty rolling days and still cannot
          // outgrow the cap the way "all of history" did.
          mw ? fetchPayments(supabase, tenant.id, mw.fromIso, mw.toIso) : Promise.resolve([]),
        ]);
        if (!live) return;
        const sum = summarise(payments, memberships, plans);
        // summarise returns null when no active membership sits on a priced
        // plan. Passed straight through: "not known" must not become a zero
        // that makes an owner doubt a figure they are right about.
        // `wholeFromMinor`, not `/ 100`. The factor is a property of the
        // currency and it is 1, 100 or 1000 — see src/lib/wholeUnits.ts. This
        // line said `Math.round(sum.mrrCents / 100)`, so a gym billing in yen
        // had a real ¥500,000 of recurring revenue reported back to it as
        // 5,000, flagged as disagreeing with the figure the owner had entered
        // correctly, and offered under a "Use It" button that writes it into
        // their own numbers — after which the health score, the grade and the
        // net-profit sentence are all computed from a figure a hundred times
        // too small. In Kuwaiti dinar it was ten times too big, which is the
        // direction that reads as a good month.
        //
        // Null when the gym has not set a currency, because the stored integer
        // could then be hundredths of something or whole units of it and the
        // decimal point itself would be a guess. The form says so instead —
        // NO_CURRENCY_CHECK_NOTE, below.
        //
        // ── and scaled by the currency the PLANS state, not the gym's ──────
        //
        // `cur` is `tenants.currency`, the gym's current setting. `sum.mrrCents`
        // is every active membership's plan price added together with no regard
        // to what currency each plan states, and `summarise` reports which
        // currency those plans share — null when they share none. This line
        // used `cur` and threw that away, so a gym that has changed currency
        // had a sum of two moneys divided by the new code's decimal places and
        // reported back as the owner's own MRR figure being wrong. The takings
        // check twenty lines below has always grouped on the rows' own currency
        // first; this is that same rule, from the one place it now lives.
        const mrrCcy = sum.mrrCents == null
          ? emptyTotalMoney(cur)
          : totalMoney(sum.mrrCents, sum.mrrCurrency, cur);
        setMrrCcy(mrrCcy);
        // No derived figure at all unless the register's money IS the gym's.
        // Withholding here rather than at the render is what keeps the "your
        // figures and your records disagree" notice further down honest: it
        // fires on `state === 'differs'`, and a figure this screen cannot
        // compare must never reach a comparison. `cur` null makes this false,
        // which is the currency-blind case and was already a dash.
        setDerivedMrr(mrrCcy.gap === 'ok' && mrrCcy.currency === cur
          ? wholeFromMinor(sum.mrrCents, mrrCcy.currency)
          : null);
        setDerivedMembers(memberships.length ? sum.activeMembers : null);

        // Filtered as well as read within the window. The two must agree, and
        // the cheapest way to guarantee that is for them to be the same bounds.
        const recent = mw
          ? payments.filter((p) => p.takenAt >= mw.fromIso && p.takenAt < mw.toIso)
          : [];
        // The currency has to AGREE before there is a total: a gym that changed
        // its currency has two in its ledger and adding them is not a sum. Null
        // withholds the check rather than comparing a typed figure against a
        // number made of two moneys.
        //
        // This was a hand-written `new Set(recent.map((p) => p.currency)).size
        // === 1`, which is `sharedCurrency` with one difference: it does not
        // normalise, so a ledger holding 'gbp' beside 'GBP' read as two moneys
        // and withheld a check the gym was entitled to. It now asks the same
        // question the recurring total above asks, in the same words.
        const takenCents = recent.length
          ? recent.reduce((a, p) => a + p.amountCents, 0)
          : null;
        // Scaled by the currency the rows actually agree on, not by the gym's
        // current setting: a gym that changed its currency last month has a
        // ledger whose older rows are still in the old one, and using `cur`
        // here would divide yen by a hundred the moment the gym switched to
        // GBP.
        const revCcy = takenCents == null
          ? emptyTotalMoney(cur)
          : totalMoney(takenCents, sharedCurrency(recent), cur);
        setRevCcy(revCcy);
        setDerivedRevenue(revCcy.gap === 'ok' && revCcy.currency === cur
          ? wholeFromMinor(takenCents, revCcy.currency)
          : null);

        /**
         * Who joined in the month, compared as DAYS against the month's own
         * first and last day.
         *
         * This was `startedOn >= gymDay(now - 30 days)` — the gym's calendar
         * day, correctly cut, of the wrong window. The cut needed a timezone
         * because one end of it was an instant; a calendar month has two ends
         * that are already days, and the days of August are the days of August
         * wherever the screen is opened. `memberships.startedOn` is a DATE
         * column written by app/(owner)/members.tsx on the gym's own calendar,
         * so both sides of these comparisons are the same kind of day, with no
         * zone in between them to get wrong.
         */
        setDerivedNew(
          mw && memberships.length
            ? memberships.filter((m) => m.startedOn >= mw.firstDay && m.startedOn <= mw.lastDay).length
            : null,
        );
        setBasisMonth(mw ? mw.label : null);
        // The same month, named with the caveat the REVENUE figure needs and
        // the joiners figure does not.
        //
        // Two basis strings rather than one, because the two checks are not
        // equally exposed. Joiners compares `memberships.started_on` — a `date`
        // column — against `firstDay`/`lastDay`, and the days of August are
        // August's wherever they are read: a clock caveat there would be a
        // false caveat, and a caveat that appears where it is not needed is how
        // a reader learns to skip the one that is. Revenue is bounded by
        // instants, and with no zone recorded those instants are this phone's.
        //
        // On the sentence rather than in a comment for the reason `basisMonth`
        // itself is on the sentence: the figure is offered under a button that
        // writes it into the owner's own numbers.
        setBasisClock(
          mw == null ? null
            : at!.basis === 'gym' ? mw.label
              : `${mw.label} — cut on this phone’s clock, because this gym has not set a timezone`,
        );
        setDerivedFailed(false);
        setFetchedAt(Date.now());
      } catch (e) {
        reportError('financials.derived', e);
        // The figures already on screen are from a read that no longer holds,
        // so they are cleared rather than left standing beside the failure.
        if (!live) return;
        setDerivedMrr(null); setDerivedMembers(null);
        setDerivedRevenue(null); setDerivedNew(null); setBasisMonth(null); setBasisClock(null); setDerivedFailed(true);
        setMrrCcy(null); setRevCcy(null);
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
  // `cur` is in here now, and it was not before. It decides whether a derived
  // figure exists at all — a register in a currency other than the gym's is
  // withheld rather than compared — so an owner who sets the currency in Ops
  // and comes back must get a re-read, not the answer computed when the field
  // was still blank. The tenant id does not change on that edit, which is why
  // the previous dependency list did not notice it.
  }, [tenant?.id, tenantStatus, cur, again]);

  // `unreadable` rather than `reconcile(..., null)`: only this screen knows the
  // query threw, and it is the one piece of information that separates "your
  // register is empty" from "we could not read your register".
  const mrrCheck = derivedFailed ? unreadable(fin.mrr) : reconcile(fin.mrr, derivedMrr);

  // ── Recurring revenue, month by month ────────────────────────────────────
  //
  // `derivedMrr` and not `fin.mrr`: the register's own figure rather than the
  // one the owner typed into the form above. A trend assembled from typed
  // figures records how often somebody updated a form, and the reconcile notice
  // ten lines down exists precisely because those two numbers drift apart.
  //
  // It is already null in every case where there is no single honest figure —
  // the currency is unset, or the memberships name more than one and there is
  // no sum to take (see `mrrCcy.gap` where it is computed). Null is what stops
  // the month being recorded at all, which matters more here than anywhere
  // else in the app: this hook writes to the ACCOUNT, so a fabricated zero
  // becomes a permanent month of "this gym took nothing" on every device.
  const mrrHist = useMrrHistory(derivedMrr, cur);
  const mrrHistWhole = isWhole(mrrHist.status);
  const memberCheck = derivedFailed ? unreadable(fin.members) : reconcile(fin.members, derivedMembers);
  const revenueCheck = derivedFailed ? unreadable(fin.revenue) : reconcile(fin.revenue, derivedRevenue);
  const newCheck = derivedFailed ? unreadable(fin.newMembers) : reconcile(fin.newMembers, derivedNew);

  /* ── whose figures these are ─────────────────────────────────────────────
   *
   * Keyed on the auth revision, not on mount. Two separate reasons, and this
   * screen had both:
   *
   *   · `useEffect(…, [])` runs once, when the screen mounts, which under
   *     expo-router is when the owner portal is first opened. Registered
   *     `href: null`, this screen is then NEVER torn down — not by a sign-out,
   *     not by backgrounding the app — so that one read was the only read of
   *     the whole life of the process.
   *   · and it read `repple.owner.financials`, a key with no account in it. The
   *     two together are what put one gym's revenue, expenses and member counts
   *     on screen under the next owner's name, formatted in the next gym's
   *     currency, graded, and offered for overwriting from the next gym's
   *     register. src/lib/ownerFinancialsCache.ts has the full account.
   *
   * `useAuthRevision` moves whenever the signed-in account does, so this now
   * runs on every sign-in and every sign-out rather than once at launch.
   */
  const rev = useAuthRevision();
  useEffect(() => {
    let cancelled = false;
    /**
     * Whether what is on screen RIGHT NOW has somewhere to have gone — read
     * before the line below empties the record it is a fact about.
     *
     * The order matters and getting it wrong is silent. `store.current` is
     * blanked to the cache-for-nobody on the next line, and
     * `mayWriteCache(cacheForAccount(prefix, null))` is false by construction —
     * so asking the question after the blanking always answers "no", which
     * `accountStateStep` reads as "the screen is holding the only copy", which
     * is always `hold`. `forget` becomes unreachable, and a sign-out then
     * leaves the departing owner's eight typed figures sitting in `fin` and
     * their key in `onScreenKey` for the life of the process — hidden behind
     * the `hydrated` render gate rather than dropped.
     */
    const wasSaved = mayWriteCache(store.current);
    // Synchronously, before anything is awaited: the cache record for nobody,
    // un-hydrated, so nothing can be written under the departing account's key
    // while the new one is being resolved.
    store.current = ownerFinancialsCache(null);
    setHydrated(false);
    setHydrateFailed(false);
    setNoAccount(null);
    (async () => {
      // Removed UNREAD, and removed first. The unqualified blob carries no
      // account — nothing on the device says whether it is this owner's August
      // or the last owner's — so reading it into the signed-in account is the
      // defect performed once, deliberately, with a letter grade on the end.
      // A failure to remove it is not worth a sentence to the owner: the key is
      // no longer read by anything, so the only cost is bytes.
      try { await AsyncStorage.removeItem(LEGACY_OWNER_FINANCIALS_KEY); }
      catch (e) { reportError('financials.legacyKey', e); }
      if (cancelled) return;

      // Without a backend there is no account to scope anything to and nothing
      // is persisted. The form still works for the session; `store` stays
      // un-hydrated, so `save` says so rather than writing to a shared key.
      if (!USE_SUPABASE) { setHydrated(true); return; }

      // `signedInUid` names `error` and classifies it. A discarded error is an
      // outage read as a sign-out — see src/lib/authReadFate.ts — and on this
      // screen that would wipe a month of typed figures off the display of
      // somebody who is still perfectly signed in.
      const who = await signedInUid('financials.auth');
      if (cancelled) return;
      const cache = ownerFinancialsCache(who.uid);
      const step = accountStateStep({
        key: cache.key,
        onScreenKey: onScreenKey.current,
        // The same flag that gates the write: whether what is on screen has
        // somewhere to have gone. An unarmed screen is holding the only copy.
        // Captured at the top of this effect, BEFORE `store.current` was
        // emptied — see `wasSaved`.
        onScreenSaved: wasSaved,
      });

      if (step.do === 'hold') {
        // No account, and what is on screen is not on the device. Read nothing,
        // write nothing, change nothing. `noAccount` is what puts a sentence
        // under the blank instead of leaving it unexplained.
        setNoAccount(who.fate ?? 'unreadable');
        return;
      }
      if (step.do === 'forget') {
        // The account is gone and the device has its own copy under its own
        // key. Dropped from memory, never from storage: that is the departing
        // owner's work and it is unreadable to whoever signs in next.
        onScreenKey.current = null;
        setFin(emptyFinances());
        setEntered(new Set());
        setNoAccount(who.fate ?? 'signed-out');
        return;
      }

      // `load`. The wipe happens on the way IN — before the read lands and
      // whatever it decides — so a read that is slow, that fails, or that is
      // refused cannot leave the previous owner's figures on screen under the
      // new owner's name.
      if (step.forget) { setFin(emptyFinances()); setEntered(new Set()); }
      onScreenKey.current = step.key;
      store.current = cache;
      try {
        const raw = await AsyncStorage.getItem(step.key);
        if (cancelled) return;
        // Hydrated only on a read that RETURNED. An empty store is a read that
        // landed; a read that threw is not, and leaving the flag false is what
        // stops this session writing over bytes nobody could read.
        store.current = cacheHydrated(cache);
        const stored = parseOwnerFinancials(raw);
        // Null is "this account has never typed anything", which is already
        // what `fin` and an empty `entered` hold between them. The two are set
        // together, always: figures without the record of which are figures is
        // the pair that produced the Grade A above.
        if (stored) { setFin(stored.figures); setEntered(stored.entered); }
      } catch (e) {
        reportError('financials.hydrate', e);
        if (!cancelled) setHydrateFailed(true);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [rev]);

  const openEditor = useCallback(() => {
    const d: Record<string, string> = {};
    // `entered.has`, not `fin[f.key] ?` — truthiness put a deliberate 0 back
    // into the form as a BLANK box, so an owner who had told this screen their
    // expenses were nil re-opened the editor, saw nothing there, pressed Save,
    // and un-entered the field they had entered. A blank stays blank and a zero
    // stays a zero, which is the same distinction the storage now keeps.
    for (const f of FIELDS) d[f.key] = entered.has(f.key) ? String(fin[f.key]) : '';
    setDraft(d);
    setEditing(true);
  }, [fin, entered]);

  const save = useCallback(async () => {
    // ── a blank box is not a zero ────────────────────────────────────────
    //
    // This loop was:
    //
    //     const n = readNumber(draft[f.key] ?? '');
    //     next[f.key] = n ?? 0;
    //
    // directly beneath a form that says "Leave a field blank if you don't track
    // it." See `entered` above for what that `?? 0` put in front of an owner.
    // `readFinancialsDraft` is the same loop with the substitution removed and
    // a test under plain node; `readNumber` is still the reader, passed in.
    const { figures: next, entered: nextEntered } = readFinancialsDraft(draft, readNumber);
    // `readNumber` and not `replace(/[^0-9.]/g, '')`, which deleted the decimal
    // COMMA and closed the gap — so an owner in Berlin typing 16,5 had 165
    // filed, and every ratio the review below draws was then built on it. These
    // boxes are decimal pads; the comma on them is a decimal point, not a
    // separator to throw away.
    setFin(next);
    setEntered(nextEntered);
    setEditing(false);
    // Two conditions, and neither is an "ignore": no key means there is no
    // account to file these under, and not hydrated means the read of this
    // account's key has not come back or came back refused. In both cases the
    // figures are on screen for this session and are not kept \u2014 which is a
    // smaller loss than writing them to a key the next owner inherits, or on
    // top of bytes nobody managed to read. src/lib/deviceAccountCache.ts.
    const cache = store.current;
    if (!mayWriteCache(cache)) {
      Alert.alert(
        'Not saved on this phone',
        'Your figures are on screen, but this could not confirm which account to file them '
        + 'under, so nothing has been written. They will not survive closing the app. '
        + 'Nothing has been sent anywhere, and nothing already saved has been changed.',
      );
      return;
    }
    try {
      await AsyncStorage.setItem(cache.key, ownerFinancialsBlob(next, nextEntered));
      // Whatever could not be read a moment ago has now been written over by
      // something the owner typed deliberately, so the warning stops being true.
      setHydrateFailed(false);
    } catch (e) {
      reportError('financials.save', e);
      Alert.alert(
        'Not saved on this phone',
        'Your figures are on screen but could not be written to this phone\u2019s storage, so they will not survive closing the app. Nothing has been sent anywhere.',
      );
    }
  }, [draft]);

  /* ── whose gym the register below belongs to ────────────────────────────
   *
   * The month close, the MRR and the 30-day take on this screen are all ONE
   * tenant's — `src/ui/tenant.tsx` reads a single row — and nothing said so.
   * An owner of several gyms closing a month here was closing one of them.
   *
   * Null, and therefore absent, for the single-site owner. Under a failed read
   * the count is unknown rather than 1, and `siteNotice` says that instead of
   * going quiet. */
  const [scope, setScope] = useState<SiteScope>(SITES_LOADING);
  useEffect(() => {
    let live = true;
    void fetchOwnerSites(supabase as any).then((s) => { if (live) setScope(s); });
    return () => { live = false; };
  }, []);
  const sites = siteNotice(scope);

  /**
   * Why no review can be given, or null when one can.
   *
   * `hasFigures` gates on REVENUE, which src/lib/finReview.ts argues out at
   * length. `reviewBlocker` is the same argument applied to the other field
   * every derived figure on this screen is made of — EXPENSES — which that file
   * never gated and this screen therefore reported as nought. See `entered`.
   */
  const blocker = reviewBlocker(entered);
  const ready = hasFigures(fin) && !blocker;
  // The review quotes amounts inside its sentences, so it needs the currency
  // rather than a formatter: with null it writes the same analysis in
  // percentages and leaves the figures out, which is the only honest version
  // when nobody has said what money this gym counts in.
  const r = useMemo(() => (ready ? reviewFinances(fin, cur) : null), [fin, ready, cur]);
  const toneColor = (tone: FinFlag['tone']) => (tone === 'good' ? t.good : tone === 'watch' ? t.warn : t.crit);

  /* ── every tile is a dash unless the figures under it were entered ───────
   *
   * `r` being non-null used to be the whole guard, and `r` only needs revenue
   * and expenses. The other six tiles quoted whatever `emptyFinances()` had
   * left behind:
   *
   *   · MRR and PT + classes printed a formatted "0.00" for a gym that does not
   *     track them here — a stated amount of money, in the gym's own currency,
   *     that nobody had stated;
   *   · Members printed "0" for a gym with two thousand of them;
   *   · and Churn and Net growth quoted `r.churnPct` and `r.growthPct`, which
   *     `reviewFinances` pins to 0 by its own divide-guard when no member count
   *     was entered. finReview.ts closed that trap INSIDE the review — its
   *     `membersKnown` comment says so, in those words — and this row, which
   *     sits directly above the review and is read first, was left quoting the
   *     pinned zeros: "Churn 0.0%" and "Net growth No change" over a gym that
   *     had reported no member numbers at all.
   *
   * A dash, and the caption below the row says what a dash means here. */
  const dash = '—';
  const has = (...keys: (keyof FinInputs)[]) => keys.every((k) => entered.has(k));
  // Churn and growth are rates over members, so they need a member count that
  // is both entered AND non-zero — `reviewFinances` uses the same test, and a
  // rate over nought members is not a low rate, it is no rate.
  const membersKnown = entered.has('members') && fin.members > 0;
  const kpis: [string, string][] = r ? [
    ['Revenue / mo', money(fin.revenue)],
    ['Net profit', money(r.netProfit)],
    ['Margin', num(r.marginPct) + '%'],
    ['MRR', has('mrr') ? money(fin.mrr) : dash],
    ['Members', entered.has('members') ? fin.members.toLocaleString() : dash],
    ['Churn', membersKnown ? num1(r.churnPct) + '%' : dash],
    // A gym that neither grew nor shrank reads "No change", not "+0.0%". The
    // `>= 0` arm put a plus on a month in which nothing happened.
    ['Net growth', membersKnown && has('newMembers', 'churnedMembers')
      ? deltaLabel(r.growthPct, { since: null, unit: '%' })
      : dash],
    ['PT + classes', has('ptRevenue', 'classRevenue')
      ? money(fin.ptRevenue + fin.classRevenue)
      : dash],
  ] : [];

  const G = layout.gutter;
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };

  const flagList = (flags: FinFlag[]) => flags.map((f, i) => (
    <View key={i} style={{
      flexDirection: 'row', gap: sp.md, paddingVertical: sp.md,
      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: toneColor(f.tone) }} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{f.title}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{f.detail}</Text>
      </View>
    </View>
  ));

  // ── "Connect Accounting" is gone ───────────────────────────────────────
  //
  // It was a ListRow over `const [connected] = useState(false)` — a variable
  // with no setter, which nothing could ever set — whose only behaviour was an
  // Alert describing an integration that does not exist. Two states were
  // rendered ("Accounting Connected", "Syncing from Xero") that were
  // unreachable by construction.
  //
  // A control that explains what it would do if it were built is worse than no
  // control: it is indistinguishable from one that is merely misconfigured, so
  // an owner who wants it goes looking for the setting, or asks for help
  // enabling something nobody has written. The manual entry beside it is real
  // and works.
  //
  // Xero and QuickBooks are each an OAuth app, a token store, a sync worker and
  // a chart-of-accounts mapping. When that exists it earns a row here.

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* Back on the LEADING edge, which is where it is on the other seven
            screens in this portal and on every screen in the other two apps.
            It was on the trailing edge here — the same chevron, the same
            action, on the opposite side of the same header — which is the one
            control a reader is never looking for and always reaching for. It
            also put it under the thumb that scrolls, and past the title in
            reading order, so a screen reader announced the screen and then
            offered the way out of it. */}
        <PageHead title="Financial Checks" />
        {/* The typed figures are on this phone; the register they are
            checked against is not. This line is about the register. */}
        <Fetched at={fetchedAt} onRefresh={reread} busy={busy} />
        {/* Says what this is before it says anything about the gym. The
            sentence comes from src/lib/finReview.ts rather than being typed
            here, so a rewrite of this screen cannot quietly drop the one line
            that stops the grade below being read as a verdict from a model. */}
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          {reviewBasis()}
        </Text>
        {/* What the register below covers. Absent entirely for the one-gym
            owner — asserted in ownedSites.test.ts — so this changes nothing
            for almost everybody. */}
        {sites ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{sites}</Text>
        ) : null}

        {/* ── the month end ────────────────────────────────────────────────
            Above the typed figures and outside the `hydrated` gate on purpose:
            everything below this line is the owner's own P&L, typed into this
            phone, and the close is the opposite — the gym's records, read, and
            the one month-end question with a deadline on it. A gym that has
            never typed a figure still has an August to close.

            Read-only. See src/lib/ownerClose.ts for why the button is on the
            console and why its absence is printed rather than left to be
            noticed. */}
        <MonthCloseCard close={monthClose} />


        {/* ── money out ───────────────────────────────────────────────────
            Beside the close rather than under the typed figures, and for the
            same reason the close is here: these are the gym's own records, and
            everything below is what the owner typed into this phone. The two
            are never added to each other — src/lib/gymCosts.ts refuses netting
            under a heading in capitals, and this screen's own "Total Expenses"
            field is a different, local number that nothing here writes to. */}
        <GymCostEntry
          costs={costs}
          currency={cur}
          closesUnread={!isWhole(monthClose.closes.status)}
        />


        {/* ── no account, so no figures ─────────────────────────────────────
            The figures below belong to an account, and until this screen knows
            which one it shows none. Two sentences, because there are two
            reasons and the difference between them is the difference between
            "sign in again" and "this is our end": src/lib/authReadFate.ts.

            Said rather than left blank. Before this the P&L section simply
            rendered nothing behind the `hydrated` gate, so an owner whose auth
            read was refused on gym wifi opened Financials, found the whole
            lower half of the screen missing, and had nothing to tell them
            whether their month had been lost. */}
        {noAccount ? (
          <Section>
            <Notice
              tone={t.warn}
              kicker="Your monthly figures"
              title={noAccount === 'signed-out' ? 'Not shown while you are signed out' : 'We could not check your account'}
              note={noAccount === 'signed-out'
                ? 'Your figures are saved on this phone under your own account, so they are not '
                  + 'shown while nobody is signed in. Nothing has been deleted. Sign in again and '
                  + 'they come back.'
                : 'This could not establish which account is signed in, so it cannot tell whose '
                  + 'figures to show and is showing none. That is our end rather than your sign-in. '
                  + 'Nothing has been changed and nothing has been deleted.'}
            />
          </Section>
        ) : null}

        {!hydrated ? null : editing ? (
          /* ── entry form ───────────────────────────────────────────────── */
          <Section>
            <SectionHead title="Your Monthly Figures" note="This phone only" />
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Leave a field blank if you don't track it. {storageNote()}
            </Text>
            {FIELDS.map((f) => (
              <View key={f.key} style={{ marginBottom: sp.md }}>
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>
                  {f.label} <Text style={{ ...ty.caption, color: t.ink3 }}>({f.hint ?? cur ?? 'currency not set'})</Text>
                </Text>
                <TextInput
                  value={draft[f.key] ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={t.ink3}
                  style={input}
                />
                {/* What the records say, for the four fields Repple can work
                    out for itself. Offered, never imposed — see finReconcile.ts.
                    Churn is not among them and cannot be: nothing in
                    `memberships` records WHEN one was cancelled, so a derived
                    churn would be a guess dressed as a check. */}
                {f.key === 'mrr' || f.key === 'members' || f.key === 'revenue' || f.key === 'newMembers' ? (() => {
                  const chk = f.key === 'mrr' ? mrrCheck
                    : f.key === 'members' ? memberCheck
                    : f.key === 'revenue' ? revenueCheck
                    : newCheck;
                  const val = f.key === 'mrr' ? derivedMrr
                    : f.key === 'members' ? derivedMembers
                    : f.key === 'revenue' ? derivedRevenue
                    : derivedNew;
                  const asMoney = f.key === 'mrr' || f.key === 'revenue';
                  const fmtv = (n: number) => (asMoney ? money(n) : n.toLocaleString());
                  // With no currency the two MONEY checks have a null derived
                  // figure, and `reconcile` reads that as 'no_record' — which
                  // renders "Nothing recorded yet, so your recurring membership
                  // revenue cannot be checked against the register". That
                  // sentence sends an owner looking through memberships they
                  // entered correctly. The register is fine; one field in Ops
                  // is blank, and this says which. The COUNT checks are
                  // unaffected — a member count needs no currency — so they
                  // keep their own wording.
                  const currencyBlind = asMoney && !cur;
                  // The register was read, it is not empty, and it holds more
                  // than one currency — so there is no single figure to check
                  // this against. Said before the currency-blind sentence
                  // because they are different missing things: that one is a
                  // field in Ops, this one is a ledger with two moneys in it,
                  // and the Ops sentence sends an owner to change a setting
                  // that is already right.
                  const reg = f.key === 'mrr' ? mrrCcy : f.key === 'revenue' ? revCcy : null;
                  const mixed = reg?.gap === 'unstated';
                  // One currency, and it is not the one this form is headed in.
                  // Nothing is wrong with either figure; they are simply not
                  // comparable, and a difference stated between them would be a
                  // subtraction across two moneys.
                  const otherMoney = !mixed && !!cur && !!reg?.currency && reg.currency !== cur;
                  const note = mixed
                    ? MIXED_CURRENCY_NOTE
                    : otherMoney
                    ? `The register records this in ${reg!.currency}, and this form is in ${cur}. `
                      + 'Two currencies cannot be compared without a rate this app does not hold, so '
                      + 'nothing here has been checked against what you typed.'
                    : currencyBlind
                    ? NO_CURRENCY_CHECK_NOTE
                    // The month the register figure covers, named in the
                    // sentence that quotes it. The three checks that have a
                    // period — revenue, MRR-adjacent counts and joiners — are
                    // all over the last full month; `members` is a headcount
                    // today and takes no basis.
                    //
                    // And `revenue` takes the basis WITH the clock caveat on
                    // it: its window has instants at both ends and the joiners
                    // window has days, so only one of the two can be cut on the
                    // wrong clock.
                    : reconcileNote(chk, f.label.toLowerCase(), fmtv,
                        f.key === 'members' || f.key === 'mrr' ? null
                          : f.key === 'revenue' ? basisClock : basisMonth);
                  if (!note) return null;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 6 }}>
                      {/* s3 as caption ink does not clear 4.5:1 — it is a series
                          colour, drawn for chart lines at the 3:1 a mark needs.
                          reconcileNote() already says the two figures differ. */}
                      {chk.state === 'differs' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3, flexShrink: 0 }} /> : null}
                      <Text style={{ ...ty.caption, color: chk.state === 'differs' ? t.ink2 : t.ink3, flex: 1 }}>
                        {note}
                      </Text>
                      {/* No "Use It" under the currency-blind sentence: there
                          is no figure to use, and `val` is null there anyway —
                          the condition is written out so the two cannot drift.
                          This button WRITES the derived figure into the owner's
                          own numbers, which is what made the scaling bug above
                          more than a display fault. */}
                      {val != null && !currencyBlind && !mixed && !otherMoney ? (
                        <Ghost label="Use It" onPress={() => setDraft((d) => ({ ...d, [f.key]: String(val) }))} />
                      ) : null}
                    </View>
                  );
                })() : null}
              </View>
            ))}
            <View style={{ height: sp.sm }} />
            <Cta label="Save & Review" wide onPress={save} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Cancel" onPress={() => setEditing(false)} />
          </Section>
        ) : !ready ? (
          /* ── honest empty state: no hero of zeros ─────────────────────── */
          /* A fragment now, not one Section round all three arms: the two
             arms that end in a button are the kit's ActionBlock — a title, the
             reason, where the figures are kept, one full-width button — and
             that is a card of its own. The failed-read arm has no action to
             offer, deliberately, and stays a plain Section. */
          <>
            {/* Two different people arrive here and they must not read the same
                sentence. One has typed nothing. The other typed their member
                counts, left revenue blank, and would otherwise be told "nothing
                is shown until it comes from you" about figures they had just
                entered — which reads as the screen having lost them. */}
            {/* A THIRD person arrives here: one whose figures are on this
                phone and could not be read back off it. "No Figures Yet" is a
                statement about what they have done, and it is false — and the
                Save button below would then write the blank over the top of
                what is still on disk, making the sentence true. */}
            {hydrateFailed && !anyEntered(fin) ? (
              <Section>
                <SectionHead title="Your Figures Could Not Be Read" />
                <Text style={{ ...ty.body, color: t.ink2 }}>
                  This phone&rsquo;s stored copy of your monthly figures did not come back. That is
                  a read that failed, not a month you have not filled in — anything you entered
                  before is still on this phone. Close the app and open it again before typing
                  anything here: saving now writes over whatever is still stored.
                </Text>
              </Section>
            ) : hasFigures(fin) && blocker ? (
              /* ── revenue is in and something the review needs is not ─────
                  A fourth person, and the branch below would have told them
                  "Revenue Is Missing" over the revenue they had just typed.

                  This is the state the `?? 0` above used to hide: the review
                  ran, took the blank as nought, and handed back a 100% margin
                  and a Grade A. The figure is not invented and it is not
                  silently withheld either — the sentence says which field is
                  blank, what it would have been used for, and what the old
                  answer would have been, so an owner can see that the dash is
                  the honest one. src/lib/ownerFinancialsCache.ts writes it. */
              <ActionBlock title="No Score Yet" reason={blocker} meta={storageNote()}
                cta={{ label: 'Fill It In', onPress: openEditor }} />
            ) : (
            <ActionBlock
              title={anyEntered(fin) ? 'Revenue Is Missing' : 'No Figures Yet'}
              reason={anyEntered(fin)
                ? 'Your figures are saved. The review still needs your total revenue for the month — margin, the health score and every recommendation below are a share of it, and without it there is nothing honest to work them out from.'
                : "Enter this month's revenue, expenses and membership numbers. Nothing is shown until it comes from you."}
              /* Before they type, not after. Somebody deciding whether to keep
                 their P&L here needs to know it is kept nowhere else while the
                 decision is still theirs to make. */
              meta={storageNote()}
              cta={{ label: anyEntered(fin) ? 'Add My Revenue' : 'Enter My Figures', onPress: openEditor }} />
            )}
          </>
        ) : r ? (
          <>
            {/* ── the figure ───────────────────────────────────────────── */}
            {/* A card, not the kit's bare `Hero`: the one block on this screen
                the board does not draw. The ring the Hero drew beside the
                score is a bar under it now — the same 0..1, said aloud as a
                progressbar the same way, so "how far through" survives the
                move without a second figure competing with the first. */}
            {(() => {
              const note = cur
                ? `Grade ${r.grade} · ${money(r.netProfit)} net profit on a ${num(r.marginPct)}% margin`
                : `Grade ${r.grade} · a ${num(r.marginPct)}% net margin. The amounts are not written here because this gym has not set its currency.`;
              const pctOf100 = Math.round(Math.max(0, Math.min(100, r.score)));
              return (
                /* The kit's FigureCard, which is this card: the head, one
                   figure shrunk to fit with its unit, the sentence under it,
                   and one spoken line for all of it. The meter is a child, so
                   it stays its own element outside that line. */
                <FigureCard title="Health Score" note={`Grade ${r.grade}`}
                  figure={fig(r.score)} unit="/100" detail={note}
                  /* `r.score` is a number by type — the review has run —
                     so the spoken sentence carries it directly rather than
                     through fig(), which could only ever draw the dash a
                     sentence must not contain. */
                  spoken={`Health score, ${num(r.score)} out of 100, ${note}`}>
                  <View accessible accessibilityRole="progressbar" accessibilityLabel={`${pctOf100}% health score`}
                    accessibilityValue={{ min: 0, max: 100, now: pctOf100 }}
                    style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: sp.lg, overflow: 'hidden' }}>
                    <View style={{ height: 3, borderRadius: 2, width: `${pctOf100}%`, backgroundColor: t.brand }} />
                  </View>
                </FigureCard>
              );
            })()}

            {/* The score is built on what was typed. If the register disagrees,
                say so here rather than only inside the edit form — this is the
                screen somebody acts on. */}
            {[mrrCheck, memberCheck, revenueCheck, newCheck].some((c) => c.state === 'differs') ? (
              <Notice
                tone={t.s3}
                kicker="Worth a look"
                title="Your figures and your records disagree"
                note={[
                  mrrCheck.state === 'differs' ? reconcileNote(mrrCheck, 'MRR', money) : null,
                  memberCheck.state === 'differs' ? reconcileNote(memberCheck, 'member count', (n) => n.toLocaleString()) : null,
                  revenueCheck.state === 'differs' ? reconcileNote(revenueCheck, 'monthly revenue', money) : null,
                  newCheck.state === 'differs' ? reconcileNote(newCheck, 'members joined this month', (n) => n.toLocaleString()) : null,
                ].filter(Boolean).join(' ') + ' This score is worked out from what you entered, not from the register.'}
              />
            ) : null}

            <Rule />

            {/* ── recurring revenue, month by month ───────────────────────
                Built from the REGISTER, not from the form above, and keyed by
                the gym's currency so a gym that changes currency starts a new
                line instead of drawing two moneys as one. See useMrrHistory. */}
            <Section>
              <SectionHead title="Recurring Revenue Trend"
                note={!mrrHistWhole ? 'your months could not be read'
                  : cur == null ? 'set a currency to record it'
                  /* `money`, not `num`: this delta is CURRENCY, and the gym's
                     own. The Sessions Trend beside it was shipped printing a
                     count with a dollar sign in front of it for exactly the
                     want of this distinction. */
                  : mrrHist.delta !== 0 ? `${deltaSign(mrrHist.delta, 0)}${money(Math.abs(mrrHist.delta))} vs last mo`
                  : mrrHist.months >= 2 ? 'level with last month'
                  : 'Tracking started'} />
              {!mrrHistWhole ? (
                /* Not "no history yet" — that is a claim about this gym, and
                   under a failed read the only months in hand are whatever
                   this handset happened to keep. */
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Your recorded months could not be read, so the trend is held back. Pull down to try again.
                </Text>
              ) : cur == null ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>{NO_CURRENCY_CHECK_NOTE}</Text>
              ) : derivedMrr == null ? (
                /* The register could not produce ONE figure this month. Said
                   rather than drawn as a gap, because a reader looking at a
                   line that stops needs to know it stopped for a reason. */
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {mrrCcy && mrrCcy.gap !== 'ok' ? MIXED_CURRENCY_NOTE
                    : 'No recurring revenue could be worked out from your register this month, so this month is not recorded. Months already recorded are kept.'}
                </Text>
              ) : mrrHist.months >= 2 ? (
                /* The series goes in WITH its holes and the labels with it, so
                   a month nobody recorded breaks the line rather than being
                   closed over. Same discipline as the Sessions Trend. */
                <Spark data={mrrHist.series} labels={mrrHist.labels} />
              ) : (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  This month is recorded. A trend needs a second month — come back after your next billing month and this becomes a line.
                </Text>
              )}
            </Section>

            <Rule />

            <Section>
              <SectionHead title="What These Figures Say" note={`Grade ${r.grade}`} />
              <Text style={{ ...ty.body, color: t.ink2 }}>{r.summary}</Text>
            </Section>

            <Rule />

            <Section>
              <SectionHead title="This Month" note="From your figures" />
              {[0, 2, 4, 6].map((i) => (
                <View key={i} style={{ marginTop: i === 0 ? 0 : sp.lg }}>
                  <KpiRow items={kpis.slice(i, i + 2).map(([l, v]) => ({ label: l, value: v }))} />
                </View>
              ))}
              {/* What a dash on this row means, said once beneath it. Without
                  it a withheld tile and a tile reading 0.00 look equally like
                  an answer, and the whole point of withholding is that one of
                  them is not. Only shown when there IS a dash. */}
              {kpis.some(([, v]) => v === dash) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  A dash is a figure you have not entered, not a nought. Leaving a box blank is a
                  perfectly good answer — it only means this row and the score above it stop
                  speaking for that line rather than reporting it as nothing.
                </Text>
              ) : null}
            </Section>

            {r.strengths.length > 0 ? (<>
              <Rule />
              <Section>
                <SectionHead title="What's Working" />
                {flagList(r.strengths)}
              </Section>
            </>) : null}

            <Rule />

            {/* A heading with nothing under it is a section that failed to
                load, and that is how an A-grade gym read this one: every flag
                had gone to "What's Working" and this drew its title over blank
                space. A gym with nothing to fix is told so. */}
            <Section>
              <SectionHead title="Where to Improve" />
              {r.improvements.length > 0 ? flagList(r.improvements) : (
                <Text style={{ ...ty.body, color: t.ink2 }}>
                  Nothing is flagged on these figures — margin, retention, growth and your
                  recurring mix all read well this month.
                </Text>
              )}
            </Section>

            <Rule />

            <Section>
              <Cta label="Create a Promotion" wide onPress={() => router.push('/(owner)/promotions')} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Update My Figures" onPress={openEditor} />
              {/* Two separate things an owner has to be told, and neither
                  substitutes for the other: what produced the grade above, and
                  where the numbers behind it are kept. */}
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.md }}>
                Worked out by fixed rules from the figures you entered. No accounting is connected,
                and this is not financial advice.
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
                {storageNote()}
              </Text>
            </Section>
          </>
        ) : null}



      </ScrollView>
    </SafeAreaView>
  );
}
