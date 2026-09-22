'use client';

// Activity — everything the database recorded this gym doing.
//
// ── Why this route had to exist ────────────────────────────────────────────
//
// `gym_events` is where every payment, price change, membership cancellation,
// payroll settlement, month close, equipment retirement and cost deletion is
// written — twenty-one kinds by supabase/parts/700. Nothing in the console's
// rail named it. The one way to read it was a `<select>` on /compliance,
// underneath the waivers and the filing cabinet, and that filter is itself
// gated on `kinds.length > 1` — so it disappears entirely at a gym that has
// only ever done one kind of thing, which is every gym in its first fortnight.
//
// "Who changed this price", "who cancelled that membership" and "who deleted
// the September cost" are the questions an owner asks AFTER something is
// already wrong. They were answerable, and filed under Compliance.
//
// The owner's phone has given this a section of its own since
// `app/(owner)/ops.tsx` — capped at a hundred rows, with a 'partial' status
// under it. This is the console's version, and it is bounded by DATE rather
// than by row count for the reason /compliance already argues: a row cap
// answers "what happened lately" differently at a quiet gym and a busy one, and
// the busy one is the gym being audited.
//
// ── What it is not ─────────────────────────────────────────────────────────
//
// It is not a second mechanism. /compliance keeps its feed — that screen reads
// the log as part of "what can this gym produce when somebody asks", which is a
// different question from "what happened, and who did it". Both read the same
// table through the same shape, and neither writes.
//
// No tenant filter appears in the query below, deliberately: `gym_events`
// carries an owner policy, so the database scopes it to the caller's own gym.
// Re-filtering here would add a second source of truth and a way for a
// not-yet-loaded tenant to render an empty log that looks exactly like a quiet
// gym.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { Fetched, useFetched } from '@/components/Fetched';
import { Banner } from '@/components/Banner';
import { readTenant } from '@/lib/currency';
import { noGymNote } from '@lib/gymLink';
import { readAll, capLimit } from '@lib/rowCap';
// The id list this feed's names are looked up by is no longer bounded by the
// row cap — see `fetchEvents`. src/lib/idLookup.ts is the one chunk size.
import { chunkIds, uniqueIds } from '@lib/idLookup';
import { searchRows, searchNote } from '@lib/consoleSearch';
// The console's own CSV writer and its download, as used by /tax, /members,
// /export and /close. Nothing new is installed for this.
import { toCsv } from '@lib/gymExport';
import { saveText } from '@/lib/save';
import { parseGymZone, gymDay, gymTimeLabel, NO_ZONE_NOTE } from '@lib/gymZone';

const DAY = 86_400_000;

/**
 * UTC's own calendar day and clock time, for the gym that has set no timezone.
 *
 * Named with UTC in it because that is the only honest thing to call it, and
 * because an unnamed `.toISOString().slice(0, 10)` is the expression that dates
 * a 23:40 event into the wrong month for half the world — check-utc-day.mjs
 * flags it on sight and is right to. Here it is not a guess at somebody's local
 * day: it is the fallback the whole screen already uses, it is reached only
 * when `gymDay` returns null because `tenants.timezone` is unset, and every
 * row that takes it carries 'UTC' in its own Clock column beside it, so nobody
 * reading the file can mistake whose day it is.
 *
 * The alternative — the READER's day, via isoDay — would be worse in a file:
 * the CSV outlives the browser that made it, and a day cut on whichever desk
 * pressed the button is a fact about that desk rather than about the gym.
 */
const utcCalendarDay = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const utcClockTime = (iso: string): string => new Date(iso).toISOString().slice(11, 16);

/** How far back the log can be asked for. Bounded at both ends of the list on
 *  purpose: "everything" over a table written by a trigger on every payment is
 *  a read that grows without limit at exactly the gyms that use the product. */
const WINDOWS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'a year' },
];

/** One row of `gym_events`. */
interface Event {
  id: string;
  kind: string;
  summary: string;
  /** Null is not an unknown person — it is nobody signed in: a webhook, a
   *  scheduled job, the service role. The two read differently and must. */
  actorId: string | null;
  actorName: string | null;
  at: string;
}

export default function Activity() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymErr, setGymErr] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  // Null is "not read", never []. An empty log is the claim that this gym has
  // done nothing, which on a gym in use means the triggers were never applied —
  // a different errand entirely from a query that failed.
  const [rows, setRows] = useState<Event[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);

  const [spanId, setSpanId] = useState('30');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  const span = WINDOWS.find((w) => String(w.days) === spanId) ?? WINDOWS[1];

  const load = useCallback(async (days: number): Promise<boolean> => {
    setWhy(null);
    try {
      setRows(await fetchEvents(days));
      return true;
    } catch (e: any) {
      // The rows already on screen are left where they are: they are the last
      // successful read's, the stamp says which moment that was, and blanking
      // them would turn a gym that did eleven things into one that did none.
      setWhy(e?.message ?? 'The activity log could not be read.');
      return false;
    }
  }, []);

  /*
   * Kept current. This is a log of things happening in the building right now —
   * two desks and an office are signed into this console — so a screen showing
   * it as of the moment the tab opened is the wrong shape for it.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId ? load(span.days) : Promise.resolve(false)),
    { everyMs: 2 * 60_000 },
  );

  useEffect(() => {
    // The rows on screen are the OLD window's, and a window change is a
    // different question rather than a re-ask of this one.
    //
    // `load` keeps the previous rows when a read fails, and that is right for a
    // refresh — the two-minute poll, the return to the tab, the button — because
    // the entries still drawn are the last successful read's and the stamp says
    // which moment that was. It stops being right the moment the question moves
    // underneath them. Switching from a year to 7 days and having that read fail
    // left a year of entries on screen with every label around them saying 7
    // days: the Recorded tile's note, the kind filter's counts, the People who
    // did them figure, and the empty copy that tells an owner their triggers
    // were never applied. None of those is a smaller number than the truth —
    // they are a different window's numbers under this window's heading.
    //
    // Cleared here rather than in `load`, because this effect is the only thing
    // that runs on a window change; the poll and the button call `refresh`
    // directly and keep the behaviour above untouched.
    setRows(null);
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      if (!who?.tenantId) return;
      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name); setGymErr(t.error); setZone(t.zone);
      refresh();
    })();
    return () => { live = false; };
    // Keyed on the span too: changing the window is a new read, not a filter
    // over rows that were never fetched.
  }, [refresh, span.days]);

  /** Which kinds this gym has actually produced, with their counts. Derived
   *  from what was read rather than from the schema's list of twenty-one: a
   *  filter offering kinds that cannot appear is a filter that mostly returns
   *  nothing. */
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of rows ?? []) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const byKind = useMemo(
    () => (kind ? (rows ?? []).filter((e) => e.kind === kind) : (rows ?? [])),
    [rows, kind],
  );
  // Accent-folding and per-term, through the console's shared search — so
  // "zoe" finds "Zoë" and "sara ok" finds "Sara Okafor", which is what an owner
  // asking "who cancelled Sara's membership" actually types.
  const shown = useMemo(
    () => searchRows(byKind, q, (e) => [e.summary, e.kind, e.actorName]),
    [byKind, q],
  );
  const note = searchNote(q, shown.length, byKind.length);

  /**
   * The signed-in accounts in this window, and the entries no account did.
   *
   * Counted together because the tile's own note promised the second one — it
   * read "signed-in accounts; automated writes are counted separately", and
   * nothing on this screen counted them anywhere. An owner told a figure is
   * held back "separately" goes looking for it; there was nothing to find, and
   * the sentence was the only evidence the entries existed at all.
   *
   * They are a real and separate population rather than a rounding error:
   * `Event.actorId` is null for a webhook, a scheduled job and the service role
   * — Stripe settling an invoice writes one, and so does every trigger fired
   * with no session behind it. Two gyms with the same "People who did them"
   * figure and very different automated halves are not the same gym, and on the
   * audit screen that difference is the answer to "who did this" being
   * "nobody — the system did".
   */
  const actors = useMemo(() => {
    if (!rows) return null;
    const people = new Set<string>();
    let automated = 0;
    for (const e of rows) {
      if (e.actorId) people.add(e.actorId);
      else automated += 1;
    }
    return { people: people.size, automated };
  }, [rows]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/activity">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are — which is not the
          same as you not having access. Reload the page; if it keeps happening the database
          refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/activity">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          This log carries every payment, every price, every cancellation and every colleague&rsquo;s
          pay run on one screen. It is the owner&rsquo;s, and the database says the same thing
          independently.
        </p>
      </Shell>
    );
  }

  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/activity">
        <h1>Activity</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('recorded activity')}
        </p>
      </Shell>
    );
  }

  // Bound here rather than read off `me` inside the closure below: the
  // narrowing the guard above performed does not survive into one, and a
  // receipt filed against a null gym would be a row nobody can attribute.
  const tenantId = me.tenantId;

  /**
   * The log on screen, as a file — with what was asked for written at the top.
   *
   * Three things travel with it, and each of them is a thing a reader six weeks
   * later cannot otherwise recover:
   *
   *  · the window, the kind filter and the search that produced it. A CSV of
   *    eleven rows headed nothing at all is indistinguishable from a gym that
   *    did eleven things;
   *  · WHOSE CLOCK the day and the hour are on. The gym's where it has set a
   *    timezone, and UTC where it has not, stated per row in its own column
   *    rather than assumed — a price change at 23:40 on the 31st belongs to a
   *    different month depending on the answer, and this is the file somebody
   *    argues that from;
   *  · that a null actor is not an unknown person. It is nobody signed in — a
   *    webhook, a scheduled job, the service role — and an empty cell would be
   *    read as a name that went missing.
   *
   * The summary line is never recomputed from the file. It is composed here,
   * beside the filters it describes, for the same reason each row's own
   * sentence is: a record says what was true when it was made.
   */
  const download = () => {
    if (!rows || !tenantId) return;
    const clock = zone ? `the gym's own clock (${zone})` : "UTC, because this gym has not set a timezone";
    const asked = [
      `the last ${span.label}`,
      kind ? `kind "${kind}"` : 'every kind',
      q.trim() ? `matching "${q.trim()}"` : 'no search',
    ].join(', ');
    const head =
      `Activity — ${gymName ?? 'this gym'}\n`
      + `${shown.length} of ${rows.length} recorded entr${rows.length === 1 ? 'y' : 'ies'}: ${asked}.\n`
      + `Days and times below are on ${clock}.\n`
      + 'Each sentence was composed when the thing happened and is never recomputed, which is what makes this a record rather than a view. An entry with no account against it was not done by an unknown person — it was done by nothing signed in: a webhook, a scheduled job or the service role.\n\n';
    saveText(
      head + toCsv(
        ['Day', 'Time', 'Clock', 'What', 'Detail', 'By', 'Account id', 'Recorded at (UTC)'],
        shown.map((e) => [
          gymDay(e.at, zone) ?? utcCalendarDay(e.at),
          gymTimeLabel(e.at, zone) ?? utcClockTime(e.at),
          zone ?? 'UTC',
          e.kind,
          e.summary,
          // Three states, kept apart in words, because two of them are empty
          // cells otherwise and they mean opposite things.
          e.actorId ? (e.actorName ?? 'name could not be read') : 'not a signed-in person',
          e.actorId ?? '',
          e.at,
        ]),
      ),
      `${(gymName ?? 'gym').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gym'}-activity-${span.days}d.csv`,
    );
    void logActivityExport(me, tenantId, shown.length, rows.length, asked);
  };

  const cols: Column<Event>[] = [
    { key: 'at', header: 'When', value: (e) => e.at,
      // The GYM's day and hour. A price change at 23:40 on the 31st is the
      // 31st for the gym whoever is reading, and this is the screen somebody
      // opens to argue about exactly that.
      render: (e) => {
        const day = gymDay(e.at, zone);
        const time = gymTimeLabel(e.at, zone);
        return day
          ? <span className="mono" style={{ fontSize: 11.5 }}>{day} {time}</span>
          : <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
              {new Date(e.at).toISOString().replace('T', ' ').slice(0, 16)} UTC
            </span>;
      } },
    { key: 'kind', header: 'What', value: (e) => e.kind,
      render: (e) => <span className="mono" style={{ fontSize: 11.5 }}>{e.kind}</span> },
    { key: 'summary', header: 'Detail', value: (e) => e.summary,
      render: (e) => <span style={{ whiteSpace: 'normal' }}>{e.summary}</span> },
    { key: 'who', header: 'By', value: (e) => e.actorName ?? '',
      render: (e) => (e.actorId
        ? (e.actorName ?? <span className="dash">a name that could not be read</span>)
        : <span style={{ color: 'var(--ink3)' }}>not a signed-in person</span>) },
  ];

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/activity">
      <h1>Activity</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '84ch' }}>
        Everything the database recorded this gym doing &mdash; every payment, price change,
        cancellation, payroll run, month close and deleted cost. Written by triggers as things
        happen, so nothing here was typed by anybody and nothing can be missed by a screen
        forgetting to record it.
      </p>

      {why ? <Banner tone="crit">{why}</Banner> : null}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
        margin: '20px 0 26px', overflow: 'hidden',
      }}>
        <Kpi label="Recorded" text={rows ? String(rows.length) : null}
             note={rows ? (rows.length === 0 ? 'nothing in this window' : span.label.toLowerCase()) : why ? 'not read' : undefined} />
        <Kpi label="Kinds of thing" text={rows ? String(kinds.length) : null}
             note={rows && kinds.length === 0 ? 'nothing to count' : undefined} />
        <Kpi label="People who did them" text={actors ? String(actors.people) : null}
             note={actors ? 'signed-in accounts' : why ? 'not read' : undefined} />
        {/* The other half of the sentence the tile beside this one used to make
            on its own. Zero here is a real reading and not an absence — it says
            every entry in the window has a person behind it — so it is drawn
            whenever the log read, and withheld when it did not. */}
        <Kpi label="Not a person" text={actors ? String(actors.automated) : null}
             note={actors
               ? (actors.automated === 0
                   ? 'every entry has an account behind it'
                   : 'a webhook, a scheduled job or the service role')
               : why ? 'not read' : undefined} />
      </div>

      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="the activity log" style={{ margin: '-16px 0 22px' }} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' }}>
        {WINDOWS.map((w) => (
            // `aria-pressed`, because which one is chosen was carried by a
            // background colour and nothing else — so a screen reader read
            // three identical buttons and no way to tell which window the
            // figures below belong to. The hour strip on /timetable was
            // already doing this ten lines from the day strip that was not.
          <button
            key={w.days}
            type="button"
            aria-pressed={String(w.days) === spanId}
            onClick={() => setSpanId(String(w.days))}
            style={{
              ...field, cursor: 'pointer',
              background: String(w.days) === spanId ? 'var(--surface3)' : 'var(--surface2)',
              color: String(w.days) === spanId ? 'var(--ink)' : 'var(--ink2)',
            }}
          >
            {w.label}
          </button>
        ))}
        {/* Not gated on `kinds.length > 1`, which is what makes the filter on
            /compliance disappear at a gym that has only ever done one kind of
            thing. A picker with one option in it is a picker that has told you
            something. */}
        <select value={kind} onChange={(e) => setKind(e.target.value)}
                style={{ ...field, minWidth: 230 }} aria-label="Filter the log by what happened">
          <option value="">Everything &mdash; {rows?.length ?? 0}</option>
          {kinds.map(([k, n]) => <option key={k} value={k}>{k} &mdash; {n}</option>)}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name, an amount or a plan"
          aria-label="Search the activity log"
          style={{ ...field, minWidth: 260 }}
        />
        {zone ? null : (
          <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '46ch' }}>
            {NO_ZONE_NOTE} &mdash; times below are stated in UTC rather than guessed at.
          </span>
        )}
        {/*
          ── the audit trail, off the screen ──────────────────────────────────

          GAP ANALYSIS. Mindbody, Zen Planner and Clubworx all let an operator
          take their audit or change log OUT of the product; this console could
          only show it. That matters more here than on a report screen, because
          the argument this log settles — who changed that price, who cancelled
          that membership, who deleted the September cost — is had with an
          accountant, an ex-employee or a landlord, none of whom have a login.
          The answer was readable by exactly the person who least needed it.

          Nothing new is read for this. `shown` is already in the browser — the
          window, the kind filter and the search have all been applied to it —
          and the file says which of those were on, because a filtered export
          that does not name its filter is a shorter log wearing a whole one's
          name. `toCsv` and `saveText` are the console's, already imported by
          six other screens.
        */}
        <button
          onClick={download}
          disabled={rows === null}
          style={{ ...field, cursor: rows === null ? 'default' : 'pointer', opacity: rows === null ? 0.5 : 1 }}
        >
          {rows === null ? 'Nothing to export yet' : `Export ${shown.length} entr${shown.length === 1 ? 'y' : 'ies'} (CSV)`}
        </button>
      </div>

      {rows === null ? (
        why ? (
          <p style={{ margin: 0, padding: '20px 2px', fontSize: 13, color: 'var(--ink2)', maxWidth: '76ch' }}>
            The log could not be read, so nothing is listed. This is not a gym that has done
            nothing &mdash; it is a query that did not come back, and the banner above says what
            the database gave as the reason.
          </p>
        ) : <Loading what="the activity log" />
      ) : (
        <>
          {note ? (
            <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p>
          ) : null}
          <DataTable
            rows={shown} columns={cols} rowKey={(e) => e.id} noun="recorded events"
            empty={kind || q.trim()
              ? 'Nothing in this window matches. Widen the period or clear the filters before concluding it never happened.'
              : `Nothing has been recorded in ${span.label}. On a gym that is being used, that is a database whose triggers have not been applied rather than a quiet fortnight.`}
          />
        </>
      )}

      <p style={{ margin: '14px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>
        Two things this log says and does not say. It says who was SIGNED IN, not who was at the
        keyboard: nothing in this product re-authenticates in front of the money screens, so a
        shared laptop left open is a gap this cannot see. And the sentence on each row was composed
        when the thing happened and is never recomputed &mdash; which is what makes it a record
        rather than a view, and why a money figure written before supabase/parts/1011 reads in the
        places the currency had then rather than the places it has now.
      </p>
    </Shell>
  );
}

/**
 * Record that a copy of the audit log left the platform.
 *
 * The sibling of `logRosterExport` in /members and `logExport` in /export, and
 * swallowed for the same reason both of those are: the file is on the owner's
 * disk by the time this runs, so reporting a logging failure as an export
 * failure would be false, and refusing a download over a logging table would be
 * a worse product for a worse reason. A gap in the log is visible as a gap.
 *
 * The note says what was actually in the file rather than just naming the
 * screen. "An activity export" cannot answer "which entries, over what window"
 * when somebody reads this row back a year later, and that is the whole
 * question an export receipt exists to answer.
 */
async function logActivityExport(
  me: Me, tenantId: string, taken: number, held: number, asked: string,
): Promise<void> {
  if (!tenantId) return;
  // eslint-disable-next-line -- no-error-ok: the CSV is already on the owner's disk; a logging failure must not be reported as an export failure, and a refusal here would be a console that cannot hand over its own audit trail
  await supabase.from('gym_export_runs').insert({
    tenant_id: tenantId,
    scope: 'gym',
    member_id: null,
    parts: ['activity'],
    rows_exported: taken,
    taken_by: me.id,
    note: `Activity CSV from /activity — ${taken} of ${held} entries read (${asked}), with the day, time, kind, sentence and the account behind each one.`,
  });
}

/* ── the read ──────────────────────────────────────────────────────────────── */

/**
 * The log for a window, whole.
 *
 * Paged rather than refused. A truncated audit log is one that has silently
 * lost its oldest entries, which on this screen is the half somebody came
 * looking for — and this feed is written by a trigger on every payment, price
 * change, cancellation, close and cost. A gym of any size crosses a thousand of
 * those inside ninety days, so a capped read would be an error message on
 * precisely the gyms that have something to audit. The window is already
 * bounded, which is the shape `readAll` is for. `id` after `created_at` because
 * paging needs a total order and two writes in one transaction tie.
 */
async function fetchEvents(days: number): Promise<Event[]> {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_events')
      .select('id, kind, summary, actor_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    `this gym’s activity in the last ${days} days`,
  );
  if (!rows.length) return [];

  /*
   * The actors, CHUNKED — because the read above pages and this one did not.
   *
   * It was one `.in('id', ids)` over every distinct actor in the window. That
   * was safe while `gym_events` was capped at a thousand rows; `readAll` above
   * lifted the cap on purpose ("a gym of any size crosses a thousand of those
   * inside ninety days"), and the prop holding this lookup up went with it.
   *
   * A uuid costs about 39 bytes inside an `in.("…","…")` list, so a couple of
   * hundred distinct actors is past the 8KB request line nginx and most CDNs
   * allow. The failure is a 414, `data` comes back null, and the
   * `no-error-ok` below — which is right for one unreadable name — swallows it
   * for ALL of them: every entry in the log renders with no actor at all. This
   * is the audit screen. "Who cancelled that membership" would read as though
   * the trigger had never recorded anybody, on exactly the gyms big enough for
   * the question to matter, and a staff count over two hundred is a large gym
   * rather than an unusual one.
   *
   * Chunked at `ID_CHUNK`, each chunk keeps its own `capLimit()`: 150 primary
   * keys cannot answer with more than 150 rows, so no chunk can truncate.
   */
  const names = new Map<string, string>();
  for (const chunk of chunkIds(uniqueIds(rows.map((r: any) => r.actor_id)))) {
    // eslint-disable-next-line -- no-error-ok: an unreadable name renders as its own sentence beside the entry; the entry itself is still legible, and failing the whole log over a name would hide what happened
    const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', chunk).limit(capLimit());
    for (const p of (ps ?? []) as any[]) {
      const n = (p.full_name || '').trim();
      if (n) names.set(p.id, n);
    }
  }

  return rows.map((r: any) => ({
    id: String(r.id),
    kind: r.kind,
    summary: r.summary,
    actorId: r.actor_id ?? null,
    actorName: r.actor_id ? names.get(r.actor_id) ?? null : null,
    at: r.created_at,
  }));
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;
