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
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, fetchPlans, money } from '@lib/gymRecord';
import { fetchVisits } from '@lib/gymVisits';
import { fetchPasses } from '@lib/gymPasses';
import { sliceLoading, sliceReady, sliceFailed, type Slice } from '@lib/memberView';
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
  const [gymName, setGymName] = useState<string | null>(null);
  const [rec, setRec] = useState<PassConversionRecord>(EMPTY);

  const load = useCallback(async (tenantId: string) => {
    setRec(EMPTY);
    // Four reads, deliberately not one Promise.all behind a single catch. A
    // price book that 500s must not take the pass counts down with it — the
    // page may be partial, but only if it says which part and what that costs.
    //
    // No `sinceIso` on the visits: a pass issued eighteen months ago and
    // redeemed the week after is exactly the case this page exists to find, and
    // a rolling window would silently drop it and report the pass as unused.
    const [passes, memberships, visits, plans] = await Promise.all([
      slice(() => fetchPasses(supabase, tenantId)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchVisits(supabase, tenantId)),
      slice(() => fetchPlans(supabase, tenantId)),
    ]);
    setRec({ passes, memberships, visits, plans });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setRec({
          passes: sliceReady([]), memberships: sliceReady([]),
          visits: sliceReady([]), plans: sliceReady([]),
        });
        return;
      }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      // supabase-js RESOLVES on a database error, so this is checked rather
      // than assumed: a null name here means "not read", not "unnamed gym".
      if (live) setGymName(tErr ? null : t?.name ?? null);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const c = useMemo(() => buildPassConversion(rec), [rec]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/passes">
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
      <Shell me={me} gymName={gymName} current="/passes">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          This page carries pass income and the membership roster, so it is owner-only.
        </p>
      </Shell>
    );
  }

  const rate = c.joinedAfterRate;

  return (
    <Shell me={me} gymName={gymName} current="/passes">
      <h1>Passes</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Guest passes and day passes, who held them, and which of those people
        later took out a membership.
      </p>

      {/* Printed first and always, including on an empty gym: the reader will
          supply the causal reading themselves if the page does not refuse it. */}
      <Banner>{CAUSAL_CAVEAT}</Banner>

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
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Passes issued"
          text={c.passes ? String(c.passes.issued) : null}
          note={stateNote(rec.passes, 'passes not read', c.passes ? `${c.passes.live} still live` : undefined)}
        />
        <Kpi
          label="Used at least once"
          text={c.redeemedPasses == null ? null : String(c.redeemedPasses)}
          note={
            rec.passes.state === 'failed' ? 'passes not read'
              : c.redemptionVisits == null ? 'door log not read'
              : `${c.redemptionVisits} seen by the door log`
          }
        />
        <Kpi
          label="To a walk-in"
          text={c.anonymousPasses == null ? null : String(c.anonymousPasses)}
          note={
            rec.passes.state === 'failed' ? 'passes not read'
              : c.anonymousPasses ? 'no account — excluded below'
              : 'every pass carries an account'
          }
        />
        <Kpi
          label="Held a pass, then joined"
          text={c.counts == null ? null : String(c.counts.joinedAfter)}
          note={
            rec.memberships.state === 'failed' ? 'roster not read'
              : c.counts == null ? undefined
              : `of ${c.counts.decided} whose pass has run out`
          }
        />
        <Kpi
          label="Typical gap"
          text={c.interval == null ? null : `${c.interval.medianDays}d`}
          note={
            c.interval == null
              ? (rec.memberships.state === 'ready' ? 'nobody has joined after a pass' : 'roster not read')
              : `median of ${c.interval.n}, ${c.interval.minDays}–${c.interval.maxDays} days`
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

      <Holders c={c} rec={rec} />
      <Hosts c={c} rec={rec} />
      <Money c={c} rec={rec} />
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

/** A KPI footnote that keeps the three states apart. */
function stateNote(s: Slice<unknown>, failed: string, ready?: string): string | undefined {
  if (s.state === 'failed') return failed;
  if (s.state === 'loading') return undefined;
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
        style={{ display: 'block', borderRadius: 5, overflow: 'hidden', background: 'var(--surface2)' }}
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
            <span style={{ width: 3, borderRadius: 2, background: p.colour, flex: 'none' }} aria-hidden="true" />
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

function Holders({ c, rec }: { c: PassConversion; rec: PassConversionRecord }) {
  const cols: Column<PassHolder>[] = [
    {
      key: 'name', header: 'Holder', value: (h) => h.name ?? '￿',
      render: (h) => h.name ?? <span className="dash">unnamed account</span>,
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
      key: 'paid', header: 'Paid for passes', value: (h) => h.paidCents, numeric: true,
      render: (h) => money(h.paidCents) ?? <span className="dash">no price recorded</span>,
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
      {c.holders ? (
        <DataTable
          rows={c.holders} columns={cols} rowKey={(h) => h.holderId}
          empty="No pass has been issued to somebody with an account. Passes sold to walk-ins are listed nowhere here, because there is no person for them to be a row about."
        />
      ) : null}
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
      {c.hosts ? (
        <DataTable
          rows={c.hosts} columns={cols} rowKey={(h) => h.hostMemberId}
          empty="No guest pass records who brought the guest. Recording the host at the desk is what makes this table possible."
        />
      ) : null}
    </Section>
  );
}

/* ── money: two figures, and no total ──────────────────────────────────────── */

function Money({ c, rec }: { c: PassConversion; rec: PassConversionRecord }) {
  const m = c.money;
  return (
    <Section
      title="The money, in two parts"
      sub="Kept apart on purpose. There is no combined figure on this page and there should not be one."
    >
      {rec.passes.state === 'loading' ? <Loading /> : null}
      {rec.passes.state === 'failed' ? <Failed reason={reasonOf(rec.passes)} part="passes" /> : null}
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
                  : `from ${m.passesPriced} of ${m.passesTotal} passes${m.mixedCurrency ? ', across more than one currency' : ''}`
              }
            />
            <Kpi
              label="Memberships that followed, per month"
              text={money(m.followingMrrCents, m.currency)}
              note={
                rec.plans.state === 'failed' ? 'price book not read'
                  : rec.memberships.state === 'failed' ? 'roster not read'
                  : m.followingMrrCents == null ? 'none of them is on a priced plan'
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

function Failed({ reason, part }: { reason: string; part: ConversionPart }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 8,
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

/** A table cell that keeps "not read", "not loaded" and "nothing there" apart. */
function Cell({ state, value, empty }: {
  state: Slice<unknown>['state']; value: string | null; empty: string;
}) {
  if (state === 'loading') return <span className="dash">…</span>;
  if (state === 'failed') return <span className="dash">not read</span>;
  if (value == null) return <span className="dash">{empty}</span>;
  return <>{value}</>;
}

/* ── shared bits (same shapes as the Money, Members and Retention screens) ─── */

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: text == null ? 'var(--ink3)' : 'var(--ink)' }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div style={{
      margin: '14px 0', padding: '11px 14px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
