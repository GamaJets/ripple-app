// The one read and the writes for `assessments` (part 3280). The coach's screen
// and the client's screen both call `useAssessments` for the same client id, so
// both apps draw the same rows. RLS decides what each may do: the client's
// writes are refused by the server, and the client screen offers none.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { writeFailure } from '../lib/wroteRows';
import { readAssessments, type Assessment, type RecordRow } from '../lib/assessments';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

/** Null on success, or the sentence to show. */
export type WriteOutcome = string | null;

export function useAssessments(clientId: string | null) {
  const rev = useAuthRevision();
  const [list, setList] = useState<Assessment[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  // The client the current answer is about. A late answer for somebody else
  // is dropped rather than drawn under this client's name.
  const forId = useRef(clientId);
  forId.current = clientId;

  const reload = useCallback(async () => {
    const id = clientId;
    if (!USE_SUPABASE || !id) { setList([]); setStatus(USE_SUPABASE ? 'loading' : 'ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('assessments')
        .select('id, client_id, coach_id, kind, test_key, recorded_at, results, total, unit, notes')
        .eq('client_id', id)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(capLimit());
      if (forId.current !== id) return;
      if (error) { reportError('assessments.load', error); setStatus('error'); return; }
      const page = capped(data as any[] | null);
      setList(readAssessments(page.rows));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      if (forId.current !== id) return;
      reportError('assessments.load', e);
      setStatus('error');
    }
  }, [clientId]);

  useEffect(() => { setList([]); void reload(); }, [reload, rev]);

  /** Save one test. Resolves null once the row is stored, else what to say. */
  const record = useCallback(async (row: RecordRow, notes: string): Promise<WriteOutcome> => {
    if (!USE_SUPABASE || !clientId) return 'This test could not be saved without an account.';
    const n = notes.trim();
    try {
      const r = await supabase
        .from('assessments')
        .insert({ client_id: clientId, ...row, notes: n || null }, { count: 'exact' });
      const why = writeFailure('This test', r);
      if (why) { if (r.error) reportError('assessments.record', r.error); return why; }
      await reload();
      return null;
    } catch (e) {
      reportError('assessments.record', e);
      return 'This test could not be saved.';
    }
  }, [clientId, reload]);

  /** Delete one of the coach's own tests. */
  const remove = useCallback(async (id: string): Promise<WriteOutcome> => {
    try {
      const r = await supabase.from('assessments').delete({ count: 'exact' }).eq('id', id);
      const why = writeFailure('That test', r);
      if (why) { if (r.error) reportError('assessments.remove', r.error); return why; }
      await reload();
      return null;
    } catch (e) {
      reportError('assessments.remove', e);
      return 'That test could not be deleted.';
    }
  }, [reload]);

  return { list, status, reload, record, remove };
}
