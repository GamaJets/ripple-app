'use client';

// Costs — the outgoing half of the gym's books, which this product did not have.
//
// This database records every penny a gym takes and one kind of penny it
// spends. `gym_payments` is money in, `gym_invoices` is money billed,
// `payroll_settlements` is money handed to trainers for sessions delivered —
// and that is the whole of the outgoing side. /accounting's "Money out" reads
// the settlements and says so on its face.
//
// So the rent was nowhere. Nor the electricity, which for a building full of
// treadmills is the second-largest line of the year; nor water, waste, the
// cleaner, the engineer who services the plate-loaded kit, the music licence,
// the insurance, the accountant, the stock in the fridge, or the receptionist —
// who is not a trainer, is not paid per session, and therefore never appears in
// payroll at all.
//
// The only outgoing figure this product held was one an owner typed into
// `app/(owner)/financials.tsx` under the label "Total Expenses / Mo", stored in
// the AsyncStorage key `repple.owner.financials`. One key, on one phone, no
// row, no currency of its own, no history — and every rule in
// src/lib/finReview.ts was scored against it.
//
// ── THE FIGURE THIS SCREEN REFUSES TO PRODUCE ──────────────────────────────
//
// There is no profit here and there is no net anywhere in this app.
//
// /accounting already prints "Cash recorded in Repple" — payments less payroll —
// under a paragraph explaining at length that Repple has never seen rent,
// stock, utilities, insurance, tax or equipment. Now that some of that IS in
// the database the obvious next edit is to fold it in and call the answer
// profit, and it would be wrong for five independent reasons: the takings are
// gross of the card processor's fee, the takings are only what somebody entered
// at the desk, this side is only what somebody typed, trainer pay is in a
// different table again, and any of it can be in a different currency this app
// holds no rate for. `GYM_COSTS_ARE_NEVER_NETTED` says so on the screen,
// because the absence of a figure reads as an omission unless somebody states
// that it was a decision.
//
// ── And no total across currencies ─────────────────────────────────────────
//
// One figure per currency, always, even for the gyms that have only ever used
// one. `gymCostsTaken` returns pots and this page renders them; there is no
// code path here that adds two.
//
// The reads are the dangerous part, as everywhere: supabase-js RESOLVES on a
// database error, so a missing `.error` check turns a refused query into a
// month in which the gym spent nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { type Unread, type Read, reading } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { Banner, Announce } from '@/components/Banner';
import { DataTable, type Column } from '@/components/DataTable';
import { money } from '@lib/gymRecord';
import { readMinorAmount, type Taken } from '@lib/coachMoney';
import { gymLink, noGymNote } from '@lib/gymLink';
import { monthWindow, recentMonths, monthKeyOf, type MonthWindow } from '@lib/monthEnd';
import { monthTickStart } from '@lib/pickerMonth';
import { useMonthTick } from '@/lib/monthTick';
import { isoDate } from '@lib/format';
import { gymDay, NO_ZONE_NOTE } from '@lib/gymZone';
import { toCsv } from '@lib/gymExport';
import {
  fetchGymCosts, recordGymCost, deleteGymCost,
  gymCostBlockers, gymCostsTaken, gymCostsByCategory, gymCostsEmptyLine,
  gymCostCategoryLabel, GYM_COST_CATEGORIES,
  GYM_COSTS_ARE_YOUR_WORD, GYM_COSTS_ARE_NEVER_NETTED,
  GYM_COSTS_ARE_NOT_TAX_ADVICE, GYM_COSTS_NOT_TWICE,
  type GymCost, type GymCostCategory, type GymCostPot,
} from '@lib/gymCosts';
import { readTenant, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { saveText } from '@/lib/save';

/** How far back the picker offers. Thirteen so last year's same month is there. */
const MONTHS_OFFERED = 13;

/**
 * What a read is when it holds no rows: still in flight, refused, or returned.
 *
 * The same three states /accounting keeps apart, for the same reason. "No costs
 * recorded in August" over a query that errored is a sentence about a gym's
 * spending made out of a failure, and this is a screen somebody exports.
 */



/* ── the screen ────────────────────────────────────────────────────────────── */

export default function Costs() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameUnread, setGymNameUnread] = useState(false);
  const [tenantErr, setTenantErr] = useState<string | null>(null);
  // `tenants.currency`. A cost cannot be recorded without one: part 700 makes
  // the column NOT NULL with no default, and a figure with the wrong three
  // letters on it is a different amount of money.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);

  // Opens on the month RUNNING, which is the opposite of /accounting and is
  // deliberate. That screen is read after a month has stopped moving; this one
  // is written as the money goes out, and defaulting it to last month would
  // have somebody record today's rent into August.
  //
  // Running FOR THE GYM. This was `useState(() => monthKeyOf())`, which is the
  // month on the laptop that opened the tab — so on the first and last day of a
  // month it disagrees with the gym: a cost entered at 09:00 on 1 September in
  // Auckland was offered August by default, and a bookkeeper in London filing
  // an Auckland gym's costs late on the 31st was offered the month after.
  //
  // Null means "the owner has not chosen", so the default follows the gym's own
  // day as soon as the zone read lands rather than being frozen at mount. The
  // browser's month is the fallback and only the fallback: a gym with no zone
  // set has nothing better, and the note under the picker says so.
  const [picked, setPicked] = useState<string | null>(null);
  const gymToday = gymDay(Date.now(), zone);
  const key = picked ?? (gymToday ? gymToday.slice(0, 7) : monthKeyOf());
  const setKey = setPicked;
  const w = useMemo(() => monthWindow(key), [key]);

  // Stored WITH the month it was read for, and used only when the two agree.
  // Without that, switching from August to September paints one frame of
  // August's costs under a September heading.
  const [loaded, setLoaded] = useState<{ key: string; costs: Read<GymCost> }>({ key: '', costs: reading() });

  const load = useCallback(async (tenantId: string, mw: MonthWindow): Promise<boolean> => {
    setLoaded({ key: '', costs: reading() });
    try {
      const rows = await fetchGymCosts(supabase, tenantId, mw.firstDay, mw.lastDay);
      setLoaded({ key: mw.key, costs: { rows, state: null, why: null } });
      return true;
    } catch (e: any) {
      setLoaded({
        key: mw.key,
        costs: { rows: null, state: 'failed', why: `The recorded costs could not be read: ${e?.message ?? 'the read was refused'}.` },
      });
      // Not a landing. The stamp stays where it was and the banner above says
      // which read is missing.
      return false;
    }
  }, []);

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
      // `{ rows: [], state: null, why: null }` is a read that RAN and found
      // nothing, and this screen renders that as "No cost is recorded in
      // August" over a query nobody ever sent. An account with no gym on it
      // gets a sentence below instead, before any figure.
      const link = gymLink(who?.tenantId, 'recorded costs');
      if (!link.linked) return;
      const t = await readTenant(supabase, link.tenantId);
      if (!live) return;
      setGymName(t.name);
      setCcy(t.currency);
      setZone(t.zone);
      setGymNameUnread(!!t.error);
      setTenantErr(t.error);
    })();
    return () => { live = false; };
    // Identity and the gym record only. The month's costs are read by the
    // effect below, through `refresh`. They shared one effect keyed on the
    // month, so choosing a different month also re-read the gym's name,
    // currency and timezone — three facts that cannot have changed.
  }, []);

  /**
   * The chosen month's costs, kept current and dated.
   *
   * This is a book somebody else at the gym is also writing into: a manager
   * enters the engineer's invoice while the owner has August open on the office
   * machine, and until now the owner's screen answered about whenever their tab
   * was opened without saying when that was — under a total they were about to
   * take into a month close.
   */
  const { at: readAt, busy: reading_, refresh } = useFetched(
    () => (me?.tenantId && w ? load(me.tenantId, w) : Promise.resolve(false)),
  );

  /**
   * The calendar month it is NOW — which is not the same question as when this
   * screen last read.
   *
   * The picker below is keyed on this and on nothing else. It has to gain
   * October at midnight on the 1st whether or not anything has been read since,
   * and it must not be rebuilt by anything else: the read is fired by an effect
   * keyed on the chosen period, so a picker rebuilt by every read would be a
   * loop rather than a refresh. `useMonthTick` re-renders this screen exactly
   * once a month and never otherwise — see studio-web/lib/monthTick.ts.
   */
  const tick = useMonthTick();

  /**
   * The periods this screen offers — built once a MONTH, not once a mount.
   *
   * This was keyed on `[]`, and neither clock gate could see it:
   * `check-frozen-day` looks for a clock read on the line, and the clock is a
   * `now = Date.now()` default one file away; `check-frozen-hook` follows
   * exactly those defaults but skips empty dependency lists, which are the other
   * gate's rule. So the newest period this picker offered was the one the tab
   * was OPENED in. The console has no router — the rail is a plain `<a href>` —
   * so that tab is a document that lives for days, and on the 1st the period
   * that had just ended was not in the list at all. The only repair was the full
   * page reload this console spent a wave learning not to need.
   */
  const months = useMemo(() => recentMonths(MONTHS_OFFERED, monthTickStart(tick).getTime()), [tick]);

  useEffect(() => {
    if (me?.tenantId && w) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId, key]);

  const costs = loaded.key === key ? loaded.costs : reading<GymCost>();

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
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
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          What the gym pays in rent, what it pays the people who clean it and what
          it settles with its accountant are the owner&rsquo;s books. The database
          refuses this read independently, so this is not the only thing standing
          between you and it.
        </p>
      </Shell>
    );
  }

  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
        <h1>Costs</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('recorded costs')}
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
      <h1>Costs</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '78ch' }}>
        What the gym pays for. Rent, power, water, the cleaner, the engineer, the
        music licence, insurance, stock, the accountant &mdash; none of which reaches
        this app on its own. Nothing here is subtracted from what the gym took, and
        there is no profit figure in this product.
      </p>

      <Fetched at={readAt} busy={reading_} onRefresh={refresh}
               what="this month’s costs" style={{ margin: '2px 0 14px' }} />

      {tenantErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but the gym&rsquo;s record could not be read:{' '}
          {tenantErr}. The costs below are scoped by tenant id rather than by name, so
          they are this gym&rsquo;s &mdash; but the currency is unknown until that read
          works, and nothing can be recorded without it.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        <select value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}
                aria-label="Which month to show">
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
        {/* Which clock this screen's "today" came from. The month above and the
            date on the form below are the gym's own day when the gym has said
            what that is, and the reader's when it has not — and a reader has to
            be told which, because on the first and last day of a month the two
            disagree and the disagreement is which month a cost is filed in. */}
        {zone ? null : (
          <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '52ch' }}>{NO_ZONE_NOTE}</span>
        )}
      </div>

      {!w
        ? <Banner tone="crit">{key} is not a month this console can open.</Banner>
        : (
          <Month
            w={w} costs={costs} ccy={ccy} zone={zone} gymName={gymName}
            tenantId={me.tenantId ?? null} me={me}
            /* The hook's `refresh`, not a bare `load`: a cost recorded here is
               the one moment this screen is provably current, and re-reading
               without moving the stamp would leave the line under it ageing
               from before the write. */
            onChange={refresh}
          />
        )}
    </Shell>
  );
}

/* ── one month ─────────────────────────────────────────────────────────────── */

function Month({ w, costs, ccy, zone, gymName, tenantId, me, onChange }: {
  w: MonthWindow; costs: Read<GymCost>; ccy: TenantCurrency; zone: string | null;
  gymName: string | null;
  tenantId: string | null; me: Me; onChange: () => void;
}) {
  const rows = costs.rows ?? [];
  const taken = useMemo(() => gymCostsTaken(rows), [rows]);
  const byCategory = useMemo(() => gymCostsByCategory(rows), [rows]);

  return (
    <>
      {costs.why ? <Banner tone="crit">{costs.why}</Banner> : null}

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '10px 0 0' }}>
        {w.label}, {w.firstDay} to {w.lastDay}, counted by the day the money went out
        rather than the day the line was entered &mdash; so a quarter of receipts written
        up in one evening land in the months they were paid in.
      </p>

      <Totals read={costs} taken={taken} w={w} />

      <Handoff w={w} gymName={gymName} rows={rows} read={costs} byCategory={byCategory} />

      {/* Keyed on the month, so switching the picker remounts the form. Without
          it the date box keeps the day it was seeded with and a half-typed
          August cost stays on screen under a September heading — where the next
          press of Record would file it in the wrong month. */}
      <Record
        key={w.key} w={w} ccy={ccy} zone={zone} tenantId={tenantId} me={me} onChange={onChange}
      />

      <Ledger read={costs} rows={rows} w={w} onChange={onChange} />

      <Where read={costs} pots={byCategory} w={w} />

      <Section
        title="What this is, and what it is not"
        sub="Three sentences that belong beside the figures rather than in a help page."
      >
        <div style={{ padding: '14px', display: 'grid', gap: 12, color: 'var(--ink2)', fontSize: 13, maxWidth: '84ch' }}>
          <p style={{ margin: 0 }}>{GYM_COSTS_ARE_YOUR_WORD}</p>
          <p style={{ margin: 0 }}><strong>Nothing here is netted.</strong> {GYM_COSTS_ARE_NEVER_NETTED}</p>
          <p style={{ margin: 0 }}><strong>This is not a tax record.</strong> {GYM_COSTS_ARE_NOT_TAX_ADVICE}</p>
        </div>
      </Section>
    </>
  );
}

/* ── what went out, one figure per currency ────────────────────────────────── */

/**
 * The month's outgoings, per currency, and never as one number.
 *
 * A gym with one currency sees exactly the one figure it would have seen. A gym
 * with two sees two, side by side, because GBP 4,500 and EUR 900 are not 5,400
 * of anything and this app holds no rate to make them one.
 */
function Totals({ read, taken, w }: { read: Read<GymCost>; taken: Taken; w: MonthWindow }) {
  if (read.state) {
    return (
      <div style={grid}>
        <Kpi
          label="Out this month"
          text={null}
          note={read.state === 'loading' ? 'reading the ledger…' : 'the ledger could not be read, so this is unknown rather than nothing'}
        />
      </div>
    );
  }

  if (!taken.pots.length) {
    return (
      <div style={grid}>
        <Kpi label="Out this month" text={null} note={`nothing is recorded as paid in ${w.label}`} />
      </div>
    );
  }

  return (
    <>
      <div style={grid}>
        {taken.pots.map((p) => (
          <Kpi
            key={p.currency}
            label={`Out this month · ${p.currency}`}
            text={money(p.minorUnits, p.currency)}
            note={`${p.count} cost${p.count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      {taken.unlabelled || taken.unpriced ? (
        <Banner tone="crit">
          {taken.unlabelled ? (
            <>{taken.unlabelled} cost{taken.unlabelled === 1 ? '' : 's'} carr{taken.unlabelled === 1 ? 'ies' : 'y'} no
            currency, so {taken.unlabelled === 1 ? 'it is' : 'they are'} counted out of the
            figures above rather than added to a currency nobody stated. </>
          ) : null}
          {taken.unpriced ? (
            <>{taken.unpriced} cost{taken.unpriced === 1 ? '' : 's'} carr{taken.unpriced === 1 ? 'ies' : 'y'} no
            amount at all, so the totals are short by exactly {taken.unpriced === 1 ? 'that line' : 'those lines'}. </>
          ) : null}
          Neither is a zero.
        </Banner>
      ) : null}
    </>
  );
}

/* ── recording one ─────────────────────────────────────────────────────────── */

function Record({ w, ccy, zone, tenantId, me, onChange }: {
  w: MonthWindow; ccy: TenantCurrency; zone: string | null;
  tenantId: string | null; me: Me; onChange: () => void;
}) {
  // Today, unless today is outside the month being looked at — in which case
  // the last day of that month, so somebody entering August's rent in September
  // is not silently given a September date on a screen headed August.
  //
  // The GYM's today. `isoDate(new Date())` is the reader's calendar, and this
  // date goes onto a permanent ledger row that /accounting and /close bucket by
  // month: a cost paid at 09:00 on the 1st in Auckland must not be filed on the
  // 31st because the person entering it is in London. Where the gym has no
  // zone there is nothing better than the reader's day, and it is used —
  // stating a wrong zone is worse than using the only clock there is.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());
  const initialDay = today >= w.firstDay && today <= w.lastDay ? today : w.lastDay;

  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState<GymCostCategory>('rent');
  const [amountText, setAmountText] = useState('');
  const [paidOn, setPaidOn] = useState(initialDay);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const draft = { description, supplier, category, amountText, currency: ccy, paidOn, note };
  const blockers = gymCostBlockers(draft);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    if (blockers.length) { setWriteErr(blockers[0]); return; }
    if (!tenantId || !ccy) return;
    // Read once, by the same reader the blockers used. Two readers over one box
    // is how an amount comes to be shown as one figure and stored as another.
    // NOT a charge — money that has already left the gym's account — and the
    // same setting `gymCostBlockers` read it with above. Two readers over one
    // box disagreeing about a Kuwaiti amount is the shape this pairing avoids.
    const amt = readMinorAmount(amountText, ccy, false);
    if (!amt.ok) { setWriteErr(amt.reason); return; }

    setBusy(true); setWriteErr(null);
    try {
      await recordGymCost(supabase, tenantId, {
        recordedBy: me.id,
        description,
        supplier,
        category,
        amountCents: amt.minorUnits,
        currency: ccy,
        paidOn,
        note,
      });
      setSaved(`Recorded: ${description.trim()}, paid ${paidOn}.`);
      setDescription(''); setSupplier(''); setAmountText(''); setNote('');
      onChange();
    } catch (e: any) {
      setWriteErr(`That cost was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing has been added to the ledger.`);
    } finally { setBusy(false); }
  };

  const chosen = GYM_COST_CATEGORIES.find((c) => c.id === category);

  return (
    <Section
      title="Record a cost"
      sub="One line per payment, dated the day the money went out. There is no edit: correcting a line is removing it and writing the right one, and the removal is logged."
    >
      <Announce say={writeErr ?? saved} tone={writeErr ? 'crit' : undefined} />
      <form onSubmit={submit} style={formRow}>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
               placeholder="What it was for" style={{ ...field, flex: 2, minWidth: 190 }}
               aria-label="What this cost was for" />
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
               placeholder="Who it was paid to (optional)" style={{ ...field, flex: 2, minWidth: 180 }}
               aria-label="Who this was paid to" />
        <select value={category} onChange={(e) => setCategory(e.target.value as GymCostCategory)}
                style={{ ...field, minWidth: 200 }} aria-label="What kind of cost this was">
          {GYM_COST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `Amount (${ccy})` : 'Amount'} style={{ ...field, width: 150 }}
               aria-label="How much went out" />
        <label style={dateLabel}>
          paid
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day the money went out" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
               style={{ ...field, flex: 2, minWidth: 160 }} aria-label="A note about this cost" />
        <button type="submit" disabled={busy || !!blockers.length} style={primaryBtn}>Record</button>
      </form>

      {chosen ? (
        <p style={{ margin: '0 14px 10px', fontSize: 12, color: 'var(--ink3)', maxWidth: '78ch' }}>
          <span className="mono">{chosen.label}</span> &mdash; {chosen.note}
        </p>
      ) : null}

      <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '80ch' }}>
        {GYM_COSTS_NOT_TWICE}
      </p>

      {!ccy ? (
        <Banner>
          Costs cannot be recorded until this gym sets its currency &mdash; {NO_CURRENCY_NOTE}. There
          is no default here that would be right for half the gyms running Repple, and a figure
          with the wrong three letters on it is a different amount of money. Set it on{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
        </Banner>
      ) : null}
      {blockers.length && !writeErr && (description || amountText) ? (
        <ul style={{ margin: '0 14px 12px', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
          {blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
        </ul>
      ) : null}
      {writeErr ? <Banner tone="crit" live={false}>{writeErr}</Banner> : null}
      {saved ? <Banner live={false}>{saved}</Banner> : null}
    </Section>
  );
}

/* ── the ledger ────────────────────────────────────────────────────────────── */

function Ledger({ read, rows, w, onChange }: {
  read: Read<GymCost>; rows: GymCost[]; w: MonthWindow; onChange: () => void;
}) {
  const [removeErr, setRemoveErr] = useState<string | null>(null);

  const remove = (c: GymCost) => {
    if (!confirm(
      `Remove "${c.description}", paid ${c.paidOn}? There is no undo and no edit — if this line was wrong, `
      + 'record the right one afterwards. The removal is logged against your account.',
    )) return;
    deleteGymCost(supabase, c.id)
      .then(() => { setRemoveErr(null); onChange(); })
      .catch((e: any) => setRemoveErr(
        `That cost was NOT removed: ${e?.message ?? 'the delete was refused'}. It is still in the ledger and still in anything exported from this page.`));
  };

  const cols: Column<GymCost>[] = [
    { key: 'paid', header: 'Paid', value: (c) => c.paidOn },
    { key: 'what', header: 'What for', value: (c) => c.description },
    { key: 'supplier', header: 'Paid to', value: (c) => c.supplier,
      render: (c) => c.supplier ?? <span className="dash">not stated</span> },
    { key: 'category', header: 'Category', value: (c) => gymCostCategoryLabel(c.category) },
    { key: 'amount', header: 'Amount', value: (c) => c.amountCents, numeric: true,
      render: (c) => (c.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(c.amountCents, c.currency)}</>) },
    { key: 'note', header: 'Note', value: (c) => c.note },
    { key: 'remove', header: '', value: () => '', align: 'right',
      render: (c) => (
        <button onClick={() => remove(c)} style={linkBtn} className="no-print"
                aria-label={`Remove ${c.description}, paid ${c.paidOn}`}>
          remove
        </button>
      ) },
  ];

  return (
    <Section
      title={`What went out in ${w.label}`}
      sub="Every line somebody recorded, newest first. An amount with no currency on it is shown as a dash rather than in a currency nobody stated."
    >
      {removeErr ? <Banner tone="crit">{removeErr}</Banner> : null}
      <Part read={read} what="the recorded costs"
            cost="what this gym spent in this month is unknown, not nil">
        <DataTable noun="costs"
          rows={rows} columns={cols} rowKey={(c) => c.id}
          empty={gymCostsEmptyLine('ready')}
        />
      </Part>
    </Section>
  );
}

/* ── where it went ─────────────────────────────────────────────────────────── */

interface CategoryLine {
  key: string;
  label: string;
  currency: string;
  count: number;
  cents: number;
}

/**
 * Per category AND per currency, never one figure per category.
 *
 * A gym paying rent in pounds and an insurer in euros has two amounts of money
 * and not a sum, and a line reading "Insurance 5,400" over two currencies is a
 * number somebody would copy.
 */
function Where({ read, pots, w }: { read: Read<GymCost>; pots: GymCostPot[]; w: MonthWindow }) {
  const lines: CategoryLine[] = [];
  for (const p of pots) {
    for (const pot of p.taken.pots) {
      lines.push({
        key: `${p.category}|${pot.currency}`,
        label: p.label,
        currency: pot.currency,
        count: pot.count,
        cents: pot.minorUnits,
      });
    }
  }

  const cols: Column<CategoryLine>[] = [
    { key: 'label', header: 'Category', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'count', header: 'Lines', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  return (
    <Section
      title="Where it went"
      sub={`What ${w.label} was spent on. A category nobody recorded anything against is absent rather than shown at zero — a "Utilities 0.00" line would be a statement that this gym spent nothing on power.`}
    >
      <Part read={read} what="the recorded costs" cost="the split by category is unknown">
        <DataTable noun="cost categories"
          rows={lines} columns={cols} rowKey={(l) => l.key}
          empty={`Nothing is recorded as paid in ${w.label}, so there is nothing to split.`}
        />
      </Part>
    </Section>
  );
}

/* ── getting it out of the browser ─────────────────────────────────────────── */

/**
 * The month's costs as a file.
 *
 * Both sections state what could NOT be read rather than exporting an empty
 * one: an empty section in a file somebody keeps is indistinguishable, forever,
 * from a month in which the gym paid for nothing.
 */
function Handoff({ w, gymName, rows, read, byCategory }: {
  w: MonthWindow; gymName: string | null; rows: GymCost[];
  read: Read<GymCost>; byCategory: GymCostPot[];
}) {
  // `Unread` has three values and only one is null. Both gates below tested
  // `=== 'failed'`, so a read still IN FLIGHT fell through to `rows` and wrote
  // a CSV headed "COSTS RECORDED IN THE MONTH" with nothing under it — filed,
  // that is indistinguishable from a month in which the gym spent nothing.
  const loading = read.state === 'loading';

  const download = () => {
    const parts: string[] = [];
    const head = (t: string) => `\n${t}\n`;

    parts.push(`Costs — ${gymName ?? 'this gym'} — ${w.label} (${w.firstDay} to ${w.lastDay})\n`);
    parts.push('Dated by the day the money went out. Nothing here is netted against what the gym took, and no figure in this file is a tax figure.\n');

    parts.push(head('COSTS RECORDED IN THE MONTH'));
    parts.push(read.state !== null
      ? (read.state === 'loading'
          ? 'NOT EXPORTED — the recorded costs had not finished loading when this file was made. Export the month again. This is unknown, not nil.\n'
          : `NOT EXPORTED — the recorded costs could not be read${read.why ? `: ${read.why}` : ''}. This is unknown, not nil.\n`)
      : toCsv(
          ['Paid on', 'What for', 'Paid to', 'Category', 'Amount (minor units)', 'Currency', 'Note'],
          rows.map((c) => [
            c.paidOn, c.description, c.supplier, gymCostCategoryLabel(c.category),
            c.amountCents, c.currency, c.note,
          ]),
          false));

    parts.push(head('BY CATEGORY AND CURRENCY'));
    parts.push(read.state !== null
      ? (read.state === 'loading'
          ? 'NOT EXPORTED — the recorded costs had not finished loading, so there is no split. Export the month again.\n'
          : 'NOT EXPORTED — the recorded costs could not be read, so there is no split.\n')
      : toCsv(
          ['Category', 'Currency', 'Lines', 'Amount (minor units)'],
          byCategory.flatMap((p) => p.taken.pots.map((pot) => [
            p.label, pot.currency, pot.count, pot.minorUnits,
          ])),
          false));

    saveText(parts.join(''), `${slugOf(gymName)}-${w.key}-costs.csv`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '18px 0 20px' }}>
      <button onClick={download} style={{ ...primaryBtn, opacity: loading ? 0.5 : 1 }} disabled={loading}>
        {loading ? 'Still reading the month…' : 'Export this month (CSV)'}
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '62ch' }}>
        Amounts are exported in minor units with their currency beside them, so nothing in the file
        depends on a spreadsheet guessing how many decimal places a currency has.
      </span>
    </div>
  );
}

/** A filename fragment from the gym's name. Falls back rather than producing a
 *  file called "-2026-08-costs.csv" that sorts before everything. */
function slugOf(name: string | null): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'gym';
}

/* ── the small pieces ──────────────────────────────────────────────────────── */

/**
 * A section body that cannot lie about which of the three states it is in:
 * loading says loading, failed says what broke and what is therefore unknown,
 * returned hands over to the table.
 */
function Part<T>({ read, what, cost, children }: {
  read: Read<T>; what: string; cost?: string; children: React.ReactNode;
}) {
  if (read.state === 'loading') return <Loading />;
  if (read.state === 'failed') {
    return (
      // Announced. `Loading` above carries `role="status"`; this is what
      // REPLACES it, and it was a plain div — so the whole of a refused ledger
      // read was silent to a screen reader on the screen that says what the gym
      // has spent.
      <div role="status" aria-live="polite" aria-atomic="true" style={{
        padding: '16px 14px', margin: 14, borderRadius: 0,
        border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
      }}>
        Could not read {what}. This section is <strong>unknown</strong>, not empty
        {cost ? <> &mdash; {cost}</> : null}.
        {read.why ? (
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{read.why}</div>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}

const grid = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
  borderRadius: 0, overflow: 'hidden', margin: '16px 0 6px',
} as const;

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

/** A date field with its own word beside it. `<input type="date">` renders an
 *  empty box with a picker icon and nothing saying which date it wants. */
const dateLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--ink3)', fontSize: 12.5,
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '86ch' }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}
