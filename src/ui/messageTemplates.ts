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
// Who is signed in, which of the two reasons nobody is, and the sentence each
// of those two deserves. `getUser()` resolves on a dropped connection rather
// than rejecting — see src/lib/authReadFate.ts.
import { signedInUid } from '../lib/signedInUid';
import { authGateMessage } from '../lib/authedUid';
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
    // The error beside this call was discarded, so an outage arrived as the
    // same absent uid a sign-out does (src/lib/authReadFate.ts) and took the
    // 'ready' branch. Read the note on the database error below: 'error' is
    // there precisely so the screen "draws no library at all rather than an
    // empty one with an offer of starters under it". `rows: []` under 'ready'
    // IS that empty library with the starters offer, put in front of a coach
    // who has written eleven templates, because their phone could not reach
    // the auth server for a second.
    const who = await signedInUid('messageTemplates.read');
    if (who.fate === 'signed-out') return { rows: [], status: 'ready' };
    if (who.fate !== null) return { rows: [], status: 'error' };
    const uid = who.uid;
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
    // ── the sentence, not just the branch ─────────────────────────────────
    //
    // This is the shape the asymmetry is about. "You are not signed in, so
    // nothing was saved." was returned for BOTH answers, and the discarded
    // error is what made them one: `getUser()` resolves rather than rejects
    // when the auth server cannot be reached, so a coach who was signed in the
    // whole time read a flat statement that they were not — over a template
    // they had just written — and the only action it suggests is to go and
    // re-enter a password that was never the problem.
    //
    // `authGateMessage` says the true one for each fate, and its 'unreadable'
    // sentence carries the clause this call site earns: nothing has been
    // changed. The write below is not reached on either branch — `coach_id` is
    // the payload's own column and the `.eq('coach_id', uid)` scopes the
    // update — so the template is still exactly as the server had it, and the
    // coach's words are still in the form in front of them.
    const who = await signedInUid('messageTemplates.save');
    if (who.fate !== null) return { ok: false, error: authGateMessage(who.fate) };
    const uid = who.uid;
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
