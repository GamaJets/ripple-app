// Coach-assigned training programs — clientId → Program. Persists to Supabase
// `assigned_programs` (coach writes; client reads own) with an in-memory
// fallback. When set, the client's Train tab uses it over the auto program.
//
// The write side already refuses to lie (see assignProgram). The READ side had
// the mirror-image bug: when the select failed, `programs` stayed `{}` and
// getProgram returned null — the same null it returns when a coach genuinely has
// not assigned anything. The client's Train tab then quietly built the generic
// auto program and presented it as their plan, so a client on a bespoke program
// trained the wrong session and had no way to tell. `status` separates "your
// coach has not assigned you a program" from "we could not find out".
//
// ── And a copy on the phone, for the room it is trained in ─────────────────
//
// src/lib/readCache.ts opens on the member in the basement weights room with no
// signal and lists the seven reads given a copy on the device for them. This
// was not one of them, and it is the one they came to that room to do: with no
// copy, a cold launch on no signal left `programs` empty, and
// app/(client)/week.tsx told them their plan could not be read — correct, and
// useless, with the bar already loaded.
//
// The judgements about what may be written and when it may be shown are in
// src/lib/programCache.ts with a test. The two that shape this file: the copy
// is layered UNDER a live read rather than merged into `programs`, and the
// SERVER's answer is what gets written, including when that answer is empty.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Program } from '../lib/programs';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { writeFailure } from '../lib/wroteRows';
import { reportError } from '../lib/reportError';
import {
  mayCache, mayServeCached, packPrograms, programCacheKey, readPrograms,
  type CachedPrograms,
} from '../lib/programCache';
import { mergeAssignments, mergeStartsOn } from '../lib/assignmentMerge';
import { cachedAtLine } from '../lib/readCache';
import { useRecoverRead } from './readRefresh';

interface AssignedProgramsValue {
  /**
   * What this session knows: the server's answer, plus this device's own
   * unconfirmed writes.
   *
   * Deliberately NOT the device's cached copy — that is served through
   * `getProgram` and only while no read has landed. A caller reading this map
   * directly gets the stricter answer, which is the right default for anything
   * counting rather than drawing.
   */
  programs: Record<string, Program>;
  getProgram: (clientId: string) => Program | null;
  /** Whether `programs` is what the server holds. Under 'error' a null from
   *  getProgram means "unknown", not "none assigned". */
  status: LoadStatus;
  /** Resolves true only when the assignment reached the server. Three screens
   *  told the coach "they'll see it on their Train tab" off a fire-and-forget
   *  upsert whose rejection handler was empty, and which was skipped entirely
   *  when uid was still null. */
  assignProgram: (clientId: string, program: Program) => Promise<boolean>;
  /** The same write, with the sentence saying why it did not land.
   *
   *  A bulk assign is twelve of these at once and has to report on each one by
   *  name — "8 of 12 saved" tells a coach something is wrong and nothing about
   *  which four or what to do. See src/lib/bulkActions.ts. */
  assignProgramTo: (clientId: string, program: Program, startsOn?: string | null) => Promise<{ ok: boolean; why: string | null }>;
  /** Read the assignments again. Under 'error' every `getProgram` null means
   *  "unknown", which is a whole coach app's worth of screens saying nothing
   *  is assigned when they do not know. */
  reload: () => void;
  /**
   * The day the COACH said each client's block begins, `YYYY-MM-DD`, for the
   * clients whose row carried one.
   *
   * Absent from the map is "they have no start date", which is every
   * assignment made before supabase/parts/175 and every one a coach makes
   * without choosing a date — that stays the default, because "assign it now"
   * is what the control has always meant.
   *
   * IT DOES NOT GATE ANYTHING, and this provider is where that is enforced.
   * The client's Train tab renders whatever is on their row from the moment it
   * is written; a provider that withheld a programme until its start date would
   * empty a Train tab, and an empty Train tab is indistinguishable from having
   * no coach.
   *
   * What the date DOES decide, since src/lib/clientBlock.ts, is which week of a
   * multi-week block is on screen. That is a week number moving, never a
   * programme being withheld: a block dated for next Monday shows week one
   * today, and a block that has run out stays on its last week.
   * `CLIENT_STARTS_NOW` in src/lib/programStart.ts is the sentence every screen
   * showing a start date has to carry, and it says both halves.
   */
  startsOn: Record<string, string>;
  /** Resolves true only when the removal reached the server. A clear that was
   *  refused leaves the client still training the old program while the coach's
   *  screen shows it gone. */
  clearProgram: (clientId: string) => Promise<boolean>;
  /** The same removal, with the sentence saying why it did not land.
   *
   *  A coach taking several clients off a programme at once has to be told
   *  which of them it worked for, by name — the same rule the assign side
   *  already follows. See src/lib/bulkActions.ts. */
  clearProgramFrom: (clientId: string) => Promise<{ ok: boolean; why: string | null }>;
  /**
   * The sentence saying this programme came off the phone and how old it is, or
   * null when it did not.
   *
   * Non-null ONLY while the device's copy is what `getProgram` is serving, so a
   * screen may render it beside the block without checking anything else. It
   * does not replace `status`: the status still says the read failed, and this
   * says what the member is looking at instead. Five different sentences —
   * loading, failed, empty, truncated, stale — and this is the fifth.
   */
  cachedNote: string | null;
}

const Ctx = createContext<AssignedProgramsValue | null>(null);

export function AssignedProgramsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [programs, setPrograms] = useState<Record<string, Program>>({});
  const [startsOn, setStartsOn] = useState<Record<string, string>>({});
  const [uid, setUid] = useState<string | null>(null);
  /**
   * How many of this device's own writes are outstanding.
   *
   * A ref rather than state: nothing renders from it, and a re-render between
   * the increment and the read is exactly what it must survive. A COUNT, not a
   * flag — a bulk assign is twelve writes settling one at a time, and a flag
   * cleared by the first would let a read land on the other eleven. See
   * src/lib/assignmentMerge.ts for what it decides.
   */
  const writing = useRef(0);
  /** The programmes as of the last render, so the read can work out which
   *  survive without calling a setter from inside another setter's updater. */
  const programsRef = useRef<Record<string, Program>>(programs);
  programsRef.current = programs;
  /**
   * The other two things the write paths read at CALL time, held as refs.
   *
   * Not an optimisation dressed up: the four write functions below are handed
   * to every screen through the context, and a function that closes over
   * `startsOn` or `uid` as values has to be rebuilt whenever either changes —
   * which rebuilds the context value, which re-renders every consumer of this
   * provider whether or not it cares. Reading them through a ref at the moment
   * the coach taps is also the more correct of the two: what a write needs to
   * put back on failure is the map as it is NOW, not the map as it was on the
   * render that produced the handler.
   */
  const startsOnRef = useRef<Record<string, string>>(startsOn);
  startsOnRef.current = startsOn;
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // Bumped by `reload`. Beside `authRev` in the read's dependency array so a
  // refresh runs the one read this provider has.
  const [nonce, setNonce] = useState(0);
  /**
   * The last thing the server said, kept on this phone, and whether a read has
   * landed in THIS session.
   *
   * Two pieces of state rather than one map, because the whole guarantee is
   * that the copy never beats a live read — see `mayServeCached` in
   * src/lib/programCache.ts. Merging the device's copy into `programs` would
   * make that a rule somebody has to remember; keeping it in its own slot,
   * consulted only through `getProgram` when `live` is false, makes it a shape.
   *
   * It also keeps the removal case honest. A coach who takes somebody off a
   * block produces a read of zero rows; because the cache is layered UNDER a
   * live read rather than merged into it, `live` turning true is enough for
   * that removal to be respected on screen the moment it is read, with no
   * unpicking of a seeded map.
   */
  const [cached, setCached] = useState<CachedPrograms | null>(null);
  const [live, setLive] = useState(!USE_SUPABASE);

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
        const id = auth?.user?.id;
        // Signed out — nobody has been assigned anything, which is true rather
        // than unknown.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // ── The device's copy, read before the network is asked ────────────
        //
        // AFTER the account is known and never before it: the key is scoped by
        // uid (src/lib/readCache.ts) and reading it any earlier would mean
        // guessing whose phone this is. Two members share a phone.
        //
        // Read first rather than only on failure, because "on failure" is
        // thirty seconds away now that requests have a ceiling
        // (src/lib/requestTimeout.ts). A member standing at the rack does not
        // have thirty seconds of blank screen to give; the copy goes up
        // immediately and the live read replaces it when it lands. It cannot
        // overwrite anything, because `live` is still false and nothing has
        // been merged into `programs`.
        try {
          const raw = await AsyncStorage.getItem(programCacheKey(id));
          if (cancelled) return;
          const copy = readPrograms(raw);
          if (copy.found) setCached(copy);
        } catch { /* no copy is the ordinary case; the read below is the answer */ }
        // `error` was previously discarded entirely: `const { data } = await …`.
        // A refused read handed back data === null, which read as "no
        // assignments" at every call site.
        // One row per client for a coach, so it scales with the roster and needs
        // the roster's ceiling. Ordered on client_id because there is no other
        // stable key here and an unordered cap lets the server return a
        // different thousand each launch — a coach would see a client's
        // programme appear on Monday and be gone on Tuesday.
        // Snapshotted BEFORE the request goes out. What matters is whether any
        // write of this device's OVERLAPPED the read: one that started before
        // the select and finished before the answer came back may still be
        // missing from that answer, and the counter would already be back at
        // zero by the time it is processed.
        const writesBefore = writing.current;
        const { data, error } = await supabase.from('assigned_programs').select('*')
          .or('client_id.eq.' + id + ',coach_id.eq.' + id)
          .order('client_id', { ascending: true }).limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        const m: Record<string, Program> = {};
        // Kept in its own map rather than folded onto the Program. A start date
        // is a fact about the ASSIGNMENT — one client's copy of a plan and when
        // their coach said it begins — and the same Program object is also the
        // group's plan, a library template and an on-device draft, none of which
        // has a start date. Hanging it on the programme would carry a date into
        // a template and out to the next person it was assigned to.
        const d: Record<string, string> = {};
        for (const r of page.rows as any[]) {
          if (r.program) m[r.client_id] = r.program as Program;
          // Only a real date goes in the map. A null or an empty string is the
          // coach not having said, and absence is how that is spelled — see
          // `startsOn` on the interface above.
          if (typeof r.starts_on === 'string' && r.starts_on) d[r.client_id] = r.starts_on;
        }
        // ── and a programme the server no longer lists is taken away ───────
        //
        // This was `if (Object.keys(m).length) setPrograms(prev => …)`, which
        // is a merge with no way to say "gone" — and zero rows, the shape a
        // removal arrives in, was the one case the guard skipped entirely. A
        // coach taking somebody off a block had no effect on a running app at
        // all. That was small while a re-read meant somebody pulling down on a
        // screen; src/lib/readRefresh.ts re-reads on every reconnect, so the
        // session that shows the ended block now survives days.
        //
        // It cannot simply replace, either: a truncated page is missing rows
        // for reasons that are nothing to do with those clients, and a read
        // that raced this device's own write returns the world without it.
        // src/lib/assignmentMerge.ts holds all three outcomes with a test.
        const facts = { whole: !page.truncated, writesInFlight: Math.max(writesBefore, writing.current) };
        const kept = mergeAssignments(programsRef.current, m, facts);
        setPrograms(kept);
        setStartsOn((prevD) => mergeStartsOn(prevD, d, kept, facts));
        // The server has answered, so the device's copy stops being consulted
        // from here — including when this answer is EMPTY, which is what a
        // coach taking somebody off a block looks like.
        setLive(true);
        setStatus(page.truncated ? 'partial' : 'ready');
        // ── and what is kept for the next basement ─────────────────────────
        //
        // The SERVER's maps, not the merged state. `programs` also holds
        // optimistic writes that have not been confirmed, and a cache written
        // from it would hand a coach back their own guess on the next launch as
        // though the server had agreed to it.
        //
        // Not written at all when the page was truncated: a prefix kept as the
        // answer is a member whose row was past the cap being told by their own
        // phone that they have no programme. src/lib/programCache.ts · mayCache.
        if (mayCache(page.truncated)) {
          AsyncStorage.setItem(programCacheKey(id), packPrograms(m, d))
            .catch(() => { /* the programme is right this session either way */ });
        }
      } catch { setStatus('error'); /* stay in-memory, but say the read failed */ }
    })();
    return () => { cancelled = true; };
  }, [authRev, nonce]);

  /**
   * Read the assignments again.
   *
   * Safe to run over the optimistic map, and that is not an accident: a write
   * that does not land is already PUT BACK by `assignProgramTo` and
   * `clearProgram`, so what is in `programs` when this fires is either the
   * server's or on its way to being. A provider that left failed writes in
   * place would have to refuse this, because the re-read would silently undo
   * what the coach could see on their own screen.
   */
  const reload = useCallback(() => {
    if (USE_SUPABASE) setStatus('loading');
    setNonce((n) => n + 1);
  }, []);

  /**
   * The programme for one person, or null.
   *
   * The device's copy is consulted LAST and only while no read has landed this
   * session. So the order of preference is: what the server said this session,
   * then what this device optimistically wrote, then what the server said the
   * last time it could be asked — and never the last of those over either of
   * the first two.
   *
   * `status` is untouched by any of this. A cached programme is served under
   * 'error', which src/ui/loadStatus.ts already defines as "whatever we had
   * before the failure … not confirmed current". Nothing here makes anything
   * 'ready', and app/(client)/week.tsx's `programUnknown` still reads a null
   * under a non-'ready' status as "we could not find out".
   */
  const getProgram = useCallback((clientId: string): Program | null => {
    const held = programs[clientId];
    if (held) return held;
    if (cached && mayServeCached(live, cached.found)) return cached.programs[clientId] ?? null;
    return null;
  }, [programs, cached, live]);
  /**
   * Put a programme on one client, and say what happened.
   *
   * ── Why the row count, and not `error` ─────────────────────────────────
   *
   * The same reasoning `clearProgram` below already carries, arriving here
   * because a BULK assign made it matter twelve times per tap. `!error` was
   * this function's whole test of success, and a PostgREST write that matches
   * no rows is not an error: it comes back 204 with `error` null, and the
   * screen above announced "they'll see it on their Train tab".
   *
   * The refusal is real and it is not exotic. `assigned_programs_coach_rw` is
   * `coach_id = auth.uid() AND is_my_client(client_id)`, and `is_my_client`
   * looks in `clients` — so a client the coach added BY HAND has no row for it
   * to find, and every one of them fails this check. A coach whose book is
   * half hand-added and half linked taps Assign on twelve people and gets
   * twelve writes of which six do nothing.
   *
   * `writeFailure` is what turns the three outcomes — refused, matched
   * nothing, nobody counted — into one sentence for the coach, and it treats a
   * MISSING count as a failure rather than a pass, which is what stops a
   * future edit dropping `{ count: 'exact' }` and silently re-admitting all of
   * this.
   *
   * The local map is still written FIRST, because the screen has to respond to
   * the tap — and it is put back if the write does not land. See below.
   */
  const assignProgramTo = useCallback(async (clientId: string, program: Program, when?: string | null): Promise<{ ok: boolean; why: string | null }> => {
    // ── and why a failed write is PUT BACK ───────────────────────────────
    //
    // The optimistic entry is written first so the screen responds to the tap,
    // and it used to be left there whatever happened. That was already a small
    // lie — a coach's own device showed a client on a programme the server had
    // refused — and a bulk assign turns it into a load-bearing one, because
    // `getProgram` is what the overwrite confirmation counts. Leave a failed
    // write in the map and the retry's confirmation says "9 of these 12 are on
    // a programme now" about people whose programme never landed, which is the
    // screen reading its own guess back to the coach as a fact.
    const previous = programsRef.current[clientId] ?? null;
    const putBack = () => setPrograms((p) => {
      const n = { ...p };
      if (previous) n[clientId] = previous; else delete n[clientId];
      return n;
    });
    setPrograms((p) => ({ ...p, [clientId]: program }));
    const me = uidRef.current;
    if (!USE_SUPABASE || !me) {
      putBack();
      return { ok: false, why: 'This programme was not saved — the app could not confirm who you are signed in as, so nothing was sent to the server.' };
    }
    // Counted from before the request is sent, so a read that lands while it
    // is out cannot treat this client's absence from the server's answer as a
    // removal. src/lib/assignmentMerge.ts. Decremented on every path out,
    // including the refusals — a counter that leaks pins the merge open and
    // the removals stop arriving again.
    writing.current += 1;
    try {
      // `starts_on` is sent ONLY when the caller passed one, and `undefined` is
      // dropped by the driver rather than written as null. That matters on an
      // OVERWRITE: a screen that does not offer a start date must not silently
      // clear the one a coach set from a screen that does. Passing an explicit
      // `null` is how a caller says "take the date off", which is a different
      // intent and is spelled differently.
      const row: Record<string, unknown> = { client_id: clientId, coach_id: me, program };
      if (when !== undefined) row.starts_on = when;
      const r = await supabase.from('assigned_programs')
        .upsert(row, { onConflict: 'client_id', count: 'exact' });
      const why = writeFailure('That programme', r);
      if (why) {
        reportError('assignedPrograms.assignProgram', new Error(why), { clientId });
        putBack();
        // The generic sentence names the outcome; this names the cause the
        // coach can actually do something about. `is_my_client` looks in
        // `clients`, so a client the coach typed into Add Client fails it every
        // time — proved live against phgfwzpkkwdysftlgkoq, where the same
        // fan-out wrote 1 row for the linked client and was refused 42501 for
        // the hand-added one beside it.
        return { ok: false, why: `${why} Clients you added by hand have no Train tab until they join.` };
      }
      // The local map follows the write, and only after it landed. The
      // optimistic entry above is the PROGRAMME, because the screen has to
      // respond to the tap; a start date is read back as prose ("week 3 of 8")
      // and a wrong one is a sentence rather than a delay, so it is written
      // once the server has agreed to it.
      if (when !== undefined) {
        setStartsOn((p) => {
          const n = { ...p };
          if (when) n[clientId] = when; else delete n[clientId];
          return n;
        });
      }
      return { ok: true, why: null };
    } catch (e) {
      reportError('assignedPrograms.assignProgram', e, { clientId });
      putBack();
      return { ok: false, why: 'That programme did not reach the server, so nothing has changed for them.' };
    } finally {
      writing.current = Math.max(0, writing.current - 1);
    }
    // No dependencies at all, and that is the point: every value this reads is
    // read through a ref or a setter's updater, so the handler a screen holds
    // is the same function for the life of the provider.
  }, []);
  const assignProgram = useCallback(async (clientId: string, program: Program): Promise<boolean> =>
    (await assignProgramTo(clientId, program)).ok, [assignProgramTo]);
  /**
   * Take a client off their coach-assigned programme.
   *
   * ── Why the row count, and not `error` ─────────────────────────────────
   *
   * `assigned_programs_coach_rw` is
   * `coach_id = auth.uid() AND is_my_client(client_id)`. A DELETE that fails
   * either half matches zero rows, and PostgREST answers 204 with `error`
   * null — so `!error` was true for a delete that removed nothing, and
   * builder.tsx's `revert` announced "Reverted to auto" over a client who is
   * still training the programme their coach believes they took away.
   *
   * This is not a second-gym problem. There is ONE row per client
   * (`onConflict: 'client_id'`), so it carries whichever coach last wrote it.
   * When a client moves from coach A to coach B, coach B is their coach and
   * the row is still coach A's — proved live against phgfwzpkkwdysftlgkoq by
   * seeding exactly that: coach B could not even SELECT the programme their
   * own client is following, and the DELETE affected 0 rows and raised
   * nothing. Coach A's identical delete affected 1, so the count only ever
   * rejects a write that genuinely did not happen.
   *
   * The local map is still cleared first, and that stays: the screen has to
   * respond to the tap. `false` is what stops the screen ANNOUNCING it, and
   * builder.tsx already handles it correctly.
   */
  /**
   * ── And why taking somebody OFF a programme does not touch their history ──
   *
   * Asked for as "assign and un-assign templates meanwhile keeping the data for
   * the history of the workouts done in those templates so you can add it back
   * in at a later stage". The second half of that is a fear rather than a
   * feature, and it is worth answering with the schema rather than with
   * reassurance.
   *
   * Checked live against phgfwzpkkwdysftlgkoq by reading `pg_constraint` for
   * every foreign key whose target is `assigned_programs` or
   * `program_templates`: THERE ARE NONE. Nothing in the database points at
   * either table, so nothing can cascade from either. `workouts` is keyed by
   * `user_id`, `performed_at` and `exercise`, and carries no reference to a
   * plan at all — a logged set belongs to the person who did it, not to the
   * programme it was done under. So this DELETE removes a plan and can reach
   * nothing else, and re-assigning the same template later needs nothing
   * special to "add the history back": it was never gone.
   */
  const clearProgramFrom = useCallback(async (clientId: string): Promise<{ ok: boolean; why: string | null }> => {
    // Put back on failure, for the reason `assignProgramTo` gives above: the
    // local map is what the overwrite confirmation counts, and a client left
    // out of it because a delete was refused makes the next dialog say they are
    // on nothing while they are still training it.
    const previous = programsRef.current[clientId] ?? null;
    const previousStart = startsOnRef.current[clientId] ?? null;
    const putBack = () => {
      setPrograms((p) => (previous ? { ...p, [clientId]: previous } : p));
      if (previousStart) setStartsOn((p) => ({ ...p, [clientId]: previousStart }));
    };
    setPrograms((p) => { const n = { ...p }; delete n[clientId]; return n; });
    // The date goes with the row it was on. A client taken off a programme is
    // on no block, and a start date left behind would have the next screen say
    // "week 3 of 8" about nothing.
    setStartsOn((p) => { const n = { ...p }; delete n[clientId]; return n; });
    if (!USE_SUPABASE || !uidRef.current) {
      putBack();
      return { ok: false, why: 'The app could not confirm who you are signed in as, so nothing was sent to the server.' };
    }
    // As above: this device's own removal must not be undone by a read that
    // raced it. src/lib/assignmentMerge.ts.
    writing.current += 1;
    try {
      const r = await supabase.from('assigned_programs').delete({ count: 'exact' }).eq('client_id', clientId);
      const why = writeFailure('That programme', r);
      if (why) {
        reportError('assignedPrograms.clearProgram', new Error(why), { clientId });
        putBack();
        return { ok: false, why: `${why} Clients you added by hand have no Train tab until they join.` };
      }
      return { ok: true, why: null };
    } catch (e) {
      reportError('assignedPrograms.clearProgram', e, { clientId });
      putBack();
      return { ok: false, why: 'That removal did not reach the server, so nothing has changed for them.' };
    } finally {
      writing.current = Math.max(0, writing.current - 1);
    }
  }, []);
  const clearProgram = useCallback(async (clientId: string): Promise<boolean> =>
    (await clearProgramFrom(clientId)).ok, [clearProgramFrom]);

  // When the signal comes back, this read is run again without anybody having
  // to ask. Until this existed, the ONLY things that called `reload` were
  // app/(client)/week.tsx's pull-to-refresh gesture and the coach screens'
  // Refresh link — both of which need a member who knows the app is stuck and
  // thinks to ask. Somebody walking out of a basement onto the street has no
  // reason to: the phone shows bars. src/lib/readRefresh.ts.
  useRecoverRead('assignedPrograms', status, reload);

  // The start dates the device remembers, under the ones this session read, on
  // the same terms as `getProgram`: a block served from the copy has to carry
  // its start date or `clientWeekLine` puts a member on week one of a block
  // they are four weeks into.
  const startsOnOut = useMemo(
    () => (cached && mayServeCached(live, cached.found) ? { ...cached.startsOn, ...startsOn } : startsOn),
    [cached, live, startsOn],
  );

  /**
   * How old the programme on screen is, when it is the phone's copy.
   *
   * Non-null for exactly as long as `getProgram` is serving the device's copy —
   * the same `mayServeCached` gate, so the sentence and the rows can never
   * disagree about which of them is on screen. The moment a read lands, `live`
   * turns true, this turns null, and there is nothing to label.
   *
   * The gap it closes: `programCache.ts` deliberately lets a copy stand for
   * THIRTY DAYS, and that number is only defensible if the member can see it.
   * Without a label, a block their coach replaced three weeks ago renders
   * identically to one confirmed a second ago — and the member trains the wrong
   * session with nothing on the screen to make them doubt it. That is rule 2 of
   * src/lib/readCache.ts, which this read was the one exception to.
   *
   * Computed per render rather than stored, for the reason src/ui/classes.tsx
   * gives beside the same line: the sentence says how long ago, and a stored
   * string goes on saying "4 minutes ago" for the rest of the session.
   */
  const cachedNote = cachedAtLine(cached && mayServeCached(live, cached.found) ? cached.at : null);

  /**
   * ── Why this is memoised ──────────────────────────────────────────────────
   *
   * A fresh object literal here is a new context value on EVERY render of this
   * provider, and React re-renders every consumer of a context whose value is
   * not identical. This provider sits high in all three apps' trees, so a
   * render caused by anything above it — a theme change, a navigation, the
   * parent's own state — fanned out to every screen reading `useAssignedPrograms`
   * even though not one byte of what they read had changed.
   *
   * A memo is only worth the line if everything in it is stable, which is why
   * the four write functions above read `uid`, `programs` and `startsOn`
   * through refs: had they closed over those as values, the value would still
   * have been rebuilt on every assignment and the memo would have bought
   * nothing. What is left in the dependency list is exactly the set a consumer
   * would want to re-render for.
   */
  const value = useMemo<AssignedProgramsValue>(() => ({
    programs, getProgram, status, startsOn: startsOnOut, cachedNote,
    assignProgram, assignProgramTo, clearProgram, clearProgramFrom, reload,
  }), [
    programs, getProgram, status, startsOnOut, cachedNote,
    assignProgram, assignProgramTo, clearProgram, clearProgramFrom, reload,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssignedPrograms(): AssignedProgramsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssignedPrograms must be used inside <AssignedProgramsProvider>');
  return v;
}
