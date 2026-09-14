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
//    THE FOLD IS NOT THE WHOLE ANSWER, and treating it as one is a defect this
//    file has now caused twice. `worstStatus` makes a failed CODES read
//    indistinguishable from a failed ENQUIRY read, and a consumer branching on
//    it took a coach's entire list of strangers off the screen for the sake of
//    a label lookup; the same fold turned a 'partial' enquiry read into the
//    sentence "your enquiries could not be read" printed over enquiries that
//    had been read. The fold decides what may be SAID as a whole. It never
//    decides who is listed, and it never speaks for one read on the other's
//    behalf — so `leadsStatus` and `codesStatus` are both published unfolded,
//    and `note` is built from the enquiry read's own status.
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
// A page of enquiries is up to ROW_CAP uuids and the follow-up read used to put
// all of them into one `.in()`. See the note at that read.
import { readCappedByIds } from '../lib/cappedByIds';
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
  /**
   * The ENQUIRY read's own status, unfolded.
   *
   * `status` above is `worstStatus(leadsStatus, codesStatus)`, and the fold is
   * right for deciding what may be said. It is wrong for deciding what may be
   * SHOWN, and the difference cost a real screen: a failed codes read — a
   * lookup that only ever decides whether "Gym flyer" can be printed beside a
   * code — arrives in `status` as 'error' indistinguishably from a failed
   * enquiry read, and `app/(trainer)/leads.tsx` branched on it and took the
   * coach's entire list off the screen, replacing strangers who had left phone
   * numbers with "the read did not come back".
   *
   * That screen now reads `status === 'error' && rows.length === 0`, which is
   * true for the right reason — the hook clears the rows when the enquiry read
   * fails — but it is a proxy, and a proxy is a thing the next consumer has to
   * re-derive correctly. This is the fact itself, so nobody has to. 'partial'
   * here is the other half of it: the enquiries were read and there are more of
   * them, which is not something `status` can still say once the codes read has
   * folded 'error' over the top of it.
   */
  leadsStatus: LoadStatus;
  /** The CODES read's own status. `codesRead` is this being 'ready'. */
  codesStatus: LoadStatus;
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
        // `joined_at` and `joined_via` are part 211's. A database without it
        // answers 42703 and the whole read fails, which is the right outcome
        // and the reason `shapeLeads` distinguishes an ABSENT key from a null
        // one: the fallback path is a build talking to an older schema, and
        // there a missing column must read as "not known" and never as "they
        // did not join".
        .select('id, name, contact, note, via_code, at, state, joined_at, joined_via')
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
        // Chunked. `ids` comes off the `.limit(capLimit())` read above, so it
        // is up to ROW_CAP = 1000 enquiry ids, and one `.in()` over that builds
        // a ~39KB request line against the 8KB nginx and most CDNs allow. Past
        // roughly two hundred ids the proxy refuses before the database sees
        // the query; the 414 is not a rejected promise in supabase-js, so it
        // lands in the branch below and every enquiry loses its follow-up
        // history at once. The screen is honest about that — `unread` puts a
        // sentence up rather than an empty list — but it is a whole feature
        // switching off for a coach whose enquiry book grew past two hundred,
        // with no way to tell that the size of their book was the cause.
        //
        // Still capped rather than finished (`readCappedByIds`, not
        // `readByIds`): follow-ups are one row per note per enquiry with no
        // bound at all, `unread` is already the honest answer to a short page,
        // and paging every note a coach has ever written to compute a preview
        // is not what this screen is for. See src/lib/cappedByIds.ts.
        const noteRes = await readCappedByIds<RawFollowUp>(
          ids,
          (chunk) => supabase.from('coach_lead_notes')
            .select('id, lead_id, body, at')
            .in('lead_id', chunk)
            .order('at', { ascending: false })
            .limit(capLimit()),
        );
        if (noteRes.error) {
          // Not fatal to the screen. The enquiries are real and actionable
          // without their history; the screen says the history is missing
          // rather than showing an empty one, which would read as "nobody has
          // followed this up".
          reportError('leads.notes', noteRes.error);
          unread = true;
        } else {
          const byLead: Record<string, RawFollowUp[]> = {};
          for (const n of noteRes.rows) {
            const key = String((n as any).lead_id ?? '');
            if (!key) continue;
            (byLead[key] ||= []).push(n as RawFollowUp);
          }
          notes = Object.fromEntries(
            Object.entries(byLead).map(([k, v]) => [k, shapeFollowUps(v)]),
          );
          // Already trimmed to the cap chunk by chunk, and `truncated` is true
          // if ANY chunk was — an enquiry's notes are all in one chunk, so a
          // short page still means somebody's history is missing.
          unread = noteRes.truncated;
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

  /**
   * The line under the heading.
   *
   * Built from the ENQUIRY read's own status and never from the fold. The fold
   * is `worstStatus`, so a failed codes read turns 'partial' into 'error' and
   * this line fell through to `leadCountLine('error', rows)` — "Your enquiries
   * could not be read, so nothing here is a count. This is not an empty inbox."
   * — printed above a list of enquiries that HAD been read and were on screen
   * underneath it. The codes read is a lookup for campaign names; it cannot
   * make a statement about whether the enquiries came back, and it must not be
   * allowed to write one.
   *
   * So the two facts are said as two facts. `leadCountLine` says what is known
   * about the enquiries, under their own status — which keeps 'partial' saying
   * "there are more of them" rather than losing it — and the codes sentence is
   * added after it when the codes did not land. Neither sentence states a
   * figure the other one makes false: `leadCountLine` already refuses a total
   * under 'partial', and the campaign half is about attribution, not counts.
   */
  const note = useMemo(() => {
    const own = leadCountLine(status, rows);
    // Nothing to add while the enquiry read is still in flight or has failed:
    // under 'loading' there is no list to attribute yet, and under 'error'
    // `leadCountLine` has already said the enquiries are unknown, which is the
    // larger fact and the one a coach acts on.
    //
    // whole-ok: this line is the "did not land" half and it is right to stop at
    // two. 'partial' goes on through DELIBERATELY, and is the reason this memo
    // was rewritten: a truncated enquiry read still put real strangers on the
    // screen, and the sentence after this one is about ATTRIBUTION — whether
    // the rows that are there can be named against a campaign — not about
    // whether they are all of the rows. `leadCountLine` is what answers the
    // "all of them" question and it refuses a total under 'partial' on its own,
    // one line above. Swapping this for `isWhole(status)` would drop the codes
    // caveat exactly when the coach is already looking at an incomplete list,
    // which is the one case where an unnamed campaign is most likely to be read
    // as broken attribution rather than as a failed read.
    if (codesStatus === 'ready' || status === 'loading' || status === 'error') return own;
    return `${own} Your codes were not read, so none of these can be put against a campaign — the people below are real; where they came from is unknown until this reads again.`;
  }, [status, codesStatus, rows]);

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
    leadsStatus: status,
    codesStatus,
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
