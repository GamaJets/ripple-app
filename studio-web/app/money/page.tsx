'use client';

// Money — the gym's price book, its memberships and what it has been paid.
//
// This is Phase 1 of the roadmap, and deliberately a capture screen rather than
// a dashboard: until a gym records what it sells and what it takes, there is
// nothing for a chart to draw and nothing for a forecast to learn from.
import { useCallback, useEffect, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchPlans, createPlan, setPlanActive,
  fetchMemberships, createMembership, setMembershipStatus,
  setMembershipDates, setMembershipPlan,
  fetchPayments, recordPayment, reversePayment, reversalBlocker, reversedAgainst,
  summarise, money, PAYMENT_KIND_LABEL,
  type MembershipPlan, type Membership, type GymPayment,
  type PlanInterval, type PaymentMethod, type CorrectionKind,
} from '@lib/gymRecord';
import { isoDay } from '@lib/gymInvoices';
import {
  fetchPassTypes, createPassType, setPassTypeActive, passTypeBlocker,
  PASS_COVERS, PASS_COVERS_LABEL, type PassCovers,
  type PassType, type PassKind,
} from '@lib/gymPasses';

const DAY = 86400000;

export default function Money() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameErr, setGymNameErr] = useState<string | null>(null);
  // `tenants.currency`. The two tiles below are sums across the gym's payments
  // and plans, so they have no single row's currency to borrow — they inherit
  // the gym's, and print nothing when the gym has not set one.
  const [ccy, setCcy] = useState<TenantCurrency>(null);

  // Three independent reads, each carrying its own error. null means "not read
  // yet, or the read failed"; [] means "read, and the gym genuinely has none".
  // They are different facts and nothing on this screen may render them the
  // same way — the error strings are what tells the two apart.
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [plansErr, setPlansErr] = useState<string | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [membersErr, setMembersErr] = useState<string | null>(null);
  const [payments, setPayments] = useState<GymPayment[] | null>(null);
  const [paymentsErr, setPaymentsErr] = useState<string | null>(null);
  // The desk's half of the price book. /door sells from this list and has never
  // been able to add to it: `createPassType` had no caller anywhere, so a gym
  // that had not had rows inserted by hand in the Supabase dashboard saw an
  // empty "issue a pass" dropdown and a screen telling them to come here.
  const [passTypes, setPassTypes] = useState<PassType[] | null>(null);
  const [passTypesErr, setPassTypesErr] = useState<string | null>(null);

  /**
   * Read the price book, the memberships and the payments taken.
   *
   * allSettled, not all: one failing read must not take the others with it.
   * Under a single catch over Promise.all, a price book that would not read
   * also blanked the memberships and the payments to [] — and [] renders as
   * "No payments recorded in the last 30 days", which an owner reads as a
   * month with no income rather than as a query that never came back. A read
   * that failed stays null, and every figure drawn from it shows a dash.
   */
  const load = useCallback(async (tenantId: string) => {
    const [pRes, mRes, payRes, ptRes] = await Promise.allSettled([
      fetchPlans(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
      fetchPayments(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString()),
      fetchPassTypes(supabase, tenantId),
    ]);

    if (pRes.status === 'fulfilled') { setPlans(pRes.value); setPlansErr(null); }
    else { setPlans(null); setPlansErr(why(pRes.reason, 'Could not read the price book.')); }

    if (mRes.status === 'fulfilled') { setMembers(mRes.value); setMembersErr(null); }
    else { setMembers(null); setMembersErr(why(mRes.reason, 'Could not read the memberships.')); }

    if (payRes.status === 'fulfilled') { setPayments(payRes.value); setPaymentsErr(null); }
    else { setPayments(null); setPaymentsErr(why(payRes.reason, 'Could not read the payments.')); }

    if (ptRes.status === 'fulfilled') { setPassTypes(ptRes.value); setPassTypesErr(null); }
    else { setPassTypes(null); setPassTypesErr(why(ptRes.reason, 'Could not read the pass price book.')); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setPlans([]); setMembers([]); setPayments([]); setPassTypes([]); return; }
      // supabase-js resolves with { data, error } on a database error rather
      // than rejecting, so the error has to be read off the result, not caught.
      // Destructuring only `data` turned an RLS refusal into t === null, and
      // the sidebar then printed "No gym linked" — a claim about the owner's
      // account, when the account is demonstrably linked (this is the branch
      // where tenantId exists) and all that failed was the name lookup.
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, currency').eq('id', who.tenantId).single();
      if (live) {
        setGymName(tErr ? null : ((t as any)?.name ?? null));
        setCcy(tErr ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
        setGymNameErr(tErr ? (tErr.message || 'Could not read the gym name.') : null);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/money">
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
      <Shell me={me} gymName={gymName} current="/money">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>Money is owner-only.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const sum = plans && members && payments ? summarise(payments, members, plans) : null;
  // The currency each SUM is actually in. A set with no rows states nothing, so
  // there is nothing to disagree with and the gym's own currency is the honest
  // label; a set whose rows disagree has no single currency at all, and `null`
  // is what makes `amount()` withhold the figure rather than pick a side.
  const takenCcy = sum == null || sum.payments === 0 ? ccy : sum.takenCurrency;
  const mrrCcy = sum == null || sum.mrrCents == null ? ccy : sum.mrrCurrency;
  const refresh = () => load(tenantId);

  // summarise needs all three reads, so any one of them failing leaves every
  // figure above the tables unknown. Name the reads that did not arrive: a bare
  // dash sitting over the note "nothing recorded yet" is how a failure starts
  // being read as a confident zero.
  const failed = [
    paymentsErr ? 'the payments' : null,
    membersErr ? 'the memberships' : null,
    plansErr ? 'the price book' : null,
  ].filter((s): s is string => s !== null);
  const unread = failed.length ? `could not read ${failed.join(', ')}` : undefined;

  return (
    <Shell me={me} gymName={gymName} current="/money">
      <h1>Money</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What the gym sells, who holds a membership, and what has actually been paid.
      </p>

      {gymNameErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but the gym&rsquo;s name could not be read: {gymNameErr}.
          The sidebar says &ldquo;No gym linked&rdquo; only because it has nothing to print — that
          is this failed lookup, not a fact about the account.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        {/* `amount`, not `money`: these are sums with no currency of their own,
            so they inherit the gym's. The tiles go to a dash naming the missing
            setting instead of a figure in a money nobody chose.

            `money()` used to write "AED" over anything it was not told, which
            is what this note was warning about. It has no default any more — it
            withholds an amount it cannot denominate — so the choice between the
            two doors is now about clarity rather than safety. */}
        {/* The currency comes from the ROWS THAT WERE ADDED UP, and only falls
            back to the gym's when they state none between them.

            `ccy` alone was wrong in a way nothing showed: both of these sums
            ignore what currency each row is in, `gym_payments.currency` and
            `membership_plans.currency` are `not null default 'AED'`, and this
            gym may have set GBP since. Those dirhams were added to those pounds
            and the tile said GBP. `takenCurrency`/`mrrCurrency` are null
            exactly when the contributing rows disagree, and a total that cannot
            be denominated is withheld rather than labelled with a guess. */}
        <Kpi label="Taken (30 days)" text={amount(sum?.takenCents, takenCcy)}
             note={sum?.takenCents == null ? (unread ?? 'nothing recorded yet')
               : takenCcy ? `${sum.payments} payments`
               : sum && sum.takenCurrency === null && sum.payments > 0
                 ? 'these payments are in more than one currency, so there is no one total'
                 : NO_CURRENCY_NOTE} />
        <Kpi label="Recurring / month" text={amount(sum?.mrrCents, mrrCcy)}
             note={sum?.mrrCents == null ? (unread ?? 'no priced membership')
               : mrrCcy ? undefined
               : sum && sum.mrrCurrency === null
                 ? 'these plans are priced in more than one currency, so there is no one total'
                 : NO_CURRENCY_NOTE} />
        <Kpi label="Active members" text={sum ? String(sum.activeMembers) : null} note={sum ? undefined : unread} />
        <Kpi label="Plans on sale" text={plans ? String(plans.filter((p) => p.active).length) : null} note={plans ? undefined : (plansErr ? 'the price book could not be read' : undefined)} />
      </div>

      <Plans plans={plans} readErr={plansErr} tenantId={tenantId} ccy={ccy} onChange={refresh} />
      <PassTypes types={passTypes} readErr={passTypesErr} tenantId={tenantId} ccy={ccy} onChange={refresh} />
      <Members members={members} readErr={membersErr} plans={plans} tenantId={tenantId} onChange={refresh} />
      <Payments payments={payments} readErr={paymentsErr} members={members} tenantId={tenantId} me={me} ccy={ccy} onChange={refresh} />
    </Shell>
  );
}

/* ── plans ─────────────────────────────────────────────────────────────────── */

function Plans({ plans, readErr, tenantId, ccy, onChange }: {
  plans: MembershipPlan[] | null; readErr: string | null; tenantId: string;
  ccy: TenantCurrency; onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [interval, setInterval] = useState<PlanInterval>('month');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = parseFloat(price);
    if (!name.trim() || !isFinite(major)) return;
    // A price with no currency is not a price. `createPlan` used to stamp 'AED'
    // over whatever it was not told and `membership_plans.currency` is `not null
    // default 'AED'`, so a gym that never set one had its whole price book
    // written in dirhams and read back as its own answer. The write is refused
    // instead: nothing here can find out what money this gym charges in, and a
    // plan is what a member is actually billed.
    if (!ccy) {
      setWriteErr(`That plan was not saved: ${NO_CURRENCY_NOTE}, so there is no currency to price it in. An owner sets it on the gym settings screen, and this form works the moment they have.`);
      return;
    }
    setBusy(true); setWriteErr(null);
    try {
      await createPlan(supabase, tenantId, {
        name: name.trim(), priceCents: Math.round(major * 100), interval, currency: ccy,
      });
      setName(''); setPrice(''); onChange();
    } catch (e: any) {
      // createPlan throws on a PostgREST error. With a try/finally and no
      // catch, the only visible effect of a refusal was the button coming back
      // to life: the plan never appeared in the table below, which reads as a
      // list that has not refreshed yet rather than as a write that did not
      // happen. The typed name and price are deliberately left in the form —
      // nothing was saved, so there is something to retry.
      setWriteErr(`That plan was not saved: ${e?.message ?? 'the write was refused'}. Nothing has changed in the price book.`);
    } finally { setBusy(false); }
  };

  const cols: Column<MembershipPlan>[] = [
    { key: 'name', header: 'Plan', value: (p) => p.name },
    { key: 'price', header: 'Price', value: (p) => p.priceCents, numeric: true,
      render: (p) => money(p.priceCents, p.currency) },
    { key: 'interval', header: 'Billed', value: (p) => p.interval,
      render: (p) => (p.interval === 'once' ? 'one-off' : `per ${p.interval}`) },
    { key: 'active', header: '', value: (p) => (p.active ? 1 : 0), align: 'right',
      render: (p) => (
        // setPlanActive rejects on a PostgREST error, and a bare .then swallowed
        // it: onChange never ran, so the row simply stayed as it was and the
        // owner saw a button that looked unclicked. Say which plan did not move
        // and which side of the price book it is still on.
        <button
          onClick={() => setPlanActive(supabase, p.id, !p.active)
            .then(() => { setWriteErr(null); onChange(); })
            .catch((e: any) => setWriteErr(
              `Could not ${p.active ? 'retire' : 'reinstate'} ${p.name}: ${e?.message ?? 'the change was refused'}. It is still ${p.active ? 'on sale' : 'retired'}.`))}
          style={linkBtn}
        >
          {p.active ? 'Retire' : 'Reinstate'}
        </button>
      ) },
  ];

  return (
    <Section title="Price book" sub="Retiring a plan keeps it on the memberships already sold on it.">
      <form onSubmit={add} style={formRow}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" style={{ ...field, flex: 2 }} />
        {/* The placeholder names the currency the number will be STORED in.
            A bare "Price" is the gap that let a GBP gym type 50 into a field
            whose write said dirhams. */}
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={ccy ? `Price (${ccy})` : 'Price'} inputMode="decimal" style={{ ...field, flex: 1 }} />
        <select value={interval} onChange={(e) => setInterval(e.target.value as PlanInterval)} style={{ ...field, flex: 1 }}>
          <option value="month">per month</option>
          <option value="year">per year</option>
          <option value="once">one-off</option>
        </select>
        <button type="submit" disabled={busy || !ccy} style={primaryBtn}>Add plan</button>
      </form>
      {ccy ? null : <Banner>Plans cannot be priced until this gym sets its currency &mdash; {NO_CURRENCY_NOTE}. Guessing one would write it into every price sold on it.</Banner>}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {plans === null ? (
        readErr ? (
          <Banner tone="crit">
            The price book could not be read: {readErr}. This is not an empty price book — it is a
            query that did not come back, so nothing here can be taken as a list of what the gym
            sells. Reload the page.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={plans} columns={cols} rowKey={(p) => p.id}
          empty="No plans yet. A gym cannot record a membership until it has something to sell." />
      )}
    </Section>
  );
}

/* ── what the desk sells ───────────────────────────────────────────────────── */

/** How each kind reads, and what it is for. The words are the desk's, not the
 *  column's: `drop_in` means nothing to whoever is standing at the counter. */
const KIND_LABEL: Record<PassKind, string> = {
  drop_in: 'drop-in',
  guest: 'guest pass',
  pack: 'pack of visits',
};

const KIND_NOTE: Record<PassKind, string> = {
  drop_in: 'one visit, bought by anyone who walks in',
  guest: 'one visit, brought by a member — /door asks who the host is',
  pack: 'a block of visits used over time',
};

/**
 * The pass price book — drop-ins, guest passes and packs.
 *
 * This sits under Money rather than on /door because it is a price book, and it
 * is the list /door already tells the desk to come here for. The desk sells from
 * it; nobody at the desk decides what a day pass costs.
 *
 * A pack's visits and a pass's expiry are copied onto each pass AT THE MOMENT
 * OF SALE (`issuePass`), so editing this list later cannot rewrite a pass
 * somebody is already holding. That is why retiring is the only change offered
 * here and there is no edit: a price that changed under the passes sold on it
 * is exactly the fiction this whole console is written against.
 */
function PassTypes({ types, readErr, tenantId, ccy, onChange }: {
  types: PassType[] | null; readErr: string | null; tenantId: string;
  ccy: TenantCurrency; onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PassKind>('drop_in');
  // What a credit on this type may be spent on. Defaults to the door and
  // classes, which is what every pass sold before supabase/parts/370 is: a gym
  // opts a type IN to paying for personal training, so no existing class pack
  // starts paying for PT the day this ships.
  const [covers, setCovers] = useState<PassCovers>('visit');
  const [price, setPrice] = useState('');
  const [uses, setUses] = useState('1');
  const [validDays, setValidDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  // The draft as the library will see it, so the sentence the owner reads before
  // pressing anything is the one `createPassType` would have thrown.
  const major = parseFloat(price);
  const draft = {
    name,
    kind,
    priceCents: Number.isFinite(major) ? Math.round(major * 100) : null,
    currency: ccy,
    uses: uses.trim() === '' ? 1 : parseInt(uses, 10),
    validDays: validDays.trim() === '' ? null : parseInt(validDays, 10),
    covers,
  };
  // Only nag once there is something to nag about, and never about the currency
  // before they have typed a price — the banner below already says that.
  const blocker = (name.trim() || price.trim()) ? passTypeBlocker(draft) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const stop = passTypeBlocker(draft);
    if (stop) { setWriteErr(stop); return; }
    setBusy(true); setWriteErr(null);
    try {
      await createPassType(supabase, tenantId, {
        name: draft.name.trim(),
        kind: draft.kind,
        priceCents: draft.priceCents!,
        // Non-null by the blocker above. `gym_pass_types.currency` is NOT NULL
        // with no default since supabase/parts/150, so a pass priced in a
        // currency nobody chose is refused by the database rather than filed as
        // dirhams — and this form refuses it before that, with a sentence.
        currency: ccy!,
        uses: draft.uses,
        validDays: draft.validDays,
        covers: draft.covers,
      });
      setName(''); setPrice('');
      onChange();
    } catch (x: any) {
      setWriteErr(`That pass was not added: ${x?.message ?? 'the write was refused'}. Nothing has changed at the desk.`);
    } finally { setBusy(false); }
  };

  const cols: Column<PassType>[] = [
    { key: 'name', header: 'Pass', value: (t) => t.name },
    { key: 'kind', header: 'Kind', value: (t) => t.kind, render: (t) => KIND_LABEL[t.kind] ?? t.kind },
    { key: 'price', header: 'Price', value: (t) => t.priceCents, numeric: true,
      // The ROW's currency, not the gym's: a pass priced before the gym changed
      // its currency still states the money it was priced in.
      render: (t) => money(t.priceCents, t.currency) ?? <span className="dash">no currency on this pass</span> },
    { key: 'uses', header: 'Visits', value: (t) => t.uses, numeric: true },
    // What the credit is good FOR, beside how many of them there are. Without
    // this column the desk cannot tell a ten-class pack from a ten-PT pack, and
    // the two are the same three words on a receipt.
    { key: 'covers', header: 'Good for', value: (t) => t.covers,
      render: (t) => PASS_COVERS_LABEL[t.covers] ?? t.covers },
    { key: 'valid', header: 'Expires after', value: (t) => t.validDays, numeric: true,
      // Null is a decision — this pass does not expire — and not a gap, so it
      // gets words rather than a bare dash.
      render: (t) => t.validDays == null
        ? <span className="dash">does not expire</span>
        : `${t.validDays} days` },
    { key: 'state', header: 'Status', value: (t) => (t.active ? 1 : 0),
      render: (t) => t.active
        ? <span style={{ color: 'var(--good)' }}>on sale</span>
        : <span style={{ color: 'var(--ink3)' }}>retired</span> },
    { key: 'act', header: '', value: (t) => (t.active ? 1 : 0), align: 'right',
      render: (t) => (
        <button
          onClick={() => setPassTypeActive(supabase, t.id, !t.active)
            .then(() => { setWriteErr(null); onChange(); })
            .catch((x: any) => setWriteErr(
              `Could not ${t.active ? 'retire' : 'put back on sale'} ${t.name}: ${x?.message ?? 'the change was refused'}. It is still ${t.active ? 'on sale' : 'retired'} at the desk.`))}
          style={linkBtn}
        >
          {t.active ? 'Retire' : 'Back on sale'}
        </button>
      ) },
  ];

  return (
    <Section
      title="Pass price book"
      sub="Drop-ins, guest passes and packs — what the desk can sell on the Door screen. Retiring one keeps every pass already sold on it valid."
    >
      <form onSubmit={add} style={formRow}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pass name" style={{ ...field, flex: 2, minWidth: 140 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as PassKind)} style={{ ...field, flex: 1, minWidth: 130 }}>
          {(Object.keys(KIND_LABEL) as PassKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        {/* Two different products that look identical on a receipt. A pass good
            for personal training is drawn down when a coach marks a session
            complete; one good for the door and classes never is. */}
        <select value={covers} onChange={(e) => setCovers(e.target.value as PassCovers)} style={{ ...field, flex: 1, minWidth: 150 }}>
          {PASS_COVERS.map((c) => (
            <option key={c} value={c}>{PASS_COVERS_LABEL[c]}</option>
          ))}
        </select>
        {/* The placeholder names the currency the number will be STORED in. A
            bare "Price" is the gap that let a GBP gym type 50 into a field whose
            write said dirhams. */}
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={ccy ? `Price (${ccy})` : 'Price'} inputMode="decimal" style={{ ...field, width: 120 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          <input value={uses} onChange={(e) => setUses(e.target.value)} inputMode="numeric" style={{ ...field, width: 58 }} />
          visits
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          expires after
          <input value={validDays} onChange={(e) => setValidDays(e.target.value)} inputMode="numeric" placeholder="never" style={{ ...field, width: 72 }} />
          days
        </label>
        <button type="submit" disabled={busy || !ccy} style={primaryBtn}>Add pass</button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)' }}>
        {KIND_LABEL[kind]}: {KIND_NOTE[kind]}. Leave the days blank for a pass
        that does not expire — that is a decision a gym makes, and it is not the
        same as nought days.{' '}
        {covers === 'pt'
          ? 'A personal training pass is drawn down when a coach marks a session complete, and the member sees which session used which credit.'
          : 'A door and classes pass is never drawn down by a personal training session, however many visits are left on it.'}
      </p>
      {ccy ? null : (
        <Banner>
          Passes cannot be priced until this gym sets its currency &mdash; {NO_CURRENCY_NOTE}. Every
          pass sold on a type carries that type&rsquo;s currency onto the sale, so a guess here would
          be copied onto every pass the desk ever sells from it.
        </Banner>
      )}
      {blocker && !writeErr ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e' }}>{blocker}</p>
      ) : null}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {types === null ? (
        readErr ? (
          <Banner tone="crit">
            The pass price book could not be read: {readErr}. This is not a gym that sells no passes
            — it is a query that did not come back, and adding one now could duplicate a pass that
            is already on sale. Reload the page.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={types} columns={cols} rowKey={(t) => t.id}
          empty="No pass types yet. Until there is one, the Door screen's “issue a pass” list is empty and the desk cannot sell a drop-in." />
      )}
    </Section>
  );
}

/* ── memberships ───────────────────────────────────────────────────────────── */

function Members({ members, readErr, plans, tenantId, onChange }: {
  members: Membership[] | null; readErr: string | null;
  plans: MembershipPlan[] | null; tenantId: string; onChange: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [planId, setPlanId] = useState('');
  // When this membership actually began, and when it ends. Both were absent
  // and `startedOn` was hardcoded to today — which for a gym MIGRATING its
  // existing roster is not a small omission: every member arrives dated the day
  // the owner typed them in, so tenure is wrong for everybody on day one,
  // cohort retention measures from a date nobody joined, and the ageing on
  // /accounting has no history to age. None of it is recoverable afterwards
  // without a write that offers the field.
  const [startedOn, setStartedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState('');
  const [busy, setBusy] = useState(false);
  // Covers every write in this section — adding a membership, changing its
  // status, correcting its dates and moving it to another plan. Any of them
  // failing has to be visible; none may look like nothing.
  const [writeErr, setWriteErr] = useState<string | null>(null);
  // Which row has its dates open for editing. One at a time: an inline editor
  // on every row at once is four hundred uncommitted date fields, and the first
  // reload throws all of them away without saying so.
  const [editing, setEditing] = useState<string | null>(null);

  const dateBlocker =
    !isoDay(startedOn) ? 'The start date has to be a real date — YYYY-MM-DD.'
    : endsOn && !isoDay(endsOn) ? 'The end date has to be a real date, or empty for an open-ended membership.'
    : endsOn && endsOn < startedOn ? 'That membership would end before it started.'
    : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId.trim()) return;
    if (dateBlocker) { setWriteErr(dateBlocker); return; }
    setBusy(true); setWriteErr(null);
    try {
      await createMembership(supabase, tenantId, {
        memberId: memberId.trim(),
        planId: planId || null,
        startedOn,
        // '' is an open-ended membership, which is a real state and not the
        // same as expired. It is written as null rather than as today.
        endsOn: endsOn || null,
      });
      setMemberId(''); onChange();
    } catch (e: any) {
      setWriteErr(e?.message ?? 'Could not add that membership.');
    } finally { setBusy(false); }
  };

  const savePlan = (m: Membership, next: string) => {
    setMembershipPlan(supabase, m.id, next || null)
      .then(() => { setWriteErr(null); onChange(); })
      .catch((err: any) => setWriteErr(
        `Could not move ${m.memberName || 'that membership'} onto another plan: ${err?.message ?? 'the change was refused'}. It is still on ${m.planName ?? 'no plan'}.`));
  };

  const cols: Column<Membership>[] = [
    { key: 'member', header: 'Member', value: (m) => m.memberName || null },
    // A plan change, not a cancel-and-recreate. The console used to force the
    // second, which resets `started_on` and files the old row as churn — so a
    // four-year member reads as a new one on every retention figure the product
    // computes the moment they upgrade.
    { key: 'plan', header: 'Plan', value: (m) => m.planName,
      render: (m) => (
        <select
          value={m.planId ?? ''}
          onChange={(e) => savePlan(m, e.target.value)}
          style={{ ...field, padding: '4px 6px', fontSize: 12, maxWidth: 170 }}
          aria-label={`The plan ${m.memberName ?? 'this membership'} is on`}
        >
          <option value="">{plans === null ? 'no plan — price book unread' : 'no plan'}</option>
          {(plans ?? []).filter((p) => p.active || p.id === m.planId).map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (retired)'}</option>
          ))}
        </select>
      ) },
    { key: 'started', header: 'Started', value: (m) => m.startedOn,
      render: (m) => editing === m.id
        ? <MembershipDates m={m} onDone={() => { setEditing(null); onChange(); }} onErr={setWriteErr} />
        : <button style={linkBtn} onClick={() => setEditing(m.id)} title="Correct these dates">{m.startedOn}</button> },
    { key: 'ends', header: 'Ends', value: (m) => m.endsOn,
      render: (m) => m.endsOn ?? <span className="dash">open-ended</span> },
    { key: 'status', header: 'Status', value: (m) => m.status,
      render: (m) => <span style={{ textTransform: 'capitalize' }}>{m.status}</span> },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (m) => (
        // setMembershipStatus rejects on a PostgREST error, and a bare .then
        // dropped it. The select is driven by m.status, so a refused change
        // repainted the old value the moment the row re-rendered — the owner
        // sees the dropdown flick back and has no way to know whether they
        // misclicked or the database said no. Say which, and say what the
        // membership still is.
        <select
          value={m.status}
          onChange={(e) => {
            const next = e.target.value as any;
            setMembershipStatus(supabase, m.id, next)
              .then(() => { setWriteErr(null); onChange(); })
              .catch((err: any) => setWriteErr(
                `Could not set ${m.memberName || 'that membership'} to ${next}: ${err?.message ?? 'the change was refused'}. It is still ${m.status}.`));
          }}
          style={{ ...field, padding: '4px 6px', fontSize: 12 }}
        >
          <option value="active">active</option>
          <option value="frozen">frozen</option>
          <option value="cancelled">cancelled</option>
          <option value="expired">expired</option>
        </select>
      ) },
  ];

  return (
    <Section title="Memberships" sub="The member id is their Repple account id — the same person who signs into the app. Start and end dates are the gym's to state: a migrated roster whose every member starts today has no tenure and no cohort to measure.">
      <form onSubmit={add} style={formRow}>
        <input value={memberId} onChange={(e) => setMemberId(e.target.value)}
               placeholder="Member account id (uuid)" style={{ ...field, flex: 3, fontFamily: 'var(--mono)', fontSize: 12.5 }} />
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={{ ...field, flex: 2 }}>
          {/* A price book that would not read leaves this list with nothing in
              it, which is indistinguishable from a gym that sells nothing. The
              placeholder says which, so nobody sells a membership off-plan
              believing there was no plan to put it on. */}
          <option value="">{plans === null ? 'No plan — the price book could not be read' : 'No plan'}</option>
          {(plans ?? []).filter((p) => p.active).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label style={dateLabel}>
          started
          <input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day this membership began" />
        </label>
        <label style={dateLabel}>
          ends
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day this membership ends, if it does" />
        </label>
        <button type="submit" disabled={busy || !!dateBlocker} style={primaryBtn}>Add membership</button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)' }}>
        Leave the end date empty for a membership that runs until somebody cancels it — open-ended
        is a decision a gym makes and it is not the same as expired. Click a start date in the table
        to correct it.
      </p>
      {dateBlocker && !writeErr ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e' }}>{dateBlocker}</p>
      ) : null}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {members === null ? (
        readErr ? (
          <Banner tone="crit">
            The memberships could not be read: {readErr}. Nobody has been cancelled and nobody has
            left — the list did not come back, which is why the member count above is a dash rather
            than a zero. Reload the page.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={members} columns={cols} rowKey={(m) => m.id}
          empty="No memberships recorded. This is the row that makes retention and revenue measurable." />
      )}
    </Section>
  );
}

/**
 * The two dates of one membership, corrected in place.
 *
 * Inline rather than in a sheet because the correction is almost always made
 * while reading the row — an owner who has just noticed that everybody on the
 * migrated roster says they joined last Tuesday. A modal would put the list
 * they are checking against behind it.
 */
function MembershipDates({ m, onDone, onErr }: {
  m: Membership; onDone: () => void; onErr: (s: string | null) => void;
}) {
  const [from, setFrom] = useState(m.startedOn);
  const [to, setTo] = useState(m.endsOn ?? '');
  const [busy, setBusy] = useState(false);

  const bad =
    !isoDay(from) ? 'not a date'
    : to && !isoDay(to) ? 'end is not a date'
    : to && to < from ? 'ends before it starts'
    : null;

  const save = async () => {
    if (bad) { onErr(`Those dates cannot be saved — ${bad}.`); return; }
    setBusy(true);
    try {
      await setMembershipDates(supabase, m.id, { startedOn: from, endsOn: to || null });
      onErr(null);
      onDone();
    } catch (e: any) {
      // setMembershipDates checks the ROW COUNT, so a refusal by
      // `memberships_owner` arrives here rather than as a silent 204 that
      // leaves the old dates on screen looking saved.
      onErr(`Those dates were NOT changed: ${e?.message ?? 'the write was refused'}. The membership still starts ${m.startedOn}.`);
    } finally { setBusy(false); }
  };

  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
             style={{ ...field, padding: '3px 5px', fontSize: 12, width: 130 }}
             aria-label="The day this membership began" />
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
             style={{ ...field, padding: '3px 5px', fontSize: 12, width: 130 }}
             aria-label="The day it ends, if it does" />
      <button style={linkBtn} disabled={busy || !!bad} onClick={save}>Save</button>
      <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={onDone}>Cancel</button>
      {bad ? <span style={{ fontSize: 11.5, color: '#f0c04e' }}>{bad}</span> : null}
    </span>
  );
}

/* ── payments ──────────────────────────────────────────────────────────────── */

function Payments({ payments, readErr, members, tenantId, me, ccy, onChange }: {
  payments: GymPayment[] | null; readErr: string | null; members: Membership[] | null;
  tenantId: string; me: Me; ccy: TenantCurrency; onChange: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [memberId, setMemberId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  // Three fields `recordPayment` has always accepted and this form never sent.
  //
  //   takenAt      Saturday's cash could not be entered on Monday. Every
  //                payment was stamped with the moment somebody typed it, so a
  //                gym that does its books weekly had a week's takings all
  //                landing on one day — and a month-end that bore no relation
  //                to when the money arrived.
  //   note         the Note column this same screen renders was a dash on
  //                every row, because nothing could write one.
  //   membershipId the only HARD link between a payment and what it was for.
  //                Its absence is why /accounting's reconciliation is a 45-day
  //                fuzzy match on member, amount and currency — the page says
  //                so on screen — and why /revenue has to attribute payments by
  //                asking whether the payer held a membership covering the day.
  const [takenOn, setTakenOn] = useState('');
  const [note, setNote] = useState('');
  const [membershipId, setMembershipId] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);
  /** The payment being corrected, or null. One at a time, deliberately. */
  const [correcting, setCorrecting] = useState<GymPayment | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = parseFloat(amount);
    if (!isFinite(major)) return;
    if (takenOn && !isoDay(takenOn)) {
      setWriteErr('That payment was NOT recorded: the date it was taken is not a real date. Leave it empty to record it as now.');
      return;
    }
    // The money was handed over in something. `gym_payments.currency` is `not
    // null default 'AED'`, so a write that does not say which stamps dirhams on
    // a figure an owner will later reconcile against a bank statement — and
    // nothing on the row, or on any screen reading it, marks it as a guess.
    // Refusing costs one setting; guessing costs the ledger.
    if (!ccy) {
      setWriteErr(`That payment was NOT recorded: ${NO_CURRENCY_NOTE}, so there is no currency to record it in and a guessed one would be stored permanently. Set the gym's currency and enter it again \u2014 the money is still not in the record.`);
      return;
    }
    setBusy(true); setWriteErr(null);
    try {
      await recordPayment(supabase, tenantId, {
        memberId: memberId || null,
        amountCents: Math.round(major * 100),
        method,
        recordedBy: me.id,
        currency: ccy,
        // Midday UTC rather than midnight, for a date the owner typed. A
        // payment stamped 00:00 on the 1st lands in the previous month for
        // every gym west of Greenwich, and the whole point of this field is
        // getting a payment into the month it actually belongs to.
        takenAt: takenOn ? `${takenOn}T12:00:00.000Z` : undefined,
        note: note.trim() || null,
        membershipId: membershipId || null,
      });
      setAmount(''); setNote(''); setMembershipId(''); onChange();
    } catch (e: any) {
      // recordPayment throws on a PostgREST error. With a try/finally and no
      // catch, a refused write looked exactly like a successful one whose list
      // had not refreshed yet — and this is money. An owner who believes a
      // payment is recorded and finds it missing will chase a member who has
      // already paid, or never chase one who has not. The amount stays in the
      // box on purpose: nothing was written, so the row is still owed.
      setWriteErr(`That payment was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing was saved — the money is not in the gym record and has to be entered again.`);
    } finally { setBusy(false); }
  };

  const rows = payments ?? [];

  const cols: Column<GymPayment>[] = [
    { key: 'when', header: 'Taken', value: (p) => p.takenAt,
      render: (p) => new Date(p.takenAt).toLocaleString() },
    { key: 'member', header: 'Member', value: (p) => p.memberName },
    { key: 'amount', header: 'Amount', value: (p) => p.amountCents, numeric: true,
      // A correction renders in the critical colour with its sign, because it
      // is the one row on this table whose amount reduces the total and a
      // reader scanning a column of figures will not otherwise see the minus.
      render: (p) => (
        <span style={{ color: p.amountCents < 0 ? 'var(--crit)' : undefined }}>
          {money(p.amountCents, p.currency)}
        </span>
      ) },
    { key: 'kind', header: 'Kind', value: (p) => PAYMENT_KIND_LABEL[p.kind],
      render: (p) => p.kind === 'payment'
        ? <span style={{ color: 'var(--ink3)' }}>payment</span>
        : <span style={{ color: 'var(--crit)' }}>{PAYMENT_KIND_LABEL[p.kind].toLowerCase()}</span> },
    { key: 'method', header: 'Method', value: (p) => p.method.replace('_', ' ') },
    { key: 'note', header: 'Note', value: (p) => p.note },
    { key: 'fix', header: '', value: () => '', align: 'right',
      render: (p) => {
        // Only an ordinary payment can be corrected. Correcting a correction
        // leaves two rows nobody can read as a pair, and the amount is already
        // negative — the second minus would ADD money to the ledger.
        if (p.kind !== 'payment') {
          const orig = rows.find((x) => x.id === p.reversesPaymentId);
          return (
            <span style={{ color: 'var(--ink3)', fontSize: 12 }}>
              {orig
                ? `against ${new Date(orig.takenAt).toLocaleDateString()}`
                : 'against a payment outside this window'}
            </span>
          );
        }
        const done = reversedAgainst(p.id, rows);
        if (done >= p.amountCents) {
          return <span style={{ color: 'var(--ink3)', fontSize: 12 }}>reversed in full</span>;
        }
        return <button style={linkBtn} onClick={() => { setWriteErr(null); setCorrecting(p); }}>Refund or correct</button>;
      } },
  ];

  const options = [...new Map((members ?? [])
    .filter((m) => m.memberName)
    .map((m) => [m.memberId, m.memberName!])).entries()];

  // Only live memberships, plus whichever member is selected. A payment against
  // a cancelled membership is ordinary — arrears are usually paid after the
  // membership stops — so the list narrows by member rather than by status.
  const memberships = (members ?? []).filter((m) => !memberId || m.memberId === memberId);

  return (
    <Section title="Payments taken" sub="Last 30 days. A payment appears here because somebody recorded it — never because it was inferred.">
      <form onSubmit={add} style={formRow}>
        {/* Names the currency this figure is STORED in, not the one the reader
            assumes. The Members screen's twin of this form had its label
            corrected and its write left alone, which is how a GBP gym came to
            hold dirhams. */}
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={ccy ? `Amount (${ccy})` : 'Amount'} inputMode="decimal" style={{ ...field, flex: 1 }} />
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...field, flex: 2 }}>
          {/* When the member list did not read, this dropdown holds nobody —
              which looks like a gym with no members rather than a list that
              failed. Unattributed is permanent once written, so the label says
              why the names are missing before anyone accepts it. */}
          <option value="">{members === null ? 'Unattributed — the member list could not be read' : 'Unattributed'}</option>
          {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ ...field, flex: 1 }}>
          <option value="card">card</option>
          <option value="cash">cash</option>
          <option value="transfer">transfer</option>
          <option value="direct_debit">direct debit</option>
          <option value="other">other</option>
        </select>
        <label style={dateLabel}>
          taken
          <input type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day the money was handed over" />
        </label>
        <select value={membershipId} onChange={(e) => setMembershipId(e.target.value)} style={{ ...field, flex: 2 }}
                aria-label="The membership this payment settles">
          <option value="">Not against a membership</option>
          {memberships.map((m) => (
            <option key={m.id} value={m.id}>
              {m.memberName ?? 'Unnamed'} — {m.planName ?? 'no plan'} (from {m.startedOn})
            </option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note"
               style={{ ...field, flex: 2 }} aria-label="A note on this payment" />
        <button type="submit" disabled={busy || !ccy} style={primaryBtn}>Record</button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)' }}>
        Leave the date empty to record the money as arriving now. Saying which membership a payment
        settles is what turns the reconciliation on{' '}
        <a href="/accounting" style={{ color: 'var(--brand)' }}>Accounting</a> from a 45-day guess
        into a fact — nothing else in the database links a payment to what it was for.
      </p>
      {ccy ? null : <Banner>Payments cannot be recorded until this gym sets its currency &mdash; {NO_CURRENCY_NOTE}. A recorded amount is permanent, and it is only a number until it says what money it is.</Banner>}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {correcting ? (
        <Correction
          p={correcting}
          all={rows}
          tenantId={tenantId}
          me={me}
          onDone={() => { setCorrecting(null); onChange(); }}
          onCancel={() => setCorrecting(null)}
          onErr={setWriteErr}
        />
      ) : null}
      {payments === null ? (
        readErr ? (
          <Banner tone="crit">
            The payments could not be read: {readErr}. This is not a month in which the gym took
            nothing — it is a query that did not return, and the total above shows a dash for the
            same reason. Reload before deciding anyone is behind on payment.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={payments} columns={cols} rowKey={(p) => p.id}
          empty="No payments recorded in the last 30 days." />
      )}
    </Section>
  );
}

/* ── correcting money ──────────────────────────────────────────────────────── */

/**
 * Take money back off the ledger.
 *
 * There was no refund, no void, no credit note and no edit for a payment
 * anywhere in this product. An owner who typed 5000 instead of 500 had created
 * a permanent row that this screen lists, /revenue totals, /accounting
 * reconciles against and /close carries into a month somebody files.
 *
 * A correction is a NEW ROW with a negative amount pointing at what it undoes,
 * never a status flag on the original. supabase/parts/168 argues that at
 * length; the short version is that eleven queries in this console add
 * `amount_cents` up, a `status <> 'void'` predicate would have to be added to
 * all of them and to everything written after today, and the one that forgets
 * is silently wrong in the direction of MORE money.
 *
 * Two words for it, because they are two events. A REFUND is money that left
 * the till and went back to the member. A CORRECTION is money that was never in
 * it — a mis-key, a duplicate, a payment entered against the wrong person. Both
 * are negative and an accountant reads them differently.
 */
function Correction({ p, all, tenantId, me, onDone, onCancel, onErr }: {
  p: GymPayment; all: GymPayment[]; tenantId: string; me: Me;
  onDone: () => void; onCancel: () => void; onErr: (s: string | null) => void;
}) {
  const already = reversedAgainst(p.id, all);
  const remaining = p.amountCents - already;
  const [kind, setKind] = useState<CorrectionKind>('refund');
  // Pre-filled with what is left, because a full reversal is the common case
  // and typing an amount that has to match to the penny is where a partial
  // reversal nobody meant comes from.
  const [amt, setAmt] = useState((remaining / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(p.method);
  const [busy, setBusy] = useState(false);

  const cents = Math.round(parseFloat(amt) * 100);
  const blocker =
    reversalBlocker(p, already, Number.isFinite(cents) ? cents : NaN)
    ?? (note.trim() ? null : 'Say what this is for. A negative row in the ledger with no reason on it is the line an accountant asks about and nobody can answer.');

  const go = async () => {
    if (blocker) { onErr(blocker); return; }
    setBusy(true);
    try {
      await reversePayment(supabase, tenantId, p, {
        kind, amountCents: cents, note: note.trim(), method, recordedBy: me.id,
      });
      onErr(null);
      onDone();
    } catch (e: any) {
      onErr(`Nothing was taken back: ${e?.message ?? 'the write was refused'}. The original payment of ${money(p.amountCents, p.currency) ?? 'that amount'} still stands in full.`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '0 14px 14px', padding: '12px 14px', background: 'var(--surface2)',
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
    }}>
      <div className="micro">Correcting {money(p.amountCents, p.currency)} from {p.memberName ?? 'nobody named'}</div>
      <p style={{ margin: '7px 0 10px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '72ch' }}>
        This writes a new row for the negative amount rather than changing the one above. The
        original stays exactly as it was recorded, because it is what happened, and the two net to
        the right figure in every total on every screen &mdash; including the ones written after
        today. It is dated TODAY, not the day of the original: money handed back in September
        belongs in September, and a month that has already been closed will refuse it.
        {already > 0 ? ` ${money(already, p.currency)} has already been taken back off this payment.` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as CorrectionKind)}
                style={{ ...field, minWidth: 220 }} aria-label="What kind of correction this is">
          <option value="refund">Refund — the money went back to them</option>
          <option value="correction">Correction — it was never taken</option>
        </select>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal"
               style={{ ...field, width: 130 }}
               aria-label={`How much to take back, in ${p.currency}`}
               placeholder={`Amount (${p.currency})`} />
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                style={{ ...field, width: 150 }} aria-label="How the money went back">
          <option value="card">card</option>
          <option value="cash">cash</option>
          <option value="transfer">transfer</option>
          <option value="direct_debit">direct debit</option>
          <option value="other">other</option>
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)}
               placeholder="Why — this is on the record permanently"
               style={{ ...field, flex: 2, minWidth: 220 }} aria-label="Why this is being taken back" />
        <button onClick={go} disabled={busy || !!blocker} style={primaryBtn}>
          {busy ? 'Writing…' : 'Take it back'}
        </button>
        <button onClick={onCancel} style={{ ...linkBtn, color: 'var(--ink3)' }}>Cancel</button>
      </div>
      {blocker ? <p style={{ margin: '9px 0 0', fontSize: 12.5, color: '#f0c04e', maxWidth: '68ch' }}>{blocker}</p> : null}
    </div>
  );
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

/** Promise.allSettled hands the rejection back as `unknown`. Every fetch here
 *  rejects with an Error, so this is its message — and a named fallback rather
 *  than an empty banner, because a blank explanation of a failed read is only
 *  marginally better than no banner at all. */
function why(reason: unknown, fallback: string): string {
  return (reason as any)?.message ?? fallback;
}

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
 *  empty box with a picker icon and nothing saying what date it wants, and two
 *  of them in one row is a coin toss. */
const dateLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--ink3)', fontSize: 12.5,
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
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
