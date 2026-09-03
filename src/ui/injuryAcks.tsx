// Which of a coach's clients' injuries that coach has read.
//
// One row per (trainer, client), holding the disclosures the acknowledgement
// was made against — see src/lib/injuryGate.ts for why it stores the list
// rather than a timestamp.
//
// The status is exposed for the same reason every other provider here exposes
// one: an empty acknowledgement list means "not acknowledged" and "could not
// read" equally, and the guard has to refuse both rather than let a programme
// be built on the difference.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { worstStatus, type LoadStatus } from './loadStatus';
import { injuryKey } from '../lib/injuryGate';
import type { Injury } from '../lib/injuries';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';
import { sendPush } from './pushNotifications';

interface Value {
  status: LoadStatus;
  /** Read the acknowledgements again.
   *
   *  The effect below runs on `authRev` and on nothing else, so a read that
   *  failed once stayed failed for the life of the session — and what it gates
   *  is the coach's Assign button, which then reads "Injuries Could Not Be
   *  Read" with no way out of it but to quit the app. A refusal a coach cannot
   *  retry is a dead end, and this guard is meant to be a wall they can get
   *  past by doing the right thing rather than one they have to leave the
   *  screen to escape. */
  refresh: () => Promise<void>;
  /** The keys acknowledged for a client, or null if this coach has never
   *  acknowledged anything for them. Null and [] are different answers. */
  acknowledged: (clientId: string) => string[] | null;
  /** Record that the coach has read exactly these disclosures. Returns false
   *  if the write did not land, so a caller never reports a confirmation the
   *  server does not hold. */
  acknowledge: (clientId: string, injuries: Injury[]) => Promise<boolean>;
}

const Ctx = createContext<Value | null>(null);

export function InjuryAcksProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<LoadStatus>('loading');
  const authRev = useAuthRevision();

  // Split out of the effect so a screen can run it again. See `refresh`.
  const hydrate = useCallback(async (alive: () => boolean = () => true) => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { if (alive()) { setRows({}); setStatus('ready'); } return; }
      const { data, error } = await supabase
        .from('injury_acknowledgements')
        .select('client_id, acknowledged_injuries')
        .eq('trainer_id', uid)
        .limit(capLimit());
      if (!alive()) return;
      if (error) { reportError('injuryAcks.read', error); setRows({}); setStatus('error'); return; }
      const next: Record<string, string[]> = {};
      for (const r of data ?? []) {
        next[(r as any).client_id] = Array.isArray((r as any).acknowledged_injuries) ? (r as any).acknowledged_injuries : [];
      }
      setRows(next);
      setStatus('ready');
    } catch (e) { if (alive()) { reportError('injuryAcks.read', e); setStatus('error'); } }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hydrate(() => !cancelled);
    return () => { cancelled = true; };
  }, [authRev, hydrate]);

  const refresh = useCallback(() => hydrate(), [hydrate]);

  const acknowledge = useCallback(async (clientId: string, injuries: Injury[]) => {
    const keys = [...new Set(injuries.map(injuryKey))].sort();
    if (!USE_SUPABASE) { setRows((r) => ({ ...r, [clientId]: keys })); return true; }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return false;
      // Counted, not merely un-errored. A row the policy filtered out is not an
      // error in PostgREST, and this is the write a coach is told opened the
      // gate — reporting a confirmation the server does not hold is the one
      // failure this provider must not have.
      const { data, error } = await supabase.from('injury_acknowledgements').upsert({
        trainer_id: uid,
        client_id: clientId,
        acknowledged_injuries: keys,
        acknowledged_at: new Date().toISOString(),
      }, { onConflict: 'trainer_id,client_id' }).select('client_id');
      if (error) { reportError('injuryAcks.write', error); return false; }
      if (!data || !data.length) {
        reportError('injuryAcks.write', new Error('acknowledgement upsert returned no row'));
        return false;
      }
      // Only after the write landed. Local state that runs ahead of the server
      // is how a coach ends up believing they confirmed something nobody
      // recorded.
      setRows((r) => ({ ...r, [clientId]: keys }));
      // Tell them it landed. Somebody who discloses an injury has otherwise no
      // way of knowing their coach ever saw it — and this feature spent its
      // whole life until now writing disclosures nobody could read, which is
      // exactly the silence that hid it. The row itself is already readable by
      // the client (injury_ack_client_read), so their app can show it whether
      // or not this push is delivered; this is the nudge, not the record.
      // no-error-ok: the acknowledgement is written and readable by them either way; a lost push costs a notification, not the fact
      void sendPush([clientId], 'Your coach has read your injuries',
        'They have seen what you disclosed, and cannot assign you a programme until they have.',
        { route: '/(client)/injuries' });
      return true;
    } catch (e) { reportError('injuryAcks.write', e); return false; }
  }, []);

  const acknowledged = useCallback((clientId: string) => rows[clientId] ?? null, [rows]);
  const value = useMemo(() => ({ status, refresh, acknowledged, acknowledge }), [status, refresh, acknowledged, acknowledge]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInjuryAcks(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInjuryAcks must be used inside <InjuryAcksProvider>');
  return v;
}

/* ── the same two facts, read from the client's side ─────────────────────── */
//
// Both tables have always been readable by the client they are about — the
// policies are `injury_ack_client_read` and `program_inj_ack_client_r`, written
// deliberately, with a comment in part 96 saying somebody who disclosed a knee
// is entitled to see that their coach included leg press knowing about it.
// Nothing ever read them. So the client disclosed an injury into what looked,
// from their side, exactly like a form that went nowhere: no sign their coach
// had seen it, and no sign of what they did about it.
//
// This is a hook rather than a provider because one screen wants it and it is
// two small reads. It is deliberately NOT part of InjuryAcksProvider above —
// that one is the coach's own roster of acknowledgements and is mounted for the
// whole app.

/** What this client's coach has confirmed reading, most recent coach first. */
export interface CoachRead {
  /** ISO. Null only if the column came back empty, which it cannot. */
  at: string | null;
  /** The disclosures the confirmation was made against — feed to `ackState`. */
  keys: string[];
}

/** One programme the coach assigned that loaded something disclosed. */
export interface ProgrammeChoice {
  at: string;
  movements: { exercise: string; area: string; severity: string }[];
}

export interface MyInjuryAcks {
  /** The worse of the two reads, for a caller that wants one figure — a
   *  pull-to-refresh spinner, say. NOT for the sentences: the two reads fail
   *  independently and folding them made a screen disclaim the one that
   *  worked. Gate each sentence on the status of the read behind it. */
  status: LoadStatus;
  /** How the read of `read` went, on its own. */
  readStatus: LoadStatus;
  /** How the read of `choices` went, on its own. */
  choicesStatus: LoadStatus;
  read: CoachRead | null;
  choices: ProgrammeChoice[];
  /**
   * Ask both reads again.
   *
   * A real re-read of `injury_acknowledgements` and
   * `program_injury_acknowledgements`, not a state reset: the status goes back
   * through whatever the server says this time. Whether a coach has read a
   * disclosure is the sort of fact a client refreshes a screen to find out, and
   * until this there was no way to ask twice.
   */
  reload: () => void;
}

export function useMyInjuryAcks(): MyInjuryAcks {
  const [state, setState] = useState<Omit<MyInjuryAcks, 'reload'>>({
    status: USE_SUPABASE ? 'loading' : 'ready',
    readStatus: USE_SUPABASE ? 'loading' : 'ready',
    choicesStatus: USE_SUPABASE ? 'loading' : 'ready',
    read: null, choices: [],
  });
  const authRev = useAuthRevision();
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((n) => n + 1), []);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // getSession, not getUser: getUser REJECTS with nobody signed in, and
        // treating that as a failure would latch this into 'error' before
        // anybody had logged in. No session is a true answer.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        const uid = sess?.session?.user?.id;
        if (!uid) { setState({ status: 'ready', readStatus: 'ready', choicesStatus: 'ready', read: null, choices: [] }); return; }

        const [ackRes, progRes] = await Promise.all([
          supabase.from('injury_acknowledgements')
            .select('acknowledged_at, acknowledged_injuries')
            .eq('client_id', uid)
            .order('acknowledged_at', { ascending: false })
            .limit(capLimit()),
          supabase.from('program_injury_acknowledgements')
            .select('acknowledged_at, movements')
            .eq('client_id', uid)
            .order('acknowledged_at', { ascending: false })
            .limit(capLimit()),
        ]);
        if (cancelled) return;

        // Reported separately AND kept separate. These are two tables, two
        // policies and two failures: whether a coach has confirmed reading a
        // disclosure, and what they then assigned over it. Folded into one
        // status they became one sentence, and a client whose acknowledgement
        // read came back perfectly was told "we couldn't check whether your
        // coach has read these" because the OTHER read had failed — while the
        // block that had actually failed drew as an empty result and said
        // nothing. Each fact now carries how its own read went.
        if (ackRes.error) reportError('injuryAcks.mine.read', ackRes.error);
        if (progRes.error) reportError('injuryAcks.mine.choices', progRes.error);

        const ackRows = capped(ackRes.data ?? []);
        const progRows = capped(progRes.data ?? []);
        const readStatus: LoadStatus =
          ackRes.error ? 'error' : ackRows.truncated ? 'partial' : 'ready';
        const choicesStatus: LoadStatus =
          progRes.error ? 'error' : progRows.truncated ? 'partial' : 'ready';
        const status = worstStatus(readStatus, choicesStatus);

        // The most recent coach's, not a merge of every coach who ever had
        // them. Merging would let a previous coach's confirmation cover a
        // disclosure the current one has never been shown.
        const top = ackRows.rows[0] as any | undefined;
        const read: CoachRead | null = top
          ? {
              at: typeof top.acknowledged_at === 'string' ? top.acknowledged_at : null,
              keys: Array.isArray(top.acknowledged_injuries) ? top.acknowledged_injuries : [],
            }
          : null;

        const choices: ProgrammeChoice[] = progRows.rows
          .map((r: any) => ({
            at: typeof r.acknowledged_at === 'string' ? r.acknowledged_at : '',
            movements: Array.isArray(r.movements) ? r.movements : [],
          }))
          .filter((c) => c.at && c.movements.length);

        setState({
          status, readStatus, choicesStatus,
          read: ackRes.error ? null : read,
          choices: progRes.error ? [] : choices,
        });
      } catch (e) {
        if (cancelled) return;
        reportError('injuryAcks.mine', e);
        // The throw is around both awaits, so neither fact is known here.
        setState({ status: 'error', readStatus: 'error', choicesStatus: 'error', read: null, choices: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [authRev, readTick]);

  return { ...state, reload };
}
