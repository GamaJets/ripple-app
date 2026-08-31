// Notices — what a coach posts to their roster, and what a gym posts to its
// members. One store, because they are one table (`announcements`, part 109)
// and one thing to a reader: a message addressed to them that they did not have
// to be looking to receive.
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
// ── Posting it was never the same as delivering it ─────────────────────────
//
// Until now this file wrote the row and stopped. The client dashboard rendered
// the LATEST notice and nothing rendered any other one, so a gym owner writing
// "we are closed Monday" reached whoever happened to open their home screen
// that day and nobody else — and the day after, the notice was readable
// nowhere at all. Two things close that, and both are here:
//
//   the fan-out   every post now addresses its recipients explicitly and
//                 writes them an inbox row through `notify_users()` (part 122),
//                 which is the same RPC every other notification in this app
//                 goes through and which decides per recipient whether the
//                 author is allowed to reach them. The recipient lists are
//                 collected the way app/(owner)/promotions.tsx already collects
//                 them — `all_member_ids()` for a gym, and the coach's own
//                 `clients` rows for a coach — rather than by a second
//                 definition of "who is in this gym" that would eventually
//                 disagree with the first.
//   the archive   app/(client)/notices.tsx reads this store rather than one
//                 row of it, so a notice stays readable after the day it was
//                 posted. That was half the defect.
//
// WHO GETS A GYM NOTICE. Every member row in the tenant — `all_member_ids()`,
// which is `select c.id from clients c where is_owner_of(c.tenant_id)`. Not
// "active members", and that is a decision rather than an oversight: there is
// no such state in this schema. `clients` has no status column at all, and
// `memberships` — which does have one — covered 1 of the 10 client rows in the
// live database when this was written, so "active members only" would in
// practice mean "members whose gym happens to use the memberships table" and
// would silently drop nine members in ten from a gym-closure notice. Leaving a
// gym is modelled here by the `clients` row going away, not by a flag. Using a
// second definition from the one the promotions push uses would also make the
// notified count and the pushed count disagree, which part 122's header calls
// out by name.
//
// A COACH NOTICE IS A DIFFERENT FAN-OUT and both exist. The coach addresses
// their own roster (`clients.trainer_id = auth.uid()`), which is the same join
// `notify_users()` re-checks on the server; the gym addresses its members. They
// are not interchangeable and neither is derived from the other.
//
// ── This never composes under anybody's name ───────────────────────────────
//
// The inbox body is the author's own text, verbatim (src/lib/notifyCopy.ts).
// The only sentence this app adds is the heading — "A notice from your coach" —
// which is the app speaking about a row RLS has already tied to that author:
// `ann_coach_rw` requires `coach_id = auth.uid() AND author_id = auth.uid()`,
// so no account can address a roster that is not its own or put another
// person's name on a message. That is the same rule supabase/parts/140 and
// src/lib/nudge.ts are built on, and a fan-out is exactly where it would be
// easiest to lose.
//
// ── Offline ────────────────────────────────────────────────────────────────
//
// Same shape as src/ui/availability.ts and src/ui/wellness.tsx: the device's
// cached copy first, the server second, and `status` says which one is on
// screen. A client on the gym floor with no signal still sees the last thing
// their coach sent. Under 'error' an empty list means we could not find out —
// NOT that the coach has sent nothing — which is the distinction
// src/ui/loadStatus.ts exists to keep.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { adoptServerId, isPending, localId, mergeLog } from '../lib/wellnessSync';
import { NOTICE_ROUTE, noticeNotification, type DeliveryReport, type NoticeKind } from '../lib/notifyCopy';
import { recordInbox, sendPushChecked } from './pushNotifications';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface Announcement {
  id: string;
  at: string;
  body: string;
  /** 'coach' is addressed to one coach's roster (`coach_id` not null); 'gym' is
   *  the tenant-wide broadcast the original policies were written for. The
   *  client dashboard's "From Your Coach" block may only ever show the first,
   *  which is why the two are distinguished here and not at the read. */
  kind: NoticeKind;
  /** Whether this account wrote it. What lets an author see their own sent
   *  list without a second query — and it is derived from `author_id`, not
   *  from the kind, because a coach can also be a client of another coach and
   *  would otherwise read that coach's notices as their own. */
  mine: boolean;
}

/** Per-account. A coach and their client can share a phone at the gym, and the
 *  two see different sets — the coach's own sent list, the client's coach's. */
const cacheKey = (uid: string) => `repple.announcements:${uid}`;

/** The longest body the column will take (announcements_body_nonblank, part
 *  109). Trimmed here rather than left to the server, because the failure mode
 *  of not trimming is a coach tapping Send and being told nothing happened. */
const MAX_BODY = 2000;

/** What a post did, beyond being written down. `ok` is only ever true when the
 *  row is on the SERVER — a notice that exists on the author's phone alone has
 *  not been posted to anybody, and telling them otherwise is the failure this
 *  file has already shipped twice. */
export interface PostResult {
  ok: boolean;
  /** Present when `ok`. What the fan-out actually managed, for
   *  `deliverySummary()` to turn into the sentence the author reads. */
  delivery?: DeliveryReport;
}

interface AnnValue {
  announcements: Announcement[];
  /** The newest notice from a COACH — what the client dashboard's "From Your
   *  Coach" block shows. Never a gym notice: that block is captioned, and a
   *  gym's words under a coach's heading are attributed to the wrong person. */
  latest: Announcement | null;
  /** The newest notice from the GYM, for a block that says so. */
  latestGym: Announcement | null;
  /** Notices this account wrote, newest first. The author's own sent list. */
  mine: Announcement[];
  /** Post to this coach's own roster. Resolves once the row is on the server,
   *  where the coach's clients will see it — and reports what the fan-out
   *  reached. Callers that tell a coach "sent" must wait for this. */
  addAnnouncement: (body: string, opts?: { push?: boolean }) => Promise<PostResult>;
  /** Post to every member of the gym this account owns. Refused by RLS
   *  (`ann_write` requires `is_owner_of(tenant_id)`) for anybody else. */
  addGymAnnouncement: (body: string, opts?: { push?: boolean }) => Promise<PostResult>;
  /** Whether the list was confirmed by the server. Under 'error' an EMPTY list
   *  means UNKNOWN, not "your coach has sent nothing" — a dashboard must not
   *  say the second on the strength of the first. */
  status: LoadStatus;
  /** How many of `announcements` have not reached the server. */
  unsent: number;
}
const Ctx = createContext<AnnValue | null>(null);

const rowToAnn = (r: any, uid: string | null): Announcement => ({
  id: String(r.id),
  at: String(r.created_at ?? r.at ?? new Date().toISOString()),
  body: String(r.body ?? ''),
  kind: (r.kind === 'gym' || r.kind === 'coach') ? r.kind : (r.coach_id ? 'coach' : 'gym'),
  // `mine` survives the cache as a stored boolean, because the cache is
  // per-account and a cached row's author cannot change under it.
  mine: typeof r.mine === 'boolean' ? r.mine : (!!uid && String(r.author_id ?? '') === uid),
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
  /** The gym's own name, for the heading on a gym notice's inbox row. Null
   *  until it is read, and null when the read fails — in which case the
   *  heading says "your gym", which is true, rather than a name nobody
   *  confirmed. */
  const gymName = useRef<string | null>(null);

  const setAnns = (next: Announcement[], owner: string | null) => {
    listRef.current = next;
    setAnnsState(next);
    if (owner && cacheable.current) {
      AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next)).catch(() => { /* the list is correct this session either way */ });
    }
  };

  /* ── who a notice is addressed to ───────────────────────────────────────
   *
   * Collected the way app/(owner)/promotions.tsx collects them, and for the
   * reason its header gives: `error` is read rather than `data` alone, because
   * supabase-js RESOLVES on a database error — an RLS refusal arrived there as
   * `data: null`, collapsed to an empty id list, and was reported to the owner
   * as "No members to push to yet", which told them their gym was empty
   * instead of that the call was refused.
   *
   * Null is returned for a failed read and an empty array for a real emptiness,
   * and the two stay apart all the way to the sentence the author is shown.
   */
  const gymRecipients = async (): Promise<string[] | null> => {
    try {
      const { data, error } = await supabase.rpc('all_member_ids');
      if (error) return null;
      // `returns setof uuid` hands back plain strings; an earlier deployment
      // returned `table(user_id)`. Both are accepted here for the same reason
      // promotions.tsx accepts both — reading `.user_id` off a string gave
      // undefined for every member and pushed to nobody.
      return Array.isArray(data)
        ? data.map((r: any) => (typeof r === 'string' ? r : r?.user_id)).filter(Boolean).map(String)
        : null;
    } catch { return null; }
  };

  const coachRecipients = async (owner: string): Promise<string[] | null> => {
    try {
      const { data, error } = await supabase.from('clients').select('id').eq('trainer_id', owner).limit(capLimit());
      if (error) return null;
      return (data ?? []).map((r: any) => String(r.id)).filter(Boolean);
    } catch { return null; }
  };

  /* ── the fan-out ────────────────────────────────────────────────────────
   *
   * The inbox row is written for every post; the push is the author's choice.
   * That split is deliberate and it is the answer to "does it push": a gym
   * closure and a new smoothie flavour are the same INSERT and this app cannot
   * tell them apart, so the person who wrote the words decides — with a
   * control that says what it does (`pushConsequence`), rather than a switch
   * whose consequence is discovered by the members it woke.
   *
   * There is no scheduling and no quiet hours, and the copy does not pretend
   * otherwise: nothing in this repository records what timezone anybody is in,
   * so "it will go out in the morning" is a promise nothing could keep.
   */
  const fanOut = async (kind: NoticeKind, body: string, push: boolean): Promise<DeliveryReport> => {
    const ids = kind === 'gym' ? await gymRecipients() : await coachRecipients((await currentUid()) ?? '');
    const note = noticeNotification(kind, body, kind === 'gym' ? gymName.current : null);
    if (!note || !ids || !ids.length) {
      return { recipients: ids ? ids.length : null, recorded: ids && ids.length === 0 ? 0 : null, push: 'off' };
    }
    if (!push) {
      const recorded = await recordInbox(ids, note.title, note.body, { route: NOTICE_ROUTE });
      return { recipients: ids.length, recorded, push: 'off' };
    }
    // sendPushChecked writes the inbox row FIRST and reports both halves
    // separately, so a failed push cannot be reported as a failed notice.
    const res = await sendPushChecked(ids, note.title, note.body, { route: NOTICE_ROUTE });
    return {
      recipients: ids.length,
      recorded: res.recorded,
      push: res.ok ? 'queued' : 'failed',
      pushError: res.error ?? null,
    };
  };

  const currentUid = async (): Promise<string | null> => {
    if (uid) return uid;
    try {
      const { data: sess } = await supabase.auth.getSession();
      return sess?.session?.user?.id ?? null;
    } catch { return null; }
  };

  /** Send one announcement. Returns false for every reason it is not on the
   *  server — including a client account trying to write one, which RLS refuses
   *  because `coach_id` would have to equal `auth.uid()` and nobody has that
   *  account as their trainer. */
  const send = async (owner: string, a: Announcement): Promise<boolean> => {
    try {
      // Typed as one shape rather than inferred from the branches: a union of
      // two object literals is inferred with `coach_id: string` on one side and
      // `null` on the other, which supabase-js's insert generic then refuses.
      const row: { author_id: string; coach_id: string | null; audience: string; body: string; tenant_id?: string | null } = a.kind === 'coach'
        // `tenant_id` is left null on purpose for a coach notice. A
        // coach-scoped row is addressed by the coaching relationship and not by
        // tenancy — `ann_read` requires `coach_id is null`, so a tenant here
        // would change nothing about who can read it — and filling it in would
        // mean choosing a tenant for a coach who may belong to none. An
        // invented tenant is a wrong one.
        ? { author_id: owner, coach_id: owner, audience: 'clients', body: a.body }
        // A gym notice is the original meaning of this table and keeps the
        // original policies: `coach_id` null, and a tenant that must be the
        // one this account owns. The tenant is read from the profile rather
        // than passed in, because `ann_write` checks `is_owner_of(tenant_id)`
        // and a mismatched id is refused rather than mis-addressed.
        // `audience` is 'clients' and not 'members': announcements_audience_check
        // admits 'clients' or 'trainers' and nothing else, and a gym notice is
        // addressed to the people the schema calls clients. A third word here
        // is not a naming choice, it is a rejected insert.
        : { author_id: owner, coach_id: null, audience: 'clients', body: a.body, tenant_id: await myTenant() };
      const { data, error } = await supabase.from('announcements')
        .insert(row)
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

  /** The tenant this account belongs to, or null. Read at post time rather than
   *  held, so an owner who is moved between tenants does not post into the one
   *  they were in when the app launched. */
  const myTenant = async (): Promise<string | null> => {
    const id = await currentUid();
    if (!id) return null;
    try {
      const { data, error } = await supabase.from('profiles').select('tenant_id, tenants(name)').eq('id', id).limit(1);
      if (error) return null;
      const r = (data ?? [])[0] as any;
      const t = r?.tenants;
      const name = (Array.isArray(t) ? t[0]?.name : t?.name) || '';
      gymName.current = String(name).trim() || null;
      return r?.tenant_id ? String(r.tenant_id) : null;
    } catch { return null; }
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
        if (raw) local = (JSON.parse(raw) as any[]).map((r) => rowToAnn(r, id));
      } catch { /* no usable cache; the server read below is the only source */ }
      if (cancelled) return;
      if (local.length) setAnns(mergeLog<Announcement>(null, local).entries, null);

      try {
        // One query serves all three apps, because RLS is what decides whose
        // rows come back: a coach sees the ones they authored (ann_coach_rw), a
        // client sees their coach's (ann_client_read) and their gym's
        // (ann_read), an owner sees their gym's (ann_owner_rw). Writing three
        // queries and choosing between them on a role read here would be a
        // second, weaker copy of the same rule, and the two would eventually
        // disagree.
        //
        // `coach_id` is SELECTED rather than filtered on. It used to be
        // `.not('coach_id', 'is', null)` — which kept an owner's tenant-wide
        // broadcast off a client's "From Your Coach" block by never fetching
        // it, and in doing so made every gym notice unreadable in the app. The
        // heading is now chosen per row from this column instead, so both are
        // readable and neither is attributed to the other.
        const { data, error } = await supabase.from('announcements')
          .select('id, body, created_at, coach_id, author_id')
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
        const m = mergeLog<Announcement>(page.rows.map((r) => rowToAnn(r, id)), local);
        setAnns(m.entries, id);
        setStatus(page.truncated ? 'partial' : 'ready');

        // Anything written while offline goes up now, oldest first so the
        // server's ordering matches the order the author wrote them in.
        //
        // The fan-out runs for these too — they have reached nobody yet — but
        // NEVER the push. The author is not here to be asked, and the phone
        // that has just come back online may be doing so at four in the
        // morning; the notice waits in an inbox instead.
        for (const a of [...m.pending].reverse()) {
          if (cancelled) return;
          if (await send(id, a)) await fanOut(a.kind, a.body, false);
        }
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached list stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const post = async (kind: NoticeKind, body: string, push: boolean): Promise<PostResult> => {
    const b = body.trim().slice(0, MAX_BODY);
    // A blank body is refused here and by announcements_body_nonblank. An empty
    // card on forty dashboards is worse than nothing at all.
    if (!b) return { ok: false };
    const a: Announcement = { id: localId(), at: new Date().toISOString(), body: b, kind, mine: true };
    setAnns(mergeLog<Announcement>(null, [a, ...listRef.current]).entries, uid);
    if (!USE_SUPABASE || !uid) return { ok: false };
    if (!(await send(uid, a))) return { ok: false };
    return { ok: true, delivery: await fanOut(kind, b, push) };
  };

  const addAnnouncement = (body: string, opts?: { push?: boolean }) => post('coach', body, opts?.push === true);
  const addGymAnnouncement = (body: string, opts?: { push?: boolean }) => post('gym', body, opts?.push === true);

  const unsent = useMemo(() => announcements.filter((a) => isPending(a.id)).length, [announcements]);
  const latest = useMemo(() => announcements.find((a) => a.kind === 'coach' && !a.mine) ?? null, [announcements]);
  const latestGym = useMemo(() => announcements.find((a) => a.kind === 'gym' && !a.mine) ?? null, [announcements]);
  const mine = useMemo(() => announcements.filter((a) => a.mine), [announcements]);

  return (
    <Ctx.Provider value={{ announcements, latest, latestGym, mine, addAnnouncement, addGymAnnouncement, status, unsent }}>
      {children}
    </Ctx.Provider>
  );
}
export function useAnnouncements(): AnnValue { const v = useContext(Ctx); if (!v) throw new Error('useAnnouncements must be used inside <AnnouncementsProvider>'); return v; }
