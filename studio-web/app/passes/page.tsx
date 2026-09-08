'use client';

// Passes — what the gym gave out, and what happened next.
//
// A gym hands out guest passes and day passes all week and has never had a
// screen that asks the obvious question: did any of those people come back and
// sign up, and which members are bringing the ones who do? /door records the
// visit, /money records the membership, and nothing joined the two.
//
// The join is easy. Presenting it honestly is not, and this page is mostly the
// second problem. `src/lib/passConversion.ts` holds the reasoning; everything
// here is rendering it without quietly upgrading it on the way out:
//
//  · It never says "converted". A pass and a later membership are a sequence.
//    The interval is a fact; the arrow between them is not, and CAUSAL_CAVEAT
//    is printed at the top of the page rather than left to a footnote.
//  · A pass sold to a walk-in with no account is EXCLUDED and counted out loud.
//    A gym that mostly sells anonymous day passes would otherwise read as
//    having terrible conversion when the truth is that nobody could tell.
//  · No percentage below the floor /retention uses, from the same constant.
//  · A pass that has not run out has not failed, so its holder is not in the
//    denominator yet.
//  · Two money figures, never one, and no total. Pass income is cash already
//    taken; the membership figure is a monthly value that has not been taken.
//
// Four independent reads, four independent failures. "Not loaded", "loaded and
// empty" and "the read failed" render differently everywhere on this page,
// because a failed roster query drawn as an empty roster would report that not
// one pass holder has ever joined this gym.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, fetchPlans, money, summarise } from '@lib/gymRecord';
import { fetchPassVisits } from '@lib/passVisits';
import { fetchPasses } from '@lib/gymPasses';
import { fetchMemberRecords, byMember, contactLine, type GymMemberRecord } from '@lib/gymMembers';
import { searchRows, searchNote } from '@lib/consoleSearch';
import { toCsv } from '@lib/gymExport';
import { sliceLoading, sliceReady, sliceFailed, rowsOf, type Slice } from '@lib/memberView';
// The one rule about what a SUM is denominated in, and the one wording for
// the silence a mixed ledger produces. Imported rather than restated: the
// sentence under a withheld total is the whole point of the module, and a
// screen that writes its own drifts into blaming the gym's currency setting
// for something that setting has nothing to do with.
import { totalMoney, emptyTotalMoney, MIXED_CURRENCY_NOTE } from '@lib/sumCurrency';
import { noGymNote } from '@lib/gymLink';
import { Fetched, useFetched } from '@/components/Fetched';
import { Banner } from '@/components/Banner';
import { num } from '@/lib/num';
import {
  buildPassConversion, suppressionSentence,
  CAUSAL_CAVEAT, MONEY_NOTE, CONVERSION_LABEL, CONVERSION_COST,
  type PassConversionRecord, type PassConversion, type PassHolder,
  type HostGuests, type HolderOutcome, type ConversionPart,
} from '@lib/passConversion';

const EMPTY: PassConversionRecord = {
  passes: sliceLoading(),
  memberships: sliceLoading(),
  visits: sliceLoading(),
  plans: sliceLoading(),
};

/** How the four outcomes read on screen, and in what order. Every one of these
 *  words is chosen to describe the RECORD rather than to praise or blame. */
const OUTCOME_LABEL: Record<HolderOutcome, string> = {
  'joined-after': 'used a pass, then joined',
  'undecided': 'pass still live — undecided',
  'no-membership': 'pass ran out, no membership',
  'already-member': 'already a member when issued',
};

const OUTCOME_COLOUR: Record<HolderOutcome, string> = {
  'joined-after': 'var(--good)',
  'undecided': 'var(--warn)',
  'no-membership': 'var(--crit)',
  'already-member': 'var(--ink3)',
};

const OUTCOME_ORDER: HolderOutcome[] = ['joined-after', 'undecided', 'no-membership', 'already-member'];

export default function Passes() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  /**
   * True when the gym's NAME could not be READ, as distinct from there being no
   * gym.
   *
   * The read below already discards its error deliberately — no figure on this
   * page depends on the name — but `gymName: null` was carrying both facts, and
   * the rail prints "No gym linked" for a null it is given no other word for.
   * That is a sentence about the OWNER'S ACCOUNT produced by a query that
   * failed, on every screen in the console at once. Carrying this one bit is
   * what lets the rail say which of the two it is. See components/Shell.tsx.
   */
  const [gymNameUnread, setGymNameUnread] = useState(false);
  // `tenants.currency`. The Paid column sums a person's passes, so it has no
  // single row's currency to borrow and inherits the gym's — or prints nothing.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  const [rec, setRec] = useState<PassConversionRecord>(EMPTY);
  // Null is "not read", never an empty Map: "no phone number recorded" and
  // "we could not ask" send an owner to two different places.
  const [contacts, setContacts] = useState<Map<string, GymMemberRecord> | null>(null);
  const [contactsErr, setContactsErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string): Promise<boolean> => {
    // Four reads, deliberately not one Promise.all behind a single catch. A
    // price book that 500s must not take the pass counts down with it — the
    // page may be partial, but only if it says which part and what that costs.
    //
    // No window on the visits: a pass issued eighteen months ago and redeemed
    // the week after is exactly the case this page exists to find, and a
    // rolling window would silently drop it and report the pass as unused.
    //
    // This asked `fetchVisits` for the gym's WHOLE door log to get that, which
    // is the one shape src/lib/gymVisits.ts refuses outright — so the screen
    // threw for every gym past a thousand scans, which at a busy front desk is
    // about a month, and pass income and the call list went with it.
    // `fetchPassVisits` reads the same set the page actually uses — the visits
    // a pass paid for — bounded by that filter rather than by a date, and
    // paged, so the eighteen-month-old redemption is still found.
    const [passes, memberships, visits, plans] = await Promise.all([
      slice(() => fetchPasses(supabase, tenantId)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPassVisits(supabase, tenantId)),
      slice(() => fetchPlans(supabase, tenantId)),
    ]);
    setRec({ passes, memberships, visits, plans });
    // Whole only when all four came back. The stamp under the tiles is the age
    // of the last read that was whole, so a refresh in which the price book
    // failed does not move it — the banner beside it names which part is
    // missing, which is the sentence this screen already knew how to write.
    return passes.state === 'ready' && memberships.state === 'ready'
      && visits.state === 'ready' && plans.state === 'ready';
  }, []);

  /*
   * The pass list, kept current.
   *
   * /door redeems against the same `gym_passes` rows and re-reads them every
   * thirty seconds; this screen read once and stopped, so the two screens in
   * the same building disagreed by however long this tab had been open. The
   * report it produces is a call list of people whose passes ran out and did
   * not join — and somebody who came in this morning and bought a membership at
   * the desk was on it, and got phoned about it.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId ? load(me.tenantId) : Promise.resolve(false)),
    { everyMs: 2 * 60_000 },
  );

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      // An account with no gym ran NONE of the four reads, and this wrote
      // `sliceReady([])` for all four — four reads reported as having succeeded
      // and found nothing. `buildPassConversion` then produced its full report
      // over that: conversion counts, the suppression sentence and an empty
      // call list. A receptionist whose account lost its gym link was told this
      // gym has issued no passes and converted nobody, which is a specific
      // finding about the business assembled out of a fact about their profile
      // — the same substitution the last roadmap found on /accounting, /costs
      // and /close. The render below stops before the report and says which it
      // is; the record is left in its opening state, which is honest, because
      // nothing was read.
      if (!who?.tenantId) return;
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, currency').eq('id', who.tenantId).single();
      // supabase-js RESOLVES on a database error, so this is checked rather
      // than assumed: a null name here means "not read", not "unnamed gym".
      if (live) {
        setGymName(tErr ? null : t?.name ?? null);
        setGymNameUnread(!!tErr);
        setCcy(tErr ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
      }
      // The gym's own contact details, read separately. This page produces a
      // CALL LIST and had no way to call anybody: nothing in the schema carried
      // a phone number until part 197, and `profiles` has neither a number nor
      // an address a client may read.
      //
      // Separate from `load` on purpose — a gym that has not applied part 197
      // gets one stated failure on one section rather than a page that will not
      // load at all.
      try {
        const rows = await fetchMemberRecords(supabase, who.tenantId);
        if (live) { setContacts(byMember(rows)); setContactsErr(null); }
      } catch (e: any) {
        if (live) { setContacts(null); setContactsErr(e?.message ?? 'The gym’s contact details could not be read.'); }
      }
      // Through `refresh`, so the first read stamps the same way every later
      // one does.
      refresh();
    })();
    return () => { live = false; };
  }, [load, refresh]);

  const c = useMemo(() => buildPassConversion(rec), [rec]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/passes">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/passes">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          This page carries pass income and the membership roster, so it is owner-only.
        </p>
      </Shell>
    );
  }

  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/passes">
        <h1>Passes</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('passes, memberships or door visits')}
        </p>
      </Shell>
    );
  }

  const rate = c.joinedAfterRate;

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/passes">
      <h1>Passes</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Guest passes and day passes, who held them, and which of those people
        later took out a membership.
      </p>

      {/* Printed first and always, including on an empty gym: the reader will
          supply the causal reading themselves if the page does not refuse it. */}
      <Banner>{CAUSAL_CAVEAT}</Banner>

      {/* When these figures were read. /door redeems against the same rows
          every thirty seconds; this screen used to read once and stop. */}
      <Fetched at={readAt} busy={reading} onRefresh={refresh} what="the pass record" />

      {c.warning ? <Banner tone="crit">{c.warning}</Banner> : null}
      {c.loading.length ? (
        <Banner>
          Still reading {c.loading.map((p) => CONVERSION_LABEL[p]).join(', ')}. Figures
          below are incomplete rather than final.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Passes issued"
          text={c.passes ? String(c.passes.issued) : null}
          note={stateNote(rec.passes, 'passes not read', c.passes ? `${c.passes.live} still live` : undefined)}
        />
        {/* The four tiles below hand-rolled a TWO-arm version of `stateNote`,
            which is directly under this file and keeps four states apart. Two
            costs, both of them the page's own headline claim made out of a read
            that did not happen:

              · `=== 'failed'` admitted 'loading' and 'partial'. Under a
                truncated pass read every one of these figures is withheld
                (`buildPassConversion` returns null for the lot when
                `rowsOf(rec.passes)` is null) and the note read as though the
                query had been fine.
              · "Typical gap" and "Held a pass, then joined" branched on the
                MEMBERSHIPS slice alone, and both are null when the PASSES read
                fails too — so a gym whose pass query was refused, with a
                perfectly healthy roster, was told "nobody has joined after a
                pass". That is a finding about the business produced by a broken
                query, and it is the sentence this whole page exists to make. */}
        <Kpi
          label="Used at least once"
          text={c.redeemedPasses == null ? null : String(c.redeemedPasses)}
          note={
            rec.passes.state !== 'ready' ? stateNote(rec.passes, 'passes not read')
              : c.redemptionVisits == null ? stateNote(rec.visits, 'door log not read')
              : `${c.redemptionVisits} seen by the door log`
          }
        />
        <Kpi
          label="To a walk-in"
          text={c.anonymousPasses == null ? null : String(c.anonymousPasses)}
          note={
            rec.passes.state !== 'ready' ? stateNote(rec.passes, 'passes not read')
              : c.anonymousPasses ? 'no account — excluded below'
              : 'every pass carries an account'
          }
        />
        <Kpi
          label="Held a pass, then joined"
          text={c.counts == null ? null : String(c.counts.joinedAfter)}
          note={
            rec.passes.state !== 'ready' ? stateNote(rec.passes, 'passes not read')
              : rec.memberships.state !== 'ready' ? stateNote(rec.memberships, 'roster not read')
              : c.counts == null ? undefined
              : `of ${c.counts.decided} whose pass has run out`
          }
        />
        <Kpi
          label="Typical gap"
          text={c.interval == null ? null : `${c.interval.medianDays}d`}
          note={
            c.interval != null
              ? `median of ${c.interval.n}, ${c.interval.minDays}–${c.interval.maxDays} days`
              : rec.passes.state !== 'ready' ? stateNote(rec.passes, 'passes not read')
              : rec.memberships.state !== 'ready' ? stateNote(rec.memberships, 'roster not read')
              : 'nobody has joined after a pass'
          }
        />
      </div>

      {c.attributionNote ? <Banner tone="crit">{c.attributionNote}</Banner> : null}
      {c.undecidedNote ? <Banner>{c.undecidedNote}</Banner> : null}

      <Section
        title="Used a pass, then joined"
        sub="Deliberately not called a conversion rate. It is the share of pass holders whose pass has run out who later appear on the roster."
      >
        {rec.passes.state === 'loading' || rec.memberships.state === 'loading' ? <Loading /> : null}
        {rec.memberships.state === 'failed' ? (
          <Failed reason={reasonOf(rec.memberships)} part="memberships" />
        ) : null}
        {rec.passes.state === 'failed' ? <Failed reason={reasonOf(rec.passes)} part="passes" /> : null}
        <Truncated s={rec.memberships} part="the roster" />
        <Truncated s={rec.passes} part="passes" />

        {c.counts ? (
          <div style={{ padding: '18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 34, letterSpacing: '-0.03em', color: rate == null ? 'var(--ink3)' : 'var(--ink)' }}>
                {rate == null ? '—' : `${Math.round(rate * 100)}%`}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
                {c.counts.joinedAfter} of {c.counts.decided} decided holders
              </span>
            </div>
            {rate == null ? (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink2)' }}>
                {suppressionSentence(c)}
              </p>
            ) : null}
            {c.headline ? (
              <p style={{ margin: '12px 0 0', fontSize: 13.5, color: 'var(--ink2)', maxWidth: 760 }}>
                {c.headline}
              </p>
            ) : null}

            <div style={{ marginTop: 18 }}>
              <OutcomeBar c={c} />
            </div>

            <p style={{ margin: '16px 0 0', fontSize: 11.5, color: 'var(--ink3)', maxWidth: 760 }}>
              {c.floorNote}
            </p>
          </div>
        ) : null}
      </Section>

      <Section
        title="How long it took"
        sub="Days from a holder's first pass to their membership starting. Measured from the issue date, because every pass has one."
      >
        {rec.memberships.state === 'loading' ? <Loading /> : null}
        {rec.memberships.state === 'failed' ? (
          <Failed reason={reasonOf(rec.memberships)} part="memberships" />
        ) : null}
        <Truncated s={rec.memberships} part="the roster" />
        <Truncated s={rec.passes} part="passes" />
        {rec.memberships.state === 'ready' && rec.passes.state === 'ready' ? (
          c.interval ? (
            <div style={{ padding: '18px 16px' }}>
              <IntervalStrip days={c.interval.days} median={c.interval.medianDays} />
              <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--ink3)', maxWidth: 700 }}>
                The median, not the mean, and the whole spread beside it — one
                guest who took a pass and joined two years later would drag an
                average somewhere no gym should plan against. {c.interval.n} of
                the gym&rsquo;s pass holders are in this chart.
              </p>
            </div>
          ) : (
            <p style={{ padding: '26px 20px', margin: 0, color: 'var(--ink3)', fontSize: 13.5 }}>
              Nobody on the roster took out a membership after holding a pass, so
              there is no interval to draw. That is a reading of the record, not
              a gap in it.
            </p>
          )
        ) : null}
      </Section>

      <CallList c={c} rec={rec} contacts={contacts} contactsErr={contactsErr} />
      <Holders c={c} rec={rec} ccy={ccy} contacts={contacts} />
      <Hosts c={c} rec={rec} />
      <Money c={c} rec={rec} ccy={ccy} />
    </Shell>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Run one read into a slice.
 *
 * The fetchers in src/lib all check `.error` explicitly and throw — supabase-js
 * RESOLVES on a database error, so without that check every one of them would
 * return an empty array and this page would draw a gym that has never issued a
 * pass. Here that throw becomes a STATED failure rather than an empty list.
 */
async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e: any) {
    return sliceFailed(e?.message ?? 'The read failed.');
  }
}

function reasonOf(s: Slice<unknown>): string {
  return s.state === 'failed' ? s.reason : '';
}

/** A KPI footnote that keeps the four states apart. */
function stateNote(s: Slice<unknown>, failed: string, ready?: string): string | undefined {
  if (s.state === 'failed') return failed;
  if (s.state === 'loading') return undefined;
  // Its own arm, and not `ready`'s. A truncated read used to fall through to
  // the ready sentence — "1,240 still live" over a figure taken from a prefix.
  if (s.state === 'partial') return `only the first ${s.cap} rows came back, so this is a prefix and the figure is withheld`;
  return ready;
}

/* ── charts: hand-authored inline SVG, no library ──────────────────────────── */

/**
 * The identified holders in four bands.
 *
 * The two bands that are NOT in the rate — undecided, and already a member —
 * are drawn beside the two that are, so the reader can see how much of the
 * gym's pass-giving the percentage above actually describes. Hiding them would
 * make a small denominator look like the whole story.
 */
function OutcomeBar({ c }: { c: PassConversion }) {
  const counts = c.counts;
  if (!counts) return null;
  const n = counts.identified;
  const parts = OUTCOME_ORDER.map((o) => ({
    key: o,
    label: OUTCOME_LABEL[o],
    colour: OUTCOME_COLOUR[o],
    n: o === 'joined-after' ? counts.joinedAfter
      : o === 'undecided' ? counts.undecided
      : o === 'no-membership' ? counts.noMembership
      : counts.alreadyMember,
  }));

  const W = 600, H = 26;
  const anon = c.anonymousPasses ?? 0;
  const label =
    `${n} identified pass holders in four groups: `
    + parts.map((p) => `${p.n} ${p.label}`).join(', ')
    + `.${anon ? ` A further ${anon} passes went to walk-ins with no account and are not in this chart at all, because whether they joined cannot be answered.` : ''}`;

  let x = 0;
  const rects = parts.map((p) => {
    const w = n > 0 ? (p.n / n) * W : 0;
    const r = { ...p, x, w };
    x += w;
    return r;
  });

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        role="img" aria-label={label}
        style={{ display: 'block', borderRadius: 0, overflow: 'hidden', background: 'var(--surface2)' }}
      >
        {rects.map((r) => (r.w > 0 ? (
          <rect key={r.key} x={r.x} y={0} width={r.w} height={H} fill={r.colour} />
        ) : null))}
      </svg>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 14, marginTop: 14,
      }}>
        {parts.map((p) => (
          <div key={p.key} style={{ display: 'flex', gap: 9 }}>
            <span style={{ width: 3, borderRadius: 0, background: p.colour, flex: 'none' }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 17, letterSpacing: '-0.02em' }}>{p.n}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)' }}>{p.label}</div>
            </div>
          </div>
        ))}
      </div>
      {anon ? (
        <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>
          Not shown: {anon} pass{anon === 1 ? '' : 'es'} to a walk-in with no
          account. They are outside the chart because they are outside the
          question — and they cannot be counted as people either, since two
          anonymous passes may be one person twice.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Every gap from first pass to joining, as one mark each, with the median
 * marked.
 *
 * A strip rather than a histogram: with a handful of joiners, bucket widths do
 * more of the arguing than the data does, and a reader can count three dots.
 * Deliberately no trend line and no curve — there is no model here.
 */
function IntervalStrip({ days, median }: { days: number[]; median: number }) {
  const W = 620, H = 92, PAD = 26, BASE = 58;
  const max = Math.max(median, ...days, 1);
  const at = (d: number) => PAD + (d / max) * (W - PAD * 2);

  const label =
    `Days between a pass holder's first pass and their membership starting, ${days.length} `
    + `${days.length === 1 ? 'person' : 'people'}: ${days.join(', ')} days. `
    + `Median ${median} days, longest ${Math.max(...days)}, shortest ${Math.min(...days)}.`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
      role="img" aria-label={label}
      style={{ display: 'block', maxWidth: '100%' }}
    >
      <line x1={PAD} y1={BASE} x2={W - PAD} y2={BASE} stroke="var(--ring)" strokeWidth={1} />
      {/* the median, named on the chart rather than in a caption underneath */}
      <line x1={at(median)} y1={BASE - 26} x2={at(median)} y2={BASE + 8} stroke="var(--brand)" strokeWidth={2} />
      <text x={at(median)} y={BASE - 32} textAnchor="middle" fontSize={10.5} fontFamily="var(--mono)" fill="var(--brand)">
        median {median}d
      </text>
      {days.map((d, i) => (
        <circle
          key={`${d}-${i}`} cx={at(d)} cy={BASE} r={5}
          fill="var(--good)" fillOpacity={0.75} stroke="var(--surface)" strokeWidth={1}
        />
      ))}
      <text x={PAD} y={BASE + 24} textAnchor="start" fontSize={10} fontFamily="var(--mono)" fill="var(--ink3)">
        0d
      </text>
      <text x={W - PAD} y={BASE + 24} textAnchor="end" fontSize={10} fontFamily="var(--mono)" fill="var(--ink3)">
        {max}d
      </text>
    </svg>
  );
}

/* ── holders ───────────────────────────────────────────────────────────────── */

function Holders({ c, rec, ccy, contacts }: {
  c: PassConversion; rec: PassConversionRecord; ccy: TenantCurrency;
  contacts: Map<string, GymMemberRecord> | null;
}) {
  const cols: Column<PassHolder>[] = [
    {
      key: 'name', header: 'Holder', value: (h) => h.name ?? '￿',
      // A link, not a label. This table names people and every one of them has
      // a record two clicks away that the page had no way to reach: /retention
      // had the same shape, naming a drifting member and linking to a roster
      // with no id on it.
      render: (h) => (
        <a href={`/members?member=${encodeURIComponent(h.holderId)}`} style={{ color: 'var(--brand)' }}>
          {h.name ?? 'unnamed account'}
        </a>
      ),
    },
    {
      key: 'contact', header: 'Reach them on', value: (h) => contactLine(contacts?.get(h.holderId) ?? null),
      render: (h) => {
        // Three answers, not two: the gym has a number, the gym has none, or
        // nobody could read the records. Only the middle one is a fact about
        // this person.
        if (contacts === null) return <span className="dash">not read</span>;
        return contactLine(contacts.get(h.holderId) ?? null)
          ?? <span className="dash">nothing recorded</span>;
      },
    },
    { key: 'passes', header: 'Passes', value: (h) => h.passes, numeric: true },
    {
      key: 'used', header: 'Used', value: (h) => h.redeemed, numeric: true,
      render: (h) => `${h.redeemed} of ${h.passes}`,
    },
    { key: 'first', header: 'First pass', value: (h) => h.firstPassOn || null },
    {
      key: 'firstUsed', header: 'First seen at the door', value: (h) => h.firstUsedOn,
      render: (h) => <Cell state={rec.visits.state} value={h.firstUsedOn} empty="no door record" />,
    },
    {
      key: 'outcome', header: 'What happened', value: (h) => OUTCOME_ORDER.indexOf(h.outcome), numeric: true,
      render: (h) => (
        <span style={{ color: OUTCOME_COLOUR[h.outcome] }}>{OUTCOME_LABEL[h.outcome]}</span>
      ),
    },
    {
      key: 'gap', header: 'Days to joining', value: (h) => h.daysToJoin, numeric: true,
      render: (h) => h.daysToJoin == null
        ? <span className="dash">—</span>
        : h.daysToJoin === 0 ? 'same day' : `${h.daysToJoin}d`,
    },
    {
      key: 'status', header: 'Membership now', value: (h) => h.statusNow,
      render: (h) => h.statusNow
        ? <span style={{ textTransform: 'capitalize' }}>{h.statusNow}</span>
        : <span className="dash">none</span>,
    },
    {
      // Sorted on the figure only where the figure is one — a cross-currency
      // sum is not a bigger number and must not order the table either.
      key: 'paid', header: 'Paid for passes', value: (h) => (h.paidCurrency ? h.paidCents : null), numeric: true,
      /* ── the currency the PASSES agree on, never the gym's setting ──────
         This was `amount(h.paidCents, ccy)`. `paidCents` is `passRevenueCents`'s
         blind sum over every priced pass this person holds, and `ccy` is
         `tenants.currency` as it stands today, so:

           · a holder with a GBP pass and an AED pass had the two ADDED and the
             result printed in whatever the gym charges in now — and adding
             minor units across a two-place and a zero-place currency is wrong
             twice over;
           · a gym that has ever changed its currency had every holder's figure
             silently re-denominated.

         The "Taken for passes" tile at the top of this same screen already
         refuses both, on `money(m.passCents, m.currency)`, and /members carries
         the identical repair with the identical reasoning. This was the row
         that was left. */
      render: (h) => h.paidCents == null
        ? <span className="dash">no price recorded</span>
        : money(h.paidCents, h.paidCurrency)
          ?? <span className="dash">{h.paidMixed
            ? `priced in ${h.paidCurrencies.length ? h.paidCurrencies.join(' and ') : 'more than one currency'} — not one figure`
            : NO_CURRENCY_NOTE}</span>,
    },
  ];

  return (
    <Section
      title="Pass holders"
      sub="One row per person, never per pass — somebody handed four guest passes who then joined is one person who joined."
    >
      {rec.passes.state === 'loading' || rec.memberships.state === 'loading' ? <Loading /> : null}
      {rec.passes.state === 'failed' ? <Failed reason={reasonOf(rec.passes)} part="passes" /> : null}
      {rec.memberships.state === 'failed' ? (
        <Failed reason={reasonOf(rec.memberships)} part="memberships" />
      ) : null}
      <Truncated s={rec.passes} part="passes" />
      <Truncated s={rec.memberships} part="the roster" />
      {c.holders ? (
        <DataTable noun="pass holders"
          rows={c.holders} columns={cols} rowKey={(h) => h.holderId}
          empty="No pass has been issued to somebody with an account. Passes sold to walk-ins are listed nowhere here, because there is no person for them to be a row about."
        />
      ) : null}
    </Section>
  );
}

/* ── the list this page exists to produce ──────────────────────────────────── */

/**
 * People who held a pass, used it up, and never joined.
 *
 * ── Why this is a section rather than a filter on the table below ─────────
 *
 * Because it is the only thing on this page anybody DOES anything with.
 * /passes measures whether pass holders convert; the answer is a percentage,
 * and the action behind the percentage is a phone call to a specific list of
 * named people. That list was computed, rendered inside a seven-column table
 * mixed with three other outcomes, and offered no contact, no export, no way to
 * log the call and no link to the person's record. It was a dead end, and the
 * same shape appears on /staff.
 *
 * `undecided` holders are deliberately excluded: their pass is still live, they
 * have not decided anything, and ringing somebody who has three visits left to
 * ask why they did not join is the wrong conversation.
 */
function CallList({ c, rec, contacts, contactsErr }: {
  c: PassConversion; rec: PassConversionRecord;
  contacts: Map<string, GymMemberRecord> | null; contactsErr: string | null;
}) {
  const [q, setQ] = useState('');

  const all = (c.holders ?? []).filter((h) => h.outcome === 'no-membership');
  const shown = searchRows(all, q, (h) => [
    h.name, contactLine(contacts?.get(h.holderId) ?? null),
  ]);
  const note = searchNote(q, shown.length, all.length);
  const reachable = all.filter((h) => contactLine(contacts?.get(h.holderId) ?? null) !== null).length;

  const cols: Column<PassHolder>[] = [
    { key: 'name', header: 'Who', value: (h) => h.name ?? '￿',
      render: (h) => (
        <a href={`/members?member=${encodeURIComponent(h.holderId)}`} style={{ color: 'var(--brand)' }}>
          {h.name ?? 'unnamed account'}
        </a>
      ) },
    { key: 'contact', header: 'Reach them on',
      value: (h) => contactLine(contacts?.get(h.holderId) ?? null),
      render: (h) => {
        if (contacts === null) return <span className="dash">not read</span>;
        const line = contactLine(contacts.get(h.holderId) ?? null);
        if (!line) {
          return (
            <a href={`/members?member=${encodeURIComponent(h.holderId)}`} style={{ color: 'var(--ink3)' }}>
              add a number
            </a>
          );
        }
        const rc = contacts.get(h.holderId);
        // A `tel:` where there is a number, because this table is read with a
        // telephone in hand. Plain text where there is only an address.
        return rc?.phone
          ? <a href={`tel:${rc.phone.replace(/\s+/g, '')}`} style={{ color: 'var(--brand)' }}>{line}</a>
          : <span>{line}</span>;
      } },
    { key: 'passes', header: 'Passes', value: (h) => h.passes, numeric: true,
      render: (h) => `${h.redeemed} of ${h.passes} used` },
    { key: 'last', header: 'Last pass', value: (h) => h.lastPassOn || null },
    { key: 'seen', header: 'Last at the door', value: (h) => h.firstUsedOn,
      render: (h) => h.firstUsedOn ?? <span className="dash">no door record</span> },
  ];

  // Written by `toCsv`, having been a third hand-rolled writer with the same
  // two omissions as the roster segment: no byte-order mark and `'\n'` endings.
  // Excel opens a BOM-less UTF-8 file in the machine's legacy code page, so
  // this call list — the thing this whole page exists to produce — arrived at a
  // Gulf gym with half its names unreadable. /export advertises the correct
  // writer; there is now one of it.
  const csv = () => {
    const text = toCsv(
      ['Member id', 'Name', 'Passes', 'Used', 'Last pass', 'Phone', 'Email'],
      shown.map((h) => {
        const rc = contacts?.get(h.holderId) ?? null;
        return [h.holderId, h.name, h.passes, h.redeemed, h.lastPassOn, rc?.phone, rc?.email];
      }),
    );
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pass-holders-who-did-not-join-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rec.passes.state !== 'ready' || rec.memberships.state !== 'ready') return null;
  if (all.length === 0) return null;

  return (
    <Section
      title="Held a pass, never joined"
      sub={`The call list this page exists to produce: ${all.length} ${all.length === 1 ? 'person' : 'people'} whose passes ran out without a membership. People whose pass is still live are not here — they have not decided anything yet, and asking them why they did not join is the wrong conversation.`}
    >
      {contactsErr ? (
        <p style={{ margin: 0, padding: '12px 14px 0', fontSize: 12.5, color: 'var(--warn)' }}>
          Contact details could not be read: {contactsErr}. The column below says
          &ldquo;not read&rdquo; rather than &ldquo;nothing recorded&rdquo; — this is not a list of
          people the gym has no number for.
        </p>
      ) : (
        <p style={{ margin: 0, padding: '12px 14px 0', fontSize: 12.5, color: 'var(--ink3)' }}>
          {reachable} of {all.length} have a number or an address on record. The rest can be given
          one from their member record — the name in the first column goes there.
        </p>
      )}

      <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '10px 14px', flexWrap: 'wrap' }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search this list" aria-label="Search the call list"
          style={{ ...field, flex: 1, minWidth: 200 }}
        />
        {q ? <button onClick={() => setQ('')} style={linkBtn}>clear</button> : null}
        <button onClick={csv} style={ghostBtn}>Export{q ? ' what is shown' : ''}</button>
      </div>
      {note ? <p style={{ margin: 0, padding: '0 14px 8px', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p> : null}

      {/* `shown` is post-search, so "Nobody to call." over a query that matched
          nothing was a statement about the gym made out of what somebody typed
          — on the call list this whole page exists to produce. */}
      <DataTable noun="pass holders who never joined"
        rows={shown} columns={cols} rowKey={(h) => h.holderId}
        empty={q.trim()
          ? `Nothing in this list matches “${q.trim()}”. Clear the search before concluding there is nobody to call.`
          : 'Nobody to call.'}
      />
    </Section>
  );
}

/* ── hosts ─────────────────────────────────────────────────────────────────── */

function Hosts({ c, rec }: { c: PassConversion; rec: PassConversionRecord }) {
  const cols: Column<HostGuests>[] = [
    {
      key: 'host', header: 'Member', value: (h) => h.hostName ?? '￿',
      render: (h) => h.hostName ?? <span className="dash">{h.hostMemberId.slice(0, 8)}…</span>,
    },
    { key: 'guests', header: 'Guest passes', value: (h) => h.guests, numeric: true },
    {
      key: 'identified', header: 'Distinct guests', value: (h) => h.identified, numeric: true,
      render: (h) => h.identified === 0
        ? <span className="dash">none with an account</span>
        : String(h.identified),
    },
    {
      key: 'anon', header: 'Walk-ins', value: (h) => h.anonymous, numeric: true,
      render: (h) => h.anonymous ? <span style={{ color: 'var(--ink3)' }}>{h.anonymous}</span> : <span className="dash">—</span>,
    },
    {
      key: 'joined', header: 'Later joined', value: (h) => h.joined, numeric: true,
      render: (h) => h.joined
        ? <strong style={{ color: 'var(--good)' }}>{h.joined}</strong>
        : <span className="dash">—</span>,
    },
    {
      key: 'undecided', header: 'Still undecided', value: (h) => h.undecided, numeric: true,
      render: (h) => h.undecided ? String(h.undecided) : <span className="dash">—</span>,
    },
  ];

  return (
    <Section
      title="Members who bring guests"
      sub="Counts, never a percentage: one member's handful of guests is far too few to carry a rate, and 'Sara brought four people, two of whom joined' is what a gym would act on anyway."
    >
      {rec.passes.state === 'loading' ? <Loading /> : null}
      {rec.passes.state === 'failed' ? <Failed reason={reasonOf(rec.passes)} part="passes" /> : null}
      {rec.memberships.state === 'failed' ? (
        <p style={{ margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)' }}>
          The roster could not be read, so hosts are shown by account id and the
          &ldquo;later joined&rdquo; column is unknown rather than nought.
        </p>
      ) : null}
      <Truncated s={rec.passes} part="passes" />
      <Truncated s={rec.memberships} part="the roster" />
      {c.hosts ? (
        <DataTable noun="hosts"
          rows={c.hosts} columns={cols} rowKey={(h) => h.hostMemberId}
          empty="No guest pass records who brought the guest. Recording the host at the desk is what makes this table possible."
        />
      ) : null}
    </Section>
  );
}

/* ── money: two figures, and no total ──────────────────────────────────────── */

function Money({ c, rec, ccy }: {
  c: PassConversion; rec: PassConversionRecord; ccy: TenantCurrency;
}) {
  const m = c.money;
  /**
   * What the MEMBERSHIP figure is denominated in — which is not what the
   * PASSES were sold in.
   *
   * The second tile below rendered `money(m.followingMrrCents, m.currency)`.
   * `m.currency` is what the priced PASSES agree on; `followingMrrCents` is the
   * sum of the PLAN prices of the memberships those holders now hold. Two
   * different sets of rows, so a gym selling day passes in EUR at the door and
   * billing memberships in GBP had its recurring figure labelled EUR — wrong
   * before `passRevenueCents` was corrected, and newly EXPENSIVE after it: that
   * field now goes null the moment the passes hold two moneys, which withheld a
   * membership figure that is perfectly sound and printed a note about the
   * passes underneath the hole.
   *
   * The contributing rows are the plans, and `summarise` in gymRecord already
   * reports what they share, as `mrrCurrency`. `moneyOf` in
   * src/lib/passConversion.ts computes exactly that summary and keeps only the
   * cents; `PassMoney` has no field to carry the currency. So the same summary
   * is asked again here, over the same rows read from the same slices through
   * the same `rowsOf` — the same function and the same inputs, so this label
   * and the figure it labels cannot disagree.
   */
  const mrrStated = useMemo(() => {
    const memberships = rowsOf(rec.memberships);
    const plans = rowsOf(rec.plans);
    if (!c.holders || !memberships || !plans) return null;
    const joiners = new Set(
      c.holders.filter((h) => h.outcome === 'joined-after').map((h) => h.holderId),
    );
    return summarise([], memberships.filter((mm) => joiners.has(mm.memberId)), plans).mrrCurrency;
  }, [c.holders, rec.memberships, rec.plans]);
  // `emptyTotalMoney` where there is no figure at all: nothing has contradicted
  // the gym's own setting, and that is the currency the dash would have been in.
  // `totalMoney` everywhere else — it withholds the label when the plans state
  // more than one money, and never substitutes the tenant's code for a figure
  // whose own rows disagree. The same pair, in the same order, as
  // app/(owner)/financials.tsx.
  const mrrCcy = m == null || m.followingMrrCents == null
    ? emptyTotalMoney(ccy)
    : totalMoney(m.followingMrrCents, mrrStated, ccy);
  return (
    <Section
      title="The money, in two parts"
      sub="Kept apart on purpose. There is no combined figure on this page and there should not be one."
    >
      {rec.passes.state === 'loading' ? <Loading /> : null}
      {rec.passes.state === 'failed' ? <Failed reason={reasonOf(rec.passes)} part="passes" /> : null}
      <Truncated s={rec.passes} part="passes" />
      {m ? (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 1, background: 'var(--ring)', borderBottom: '1px solid var(--ring)',
          }}>
            <Kpi
              label="Taken for passes"
              text={money(m.passCents, m.currency)}
              note={
                m.passCents == null
                  ? 'no pass carries a recorded price — which is not the same as free'
                  /* ── two silences, and neither of them is an Ops field ──────
                     This dash used to be explained with NO_CURRENCY_NOTE —
                     "this gym has not set its currency". `m.currency` has never
                     come from the tenant: it is what the PRICED passes agree
                     on. So that sentence sent an owner to Ops to fix a field
                     that is very often already set and was never the reason,
                     and it now fires in a second state as well, because
                     `passRevenueCents` returns null here whenever the priced
                     passes hold more than one money. The two are kept apart the
                     way app/(owner)/financials.tsx keeps its own silences
                     apart, and with the wording studio-web/app/close/page.tsx
                     settled on for the same tile: a month genuinely holding two
                     moneys is not a mistake and there is nothing to correct,
                     while priced passes that state no currency at all is a desk
                     taking money without recording in what. */
                  : m.mixedCurrency ? MIXED_CURRENCY_NOTE
                  : !m.currency
                    ? `${num(m.passesPriced)} of ${num(m.passesTotal)} passes ${m.passesPriced === 1 ? 'carries' : 'carry'} a recorded price, but not one of those rows says what money it was taken in, so there is no figure to write here. The gym’s own currency is not the answer: it is not evidence about what somebody was charged at the desk.`
                    /* The mixed-currency clause that used to trail this line is
                       gone rather than repaired. `mixedCurrency` and a non-null
                       `currency` can no longer both be true — mixed rows are
                       exactly the case that withholds the code — so it could
                       never render again; and making it reachable would mean
                       printing a total under one code while saying underneath
                       that it spans several, which is the figure the gate now
                       exists to withhold. The state is not lost: it is the
                       MIXED_CURRENCY_NOTE branch above and the red paragraph
                       below. */
                    : `from ${num(m.passesPriced)} of ${num(m.passesTotal)} passes`
              }
            />
            <Kpi
              label="Memberships that followed, per month"
              text={money(m.followingMrrCents, mrrCcy.currency)}
              note={
                rec.plans.state === 'failed' ? 'price book not read'
                  : rec.memberships.state === 'failed' ? 'roster not read'
                  : m.followingMrrCents == null ? 'none of them is on a priced plan'
                  // The PLANS behind this figure are not all in one money.
                  // Nothing about the passes withholds it, and there is nothing
                  // in Ops to go and correct.
                  : mrrCcy.gap === 'unstated' ? MIXED_CURRENCY_NOTE
                  // The figure is known, the rows behind it stated nothing to
                  // contradict the gym's own setting, and the gym has not set
                  // one — the only branch on this tile that really is an Ops
                  // field, and the only one entitled to say so.
                  : mrrCcy.gap === 'no_gym_currency' ? NO_CURRENCY_NOTE
                  : `${m.followingActive} active membership${m.followingActive === 1 ? '' : 's'}`
              }
            />
          </div>
          <p style={{ margin: 0, padding: '14px 16px', fontSize: 12.5, color: 'var(--ink2)', maxWidth: 820 }}>
            {MONEY_NOTE}
          </p>
          {m.mixedCurrency ? (
            <p style={{ margin: 0, padding: '0 16px 14px', fontSize: 12.5, color: 'var(--crit)' }}>
              These passes were sold in more than one currency, so the pass total
              above adds unlike amounts. Read it as a count of takings, not as a
              sum.
            </p>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/* ── the three states, once ────────────────────────────────────────────────── */


/**
 * The banner over a section whose read came back at its ceiling.
 *
 * Not the failure banner and not the empty sentence: the rows are real and
 * there are more of them. Every figure on this page is gated on
 * `state === 'ready'`, so a truncated read already withholds them — what it
 * could not do until this existed is SAY SO, and a section that quietly draws
 * nothing is the same blank screen a failure used to produce.
 */
function Truncated({ s, part }: { s: Slice<unknown>; part: string }) {
  if (s.state !== 'partial') return null;
  return (
    <div style={{
      margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)',
      borderLeft: '3px solid var(--warn)', fontSize: 12.5, color: 'var(--ink2)',
    }}>
      Only the first {s.cap} rows of {part} were read, and there are more. Everything below would
      be computed over a <strong>prefix</strong>, so it is withheld rather than shown as a total.
    </div>
  );
}

function Failed({ reason, part }: { reason: string; part: ConversionPart }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {CONVERSION_LABEL[part]}. This section is <strong>unknown</strong>, not empty.
      <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--ink3)' }}>
        Missing from this page: {CONVERSION_COST[part]}.
      </div>
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
}

/** A table cell that keeps "not read", "not loaded", "part read" and "nothing
 *  there" apart — four states, four cells. */
function Cell({ state, value, empty }: {
  state: Slice<unknown>['state']; value: string | null; empty: string;
}) {
  if (state === 'loading') return <span className="dash">…</span>;
  if (state === 'failed') return <span className="dash">not read</span>;
  if (state === 'partial') return <span className="dash">part read</span>;
  if (value == null) return <span className="dash">{empty}</span>;
  return <>{value}</>;
}

/* ── shared bits (same shapes as the Money, Members and Retention screens) ─── */

/* The same input and button shapes as the Door and Members screens. This page
 * had no control of any kind until the call list gained a search and an export. */
const field = {
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const ghostBtn = {
  ...field, background: 'var(--surface2)', color: 'var(--ink2)',
  cursor: 'pointer', flex: 'none',
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

