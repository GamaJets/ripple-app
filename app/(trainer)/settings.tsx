// Trainer · Settings. Who is signed in, sign out, export my data, delete my
// account.
//
// WHY THIS FILE EXISTS. Repple Coach had no settings screen at all, which means
// it offered account creation and no in-app way to ask for the account back.
// Google Play requires the second wherever you do the first, so this was a
// likely rejection and, policy aside, a promise the app was not keeping. The
// client app has carried `app/(client)/settings.tsx` for months; this is the
// same four capabilities, on the same `gdpr.ts` functions, for the coach.
//
// Three things it is careful about:
//
//  · Every value on the screen comes from a real row or from the session. There
//    is no placeholder identity — if the profile has not loaded, the screen
//    says "Checking…", and if it loaded without a value it says "—" via `fig`.
//    Those two states must never look the same: one means "wait", the other
//    means "there is nothing there".
//
//  · The pending-request read comes from fetchDeletionRequestedAt in
//    src/lib/gdpr.ts, which THROWS on failure rather than returning null.
//    That matters because supabase-js resolves on a database error, so an RLS
//    denial arrives as `data: null` — indistinguishable from "no request" —
//    and would render as an all-clear produced by a failure, the one thing
//    this screen must not say. The throw is what lets the catch below show
//    "could not be checked" instead.
//
//  · Deleting a coach is not the same as deleting a member. The coach's clients
//    belong to the gym and stay; what goes is the coach and everything written
//    only by them. The confirmation says so rather than leaving it implied.
//
// ── The coach had no notification preference at all ────────────────────────
//
// Not a broken switch — no switch. The coach app sends and receives the same
// pushes as everybody else (session booked, session cancelled, a client's
// message), `push_tokens` has carried a row for every signed-in coach since
// src/ui/auth.tsx started registering unconditionally, and there was nowhere in
// Repple Coach to say no. A member could opt out and a coach could not.
//
// This is the CLIENT's mechanism, reused rather than reimplemented. `useSettings()`
// is mounted app-wide in app/_layout.tsx — it already wraps these routes, and
// this screen already consumes it for the unit picker — so the toggle is the
// same `st.notifPush` / `st.setPushEnabled` pair app/(client)/settings.tsx
// drives, with the same four outcomes spoken aloud.
//
// The important half is where the gate lives, and it is worth restating because
// it is the reason a second implementation would have been wrong: the switch
// does not filter sends. It takes this handset's row OUT of `push_tokens`. The
// send-push edge function resolves recipients by reading that table, so a
// handset with no row there receives nothing whatever the sending screen
// believes it is doing — and there are two dozen sendPush() call sites, none of
// them this file's to edit, any one of which a call-site check would have been
// forgotten at. src/ui/settings.tsx carries the long note.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, fig } from '../../src/ui/kit';
import { useSettings } from '../../src/ui/settings';
import { convertedNote } from '../../src/lib/units';
import { sp, layout, hairline, type as ty, radius } from '../../src/theme/scale';
import { BuildInfo } from '../../src/ui/BuildInfo';
import { useAuth } from '../../src/ui/auth';
import { useAppLock } from '../../src/ui/appLock';
import { lockSettingNote } from '../../src/lib/appLock';
import { useTenant } from '../../src/ui/tenant';
import { exportMyDataDetailed, requestAccountDeletion, withdrawAccountDeletion, fetchDeletionRequestedAt } from '../../src/lib/gdpr';
import { shareTextFile } from '../../src/lib/exportShare';
import { reportError } from '../../src/lib/reportError';

/** A label and its value. `value` is already a string — see `fig`. */
function Line({ t, label, value, first }: { t: Theme; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** A label, a sentence under it, and a switch. Lifted out of the app-lock row
 *  when the push row arrived so the two cannot drift apart visually — the
 *  markup is byte-for-byte what the lock row already rendered. */
function SwitchRow({ t, label, note, on, onPress, first }: {
  t: Theme; label: string; note: string; on: boolean; onPress: () => void; first?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: first ? 0 : sp.lg }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, color: t.ink }}>{label}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text>
      </View>
      <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, borderWidth: hairline, borderColor: on ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
        <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: on ? t.brandInk : t.ink3, alignSelf: on ? 'flex-end' : 'flex-start' }} />
      </View>
    </Pressable>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: 'Gym owner', trainer: 'Trainer', client: 'Member' };

/** A timestamp as the day it happened, or a dash. Never the string "null". */
function day(iso: string | null): string {
  if (!iso) return '—';
  const d = String(iso).slice(0, 10);
  return d.length === 10 ? d : '—';
}

export default function TrainerSettings() {
  const t = useTheme();
  const router = useRouter();
  const st = useSettings();
  // The same sentence the client's settings screen shows: what a change to
  // this actually converts, so nobody expects it to rewrite stored history.
  const weightNote = convertedNote(st.weightUnit);
  const auth = useAuth();
  const lock = useAppLock();
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

  // The push switch. Identical handling to app/(client)/settings.tsx, and
  // deliberately so — the answer takes a round trip and can come back "no", and
  // a switch that slides across and then quietly delivers nothing is the exact
  // bug the client screen was fixing. Each outcome gets its own sentence
  // because they are fixed in three different places: nowhere, the phone's own
  // Settings, and by waiting.
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
      // Not "…switched off for Repple Coach". This is a white-label build and
      // the app on this phone may not be called Repple at all.
      Alert.alert('Turned off on your phone',
        "Notifications are switched off for this app in your phone's own Settings, so nothing can be delivered until you turn them back on there. Your choice here has been saved.");
      return;
    }
    // 'off-pending'. Said out loud rather than hoped over: a coach who has just
    // turned notifications off and then gets one needs to have been told it
    // might happen. The reconciler in src/ui/settings.tsx retries every launch.
    Alert.alert('Saved, but not confirmed',
      "Push notifications are off from now on, but we couldn't confirm this phone has been taken off the list — you may still get one until the next time you open the app. Nothing else has changed.");
  };

  const { tenant, loading: tenantLoading } = useTenant();

  // null = not read yet. `requestedAt: null` inside a loaded object means
  // "read, and there is no request" — a different fact, and it must read
  // differently on screen.
  const [pending, setPending] = useState<{ requestedAt: string | null } | null>(null);
  const [pendingFailed, setPendingFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // fetchDeletionRequestedAt throws on a failed read rather than returning null,
  // precisely so this screen can tell "no request" from "could not check".
  const loadPending = useCallback(async () => {
    try {
      setPending({ requestedAt: await fetchDeletionRequestedAt() });
      setPendingFailed(false);
    } catch (e) {
      reportError('trainerSettings.pending', e);
      setPending(null);
      setPendingFailed(true);
    }
  }, []);

  const withdraw = () => {
    Alert.alert(
      'Withdraw your deletion request?',
      'Your coaching account and everything in it will be kept. You can ask to be deleted again at any time.',
      [
        { text: 'Leave it pending', style: 'cancel' },
        { text: 'Withdraw request', onPress: async () => {
          if (withdrawing) return;
          setWithdrawing(true);
          try {
            const ok = await withdrawAccountDeletion();
            if (!ok) {
              reportError('trainerSettings.withdraw', new Error('withdraw_account_deletion did not clear the request'));
              Alert.alert('Not withdrawn', 'Your deletion request is still in place — nothing has changed. Check your connection and try again, or email support@repplefitness.com from the address on your account.');
              return;
            }
            // Re-read rather than assume: what shows next comes from the row.
            await loadPending();
            Alert.alert('Request withdrawn', 'Your account will be kept and nothing has been deleted.');
          } finally { setWithdrawing(false); }
        } },
      ],
    );
  };

  useEffect(() => { void loadPending(); }, [loadPending]);

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportMyDataDetailed();
      const json = res.json;
      await shareTextFile(json, 'repple-coach-my-data.json', 'application/json', 'Export my data');
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
      reportError('trainerSettings.export', e);
      Alert.alert('Export failed', 'Nothing was exported. Check your connection and try again.');
    } finally { setExporting(false); }
  };

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need your email and password to sign back in. Nothing is deleted.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('trainerSettings.signOut', e); } } },
    ]);
  };

  const run = async () => {
    setDeleting(true);
    try {
      const ok = await requestAccountDeletion();
      if (!ok) {
        // `requestAccountDeletion` returns false only when the write was
        // refused. Saying "noted" here would be inventing a promise.
        Alert.alert('Not requested', 'Your deletion request was not recorded — nothing has changed. Check your connection and try again, or contact your gym.');
        return;
      }
      await loadPending();
      Alert.alert(
        'Deletion requested',
        `Your request is recorded and now sits in your gym's deletion queue. ${tenant ? `The owner of ${tenant.name}` : "Your gym's owner"} has 30 days to action it, after which your account and your data are erased permanently.\n\nYou will be signed out now.`,
        [{ text: 'OK', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('trainerSettings.signOut', e); } } }],
      );
    } catch (e) {
      reportError('trainerSettings.delete', e);
      Alert.alert('Not requested', 'Your deletion request was not recorded — nothing has changed. Check your connection and try again.');
    } finally { setDeleting(false); }
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete your coaching account?',
      'This asks for your Repple Coach account and everything of yours to be permanently erased — your coach profile, your programs and templates, your videos, your messages and your session history.\n\n' +
      'Your clients are not deleted. They stay with the gym, but they lose you as their coach, and anything you wrote only to them goes with your account.\n\n' +
      `${tenant ? `The owner of ${tenant.name}` : "Your gym's owner"} has 30 days to action this. It cannot be undone once they do.`,
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Request deletion', style: 'destructive', onPress: () => { void run(); } },
      ],
    );
  };

  const requestLine = pendingFailed
    ? 'Whether you already have a deletion request open could not be checked just now. That is a read failure, not an all-clear.'
    : pending === null
      ? 'Checking whether you already have a deletion request open…'
      : pending.requestedAt
        ? `You asked to be deleted on ${day(pending.requestedAt)}. Your gym's owner carries it out. Only you can take the request back — nobody can withdraw it on your behalf.`
        : 'You have no deletion request open.';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Settings</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Who you are signed in as, your data & this build</Text>

        <Rule />

        <Section>
          <SectionHead title="Signed in as" />
          <Line t={t} first label="Name" value={auth.loading ? 'Checking…' : fig(auth.user?.name)} />
          <Line t={t} label="Email" value={auth.loading ? 'Checking…' : fig(auth.user?.email)} />
          <Line t={t} label="Role" value={auth.loading ? 'Checking…' : fig(auth.user ? ROLE_LABEL[auth.user.role] ?? auth.user.role : null)} />
          <Line t={t} label="Gym" value={tenantLoading ? 'Checking…' : fig(tenant?.name)} />
          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
            <Ghost label="Sign Out" onPress={signOut} />
          </View>

          {/* A phone left on a bench is a phone left on a bench, whichever of
              the three apps is installed. */}
          <SwitchRow t={t}
            label={lock.available ? `Require ${lock.label}` : 'Require Face ID'}
            note={lockSettingNote(lock.available, lock.enabled, lock.label)}
            on={lock.enabled} onPress={() => { void toggleLock(); }} />
        </Section>

        <Rule />

        {/* Notifications.
            The coach app had no notification preference at all — not a broken
            one, none — while auth.tsx has been registering every signed-in
            coach's handset in `push_tokens` since long before this screen
            existed. A member could opt out and a coach could not.
            The switch is the client app's, not a second implementation: it
            removes this handset's row from `push_tokens`, which is the table
            the send-push edge function resolves recipients from, so it reaches
            every sender at once rather than each of two dozen call sites. */}
        <Section>
          <SectionHead title="Notifications" />
          <SwitchRow t={t} first label="Push Notifications"
            note="Session bookings and cancellations, client messages, and requests to coach"
            on={st.notifPush} onPress={() => { void togglePush(); }} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Turning this off takes this phone off the list entirely. Your clients can still message you and book with you — you will see it next time you open the app rather than as it happens, and your other devices are unaffected.
          </Text>
        </Section>

        <Rule />

        {/* Units.
            The coach portal had no unit control at all, so every coach read
            and typed kilograms whatever they think in — including in
            log-session, which writes into a CLIENT's history. A coach
            thinking in pounds typed 135 and 135 kg went onto somebody's
            record.
            It persists to profiles (part 82) rather than clients, because a
            coach has no clients row and the answer was previously kept in
            this handset's storage: it survived a relaunch and not a
            reinstall, and never followed them to a second phone. */}
        <Section>
          <SectionHead title="Units" />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md }}>
            <View style={{ flex: 1, paddingRight: sp.md }}>
              <Text style={{ ...ty.body, color: t.ink }}>Weight</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {weightNote ?? "What you read and type, including when you log a session on a client's record"}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['kg', 'lb'] as const).map((u) => {
                const on = st.weightUnit === u;
                return (
                  <Pressable key={u} onPress={() => st.set({ weightUnit: u })}
                    accessibilityRole="radio" accessibilityState={{ selected: on }}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{u}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your Data" />
          <ListRow icon="share" title={exporting ? 'Preparing Export…' : 'Export My Data'}
            note="Everything Repple stores about you, as a JSON file you can keep"
            onPress={exportData} />
          {pending?.requestedAt ? (
            <ListRow icon="back" title={withdrawing ? 'Withdrawing…' : 'Withdraw My Deletion Request'}
              note="Keep your account. You can withdraw right up until the deletion is carried out."
              onPress={withdraw} />
          ) : (
            <ListRow icon="minus" tone={t.crit} title={deleting ? 'Requesting…' : 'Delete My Account'}
              note="Ask for your account and your data to be erased permanently"
              onPress={deleteAccount} />
          )}
          <Text style={{ ...ty.caption, color: pendingFailed ? t.crit : t.ink3, marginTop: sp.md }}>{requestLine}</Text>
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
