'use client';

// Erasure — the people who have asked to be deleted, and the statutory clock.
//
// ── Why this route had to exist ────────────────────────────────────────────
//
// `app/(owner)/deletions.tsx` is the only surface in the whole product that
// reads `pending_deletions` or calls `action_account_deletion()`, and it is on
// a phone. The console is where an owner does everything else that is
// regulated — /compliance holds the agreements, the filing cabinet and the
// audit feed, /export takes the record off the platform — and it was the one
// surface that could not honour a deadline the store listing promises in
// writing. An owner without the Studio app installed ran the thirty days out
// and had no way of knowing.
//
// ── What this screen does not do differently ───────────────────────────────
//
// It calls exactly the same function, with the same two confirmations naming
// the same person, and it states the same blast radius. This is a second door
// onto one mechanism, not a second mechanism: two erasure paths that disagreed
// about what survives would be worse than one that is hard to reach.
//
// ── The count that was a `.limit()` ────────────────────────────────────────
//
// The phone reads the audit log `.limit(50)` and renders `${log.length}
// recorded` under it. That figure is the number of rows the query asked for,
// printed as the number of erasures the gym has performed — and it is the
// figure an owner would quote to a regulator. It is read whole here through
// `readAll` (src/lib/rowCap.ts), and a set too large even for that says so
// rather than reporting its own ceiling.
//
// No tenant filter appears in this file, deliberately: `pending_deletions` is
// security_invoker and `deletion_log` carries an owner policy, so the database
// scopes both to the caller's own gym. Re-filtering here would add a second
// source of truth and a way for a not-yet-loaded tenant to render an empty
// queue that looks exactly like the good state.
import { useCallback, useEffect, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { type Unread } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { Fetched, useFetched } from '@/components/Fetched';
import { readTenant } from '@/lib/currency';
import { noGymNote } from '@lib/gymLink';
import { readAll } from '@lib/rowCap';
import { Banner as SharedBanner, type BannerTone } from '@/components/Banner';

/** A row of `pending_deletions`. Nulls stay null — a dash is not a zero. */
interface Pending {
  subjectId: string;
  name: string | null;
  role: string | null;
  requestedAt: string | null;
  /** Counts down from 30. Null only if the view returns a non-number. */
  daysRemaining: number | null;
}

/** A row of `deletion_log` — the record that outlives the profile. */
interface Actioned {
  id: string;
  label: string | null;
  requestedAt: string | null;
  actionedAt: string | null;
  note: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', trainer: 'Trainer', client: 'Member',
};

/** A read that holds no rows: still in flight, or refused. */

/** A timestamp as the day it happened. Never the string "null". */
const day = (iso: string | null): string => {
  const d = (iso ?? '').slice(0, 10);
  return d.length === 10 ? d : '—';
};

export default function Deletions() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymErr, setGymErr] = useState<string | null>(null);

  const [queue, setQueue] = useState<Pending[] | null>(null);
  const [queueWhy, setQueueWhy] = useState<string | null>(null);
  const [log, setLog] = useState<Actioned[] | null>(null);
  const [logWhy, setLogWhy] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    // The two reads fail INDEPENDENTLY, deliberately. A gym that cannot read
    // its own history still has to see who is waiting, so a broken audit trail
    // must not blank the queue beside it.
    // Whether each half came back. The stamp under the tiles is the age of the
    // last read that came back WHOLE, so a refresh in which the queue failed
    // must not move it — the rows on screen are still the earlier ones.
    let queueWhole = false;
    let logWhole = false;

    const [q, l] = await Promise.allSettled([
      // Read whole, for the same reason the log below it is — and it took
      // longer to get here than that one did. This was a bare `.select()` with
      // no `.limit` and no paging, so PostgREST answered with at most a
      // thousand rows, no error and no flag, and the three tiles built from it
      // reported a prefix as a total: "Waiting" is `rows.length` and "Past
      // thirty days" is `overdue.length`.
      //
      // The order is what makes that worse rather than merely wrong. It is
      // `deletion_requested_at` ASCENDING, so the rows a truncation drops are
      // the NEWEST requests — the ones whose thirty days have most recently
      // started, on a clock that is statutory. A gym over the ceiling would
      // have been told a smaller number of people were waiting than actually
      // are, and the ones it did not mention would be the ones it had heard
      // from most recently.
      //
      // `subject_id` is the tiebreaker, not decoration: `readAll` walks the set
      // in ranges, and two rows requested in the same tick with no second key
      // can swap between pages — which duplicates one and drops the other. The
      // queue is one row per subject, so this orders it totally.
      readAll<any>(
        (from, to) => supabase
          .from('pending_deletions')
          .select('subject_id, full_name, role, deletion_requested_at, days_remaining')
          .order('deletion_requested_at', { ascending: true })
          .order('subject_id', { ascending: true })
          .range(from, to),
        'the people waiting to be erased',
      ),
      // Read whole rather than to a ceiling. The count under this table is what
      // an owner would quote to a regulator, and `.limit(50)` printed as a
      // total is a number about a query rather than about the gym.
      readAll<any>(
        (from, to) => supabase
          .from('deletion_log')
          .select('id, subject_label, requested_at, actioned_at, note')
          .order('actioned_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
        'the erasures this gym has carried out',
      ),
    ]);

    // supabase-js RESOLVES on a database error rather than rejecting, so the
    // `.error` check is doing the real work here — a rejected promise only
    // covers the network dying. Without it an RLS denial arrives as
    // `data: null`, falls through `?? []`, and renders as "nobody is waiting":
    // a gym told it has no obligations because a read failed. That false
    // all-clear is the single worst thing this screen could do.
    // `readAll` throws on a database error rather than handing one back, so a
    // refused read arrives here as a REJECTION and there is no `.error` left to
    // check. The paragraph above still holds and is why this is written as one
    // branch rather than two: a refusal must never reach the `?? []` that would
    // render it as "nobody is waiting". It also throws `TruncatedRead` on a
    // queue past the paging ceiling, which lands in the same place — a queue
    // too large to read whole is a queue this screen must not put a number
    // under, for the same reason a prefix was not one.
    if (q.status === 'fulfilled') {
      setQueue(q.value.map((r: any) => ({
        subjectId: String(r.subject_id),
        name: r.full_name ?? null,
        role: r.role ?? null,
        requestedAt: r.deletion_requested_at ?? null,
        daysRemaining: typeof r.days_remaining === 'number' ? r.days_remaining : null,
      })));
      setQueueWhy(null);
      queueWhole = true;
    } else {
      setQueue(null);
      const why = q.reason?.message;
      setQueueWhy(`The erasure queue did not come back${why ? `: ${why}` : '.'} This is not a gym with nobody waiting — the clock is still running on anybody who has asked.`);
    }

    if (l.status === 'fulfilled') {
      setLog(l.value.map((r: any) => ({
        id: String(r.id),
        label: r.subject_label ?? null,
        requestedAt: r.requested_at ?? null,
        actionedAt: r.actioned_at ?? null,
        note: r.note ?? null,
      })));
      setLogWhy(null);
      logWhole = true;
    } else {
      setLog(null);
      setLogWhy(`The record of erasures already carried out did not come back${l.reason?.message ? `: ${l.reason.message}` : '.'}`);
    }
    return queueWhole && logWhole;
  }, []);

  /*
   * The statutory clock, kept running.
   *
   * `days_remaining` is computed by the `pending_deletions` view AT READ TIME,
   * so before this every figure on this screen was frozen at the instant the
   * tab opened: "Soonest due 3d" stayed 3d all morning, "Past thirty days"
   * stayed at whatever it was, the amber and red bands never moved, and a
   * member who submitted an erasure request an hour after the page loaded never
   * appeared at all. The only reload was `run()`, after an erasure.
   *
   * This is the one screen in the product where that is a legal exposure rather
   * than an inconvenience — the paragraph at the top of the page offers "how
   * long is left of the thirty days this product promises them in its store
   * listing", a sentence that is true when the tab opens and quietly stops
   * being true on a screen an owner works through over a morning.
   *
   * Five minutes, plus every return to the tab. A day is 288 of these and the
   * queue is small; the cost is nothing and the alternative is a clock that
   * does not tick.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(load, { everyMs: 5 * 60_000 });

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
      // An account with no gym never ran `load()`, so `queue` stayed null with
      // `queueWhy` null and `unread` resolved to 'loading' — a statutory
      // thirty-day queue rendering a spinner for ever, with nothing on screen
      // to distinguish a slow database from an account that was never linked.
      // The render below now stops before the spinner and says which it is.
      if (!who?.tenantId) return;
      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name); setGymErr(t.error);
      // Through `refresh` rather than `load` directly, so the first read stamps
      // the same way every later one does. A stamp that only appeared after a
      // manual refresh would be worse than none: the figures would go from
      // unlabelled to labelled without changing.
      refresh();
    })();
    return () => { live = false; };
  }, [load, refresh]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/deletions">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are — which is not the
          same as you not having access. Reload the page; if it keeps happening the database refused
          the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/deletions">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          Erasing somebody permanently is the owner&rsquo;s decision, and the database says the same
          thing independently.
        </p>
      </Shell>
    );
  }

  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/deletions">
        <h1>Erasure queue</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('erasure requests')}
        </p>
      </Shell>
    );
  }

  const rows = queue ?? [];
  const overdue = rows.filter((p) => p.daysRemaining != null && p.daysRemaining <= 0);
  const clocks = rows.map((p) => p.daysRemaining).filter((d): d is number => d != null);
  const soonest = clocks.length ? Math.min(...clocks) : null;
  const unread: Unread = queue !== null ? null : queueWhy ? 'failed' : 'loading';

  const run = async (p: Pending) => {
    setBusy(p.subjectId); setMsg(null);
    try {
      const { error } = await supabase.rpc('action_account_deletion', { p_subject: p.subjectId });
      if (error) throw error;
      setConfirming(null); setSure(false);
      await load();
    } catch (e: any) {
      // The database's own refusals are written for a person to read ("That
      // member has not asked to be deleted."), so they are shown rather than a
      // generic failure that hides which guard fired.
      // The database's own refusals are the reason this is worth classifying
      // rather than replacing: `writeFailedText` prints the refusal's own words
      // ("That member has not asked to be deleted.") for a refusal, and refuses
      // to assert anything at all when nobody answered — which for an
      // irreversible deletion is the one case that must not be guessed at.
      setMsg(writeFailedText(e, {
        what: 'That deletion',
        unchanged: 'nothing was deleted and the account is still here',
        howToCheck: 'Reload this page: an account that has actually been deleted is gone from the list below.',
      }));
    } finally { setBusy(null); }
  };

  const cols: Column<Pending>[] = [
    { key: 'who', header: 'Who', value: (p) => p.name ?? '￿',
      render: (p) => p.name ?? <span className="dash">an account with no name on it</span> },
    { key: 'role', header: 'They are', value: (p) => p.role ?? '',
      render: (p) => p.role ? ROLE_LABEL[p.role] ?? p.role : <span className="dash">—</span> },
    { key: 'asked', header: 'Asked', value: (p) => p.requestedAt ?? '', render: (p) => day(p.requestedAt) },
    { key: 'left', header: 'Days left', value: (p) => p.daysRemaining, numeric: true,
      // Zero is not "due soon" and must not read like it: the thirty days the
      // store listing promises are already spent.
      render: (p) => p.daysRemaining == null
        ? <span className="dash">unknown</span>
        : <span style={{ color: p.daysRemaining <= 0 ? 'var(--crit)' : p.daysRemaining <= 7 ? 'var(--warn)' : 'var(--ink2)' }}>
            {p.daysRemaining <= 0 ? 'Overdue' : `${p.daysRemaining}d`}
          </span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (p) => (
        <button style={{ ...linkBtn, color: 'var(--crit)' }} disabled={busy === p.subjectId}
                onClick={() => { setConfirming(p); setSure(false); setMsg(null); }}>
          {busy === p.subjectId ? 'Erasing…' : 'Erase them'}
        </button>
      ) },
  ];

  const logCols: Column<Actioned>[] = [
    { key: 'who', header: 'Who', value: (a) => a.label ?? '￿',
      render: (a) => a.label ?? <span className="dash">a label the log does not carry</span> },
    { key: 'asked', header: 'Asked', value: (a) => a.requestedAt ?? '', render: (a) => day(a.requestedAt) },
    { key: 'done', header: 'Erased', value: (a) => a.actionedAt ?? '', render: (a) => day(a.actionedAt) },
    { key: 'note', header: 'Note', value: (a) => a.note ?? '',
      render: (a) => a.note ?? <span className="dash">—</span> },
  ];

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/deletions">
      <h1>Erasure requests</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '80ch' }}>
        Everybody who has asked to be deleted, and how long is left of the thirty days this product
        promises them in its store listing. Nothing here happens on a timer: an erasure is carried
        out by a person, on purpose, and this is the screen that person works from.
      </p>

      {queueWhy ? <Banner tone="crit">{queueWhy}</Banner> : null}
      {msg ? <Banner tone="crit">{msg}</Banner> : null}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
        margin: '20px 0 26px', overflow: 'hidden',
      }}>
        <Kpi label="Waiting" text={queue ? String(rows.length) : null}
             note={queue && rows.length === 0 ? 'nobody has asked' : undefined} />
        <Kpi label="Past thirty days" text={queue ? String(overdue.length) : null}
             note={queue && overdue.length > 0 ? 'a promise already broken' : undefined} />
        <Kpi label="Soonest due" text={soonest == null ? null : soonest <= 0 ? 'Overdue' : `${soonest}d`}
             note={queue && soonest == null ? 'nothing waiting' : undefined} />
        {/* Read whole, so this is the number of erasures rather than the number
            of rows a limit asked for. */}
        <Kpi label="Erased to date" text={log ? String(log.length) : null}
             note={log ? 'every one on record, not the last fifty' : undefined} />
      </div>

      {/* The age of every figure above, and the only control in this console
          that re-reads a screen without throwing away the page. `days_remaining`
          is computed by the view at READ time, so without this line the clock
          on the tiles is the clock at the moment the tab was opened. */}
      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="the erasure queue" style={{ margin: '-14px 0 22px' }} />

      {confirming ? (
        <div style={{
          margin: '0 0 22px', padding: '13px 15px', background: 'var(--surface2)',
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        }}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink2)', maxWidth: '84ch' }}>
            <strong style={{ color: 'var(--ink)' }}>
              Erase {confirming.name ?? 'this account'}?
            </strong>{' '}
            This permanently deletes them and everything of theirs — profile, workouts, logs, scans,
            messages and bookings, across 39 tables. Their invoices and memberships go too, which is
            the opposite of what you would assume of a financial record and is worth reading twice.
            Payments, door-log visits and guest passes stay, with the person detached from them.
            Requested {day(confirming.requestedAt)}.
          </p>
          {/* Two steps, and the second control is not where the first one was.
              The same two confirmations the phone asks for, for the same
              reason: there is no undo, no recovery and no backup. */}
          {!sure ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 11, alignItems: 'baseline' }}>
              <button style={{ ...primaryBtn, background: 'var(--crit)' }} onClick={() => setSure(true)}>
                Continue
              </button>
              <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => setConfirming(null)}>
                Keep the account
              </button>
            </div>
          ) : (
            <>
              <p style={{ margin: '11px 0 0', fontSize: 13, color: 'var(--crit)', maxWidth: '84ch' }}>
                There is no undo, no recovery and no backup you can restore them from.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 11, alignItems: 'baseline' }}>
                <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => { setConfirming(null); setSure(false); }}>
                  Keep the account
                </button>
                <button style={{ ...primaryBtn, background: 'var(--crit)' }}
                        disabled={busy === confirming.subjectId}
                        onClick={() => void run(confirming)}>
                  {busy === confirming.subjectId ? 'Erasing…' : 'Delete permanently'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <Section title="Waiting" sub="Oldest request first, because that is the one closest to its deadline.">
        {unread ? (
          // Announced, and polite: the crit banner above has already
          // interrupted with the database's own sentence. This one says which
          // SECTION has no rows, which is the part that was silent.
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
            {unread === 'loading' ? 'Loading…' : 'Could not read the queue. The banner above says why.'}
          </div>
        ) : (
          <DataTable noun="erasure requests"
            rows={rows} columns={cols} rowKey={(p) => p.subjectId}
            empty="Nobody has asked to be erased. That is the good state rather than a blank screen — this read came back, and it came back empty."
          />
        )}
      </Section>

      <Section
        title="Already carried out"
        sub="The record that outlives the profile. It holds a label and two dates and nothing else about the person, which is the point of it."
      >
        {logWhy ? <Banner tone="crit">{logWhy}</Banner> : null}
        {log === null ? (
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
            {logWhy ? 'Could not read the record of erasures already carried out.' : 'Loading…'}
          </div>
        ) : (
          <DataTable noun="erasures carried out"
            rows={log} columns={logCols} rowKey={(a) => a.id}
            empty="No erasure has been carried out on this gym yet."
          />
        )}
      </Section>
    </Shell>
  );
}

/* ── bits (the same shapes as every other console page) ────────────────────── */

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)', textAlign: 'left' as const,
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page carried a byte-for-byte copy of it that rendered into a plain <div>,
// so every sentence it printed — including the ones saying a write was
// REFUSED and nothing was saved — was silent to a screen reader. The shared
// component carries role="alert"/"status" and aria-live.
// The wrapper stays only for this page's surface and 84ch measure, which is passed
// through the shared component's `style` rather than duplicating it.
function Banner({ children, tone }: { children: React.ReactNode; tone?: BannerTone }) {
  return <SharedBanner tone={tone} style={{ background: 'var(--surface2)', maxWidth: '84ch' }}>{children}</SharedBanner>;
}
