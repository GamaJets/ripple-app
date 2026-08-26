'use client';

// Import — read a spreadsheet from whatever the gym used before Repple.
//
// The parser and the previewers have been in src/lib with tests since the CSV
// work landed; nothing has ever reached them. This is that surface.
//
// Everything is a dry run until the gym presses the button. previewMembers,
// previewPayments and previewPlans write nothing — they read the file, report
// what they found and what they could not make sense of, and hand back rows. An
// import that half-succeeded and left no record of which half is the worst
// outcome available, so the confirm step is deliberate, the preview is
// complete, and a run that only partly landed says so in those words.
//
// THREE KINDS, and they do not have the same powers. Each says which on screen
// rather than letting it be discovered at the end:
//
//  · Plans import. membership_plans holds nothing but the tenant and the plan
//    itself — no foreign key to a person — so a price book is a plain insert
//    and the whole file can land.
//
//  · Payments import. gym_payments.member_id is nullable, so a payment whose
//    member cannot be matched is still recorded — unattributed, which is true,
//    rather than dropped, which loses money the gym actually took.
//
//  · Members do NOT import. memberships.member_id is `not null references
//    profiles(id)`, so a membership needs a real account behind it, and
//    creating an account is an invite flow rather than an insert. The preview
//    still runs, because validating and cleaning the file is most of the work
//    and worth having before the invite path exists.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import {
  previewMembers, previewPayments, previewPlans, describePreview,
  type ImportPreview, type MemberRow, type PaymentRow, type PlanRow,
  type RowResult, type DateOrder,
} from '@lib/csvImport';
import {
  recordPayment, fetchMemberships, fetchPlans, money,
  type Membership, type MembershipPlan,
} from '@lib/gymRecord';

type Kind = 'payments' | 'members' | 'plans';

/** How a finished run went. Drives the wording and the colour of the result. */
type Outcome = 'all' | 'partial' | 'none';

export default function ImportPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('payments');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<DateOrder | ''>('');

  // Both of these stay null until the read actually returns. Null means "not
  // read yet or the read failed", [] means "read, and the gym has none" — they
  // are different facts and the screen never renders them the same way. The
  // error strings are what makes the failure case distinguishable from the
  // not-yet case.
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [priceBook, setPriceBook] = useState<MembershipPlan[] | null>(null);
  const [priceBookError, setPriceBookError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; outcome: Outcome } | null>(null);
  const [failed, setFailed] = useState<{ line: number; why: string }[]>([]);

  /**
   * Read the two things an import is checked against: who the gym already has,
   * and what it already sells.
   *
   * Deliberately two separate try blocks. One read failing must never be
   * reported as the other coming back empty, and neither may be reported as
   * "none" when what actually happened is that the query errored.
   */
  const loadGym = useCallback(async (tenant: string) => {
    try {
      setMembers(await fetchMemberships(supabase, tenant));
      setRosterError(null);
    } catch (e: any) {
      setMembers(null);
      setRosterError(e?.message ?? 'Could not read the member list.');
    }
    try {
      setPriceBook(await fetchPlans(supabase, tenant));
      setPriceBookError(null);
    } catch (e: any) {
      setPriceBook(null);
      setPriceBookError(e?.message ?? 'Could not read the price book.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const who = await loadMe();
      if (!who) return;
      setMe(who);
      setTenantId(who.tenantId);
      if (who.tenantId) {
        // supabase-js resolves on a database error rather than rejecting, so
        // the error has to be read off the result, not caught.
        const { data, error } = await supabase
          .from('tenants').select('name').eq('id', who.tenantId).single();
        setGymName(error ? null : ((data as any)?.name ?? null));
        await loadGym(who.tenantId);
      }
    })();
  }, [loadGym]);

  // Widened to the union element rather than left as a union OF previews: the
  // shape is identical either way and only the row type differs, so this reads
  // the common fields without a cast at every use.
  const preview = useMemo<ImportPreview<MemberRow | PaymentRow | PlanRow> | null>(() => {
    if (!text.trim()) return null;
    const o = order || undefined;
    // Plans carry no dates, so previewPlans takes no order to apply.
    if (kind === 'plans') return previewPlans(text);
    return kind === 'payments' ? previewPayments(text, o) : previewMembers(text, o);
  }, [text, kind, order]);

  /**
   * The plan rows that will be written, each still carrying its line number.
   *
   * `preview.ready` is a bare array of values, so a failure part-way through a
   * run could only be reported by position — which is off by however many rows
   * above it were rejected. Walking `preview.rows` instead keeps the line
   * number the gym can actually find in its spreadsheet. The predicate is the
   * one previewPlans itself uses to build `ready`, so the two cannot drift.
   */
  const planRows = useMemo<{ line: number; plan: PlanRow }[]>(() => {
    if (!preview || kind !== 'plans' || preview.missingRequired.length) return [];
    return (preview.rows as RowResult<PlanRow>[])
      .filter((r) => r.value !== undefined)
      .map((r) => ({ line: r.line, plan: r.value as PlanRow }));
  }, [preview, kind]);

  /**
   * The payment rows that will be written, each still carrying its line number.
   *
   * The same problem planRows solves, and it bites harder here. `preview.ready`
   * has the rejected rows taken out of it, so a position in that array is not a
   * line in the spreadsheet: it is short by however many rows above were
   * refused. Every failure reported from a run over `ready` therefore named a
   * line several rows too early — and the wording under a partial run tells the
   * gym to fix those lines and paste only those back in. Following that
   * instruction with the wrong numbers re-imports payments that already landed,
   * duplicating money the gym took, while the rows that actually failed stay
   * missing. Walking `preview.rows` keeps `r.line`, which is the number printed
   * down the side of their sheet.
   *
   * The predicate is previewPayments' own — a row with no errors — and not the
   * `value !== undefined` that previewPlans uses. Payments fill `value` in even
   * for a refused row (an unreadable amount becomes 0, an unreadable date an
   * empty string), so testing for its presence here would import exactly the
   * rows the preview has just told the gym it is skipping.
   */
  const paymentRows = useMemo<{ line: number; payment: PaymentRow }[]>(() => {
    if (!preview || kind !== 'payments' || preview.missingRequired.length) return [];
    return (preview.rows as RowResult<PaymentRow>[])
      .filter((r) => r.errors.length === 0)
      .map((r) => ({ line: r.line, payment: r.value as PaymentRow }));
  }, [preview, kind]);

  /**
   * Plan names in the file that the gym already sells.
   *
   * previewPlans de-duplicates within the file; it cannot know what is already
   * in the database. Importing anyway is allowed — the gym may be re-pricing —
   * but it is said out loud first, because two rows called "Monthly" leave the
   * price book selling at whichever one a list happens to put first.
   *
   * Null when the price book has not been read, which is not the same as no
   * collisions and is never rendered as a count.
   */
  const collisions = useMemo<{ names: string[]; bookSize: number } | null>(() => {
    if (kind !== 'plans' || priceBook === null) return null;
    const have = new Set(priceBook.map((p) => p.name.trim().toLowerCase()));
    return {
      names: planRows.map((r) => r.plan.name).filter((n) => have.has(n.trim().toLowerCase())),
      bookSize: priceBook.length,
    };
  }, [kind, priceBook, planRows]);

  /**
   * Match an imported payment to a member by name.
   *
   * Name only: Membership carries no email, so the email column the importer
   * parses cannot be used for matching without another read. Name matching is
   * exact after trimming and lower-casing — deliberately not fuzzy, because
   * attaching a payment to the wrong member is worse than leaving it
   * unattributed, and the screen says how many will be unattributed before
   * anything is written.
   */
  const matchMember = useCallback((row: PaymentRow): string | null => {
    const list = members ?? [];
    const name = (row.memberName ?? '').trim().toLowerCase();
    if (!name) return null;
    const hit = list.find((m) => (m.memberName ?? '').trim().toLowerCase() === name);
    return hit?.memberId ?? null;
  }, [members]);

  const runImport = async () => {
    if (!preview || !tenantId || kind !== 'payments' || !paymentRows.length) return;
    setBusy(true); setDone(null); setFailed([]);
    let ok = 0; const bad: { line: number; why: string }[] = [];
    for (const { line, payment } of paymentRows) {
      try {
        await recordPayment(supabase, tenantId, {
          memberId: matchMember(payment),
          amountCents: payment.amountCents,
          method: payment.method,
          takenAt: new Date(payment.takenOn + 'T12:00:00Z').toISOString(),
          note: payment.note,
        });
        ok++;
      } catch (e: any) {
        bad.push({ line, why: e?.message ?? 'write failed' });
      }
    }
    setBusy(false);
    setFailed(bad);
    setDone(report(ok, bad.length, 'payment', 'recorded'));
    if (ok > 0) await loadGym(tenantId);
  };

  /**
   * Write the ready plan rows into the gym's price book.
   *
   * Row by row rather than one array insert, so that a single row the database
   * refuses does not take the other forty with it and so the failure can be
   * reported against the line the gym has to go and fix.
   *
   * Not gymRecord.createPlan: that helper has no `active` parameter, and a plan
   * the sheet marks archived would go back on sale as a side effect of being
   * imported. previewPlans goes to some trouble to read that column honestly,
   * so it is written honestly. Everything else follows the house pattern —
   * supabase-js resolves on a database error, so `error` is read off the result
   * and thrown; a try/catch on its own would see only the network dying.
   */
  const runPlanImport = async () => {
    if (!preview || !tenantId || kind !== 'plans' || !planRows.length) return;
    setBusy(true); setDone(null); setFailed([]);
    let ok = 0; const bad: { line: number; why: string }[] = [];
    for (const { line, plan } of planRows) {
      try {
        const { error } = await supabase.from('membership_plans').insert({
          tenant_id: tenantId,
          name: plan.name,
          price_cents: plan.priceCents,
          currency: plan.currency,
          interval: plan.interval,
          active: plan.active,
        });
        if (error) throw error;
        ok++;
      } catch (e: any) {
        bad.push({ line, why: e?.message ?? 'write failed' });
      }
    }
    setBusy(false);
    setFailed(bad);
    setDone(report(ok, bad.length, 'plan', 'added to your price book'));
    // Re-read whatever landed, so the collision count on screen describes the
    // price book as it is now rather than as it was before the run.
    if (ok > 0) await loadGym(tenantId);
  };

  // Null, not 0, when the member list has not been read: "none of these match a
  // member" and "we could not check" are different answers and only one of them
  // is safe to act on.
  const matched = kind === 'payments' && preview && members !== null
    ? (preview.ready as PaymentRow[]).filter((r) => matchMember(r) !== null).length
    : null;

  if (!me) return null;

  return (
    <Shell me={me} gymName={gymName} current="/import">
      <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Import</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--ink3)', fontSize: 13 }}>
        Paste a spreadsheet exported from whatever you used before. Nothing is written until you
        say so, and you see exactly what will happen first.
      </p>

      <Section title="The file" sub="Copy the whole sheet, header row included, and paste it here.">
        <div style={{ ...formRow, borderBottom: 'none' }}>
          {(['payments', 'members', 'plans'] as Kind[]).map((k) => (
            <button key={k} onClick={() => { setKind(k); setDone(null); setFailed([]); }}
              style={k === kind
                ? { ...primaryBtn, textTransform: 'capitalize' }
                : { ...field, cursor: 'pointer', textTransform: 'capitalize' }}>
              {k}
            </button>
          ))}
          {/* A price book has no dates in it, so there is no convention to pick. */}
          {kind === 'plans' ? null : (
            <select value={order} onChange={(e) => setOrder(e.target.value as DateOrder | '')} style={field}>
              <option value="">Work out the date order</option>
              <option value="dmy">Dates are day/month/year</option>
              <option value="mdy">Dates are month/day/year</option>
              <option value="ymd">Dates are year-month-day</option>
            </select>
          )}
        </div>
        <div style={{ padding: '0 14px 14px' }}>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setDone(null); setFailed([]); }}
            placeholder={PLACEHOLDERS[kind]}
            rows={8}
            style={{ ...field, width: '100%', fontFamily: 'var(--mono)', fontSize: 12.5, resize: 'vertical' }}
          />
        </div>
      </Section>

      {kind === 'members' ? (
        <Note tone="warn">
          <strong style={{ color: 'var(--ink)' }}>Members can be checked here but not imported yet.</strong>{' '}
          A membership must point at a real Repple account, and creating an account is an invite
          rather than a row we can insert. The check below is still worth running — it finds the
          bad dates, the unreadable amounts and the columns nobody will recognise, which is most
          of the work of cleaning an export.
        </Note>
      ) : null}

      {kind === 'plans' ? (
        <Note tone="info">
          <strong style={{ color: 'var(--ink)' }}>Plans import in full.</strong>{' '}
          A plan is billed monthly, yearly or as a one-off, because those are the only three
          things the price book can hold. A row that says quarterly, weekly or six-monthly is
          refused with a reason rather than rounded into one of them — calling a quarterly plan
          monthly would divide the gym&rsquo;s recurring revenue by three.
        </Note>
      ) : null}

      {kind === 'payments' && rosterError ? (
        <Note tone="warn">
          <strong style={{ color: 'var(--ink)' }}>The member list could not be read</strong>, so no
          payment can be matched to anybody: {rosterError}. Importing now would record every
          payment unattributed. Reload the page first.
        </Note>
      ) : null}

      {kind === 'plans' && priceBookError ? (
        <Note tone="warn">
          <strong style={{ color: 'var(--ink)' }}>The price book could not be read</strong>, so this
          cannot say which of these plans the gym already sells: {priceBookError}. The import itself
          still works; it just cannot warn you about duplicates.
        </Note>
      ) : null}

      {preview ? (
        <>
          <Section title="What the file says" sub={describePreview(preview)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1, background: 'var(--ring)' }}>
              <Kpi label="Rows read" text={String(preview.rows.length)} />
              <Kpi label="Ready" text={String(preview.ready.length)} />
              <Kpi label="Need attention" text={String(preview.rejected.length)} />
              {kind === 'payments' ? (
                <Kpi
                  label="Matched to a member"
                  text={matched === null ? null : String(matched)}
                  note={matched === null
                    ? (rosterError ? 'member list could not be read' : 'member list not read yet')
                    : (preview.ready.length ? `${preview.ready.length - matched} will be unattributed` : undefined)}
                />
              ) : null}
              {kind === 'plans' ? (
                <Kpi
                  label="Already in your price book"
                  text={collisions === null ? null : String(collisions.names.length)}
                  note={collisions === null
                    ? (priceBookError ? 'price book could not be read' : 'price book not read yet')
                    : collisions.bookSize === 0
                      ? 'your price book is empty'
                      : `out of ${collisions.bookSize} plan${collisions.bookSize === 1 ? '' : 's'} already recorded`}
                />
              ) : null}
            </div>

            {collisions && collisions.names.length ? (
              <p style={{ margin: '12px 14px', fontSize: 12.5, color: '#f0c04e' }}>
                {collisions.names.length === 1 ? 'One plan' : `${collisions.names.length} plans`} in this file
                already {collisions.names.length === 1 ? 'exists' : 'exist'} in your price book:{' '}
                <span style={{ fontFamily: 'var(--mono)' }}>{collisions.names.join(', ')}</span>. Importing
                creates a second copy rather than changing the price of the first. Nothing is removed
                from this import — decide before you confirm.
              </p>
            ) : null}

            {preview.missingRequired.length ? (
              <p style={{ margin: '12px 14px', fontSize: 13, color: '#ef8080' }}>
                No {preview.missingRequired.join(' or ')} column found, so nothing can be read from this file.
              </p>
            ) : null}

            {preview.dateOrder === 'ambiguous' ? (
              <p style={{ margin: '12px 14px', fontSize: 13, color: '#f0c04e' }}>
                Every date in this file works read either way round — 03/04 could be 3 April or
                4 March. Say which above; guessing would silently move somebody&rsquo;s renewal by
                nine months.
              </p>
            ) : null}

            {preview.unmatchedColumns.length ? (
              <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                Ignoring {preview.unmatchedColumns.length} column{preview.unmatchedColumns.length === 1 ? '' : 's'} nothing recognised:{' '}
                <span style={{ fontFamily: 'var(--mono)' }}>{preview.unmatchedColumns.join(', ')}</span>. They are
                reported rather than dropped quietly, in case one of them mattered.
              </p>
            ) : null}
          </Section>

          {preview.rejected.length ? (
            <Section title={`${preview.rejected.length} rows need attention`}
                     sub="These are skipped. Fix them in the sheet and paste again — nothing here is imported.">
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {preview.rejected.slice(0, 60).map((r) => (
                  <div key={r.line} style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {r.line}</span>
                    <span style={{ color: 'var(--ink2)' }}>{r.errors.join(' · ')}</span>
                  </div>
                ))}
                {preview.rejected.length > 60 ? (
                  <p style={{ margin: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                    …and {preview.rejected.length - 60} more. Showing the first 60 so the page stays readable.
                  </p>
                ) : null}
              </div>
            </Section>
          ) : null}

          {kind === 'payments' && paymentRows.length > 0 ? (
            <Section title="Import" sub={`${paymentRows.length} payments will be recorded. This writes to your gym.`}>
              <div style={{ ...formRow, borderBottom: 'none' }}>
                <button onClick={runImport} disabled={busy || !tenantId} style={primaryBtn}>
                  {busy ? 'Importing…' : `Record ${paymentRows.length} payments`}
                </button>
                {!tenantId ? <span style={{ fontSize: 13, color: '#ef8080' }}>{NO_TENANT}</span> : null}
                <Result done={done} />
              </div>
              <Failures failed={failed} />
            </Section>
          ) : null}

          {/*
            The confirm step for plans. Everything above this is a dry run; this
            is the only place a plan reaches the database, and it lists the rows
            by name and price first so that pressing the button is a decision
            about known content rather than a number.
          */}
          {kind === 'plans' && planRows.length > 0 ? (
            <Section
              title="Import"
              sub={`${planRows.length} plan${planRows.length === 1 ? '' : 's'} will be added to your price book. This writes to your gym.`}
            >
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {planRows.slice(0, 60).map(({ line, plan }) => (
                  <div key={line} style={{
                    display: 'flex', gap: 12, padding: '8px 14px',
                    borderTop: '1px solid var(--ring)', fontSize: 12.5, alignItems: 'baseline',
                  }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {line}</span>
                    <span style={{ color: 'var(--ink)', flex: 1 }}>{plan.name}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink2)' }}>
                      {money(plan.priceCents, plan.currency) ?? '—'}
                    </span>
                    <span style={{ color: 'var(--ink3)', minWidth: 68 }}>
                      {plan.interval === 'once' ? 'one-off' : `per ${plan.interval}`}
                    </span>
                    <span style={{ color: 'var(--ink3)', minWidth: 54 }}>
                      {plan.active ? 'on sale' : 'retired'}
                    </span>
                  </div>
                ))}
                {planRows.length > 60 ? (
                  <p style={{ margin: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                    …and {planRows.length - 60} more, all of which will be imported. Showing the
                    first 60 so the page stays readable.
                  </p>
                ) : null}
              </div>
              <div style={{ ...formRow, borderBottom: 'none', borderTop: '1px solid var(--ring)' }}>
                <button onClick={runPlanImport} disabled={busy || !tenantId} style={primaryBtn}>
                  {busy
                    ? 'Importing…'
                    : `Add ${planRows.length} plan${planRows.length === 1 ? '' : 's'}`}
                </button>
                {!tenantId ? <span style={{ fontSize: 13, color: '#ef8080' }}>{NO_TENANT}</span> : null}
                <Result done={done} />
              </div>
              <Failures failed={failed} />
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

/* ── local presentation ────────────────────────────────────────────────────── */

/**
 * Say what a finished run actually did.
 *
 * The one sentence this must never produce is "12 plans imported" when five
 * landed. A run that only partly succeeded is named as such and gives both
 * numbers, and it says what to do next, because the obvious instinct — paste
 * the file again — would import everything that did land a second time.
 */
function report(ok: number, bad: number, noun: string, verb: string): { text: string; outcome: Outcome } {
  const s = (n: number) => (n === 1 ? '' : 's');
  if (ok === 0 && bad === 0) return { text: 'Nothing was written.', outcome: 'none' };
  if (bad === 0) return { text: `All ${ok} ${noun}${s(ok)} ${verb}.`, outcome: 'all' };
  if (ok === 0) {
    return {
      text: `Nothing was written. All ${bad} ${noun}${s(bad)} were refused — the reasons are below.`,
      outcome: 'none',
    };
  }
  return {
    text: `Partly imported: ${ok} of ${ok + bad} ${noun}${s(ok + bad)} ${verb}, and ${bad} could not `
      + `be written. The ${ok} that landed are saved — fix the lines below and paste only those, `
      + `or the rest will be imported twice.`,
    outcome: 'partial',
  };
}

const OUTCOME_COLOUR: Record<Outcome, string> = {
  all: 'var(--ink2)',
  partial: '#f0c04e',
  none: '#ef8080',
};

function Result({ done }: { done: { text: string; outcome: Outcome } | null }) {
  if (!done) return null;
  return (
    <span style={{ fontSize: 13, color: OUTCOME_COLOUR[done.outcome], flex: 1, minWidth: 220 }}>
      {done.text}
    </span>
  );
}

function Failures({ failed }: { failed: { line: number; why: string }[] }) {
  if (!failed.length) return null;
  return (
    <div style={{ padding: '0 14px 14px' }}>
      {failed.slice(0, 20).map((f) => (
        <div key={f.line} style={{ fontSize: 12.5, color: '#ef8080' }}>line {f.line}: {f.why}</div>
      ))}
      {failed.length > 20 ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 4 }}>
          …and {failed.length - 20} more that could not be written.
        </div>
      ) : null}
    </div>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <p style={{
      border: '1px solid var(--ring)',
      borderLeft: `3px solid ${tone === 'warn' ? '#f0c04e' : 'var(--brand)'}`,
      borderRadius: 8, background: 'var(--surface)', padding: '14px 16px', fontSize: 13,
      lineHeight: 1.55, color: 'var(--ink2)', margin: '0 0 22px',
    }}>
      {children}
    </p>
  );
}

function Kpi({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px' }}>
      <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{label}</span>
      {/* An em-dash, never a zero: a figure that is not known and a figure that
          is genuinely none must not read the same. */}
      <span style={{
        display: 'block', fontSize: 22, fontFamily: 'var(--mono)', marginTop: 4,
        color: text === null ? 'var(--ink3)' : 'var(--ink)',
      }}>
        {text ?? '—'}
      </span>
      {note ? <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</span> : null}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One example header row per kind, using the aliases the importer recognises. */
const PLACEHOLDERS: Record<Kind, string> = {
  payments: 'member,amount,date,method\nJane Okafor,250.00,04/03/2026,card',
  members: 'name,email,plan,started,status\nJane Okafor,jane@example.com,Monthly,04/03/2025,active',
  plans: 'name,price,interval,currency,active\nMonthly,250.00,month,AED,yes\nDay pass,40.00,once,AED,yes',
};

const NO_TENANT =
  'Your account is not attached to a gym yet, so there is nowhere to write this.';

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};
