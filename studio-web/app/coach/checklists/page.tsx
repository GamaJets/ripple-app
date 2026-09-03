'use client';

// Checklists — the lines a coach puts on one client's daily list.
//
// ── Why this screen exists ──────────────────────────────────────────────────
//
// TF-31 asked what generates the client's daily checklist. Until recently the
// answer was a five-element array literal compiled into the phone app: the same
// "10,000 steps" and "Sleep 7h+" for every account on the platform. The list is
// derived from each client's own plan and targets now, and the product owner's
// answer included "as well as the ones set by the coach".
//
// `coach_checklist_items` (supabase/parts/58) is where those live, and the
// client's app already reads and renders them. This is the only thing that
// writes them — without it the table is a feature nobody can use.
//
// ── The rule that shapes every write below ─────────────────────────────────
//
// A write is believed only when the server confirms it. Every mutation here
// selects the rows it touched and counts them, because a PostgREST update or
// delete that matches NOTHING succeeds having changed zero rows — so an item
// RLS refused to touch would otherwise vanish from this screen, look saved, and
// be back at the next load. That exact shape has been reported in this product
// more than once, from the phone side.
//
// ── What this screen deliberately cannot do ────────────────────────────────
//
// It cannot tick anything. There is no `done` column on the table and there
// must not be one: the tick belongs to the client, in `habit_logs`, under their
// own policy. A coach marking their own client's habit complete would be a
// second answer to a question only one person can answer.
//
// ── Every read here is paged, and none of them used to be ──────────────────
//
// All four reads below were bare `select()`s with no `.limit()` and no page
// loop, so PostgREST answered each of them with at most a thousand rows and
// said nothing about it. Each one truncates into a different wrong sentence,
// and none of them looks broken:
//
//   · `clients` is what the picker is built from, so a coach past a thousand
//     clients simply cannot select the ones off the end — they are not on the
//     screen and there is nothing to say they are missing.
//   · the `profiles` lookup was a bare `.in()` over those ids. Past a thousand
//     it truncates to dashes, and long before that the query string 414s —
//     src/lib/idLookup.ts is the write-up.
//   · `coach_checklist_items` is one coach × one client and is small today,
//     but it is the denominator of every adherence figure on this screen: an
//     item that falls off the read is a line the coach set, still on the
//     client's phone, that this screen does not know exists.
//   · `habit_logs` is the worst of the four, and it is the one the roadmap
//     named. It is the client's ticks, and a truncated tick list does not make
//     a rate smaller — it makes it FALSE. Every day whose rows fell off the end
//     reads as a day the client did nothing, on a screen a coach uses to judge
//     whether somebody is engaging. The window bounds it, but a client ticking
//     six habits a day over a 28-day window against a cap that is shared with
//     nothing is a bound, not a guarantee.
//
// `readAll` and `readByIds` are the house answer (src/lib/rowCap.ts,
// src/lib/idLookup.ts): both check `error` on every page and THROW on a
// truncation, so a read that could not be finished arrives here as a failure —
// which every one of these already renders honestly as null-not-empty — rather
// than as a short set wearing the whole set's clothes.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { Shell } from '@/components/Shell';
import {
  recentWindow, summariseAdherence, setItemLine, dayLabel,
  type DayWindow, type TickRow, type AdherenceSummary,
} from '@lib/adherence';
import { readAll } from '@lib/rowCap';
import { readByIds } from '@lib/idLookup';

/** One row of coach_checklist_items, as this screen holds it. */
interface Item {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  sort: number;
  // Read because the adherence figures cannot be honest without them. An item's
  // created_at bounds how far back it could possibly have been ticked, so a
  // line added on Thursday reads "1 of 3" and never "1 of 28"; `active` is what
  // says the days after it came off are not the client's to answer for.
  created_at: string;
  updated_at: string;
}

const COLS = 'id, label, icon, active, sort, created_at, updated_at';

interface Client {
  id: string;
  /** Null means the profile could not be read. The person is still a client. */
  name: string | null;
}

/** The label bound in the database (58: `length(label) <= 80`). Checked here so
 *  a coach is told before the write rather than after it is refused. */
const LABEL_MAX = 80;

export default function CoachChecklists() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsErr, setClientsErr] = useState<string | null>(null);
  const [namesKnown, setNamesKnown] = useState(true);

  const [picked, setPicked] = useState<string | null>(null);

  const [items, setItems] = useState<Item[] | null>(null);
  const [itemsErr, setItemsErr] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  // What went wrong with the LAST write, in the coach's own terms. Separate
  // from itemsErr: a failed read and a failed save send a coach to do different
  // things, and one message for both would send them to the wrong one.
  const [writeErr, setWriteErr] = useState<string | null>(null);

  // The window and the rows it was read over travel together. Held as one value
  // because a summary built from this load's ticks and the previous load's
  // dates is arithmetic over two different months and looks entirely fine.
  const [ticks, setTicks] = useState<{ window: DayWindow; rows: TickRow[] } | null>(null);
  const [ticksErr, setTicksErr] = useState<string | null>(null);

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
      if (!who?.tenantId) return;
      const { data, error } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      // A refused read and a gym with no name both leave this null, and the
      // Shell renders the same header for both — so the error is read rather
      // than discarded, and an unread name stays null instead of being asserted
      // as absent.
      if (live) setGymName(error ? null : (data as { name?: string } | null)?.name ?? null);
    })();
    return () => { live = false; };
  }, []);

  // The coach's book. Scoped in the query, not filtered after it lands.
  const loadClients = useCallback(async (coachId: string) => {
    setClientsErr(null);
    let ids: string[];
    try {
      // Ordered by the primary key, which `readAll` requires and which
      // `clients.id` satisfies — it IS the primary key (parts/01-schema.sql:49)
      // and so cannot tie. The book is what the picker is made of, so a cut
      // here does not shorten a column; it removes people from the screen.
      const rows = await readAll<{ id: string }>(
        (from, to) => supabase.from('clients').select('id')
          .eq('trainer_id', coachId)
          .order('id', { ascending: true })
          .range(from, to),
        'your client records',
      );
      ids = rows.map((r) => r.id).filter(Boolean);
    } catch (e) {
      // Null, not []. An empty list here reads as "you have no clients", which
      // is a statement about this coach's book rather than about the read.
      setClients(null);
      setClientsErr((e as { message?: string } | null)?.message ?? 'The read did not come back.');
      return;
    }
    if (!ids.length) { setClients([]); return; }

    // Chunked and paged rather than one `.in()`: see the header. A failure is
    // caught here and NOT allowed to blank the book — the ids came back, the
    // people are real, and only their names are unknown.
    let nameBy = new Map<string, string>();
    let named = true;
    try {
      const profs = await readByIds<{ id: string; full_name: string | null }>(
        ids,
        (chunk, from, to) => supabase.from('profiles').select('id, full_name')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
        'your clients’ names',
      );
      nameBy = new Map(profs.map((r) => [r.id, (r.full_name ?? '').trim()]));
    } catch {
      named = false;
    }
    // A name that cannot be read is a dash, never a substitute. The client is
    // still on the book and still needs a checklist.
    setNamesKnown(named);
    setClients(ids.map((id) => ({ id, name: nameBy.get(id) || null })));
  }, []);

  const loadItems = useCallback(async (coachId: string, clientId: string) => {
    setItemsErr(null);
    setWriteErr(null);
    try {
      // The display order is kept and `id` is appended to make it TOTAL:
      // `sort` is a coach-set integer that ties freely — two lines added in the
      // same second share a `sort` and a `created_at` — and a tied order across
      // separate paged requests drops rows silently.
      const rows = await readAll<Item>(
        (from, to) => supabase
          .from('coach_checklist_items')
          .select(COLS)
          .eq('coach_id', coachId)
          .eq('client_id', clientId)
          .order('sort', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
        'this client’s checklist',
      );
      setItems(rows);
    } catch (e) {
      setItems(null);
      setItemsErr((e as { message?: string } | null)?.message ?? 'The read did not come back.');
    }
  }, []);

  /**
   * The client's ticks for the window — every habit, not only this coach's.
   *
   * All of them, because a tick against the client's OWN targets is the only
   * evidence here that they opened the app on a given day, and that is what
   * separates a line they saw and left from a line nobody was ever shown.
   * src/lib/adherence.ts is where that distinction is made and defended.
   */
  const loadTicks = useCallback(async (clientId: string) => {
    setTicksErr(null);
    const w = recentWindow();
    try {
      // Ordered by the primary key, not by `done_on`. `done_on` is a DATE, so
      // every tick a client made on the same day ties — which is most of them —
      // and `summariseAdherence` reads the rows into sets and sorts what it
      // needs, so nothing downstream wanted the descending order this used to
      // ask for.
      const rows = await readAll<TickRow>(
        (from, to) => supabase
          .from('habit_logs')
          .select('habit, done_on')
          .eq('user_id', clientId)
          .gte('done_on', w.start)
          .lte('done_on', w.end)
          .order('id', { ascending: true })
          .range(from, to),
        'this client’s ticks',
      );
      setTicks({ window: w, rows });
    } catch (e) {
      // Null, never []. An empty tick list reads as "they did none of it",
      // which is the single most damaging thing this screen could say wrongly.
      setTicks(null);
      setTicksErr((e as { message?: string } | null)?.message ?? 'The read did not come back.');
    }
  }, []);

  useEffect(() => { if (me?.id) void loadClients(me.id); }, [me?.id, loadClients]);
  useEffect(() => {
    if (me?.id && picked) void loadItems(me.id, picked);
    else setItems(null);
  }, [me?.id, picked, loadItems]);

  useEffect(() => {
    if (picked) void loadTicks(picked);
    else { setTicks(null); setTicksErr(null); }
  }, [picked, loadTicks]);

  // Only computed when BOTH reads landed. A summary over a full tick list and a
  // short item list would put confident fractions against some of a coach's
  // lines and quietly omit the rest.
  const adherence: AdherenceSummary | null = useMemo(
    () => (ticks && items ? summariseAdherence({ window: ticks.window, ticks: ticks.rows, items }) : null),
    [ticks, items],
  );

  const add = async () => {
    if (!me?.id || !picked || busy) return;
    const label = draft.trim();
    if (!label) { setWriteErr('Type what you want on their list first.'); return; }
    if (label.length > LABEL_MAX) {
      setWriteErr(`That is ${label.length} characters. A checklist line has to fit on one row of a phone — ${LABEL_MAX} at most.`);
      return;
    }
    setBusy(true); setWriteErr(null);
    // Appended, not inserted at the top: a coach's existing order is theirs, and
    // a new item silently taking first place would reorder a list the client has
    // been reading in the same shape every morning.
    const nextSort = (items ?? []).reduce((m, i) => Math.max(m, i.sort), 0) + 1;
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .insert({ coach_id: me.id, client_id: picked, label, icon: icon.trim(), sort: nextSort })
      .select(COLS)
      .single();
    setBusy(false);
    if (error || !data) {
      setWriteErr(`Not saved, so it is not on their list: ${error?.message ?? 'the row did not come back.'}`);
      return;
    }
    setItems((p) => [...(p ?? []), data as unknown as Item]);
    setDraft(''); setIcon('');
  };

  const setActive = async (it: Item, active: boolean) => {
    if (busy) return;
    setBusy(true); setWriteErr(null);
    // In a try: the ceiling in lib/supabase.ts made this `await` able to throw,
    // and it had nothing around it — so a hung request left the row busy for
    // ever with an unhandled rejection behind it.
    let data: unknown[] | null = null;
    let error: { message?: string | null } | null = null;
    try {
      ({ data, error } = await supabase
        .from('coach_checklist_items').update({ active }).eq('id', it.id)
        .select(COLS));
    } catch (e) {
      setBusy(false);
      setWriteErr(writeFailedText(e, {
        what: 'That change',
        unchanged: 'their list is unchanged',
        howToCheck: 'Reload this page: the list below is drawn from whatever is actually stored.',
      }));
      return;
    }
    setBusy(false);
    // Counting the rows is the point. An update matching nothing is not an
    // error in PostgREST — it succeeds having changed nothing at all.
    if (error || !data || !data.length) {
      setWriteErr(`That change was not stored, so their list is unchanged: ${error?.message ?? 'no row was updated.'}`);
      return;
    }
    setItems((p) => (p ?? []).map((x) => (x.id === it.id ? { ...x, active } : x)));
  };

  const remove = async (it: Item) => {
    if (busy) return;
    // Deleting loses what 'coach:<id>' meant in the client's tick history, which
    // deactivating does not — so the safe option is the one offered by default
    // and this is the deliberate exception.
    if (!window.confirm(`Delete "${it.label}" permanently? Their past ticks for it stop being legible. Turning it off instead keeps the record.`)) return;
    setBusy(true); setWriteErr(null);
    const { data, error } = await supabase
      .from('coach_checklist_items').delete().eq('id', it.id).select('id');
    setBusy(false);
    if (error || !data || !data.length) {
      setWriteErr(`Not removed — it is still on their list: ${error?.message ?? 'no row was deleted.'}`);
      return;
    }
    setItems((p) => (p ?? []).filter((x) => x.id !== it.id));
  };

  const move = async (it: Item, dir: -1 | 1) => {
    if (busy || !items) return;
    const ordered = [...items].sort((a, b) => a.sort - b.sort);
    const i = ordered.findIndex((x) => x.id === it.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const other = ordered[j];
    setBusy(true); setWriteErr(null);
    const [r1, r2] = await Promise.all([
      supabase.from('coach_checklist_items').update({ sort: other.sort }).eq('id', it.id).select('id'),
      supabase.from('coach_checklist_items').update({ sort: it.sort }).eq('id', other.id).select('id'),
    ]);
    setBusy(false);
    if (r1.error || r2.error || !r1.data?.length || !r2.data?.length) {
      // One half may have landed. Re-reading is the only way to show what the
      // server actually holds rather than what this browser hoped it would.
      setWriteErr('The order was not saved cleanly. Reloading their list so you can see what actually stored.');
      if (me?.id && picked) void loadItems(me.id, picked);
      return;
    }
    setItems((p) => (p ?? []).map((x) =>
      x.id === it.id ? { ...x, sort: other.sort } : x.id === other.id ? { ...x, sort: it.sort } : x));
  };

  const shown = useMemo(
    () => (items ? [...items].sort((a, b) => a.sort - b.sort) : null),
    [items],
  );
  const client = useMemo(
    () => (clients ?? []).find((c) => c.id === picked) ?? null,
    [clients, picked],
  );

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.role !== 'trainer' && me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/coach/checklists">
        <h1>This screen is for coaches</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: 560 }}>
          Checklists sets the daily lines a coach puts on one client&rsquo;s list. Your account is
          not a coaching account, so there is no book to show — which is not the same as a book
          with nobody in it.
        </p>
      </Shell>
    );
  }

  const cellBtn: React.CSSProperties = {
    background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--ring)',
    borderRadius: 0, padding: '4px 8px', cursor: 'pointer', font: 'inherit', fontSize: 12,
  };

  return (
    <Shell me={me} gymName={gymName} current="/coach/checklists">
      <h1>Checklists</h1>
      <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: 620 }}>
        Lines you add here appear on that client&rsquo;s daily list, marked as set by you, beside
        the ones worked out from their own plan and targets. You cannot tick them — that stays
        with the client.
      </p>

      {clientsErr ? (
        <p className="dash" style={{ marginTop: 16 }}>
          Could not read your clients: {clientsErr}. This is not an empty book — it is an unread one.
        </p>
      ) : null}

      {clients && clients.length === 0 ? (
        <p className="dash" style={{ marginTop: 16 }}>
          — nobody is on your book yet, so there is no list to add to.
        </p>
      ) : null}

      {clients && clients.length > 0 ? (
        <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="who" className="eyebrow">Client</label>
          <select
            id="who" value={picked ?? ''} onChange={(e) => setPicked(e.target.value || null)}
            style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)', padding: '6px 8px', font: 'inherit' }}
          >
            <option value="">Choose someone…</option>
            {clients.map((c) => (
              // A name that could not be read still gets an entry. Dropping the
              // person would hide a client from their own coach over a failed
              // profiles read.
              <option key={c.id} value={c.id}>{c.name ?? `Name unavailable · ${c.id.slice(0, 8)}`}</option>
            ))}
          </select>
          {!namesKnown ? (
            <span className="dash">names could not be read, so some rows show an id</span>
          ) : null}
        </div>
      ) : null}

      {picked ? (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15 }}>
            {client?.name ?? <span className="dash">Name unavailable</span>}
          </h2>

          {itemsErr ? (
            <p className="dash" style={{ marginTop: 12 }}>
              Could not read their list: {itemsErr}. Nothing is shown below because nothing was
              read — do not take it as an empty list.
            </p>
          ) : null}

          {/* ANNOUNCED. This is the only page file in the console that imports
              no Banner at all, so every refusal on it — "Not saved, so it is
              not on their list", "it is still on their list" — was a silent
              colour change. A coach presses Add, hears nothing, and cannot
              tell it from having worked. */}
          {writeErr ? (
            <p role="alert" aria-live="assertive" aria-atomic="true"
               style={{ marginTop: 12, color: 'var(--warn)' }}>{writeErr}</p>
          ) : null}

          {shown && shown.length === 0 && !itemsErr ? (
            <p className="dash" style={{ marginTop: 12 }}>
              — you have not set anything for them. Their list still shows the lines worked out
              from their own plan and targets.
            </p>
          ) : null}

          {/* What the ticks can and cannot account for, before any figure is
              read. The silent days are the honest limit of all of this: a day
              with no tick of anything is a day the client missed the line and a
              day their phone stayed in a drawer, and nothing here can tell the
              two apart. Saying so once, up front, is what stops the fractions
              below reading as a scoreboard. */}
          {ticksErr ? (
            <p className="dash" style={{ marginTop: 12 }}>
              Could not read their ticks: {ticksErr}. The list is below without figures — an
              absent number here is our connection, not their week.
            </p>
          ) : adherence && adherence.silentDays > 0 ? (
            <p className="dash" style={{ marginTop: 12 }}>
              Nothing at all was logged on {adherence.silentDays} of the last {adherence.window.days} days.
              Those days are not counted as misses anywhere below: from here a day nobody logged
              looks the same whether they skipped the line or never opened the app.
            </p>
          ) : null}

          {shown && shown.length > 0 ? (
            <table className="ts" style={{ marginTop: 12, width: '100%', maxWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Line</th>
                  <th style={{ textAlign: 'left', width: 240 }}>What came of it</th>
                  <th style={{ textAlign: 'left', width: 90 }}>On their list</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((it, i) => (
                  <tr key={it.id} style={{ opacity: it.active ? 1 : 0.55 }}>
                    <td>{it.icon ? `${it.icon} ` : ''}{it.label}</td>
                    {/* setItemLine is deliberately the only thing that phrases
                        this. The same two numbers can be put to a coach as a
                        fraction of the days a line was on the list, which is
                        what they are, or as a score, which invites reading a
                        person's character off a table of ticks. */}
                    <td className="dash" style={{ fontSize: 12, lineHeight: 1.45 }}>
                      {adherence
                        ? (() => {
                            const a = adherence.set.find((x) => x.id === it.id);
                            return a ? setItemLine(a) : '— not in the window read';
                          })()
                        : ticksErr ? '— ticks unread' : '— reading…'}
                    </td>
                    <td>
                      <button style={cellBtn} disabled={busy} onClick={() => setActive(it, !it.active)}>
                        {it.active ? 'Showing' : 'Off'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={cellBtn} disabled={busy || i === 0} onClick={() => move(it, -1)} aria-label={`Move ${it.label} up`}>↑</button>{' '}
                      <button style={cellBtn} disabled={busy || i === shown.length - 1} onClick={() => move(it, 1)} aria-label={`Move ${it.label} down`}>↓</button>{' '}
                      <button style={cellBtn} disabled={busy} onClick={() => remove(it)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {/* Their own lines, discovered from the ticks — the coach never set
              these and has no other sight of them. A count and never a rate:
              the client's app rebuilds this half of the list every morning from
              their targets, their goals and whichever day their plan schedules,
              and none of that is recorded per day, so there is no denominator
              anywhere to divide by. A target never once ticked cannot appear
              here at all, which is why the sentence says what it says. */}
          {adherence && adherence.derived.length > 0 ? (
            <div style={{ marginTop: 26, maxWidth: 720 }}>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Their own lines</p>
              <p className="dash" style={{ marginBottom: 10, fontSize: 12 }}>
                Worked out from their plan and targets, not set by you. Ticks only — the app
                rebuilds this half of their list each morning, so there is no run of days to
                count them against. Anything never ticked is not listed rather than shown as none.
              </p>
              <table className="ts" style={{ width: '100%' }}>
                <tbody>
                  {adherence.derived.map((d) => (
                    <tr key={d.id}>
                      <td>{d.label}</td>
                      <td className="dash" style={{ fontSize: 12 }}>
                        ticked on {d.ticked} {d.ticked === 1 ? 'day' : 'days'}
                        {d.lastTicked ? ` · last ${dayLabel(d.lastTicked)}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div style={{ marginTop: 22, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🥗" aria-label="Icon, optional"
              maxLength={8}
              style={{ width: 56, background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)', padding: '6px 8px', font: 'inherit' }}
            />
            <input
              value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Ten minutes of hip mobility before bed"
              aria-label="What to add to their list" maxLength={LABEL_MAX}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              style={{ flex: 1, minWidth: 260, background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)', padding: '6px 8px', font: 'inherit' }}
            />
            <button style={{ ...cellBtn, fontSize: 13 }} disabled={busy} onClick={add}>
              {busy ? 'Saving…' : 'Add'}
            </button>
            <span className="dash">{draft.length}/{LABEL_MAX}</span>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
