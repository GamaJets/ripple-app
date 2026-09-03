// Reading and writing the coach's own answer to "how do you coach?".
//
// The rules half is src/lib/coachDelivery.ts, which is pure and tested without
// a device. This half is the one column: `trainers.delivery_mode`, added by
// supabase/parts/410-a-coach-is-asked-how-they-coach.sql.
//
// ── Why null is three different things, and only one of them is an answer ──
//
// `declared` is null when the coach has never been asked, when they skipped the
// question, AND while the read is in flight or has failed. Those are not the
// same, and collapsing them is how a coach with a live answer gets prompted to
// answer again — over the top of the one they already gave. So `status` travels
// with the value everywhere and `deliveryFact` refuses to treat a null as an
// answer unless the read that produced it was whole.
//
// The failure mode this shape exists to stop is the one src/ui/coachSetup.ts
// describes about its own eight reads: supabase-js RESOLVES on a database
// error, so `const { data } = await …; return data?.delivery_mode ?? null` turns
// a refused read into a confident "they have not answered". Here that would
// then be handed to `deliveryFact`, which would read it as a skip — and a skip
// is the widest answer, so nothing would visibly break. It would simply stop
// being true, quietly, for as long as the read kept failing.
//
// ── The write ─────────────────────────────────────────────────────────────
//
// `.update({ delivery_mode }).eq('id', uid)`, which is the same door
// src/ui/coachProfile.ts uses for the bio, the tagline and the session fee.
// Part 152 revoked table-wide UPDATE on `trainers` and grants it back per
// column; part 410 adds this one to that list and nothing else. There is no
// INSERT grant, deliberately: the trainer row is created at signup and this
// answer is collected afterwards.
//
// Unlike the profile writes next door this one is NOT fire-and-forget. A coach
// tapping one of three options is making a choice that reshapes their app, and
// a silently swallowed refusal would leave them looking at a setting that did
// not save. `setDelivery` awaits and answers, and the screen says which
// happened.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { VARIANT } from '../lib/variant';
import { reportError } from '../lib/reportError';
import { writeFailure } from '../lib/wroteRows';
import { useAuthRevision } from './authRevision';
import type { LoadStatus } from './loadStatus';
import { readCoachedModeOrNull, type CoachedMode } from '../lib/types';
import { deliveryFact, type DeliveryDeclaration, type DeliveryFact } from '../lib/coachDelivery';
import { useRoster } from './roster';

interface CoachDeliveryValue {
  /** The coach's own answer, or null. Null means unanswered ONLY when
   *  `status` is 'ready'; under anything else it means unread. */
  declared: DeliveryDeclaration;
  status: LoadStatus;
  /** Store an answer. Resolves true only when the server took it — the local
   *  value is not moved on a refusal, so the screen cannot show a choice that
   *  did not save. */
  setDelivery: (mode: CoachedMode) => Promise<boolean>;
  /** Ask the server again. Screens call this on focus. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<CoachDeliveryValue | null>(null);

/** Nothing read, and honest about it. Also the whole answer on the client and
 *  owner builds, which have no coach to ask. */
const UNREAD: DeliveryDeclaration = null;

export function CoachDeliveryProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [declared, setDeclared] = useState<DeliveryDeclaration>(UNREAD);
  // 'ready' with no backend: the app is running on local state and there is no
  // absent server to misreport. The same choice every provider in this folder
  // makes, and the reason src/ui/loadStatus.ts says 'ready' is a claim about
  // the server rather than about the data.
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE && VARIANT === 'trainer' ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);

  const hydrate = useCallback(async (cancelled: () => boolean = () => false) => {
    // Not issued at all off the coach app. The row this reads is the SIGNED-IN
    // user's, so on the client and owner builds there is no request whose
    // result could be mistaken for a coach's answer, because none is made —
    // the same refusal src/ui/coachProfile.ts makes physical.
    if (!USE_SUPABASE || VARIANT !== 'trainer') { setStatus('ready'); return; }
    try {
      // getSession and not getUser: getUser REJECTS with nobody signed in,
      // which would latch this provider into 'error' on the first tick, before
      // anybody had signed in, and leave it there.
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled()) return;
      const id = sess?.session?.user?.id ?? null;
      setUid(id);
      // No session is a true answer and not a failed check. There is nobody to
      // have an answer, so 'ready' with a null is exactly right.
      if (!id) { setDeclared(UNREAD); setStatus('ready'); return; }

      const { data, error } = await supabase
        .from('trainers').select('delivery_mode').eq('id', id).maybeSingle();
      if (cancelled()) return;
      // `error` first and separately from `data`. On a refusal both a null data
      // and an error are present, and reading data first is precisely how a
      // refusal becomes "they have not answered".
      if (error) {
        reportError('coachDelivery.read', error);
        setStatus('error');
        return;
      }
      // maybeSingle answers null rows for a user with no trainer row at all,
      // which is a real answer: they have not been asked. `readCoachedModeOrNull`
      // is the tolerant read that refuses to settle an unrecognised value on
      // 'online' — a coach whose column holds something this build has never
      // heard of has not declared anything we can act on, and the widest answer
      // is the safe reading of that.
      setDeclared(readCoachedModeOrNull((data as { delivery_mode?: unknown } | null)?.delivery_mode));
      setStatus('ready');
    } catch (e) {
      reportError('coachDelivery.hydrate', e);
      if (!cancelled()) setStatus('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hydrate(() => cancelled);
    return () => { cancelled = true; };
  }, [hydrate, authRev]);

  const setDelivery = useCallback(async (mode: CoachedMode): Promise<boolean> => {
    // With no backend the answer lives in this session only, which is what
    // every other provider here does and is honest: there is no server to
    // refuse it.
    if (!USE_SUPABASE) { setDeclared(mode); return true; }
    if (VARIANT !== 'trainer' || !uid) return false;
    try {
      // COUNTED, not merely un-errored — the same shape the three other writes
      // to `trainers` in this folder use (coachBrand.ts, coachLogo.ts,
      // coachProfile.tsx). PostgREST answers an UPDATE that matched NOTHING
      // with 204 and a null error, and the read above has already established
      // that a signed-in coach with no `trainers` row is a case that happens —
      // `maybeSingle` returns null rows for exactly that person and this
      // provider calls it a real answer. For them `.eq('id', uid)` matches zero
      // rows, `error` is null, and on `!error` this returned true, moved
      // `declared` and set 'ready': DeliveryModeChoice told them their choice
      // was saved, the app reshaped itself around it, and the next hydrate put
      // it back. The count is the only thing that can tell those two apart.
      const res = await supabase.from('trainers')
        .update({ delivery_mode: mode }, { count: 'exact' })
        .eq('id', uid);
      if (res.error) { reportError('coachDelivery.write', res.error); return false; }
      const why = writeFailure('How you coach', res);
      if (why) { reportError('coachDelivery.write', new Error(why)); return false; }
      // Moved only after the server took it. A local value that ran ahead of a
      // refused write is a setting the coach believes they changed.
      setDeclared(mode);
      setStatus('ready');
      return true;
    } catch (e) {
      reportError('coachDelivery.write', e);
      return false;
    }
  }, [uid]);

  const value = useMemo<CoachDeliveryValue>(
    () => ({ declared, status, setDelivery, refresh: () => hydrate() }),
    [declared, status, setDelivery, hydrate],
  );
  return createElement(Ctx.Provider, { value }, children);
}

/**
 * The signed-in coach's own answer to how they coach.
 *
 * Outside the provider it answers "unread" rather than throwing. That is
 * deliberate and it is the safe direction: an unread declaration is the widest
 * answer in src/lib/coachDelivery.ts, so a screen that finds itself outside the
 * tree shows the coach everything rather than rendering a narrowed app off a
 * value nobody supplied.
 */
export function useCoachDelivery(): CoachDeliveryValue {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    declared: UNREAD,
    status: 'loading',
    setDelivery: async () => false,
    refresh: async () => {},
  };
}

/**
 * The one fact every coach screen actually asks: does this app show the
 * in-person tools?
 *
 * Both halves in one place so no screen composes them itself. A screen that
 * reached for the declaration and forgot the roster would stop a coach's first
 * in-person client bringing the calendar back; one that reached for the roster
 * and forgot the declaration would ask a coach a question they had answered.
 * The rule that reconciles them is in src/lib/coachDelivery.ts and is tested
 * without a device.
 */
export function useDeliveryFact(): DeliveryFact {
  const { declared, status } = useCoachDelivery();
  const { roster, status: rosterStatus } = useRoster();
  return useMemo(
    () => deliveryFact({ declared, declaredStatus: status, roster, rosterStatus }),
    [declared, status, roster, rosterStatus],
  );
}
