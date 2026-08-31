// Coach · the nudge list, read once and reduced to what a screen may claim.
//
// A hook rather than a provider: one screen wants it, it is four reads, and
// nothing else in the app holds it open. src/ui/roster.tsx is the provider for
// the book itself and deliberately does not grow this — it is shared by the
// Clients tab and the Schedule's client picker, and hanging a per-client
// training read off it would make opening the schedule read fifty-six days of
// everybody's workouts.
//
// The rules live in src/lib/nudge.ts and are testable without a database. What
// is here is the part that cannot be: the reads, and what each of their failure
// modes is allowed to make the screen say.
//
// ── Every one of the four reads can lie by succeeding ─────────────────────
//
// 1. WHO HAS AN ACCOUNT. The roster merges `clients` (people with a Repple
//    login) with `coach_clients` (people the coach wrote down). Only the first
//    kind has a training record to read or a thread to write in. If this read
//    fails there is no honest list at all — every client would look
//    hand-added, and every one of them would be withheld with the wrong
//    reason.
//
// 2. THEIR ACTIVITY. `readClientActivity` throws on a refused read and reports
//    a truncated one. Both are 'error'/'partial' here and neither produces a
//    suggestion: an empty event list from a read that did not happen is
//    indistinguishable, at the point of use, from a client who has genuinely
//    stopped — and the whole cost of this feature falls on getting that one
//    distinction right.
//
// 3. WHAT THE COACH ALREADY DID. This is the never-nag read, and it is the one
//    whose silent failure is worst. `client_nudges` refused, or capped at a
//    thousand rows, comes back as "nobody has been contacted" — so a coach who
//    messaged eleven people on Monday opens this on Tuesday and is asked to
//    message the same eleven again. That is the behaviour that teaches a coach
//    to stop reading the list. So an incomplete records read suppresses the
//    ENTIRE suggestion list rather than degrading it: better a screen that says
//    it cannot tell than one that asks twice.
//
// 4. THE GYM. `tenantId` decides whether the door log is read at all. Absent,
//    the visit source is not silent — it is unread, and the evidence panel says
//    so rather than counting a client as not having been to a gym nobody
//    looked at.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { useRoster } from './roster';
import { useTenant } from './tenant';
import {
  readClientActivity, isQueryableId, DEFAULT_WINDOWS,
  type ActivityEvent, type Drift,
} from '../lib/clientDrift';
import {
  buildNudgeBoard, explainDrift, mutedDaysFor, boardNote,
  type Evidence, type NudgeBoard, type NudgeCandidate, type NudgeRecord,
} from '../lib/nudge';

/**
 * How far back the record of what the coach did is read.
 *
 * Longer than the longest mute a coach can set (a year, by the CHECK on
 * `muted_days`) would be pointless; shorter than it would let a long mute fall
 * off the end of the page and quietly expire early. A year and a day is the
 * smallest window that cannot do that.
 */
const RECORDS_DAYS = 366;

const DAY = 86_400_000;

export type NudgeWrite = { ok: true } | { ok: false; reason: string };

export interface NudgeBook {
  /** The worst of the four reads. Nothing is suggested unless this is 'ready'. */
  status: LoadStatus;
  /** Null until every read has landed whole. Never a partially-true board. */
  board: NudgeBoard | null;
  /** The line under the heading, true in all four states. */
  note: string;
  /** What the coach has already done, newest first. */
  records: NudgeRecord[];
  /** The dates behind one client's verdict, or null when they were not
   *  assessed. */
  evidenceFor: (clientId: string) => Evidence | null;
  /** True when the gym door log was among the sources. False for an
   *  independent coach, and the evidence panel says so out loud. */
  doorLogRead: boolean;
  /** Record that the coach messaged this client, AFTER they have sent it
   *  themselves. Writes nothing to `messages` and cannot. */
  recordSent: (clientId: string, drift: Drift, observed: string) => Promise<NudgeWrite>;
  /** Record that the coach set this client aside. */
  recordDismissed: (clientId: string, drift: Drift, observed: string) => Promise<NudgeWrite>;
  /** Bring a set-aside client back. Only a dismissal can be undone — the
   *  record that somebody was messaged is the client's protection against
   *  being messaged again, and the policy refuses to delete it. */
  undismiss: (clientId: string) => Promise<NudgeWrite>;
  reload: () => Promise<void>;
}

interface Loaded {
  candidates: NudgeCandidate[];
  events: Record<string, ActivityEvent[]>;
  records: NudgeRecord[];
}

const EMPTY: Loaded = { candidates: [], events: {}, records: [] };

function rowToRecord(r: any): NudgeRecord {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    action: r.action === 'dismissed' ? 'dismissed' : 'sent',
    at: String(r.at),
    // A row whose window will not read as a number mutes nothing — `mutedBy`
    // drops it. Coercing it to a default here would invent a promise the
    // database never made.
    mutedDays: Number.isFinite(Number(r.muted_days)) ? Number(r.muted_days) : 0,
    observed: r.observed ?? null,
  };
}

export function useNudges(): NudgeBook {
  const authRev = useAuthRevision();
  const { roster, status: rosterStatus } = useRoster();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [coachId, setCoachId] = useState<string | null>(null);

  // The roster arrives from its own provider and re-renders on its own clock.
  // Keying the effect on the ids rather than on the array stops a re-render
  // that changed nothing from starting four reads again.
  const rosterKey = roster.map((c) => `${c.id}:${c.joinedAt ?? ''}`).join(',');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setLoaded(EMPTY); setStatus('ready'); return; }
    try {
      // getSession and not getUser: getUser REJECTS when nobody is signed in,
      // which would latch this into 'error' before anybody has logged in. No
      // session is a true answer, and its true board is an empty one.
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      setCoachId(uid);
      if (!uid) { setLoaded(EMPTY); setStatus('ready'); return; }

      // ── 1 · who on the book actually has a Repple account ───────────────
      //
      // Not inferred from the roster. `mergeRoster` folds `clients` and
      // `coach_clients` into one list and the merged row does not carry which
      // side it came from, and both id spaces are uuids — so `isQueryableId`
      // cannot tell them apart either. Asking `clients` directly is the only
      // answer that is about the person rather than about the shape of their id.
      const linkedRes = await supabase.from('clients')
        .select('id').eq('trainer_id', uid).limit(capLimit());
      if (linkedRes.error) throw linkedRes.error;
      const linkedPage = capped(linkedRes.data);
      const linked = new Set(linkedPage.rows.map((r: any) => String(r.id)));

      // ── 2 · what the coach has already done ────────────────────────────
      const sinceIso = new Date(Date.now() - RECORDS_DAYS * DAY).toISOString();
      const recRes = await supabase.from('client_nudges')
        .select('id, client_id, action, at, muted_days, observed')
        .eq('coach_id', uid)
        .gte('at', sinceIso)
        .order('at', { ascending: false })
        .limit(capLimit());
      if (recRes.error) throw recRes.error;
      const recPage = capped(recRes.data);
      const records = recPage.rows.map(rowToRecord);

      // ── 3 · their training record ──────────────────────────────────────
      const askable = roster.map((c) => c.id).filter((id) => linked.has(id) && isQueryableId(id));
      const act = askable.length
        ? await readClientActivity(supabase, askable, {
            days: DEFAULT_WINDOWS.historyDays, tenantId,
          })
        : { byClient: {} as Record<string, ActivityEvent[]>, notAsked: [], truncated: false };

      // A truncation anywhere makes every client's silence unprovable, not just
      // the ones whose rows were cut — the page is ordered by nothing in
      // particular, so which client lost rows is unknowable.
      const whole = !linkedPage.truncated && !recPage.truncated && !act.truncated;

      const candidates: NudgeCandidate[] = roster.map((c) => {
        if (!linked.has(c.id)) {
          return { clientId: c.id, name: c.name ?? null, activity: { read: false, why: 'no-account' } };
        }
        if (!whole) {
          return { clientId: c.id, name: c.name ?? null, activity: { read: false, why: 'read-partial' } };
        }
        return {
          clientId: c.id,
          name: c.name ?? null,
          since: c.joinedAt ?? null,
          activity: { read: true, events: act.byClient[c.id] ?? [] },
        };
      });

      setLoaded({ candidates, events: act.byClient, records });
      setStatus(whole ? 'ready' : 'partial');
    } catch (e) {
      reportError('nudges.read', e);
      // Deliberately clearing. Everything on this screen is a prompt to CONTACT
      // somebody, and a stale prompt acted on is a phone call. The list a coach
      // saw five minutes ago is not worth showing under a banner here the way a
      // training history is — see src/ui/attendance.ts, which keeps its rows for
      // the opposite reason.
      setLoaded(EMPTY);
      setStatus('error');
    }
  }, [rosterKey, tenantId]);

  useEffect(() => { void load(); }, [load, authRev]);

  // The roster's own status is folded in: a roster that could not be read is a
  // book we do not have, and every client missing from it is a client who
  // cannot be surfaced. `worstStatus` is what keeps that from being forgotten.
  const combined = worstStatus(status, rosterStatus);

  const board = useMemo(
    () => (combined === 'ready'
      ? buildNudgeBoard(loaded.candidates, loaded.records, { doorLogRead: !!tenantId })
      : null),
    [combined, loaded, tenantId],
  );

  const note = useMemo(() => {
    if (combined === 'error') {
      return 'Could not work out who has gone quiet, so nothing is suggested. This is not a quiet week — it is a failed read.';
    }
    if (combined === 'partial') {
      return 'Only part of the record came back, so no client is suggested: a gap in it looks exactly like silence.';
    }
    return boardNote(board);
  }, [combined, board]);

  const evidenceFor = useCallback((clientId: string): Evidence | null => {
    const found = board?.nudges.find((n) => n.clientId === clientId)
      ?? board?.muted.find((m) => m.clientId === clientId);
    const drift = (found as any)?.drift as Drift | null | undefined;
    if (!drift) return null;
    return explainDrift(
      { drift, events: loaded.events[clientId] ?? [], doorLogRead: !!tenantId },
    );
  }, [board, loaded.events, tenantId]);

  const write = useCallback(async (
    clientId: string,
    action: 'sent' | 'dismissed',
    drift: Drift,
    observed: string,
  ): Promise<NudgeWrite> => {
    if (!USE_SUPABASE || !coachId) {
      return { ok: false, reason: 'Not signed in, so this could not be recorded — and an unrecorded nudge is one you will be asked about again tomorrow.' };
    }
    const { data, error } = await supabase.from('client_nudges').insert({
      coach_id: coachId,
      client_id: clientId,
      action,
      muted_days: mutedDaysFor(action, drift),
      observed: observed.slice(0, 500),
      quiet_days: drift.quietDays,
    }).select('id').single();
    if (error || !data) {
      reportError('nudges.write', error);
      return {
        ok: false,
        reason: action === 'sent'
          ? 'Your message was sent, but we could not record it — so this client may be suggested again.'
          : 'That could not be recorded, so this client may be suggested again.',
      };
    }
    await load();
    return { ok: true };
  }, [coachId, load]);

  const recordSent = useCallback(
    (clientId: string, drift: Drift, observed: string) => write(clientId, 'sent', drift, observed),
    [write]);
  const recordDismissed = useCallback(
    (clientId: string, drift: Drift, observed: string) => write(clientId, 'dismissed', drift, observed),
    [write]);

  const undismiss = useCallback(async (clientId: string): Promise<NudgeWrite> => {
    if (!USE_SUPABASE || !coachId) return { ok: false, reason: 'Not signed in.' };
    // A zero-row delete is not an error in PostgREST — it resolves with an
    // empty array and no message, which is exactly what a refused policy looks
    // like. So the COUNT is checked, not the absence of an error: the delete
    // policy admits only 'dismissed' rows, and a coach reaching this for a
    // 'sent' row would otherwise be told it worked.
    const { data, error } = await supabase.from('client_nudges')
      .delete().eq('coach_id', coachId).eq('client_id', clientId).eq('action', 'dismissed')
      .select('id');
    if (error) {
      reportError('nudges.undismiss', error);
      return { ok: false, reason: 'That could not be undone.' };
    }
    if (!data || data.length === 0) {
      return { ok: false, reason: 'There was nothing set aside to bring back.' };
    }
    await load();
    return { ok: true };
  }, [coachId, load]);

  return {
    status: combined,
    board,
    note,
    records: loaded.records,
    evidenceFor,
    doorLogRead: !!tenantId,
    recordSent,
    recordDismissed,
    undismiss,
    reload: load,
  };
}
