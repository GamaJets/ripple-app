// The member's own changes to their plan: kept on the phone, and sent to the
// coach.
//
// Four `useState`s on app/(client)/workouts.tsx held every change a member can
// make to the program they were given, and nothing wrote any of them
// anywhere. src/lib/planEdits.ts says at length what that cost. This is the
// half that does I/O.
//
// ── The shape it presents ──────────────────────────────────────────────────
//
// Four values and four ordinary React setters, so the screen's existing call
// sites — `setSwaps({ ...swaps, [uid]: alt })`, `setRemovedEx((prev) => …)` —
// go on working unchanged. Each write goes to the device immediately and to the
// server behind it.
//
// ── Two rules it must not break ────────────────────────────────────────────
//
// 1. NOTHING IS WRITTEN BEFORE THE READ HAS RUN. The first render holds four
//    empty values, and persisting those would serialise an empty plan straight
//    over a member's corrections — the same defect the workout draft on that
//    screen already had to be fixed for ("it wipes out as u go back").
//
// 2. A CACHE THAT COULD NOT BE READ IS NOT AN EMPTY CACHE. Bytes that will not
//    parse are not "no changes"; `readPlanEdits` keeps the two apart and this
//    hook latches writing OFF when it happens, so a single bad parse cannot
//    turn into a permanent loss on the next tap.
//
// ── 3. AND NONE OF IT IS THE NEXT ACCOUNT'S ────────────────────────────────
//
// The key was unqualified and the read had `[]` dependencies, and the Train tab
// is a tab — `expo-router` keeps tab screens mounted — so both the stored blob
// and the four values in this hook crossed a sign-out into the next member's
// session. The device half showed them somebody else's swaps; the server half
// wrote those swaps into THEIR row, because `push` upserts on a `clientId` that
// had already become theirs. src/lib/planEdits.ts sets that out in full.
//
// So the key carries the account, the read is keyed ON the key, and what is in
// memory is dropped when the account goes. The unqualified key is removed
// unread.
//
// ── And what `shared` means ────────────────────────────────────────────────
//
// `true` the coach's console can see these · `false` they are on this phone
// only · `null` we have not established either way yet. It is never guessed:
// the sentence a member reads about whether their coach knows is the whole
// point of sending them at all, and a screen that says "shared" off an
// unanswered write is telling somebody their coach has seen a swap they have
// not.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import {
  PLAN_EDITS_KEY, planEditsKey, planEditsStepFor, readPlanEdits, writePlanEdits,
  EMPTY_PLAN_EDITS, isEmptyEdits, type PlanEdits,
} from '../lib/planEdits';
import type { ProgramExercise } from '../lib/programs';

type Setter<T> = (next: T | ((prev: T) => T)) => void;

export interface PlanEditsValue {
  swaps: PlanEdits['swaps'];
  setSwaps: Setter<PlanEdits['swaps']>;
  exEdits: PlanEdits['exEdits'];
  setExEdits: Setter<PlanEdits['exEdits']>;
  removedEx: string[];
  setRemovedEx: Setter<string[]>;
  customEx: ProgramExercise[];
  setCustomEx: Setter<ProgramExercise[]>;
  /** Everything, for the count and the sentence. */
  edits: PlanEdits;
  /** Whether the coach's console can see them. Null until we know. */
  shared: boolean | null;
  /** True once the stored edits have been read, so a screen can hold off
   *  drawing "you have changed nothing" over a read still in flight. */
  loaded: boolean;
}

export function usePlanEdits(clientId: string | null | undefined): PlanEditsValue {
  const [swaps, setSwapsState] = useState<PlanEdits['swaps']>({});
  const [exEdits, setExEditsState] = useState<PlanEdits['exEdits']>({});
  const [removedEx, setRemovedExState] = useState<string[]>([]);
  const [customEx, setCustomExState] = useState<ProgramExercise[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shared, setShared] = useState<boolean | null>(null);

  // Off once the device's copy could not be read. See rule 2 in the header.
  const cacheable = useRef(true);
  // What is on screen right now, for the async write path. A functional updater
  // is deliberately not used to assemble this: React double-invokes updaters in
  // development, so a network call placed inside one fires twice — the shape
  // this codebase has twice had to unpick.
  const latest = useRef<PlanEdits>(EMPTY_PLAN_EDITS);

  /**
   * Where this member's edits live, and who the four values above belong to.
   *
   * `clientId` IS the account: app/(client)/workouts.tsx is the only caller and
   * passes `cd.id`, which src/ui/clientData.tsx defines as `sbUid ?? 'unknown'`
   * — the signed-in uid, or the literal this file has always refused to push
   * under. It is the same id the server row is keyed by, which is the point: a
   * device copy under one account and a row under another is exactly the state
   * this hook must not be able to reach.
   */
  const editsKey = planEditsKey(clientId);
  /** The account the four values above belong to. A ref: it is written from
   *  inside the effect that reads it and must not schedule a render. */
  const editsFor = useRef<string | null>(null);
  /** `loaded` again, readable inside the effect without being a dependency of
   *  it. The two are set together and never apart. */
  const armed = useRef(false);

  const forget = useCallback(() => {
    latest.current = EMPTY_PLAN_EDITS;
    setSwapsState({});
    setExEditsState({});
    setRemovedExState([]);
    setCustomExState([]);
    // Nothing is known about the next member's sharing either, and `false`
    // would be a claim. See the header.
    setShared(null);
  }, []);

  useEffect(() => {
    const step = planEditsStepFor({
      uid: clientId, onScreenKey: editsFor.current, onScreenSaved: armed.current,
    });
    // Both flags cleared BEFORE the read and before anything else — never left
    // at whatever the LAST key's read set them to. A `loaded` that survived the
    // key changing would let an account switch whose read then failed write
    // this member's empty plan straight over the other member's stored
    // corrections; a `cacheable` that survived it would carry one member's
    // parse failure into the next member's session as a permanent refusal to
    // save. src/ui/exerciseVideos.ts carries the same note.
    armed.current = false;
    cacheable.current = true;
    setLoaded(false);
    // No account and nothing of this account's on the device: hold. A null
    // session is not a sign-out — src/ui/clientData.tsx says at length why —
    // and corrections a member typed at the rack while a read was failing are
    // the one copy of those corrections.
    if (step.do === 'hold') return;
    // The account is gone and the device has a copy under its own key. Take the
    // four values off the screen: this hook is held by a TAB, which stays
    // mounted, so without this the next member trains against the last one's
    // swaps and the first tap sends them up under the next member's id.
    if (step.do === 'forget') { editsFor.current = null; forget(); return; }
    // A different member. Cleared on the way IN, before the read lands, so a
    // read that is slow, that fails or that is refused cannot leave one
    // member's corrections standing under another's name.
    if (step.forget) forget();
    editsFor.current = step.key;
    let live = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(step.key);
        if (!live) return;
        const r = readPlanEdits(raw);
        if (!r.read) cacheable.current = false;
        latest.current = r.edits;
        setSwapsState(r.edits.swaps);
        setExEditsState(r.edits.exEdits);
        setRemovedExState(r.edits.removed);
        setCustomExState(r.edits.custom);
      } catch {
        // Learning nothing is not learning that there is nothing. The latch
        // stops the next tap writing an empty plan over whatever is on disk.
        cacheable.current = false;
      } finally { if (live) { armed.current = true; setLoaded(true); } }
    })();
    return () => { live = false; };
    // `clientId` as well as the key it composes to: null and the 'unknown'
    // literal are two different non-accounts that share the single key `null`,
    // and the step is what must see the difference in what is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editsKey, clientId, forget]);

  // The unqualified key this replaces, removed rather than migrated and never
  // parsed on the way out. The blob names no member, so reading it into
  // whoever is signed in is a guess — and its wrong answer is one person's
  // swaps and corrected loads filed as another's, on the device and then, at
  // the first tap, on the server. See the header of src/lib/planEdits.ts.
  useEffect(() => { AsyncStorage.removeItem(PLAN_EDITS_KEY).catch(() => {}); }, []);

  /** Send the whole set up. Best effort, and its answer is reported rather than
   *  swallowed: `shared` is what the member reads. */
  const push = useCallback(async (next: PlanEdits) => {
    if (!USE_SUPABASE || !clientId || clientId === 'unknown') { setShared(false); return; }
    try {
      const { data, error } = await supabase
        .from('client_plan_edits')
        .upsert({ client_id: clientId, edits: writePlanEdits(next), updated_at: new Date().toISOString() }, { onConflict: 'client_id' })
        .select('client_id');
      // Row count, not just `error`. A write PostgREST narrows to zero rows
      // under RLS succeeds having done nothing, and reporting that as shared is
      // the exact failure this hook's `shared` flag exists to prevent.
      if (error || !data || !data.length) { reportError('planEdits.push', error); setShared(false); return; }
      setShared(true);
    } catch (e) { reportError('planEdits.push', e); setShared(false); }
  }, [clientId]);

  const persist = useCallback((next: PlanEdits) => {
    latest.current = next;
    if (!loaded) return;                       // rule 1
    // No key is no account, and no account is no write — not to a shared key,
    // which is rule 3.
    if (editsKey && cacheable.current) {
      AsyncStorage.setItem(editsKey, writePlanEdits(next))
        .catch(() => { /* the session is correct this run either way */ });
    }
    // An empty set is still sent: clearing every swap is a change the coach
    // needs to see as much as making one, and a member who put a movement back
    // must not leave a stale swap standing on the console.
    void push(next);
  }, [loaded, push, editsKey]);

  const apply = <K extends keyof PlanEdits>(key: K, value: PlanEdits[K]) => {
    persist({ ...latest.current, [key]: value });
  };
  const resolve = <T,>(next: T | ((prev: T) => T), prev: T): T =>
    (typeof next === 'function' ? (next as (p: T) => T)(prev) : next);

  const setSwaps: Setter<PlanEdits['swaps']> = (next) => {
    const v = resolve(next, latest.current.swaps); setSwapsState(v); apply('swaps', v);
  };
  const setExEdits: Setter<PlanEdits['exEdits']> = (next) => {
    const v = resolve(next, latest.current.exEdits); setExEditsState(v); apply('exEdits', v);
  };
  const setRemovedEx: Setter<string[]> = (next) => {
    const v = resolve(next, latest.current.removed); setRemovedExState(v); apply('removed', v);
  };
  const setCustomEx: Setter<ProgramExercise[]> = (next) => {
    const v = resolve(next, latest.current.custom); setCustomExState(v); apply('custom', v);
  };

  const edits: PlanEdits = { swaps, exEdits, removed: removedEx, custom: customEx };
  return {
    swaps, setSwaps, exEdits, setExEdits, removedEx, setRemovedEx, customEx, setCustomEx,
    edits,
    // Nothing to share is not a failure to share, so an untouched plan reports
    // null rather than false and the sentence about the coach is not drawn.
    shared: isEmptyEdits(edits) ? null : shared,
    loaded,
  };
}
