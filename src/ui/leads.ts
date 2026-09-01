// Coach · the enquiry list, read once and reduced to what a screen may claim.
//
// A hook rather than a provider: one screen wants it, it is three reads, and
// nothing else in the app holds it open — the same call this codebase already
// makes for src/ui/nudges.ts, and for the same reason.
//
// The rules live in src/lib/leads.ts and are testable without a database. What
// is here is the part that cannot be: the reads, the two writes, and what each
// of their failure modes is allowed to make the screen say.
//
// ── Two of the three reads can lie by succeeding ──────────────────────────
//
// 1. THE ENQUIRIES. This is an ordinary table read through PostgREST, so it
//    stops at 1,000 rows and says nothing (src/lib/rowCap.ts). An empty result
//    from a refused read is indistinguishable at the point of use from a coach
//    nobody has contacted, and those two send a coach to opposite conclusions
//    about whether to keep paying for the ad. So the status travels with the
//    rows, and leadCountLine states no figure it cannot stand behind.
//
// 2. THEIR CODES. The enquiry carries `via_code`; the coach's own name for that
//    code — 'Gym flyer' — lives in my_join_codes(). If THAT read fails and this
//    one succeeds, every enquiry renders as coming from a code the coach does
//    not hold, which reads exactly like a bug in the attribution rather than a
//    failed read. So the two statuses are folded with worstStatus and the
//    screen refuses to attribute anything unless both landed whole.
//
// 3. THE FOLLOW-UPS. What the coach already did. A failure here is the mildest
//    of the three — it hides history rather than inventing it — and it still
//    matters, because an enquiry whose notes did not load looks like one nobody
//    has written up, and a coach may ring somebody they rang yesterday.
//
// ── The write that must not silently succeed ──────────────────────────────
//
// `state` is granted to `authenticated` at COLUMN level and nothing else on the
// row is (part 157). A refused update resolves in supabase-js with `error` set
// and would otherwise leave the screen showing 'contacted' for an enquiry the
// database still calls 'new' — so both writes re-read rather than patching the
// local row, and both report their failure in words that say what is still true.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { fetchMyJoinCodes } from './joinCode';
import type { KnownCode } from '../lib/adMatch';
import {
  shapeLeads, shapeFollowUps, leadCountLine, followUpProblem,
  MAX_FOLLOW_UP,
  type FollowUp, type LeadRow, type LeadState, type RawFollowUp, type RawLead,
} from '../lib/leads';

export type LeadWrite = { ok: true } | { ok: false; reason: string };

export interface LeadBook {
  /** The worst of the enquiry read and the code read. */
  status: LoadStatus;
  rows: LeadRow[];
  /** The line under the heading, true in all four states. */
  note: string;
  /** True when the codes read landed, so a campaign name means something. */
  codesRead: boolean;
  /** What the coach has already done about one enquiry, newest first. */
  followUpsFor: (leadId: string) => FollowUp[];
  /** True when the follow-up read did not land — history is hidden, not absent. */
  followUpsUnread: boolean;
  setState: (leadId: string, state: LeadState) => Promise<LeadWrite>;
  addFollowUp: (leadId: string, body: string) => Promise<LeadWrite>;
  /** Remove an enquiry outright — the only answer to "take me off your list". */
  erase: (leadId: string) => Promise<LeadWrite>;
  reload: () => Promise<void>;
}

interface Loaded {
  leads: RawLead[];
  codes: KnownCode[];
  notes: Record<string, FollowUp[]>;
}

const EMPTY: Loaded = { leads: [], codes: [], notes: {} };

export function useLeads(): LeadBook {
  const authRev = useAuthRevision();

  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [codesStatus, setCodesStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [notesUnread, setNotesUnread] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [coachId, setCoachId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Without a server there is no table to have read, and an empty list under
    // 'ready' would be a claim about a coach's enquiries made by an app that
    // never asked anybody. src/ui/joinCode.ts makes the same call.
    if (!USE_SUPABASE) {
      setLoaded(EMPTY);
      setStatus('error');
      setCodesStatus('error');
      return;
    }
    // getSession and not getUser: getUser REJECTS when nobody is signed in,
    // which would latch this into 'error' before anybody has logged in.
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id ?? null;
    setCoachId(uid);
    if (!uid) { setLoaded(EMPTY); setStatus('error'); setCodesStatus('error'); return; }

    // The codes first, and separately, because their failure and the enquiry
    // read's failure say different things on screen.
    const codesRead = await fetchMyJoinCodes();
    setCodesStatus(codesRead.status);
    const codes: KnownCode[] = codesRead.rows.map((r) => ({ id: r.id, code: r.code, label: r.label }));

    try {
      const res = await supabase.from('coach_leads')
        .select('id, name, contact, note, via_code, at, state')
        .eq('trainer_id', uid)
        .order('at', { ascending: false })
        .limit(capLimit());
      if (res.error) throw res.error;
      const page = capped(res.data);
      const leads = page.rows as RawLead[];

      // The follow-ups for the enquiries just read. A separate read rather than
      // an embedded one: PostgREST's embedding applies its own row cap to the
      // nested set, and a silently truncated history is the failure this file
      // is otherwise careful about.
      let notes: Record<string, FollowUp[]> = {};
      let unread = false;
      const ids = leads.map((l) => String(l.id ?? '')).filter(Boolean);
      if (ids.length) {
        const noteRes = await supabase.from('coach_lead_notes')
          .select('id, lead_id, body, at')
          .in('lead_id', ids)
          .order('at', { ascending: false })
          .limit(capLimit());
        if (noteRes.error) {
          // Not fatal to the screen. The enquiries are real and actionable
          // without their history; the screen says the history is missing
          // rather than showing an empty one, which would read as "nobody has
          // followed this up".
          reportError('leads.notes', noteRes.error);
          unread = true;
        } else {
          const byLead: Record<string, RawFollowUp[]> = {};
          for (const n of noteRes.data ?? []) {
            const key = String((n as any).lead_id ?? '');
            if (!key) continue;
            (byLead[key] ||= []).push(n as RawFollowUp);
          }
          notes = Object.fromEntries(
            Object.entries(byLead).map(([k, v]) => [k, shapeFollowUps(v)]),
          );
          unread = capped(noteRes.data).truncated;
        }
      }

      setLoaded({ leads, codes, notes });
      setNotesUnread(unread);
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('leads.read', e);
      // Deliberately clearing, as src/ui/nudges.ts does: everything on this
      // screen is a prompt to contact a stranger, and a stale one acted on is a
      // phone call to somebody whose enquiry may already be closed.
      setLoaded({ leads: [], codes, notes: {} });
      setNotesUnread(false);
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load, authRev]);

  const combined = worstStatus(status, codesStatus);

  const rows = useMemo(
    // Shaped against the codes ONLY when they were read whole. Passing a
    // half-read list would name some campaigns and silently orphan the rest,
    // which looks like the attribution being wrong rather than the read.
    () => shapeLeads(loaded.leads, codesStatus === 'ready' ? loaded.codes : []),
    [loaded.leads, loaded.codes, codesStatus],
  );

  const note = useMemo(() => {
    if (codesStatus !== 'ready' && status === 'ready') {
      return 'Your enquiries were read, but your codes were not — so none of them can be put against a campaign. The people below are real; where they came from is unknown until this reads again.';
    }
    return leadCountLine(combined, rows);
  }, [combined, status, codesStatus, rows]);

  const followUpsFor = useCallback(
    (leadId: string): FollowUp[] => loaded.notes[leadId] ?? [],
    [loaded.notes],
  );

  const setLeadState = useCallback(async (leadId: string, state: LeadState): Promise<LeadWrite> => {
    if (!USE_SUPABASE || !coachId) {
      return { ok: false, reason: 'Not signed in, so this could not be saved — the enquiry is still where it was.' };
    }
    // `.select('id')` so a policy that refused the row comes back as zero rows
    // rather than as a silent success: a zero-row update is not an error in
    // PostgREST, and this is a column-level grant, which is exactly the shape
    // that can be refused without a message.
    const { data, error } = await supabase.from('coach_leads')
      .update({ state })
      .eq('id', leadId)
      .eq('trainer_id', coachId)
      .select('id');
    if (error) {
      reportError('leads.state', error);
      return { ok: false, reason: 'That could not be saved, so this enquiry is still marked as it was.' };
    }
    if (!data || data.length === 0) {
      return { ok: false, reason: 'Nothing was changed — this enquiry may have been removed. Pull to read the list again.' };
    }
    await load();
    return { ok: true };
  }, [coachId, load]);

  const addFollowUp = useCallback(async (leadId: string, body: string): Promise<LeadWrite> => {
    const problem = followUpProblem(body);
    if (problem) return { ok: false, reason: problem };
    if (!USE_SUPABASE || !coachId) {
      return { ok: false, reason: 'Not signed in, so nothing was recorded — and an unrecorded call is one you will make twice.' };
    }
    const { data, error } = await supabase.from('coach_lead_notes')
      .insert({ lead_id: leadId, coach_id: coachId, body: body.trim().slice(0, MAX_FOLLOW_UP) })
      .select('id');
    if (error || !data || data.length === 0) {
      reportError('leads.followUp', error);
      return { ok: false, reason: 'That could not be recorded. What you did still happened — it is this note that did not save, so write it down somewhere before you close this.' };
    }
    await load();
    return { ok: true };
  }, [coachId, load]);

  const erase = useCallback(async (leadId: string): Promise<LeadWrite> => {
    if (!USE_SUPABASE || !coachId) {
      return { ok: false, reason: 'Not signed in, so nothing was removed. This enquiry is still on your list.' };
    }
    const { data, error } = await supabase.from('coach_leads')
      .delete()
      .eq('id', leadId)
      .eq('trainer_id', coachId)
      .select('id');
    if (error) {
      reportError('leads.erase', error);
      return { ok: false, reason: 'That could not be removed, so this person’s details are still held. Try again.' };
    }
    if (!data || data.length === 0) {
      return { ok: false, reason: 'There was nothing to remove — this enquiry has already gone.' };
    }
    await load();
    return { ok: true };
  }, [coachId, load]);

  return {
    status: combined,
    rows,
    note,
    codesRead: codesStatus === 'ready',
    followUpsFor,
    followUpsUnread: notesUnread,
    setState: setLeadState,
    addFollowUp,
    erase,
    reload: load,
  };
}
