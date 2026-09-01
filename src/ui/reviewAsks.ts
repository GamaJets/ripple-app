// Coach · who is worth asking for a review, and who has already been asked.
//
// The I/O half of the `askMoment` section in src/lib/reviews.ts, which holds
// the rules and is tested without a database.
//
// ── Two reads and one device record ──────────────────────────────────────
//
// The roster gives who is on the book and when they joined. `goal_targets`
// gives who has recently marked a goal of their own as reached — the strongest
// moment there is, because the client has just told the app in their own words
// that the thing they came for happened. Neither is a new query shape: the
// coach already reads both.
//
// The third fact — has this person already been asked — is NOT a read. It is a
// device-local record, and src/lib/reviews.ts explains at length why it is
// "asked" rather than "reviewed": `coach_reviews` has no policy and no grant to
// `authenticated`, because RLS selects rows and never columns and any policy
// wide enough to show a review to a stranger browsing the directory would also
// hand over `client_id`. Reviews are anonymous to the coach on purpose.
//
// A server-side table of which clients a coach has solicited would answer the
// question and would be a worse thing to hold than the problem it solves.
//
// ── What a failed read is allowed to produce ─────────────────────────────
//
// Nothing. Every fact here is nullable and `askMoment` turns a null into no
// moment at all, so a refused query produces a shorter list rather than a
// wrong one. The list note says which of the two happened.
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { useRoster } from './roster';
import { isQueryableId } from '../lib/clientDrift';
import { askMoment, GOAL_FRESH_DAYS, type AskCandidate, type AskMoment } from '../lib/reviews';
import type { LoadStatus } from './loadStatus';

/** Per account. A gym's shared handset is signed in and out all day, and a
 *  shared record would tell one coach that another coach's asking was theirs.
 *  The same argument `floorQueueKey` makes in src/lib/floorQueue.ts. */
const askedKey = (uid: string) => `repple.reviewAsks:${uid}`;

export interface AskRow {
  clientId: string;
  name: string | null;
  moment: AskMoment;
  candidate: AskCandidate;
}

export interface ReviewAsks {
  /** Null until the reads settle. Never an empty array for a read in flight —
   *  "nobody is worth asking" printed while it is loading tells a coach
   *  something about their book that nothing has checked. */
  rows: AskRow[] | null;
  status: LoadStatus;
  /** True when the device record of who has been asked could not be read. The
   *  screen says so, because the list is then shorter than it should be for a
   *  reason that is not about the clients. */
  askedUnread: boolean;
  /** Record that this client has been asked. Called AFTER the coach's message
   *  has actually landed on the server, never before — the same ordering
   *  app/(trainer)/nudges.tsx keeps for `client_nudges`, and for the same
   *  reason: a record written first would silence somebody who was never
   *  reached. */
  markAsked: (clientId: string) => Promise<void>;
  reload: () => Promise<void>;
}

async function readAsked(uid: string): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(askedKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    // Null and not an empty set. An unreadable record is "we do not know who
    // has been asked", and the safe direction there is to ask nobody — asking
    // a client twice is the failure this whole record exists to prevent.
    return null;
  }
}

export function useReviewAsks(): ReviewAsks {
  const authRev = useAuthRevision();
  const { roster, status: rosterStatus } = useRoster();
  const [rows, setRows] = useState<AskRow[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [askedUnread, setAskedUnread] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const rosterKey = roster.map((c) => `${c.id}:${c.joinedAt ?? ''}`).join(',');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setRows([]); setStatus('ready'); return; }
    try {
      // getSession and not getUser: getUser REJECTS when nobody is signed in,
      // which would latch this into 'error' before anybody has logged in.
      const { data: sess } = await supabase.auth.getSession();
      const me = sess?.session?.user?.id ?? null;
      setUid(me);
      if (!me) { setRows([]); setStatus('ready'); return; }

      const asked = await readAsked(me);
      setAskedUnread(asked === null);

      // Only clients with a Repple account have goals to read or a thread to
      // write in. A hand-added `coach_clients` row has neither, and asking one
      // for a review would open a thread that does not exist.
      const ids = roster.map((c) => c.id).filter(isQueryableId);

      // The freshest goal each of them has marked reached. Bounded to the
      // window that can produce a moment, so this is a small read rather than
      // a client's whole goal history.
      let goals: Record<string, string> = {};
      let goalsRead = true;
      if (ids.length) {
        const since = new Date(Date.now() - GOAL_FRESH_DAYS * 86_400_000).toISOString();
        const { data, error } = await supabase
          .from('goal_targets')
          .select('client_id, achieved_at')
          .in('client_id', ids)
          .gte('achieved_at', since)
          .order('achieved_at', { ascending: false })
          .limit(capLimit());
        if (error) { reportError('reviewAsks.goals', error); goalsRead = false; }
        else {
          const page = capped(data);
          // A truncated page would make some clients look like they have no
          // goal when they have one, so it is treated as unread wholesale
          // rather than as a shorter answer.
          if (page.truncated) goalsRead = false;
          else for (const r of page.rows as any[]) {
            const cid = String(r.client_id);
            // Ordered newest first, so the first sighting is the freshest.
            if (!(cid in goals) && r.achieved_at) goals[cid] = String(r.achieved_at);
          }
        }
      }

      const out: AskRow[] = roster.map((c) => {
        const candidate: AskCandidate = {
          clientId: c.id,
          name: c.name ?? null,
          since: c.joinedAt ?? null,
          // Null when the goals read failed — which produces no goal moment and
          // leaves the tenure one intact, rather than taking the whole row out.
          goalReachedAt: goalsRead ? (goals[c.id] ?? null) : null,
          asked: asked === null ? null : asked.has(c.id),
        };
        return { clientId: c.id, name: c.name ?? null, moment: askMoment(candidate), candidate };
      });

      setRows(out);
      setStatus(goalsRead ? 'ready' : 'partial');
    } catch (e) {
      reportError('reviewAsks.read', e);
      // Cleared, not kept. Everything on this list is a prompt to send somebody
      // a message, and a stale prompt acted on is a message — the same reason
      // src/ui/nudges.ts clears rather than keeping its board.
      setRows(null);
      setStatus('error');
    }
  }, [rosterKey]);

  useEffect(() => { void load(); }, [load, authRev]);

  const markAsked = useCallback(async (clientId: string) => {
    if (!uid) return;
    try {
      const current = (await readAsked(uid)) ?? new Set<string>();
      current.add(clientId);
      await AsyncStorage.setItem(askedKey(uid), JSON.stringify([...current]));
    } catch (e) {
      // Best effort. A record we could not write costs the coach one repeated
      // suggestion; failing the send would cost them the message.
      reportError('reviewAsks.mark', e);
    }
    await load();
  }, [uid, load]);

  return {
    rows,
    // The roster's own status is folded in: a roster that could not be read is
    // a book we do not have, and every client missing from it is one who cannot
    // be surfaced. `worstStatus` is what keeps that from being forgotten — done
    // by hand here because there are only two.
    status: rosterStatus === 'error' ? 'error' : rosterStatus === 'partial' ? 'partial' : status,
    askedUnread,
    markAsked,
    reload: load,
  };
}
