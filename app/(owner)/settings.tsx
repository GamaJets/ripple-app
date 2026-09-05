// Owner · Settings. Who is signed in, sign out, export my data, delete my
// account.
//
// WHY THIS FILE EXISTS. Repple Studio had no settings screen at all, which
// means it offered account creation and no in-app way to ask for the account
// back. Google Play requires the second wherever you do the first. The client
// app has carried `app/(client)/settings.tsx` for months; this is the same four
// capabilities, on the same `gdpr.ts` functions, for the gym owner.
//
// WHY THE OWNER'S DELETE IS NOT THE MEMBER'S DELETE. Two facts from
// 41-account-deletion.sql make this materially different:
//
//   · `action_account_deletion()` guards on `is_owner_of(subj_tenant)`. Only an
//     owner of a gym can action a deletion request at that gym. So the queue on
//     `/(owner)/deletions` — every member and coach waiting to be erased — is
//     actionable by this person and by any co-owner, and by nobody else. An
//     owner who deletes themselves while they are the last owner leaves those
//     requests with no one who can carry them out. The 30-day clock keeps
//     running; there is simply nobody left to stop it.
//
//   · The gym is not the account. `tenants` and everything hanging off it —
//     members, trainers, classes, equipment, the deletion log — survive the
//     owner's profile. Deleting the owner does not close the gym; it leaves the
//     gym without an owner. That is the opposite of what "delete my account"
//     sounds like it does, so the confirmation says it in those words.
//
// Both facts are stated from REAL numbers, read here and error-checked: how
// many people are actually waiting, and how many other owners actually remain.
// When either read fails the confirmation says it could not check, rather than
// implying a clear path. supabase-js resolves on a database error, so `.error`
// is checked on every query — a swallowed RLS denial would otherwise arrive as
// `data: null`, count as zero, and tell an owner "nobody is waiting on you"
// because the read broke.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, Flag, fig } from '../../src/ui/kit';
import { RepdbAttribution } from '../../src/ui/Attribution';
import { sp, layout, hairline, type as ty, radius } from '../../src/theme/scale';
import { BuildInfo } from '../../src/ui/BuildInfo';
import { useAuth } from '../../src/ui/auth';
import { useAppLock } from '../../src/ui/appLock';
import { useSettings } from '../../src/ui/settings';
import { lockSettingNote } from '../../src/lib/appLock';
import { isoDate } from '../../src/lib/format';
import { useTenant } from '../../src/ui/tenant';
import { exportMyDataDetailed, requestAccountDeletion, withdrawAccountDeletion } from '../../src/lib/gdpr';
import { shareTextFile } from '../../src/lib/exportShare';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BACK_ICON, END_ALIGN } from '../../src/ui/direction';

/** A label and its value. `value` is already a string — see `fig`. */
function Line({ t, label, value, first }: { t: Theme; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: END_ALIGN }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// Four, since supabase/parts/711 added the front desk. The line below falls
// back to the raw value for anything not here, so an omission renders
// 'receptionist' rather than nothing — but a person reading "Role" on their own
// account settings should be told what they are in the product's words, not in
// the column's.
const ROLE_LABEL: Record<string, string> = {
  owner: 'Gym owner', trainer: 'Trainer', client: 'Member', receptionist: 'Reception',
};

/** A timestamp as the day it happened, or a dash. Never the string "null". */
function day(iso: string | null): string {
  if (!iso) return '—';
  // Parsed, not sliced. Every value that reaches here is a `timestamptz` —
  // profiles.deletion_requested_at, deletion_log.requested_at and .actioned_at,
  // all three confirmed against the live schema — and PostgREST serialises
  // those in UTC. `String(iso).slice(0, 10)` is therefore Greenwich's calendar
  // day, not anybody's.
  //
  // check-utc-day.mjs deliberately does not flag this shape; its header says
  // whether a slice is wrong "depends entirely on what column `iso` came from"
  // and that telling them apart "needs the schema, not the line". This is the
  // case where the schema says it is wrong.
  //
  // A member in Dubai (UTC+4) asking to be deleted at 01:30 on 6 September
  // stores 2026-09-05T21:30Z, and this queue said they asked on the 5th — in
  // the two-step confirmation of an irreversible delete, and permanently in the
  // audit log below it. In Los Angeles it runs the other way.
  //
  // The reader's own day, because neither screen reads a gym timezone and no
  // tenant has one set — the same fallback financials.tsx and equipment.tsx
  // take.
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? isoDate(new Date(ms)) : '—';
}

/** Everything the owner's confirmation needs, or nulls where a read failed. */
interface OwnerFacts {
  /** People other than this owner waiting to be erased at this gym. */
  waiting: number | null;
  /** Owners of this gym other than this one. */
  coOwners: number | null;
  /** When this owner asked to be deleted, if they already have. */
  requestedAt: string | null;
  /** True once the profile read itself succeeded. */
  selfRead: boolean;
}

export default function OwnerSettings() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const lock = useAppLock();
  const st = useSettings();
  const toggleLock = async () => {
    if (!lock.available) {
      Alert.alert('Not available on this device',
        'Set up Face ID, Touch ID or a passcode in iOS Settings, then this can be turned on.');
      return;
    }
    const want = !lock.enabled;
    const ok = await lock.setEnabled(want);
    if (!ok && want) {
      Alert.alert('Not turned on', `${lock.label} was not confirmed, so the lock is still off.`);
    }
  };

  // ── The owner had no notification preference at all ───────────────────────
  //
  // Not a broken switch — no switch, the same gap the coach app had before
  // app/(trainer)/settings.tsx closed it. Repple Studio receives pushes like
  // everybody else, and src/ui/auth.tsx registered every signed-in owner's
  // handset in `push_tokens` unconditionally, so an owner was the one role in
  // this product that could be reached and could not say no. Members could opt
  // out, coaches could opt out, the person who runs the gym could not.
  //
  // This is the client's mechanism reused, not a third implementation.
  // `useSettings()` is mounted app-wide in app/_layout.tsx, so it already wraps
  // these routes. The switch does not filter sends: it takes this handset's row
  // OUT of `push_tokens`, which is the table the send-push edge function
  // resolves recipients from, so it reaches every sender at once rather than
  // each of two dozen call sites. src/ui/settings.tsx carries the long note.
  const togglePush = async () => {
    const want = !st.notifPush;
    const res = await st.setPushEnabled(want);
    if (res === 'on' || res === 'off') return;
    if (res === 'no-build') {
      Alert.alert('Not on this build yet',
        'This version of the app cannot receive push notifications at all — that needs a new build from the App Store, not a setting. Your choice has been saved and will apply as soon as you have one.');
      return;
    }
    if (res === 'os-refused') {
      // Not "…switched off for Repple Studio". This is a white-label build and
      // the app on this phone may not be called Repple at all.
      Alert.alert('Turned off on your phone',
        "Notifications are switched off for this app in your phone's own Settings, so nothing can be delivered until you turn them back on there. Your choice here has been saved.");
      return;
    }
    // 'off-pending'. Said out loud rather than hoped over: somebody who has just
    // turned notifications off and then gets one needs to have been told it
    // might happen. The reconciler in src/ui/settings.tsx retries every launch.
    Alert.alert('Saved, but not confirmed',
      "Push notifications are off from now on, but we couldn't confirm this phone has been taken off the list — you may still get one until the next time you open the app. Nothing else has changed.");
  };

  const { tenant, loading: tenantLoading, status: tenantStatus, refresh: refreshTenant } = useTenant();

  // null = nothing read yet. A loaded object may still carry nulls, one per
  // read that failed — "not known" survives all the way into the dialog copy.
  const [facts, setFacts] = useState<OwnerFacts | null>(null);
  /** When the three reads below last LANDED, and whether one is in flight.
   *  The last owner screen with fetched figures on it and no way to ask again:
   *  the deletion queue and the co-owner count are read once at mount and then
   *  sat there, so an owner who had just approved a deletion on the console was
   *  reading a count from whenever this screen happened to open. */
  const [factsAt, setFactsAt] = useState<number | null>(null);
  /** The gym's own row is the other server read on this screen — the "Gym"
   *  line below — and it was outside both the stamp and the refresh. */
  const [tenantAt, setTenantAt] = useState<number | null>(null);
  const [reloading, setReloading] = useState(false);

  /**
   * Reads the three facts AND HANDS THEM BACK.
   *
   * It used to write them into state and return nothing, and the two deletion
   * flows below both called it and then announced their own outcome without
   * consulting it. The evidence was fetched and thrown away — see the note on
   * `withdraw`. Returning the object is what lets those two say what the
   * server actually holds rather than what the button hoped it would.
   */
  const readFacts = useCallback(async (): Promise<OwnerFacts> => {
    const unread: OwnerFacts = { waiting: null, coOwners: null, requestedAt: null, selfRead: false };
    if (!USE_SUPABASE) { setFacts(unread); return unread; }
    let uid: string | null = null;
    try {
      const { data: a } = await supabase.auth.getUser();
      uid = a?.user?.id ?? null;
    } catch (e) { reportError('ownerSettings.auth', e); }
    if (!uid) { setFacts(unread); return unread; }
    const me = uid;

    // The three reads fail independently. A gym that cannot read its own
    // owner roster still has to be told how many people are waiting on it.
    const [q, o, p] = await Promise.allSettled([
      // COUNTED BY THE SERVER, and the exclusion of self is a `neq` rather
      // than a filter afterwards.
      //
      // Both of these were bare `.select()` with no bound, and PostgREST caps
      // an unbounded read at a thousand rows in silence (src/lib/rowCap.ts).
      // The two numbers they produce are then stated as fact in a dialog about
      // permanent erasure: "N people are waiting to be erased at your gym" and
      // "N other owners would remain and could action them". A count taken over
      // a truncated read is not a smaller number, it is a wrong one, and
      // `deletions.tsx` reads this same view under a comment saying that
      // "implausible" is not a good enough reason to leave a count unprobed.
      //
      // `head: true` with an exact count answers both without a row cap
      // existing at all: the server counts and sends no rows, so there is
      // nothing to truncate. `pending_deletions` is security_invoker and scoped
      // to the caller's own gym by RLS — no tenant filter here, on purpose.
      supabase.from('pending_deletions').select('subject_id', { count: 'exact', head: true }).neq('subject_id', me),
      // `profiles_owner_r` scopes this to the caller's tenant.
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner').neq('id', me),
      supabase.from('profiles').select('deletion_requested_at').eq('id', me).maybeSingle(),
    ]);

    // `count` and not `data.length` — `head: true` returns no rows at all, so
    // a length here would be a confident nought over a gym with a queue. A
    // null count from a settled read is still "not known" and stays null,
    // which the copy below already distinguishes from zero.
    let waiting: number | null = null;
    if (q.status === 'fulfilled' && !q.value.error) {
      waiting = (q.value as { count?: number | null }).count ?? null;
    } else {
      reportError('ownerSettings.queue', q.status === 'rejected' ? q.reason : q.value.error);
    }

    let coOwners: number | null = null;
    if (o.status === 'fulfilled' && !o.value.error) {
      coOwners = (o.value as { count?: number | null }).count ?? null;
    } else {
      reportError('ownerSettings.owners', o.status === 'rejected' ? o.reason : o.value.error);
    }

    let requestedAt: string | null = null;
    let selfRead = false;
    if (p.status === 'fulfilled' && !p.value.error) {
      requestedAt = p.value.data?.deletion_requested_at ?? null;
      selfRead = true;
    } else {
      reportError('ownerSettings.self', p.status === 'rejected' ? p.reason : p.value.error);
    }

    const read: OwnerFacts = { waiting, coOwners, requestedAt, selfRead };
    setFacts(read);
    return read;
  }, []);

  const load = useCallback(async (): Promise<OwnerFacts> => {
    setReloading(true);
    try {
      return await readFacts();
      // Stamped once, at the end, because the three reads land together as far
      // as this screen is concerned — `readFacts` settles all three and writes
      // one object. A read that failed leaves its own field null and the stamp
      // still moves, which is right: the screen DID ask, just now, and the
      // nulls beside it are what came back.
      setFactsAt(Date.now());
    } finally {
      setReloading(false);
    }
  }, [readFacts]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tenantStatus === 'ready') setTenantAt(Date.now()); }, [tenantStatus]);

  /** One line over both reads, and it is the age of the older. */
  const fetchedAt = oldestFetch(factsAt, tenantAt);
  /** Both. The button ran only the account facts, so the gym name beside them
   *  stayed at whatever the first read returned. */
  const refreshAll = useCallback(() => { void load(); refreshTenant(); }, [load, refreshTenant]);
  const pull = usePullToRefresh(refreshAll);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportMyDataDetailed();
      const json = res.json;
      await shareTextFile(json, 'repple-studio-my-data.json', 'application/json', 'Export my data');
      if (!res.complete) {
        // A partial export handed over silently is the same failure one level
        // up: somebody deletes their account believing they have a copy.
        Alert.alert(
          'That copy is incomplete',
          `${res.failed.length} part${res.failed.length === 1 ? '' : 's'} of your record could not be read `
          + `(${res.failed.map((f) => f.table).join(', ')}). The file has been saved and says so inside, `
          + 'but do not treat it as a full copy, and do not delete your account on the strength of it. '
          + 'Try again in a moment, or email support@repplefitness.com.',
        );
      }
    } catch (e) {
      reportError('ownerSettings.export', e);
      Alert.alert('Export failed', 'Nothing was exported. Check your connection and try again.');
    } finally { setExporting(false); }
  };

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need your email and password to sign back in. Nothing is deleted.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('ownerSettings.signOut', e); } } },
    ]);
  };

  const gym = tenant?.name ?? null;

  /** What the queue actually says, or that it could not be read. */
  const queueLine = (): string => {
    if (!facts) return 'Your gym\'s deletion queue has not been read yet, so this cannot tell you who is waiting on you.';
    if (facts.waiting == null) return 'Your gym\'s deletion queue could not be read, so this cannot tell you who is waiting on you. That is a read failure, not an all-clear.';
    if (facts.waiting === 0) return 'Nobody else at your gym is waiting to be erased right now.';
    return `${facts.waiting} ${facts.waiting === 1 ? 'person is' : 'people are'} waiting to be erased at your gym, and only a gym owner can action those requests.`;
  };

  /** Whether anyone would be left to action them. */
  const ownersLine = (): string => {
    if (!facts || facts.coOwners == null) return 'Whether another owner would remain to action them could not be checked.';
    if (facts.coOwners === 0) return 'You are the only owner. Once your account is gone, nobody can action them and the 30-day clock keeps running.';
    return `${facts.coOwners} other ${facts.coOwners === 1 ? 'owner' : 'owners'} would remain and could action them.`;
  };

  const run = async () => {
    setDeleting(true);
    try {
      const ok = await requestAccountDeletion();
      if (!ok) {
        // `requestAccountDeletion` returns false only when the write was
        // refused. Saying "noted" here would be inventing a promise.
        Alert.alert('Not requested', 'Your deletion request was not recorded — nothing has changed. Check your connection and try again.');
        return;
      }
      // The re-read is CONSULTED, not merely performed.
      //
      // `requestAccountDeletion` returns `!error`, and the RPC it calls is
      // `returns void` ending in an UPDATE with `and deletion_requested_at is
      // null` on it — so a request that matched no row comes back as a plain
      // success. This screen then re-read `deletion_requested_at`, which is the
      // exact flag the write was supposed to set, and announced the outcome
      // without looking at it. The evidence was fetched and thrown away.
      const after = await load();
      if (after.selfRead && after.requestedAt == null) {
        Alert.alert(
          'Not requested',
          'The server accepted that request and then reported no deletion pending on your account, so nothing has been recorded. Nothing has been deleted either. Try again, and if it keeps happening email support@repplefitness.com from the address on your account.',
        );
        return;
      }
      Alert.alert(
        'Deletion requested',
        (after.selfRead
          ? ''
          : 'Your account could not be re-read afterwards, so this could not confirm the request is now pending — check Deletion requests before relying on it.\n\n') +
        'Your request is recorded and now appears in Deletion requests alongside everyone else waiting. Only a gym owner can action it — which, while you are still signed in, means you.\n\nStaying signed in lets you carry it out yourself. Signing out leaves it for another owner.',
        [
          { text: 'Stay signed in', style: 'cancel' },
          { text: 'Open Deletion requests', onPress: () => router.push('/(owner)/deletions') },
          { text: 'Sign out', style: 'destructive', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('ownerSettings.signOut', e); } } },
        ],
      );
    } catch (e) {
      reportError('ownerSettings.delete', e);
      Alert.alert('Not requested', 'Your deletion request was not recorded — nothing has changed. Check your connection and try again.');
    } finally { setDeleting(false); }
  };

  /**
   * Two confirmations. The first carries the consequences that are specific to
   * being an owner — the queue only an owner can clear, and whether anyone is
   * left to clear it. The second exists because "delete my account" and "close
   * my gym" sound like the same sentence and are not, and because the
   * destructive tap should never be the one already under your thumb.
   */
  const deleteAccount = () => {
    Alert.alert(
      'Delete your owner account?',
      'This asks for your own account and everything of yours to be permanently erased.\n\n' +
      `It does not close ${gym ?? 'your gym'}. The gym, its members, its trainers, its classes and its records all stay — they just stay without you.\n\n` +
      `${queueLine()}\n\n${ownersLine()}`,
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Continue', style: 'destructive', onPress: () => {
            Alert.alert(
              'This does not close your gym',
              `${gym ?? 'Your gym'} and everything recorded against it stays after your account is gone. If you meant to close the gym, or to hand it to someone else, do that first — deleting your account will not do it, and afterwards there may be no owner left who can.\n\n` +
              'Request permanent erasure of your own account now?',
              [
                { text: 'Keep my account', style: 'cancel' },
                { text: 'Request deletion', style: 'destructive', onPress: () => { void run(); } },
              ],
            );
          },
        },
      ],
    );
  };

  const withdraw = () => {
    Alert.alert(
      'Withdraw your deletion request?',
      'Your owner account and everything in it will be kept. You can ask to be deleted again at any time.',
      [
        { text: 'Leave it pending', style: 'cancel' },
        { text: 'Withdraw request', onPress: async () => {
          if (withdrawing) return;
          setWithdrawing(true);
          try {
            const ok = await withdrawAccountDeletion();
            if (!ok) {
              reportError('ownerSettings.withdraw', new Error('withdraw_account_deletion did not clear the request'));
              Alert.alert('Not withdrawn', 'Your deletion request is still in place — nothing has changed. Check your connection and try again, or email support@repplefitness.com from the address on your account.');
              return;
            }
            // Consulted rather than assumed, exactly as `run` above now does.
            // `withdrawAccountDeletion` is documented as returning true "if the
            // flag was cleared" and in fact returns `!error` over a
            // `returns void` RPC. Telling somebody their erasure request is
            // withdrawn when it is still open and still actionable by any
            // co-owner is the worst wrong sentence on this screen.
            const after = await load();
            if (after.selfRead && after.requestedAt != null) {
              Alert.alert(
                'Not withdrawn',
                'The server accepted that, and your account still shows a deletion request pending — so it has NOT been withdrawn and any owner can still action it. Try again, or email support@repplefitness.com from the address on your account.',
              );
              return;
            }
            Alert.alert(
              'Request withdrawn',
              after.selfRead
                ? 'Your account will be kept and nothing has been deleted.'
                : 'Your account could not be re-read afterwards, so this could not confirm the request is gone. Nothing has been deleted — check this screen again before relying on it.',
            );
          } finally { setWithdrawing(false); }
        } },
      ],
    );
  };

  const requestLine = !facts
    ? 'Checking whether you already have a deletion request open…'
    : !facts.selfRead
      ? 'Whether you already have a deletion request open could not be checked. That is a read failure, not an all-clear.'
      : facts.requestedAt
        ? `You asked to be deleted on ${day(facts.requestedAt)}. It sits in Deletion requests until an owner actions it. Only you can take it back — nobody can withdraw it on your behalf.`
        : 'You have no deletion request open.';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Settings</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Who you are signed in as, your data & this build</Text>

        {/* When the deletion queue and the co-owner count were read, whether
            this phone is reaching us, and a way to ask again. The figures
            further down are the only ones on this screen that come from the
            server rather than from the session, and they were read once at
            mount with no gesture that would refresh them. */}
        <Fetched at={fetchedAt} onRefresh={refreshAll} busy={reloading} />

        <Rule />

        <Section>
          <SectionHead title="Signed in as" />
          <Line t={t} first label="Name" value={auth.loading ? 'Checking…' : fig(auth.user?.name)} />
          <Line t={t} label="Email" value={auth.loading ? 'Checking…' : fig(auth.user?.email)} />
          <Line t={t} label="Role" value={auth.loading ? 'Checking…' : fig(auth.user ? ROLE_LABEL[auth.user.role] ?? auth.user.role : null)} />
          <Line t={t} label="Gym" value={tenantLoading ? 'Checking…' : fig(gym)} />
          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
            <Ghost label="Sign Out" onPress={signOut} />
          </View>

          {/* A phone left on a bench is a phone left on a bench, whichever of
              the three apps is installed. */}
          <Pressable onPress={() => { void toggleLock(); }} accessibilityRole="switch"
            accessibilityState={{ checked: lock.enabled }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, color: t.ink }}>{lock.available ? `Require ${lock.label}` : 'Require Face ID'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{lockSettingNote(lock.available, lock.enabled, lock.label)}</Text>
            </View>
            <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: lock.enabled ? t.brand : t.surface3, borderWidth: hairline, borderColor: lock.enabled ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: lock.enabled ? t.brandInk : t.ink3, alignSelf: lock.enabled ? 'flex-end' : 'flex-start' }} />
            </View>
          </Pressable>
        </Section>

        <Rule />

        {/* Notifications.
            An owner could be reached and could not say no — auth.tsx registered
            every signed-in handset in `push_tokens` and this screen offered no
            way out of it. The switch is the client app's, not a third
            implementation: it removes this handset's row from `push_tokens`,
            the table send-push resolves recipients from, so it reaches every
            sender at once rather than each of two dozen call sites. */}
        <Section>
          <SectionHead title="Notifications" />
          <Pressable onPress={() => { void togglePush(); }} accessibilityRole="switch"
            accessibilityLabel="Push Notifications"
            accessibilityState={{ checked: st.notifPush }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, color: t.ink }}>Push Notifications</Text>
              {/* Read "Class bookings, member messages and requests to join",
                  which is app/(trainer)/settings.tsx's line with the nouns
                  swapped — and none of the three reaches an owner. Class
                  bookings notify the coach and the member; there is no owner
                  messaging screen in this app at all; requests to join go to
                  the coach being asked. app/(owner)/notifications.tsx states
                  the position plainly in its own header: nothing in the product
                  currently addresses a notification TO a gym owner except what
                  a coach in their gym sends them. A switch has to say what
                  turning it off costs, and this one named three things it does
                  not control. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Anything a coach at your gym sends you. Offers you push go to your members, not here.</Text>
            </View>
            <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: st.notifPush ? t.brand : t.surface3, borderWidth: hairline, borderColor: st.notifPush ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: st.notifPush ? t.brandInk : t.ink3, alignSelf: st.notifPush ? 'flex-end' : 'flex-start' }} />
            </View>
          </Pressable>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Turning this off takes this phone off the list entirely. Your gym runs exactly as before — you will see what happened next time you open the app rather than as it happens, and your other devices are unaffected.
          </Text>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your Data" />
          <ListRow icon="share" title={exporting ? 'Preparing Export…' : 'Export My Data'}
            note="Everything Repple stores about you, as a JSON file you can keep"
            onPress={exportData} />
          {facts?.requestedAt ? (
            <ListRow icon={BACK_ICON} title={withdrawing ? 'Withdrawing…' : 'Withdraw My Deletion Request'}
              note="Keep your account. You can withdraw right up until the deletion is carried out."
              onPress={withdraw} />
          ) : (
            <ListRow icon="minus" tone={t.crit} title={deleting ? 'Requesting…' : 'Delete My Account'}
              note="Ask for your account and your data to be erased permanently"
              onPress={deleteAccount} />
          )}
          {/* crit as ink is 3.03–4.05:1 on every palette. The dot carries it. */}
          {facts && !facts.selfRead
            ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{requestLine}</Flag>
            : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{requestLine}</Text>}
        </Section>

        <Rule />

        {/* The owner-only consequence, on the screen and not only in the dialog:
            this queue is actionable by an owner and by nobody else. */}
        <Section>
          <SectionHead title="Before You Delete Yourself" />
          {facts && facts.waiting == null
            ? <Flag tone={t.crit}>{queueLine()}</Flag>
            : <Text style={{ ...ty.label, color: t.ink2 }}>{queueLine()}</Text>}
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{ownersLine()}</Text>
          <ListRow icon="clock" title="Deletion Requests" note="The queue, and the 30-day clock running on it"
            onPress={() => router.push('/(owner)/deletions')} />
        </Section>

        <Rule />

        {/* Credits — a licence term, not a courtesy.
            The owner app now renders the RepDB catalogue on /(owner)/library and
            /(owner)/exercise. The free tier that pays for those illustrations and
            descriptions costs nothing and asks for one visible credit, so this
            card is the price of the whole exercise library in this binary.
            scripts/check-attribution.mjs fails the build without it, because the
            way this term gets breached is nobody deciding to: somebody rewrites a
            settings screen, the credit goes with it, and nothing is broken enough
            for a test to notice. */}
        <Section>
          <SectionHead title="Credits" />
          <RepdbAttribution />
        </Section>

        <Rule />

        {/* Build — the diagnostic for whether an OTA actually landed on this phone. */}
        <Section>
          <SectionHead title="Build" />
          <BuildInfo />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Which bundle this phone is running. If a fix was published but isn't here, compare Channel and Update against the EAS dashboard before assuming it's a code bug.
          </Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
