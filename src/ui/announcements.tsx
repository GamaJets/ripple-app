// Coach announcements — a broadcast the trainer sends to all their clients.
// Clients see the latest on their dashboard.
//
// The seed is empty. It used to contain a fabricated message ("New week, new
// PRs 💪 Gym reformer class added Thursdays 6pm — book from your calendar"),
// timestamped a day ago, shown under a "From your coach" heading with an unread
// dot. No trainer wrote it and no such class existed. Because clientData
// defaults coachingMode to 'online', it reached every client, including those
// with no coach at all.
//
// ── The gap the header used to describe, and no longer has ─────────────────
//
// It read: "Note this store is in-memory only: a trainer's real announcement
// does not reach any other device. That is a separate gap, tracked, and no
// longer papered over by a fake one." Tracked, and then not closed for long
// enough that the coach's dashboard had to grow a subtitle warning the coach
// that the button does nothing — "Pins a note on your own dashboard. It is not
// delivered to your clients" — under a modal titled "Broadcast to All Clients".
//
// The odd part is that the table was already there. `announcements` has existed
// since 02-domain-schema.sql, with `audience`, `tenant_id`, `author_id` and
// `body`, and RLS policies on it since 38-tenant-isolation.sql. In the whole
// repository — both apps and the web console — not one query read or wrote it.
// A table with no reader is indistinguishable from a table that does not exist,
// except that it looks, to anybody auditing the schema, like the feature ships.
//
// ── What part 109 had to change, and why the existing policies did not fit ──
//
// All three policies on that table are about a GYM OWNER broadcasting to a
// TENANT: `ann_write` requires `is_owner_of(tenant_id)`, so a trainer could not
// insert at all, and `ann_read` was `tenant_id = my_tenant()`, so a client
// would have read every announcement in their gym — including one written for
// a different coach's roster, under a heading that says "From Your Coach".
//
// So part 109 adds `coach_id`. Null keeps the original meaning and the original
// policies; not null means the row is addressed to that coach's CURRENT roster,
// through `is_my_coach()`, which reads the same `clients.trainer_id` that
// `end_coaching()` clears. A client who leaves a coach stops seeing that
// coach's announcements, deliberately and unlike a training programme: a plan
// somebody is following stays theirs when they change coach, but "the 6pm class
// is cancelled tonight" from a coach they no longer train with is not news
// addressed to them.
//
// ── Offline ────────────────────────────────────────────────────────────────
//
// Same shape as src/ui/availability.ts and src/ui/wellness.tsx: the device's
// cached copy first, the server second, and `status` says which one is on
// screen. A client on the gym floor with no signal still sees the last thing
// their coach sent. Under 'error' an empty list means we could not find out —
// NOT that the coach has sent nothing — which is the distinction
// src/ui/loadStatus.ts exists to keep, and the reason `status` is exported even
// though the client dashboard does not read it yet.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { adoptServerId, isPending, localId, mergeLog } from '../lib/wellnessSync';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface Announcement { id: string; at: string; body: string }

/** Per-account. A coach and their client can share a phone at the gym, and the
 *  two see different sets — the coach's own sent list, the client's coach's. */
const cacheKey = (uid: string) => `repple.announcements:${uid}`;

/** The longest body the column will take (announcements_body_nonblank, part
 *  109). Trimmed here rather than left to the server, because the failure mode
 *  of not trimming is a coach tapping Send and being told nothing happened. */
const MAX_BODY = 2000;

interface AnnValue {
  announcements: Announcement[];
  latest: Announcement | null;
  /** Resolves true only once the announcement is on the server, where the
   *  coach's clients will see it. False means it is on this phone alone — it is
   *  still listed, and it is retried on the next launch that reaches the
   *  server. Callers that tell a coach "sent" must wait for this. */
  addAnnouncement: (body: string) => Promise<boolean>;
  /** Whether the list was confirmed by the server. Under 'error' an EMPTY list
   *  means UNKNOWN, not "your coach has sent nothing" — a dashboard must not
   *  say the second on the strength of the first. */
  status: LoadStatus;
  /** How many of `announcements` have not reached the server. */
  unsent: number;
}
const Ctx = createContext<AnnValue | null>(null);

const rowToAnn = (r: any): Announcement => ({
  id: String(r.id),
  at: String(r.created_at ?? r.at ?? new Date().toISOString()),
  body: String(r.body ?? ''),
});

export function AnnouncementsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [announcements, setAnnsState] = useState<Announcement[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  // See the note in wellness.tsx: every mutation writes the ref and the state
  // together, so an insert resolving seconds later merges into the list as it
  // actually stands. A functional updater is the wrong tool here because it is
  // double-invoked in development and these paths do network and storage work.
  const listRef = useRef<Announcement[]>([]);
  const cacheable = useRef(true);

  const setAnns = (next: Announcement[], owner: string | null) => {
    listRef.current = next;
    setAnnsState(next);
    if (owner && cacheable.current) {
      AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next)).catch(() => { /* the list is correct this session either way */ });
    }
  };

  /** Send one announcement. Returns false for every reason it is not on the
   *  server — including a client account trying to write one, which RLS refuses
   *  because `coach_id` would have to equal `auth.uid()` and nobody has that
   *  account as their trainer. */
  const send = async (owner: string, a: Announcement): Promise<boolean> => {
    try {
      const { data, error } = await supabase.from('announcements')
        // `tenant_id` is left null on purpose. A coach-scoped row is addressed
        // by the coaching relationship and not by tenancy — `ann_read` requires
        // `coach_id is null`, so a tenant here would change nothing about who
        // can read it — and filling it in would mean choosing a tenant for a
        // coach who may belong to none. An invented tenant is a wrong one.
        .insert({ author_id: owner, coach_id: owner, audience: 'clients', body: a.body })
        .select('id').single();
      const sid = data?.id;
      // `.single()` sets `error` when nothing comes back, so a row RLS refused
      // cannot arrive here looking like a success. `sid` is checked anyway:
      // adopting `undefined` as an id would turn a pending entry into one that
      // is never retried.
      if (error || !sid) return false;
      setAnns(adoptServerId(listRef.current, a.id, String(sid)), owner);
      return true;
    } catch { return false; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let id: string | null = null;
      try {
        // No session is a true answer, not a failed check — getUser() REJECTS
        // when nobody is signed in, and reading that as an error is how sibling
        // providers used to latch into 'error' before anybody had signed in.
        const { data: sess } = await supabase.auth.getSession();
        id = sess?.session?.user?.id ?? null;
      } catch { /* no local session; treated as signed out below */ }
      if (cancelled) return;

      cacheable.current = true;
      // Signed out, or a build with no backend: nothing is addressed to nobody,
      // and there is no absent server to misreport.
      if (!id || !USE_SUPABASE) { setUid(null); setAnns([], null); setStatus('ready'); return; }
      setUid(id);

      let local: Announcement[] = [];
      try {
        const raw = await AsyncStorage.getItem(cacheKey(id));
        if (raw) local = (JSON.parse(raw) as any[]).map(rowToAnn);
      } catch { /* no usable cache; the server read below is the only source */ }
      if (cancelled) return;
      if (local.length) setAnns(mergeLog<Announcement>(null, local).entries, null);

      try {
        // One query serves both apps, because RLS is what decides whose rows
        // come back: a coach sees the ones they authored (ann_coach_rw), a
        // client sees their coach's (ann_client_read). Writing two queries and
        // choosing between them on a role read here would be a second, weaker
        // copy of the same rule, and the two would eventually disagree.
        //
        // `coach_id not null` is filtered explicitly rather than left to the
        // policies. An owner's tenant-wide broadcast is a different thing with
        // a different author, and it must not appear on a client's dashboard
        // under a heading that says "From Your Coach".
        const { data, error } = await supabase.from('announcements')
          .select('id, body, created_at')
          .not('coach_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        // The cached list stays on screen and the status says it was not
        // checked. The alternative — clearing it — would tell a client their
        // coach had sent nothing, which is the exact sentence loadStatus.ts was
        // written to stop.
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        if (page.truncated) cacheable.current = false;
        const m = mergeLog<Announcement>(page.rows.map(rowToAnn), local);
        setAnns(m.entries, id);
        setStatus(page.truncated ? 'partial' : 'ready');

        // Anything written while offline goes up now, oldest first so the
        // server's ordering matches the order the coach wrote them in.
        for (const a of [...m.pending].reverse()) {
          if (cancelled) return;
          await send(id, a);
        }
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached list stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const addAnnouncement = async (body: string): Promise<boolean> => {
    const b = body.trim().slice(0, MAX_BODY);
    // A blank body is refused here and by announcements_body_nonblank. An empty
    // card on forty dashboards is worse than nothing at all.
    if (!b) return false;
    const a: Announcement = { id: localId(), at: new Date().toISOString(), body: b };
    setAnns(mergeLog<Announcement>(null, [a, ...listRef.current]).entries, uid);
    if (!USE_SUPABASE || !uid) return false;
    return send(uid, a);
  };

  const unsent = useMemo(() => announcements.filter((a) => isPending(a.id)).length, [announcements]);

  return (
    <Ctx.Provider value={{ announcements, latest: announcements[0] ?? null, addAnnouncement, status, unsent }}>
      {children}
    </Ctx.Provider>
  );
}
export function useAnnouncements(): AnnValue { const v = useContext(Ctx); if (!v) throw new Error('useAnnouncements must be used inside <AnnouncementsProvider>'); return v; }
