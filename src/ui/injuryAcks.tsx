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
import { capLimit } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { injuryKey } from '../lib/injuryGate';
import type { Injury } from '../lib/injuries';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';
import { sendPush } from './pushNotifications';

interface Value {
  status: LoadStatus;
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

  useEffect(() => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) { if (!cancelled) { setRows({}); setStatus('ready'); } return; }
        const { data, error } = await supabase
          .from('injury_acknowledgements')
          .select('client_id, acknowledged_injuries')
          .eq('trainer_id', uid)
          .limit(capLimit());
        if (cancelled) return;
        if (error) { reportError('injuryAcks.read', error); setRows({}); setStatus('error'); return; }
        const next: Record<string, string[]> = {};
        for (const r of data ?? []) {
          next[(r as any).client_id] = Array.isArray((r as any).acknowledged_injuries) ? (r as any).acknowledged_injuries : [];
        }
        setRows(next);
        setStatus('ready');
      } catch (e) { if (!cancelled) { reportError('injuryAcks.read', e); setStatus('error'); } }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const acknowledge = useCallback(async (clientId: string, injuries: Injury[]) => {
    const keys = [...new Set(injuries.map(injuryKey))].sort();
    if (!USE_SUPABASE) { setRows((r) => ({ ...r, [clientId]: keys })); return true; }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return false;
      const { error } = await supabase.from('injury_acknowledgements').upsert({
        trainer_id: uid,
        client_id: clientId,
        acknowledged_injuries: keys,
        acknowledged_at: new Date().toISOString(),
      }, { onConflict: 'trainer_id,client_id' });
      if (error) { reportError('injuryAcks.write', error); return false; }
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
  const value = useMemo(() => ({ status, acknowledged, acknowledge }), [status, acknowledged, acknowledge]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInjuryAcks(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInjuryAcks must be used inside <InjuryAcksProvider>');
  return v;
}
