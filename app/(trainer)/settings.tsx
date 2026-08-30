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
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, fig } from '../../src/ui/kit';
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
