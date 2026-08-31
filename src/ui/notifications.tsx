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
// layout file. Nothing else needs this data yet — the dashboard bell that
// should carry an unread count is in a file this work does not own, and when
// somebody wires it up, promoting this to a provider is the change to make.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { inboxAge, inboxIcon, safeRoute } from '../lib/notifyInbox';
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
  return {
    id: String(r.id),
    title: r.title != null && String(r.title).trim() ? String(r.title).trim() : null,
    body: String(r.body ?? ''),
    // The stored icon is a caller-supplied string in a text column and is NOT
    // trusted to be an IconName — a row whose icon says 'x' would render
    // nothing at all. It is derived from the route instead, so every row draws
    // something, with the legacy message rows recognised above.
    icon: (isLegacyMessage ? 'message' : inboxIcon(r.route)) as IconName,
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

  return {
    items,
    unread: items.filter((i) => !i.read).length,
    status,
    refresh: load,
    markAllRead,
    markRead,
  };
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
  const { items, unread, status, refresh, markAllRead, markRead } = useNotifications(f.group);
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
  const counted = status === 'ready';

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
          {counted && unread > 0 ? (
            <View style={{ paddingHorizontal: sp.md, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: t.brand }}>
              <Text style={{ ...ty.micro, fontWeight: '700', color: t.brandInk }}>{unread} new</Text>
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
          <Pressable
            key={item.id}
            onPress={() => void open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title ?? 'Notification'}. ${item.body}`}
            accessibilityState={{ selected: !item.read }}
            style={{ flexDirection: 'row', gap: sp.md, paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}
          >
            <View style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: item.read ? t.surface2 : t.surface3 }}>
              <Icon name={item.icon} size={17} color={item.read ? t.ink3 : t.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: item.read ? '500' : '700', color: t.ink, flex: 1 }} numberOfLines={1}>
                  {item.title ?? f.title}
                </Text>
                <Text style={{ ...ty.micro, color: t.ink3 }}>{inboxAge(item.at)}</Text>
                {/* The unread mark is per row and needs no whole-list read to
                    be true: this row came back with read=false, whatever the
                    status of the set it arrived in. */}
                {!item.read ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.brand }} /> : null}
              </View>
              <Text style={{ ...ty.label, color: item.read ? t.ink3 : t.ink2, marginTop: 3 }}>{item.body}</Text>
              {item.route ? null : (
                // A row whose stored route this build will not follow. Saying
                // so is better than a tap that appears to do nothing.
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: 4 }}>Nothing to open</Text>
              )}
            </View>
          </Pressable>
        ))}

        {items.some((i) => !i.read) ? (
          <View style={{ marginTop: layout.section, alignItems: 'flex-start' }}>
            <Ghost label={busy ? 'Marking…' : 'Mark All Read'} icon="check" onPress={() => void onMarkAll()} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
