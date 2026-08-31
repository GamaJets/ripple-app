// The in-app notification inbox — the reader for a table that has never had one.
//
// ── What this closes ───────────────────────────────────────────────────────
//
// `notifications` was created in supabase/parts/01-schema.sql and given the
// `notif_self` policy in the same file. Since then exactly one statement in the
// entire repository has touched it: the `notify-message` edge function's insert
// after a chat message. Nothing has ever read it back. The client dashboard
// grew a bell in its header that routes to the message thread, because there
// was no inbox for it to open.
//
// So a notification in this product was a push and nothing else — gone when it
// was swiped, invisible to anybody whose phone was off, and invisible to
// EVERYBODY today, because expo-notifications is not in the current binary and
// src/ui/pushNotifications.ts no-ops until the rebuild. "Your session was
// cancelled" has been sent to real clients and read by nobody.
//
// ── Why one component and not three screens ────────────────────────────────
//
// The three apps get three route files, because expo-router needs one per group
// and each build only contains its own. But the LIST is the same list in all
// three: the same table, the same six columns, the same row — icon, heading,
// sentence, age, unread mark. There is nothing about a coach's cancelled
// session that renders differently from a client's.
//
// What genuinely differs is the framing around it, and only the framing: what
// the screen is called, what the empty state says (a client with nothing in
// their inbox is being told something different from an owner with nothing in
// theirs), and which route group this build is allowed to navigate into. Those
// are four strings, so they are four props.
//
// Written the other way — three copies of the list — the copies would not stay
// equal. The interesting logic here is the LoadStatus discipline: an empty
// inbox under 'error' means "we could not find out", never "you have no
// notifications", and that distinction is one line of rendering that would have
// to be got right three times and would eventually be got right twice.
//
// ── Why a hook and not a provider ──────────────────────────────────────────
//
// Every other shared store in this folder is a context provider mounted in
// app/_layout.tsx. This one is a plain hook that each screen calls for itself,
// which costs one read per visit to the inbox and buys not having to touch a
// layout file.
//
// There are now two callers per app — the inbox screen, and `NotificationBell`
// below, which is the dashboard bell — so a dashboard visit costs one read and
// opening the inbox from it costs a second. That is the price of not mounting
// a provider in a layout file, and it is still the right trade: the read is one
// capped select on a table nobody writes to often, and the alternative is a
// fourteenth provider in app/_layout.tsx. If a third caller appears, or if the
// bell ever needs to update without a remount, promoting this to a provider is
// the change to make.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import {
  inboxAge, inboxIcon, inboxHeading, safeRoute, unreadBadge,
  inboxControls, clearReadPrompt, deletedNote, clearedNote,
} from '../lib/notifyInbox';
import { writeFailure } from '../lib/wroteRows';
import type { AppVariant } from '../lib/variant';
import { useTheme } from './components';
import { Icon, type IconName } from './Icon';
import { Rule, Ghost, Notice, PartialRead } from './kit';
import { SkeletonList } from './Skeleton';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface InboxItem {
  id: string;
  /** Short heading. Null for rows written before part 122 added the column,
   *  and for the ones `notify-message` still writes without one. */
  title: string | null;
  /** What to actually draw as the heading, which is not always `title`. Null
   *  means draw no heading — see `inboxHeading`. Resolved here, once per row,
   *  rather than at each of the three places that want to name the row. */
  heading: string | null;
  body: string;
  icon: IconName;
  /** Already validated against this build's route group. Null means the row is
   *  worth reading and there is nowhere to send the reader. */
  route: string | null;
  read: boolean;
  at: string;
}

/** Per-account, like every other cache in this folder. A coach and a client can
 *  share a phone at the gym and must not see each other's inbox in the gap
 *  before the server answers. */
const cacheKey = (uid: string) => `repple.notifications:${uid}`;

/**
 * Rows written by the `notify-message` edge function — every row in this table
 * that predates part 122 — carry `icon: 'message'` and nothing else: no title,
 * and no route, because there was no column to put one in.
 *
 * For a client that is still enough to navigate on. There is one thread and it
 * is always at the same address, so a message notification opens it. For a
 * coach it is not: their threads are per-client (app/(trainer)/chat.tsx needs a
 * `clientId`), the edge function knows which one but never wrote it down, and
 * '/(trainer)/chat' with no parameter opens a screen with no conversation in
 * it. So the coach's legacy message rows stay inert and say so, which is the
 * honest version of not knowing. New rows carry their own route.
 */
const legacyMessageRoute = (group: AppVariant): string | null =>
  (group === 'client' ? '/(client)/messages' : null);

const rowToItem = (r: any, group: AppVariant): InboxItem => {
  const isLegacyMessage = !r.route && String(r.icon ?? '') === 'message';
  const route = r.route ?? (isLegacyMessage ? legacyMessageRoute(group) : null);
  const icon = isLegacyMessage ? 'message' : inboxIcon(r.route);
  const title = r.title != null && String(r.title).trim() ? String(r.title).trim() : null;
  return {
    id: String(r.id),
    title,
    heading: inboxHeading(title, icon),
    body: String(r.body ?? ''),
    // The stored icon is a caller-supplied string in a text column and is NOT
    // trusted to be an IconName — a row whose icon says 'x' would render
    // nothing at all. It is derived from the route instead, so every row draws
    // something, with the legacy message rows recognised above.
    icon: icon as IconName,
    // Through safeRoute either way, including the value this file just chose:
    // one path for validating a route means the group check cannot be skipped
    // by whichever branch somebody adds next.
    route: safeRoute(route, group),
    read: r.read === true,
    at: String(r.created_at ?? ''),
  };
};

export interface InboxValue {
  items: InboxItem[];
  /** Unread rows AMONG THE ONES WE HAVE. Under 'error' or 'partial' this is a
   *  floor, not a count, and the screen says so rather than printing it as a
   *  badge — see how `status` is used below. */
  unread: number;
  status: LoadStatus;
  /** Re-read from the server. Resolves when the read has settled either way. */
  refresh: () => Promise<void>;
  /** Mark everything unread as read. Returns how many rows the server actually
   *  changed — 0 means nothing was unread OR the call failed, and the boolean
   *  half of that is `ok`. PostgREST answers 200 to an UPDATE that matched
   *  nothing, so the count is the only way to tell the two apart. */
  markAllRead: () => Promise<{ ok: boolean; changed: number }>;
  /** Mark one row read. Same contract. */
  markRead: (id: string) => Promise<{ ok: boolean; changed: number }>;
  /** Put one row back to unread. The mirror of `markRead`, same contract. */
  markUnread: (id: string) => Promise<{ ok: boolean; changed: number }>;
  /** Remove one row for good. `why` is the sentence to show when it did not
   *  happen, from src/lib/wroteRows.ts, and is null when it did. The row is
   *  only taken off the list once the server has said it is gone. */
  remove: (id: string) => Promise<{ ok: boolean; why: string | null }>;
  /** Remove every row of mine that is marked read. Returns how many the server
   *  actually deleted — the count is the only thing that separates "there was
   *  nothing to clear" from "the policy refused every row". */
  clearRead: () => Promise<{ ok: boolean; changed: number }>;
}

/**
 * Am I really signed in, as the account these rows were read for?
 *
 * A PostgREST DELETE matching zero rows is not an error: it answers 204 with a
 * Content-Range header of zero rows, byte-for-byte what an RLS refusal answers.
 * Proved live tonight — `set local role authenticated` with a real
 * `request.jwt.claims`, a stranger deleting another account's notification:
 * 0 rows, no error. Signed out entirely, deleting the whole table: 0 rows, no
 * error.
 *
 * So before a zero can be reported as a failure of the ROW, the caller has to
 * rule out that it was a failure of the SESSION. `getUser()` reaches the server
 * and rejects when there is no valid one, which is exactly the distinction
 * `getSession()` cannot make — it reads a token off the phone that may have
 * expired hours ago. The load path deliberately uses `getSession()` (a
 * rejection there is a signed-out user, not a failed read); this is the one
 * place the stronger check is worth its round trip, because the alternative is
 * telling somebody their notification could not be deleted when the truth is
 * that they are no longer signed in.
 *
 * Same shape as src/ui/pushNotifications.ts `registerForPush`, which gates its
 * `push_tokens` upsert on getUser() for the same reason.
 */
async function signedInAs(expected: string | null): Promise<boolean> {
  if (!expected) return false;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return false;
    return data?.user?.id === expected;
  } catch { return false; }
}

export function useNotifications(group: AppVariant): InboxValue {
  const authRev = useAuthRevision();
  const [items, setItemsState] = useState<InboxItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const uid = useRef<string | null>(null);
  const listRef = useRef<InboxItem[]>([]);
  /** False once a read comes back truncated: caching a prefix would make the
   *  next launch open on part of the list with no way to know it. */
  const cacheable = useRef(true);

  const setItems = (next: InboxItem[], owner: string | null) => {
    listRef.current = next;
    setItemsState(next);
    if (owner && cacheable.current) {
      AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next)).catch(() => { /* the list is right this session either way */ });
    }
  };

  const load = useCallback(async (): Promise<void> => {
    let id: string | null = null;
    try {
      // getSession(), not getUser(): getUser() REJECTS when nobody is signed
      // in, and reading that rejection as a failed read is how sibling
      // providers in this folder used to latch into 'error' before anybody had
      // signed in at all.
      const { data: sess } = await supabase.auth.getSession();
      id = sess?.session?.user?.id ?? null;
    } catch { /* no local session; treated as signed out below */ }

    cacheable.current = true;
    // Signed out, or a build with no backend. Nothing is addressed to nobody,
    // and there is no absent server to misreport — so this is 'ready', and an
    // empty inbox here is a true statement.
    if (!id || !USE_SUPABASE) { uid.current = null; setItems([], null); setStatus('ready'); return; }
    uid.current = id;

    let local: InboxItem[] = [];
    try {
      const raw = await AsyncStorage.getItem(cacheKey(id));
      if (raw) local = (JSON.parse(raw) as any[]).map((r) => rowToItem(r, group));
    } catch { /* no usable cache; the server read below is the only source */ }
    if (local.length && !listRef.current.length) setItems(local, null);

    try {
      // No `.eq('user_id', …)`. `notif_self` is what decides whose rows come
      // back, and adding a second copy of that rule here would be a weaker one
      // that eventually disagrees with the policy. Verified live: a signed-in
      // account with three rows in the table sees only its own one.
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, icon, route, read, created_at')
        .order('created_at', { ascending: false })
        .limit(capLimit());
      // The cached list stays on screen and the status says it was not
      // confirmed. Clearing it would tell somebody they have no notifications,
      // which is the sentence src/ui/loadStatus.ts exists to prevent.
      if (error) { setStatus('error'); return; }
      const page = capped(data);
      if (page.truncated) cacheable.current = false;
      setItems(page.rows.map((r) => rowToItem(r, group)), page.truncated ? null : id);
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch {
      setStatus('error'); /* offline: whatever is cached stands, and now says so */
    }
  }, [group]);

  useEffect(() => { void load(); }, [load, authRev]);

  const markAllRead = useCallback(async (): Promise<{ ok: boolean; changed: number }> => {
    if (!USE_SUPABASE || !uid.current) return { ok: false, changed: 0 };
    try {
      // mark_notifications_read() rather than a PostgREST update, for one
      // reason: it returns the row count. `update().eq('read', false)` answers
      // 200 with an empty body whether it changed two hundred rows or none, so
      // a screen built on it can only ever claim success.
      const { data, error } = await supabase.rpc('mark_notifications_read');
      if (error) return { ok: false, changed: 0 };
      const changed = Number(data ?? 0);
      setItems(listRef.current.map((i) => (i.read ? i : { ...i, read: true })), uid.current);
      return { ok: true, changed: Number.isFinite(changed) ? changed : 0 };
    } catch { return { ok: false, changed: 0 }; }
  }, []);

  const markRead = useCallback(async (id: string): Promise<{ ok: boolean; changed: number }> => {
    if (!USE_SUPABASE || !uid.current) return { ok: false, changed: 0 };
    try {
      // `.select('id')` is not decoration. Without it PostgREST returns no
      // body and a row that RLS refused to touch is indistinguishable from one
      // that was already read — both are a silent 200.
      const { data, error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('read', false)
        .select('id');
      if (error) return { ok: false, changed: 0 };
      const changed = (data ?? []).length;
      if (changed) setItems(listRef.current.map((i) => (i.id === id ? { ...i, read: true } : i)), uid.current);
      return { ok: true, changed };
    } catch { return { ok: false, changed: 0 }; }
  }, []);

  /**
   * Put a row back to unread. The exact mirror of `markRead`, down to the
   * `.eq('read', true)` guard and the `.select('id')`, so that the two cannot
   * drift into reporting differently.
   *
   * It is here because it is CHEAP — one column, one row, a policy that already
   * permits it, no new function and no new grant — and because an inbox is used
   * as a to-do list. "Your coach asked for your intake" gets opened on a train
   * and dealt with at home, and without this the only way to keep it in view is
   * to not open it, which makes the unread mark a lie in the other direction.
   */
  const markUnread = useCallback(async (id: string): Promise<{ ok: boolean; changed: number }> => {
    if (!USE_SUPABASE || !uid.current) return { ok: false, changed: 0 };
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({ read: false })
        .eq('id', id)
        .eq('read', true)
        .select('id');
      if (error) return { ok: false, changed: 0 };
      const changed = (data ?? []).length;
      // The badge is `items.filter(i => !i.read).length` and is DERIVED, never
      // stored. That is what keeps the bell honest through this: putting a row
      // back to unread raises the count by exactly one because there is only one
      // number and this is it. A separate counter kept alongside the list is how
      // a bell and a list come to disagree.
      if (changed) setItems(listRef.current.map((i) => (i.id === id ? { ...i, read: false } : i)), uid.current);
      return { ok: true, changed };
    } catch { return { ok: false, changed: 0 }; }
  }, []);

  /**
   * Delete one row.
   *
   * ── The row is read before it is deleted ──────────────────────────────────
   *
   * `listRef.current.find(...)` is the read, and it is not a formality. "Zero
   * rows affected" is only evidence of a failure once it is established that a
   * row was there — and this list came back through `notif_self` moments ago,
   * so a row in it is a row the server showed this account. An id that is not
   * in the list is refused rather than sent, because a zero from an id nobody
   * read would be unattributable.
   *
   * ── The row leaves the screen only after the server says it is gone ───────
   *
   * Not optimistic. `deleteEntry` in app/(client)/workouts.tsx made exactly
   * this mistake and its comment records the fix: the row left the screen
   * whether or not the delete landed, so a refused one looked done and came
   * back at the next launch. Server first means there is no restore path to get
   * wrong, and a failed delete leaves the row exactly where it was — which is
   * the requirement, reached by not creating the problem.
   *
   * ── `{ count: 'exact' }` is the whole point ───────────────────────────────
   *
   * Without it `count` is null and src/lib/wroteRows.ts reports "the server did
   * not say whether it changed anything", which is the honest answer to a call
   * site that forgot to ask. With it, zero is a fact and gets a sentence.
   */
  const remove = useCallback(async (id: string): Promise<{ ok: boolean; why: string | null }> => {
    if (!USE_SUPABASE || !uid.current) return { ok: false, why: 'This notification could not be deleted.' };
    const row = listRef.current.find((i) => i.id === id);
    if (!row) return { ok: false, why: 'That notification is no longer on this list, so nothing was deleted.' };
    if (!(await signedInAs(uid.current))) {
      return { ok: false, why: 'Nothing was deleted — you are not signed in on this device any more. Sign in and try again.' };
    }
    try {
      const res = await supabase
        .from('notifications')
        .delete({ count: 'exact' })
        .eq('id', id);
      // `what` is the row in the reader's words, because writeFailure puts it
      // at the front of a sentence they will actually read.
      const why = writeFailure('This notification', res);
      if (why) return { ok: false, why };
      setItems(listRef.current.filter((i) => i.id !== id), uid.current);
      return { ok: true, why: null };
    } catch {
      return { ok: false, why: 'Nothing was deleted — the server did not answer.' };
    }
  }, []);

  /**
   * Delete every row of mine that is marked read.
   *
   * ── Why this is scoped by predicate and not by a list of ids ──────────────
   *
   * Sending the ids that are on screen would make the statement mean "the read
   * ones you can see", and the person asked for the read ones. The screen only
   * offers this under 'ready' (see `inboxControls`), where those two sets are
   * the same set — and under 'partial', where they are not, the control is not
   * offered at all rather than quietly meaning the narrower thing.
   *
   * ── Why `.eq('user_id', …)` is here when the SELECT deliberately has none ──
   *
   * The read above says so in its own comment: no second copy of `notif_self`,
   * because a duplicated rule is a weaker rule that eventually disagrees with
   * the policy. That argument is about a READ, where the cost of the policy
   * being wrong is seeing too much.
   *
   * This is a DELETE with no id in it. If `notif_self` is ever loosened or
   * dropped — and part 147 found a live policy that had silently drifted back
   * to an older definition — the blast radius of this one statement is every
   * read notification in the product. The column costs nothing, cannot be more
   * permissive than the policy, and turns that from a catastrophe into a no-op.
   * Verified live that RLS alone already scopes it correctly: one account's
   * clear-read deleted 2 of their own rows and none of the other account's.
   */
  const clearRead = useCallback(async (): Promise<{ ok: boolean; changed: number }> => {
    const me = uid.current;
    if (!USE_SUPABASE || !me) return { ok: false, changed: 0 };
    if (!(await signedInAs(me))) return { ok: false, changed: 0 };
    try {
      const res = await supabase
        .from('notifications')
        .delete({ count: 'exact' })
        .eq('user_id', me)
        .eq('read', true);
      // Zero is NOT a failure here, unlike the single-row delete: "nothing was
      // marked read" is a real and common outcome, and the caller is handed the
      // count so it can say which happened. `count == null` is a failure though
      // — it means nobody counted — which is what writeFailure checks for.
      if (res.error || res.count == null) return { ok: false, changed: 0 };
      setItems(listRef.current.filter((i) => !i.read), me);
      return { ok: true, changed: res.count };
    } catch { return { ok: false, changed: 0 }; }
  }, []);

  return {
    items,
    // Derived from the list on every render rather than tracked alongside it.
    // Deleting an unread row lowers this by one, marking one unread raises it by
    // one, and the bell cannot come to disagree with the list because there is
    // no second number for it to disagree with.
    unread: items.filter((i) => !i.read).length,
    status,
    refresh: load,
    markAllRead,
    markRead,
    markUnread,
    remove,
    clearRead,
  };
}

/* ── The bell ─────────────────────────────────────────────────────────────── */

/**
 * Each app's inbox, written out in full.
 *
 * Assembled as '/(' + group + ')/notifications' this would be invisible to
 * scripts/check-reachable.mjs, which greps for the literal `(group)/name` and
 * says so in its own header: a route built at runtime cannot be seen, and a
 * screen reached only that way is reported unreachable. Three literals cost
 * nothing and keep the bell counting as a real way in.
 */
const INBOX_ROUTE: Record<AppVariant, string> = {
  client: '/(client)/notifications',
  trainer: '/(trainer)/notifications',
  owner: '/(owner)/notifications',
};

/**
 * The bell in a dashboard header, with a mark that is true.
 *
 * The client app's bell has existed since before the inbox did and routed to
 * the message thread, because there was nowhere else for it to go. It goes here
 * now, and the coach and owner dashboards get the same control.
 *
 * WHAT THE MARK MEANS, and why it is not `unread > 0`: the count is taken over
 * the rows this hook is HOLDING, and how much of the set that is depends on how
 * the read went. src/lib/notifyInbox.ts `unreadBadge` decides; the four
 * outcomes it can return are drawn here and nowhere else. The one that matters
 * is 'unknown' — a read that failed must not render as an unmarked bell, since
 * an unmarked bell is the app stating "nothing for you" in the one place
 * somebody checks before deciding not to open the inbox at all.
 */
export function NotificationBell({ group }: { group: AppVariant }) {
  const t = useTheme();
  const router = useRouter();
  const { unread, status } = useNotifications(group);
  const badge = unreadBadge(unread, status);
  return (
    <View>
      {/* The spoken label carries the count, or the fact that there is not one.
          A badge nobody can see is the same defect as a badge that is wrong. */}
      <Ghost
        icon="bell"
        a11yLabel={badge.kind === 'none' ? 'Notifications' : badge.a11y}
        onPress={() => router.push(INBOX_ROUTE[group] as any)}
      />
      {/* pointerEvents none: the mark sits over the corner of a 38pt target and
          must not be the thing a thumb lands on. Hidden from the screen reader
          because the Ghost above already says all of this in words. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: badge.kind === 'count' ? -4 : 2, right: badge.kind === 'count' ? -4 : 2 }}
      >
        {badge.kind === 'count' ? (
          <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: t.brand, borderWidth: 2, borderColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...ty.micro, fontWeight: '700', color: t.brandInk }} numberOfLines={1}>{badge.label}</Text>
          </View>
        ) : badge.kind === 'some' ? (
          // Truncated read: there IS something unread, and the number would be
          // a floor over an unknown fraction of the set. A solid dot says the
          // true half and does not print the false half.
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.brand, borderWidth: 2, borderColor: t.bg }} />
        ) : badge.kind === 'unknown' ? (
          // Hollow, in the quiet ink rather than the brand: this is not "you
          // have some", it is "we could not find out". Drawing nothing here is
          // the failure this whole component exists to avoid.
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.bg, borderWidth: 1.5, borderColor: t.ink3 }} />
        ) : null}
      </View>
    </View>
  );
}

/* ── The screen ───────────────────────────────────────────────────────────── */

export interface InboxFraming {
  /** This build's route group. Passed rather than read from src/lib/variant.ts
   *  because each route file already knows which group it is in, and VARIANT
   *  falls back to 'client' under a bare `expo start` — which would make the
   *  coach's inbox refuse every coach route in development. */
  group: AppVariant;
  /** The small line above the title. */
  kicker: string;
  /** What this screen is called here. */
  title: string;
  /** One line under the title, in this app's voice. */
  blurb: string;
  /** What a genuinely empty inbox says. Only ever shown under 'ready'. */
  emptyTitle: string;
  emptyNote: string;
}

export function NotificationInbox(f: InboxFraming) {
  const t = useTheme();
  const router = useRouter();
  const { items, unread, status, refresh, markAllRead, markRead, markUnread, remove, clearRead } = useNotifications(f.group);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Tracked here rather than read off `status`. A pull-to-refresh does not put
  // the hook back into 'loading' — deliberately, because that would swap the
  // rows the person is looking at for a skeleton — so the spinner needs its own
  // flag or it never appears and the gesture looks broken.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setNote(null);
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  // Whether the list may be spoken about as a whole. `unread` counts the rows
  // we are holding; under 'error' those are a cached copy of unknown age and
  // under 'partial' they are a prefix, so in both cases a badge reading "3" is
  // a figure computed from an unknown fraction of the set. It is not shown.
  //
  // The same decision as the bell's, taken by the same function, so the pill up
  // here and the mark on the dashboard cannot come to disagree about what a
  // failed read means. It also formats: this is a count of rows in a table with
  // no ceiling, and `1204 new` is what num() exists to stop.
  const badge = unreadBadge(unread, status);

  // What this screen is allowed to destroy, given how the read went. The whole
  // rule and its reasoning are in src/lib/notifyInbox.ts; the short version is
  // that nothing may be deleted over a list nobody confirmed ('error'), and
  // "Clear Read" may not be offered over a list that is only a prefix
  // ('partial') because its confirmation would name a number taken over part of
  // the set while the statement itself would sweep all of it.
  const controls = inboxControls(status);
  const readCount = items.filter((i) => i.read).length;
  const clearPrompt = clearReadPrompt(readCount, status);

  const onMarkAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await markAllRead();
      // Three outcomes, three sentences. The middle one is the one that gets
      // written as "Done" everywhere else in this codebase and is the reason
      // the RPC returns a count at all.
      setNote(!res.ok
        ? 'Could not mark them read — the server did not answer. Nothing has changed.'
        : res.changed === 0
          ? 'Nothing was unread.'
          : `Marked ${res.changed} as read.`);
    } finally { setBusy(false); }
  };

  /* ── Removing ───────────────────────────────────────────────────────────
   *
   * WHICH CONTROL, AND WHY NOT A SWIPE. There is no swipe-to-delete anywhere in
   * this codebase — no Swipeable, no PanResponder, nothing to be consistent
   * with — so adding one here would introduce a gesture that exists on exactly
   * one screen, is invisible to a screen reader, and has no discoverable
   * affordance. The house pattern for a destructive action on a row is an
   * explicit trailing control: `app/(client)/workouts.tsx` puts a `minus` in
   * `t.crit` at the end of every logged exercise, with an accessibilityLabel
   * naming the thing. That is what is used here, unchanged.
   *
   * WHETHER IT CONFIRMS. It does NOT, and that is a deliberate departure from
   * the confirm-everything habit of `deleteEntry` and `app/(owner)/deletions.tsx`.
   * The reason is what the row IS. Deleting a workout entry destroys the record
   * of something somebody did; deleting the account of a member cascades across
   * 39 tables. A notification is a COPY of something that already happened —
   * the session is still cancelled, the invoice is still owed, the booking is
   * still in the calendar — so the cost of a mis-tap is losing a duplicate of a
   * fact that is still recorded in the place it belongs.
   *
   * Against that sits the cost of confirming: an inbox is triaged, and forty
   * rows at two taps each is eighty taps, which is precisely the pressure that
   * drives somebody to the bulk control instead. Making the per-row action one
   * tap is what keeps the dangerous control from being the convenient one.
   *
   * What replaces the confirmation is verification: `remove()` does not take the
   * row off the list until the server has said it is gone, and says so in a
   * sentence when it has not.
   */
  const onDelete = async (item: InboxItem) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await remove(item.id);
      // Only the failure gets a sentence. The row disappearing IS the success
      // message, and a note under a list that visibly shrank is noise.
      setNote(deletedNote(item.heading ?? 'That notification', res.why));
    } finally { setBusy(false); }
  };

  /** Back to unread, so the inbox can be used as a to-do list. Offered only on
   *  rows that are read — on an unread row it is a control that does nothing. */
  const onMarkUnread = async (item: InboxItem) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await markUnread(item.id);
      setNote(res.ok && res.changed
        ? null
        : 'That notification was not marked unread — the server did not confirm it, so it still reads as read.');
    } finally { setBusy(false); }
  };

  /** Clear Read. Confirmed, and the confirmation names the figure — see
   *  `clearReadPrompt`, which is also what decides the control may be shown. */
  const onClearRead = () => {
    if (busy || !clearPrompt) return;
    Alert.alert(
      clearPrompt.title,
      clearPrompt.message,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: clearPrompt.confirm, style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            const res = await clearRead();
            setNote(clearedNote(res.ok, res.changed));
          } finally { setBusy(false); }
        } },
      ],
    );
  };

  const open = async (item: InboxItem) => {
    // Read state first, and it is not conditional on the row going anywhere:
    // opening a notification is the act of reading it, and a row with no
    // navigable route is still one the person has now seen.
    if (!item.read) await markRead(item.id);
    if (item.route) { try { router.push(item.route as any); } catch { /* a route this build does not contain */ } }
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.ink3} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{f.kicker}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{f.title}</Text>
          </View>
          {badge.kind === 'count' ? (
            <View style={{ paddingHorizontal: sp.md, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: t.brand }}>
              {/* caption, not micro: micro uppercases, and "3 NEW" is the same
                  defect as the "2H" timestamp below — a word beside a figure,
                  shouted. */}
              <Text style={{ ...ty.caption, fontWeight: '700', color: t.brandInk }}>{badge.label} new</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>{f.blurb}</Text>

        {status === 'error' ? (
          // Deliberately NOT "you have no notifications". Under 'error' an
          // empty list means we could not find out, and a non-empty one is a
          // cached copy that may be stale — both are said here rather than
          // left to be inferred from a list that looks authoritative.
          <Notice
            tone={t.crit}
            kicker="Not confirmed"
            title={items.length ? 'This is the last copy on this phone' : 'Your notifications could not be read'}
            note={items.length
              ? 'The server did not answer, so anything sent since you were last connected is not on this list.'
              : 'The server did not answer. This is not the same as having none — pull down to try again once you have a connection.'}
          />
        ) : null}

        {status === 'partial' ? <PartialRead what="notifications" shown={items.length} onPress={() => void onRefresh()} /> : null}

        {note ? <Notice kicker="Inbox" title={note} /> : null}

        <Rule />

        {status === 'loading' && !items.length ? (
          <View style={{ paddingTop: sp.lg }}><SkeletonList n={4} /></View>
        ) : null}

        {status === 'ready' && !items.length ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Icon name="bell" size={26} color={t.ink3} />
            <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>{f.emptyTitle}</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, textAlign: 'center' }}>{f.emptyNote}</Text>
          </View>
        ) : null}

        {items.map((item, i) => (
          <View
            key={item.id}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}
          >
            {/* The row's own tap target stops at the controls. Nesting the
                delete inside the Pressable that opens the notification would
                make one of them swallow the other's tap on Android, and the
                one that lost would be whichever the platform felt like. */}
            <Pressable
              onPress={() => void open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.heading ?? 'Notification'}. ${item.body}`}
              accessibilityState={{ selected: !item.read }}
              style={{ flex: 1, flexDirection: 'row', gap: sp.md }}
            >
              <View style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: item.read ? t.surface2 : t.surface3 }}>
                <Icon name={item.icon} size={17} color={item.read ? t.ink3 : t.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  {/* NOT `item.title ?? f.title`. That drew the SCREEN's name —
                      "Notifications" — over every untitled row, which reads as
                      a heading somebody wrote and says nothing. `inboxHeading`
                      returns a true one or none at all; when it is none the
                      body moves up into this line's place and the age still
                      has a row to sit on. */}
                  {item.heading ? (
                    <Text style={{ ...ty.label, fontWeight: item.read ? '500' : '700', color: t.ink, flex: 1 }} numberOfLines={1}>
                      {item.heading}
                    </Text>
                  ) : (
                    <View style={{ flex: 1 }} />
                  )}
                  {/* ty.caption, not ty.micro: micro carries
                      `textTransform: 'uppercase'` and rendered a two-hour-old
                      notification as "2H". A unit beside a figure is lowercase
                      everywhere else in this app (kg, kcal, min), and an
                      uppercased aside shouts as loudly as the heading it sits
                      next to. Same change, same reason, as the `Field` hint in
                      src/ui/kit.tsx. */}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{inboxAge(item.at)}</Text>
                  {/* The unread mark is per row and needs no whole-list read to
                      be true: this row came back with read=false, whatever the
                      status of the set it arrived in. */}
                  {!item.read ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.brand }} /> : null}
                </View>
                <Text style={{ ...ty.label, color: item.read ? t.ink3 : t.ink2, marginTop: item.heading ? 3 : 0 }}>{item.body}</Text>
                {item.route ? null : (
                  // A row whose stored route this build will not follow. Saying
                  // so is better than a tap that appears to do nothing. Caption
                  // rather than micro for the same reason as the age above:
                  // this is a sentence, and micro would shout it.
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>Nothing to open</Text>
                )}
              </View>
            </Pressable>

            {/* Back to unread, on read rows only — on an unread row it is a
                control that cannot do anything. `eye-off` because that is what
                it means: not seen. */}
            {controls.markUnread && item.read ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark ${item.heading ?? 'this notification'} as unread`}
                onPress={() => void onMarkUnread(item)}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <Icon name="eye-off" size={16} color={t.ink3} />
              </Pressable>
            ) : null}

            {/* The house control for a destructive row action, taken verbatim
                from app/(client)/workouts.tsx: a `minus` in the critical tone
                with a label that names the row. `color` on an Icon is a prop
                and not a text style, which is why t.crit is allowed here and
                is not what scripts/check-contrast.mjs is looking for. */}
            {controls.rowDelete ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.heading ?? 'this notification'}`}
                onPress={() => void onDelete(item)}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <Icon name="minus" size={16} color={t.crit} />
              </Pressable>
            ) : null}
          </View>
        ))}

        {items.length > 0 && (items.some((i) => !i.read) || clearPrompt) ? (
          <View style={{ marginTop: layout.section, flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
            {items.some((i) => !i.read) ? (
              <Ghost label={busy ? 'Working…' : 'Mark All Read'} icon="check" onPress={() => void onMarkAll()} />
            ) : null}
            {/* Only ever rendered under 'ready' with something to clear —
                `clearReadPrompt` returns null otherwise, so the button and its
                confirmation can never come apart. There is deliberately no
                "Clear All": see the note below. */}
            {clearPrompt ? (
              <Ghost label={busy ? 'Working…' : clearPrompt.label} icon="minus" onPress={onClearRead} />
            ) : null}
          </View>
        ) : null}

        {/* Why a control is missing, rather than it silently not being there.
            Under 'error' this is the important one: the screen already says the
            list is unconfirmed, and this says what that costs. */}
        {controls.withheld && items.length > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{controls.withheld}</Text>
        ) : null}

        {/* WHY THERE IS NO "CLEAR ALL".
            An unread notification is one the person has not seen, and the only
            bulk control that cannot destroy something unseen is one scoped to
            `read = true`. A "Clear All" over a truncated read deletes rows that
            were never on screen; over a failed one it deletes on the strength
            of a cached list nobody confirmed. And the escape hatch already
            exists and is two taps — Mark All Read, then Clear Read — which
            forces the person to state "I have seen these" before "remove
            these". That is a better sequence than one button that means both. */}
      </ScrollView>
    </SafeAreaView>
  );
}
