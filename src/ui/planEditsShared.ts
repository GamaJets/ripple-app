// The read of `client_plan_edits` — the copy of a member's plan changes that
// their COACH reads, rather than the copy on the phone.
//
// ── Why this is a second reader and not a use of the existing hook ────────
//
// src/ui/planEdits.tsx owns the device's copy and writes both. Its `shared`
// flag is a fact about the last upsert it made, in this session, on this
// handset — not a reading of what is stored. Nothing in the product has ever
// read the row back, which means a member who reinstalled, or who has a second
// phone, had no way to find out whether a month of corrections ever arrived.
// This function asks the server.
//
// It is deliberately read-only. The plan screen is the writer, and a write from
// anywhere else would be overwritten by that screen's next tap out of its own
// in-memory copy — silently, and after the member had been told it was done.
//
// ── supabase-js RESOLVES ON AN ERROR ──────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing.
// Here the confident-empty failure is specific and expensive: a member told
// their coach can see none of their changes does the obvious thing and makes
// them all again.
//
// ── Absent, unreadable and empty are three answers ────────────────────────
//
// `maybeSingle()` returns null `data` for a member who has never changed
// anything, and that is genuinely "no edits". Bytes that will not parse are
// NOT: src/lib/planEdits.ts keeps those apart for the device's copy through
// `readPlanEdits`'s `read` flag, and the same parser and the same distinction
// are used here. `readable: false` is stored-and-unreadable, which the member
// is told rather than having it rounded down to nothing.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { readPlanEdits, EMPTY_PLAN_EDITS, type PlanEdits } from '../lib/planEdits';
import type { LoadStatus } from './loadStatus';

/** The stored row, as much as could be made of it. */
export interface SharedPlanEdits {
  edits: PlanEdits;
  /** False when the row exists and its bytes would not parse. Never conflated
   *  with an empty set of edits. */
  readable: boolean;
  /** `updated_at`, or null where the row carries none. */
  updatedAt: string | null;
}

/**
 * What this member's coach can currently see of their plan.
 *
 * `clientId` is passed rather than resolved here so the caller's own
 * already-read identity is used — the same id `usePlanEdits` upserts under, so
 * the two cannot end up looking at different rows. A caller with no settled id
 * gets 'error', because "we do not know who you are" is not "you have changed
 * nothing".
 */
export async function fetchSharedPlanEdits(
  clientId: string | null | undefined,
): Promise<{ shared: SharedPlanEdits; status: LoadStatus }> {
  const nothing: SharedPlanEdits = { edits: EMPTY_PLAN_EDITS, readable: true, updatedAt: null };
  // With no server there is no second copy and no coach reading one, so the
  // local store IS the truth — 'ready' rather than 'error', for the reason
  // src/ui/loadStatus.ts gives: there is no absent server to misreport.
  if (!USE_SUPABASE) return { shared: nothing, status: 'ready' };
  if (!clientId || clientId === 'unknown') return { shared: nothing, status: 'error' };
  try {
    const { data, error } = await supabase
      .from('client_plan_edits')
      .select('edits, updated_at')
      .eq('client_id', clientId)
      .maybeSingle();
    if (error) { reportError('planEditsShared.read', error); return { shared: nothing, status: 'error' }; }
    // No row is a real answer: this member has never changed anything. It is
    // the one case in this function where an empty set may be stated as a fact.
    if (!data) return { shared: nothing, status: 'ready' };
    const raw = typeof data.edits === 'string' ? data.edits : null;
    // The same parser the device's copy goes through, so the two copies cannot
    // grow two opinions about the shape — and the same `read` flag, which is
    // what keeps "stored but unreadable" from becoming "no changes".
    const parsed = readPlanEdits(raw);
    return {
      shared: {
        edits: parsed.edits,
        // Bytes that are absent are not bytes that would not parse. A row whose
        // `edits` column is not a string at all reads as unreadable, which is
        // the honest answer — the column is `text not null`.
        readable: raw == null ? false : parsed.read,
        updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
      },
      status: 'ready',
    };
  } catch (e) {
    reportError('planEditsShared.read', e);
    return { shared: nothing, status: 'error' };
  }
}
