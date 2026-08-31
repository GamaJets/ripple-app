// Reading and writing one client's intake, from both sides of it.
//
// Two hooks and an ask, because there are exactly three things anybody does
// with this document: the client fills it in, their coach reads it, and their
// coach asks them to finish it. Nothing here merges the first two — the write
// path exists only in `useMyIntake`, which never takes a client id, so there is
// no call anywhere in this codebase through which a coach could write an
// intake even if the database were to stop refusing them.
//
// It is a hook rather than a provider because two screens want it and it is one
// column on one row. See src/ui/clientData.tsx for the provider that owns the
// rest of that row; this deliberately does not live inside it, because that
// provider is mounted for the whole client app and pushes its whole state back
// to the server on a debounce — an intake riding along in that blob would be
// re-sent on every unrelated profile edit, and a save the client never made is
// exactly what a disclosure must not have.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { sendPushChecked } from './pushNotifications';
import {
  INTAKE_VERSION, askIntakeMessage, intakeOwnership, intakeProgress, intakeState,
  parseIntake, type Intake, type IntakeProgress, type IntakeState,
} from '../lib/intake';

/** The one column, named once. `scripts/check-schema.mjs` follows a named
 *  select list inside the file that names it, so both reads spell it out here
 *  rather than sharing a constant with a screen. */
const INTAKE_COLS = 'intake';

/* ── the client's own ───────────────────────────────────────────────────── */

export interface MyIntake {
  status: LoadStatus;
  /** Null under 'error' means UNKNOWN, never "you have not filled it in". The
   *  screen has to check `status` before it says either. */
  intake: Intake | null;
  /** Who the server says is signed in. Null until the session is read, and it
   *  is what `mayEdit` is decided on. */
  uid: string | null;
  mayEdit: boolean;
  /** Why not, when not. Rendered rather than swallowed. */
  cannotEditBecause: string | null;
  /** True when the last save was refused or could not be sent. The answers are
   *  on screen and are not on the server. */
  saveFailed: boolean;
  /** Resolves true only once the row is on the server. A caller must not tell
   *  somebody their answers are saved on anything less. */
  save: (next: Intake) => Promise<boolean>;
}

export function useMyIntake(): MyIntake {
  const [intake, setIntake] = useState<Intake | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const authRev = useAuthRevision();

  useEffect(() => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        // getSession, not getUser: getUser REJECTS with nobody signed in, and
        // treating that as a failure would latch this into 'error' before
        // anybody had logged in. No session is a true answer.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        const u = sess?.session?.user?.id ?? null;
        setUid(u);
        if (!u) { setIntake(null); setStatus('ready'); return; }

        const { data, error } = await supabase
          .from('clients')
          .select(INTAKE_COLS)
          .eq('id', u)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // Null under 'error', so nothing downstream can read this as an
          // empty form. Somebody who filled this in a fortnight ago being
          // shown a blank one and filling it in again is how a disclosure gets
          // quietly replaced by a shorter one.
          reportError('intake.mine.read', error);
          setIntake(null); setStatus('error'); return;
        }
        setIntake(parseIntake((data as { intake?: unknown } | null)?.intake ?? null));
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        reportError('intake.mine.read', e);
        setIntake(null); setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const save = useCallback(async (next: Intake): Promise<boolean> => {
    // The same rule the database holds, asked before the request rather than
    // after it. Nothing in this app can reach here with a mismatch — `save`
    // takes no id and writes to `uid` — but the check is what makes that a
    // property of the code rather than of how it happens to be called today.
    const own = intakeOwnership(uid, uid);
    if (!own.mayEdit) { setSaveFailed(true); return false; }
    const doc: Intake = { ...next, version: INTAKE_VERSION, updatedAt: new Date().toISOString() };

    if (!USE_SUPABASE) { setIntake(doc); setSaveFailed(false); return true; }
    if (!uid) { setSaveFailed(true); return false; }
    try {
      const { data, error } = await supabase
        .from('clients')
        .update({ intake: doc })
        .eq('id', uid)
        .select('id');
      if (error) {
        reportError('intake.mine.write', error, { code: (error as { code?: string }).code });
        setSaveFailed(true);
        return false;
      }
      // Counted, not merely un-errored. A row the policy filtered out is not an
      // error in PostgREST, and telling somebody their readiness answers are
      // stored when nothing was written is the one failure this hook must not
      // have — their coach reads this before deciding what to put them under.
      if (!data || !data.length) {
        reportError('intake.mine.write', new Error('intake update matched no row'));
        setSaveFailed(true);
        return false;
      }
      // Only after the write landed.
      setIntake(doc);
      setSaveFailed(false);
      return true;
    } catch (e) {
      reportError('intake.mine.write', e);
      setSaveFailed(true);
      return false;
    }
  }, [uid]);

  const own = intakeOwnership(uid, uid);
  return {
    status, intake, uid,
    mayEdit: own.mayEdit,
    cannotEditBecause: own.reason,
    saveFailed,
    save,
  };
}

/* ── and what their coach sees ──────────────────────────────────────────── */

export interface ClientIntake {
  status: LoadStatus;
  intake: Intake | null;
  progress: IntakeProgress;
  /** The four answers a coach's screen is allowed to give, one of which is
   *  "we could not find out". */
  state: IntakeState;
}

/**
 * One client's intake, read as their coach.
 *
 * There is no write here and there is not going to be. `clients_trainer_read`
 * is what lets this read succeed and `clients_intake_guard` is what refuses the
 * write; a coach attempting one is answered with 42501 by the database, so the
 * absence of a writer in this file is a convenience rather than the protection.
 *
 * Returns 'ready' with a null intake only when the read genuinely landed on a
 * client who has not started. Every other empty answer is 'error', and
 * `intakeState` turns that into 'unknown' rather than into an accusation.
 */
export function useClientIntake(clientId: string | null | undefined): ClientIntake {
  const [intake, setIntake] = useState<Intake | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) { setStatus('ready'); setIntake(null); return; }
    // No client named is not a failed read. It is a screen that asked nothing,
    // and the caller says so in its own words — see `unasked` on the client
    // screen. 'loading' rather than 'ready' so nothing prints "they have not
    // filled it in" about a person nobody named.
    if (!clientId) { setIntake(null); setStatus('loading'); return; }
    let live = true;
    setIntake(null); setStatus('loading');
    (async () => {
      try {
        const { data, error } = await supabase
          .from('clients')
          .select(INTAKE_COLS)
          .eq('id', clientId)
          .maybeSingle();
        if (!live) return;
        if (error) {
          reportError('intake.client.read', error, { clientId });
          setIntake(null); setStatus('error'); return;
        }
        setIntake(parseIntake((data as { intake?: unknown } | null)?.intake ?? null));
        setStatus('ready');
      } catch (e) {
        if (!live) return;
        reportError('intake.client.read', e, { clientId });
        setIntake(null); setStatus('error');
      }
    })();
    return () => { live = false; };
  }, [clientId]);

  const progress = intakeProgress(status === 'ready' ? intake : null);
  return { status, intake, progress, state: intakeState(status, intake) };
}

/* ── asking them to finish it ───────────────────────────────────────────── */

export interface AskIntakeResult {
  /** The message reached their thread. Nothing else here matters if this is
   *  false. */
  sent: boolean;
  /** They were notified. False with `sent` true means it is waiting to be
   *  seen. */
  pushed: boolean;
  error?: string;
}

/**
 * Ask a client to fill in or finish their intake.
 *
 * Written the same way as `askToRecordInjury` in src/ui/injuryAsk.ts, and for
 * the same reason: the coach cannot fill this in, so the only thing they can do
 * about an empty one is ask. Two writes, reported separately — the message is
 * the durable half and sits in the thread whether or not a push is delivered.
 *
 * Refuses outright on 'unknown' and 'complete'. Chasing somebody over a read
 * that failed is a message a coach cannot take back.
 */
export async function askToCompleteIntake(
  clientId: string,
  state: IntakeState,
  progress: IntakeProgress,
): Promise<AskIntakeResult> {
  if (!clientId) return { sent: false, pushed: false, error: 'No client to ask.' };
  if (state !== 'none' && state !== 'started') {
    return { sent: false, pushed: false, error: 'There is nothing to ask them for.' };
  }
  const body = askIntakeMessage(state, progress);

  try {
    // `sender: 'coach'` is not decoration: the policy checks it, and a row
    // claiming to be from the other side is refused outright. Rows are counted
    // rather than trusted, because an insert the policy filters out is not an
    // error in PostgREST.
    const { data, error } = await supabase
      .from('messages')
      .insert({ client_id: clientId, sender: 'coach', body })
      .select('id');
    if (error) {
      reportError('intakeAsk.send', error, { clientId });
      return { sent: false, pushed: false, error: error.message };
    }
    if (!data || !data.length) {
      return { sent: false, pushed: false, error: 'The message was not accepted — check they are still on your roster.' };
    }
  } catch (e: any) {
    reportError('intakeAsk.send', e, { clientId });
    return { sent: false, pushed: false, error: e?.message || 'Could not reach the server.' };
  }

  const push = await sendPushChecked(
    [clientId],
    'Your coach asked for your intake',
    state === 'started'
      ? 'A few parts of your intake form are still blank.'
      : 'They need your intake form before your first session.',
    { route: '/(client)/intake' },
  );
  return { sent: true, pushed: push.ok };
}
