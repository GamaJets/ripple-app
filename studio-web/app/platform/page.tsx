'use client';

// Repple — the platform's own book.
//
// The one screen in this console that is NOT about a gym. Everything else here
// reads what members pay a gym; this reads what trainers and gyms pay Repple,
// and the two are never mixed, never added, and never on the same page.
//
// ── Why it exists ─────────────────────────────────────────────────────────
//
// docs/OWNER-PORTAL.md: platform data was removed from the owner app —
// correctly, because `role = 'owner'` is a GYM owner and a gym owner has no
// business seeing Repple's MRR — and nothing replaced it. The reason nothing
// could is not that the screen was hard. It is that after supabase/parts/39 and
// 106 tightened the billing policies, the reader set for `subscriptions`,
// `invoices` and `billing_customers` is "the trainer themselves, and the owner
// of that trainer's own gym", and nobody at Repple is on it.
// supabase/parts/252 adds exactly one reader: the `platform_admins` allowlist.
//
// ── What this refuses ─────────────────────────────────────────────────────
//
// An MRR figure. The reasoning is in studio-web/lib/platform.ts under
// `NO_MRR_NOTE` and it is short: what a plan costs is not in this database, so
// an MRR would be a sum over three prices typed into a markdown file. That is
// the exact pattern OWNER-PORTAL.md's own closing section warns about — "a
// plausible constant standing in for a measurement, then arithmetic on top of
// it, then a confident label". What Stripe actually billed is measured, and it
// is reported in the currency Stripe billed it in, never merged.
//
// It also names nobody. Part 252 deliberately does not widen `profiles`.
//
// ── And what it says when the allowlist is empty ──────────────────────────
//
// "Not your console", to everybody, which is what a fresh project should say.
// An empty allowlist is the default state and is not a fault — the refusal
// names it, so the first person to open this page does not go looking for a
// broken query.
import { useEffect, useState } from 'react';
import { loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { Shell } from '@/components/Shell';
// See studio-web/components/Banner.tsx: the shared banner carries the live
// region every local copy of this component was missing.
import { Banner } from '@/components/Banner';
// ── Why this screen gained a freshness stamp and three others did not ──────
//
// Four console routes carried no `<Fetched>`: /settings, /export,
// /coach/checklists and this one. The three were left off deliberately and the
// reason given was "forms and job screens, where a stamp is noise and a
// background re-read would fight the form". That reason is real and specific —
// `useFetched` re-reads on every `visibilitychange`, unconditionally, so an
// owner who alt-tabs away from a half-filled settings form and comes back has
// the read that repopulates it fired underneath them.
//
// It does not apply here. This page has no form, no draft, nothing typed and
// nothing to lose: it is four money tiles and two tables over three reads, and
// it is the ONE screen in the console whose figures nobody at the gym is
// watching change — a Repple admin opens it, leaves the tab, and reads
// yesterday's subscription count off it a day later with nothing on the page
// saying so. That is precisely the case the stamp was built for, and being
// rarely opened is an argument for it rather than against.
//
// No poll. Nothing here is written while somebody stands at a desk.
import { Fetched, useFetched } from '@/components/Fetched';
import {
  isPlatformAdmin, fetchPlatformBook, byPlan, byStatus, sumInvoices, potLabel,
  needsAttention, INVOICE_WINDOW_DAYS,
  NO_MRR_NOTE, NOT_GYM_MONEY_NOTE, EMPTY_BOOK_NOTE, UNREAD_NOTE, REFUSED_NOTE,
  type AdminCheck, type PlatformBook,
} from '@/lib/platform';

/** The states a paid subscription can be in. Split out rather than inlined
 *  because the same two lists decide two figures on this page and two lists
 *  that drift apart is how "active" comes to mean two things on one screen. */
const PAYING = ['active'] as const;
const NOT_YET_PAYING = ['trialing'] as const;

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ border: '1px solid var(--ring)', padding: '12px 14px', minWidth: 150 }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>{value}</div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}

/** The dash every unknown figure on this page renders as. U+2014, matching the
 *  rest of the console. Never "0" — an empty read is not a business with no
 *  revenue, and this is the screen where that distinction costs the most. */
const DASH = '—';

export default function Platform() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [admin, setAdmin] = useState<AdminCheck | null>(null);
  const [book, setBook] = useState<PlatformBook | null>(null);

  /**
   * The book, and when it was last read WHOLE.
   *
   * `true` only when all three reads came back. `fetchPlatformBook` keeps each
   * one's outcome separately and returns null for the ones that failed — see
   * `pagedOrNull` — and the page already draws a dash and a banner for those.
   * The stamp must not move for a partial read: the figures still on screen
   * would be the earlier ones, and re-dating them is the same untruth the
   * banner beside it is there to prevent.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(async () => {
    const b = await fetchPlatformBook();
    setBook(b);
    return b.subscriptions !== null && b.invoices !== null && b.customers !== null;
  }, { enabled: admin === 'yes' });

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
      if (!who) return;
      const check = await isPlatformAdmin();
      if (!live) return;
      setAdmin(check);
    })();
    return () => { live = false; };
  }, []);

  // The book is read only once the allowlist has answered yes. Reading it
  // anyway would work — RLS refuses and returns nothing — and it would put an
  // empty result on screen that this page then has to explain, when the honest
  // explanation is the one line above it.
  useEffect(() => {
    if (admin === 'yes') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  const shell = (children: React.ReactNode) => (
    <Shell me={me} gymName={null} platformAdmin={admin === 'yes'} current="/platform">{children}</Shell>
  );

  // ── the profile read, before the allowlist read ──────────────────────
  //
  // Both of these are about the same failure and they arrive from two different
  // queries, so both have to be said. `roleUnknown` means the `profiles` row did
  // not READ — which is not a fact about who this person is, and telling them
  // "not your console" over it is the console's oldest bug (see the note on
  // `Me.roleUnknown` in studio-web/lib/supabase.ts).
  if (me.roleUnknown) {
    return shell(<>
      <h1>We could not read your account</h1>
      <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
        Your profile did not load, so this console does not know what you are — which is not the
        same as you not having access. Reload the page; if it keeps happening the database refused
        the read rather than you.
      </p>
    </>);
  }

  // A signed-in account with no role at all read fine and is nobody's staff. It
  // is a different sentence from the refusal below, because the fix is
  // different: this one is somebody who has not been set up yet.
  if (!me.role) {
    return shell(<>
      <h1>Not your console</h1>
      <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
        Your account read fine and carries no role, so it is not staff at any gym and it is not on
        Repple’s own allowlist either. Whoever set your account up needs to give it a role first.
      </p>
    </>);
  }

  if (admin === null) return shell(<div style={{ color: 'var(--ink3)' }}>Checking your access…</div>);

  // A failed check is not a refusal. Saying "not your console" over a network
  // blip tells somebody something false about their own access, and they would
  // have no reason to try again.
  if (admin === 'unknown') {
    return shell(<>
      <h1>Repple</h1>
      <Banner tone="crit" style={{ maxWidth: '72ch' }}>
        Whether your account may read Repple’s own billing could not be checked, so nothing has been
        loaded. That is a read that failed rather than an answer about you — reload the page.
      </Banner>
    </>);
  }

  if (admin === 'no') {
    return shell(<>
      <h1>Not your console</h1>
      <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>{REFUSED_NOTE}</p>
      <p style={{ color: 'var(--ink3)', marginTop: 10, maxWidth: '62ch', fontSize: 13 }}>
        The database says the same thing independently: the three billing tables carry a{' '}
        <span className="mono">…_platform_admin</span> policy scoped to{' '}
        <span className="mono">is_platform_admin()</span>, and that function reads a table with no
        insert policy for anybody. Nothing here depends on this page having checked.
      </p>
    </>);
  }

  if (!book) return shell(<><h1>Repple</h1><div style={{ color: 'var(--ink3)' }}>Reading the book…</div></>);

  const subs = book.subscriptions;
  const invs = book.invoices;
  const paying = subs ? byPlan(subs, PAYING as unknown as string[]) : null;
  const trialing = subs ? byPlan(subs, NOT_YET_PAYING as unknown as string[]) : null;
  const statuses = subs ? byStatus(subs) : null;
  const invoiced = invs ? sumInvoices(invs) : null;
  const paid = invs ? sumInvoices(invs, ['paid']) : null;
  const attention = invs ? needsAttention(invs) : null;

  const countOf = (rows: Array<[string, number]> | null): string =>
    rows ? String(rows.reduce((a, [, n]) => a + n, 0)) : DASH;

  return shell(<>
    <h1>Repple</h1>
    <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '72ch' }}>{NOT_GYM_MONEY_NOTE}</p>

    {/* Named as the book rather than as "this screen": the sentence sits above
        four tiles and two tables and has to say what it is the age OF. */}
    <Fetched at={readAt} busy={reading} onRefresh={refresh} what="Repple’s book" />

    {subs === null || invs === null ? (
      <Banner tone="crit" style={{ maxWidth: '72ch' }}>
        {subs === null && invs === null
          ? `Neither the subscriptions nor the invoices came back. ${UNREAD_NOTE}`
          : subs === null
            ? `The subscriptions did not come back. ${UNREAD_NOTE}`
            : `The invoices did not come back. ${UNREAD_NOTE}`}
      </Banner>
    ) : subs.length === 0 && invs.length === 0 ? (
      <Banner style={{ maxWidth: '72ch' }}>{EMPTY_BOOK_NOTE}</Banner>
    ) : null}

    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '18px 0' }}>
      <Tile label="Paying" value={countOf(paying)} note="subscriptions marked active" />
      <Tile label="On trial" value={countOf(trialing)} note="not paying yet" />
      <Tile label="Stripe customers" value={book.customers == null ? DASH : String(book.customers)}
        note="accounts opened, whether or not they subscribed" />
      <Tile label="Needing attention"
        value={attention == null ? DASH : String(attention.length)}
        note={`open, uncollectible, or paid only after a retry — last ${INVOICE_WINDOW_DAYS} days`} />
    </div>

    <Banner style={{ maxWidth: '72ch' }}>{NO_MRR_NOTE}</Banner>

    <h2 style={{ marginTop: 26 }}>By plan</h2>
    {paying === null ? (
      <p className="dash" style={{ marginTop: 8 }}>{UNREAD_NOTE}</p>
    ) : paying.length === 0 ? (
      <p style={{ color: 'var(--ink3)', marginTop: 8 }}>Nothing is marked active.</p>
    ) : (
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Plan</th><th style={{ textAlign: 'right' }}>Active</th></tr></thead>
        <tbody>
          {paying.map(([plan, n]) => (
            <tr key={plan}><td>{plan}</td><td className="mono" style={{ textAlign: 'right' }}>{n}</td></tr>
          ))}
        </tbody>
      </table>
    )}

    <h2 style={{ marginTop: 26 }}>Every status</h2>
    <p style={{ color: 'var(--ink3)', fontSize: 13, maxWidth: '72ch' }}>
      The whole set, including any status this console has never heard of — a subscription silently
      left out of a total is the one worth looking at.
    </p>
    {statuses === null ? (
      <p className="dash" style={{ marginTop: 8 }}>{UNREAD_NOTE}</p>
    ) : statuses.length === 0 ? (
      <p style={{ color: 'var(--ink3)', marginTop: 8 }}>No subscriptions on record.</p>
    ) : (
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Status</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
        <tbody>
          {statuses.map(([s, n]) => (
            <tr key={s}><td>{s}</td><td className="mono" style={{ textAlign: 'right' }}>{n}</td></tr>
          ))}
        </tbody>
      </table>
    )}

    <h2 style={{ marginTop: 26 }}>Billed, last {INVOICE_WINDOW_DAYS} days</h2>
    <p style={{ color: 'var(--ink3)', fontSize: 13, maxWidth: '72ch' }}>
      What Stripe actually invoiced, in the currency it invoiced in. Currencies are listed
      separately and are never added together — USD 49 plus GBP 39 is not 88 of anything.
    </p>
    {invoiced === null || paid === null ? (
      <p className="dash" style={{ marginTop: 8 }}>{UNREAD_NOTE}</p>
    ) : invoiced.pots.length === 0 ? (
      <p style={{ color: 'var(--ink3)', marginTop: 8 }}>
        No invoices in this window. That is what a quiet quarter and a new project both look like.
      </p>
    ) : (
      <>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Currency</th><th style={{ textAlign: 'right' }}>Invoiced</th><th style={{ textAlign: 'right' }}>Of which paid</th></tr></thead>
          <tbody>
            {invoiced.pots.map((p) => {
              const hit = paid.pots.find((x) => x.currency === p.currency);
              return (
                <tr key={p.currency}>
                  <td className="mono">{p.currency}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{potLabel(p)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{hit ? potLabel(hit) : <span className="dash">{DASH}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invoiced.unlabelled > 0 || invoiced.unpriced > 0 ? (
          <Banner style={{ maxWidth: '72ch' }}>
            {invoiced.unlabelled > 0 ? `${invoiced.unlabelled} invoice${invoiced.unlabelled === 1 ? '' : 's'} carr${invoiced.unlabelled === 1 ? 'ies' : 'y'} an amount with no currency on it and ${invoiced.unlabelled === 1 ? 'is' : 'are'} in none of the figures above. ` : ''}
            {invoiced.unpriced > 0 ? `${invoiced.unpriced} ha${invoiced.unpriced === 1 ? 's' : 've'} no amount at all.` : ''}
          </Banner>
        ) : null}
      </>
    )}

    <h2 style={{ marginTop: 26 }}>Needing attention</h2>
    {attention === null ? (
      <p className="dash" style={{ marginTop: 8 }}>{UNREAD_NOTE}</p>
    ) : attention.length === 0 ? (
      <p style={{ color: 'var(--ink3)', marginTop: 8 }}>
        Nothing open, nothing uncollectible, and nothing that needed a second attempt.
      </p>
    ) : (
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Invoice</th><th>Status</th><th style={{ textAlign: 'right' }}>Attempts</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {attention.map((r) => (
            <tr key={r.id}>
              <td className="mono" style={{ fontSize: 11 }}>{r.id}</td>
              <td>{r.status ?? <span className="dash">{DASH}</span>}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{r.attemptCount ?? <span className="dash">{DASH}</span>}</td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {r.amountDue != null && r.currency
                  ? potLabel({ currency: r.currency, cents: r.amountDue, count: 1 })
                  : <span className="dash">{DASH}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </>);
}
