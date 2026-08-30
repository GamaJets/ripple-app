// Shared client roster for the trainer portal — reactive so the coach can add or
// remove clients and the change flows to the Clients list and the Schedule's
// client picker.
//
// ── An empty roster is the most expensive lie in this app ──────────────────
//
// A trainer opening the Clients tab and seeing nothing concludes one of two
// things: that they have not linked anyone yet, or — far worse, and this has
// happened — that their clients are gone. The old code made those
// indistinguishable. Every read here discarded its error:
//
//   · `const { data: mc } = await supabase.from('coach_clients')…` — no `error`
//     at all. The catch it sits in cannot fire, because supabase-js resolves
//     with `{ data: null, error }` rather than throwing, so a refused read left
//     `manual` as `[]` and every manually added client simply disappeared.
//   · `if (error || !cls || !cls.length) { … return; }` folded a failed read and
//     an empty table into one branch.
//   · the outer `catch { /* stay on demo roster */ }` swallowed the rest.
//
// The reads still degrade the same way — a coach with no signal keeps whatever
// loaded — but `status` now says whether the list on screen is the server's
// answer or the absence of one, so the Clients tab can stop asserting "no
// clients yet" over a failure.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RosterClient } from '../lib/trainerMock';
import { readCoachedMode, type CoachedMode } from '../lib/types';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { endCoaching } from '../lib/endCoaching';
import { reportError } from '../lib/reportError';
import { activeInjuries, type Injury } from '../lib/injuries';

/**
 * Whether a disclosure is new enough that a coach has probably not seen it.
 *
 * Only drives a "New injury" chip on the roster card, so the window is a
 * judgement rather than a rule — but it is written down in one place instead of
 * being a magic number in a map callback.
 */
const NEW_INJURY_DAYS = 14;
const isRecent = (at: string | undefined): boolean => {
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && Date.now() - t < NEW_INJURY_DAYS * 86400000;
};

let SEQ = 900;
const MODE_KEY = 'repple.clientModes';

interface RosterValue {
  roster: RosterClient[];
  /** Whether `roster` is the server's answer. Under 'error' an empty roster
   *  means the list could not be read, NOT that the coach has no clients.
   *  Under 'partial' the people listed are real but there are more of them, or
   *  their stats were read from a set that hit its cap — so the roster may be
   *  browsed, and it may not be counted. */
  status: LoadStatus;
  /** Resolves true only when the client row reached `coach_clients` and will
   *  survive a relaunch. False means it exists on this phone only. */
  addClient: (name: string, goal: string, mode?: CoachedMode) => Promise<boolean>;
  /** Take somebody off the book. The id names a row in one of two different
   *  tables and the two mean different things — a manually-added
   *  `coach_clients` row is a note the coach wrote, and is deleted; a linked
   *  client is a real account with a real person behind it, and the coaching
   *  relationship is ENDED rather than the person erased. See the comment on
   *  the implementation.
   *
   *  Resolves true only when the server confirmed one of those two. A refused
   *  removal resolves false AND puts the client back on the roster, because a
   *  roster that quietly drops somebody the server still has is the same lie
   *  this file's header is about. */
  removeClient: (id: string) => Promise<boolean>;
  /** Resolves true only when the classification was stored server-side. It is
   *  always kept on this device, so false means "this phone only", not "lost". */
  setClientMode: (id: string, mode: CoachedMode) => Promise<boolean>;
}

const Ctx = createContext<RosterValue | null>(null);

export function RosterProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [roster, setRoster] = useState<RosterClient[]>([]);
  // Trainer-set delivery overrides (persisted). Real DB clients default to
  // 'online'; this lets the coach classify each so the roster filter works for
  // them, and it is the only home a demo or not-yet-synced client has.
  //
  // It used to carry a second job — holding 'hybrid', which no `mode` column
  // would accept — and outlived it when part 57 widened the constraints. What
  // remains is a local echo, so keep it OUT of the paths the server now
  // answers for: an override that shadows a mode a coach changed on another
  // device would be a stale local opinion beating a fresh fact.
  const [modeOverrides, setModeOverrides] = useState<Record<string, CoachedMode>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  useEffect(() => { (async () => { try { const raw = await AsyncStorage.getItem(MODE_KEY); if (raw) setModeOverrides(JSON.parse(raw)); } catch { /* local classification only; the roster itself is unaffected */ } })(); }, []);

  // A real signed-in coach sees ONLY their linked clients (clean slate if none);
  // a guest/demo (no session) sees the sample roster so the portal isn't empty to explore.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const uid = auth?.user?.id;
        if (!uid) { setRoster([]); setStatus('ready'); return; }
        setUid(uid);
        // Both halves of the roster are load-bearing, so a failure in either one
        // means the list on screen is incomplete and must not be presented as
        // the whole roster.
        let partialFailure = false;
        // Distinct from partialFailure on purpose. That one means a read did not
        // happen; this one means a read happened and there was more of it than
        // came back. They land on different statuses because they mean different
        // things to the coach reading the screen: one is "we could not look",
        // the other is "this is some of them".
        let partialRead = false;
        // Coach-created (manual) clients — durable in coach_clients (session-9 SQL).
        let manual: RosterClient[] = [];
        try {
          const { data: mc, error: mcErr } = await supabase.from('coach_clients')
            .select('id, name, goal, mode, created_at').eq('trainer_id', uid)
            .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(capLimit());
          // A table that does not exist yet is a deployment state, not a data
          // fact — either way the coach's manual clients are missing from what
          // they are about to be shown.
          if (mcErr) partialFailure = true;
          const mcPage = capped(mc);
          if (mcPage.truncated) partialRead = true;
          manual = mcPage.rows.map((r: any) => ({ id: r.id, name: r.name, goal: r.goal || 'General', weightDelta: null, adherence: null, lastActive: 'added by you', next: '—', unread: 0, mode: readCoachedMode(r.mode), joinedAt: r.created_at ?? null }));
        } catch { partialFailure = true; }
        // Ordered as well as capped. This read had no `.order()` at all, which
        // was harmless while it returned everything and stops being harmless the
        // moment it returns a thousand of a larger set: PostgREST is then free to
        // pick which thousand, and it can pick a different thousand on the next
        // launch. A coach would have watched clients appear and vanish between
        // refreshes with nothing wrong on the server. `clients` carries no
        // created_at (see the join-date note below), so id is the stable key.
        const { data: cls, error } = await supabase.from('clients')
          .select('id, goal, diet, meals_per_day, avoid, mode, injuries').eq('trainer_id', uid)
          .order('id', { ascending: true }).limit(capLimit());
        if (cancelled) return;
        // Split apart what used to be one branch. A refused read is 'error'
        // whatever else we managed to load; an empty table with the manual list
        // intact is a real, complete answer.
        if (error) { if (manual.length) setRoster(manual); setStatus('error'); return; }
        if (!cls || !cls.length) { setRoster(manual); setStatus(partialFailure ? 'error' : partialRead ? 'partial' : 'ready'); return; }
        const clsPage = capped(cls);
        if (clsPage.truncated) partialRead = true;
        const linked = clsPage.rows as any[];
        const ids = linked.map((c: any) => c.id);
        const names: Record<string, string> = {};
        try {
          // Bounded by `ids`, which the cap above holds at ROW_CAP or fewer, so
          // one profile per id cannot reach the ceiling. The limit is written
          // down anyway: the bound lives in another statement, and a later edit
          // that widens the client read should not have to notice this one.
          // no-error-ok: a name we cannot read falls back to 'Client'; the person is still on the roster
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids).limit(capLimit());
          (profs || []).forEach((p: any) => { names[p.id] = p.full_name || 'Client'; });
        } catch { /* a missing name falls back to 'Client'; the client is still listed */ }
        // When each linked client joined THIS coach's book. `clients` has no
        // created_at of its own, and the account's own creation date is the
        // wrong question anyway — somebody can have trained for a year before
        // switching coach. coaching_relationships is when this book started.
        //
        // Keyed on `ids` rather than on the coach, and moved below them to be
        // able to be: read by coach it grows with every client the coach has
        // ever held, including the ones they no longer coach, so it would have
        // hit the ceiling before the roster it decorates did — and spent the
        // rows it did get on relationships that are over.
        const joined: Record<string, string> = {};
        try {
          // no-error-ok: a join date we cannot read stays null and renders '—'; the client is listed either way
          const { data: rel } = await supabase
            .from('coaching_relationships').select('client_id, created_at')
            .eq('coach_id', uid).in('client_id', ids).limit(capLimit());
          (rel || []).forEach((r: any) => { if (r.created_at) joined[r.client_id] = r.created_at; });
        } catch { /* a missing join date is null, never a guessed one */ }
        // Real per-client stats (best-effort; RLS lets a trainer read linked clients' rows).
        // These are decorations on a row that exists either way, so a failure
        // here degrades a figure rather than hiding a person — it does not move
        // the roster into 'error'.
        const ago = (t: number) => { const sec = Math.max(0, Math.round((Date.now() - t) / 1000)); if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + 'm ago'; if (sec < 86400) return Math.round(sec / 3600) + 'h ago'; return Math.round(sec / 86400) + 'd ago'; };
        const st: Record<string, { wDelta: number | null; adh: number | null; last: number; mx?: any }> = {};
        // wDelta starts null, not 0. It only becomes a number when two scans
        // exist to subtract, and a client with one scan has no delta yet.
        ids.forEach((id: string) => { st[id] = { wDelta: null, adh: null, last: 0 }; });
        // ── Why these three are read newest-first and what a full page costs ──
        //
        // Each is one row per client per event, so they are the reads that grow
        // fastest here: two hundred clients with six scans apiece is already
        // past a thousand rows, and none of the three had any limit on it.
        //
        // Newest-first is what makes a capped page usable rather than merely
        // safe. Every one of these figures is a "most recent" — last activity,
        // latest adherence — so for any client who appears in the newest page at
        // all, their newest row is in it by construction and the figure is
        // exact. Read oldest-first the same page would have answered "last
        // active" with a date from two years ago and been believed.
        //
        // Two things the page cannot answer, and both are handled below rather
        // than guessed: a client absent from it has not been shown to be
        // inactive, and a weight delta needs the client's FIRST scan, which is
        // the row a newest-first cap drops first.
        let statsTruncated = false;
        let scansTruncated = false;
        try {
          const { data: sc, error: scErr } = await supabase.from('scans')
            .select('client_id, weight_kg, taken_at, metrics').in('client_id', ids)
            .order('taken_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
          // supabase-js resolves on a database error, so the catch below never
          // saw the failure that actually happens. Without this, a refused read
          // left every client reading "no activity yet" — which is a claim
          // about the client, and a coach acts on it by chasing them.
          if (scErr) partialFailure = true;
          const scPage = capped(sc);
          if (scPage.truncated) { statsTruncated = true; scansTruncated = true; }
          const byC: Record<string, { w: number; t: number; m: any }[]> = {};
          // Back to oldest-first per client: the loop below reads arr[0] as the
          // earliest scan and arr[last] as the newest, and handing it a reversed
          // array would have flipped the sign of every weight change on the
          // roster — a client who lost 4 kg shown as having gained it.
          scPage.rows.slice().reverse().forEach((r: any) => { (byC[r.client_id] = byC[r.client_id] || []).push({ w: Number(r.weight_kg), t: Date.parse(r.taken_at), m: r.metrics }); });
          for (const id of ids) { const arr = byC[id]; if (arr && arr.length) { st[id].wDelta = arr.length > 1 ? Math.round((arr[arr.length - 1].w - arr[0].w) * 10) / 10 : null; st[id].last = Math.max(st[id].last, arr[arr.length - 1].t); for (let k = arr.length - 1; k >= 0; k--) { if (arr[k].m) { st[id].mx = arr[k].m; break; } } } }
        } catch { /* stats decorate a row that is listed regardless */ }
        try {
          const { data: wo, error: woErr } = await supabase.from('workouts')
            .select('user_id, performed_at').in('user_id', ids)
            .order('performed_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
          if (woErr) partialFailure = true;
          const woPage = capped(wo);
          if (woPage.truncated) statsTruncated = true;
          woPage.rows.forEach((r: any) => { if (st[r.user_id]) st[r.user_id].last = Math.max(st[r.user_id].last, Date.parse(r.performed_at)); });
        } catch { /* as above */ }
        try {
          const { data: ci, error: ciErr } = await supabase.from('check_ins')
            .select('user_id, at, adherence').in('user_id', ids)
            .order('at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
          if (ciErr) partialFailure = true;
          const ciPage = capped(ci);
          if (ciPage.truncated) statsTruncated = true;
          const seen = new Set<string>();
          ciPage.rows.forEach((r: any) => { if (st[r.user_id]) { st[r.user_id].last = Math.max(st[r.user_id].last, Date.parse(r.at)); if (!seen.has(r.user_id) && typeof r.adherence === 'number') { seen.add(r.user_id); // check_ins.adherence is a 1-5 self-rating (see the Rating control on the client check-in screen), but every trainer surface renders this field as a PERCENTAGE and atRiskClient() flags anything under 80. Passing it through raw meant a client who rated themselves 4/5 showed as '4% adherence' and was flagged at risk. Convert.
            st[r.user_id].adh = Math.round((Math.max(1, Math.min(5, r.adherence)) / 5) * 100); } } });
        } catch { /* as above */ }
        if (statsTruncated) partialRead = true;
        const goalMap: Record<string, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };
        // The two suppressions the capped stat pages force, spelled out:
        //
        //   · 'no activity yet' is an assertion about the client, and a coach
        //     acts on it by chasing someone who has done nothing wrong. It is
        //     only true when we saw every row. Absent from a capped page means
        //     unknown, which is a dash.
        //   · a weight delta is last minus first, and a newest-first cap drops
        //     the first. Computing it from the tail of a client's history does
        //     not produce a smaller number, it produces a wrong one — often the
        //     wrong sign. Null, and the screen already renders that as no change
        //     recorded rather than as zero.
        const real: RosterClient[] = linked.map((c: any) => { const sc = st[c.id]; return { id: c.id, name: names[c.id] || 'Client', goal: goalMap[c.goal] || 'General', weightDelta: scansTruncated ? null : sc.wDelta, adherence: sc.adh != null ? sc.adh : null, lastActive: sc.last ? ago(sc.last) : (statsTruncated ? '—' : 'no activity yet'), next: '—', unread: 0, mode: readCoachedMode(c.mode), metrics: sc.mx ?? undefined, diet: c.diet ?? undefined, mealsPerDay: c.meals_per_day ?? undefined, avoid: Array.isArray(c.avoid) ? c.avoid : undefined, joinedAt: joined[c.id] ?? null, injuries: activeInjuries(Array.isArray(c.injuries) ? c.injuries : []).map((i: Injury) => ({ area: i.area, severity: i.severity, note: i.note, isNew: isRecent(i.at) })) }; });
        if (!cancelled) { setRoster([...real, ...manual]); setStatus(partialFailure ? 'error' : partialRead ? 'partial' : 'ready'); }
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev]);
  /** Keep the coach's answer on this device. Persisted, because the server can
   *  only hold the narrowed one until the CHECK constraints are widened. */
  const rememberMode = (id: string, mode: CoachedMode) => {
    setModeOverrides((p) => { const next = { ...p, [id]: mode }; try { AsyncStorage.setItem(MODE_KEY, JSON.stringify(next)); } catch { /* the override still applies this session */ } return next; });
  };
  const addClient = async (name: string, goal: string, mode: CoachedMode = 'online'): Promise<boolean> => {
    const n = name.trim();
    if (!n) return false;
    const localId = `c${SEQ++}`;
    setRoster((p) => [...p, { id: localId, name: n, goal, weightDelta: null, adherence: null, lastActive: 'just added', next: '—', unread: 0, mode, joinedAt: new Date().toISOString() }]);
    // Durable: persist to coach_clients so the roster survives restarts/devices.
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase.from('coach_clients').insert({ trainer_id: uid, name: n, goal, mode }).select('id').single();
      const sid = data?.id;
      if (error || !sid) return false;
      setRoster((p) => p.map((c) => (c.id === localId ? { ...c, id: sid } : c)));
      return true;
    } catch { return false; }
  };
  // ── Removing a client, and the two records that word covers ────────────────
  //
  // This used to delete a `coach_clients` row and return true. `coach_clients`
  // is the MANUALLY-ADDED client table — a name and a goal the coach typed, with
  // no account behind it — and a client who signed up and linked has no row in
  // it at all. So for every real client the delete matched nothing, succeeded
  // (PostgREST does not error on a delete that hits no rows), and returned true.
  // The coach watched somebody leave the roster, and found them back on it at
  // the next launch with every workout, scan, measurement and message still
  // open to them. Nothing in this product could end a coaching relationship.
  //
  // Now there are two paths, because there are two records:
  //
  //   · a manually-added client IS the coach_clients row. Deleting it is the
  //     whole removal, and `.select('id')` makes the delete report which rows it
  //     took — the only way to tell "removed" from "matched nothing".
  //   · a linked client is a real person. They are not deleted; the RELATIONSHIP
  //     is ended, by `end_coaching()` (68-end-coaching.sql), which writes both
  //     halves of the link — coaching_relationships.status and
  //     clients.trainer_id — or neither. The client keeps their account and
  //     every row in it; the coach keeps the sessions they delivered.
  //
  // The id alone does not say which table it belongs to — both are uuids — so
  // this asks rather than guesses: delete first, and if nothing was deleted the
  // id was not a manual client, so try the relationship. `end_coaching()`
  // returning false is that same question answered from the other side ("no
  // record of a link with this person"), which is why neither call may be
  // treated as a success by default.
  const removeClient = async (id: string): Promise<boolean> => {
    // Where they were, so a removal the server refuses can be undone rather
    // than leaving a real client invisible until the app is relaunched.
    const at = roster.findIndex((c) => c.id === id);
    const removed = at >= 0 ? roster[at] : null;
    const putBack = () => {
      if (!removed) return;
      setRoster((p) => (p.some((c) => c.id === id) ? p : [...p.slice(0, at), removed, ...p.slice(at)]));
    };
    setRoster((p) => p.filter((c) => c.id !== id));
    // A local id (no dashes) never reached the server, so removing it locally is
    // the whole of the removal and genuinely succeeded.
    if (!USE_SUPABASE || !id.includes('-')) return true;

    // A failure here is NOT the end of the attempt: `coach_clients` is a table
    // a fresh deployment may not have yet (see the loader above), and a linked
    // client would then never get as far as the relationship. Remember it, so
    // the reason survives if the second path also comes up empty.
    let manualErr: unknown = null;
    try {
      const { data, error } = await supabase.from('coach_clients').delete().eq('id', id).select('id');
      if (error) manualErr = error;
      else if (data && data.length) return true;
    } catch (e) { manualErr = e; }
    if (manualErr) reportError('roster.removeClient.manual', manualErr, { id });

    const ended = await endCoaching(id);
    if (ended.ok && ended.ended) return true;
    if (!ended.ok) reportError('roster.removeClient.end', new Error(ended.reason), { id });
    // Neither table had anything to remove, or the server refused. Either way
    // nothing was written, so the roster must not go on showing them as gone.
    putBack();
    return false;
  };
  const setClientMode = async (id: string, mode: CoachedMode): Promise<boolean> => {
    rememberMode(id, mode);
    // Durably persist to Supabase so the classification follows the client across
    // devices and feeds owner analytics (RLS: a trainer may update their own clients).
    if (!USE_SUPABASE) return false;
    // The id belongs to exactly one of these two tables, so the other update
    // matches nothing. An update that matches nothing is NOT an error in
    // Postgrest — it succeeds having changed zero rows — which is why both of
    // these could "succeed" while the classification was stored nowhere.
    // Counting the returned rows is the only way to tell.
    try {
      const { data, error } = await supabase.from('clients').update({ mode }).eq('id', id).select('id');
      if (!error && data && data.length) return true;
    } catch { /* fall through to the coach_clients attempt */ }
    try {
      const { data, error } = await supabase.from('coach_clients').update({ mode }).eq('id', id).select('id');
      return !error && !!data && data.length > 0;
    } catch { return false; }
  };
  // Apply overrides on top of whatever mode the roster came with.
  const shown = Object.keys(modeOverrides).length ? roster.map((c) => (modeOverrides[c.id] ? { ...c, mode: modeOverrides[c.id] } : c)) : roster;
  return <Ctx.Provider value={{ roster: shown, status, addClient, removeClient, setClientMode }}>{children}</Ctx.Provider>;
}

export function useRoster(): RosterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoster must be used inside <RosterProvider>');
  return v;
}
