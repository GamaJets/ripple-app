'use client';

// Tax — the record a return is made from, and no return figure.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// The word "tax" appeared nowhere in this schema. Not on `tenants`, not on
// `gym_invoices`, not on `gym_payments`, not on `payroll_settlements`, not on
// the month close. A registered gym ran Repple for its members, its timetable
// and its money and then produced its return from somewhere else entirely — so
// the register /accounting hands an accountant could not even say which regime
// its figures were inside, and this console could not produce a QUARTER at all:
// /accounting and /close are both monthly, and a return is filed quarterly in
// most regimes that have one.
//
// ── THE FIGURE THIS PAGE REFUSES TO PRODUCE ────────────────────────────────
//
// Any of them. There is no tax figure on this page, there is no rate anywhere
// in this product, and nothing here multiplies one by anything.
//
// supabase/parts/451 settled this on the coach's side and its sentence is the
// rule: this app may print what a person stated and may not work anything out
// from it. A coach who states "20%" beside "GBP 480.00" has said two true
// things; an app that prints "VAT: GBP 80.00" underneath has made a claim about
// their tax affairs, and it is wrong for a margin scheme, a flat-rate scheme, a
// reverse charge or a mixed-rate invoice.
//
// A gym is not a coach — more transactions, a real deadline — and that makes
// the conclusion stronger rather than weaker. It also rules out the narrow
// thing part 451 allowed: a gym is not one supply. Memberships, personal
// training, room hire and a bottle of drink can sit at different rates in the
// same week, some of them exempt. One rate held against the gym would be a
// claim about all of them; a rate held against one invoice would say nothing
// about the card payments at the desk, which are most of the money. Either is
// the "subtotal printed as a total" failure src/lib/coachLedger.ts names first
// among the three it exists to prevent.
//
// So what this page does is assemble, for a period somebody actually files
// against, the four things Repple honestly holds — what was taken, what was
// billed, what went out, and what the gym says about its own registration —
// and then STATE, itemised and on the screen, the six things it does not know.
// An absent figure reads as an oversight unless somebody says it was a
// decision.
//
// ── Why payroll is not on this page ────────────────────────────────────────
//
// /accounting shows it under "Money out" and it belongs there. Wages are
// outside a tax on sales in every regime this product has a customer in, and
// putting a payroll figure on a page headed Tax invites it into a box it does
// not belong in. The costs below are the outgoings a return might touch;
// what the gym paid its trainers is a different question on a different screen.
//
// The reads are the dangerous part, as everywhere: supabase-js RESOLVES on a
// database error, so a missing `.error` check turns a refused query into a
// quarter in which the gym took nothing — and this is the page somebody works
// from at a deadline.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
// `landed` comes from here too. This file declared its own copy, byte for
// byte, three lines under the import that already brings in `Read` and
// `reading` from the same module — which is the exact drift lib/read.ts was
// written to stop: when the fourth state lands it lands in one place, and a
// private copy is a screen the change cannot reach.
import { type Unread, type Read, reading, landed } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { settledLanded } from '@lib/readLanded';
import { Banner, Announce } from '@/components/Banner';
import { fetchPayments, money, type GymPayment } from '@lib/gymRecord';
import { fetchInvoices, type GymInvoiceRow } from '@lib/gymInvoices';
import { fetchGymCosts, gymCostsTaken, type GymCost } from '@lib/gymCosts';
import { sumTaken, type Taken } from '@lib/coachMoney';
import {
  taxPeriod, taxPeriodAt, recentTaxPeriods, periodMovingNote,
  readGymTaxProfile, saveGymTaxProfile, fetchClosedMonths,
  taxProfileLine, taxProfileBlockers, NO_TAX_PROFILE,
  TAX_NO_RETURN_FIGURE, TAX_UNKNOWNS, TAX_FACTS_ARE_STATED_NOT_CHECKED,
  type GymTaxProfile, type TaxPeriod, type PeriodAtZone,
} from '@lib/gymTax';
import { monthTickStart } from '@lib/pickerMonth';
import { useMonthTick } from '@/lib/monthTick';
// The gym's own clock, read as its own three-state answer: set, not set, and
// could not be asked. The third must never be drawn as the second.
import { fetchGymZone } from '@lib/gymZone';
import { toCsv } from '@lib/gymExport';
import { readTenant } from '@/lib/currency';
import { saveText } from '@/lib/save';

/** Four quarters and six months. A gym filing quarterly wants last quarter and
 *  the one before it for a comparison; a gym filing monthly, or an owner
 *  checking one month against the bank, wants a month. */
const QUARTERS_OFFERED = 4;
const MONTHS_OFFERED = 6;


interface Books {
  payments: Read<GymPayment>;
  invoices: Read<GymInvoiceRow>;
  costs: Read<GymCost>;
  /** Month keys with a LIVE close on them. Null when the read failed, which is
   *  reported as "every month is open" rather than as "every month is closed" —
   *  see `openMonthsIn`. */
  closed: string[] | null;
  closedErr: string | null;
}

const EMPTY: Books = {
  payments: reading(), invoices: reading(), costs: reading(),
  closed: null, closedErr: null,
};

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function Tax() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameUnread, setGymNameUnread] = useState(false);

  const [profile, setProfile] = useState<GymTaxProfile>(NO_TAX_PROFILE);
  // 'loading' until the tenant read returns, then 'ready' or 'error'. The three
  // are kept apart because "this gym is not registered" printed out of a failed
  // query is a statement about a business's legal standing.
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'error'>('loading');

  /**
   * `tenants.timezone`, and the failure to read it, kept apart.
   *
   * The quarter's instants are cut on this. Until it lands the period is cut on
   * the device and the caption below says so, rather than the page asserting the
   * gym's clock over the reader's — which is what it did unconditionally.
   */
  const [zone, setZone] = useState<string | null>(null);
  const [zoneErr, setZoneErr] = useState<string | null>(null);

  // Opens on the quarter that has FINISHED, not the one running — the same
  // choice /accounting makes about months and for the same reason: a part
  // period is not something anybody files, and offering it first invites a
  // figure to be copied out before the period has stopped moving.
  const [key, setKey] = useState<string>(() => recentTaxPeriods(2, 0)[1] ?? recentTaxPeriods(1, 0)[0] ?? '');
  const at: PeriodAtZone | null = useMemo(() => taxPeriodAt(key, zone), [key, zone]);
  const p = at?.period ?? null;

  const [loaded, setLoaded] = useState<{ key: string; books: Books }>({ key: '', books: EMPTY });

  const load = useCallback(async (tenantId: string, period: TaxPeriod): Promise<boolean> => {
    setLoaded({ key: '', books: EMPTY });

    // allSettled, never all. Under a single catch a refused invoice query would
    // also empty the payments, and this page would report a period in which the
    // gym both billed nothing and took nothing — two wrong facts that agree
    // with each other and so read as a quiet quarter rather than a broken read.
    const [pay, inv, cost, cls] = await Promise.allSettled([
      fetchPayments(supabase, tenantId, period.fromIso, period.toIso),
      // Every invoice up to the end of the period, filtered to it below. The
      // read is deliberately not bounded at the near end, for the reason
      // fetchInvoices gives: an invoice raised before the period and still
      // unpaid inside it is money the gym is owed on that date.
      fetchInvoices(supabase, tenantId, period.lastDay),
      fetchGymCosts(supabase, tenantId, period.firstDay, period.lastDay),
      fetchClosedMonths(supabase, tenantId, period.months),
    ]);

    setLoaded({
      key: period.key,
      books: {
        payments: landed(pay, 'the payments taken'),
        invoices: landed(inv, 'the invoice register'),
        costs: landed(cost, 'the recorded costs'),
        closed: cls.status === 'fulfilled' ? cls.value : null,
        closedErr: cls.status === 'fulfilled'
          ? null
          : 'Which of these months have been closed could not be read, so every one of them is reported as open. That is the safe direction — a period called settled when the read failed is the expensive mistake.',
      },
    });

    // Whole means all four came back. `useFetched` stamps only on a whole read,
    // so a period whose cost register would not load leaves the stamp where it
    // was rather than dating a set of books that is missing a side of itself.
    return settledLanded([pay, inv, cost, cls]);
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
      if (!who?.tenantId) { setProfileState('ready'); return; }

      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name);
      setGymNameUnread(!!t.error);

      // `fetchGymZone` rather than a second inline `timezone` select. It is the
      // one read that keeps "the gym has not set a timezone" apart from "the
      // gym record would not load", and printing the first over the second
      // sends an owner to change a setting that is already correct.
      const z = await fetchGymZone(supabase, who.tenantId);
      if (!live) return;
      setZone(z.zone);
      setZoneErr(z.error);

      const tax = await readGymTaxProfile(supabase, who.tenantId);
      if (!live) return;
      setProfile(tax.profile);
      setProfileState(tax.error ? 'error' : 'ready');

    })();
    return () => { live = false; };
    // Identity, the gym record, the zone and the tax profile — read once. The
    // books are read by the effect below, through `refresh`. They used to share
    // one effect keyed on the period, so choosing a different quarter re-read
    // the gym's tax registration and its timezone as well, three round trips
    // that cannot have changed.
  }, []);

  /**
   * The books for the chosen period, kept current and dated.
   *
   * The stamp matters more here than almost anywhere in this console: these are
   * the figures a return is made from, and a quarter read on Tuesday and copied
   * out on Thursday is a filing made against two days of missing payments with
   * nothing on the page that said so.
   *
   * `loaded.key` is what drops a superseded read — a quarter changed while the
   * previous one was still in flight writes under the old key and `books` falls
   * back to EMPTY — and `useFetched` coalesces the second request rather than
   * dropping it, so the new quarter is always read.
   */
  const { at: readAt, busy: reading_, refresh } = useFetched(
    () => (me?.tenantId && p ? load(me.tenantId, p) : Promise.resolve(false)),
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
  const periods = useMemo(
    () => recentTaxPeriods(QUARTERS_OFFERED, MONTHS_OFFERED, monthTickStart(tick).getTime()),
    [tick],
  );

  useEffect(() => {
    if (me?.tenantId && p) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId, key, p?.fromIso, p?.toIso]);

  const books = loaded.key === key ? loaded.books : EMPTY;

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/tax">
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
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/tax">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          What the gym files, and what it says about its own registration, are the
          owner&rsquo;s. The database refuses this read independently.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/tax">
      <h1>Tax</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '80ch' }}>
        The record a return is made from, for a period somebody files against. Not a
        return, and not a tax figure.
      </p>

      <Fetched at={readAt} busy={reading_} onRefresh={refresh}
               what="these books" style={{ margin: '2px 0 14px' }} />

      <Banner>{TAX_NO_RETURN_FIGURE}</Banner>

      <Profile
        profile={profile} state={profileState}
        tenantId={me.tenantId ?? null}
        onSaved={(next) => setProfile(next)}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '20px 0 4px' }}>
        <select value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 250 }}
                aria-label="Which period to show">
          {periods.map((k) => {
            const pp = taxPeriod(k);
            return <option key={k} value={k}>{pp ? pp.label : k}</option>;
          })}
        </select>
      </div>

      {!at
        ? <Banner tone="crit">{key} is not a period this console can open.</Banner>
        : <Period at={at} zoneErr={zoneErr} books={books} gymName={gymName} profile={profile} profileState={profileState} />}
    </Shell>
  );
}

/* ── what the gym says about itself ────────────────────────────────────────── */

/**
 * The two facts, and the form that states them.
 *
 * A three-way select rather than a checkbox, because a checkbox has two states
 * and this question has three: yes, no, and nobody has said. An unticked box
 * would tell a registered gym's owner, in the confident voice, that their
 * business is not registered.
 */
function Profile({ profile, state, tenantId, onSaved }: {
  profile: GymTaxProfile; state: 'loading' | 'ready' | 'error';
  tenantId: string | null; onSaved: (p: GymTaxProfile) => void;
}) {
  const [registered, setRegistered] = useState<string>('');
  const [registration, setRegistration] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // What was last loaded into the boxes, so a read arriving after a keystroke
  // does not overwrite what somebody is typing.
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || state !== 'ready') return;
    setRegistered(profile.registered === true ? 'yes' : profile.registered === false ? 'no' : '');
    setRegistration(profile.registration ?? '');
    setSeeded(true);
  }, [profile, state, seeded]);

  const draft: GymTaxProfile = {
    registered: registered === 'yes' ? true : registered === 'no' ? false : null,
    registration: registration.trim() || null,
  };
  const blockers = taxProfileBlockers(draft);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    if (blockers.length) { setErr(blockers[0]); return; }
    if (!tenantId) return;
    setBusy(true); setErr(null);
    try {
      await saveGymTaxProfile(supabase, tenantId, draft);
      onSaved(draft);
      setSaved('Saved. Repple holds this exactly as typed and has checked it against nothing.');
    } catch (e2: any) {
      setErr(writeFailedText(e2, {
        what: 'What this gym says about tax',
        unchanged: 'what this gym had on record is unchanged',
        howToCheck: 'Reload this page: the boxes above are filled from whatever is actually stored.',
      }));
    } finally { setBusy(false); }
  };

  const loadStatus = state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready';

  return (
    <Section
      title="What this gym says about tax"
      sub="Two facts, both typed by a person. There is no rate here, on an invoice, or anywhere else in this product."
    >
      <Announce say={err ?? saved} tone={err ? 'crit' : undefined} />
      <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13, maxWidth: '84ch' }}>
        {taxProfileLine(profile, loadStatus)}
      </p>
      <form onSubmit={save} style={formRow}>
        <select value={registered} onChange={(e) => setRegistered(e.target.value)}
                style={{ ...field, minWidth: 260 }} aria-label="Whether this gym is registered">
          <option value="">Nobody has said</option>
          <option value="yes">Registered for a tax on its sales</option>
          <option value="no">Not registered</option>
        </select>
        <input value={registration} onChange={(e) => setRegistration(e.target.value)}
               placeholder="Registration number, as it is printed" style={{ ...field, flex: 2, minWidth: 240 }}
               aria-label="The registration number, as printed on the gym’s own invoices" />
        <button type="submit" disabled={busy || !!blockers.length} style={primaryBtn}>Save</button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)', maxWidth: '84ch' }}>
        {TAX_FACTS_ARE_STATED_NOT_CHECKED} Everyone signed in at this gym can read the
        registration number, which is correct for the one tax fact a business has to print on
        its own invoices &mdash; so nothing else about your tax affairs belongs in this box.
      </p>
      {blockers.length ? (
        <ul style={{ margin: '0 14px 12px', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
          {blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
        </ul>
      ) : null}
      {err ? <Banner tone="crit" live={false}>{err}</Banner> : null}
      {saved ? <Banner live={false}>{saved}</Banner> : null}
    </Section>
  );
}

/* ── one period ────────────────────────────────────────────────────────────── */

function Period({ at, zoneErr, books, gymName, profile, profileState }: {
  at: PeriodAtZone; zoneErr: string | null; books: Books; gymName: string | null;
  profile: GymTaxProfile; profileState: 'loading' | 'ready' | 'error';
}) {
  const p = at.period;
  const payments = books.payments.rows ?? [];
  const costs = books.costs.rows ?? [];
  const raised = useMemo(
    () => (books.invoices.rows ?? []).filter((i) => i.issuedOn >= p.firstDay && i.issuedOn <= p.lastDay),
    [books.invoices.rows, p],
  );

  // Every figure below is a set of pots, one per currency, and there is no code
  // path here that adds two of them.
  const takenIn = useMemo(
    () => sumTaken(payments.map((r) => ({ amount_cents: r.amountCents, currency: r.currency, created_at: r.takenAt }))),
    [payments],
  );
  const billed = useMemo(
    () => sumTaken(raised.map((r) => ({ amount_cents: r.amountCents, currency: r.currency, created_at: r.issuedOn }))),
    [raised],
  );
  const paidOut = useMemo(() => gymCostsTaken(costs), [costs]);

  const moving = periodMovingNote(p, books.closed ?? []);

  return (
    <>
      {books.payments.why ? <Banner tone="crit">{books.payments.why}</Banner> : null}
      {books.invoices.why ? <Banner tone="crit">{books.invoices.why}</Banner> : null}
      {books.costs.why ? <Banner tone="crit">{books.costs.why}</Banner> : null}
      {books.closedErr ? <Banner tone="crit">{books.closedErr}</Banner> : null}

      {/* One sentence, and it is the one the basis supports. The page used to
          print "in the gym’s own timezone" over bounds built by
          `new Date(y, mo - 1, 1)`, which is the reader's laptop — so two people
          exported two different quarters out of one database under a caption
          saying they could not. `taxPeriodAt` returns the basis and the words
          together for exactly that reason. */}
      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '10px 0 0' }}>{at.note}</p>

      {/* A refused read of the timezone is a third state and gets its own
          sentence: the period below is on the device's clock, and nobody should
          be sent to Gym to set a timezone that may already be set. */}
      {zoneErr ? (
        <Banner tone="crit">
          The gym&rsquo;s timezone could not be read: {zoneErr}. The period below is
          therefore cut on your own device&rsquo;s clock. This is not a gym that has
          not set one &mdash; it is a setting nobody could ask for.
        </Banner>
      ) : null}

      {moving ? <Banner tone="crit">{moving}</Banner> : null}

      <Figures
        label="Taken" read={books.payments} taken={takenIn} p={p}
        note="Payments recorded at the desk or through the app, gross, counted on the day they were taken."
      />
      <Figures
        label="Billed" read={books.invoices} taken={billed} p={p}
        note="Invoices dated inside the period, whether or not they have been paid. A different basis from the line above and deliberately not added to it."
      />
      <Figures
        label="Paid out" read={books.costs} taken={paidOut} p={p}
        note="Costs recorded on the Costs screen, counted on the day the money went out. Trainer pay is not here — it is on Payroll, and wages sit outside a tax on sales."
      />

      <Unknowns />

      <Handoff
        p={p} gymName={gymName} books={books} raised={raised}
        profile={profile} profileState={profileState} moving={moving}
      />
    </>
  );
}

/**
 * One question, answered per currency and never once.
 *
 * A gym with one currency sees the single figure it would have seen anyway. A
 * gym with two sees two, and the note says outright that they are not added,
 * because a reader who is not told will add them.
 */
function Figures({ label, read, taken, p, note }: {
  label: string; read: Read<unknown>; taken: Taken; p: TaxPeriod; note: string;
}) {
  return (
    <Section title={`${label} — ${p.label}`} sub={note}>
      {read.state === 'loading' ? (
        // Announced, and the failure below it announced too — this is a page
        // somebody works a return from, and a section that quietly stops being
        // a figure has to say so out loud.
        <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '22px 16px', color: 'var(--ink3)' }}>Loading…</div>
      ) : read.state === 'failed' ? (
        <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '16px 14px', color: 'var(--ink2)', fontSize: 13, borderLeft: '3px solid var(--crit)' }}>
          This read failed, so this figure is <strong>unknown</strong> rather than nothing.
          Nothing on this line may be filed.
        </div>
      ) : !taken.pots.length ? (
        <div style={{ padding: '16px 14px', color: 'var(--ink3)', fontSize: 13 }}>
          Nothing is recorded in {p.label}. That is a statement about the record rather than
          about the gym.
        </div>
      ) : (
        <>
          <div style={grid}>
            {taken.pots.map((pot) => (
              <Kpi
                key={pot.currency}
                label={`${label} · ${pot.currency}`}
                text={money(pot.minorUnits, pot.currency)}
                note={`${pot.count} row${pot.count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
          {taken.pots.length > 1 ? (
            <p style={{ margin: '10px 14px 14px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
              Two currencies. They are not added and there is no combined figure &mdash; this app
              holds no rate, and a single number over them would be about neither.
            </p>
          ) : null}
          {taken.unlabelled || taken.unpriced ? (
            <p style={{ margin: '10px 14px 14px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
              {taken.unlabelled ? `${taken.unlabelled} row(s) state no currency and are counted out of the figures above. ` : ''}
              {taken.unpriced ? `${taken.unpriced} row(s) carry no amount, so the figures are short by exactly those. ` : ''}
              Neither is a zero.
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ── what Repple does not know ─────────────────────────────────────────────── */

/**
 * Itemised, not summarised.
 *
 * A reader told which six things are absent can decide whether their own
 * records cover them. A reader told "some data may be incomplete" concludes
 * that it is roughly right, which is the reading that gets filed.
 */
function Unknowns() {
  return (
    <Section
      title="What Repple does not know"
      sub="Every one of these has to be supplied from somewhere else before a return can be made. None of them is a gap this app can close by computing something."
    >
      <div style={{ padding: '4px 0' }}>
        {TAX_UNKNOWNS.map((u) => (
          <div key={u.title} style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{u.title}</div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink2)', maxWidth: '86ch' }}>{u.detail}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── the file ──────────────────────────────────────────────────────────────── */

function Handoff({ p, gymName, books, raised, profile, profileState, moving }: {
  p: TaxPeriod; gymName: string | null; books: Books; raised: GymInvoiceRow[];
  profile: GymTaxProfile; profileState: 'loading' | 'ready' | 'error'; moving: string | null;
}) {
  const loading = books.payments.state === 'loading'
    || books.invoices.state === 'loading'
    || books.costs.state === 'loading';

  const download = () => {
    const parts: string[] = [];
    const head = (t: string) => `\n${t}\n`;

    parts.push(`Tax records — ${gymName ?? 'this gym'} — ${p.label} (${p.firstDay} to ${p.lastDay})\n`);
    // The refusal travels with the file. A CSV read six weeks later, out of the
    // page that qualified it, is exactly where a column of takings becomes a
    // box on a return.
    parts.push('NOT A RETURN. Repple applies no tax rate to anything, holds no rate anywhere, and states no tax figure. These are the records a return is made from.\n');
    if (moving) parts.push(`${moving}\n`);
    parts.push(profileState === 'error'
      ? 'What this gym says about tax could not be read, so it is not stated here. That is not a statement that it has said nothing.\n'
      : `Registered: ${profile.registered === true ? 'yes, as stated by the gym' : profile.registered === false ? 'no, as stated by the gym' : 'nobody has said'}. Registration number: ${profile.registration ?? 'none stated'} (held as typed, never checked).\n`);

    parts.push(head('TAKEN — payments recorded in the period, gross'));
    // `!== null` and not `=== 'failed'`. `Unread` has THREE values, and the
    // third is 'loading' — a slice still in flight fell through to
    // `(rows ?? [])`, so pressing Export a second too early wrote a CSV headed
    // "TAKEN — payments recorded in the period" with nothing under it. Filed in
    // an accountant's folder, that is indistinguishable from a quarter in which
    // the gym took nothing.
    parts.push(books.payments.state !== null
      ? unreadable('the payments taken', books.payments.state, books.payments.why)
      : toCsv(
          ['Taken at', 'Member', 'Amount (minor units)', 'Currency', 'Method', 'Kind', 'Note'],
          (books.payments.rows ?? []).map((r) => [
            r.takenAt, r.memberName, r.amountCents, r.currency,
            (r.method ?? '').replace('_', ' '), r.kind, r.note,
          ]),
          false));

    parts.push(head('BILLED — invoices dated in the period'));
    parts.push(books.invoices.state !== null
      ? unreadable('the invoice register', books.invoices.state, books.invoices.why)
      : toCsv(
          ['Number', 'Issued', 'Due', 'Billed to', 'Amount (minor units)', 'Currency', 'Status'],
          raised.map((i) => [i.number, i.issuedOn, i.dueOn, i.memberName, i.amountCents, i.currency, i.status]),
          false));

    parts.push(head('PAID OUT — costs recorded in the period'));
    parts.push(books.costs.state !== null
      ? unreadable('the recorded costs', books.costs.state, books.costs.why)
      : toCsv(
          ['Paid on', 'What for', 'Paid to', 'Category', 'Amount (minor units)', 'Currency', 'Note'],
          (books.costs.rows ?? []).map((c) => [
            c.paidOn, c.description, c.supplier, c.category, c.amountCents, c.currency, c.note,
          ]),
          false));

    parts.push(head('WHAT REPPLE DOES NOT KNOW'));
    for (const u of TAX_UNKNOWNS) parts.push(`${u.title}: ${u.detail}\n`);

    saveText(parts.join(''), `${slugOf(gymName)}-${p.key}-tax-records.csv`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 24px' }}>
      {/* Disabled while any of the three is still in flight. The refusal
          travels in the file either way, but a button that cannot produce a
          whole quarter should not look like one that can. */}
      <button onClick={download} style={{ ...primaryBtn, opacity: loading ? 0.5 : 1 }} disabled={loading}>
        {loading ? 'Still reading the period…' : 'Export this period (CSV)'}
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '62ch' }}>
        The file carries the same refusal this page does, at the top, because a CSV read six
        weeks from now is exactly where a column of takings becomes a box on a return.
      </span>
    </div>
  );
}

/**
 * The line a read that has not landed exports as. Not an empty section.
 *
 * Two states, because loading and failed are two states and this file is read
 * six weeks later by somebody who cannot see the screen it came off. "Still
 * reading" tells them to export it again; "could not be read" tells them to
 * find out why. An empty section under either heading tells them the gym did
 * nothing.
 */
function unreadable(what: string, state: 'loading' | 'failed', why: string | null): string {
  return state === 'loading'
    ? `NOT EXPORTED — ${what} had not finished loading when this file was made. Export the period again. This is unknown, not nil.\n`
    : `NOT EXPORTED — ${what} could not be read${why ? `: ${why}` : ''}. This is unknown, not nil.\n`;
}

/** A filename fragment from the gym's name. */
function slugOf(name: string | null): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'gym';
}

/* ── the small pieces ──────────────────────────────────────────────────────── */

const grid = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 1, background: 'var(--ring)',
  borderRadius: 0, overflow: 'hidden',
} as const;

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

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
