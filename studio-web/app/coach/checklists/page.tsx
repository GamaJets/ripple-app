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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';

/** One row of coach_checklist_items, as this screen holds it. */
interface Item {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  sort: number;
}

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

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      const { data } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) setGymName((data as { name?: string } | null)?.name ?? null);
    })();
    return () => { live = false; };
  }, []);

  // The coach's book. Scoped in the query, not filtered after it lands.
  const loadClients = useCallback(async (coachId: string) => {
    setClientsErr(null);
    const { data, error } = await supabase.from('clients').select('id').eq('trainer_id', coachId);
    if (error) {
      // Null, not []. An empty list here reads as "you have no clients", which
      // is a statement about this coach's book rather than about the read.
      setClients(null);
      setClientsErr(error.message);
      return;
    }
    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    if (!ids.length) { setClients([]); return; }

    const { data: profs, error: pErr } = await supabase
      .from('profiles').select('id, full_name').in('id', ids);
    // A name that cannot be read is a dash, never a substitute. The client is
    // still on the book and still needs a checklist.
    setNamesKnown(!pErr);
    const nameBy = new Map(
      (profs ?? []).map((p) => {
        const r = p as { id: string; full_name: string | null };
        return [r.id, (r.full_name ?? '').trim()];
      }),
    );
    setClients(ids.map((id) => ({ id, name: nameBy.get(id) || null })));
  }, []);

  const loadItems = useCallback(async (coachId: string, clientId: string) => {
    setItemsErr(null);
    setWriteErr(null);
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .select('id, label, icon, active, sort')
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) { setItems(null); setItemsErr(error.message); return; }
    setItems((data ?? []) as unknown as Item[]);
  }, []);

  useEffect(() => { if (me?.id) void loadClients(me.id); }, [me?.id, loadClients]);
  useEffect(() => {
    if (me?.id && picked) void loadItems(me.id, picked);
    else setItems(null);
  }, [me?.id, picked, loadItems]);

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
      .select('id, label, icon, active, sort')
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
    const { data, error } = await supabase
      .from('coach_checklist_items').update({ active }).eq('id', it.id)
      .select('id, label, icon, active, sort');
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

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

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

          {writeErr ? (
            <p style={{ marginTop: 12, color: 'var(--warn)' }}>{writeErr}</p>
          ) : null}

          {shown && shown.length === 0 && !itemsErr ? (
            <p className="dash" style={{ marginTop: 12 }}>
              — you have not set anything for them. Their list still shows the lines worked out
              from their own plan and targets.
            </p>
          ) : null}

          {shown && shown.length > 0 ? (
            <table className="ts" style={{ marginTop: 12, width: '100%', maxWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Line</th>
                  <th style={{ textAlign: 'left', width: 90 }}>On their list</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((it, i) => (
                  <tr key={it.id} style={{ opacity: it.active ? 1 : 0.55 }}>
                    <td>{it.icon ? `${it.icon} ` : ''}{it.label}</td>
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
