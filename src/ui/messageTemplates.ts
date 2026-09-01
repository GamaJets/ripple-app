// Reading and writing `coach_message_templates` — the coach's own saved
// messages.
//
// The rules are in src/lib/messageTemplates.ts and are under test; this half
// touches supabase and so is deliberately not.
//
// ── The shape of every answer ─────────────────────────────────────────────
//
// `{ rows, status }`, never a bare array, for the reason src/ui/loadStatus.ts
// sets out: supabase-js RESOLVES on a database error, so `const { data } = …;
// return data ?? []` turns a refusal into a confident "you have none". On this
// table that would put a coach in front of an empty library and an offer of six
// starters — and they would accept it, and end up with two Welcome templates
// with different wording in a list they pick from at speed.
//
// ── Writes report ─────────────────────────────────────────────────────────
//
// Every write returns what actually happened rather than a promise the caller
// may ignore. A template editor that cannot say "not saved" will say "saved",
// and the coach finds out when they open the picker in front of a client.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { useCallback, useEffect, useState } from 'react';
import type { LoadStatus } from './loadStatus';
import { orderTemplates, type MessageTemplate } from '../lib/messageTemplates';

export interface TemplatesRead {
  rows: MessageTemplate[];
  status: LoadStatus;
}

const toTemplate = (r: any): MessageTemplate => ({
  id: String(r.id),
  title: String(r.title ?? '').trim(),
  body: String(r.body ?? ''),
  // `position` is an integer column, but PostgREST hands numerics back as
  // strings often enough to matter and a NaN here would sort the row to
  // wherever the comparator happened to put it.
  position: Number.isFinite(Number(r.position)) ? Number(r.position) : 0,
});

/** This coach's templates, in picker order. */
export async function fetchMyTemplates(): Promise<TemplatesRead> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { rows: [], status: 'ready' };
    const { data, error } = await supabase
      .from('coach_message_templates')
      .select('id, title, body, position')
      .eq('coach_id', uid)
      .order('position', { ascending: true })
      .limit(capLimit());
    if (error) {
      // Includes 42P01 on a database that has not had this part applied. Both
      // that and a refusal are 'error', and 'error' draws no library at all
      // rather than an empty one with an offer of starters under it.
      reportError('messageTemplates.read', error);
      return { rows: [], status: 'error' };
    }
    const page = capped(data ?? []);
    return { rows: orderTemplates(page.rows.map(toTemplate)), status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('messageTemplates.read', e);
    return { rows: [], status: 'error' };
  }
}

export type SaveResult =
  | { ok: true; template: MessageTemplate }
  | { ok: false; error: string };

/**
 * Create or update one template.
 *
 * `.select()` on the write, so the row that comes back is the DATABASE's and
 * not the object this function assembled. PostgREST resolves an update that
 * matched no rows with `error: null` and an empty body — a coach editing a
 * template belonging to a different account would otherwise be told it saved.
 */
export async function saveTemplate(t: { id: string | null; title: string; body: string; position: number }): Promise<SaveResult> {
  if (!USE_SUPABASE) return { ok: false, error: 'Not connected to the server.' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { ok: false, error: 'You are not signed in, so nothing was saved.' };
    const payload = {
      coach_id: uid,
      title: t.title.trim(),
      body: t.body,
      position: t.position,
    };
    const q = t.id
      ? supabase.from('coach_message_templates').update(payload).eq('id', t.id).eq('coach_id', uid).select('id, title, body, position')
      : supabase.from('coach_message_templates').insert(payload).select('id, title, body, position');
    const { data, error } = await q;
    if (error) {
      reportError('messageTemplates.save', error);
      return { ok: false, error: error.message };
    }
    const rows = (data ?? []) as any[];
    if (!rows.length) {
      return { ok: false, error: 'The server accepted the request and changed nothing, so this was not saved.' };
    }
    return { ok: true, template: toTemplate(rows[0]) };
  } catch (e: any) {
    reportError('messageTemplates.save', e);
    return { ok: false, error: e?.message || 'Could not reach the server.' };
  }
}

/** Delete one. Returns whether a row actually went — `.select('id')` is what
 *  tells "deleted" from "matched nothing", which a delete cannot otherwise
 *  say. */
export async function deleteTemplate(id: string): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  try {
    const { data, error } = await supabase
      .from('coach_message_templates').delete().eq('id', id).select('id');
    if (error) { reportError('messageTemplates.delete', error); return false; }
    return !!(data && data.length);
  } catch (e) {
    reportError('messageTemplates.delete', e);
    return false;
  }
}

/** The hook. Re-reads on a sign-in change and on demand. */
export function useMyTemplates(): TemplatesRead & { reload: () => Promise<void> } {
  const rev = useAuthRevision();
  const [read, setRead] = useState<TemplatesRead>({ rows: [], status: 'loading' });
  const reload = useCallback(async () => {
    const r = await fetchMyTemplates();
    setRead(r);
  }, []);
  useEffect(() => {
    let alive = true;
    setRead({ rows: [], status: 'loading' });
    void fetchMyTemplates().then((r) => { if (alive) setRead(r); });
    return () => { alive = false; };
  }, [rev]);
  return { ...read, reload };
}
