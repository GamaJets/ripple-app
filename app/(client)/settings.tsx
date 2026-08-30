// Client · Settings & About. Who you are signed in as (and the way back out),
// notification prefs, unit preference, legal, your data (GDPR export /
// erasure), and the build this phone is actually running. Profile hub.
//
// The "Signed in as" section was missing here while the trainer and owner
// screens both had it, so the client app had no sign-out anywhere at all — the
// only call to auth.signOut() was the one that runs after an account deletion
// request. Reported from a real build. The section is a copy of the trainer's,
// minus Role and Gym, which a member has no use for.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): hairline-separated sections instead of six stacked
// bordered boxes, three weights, no raw type sizes. Every route, hook,
// conditional and handler is unchanged.
//
// Removed in the migration: a hardcoded "What's new" changelog claiming
// v2.2 / v2.1 / v2.0 and a footer reading "v2.2". The app's real version is
// 1.0.0 (app.json) — those numbers came from nowhere and sat directly above
// <BuildInfo/>, which prints the true version. A false version defeats the
// whole point of the Build section.
//
// The Units section was one row that did nothing. `weightUnit` was declared in
// src/ui/settings.tsx and read by exactly one file — this one, to decide which
// of the two pills to tint. No screen in the app converted anything, so tapping
// "lb" was a toggle with no downstream effect at all. TF-37 gives it a second
// row (height and tape measurements), a conversion module behind both
// (src/lib/units.ts), and a home on the account rather than on the handset.
//
// The "Your data" section reports the CURRENT state of the account, not just the
// action available on it. web/delete-account.html promises that a deletion
// request "can be withdrawn until" it is actioned, and a screen that only ever
// offers to REQUEST one cannot keep that promise. So `deletion_requested_at` is
// read from the profile on mount and the section shows one of four things:
// checking, no request, a pending request with the day it was made and a way to
// take it back, or a plain admission that the read failed. That last state earns
// its complexity — a failed read rendered as "no request" would tell somebody who
// asked to be erased that they never asked, which is the one wrong answer here.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { BuildInfo } from '../../src/ui/BuildInfo';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, fig } from '../../src/ui/kit';
import { RepdbAttribution } from '../../src/ui/Attribution';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { useSettings } from '../../src/ui/settings';
import { convertedNote } from '../../src/lib/units';
import { useAuth } from '../../src/ui/auth';
import { useAppLock } from '../../src/ui/appLock';
import { lockSettingNote } from '../../src/lib/appLock';
import { exportMyDataDetailed, requestAccountDeletion, withdrawAccountDeletion, fetchDeletionRequestedAt } from '../../src/lib/gdpr';
import { shareTextFile } from '../../src/lib/exportShare';
import { reportError } from '../../src/lib/reportError';

function Toggle({ t, on, onPress }: { t: Theme; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', padding: 3 }}>
      <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}

/** A label and a fact, the same line the trainer and owner settings screens use. */
function Line({ t, label, value, first }: { t: Theme; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Row({ t, label, sub, right, first }: { t: Theme; label: string; sub?: string; right: React.ReactNode; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flex: 1, paddingRight: sp.md }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{label}</Text>
        {sub ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/**
 * The unit picker, twice — weight and length. Was written inline for weight
 * alone when the setting did nothing; a second copy for length would be the
 * moment the two drift apart.
 */
function Units<T extends string>({ options, value, onPick, t }: { options: readonly T[]; value: T; onPick: (v: T) => void; t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {options.map((u) => {
        const on = value === u;
        return (
          <Pressable key={u} onPress={() => onPick(u)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={{ paddingHorizontal: sp.lg, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
            <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{u}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The day a request was made, as a date a member can read. Never "null". */
function requestedDay(iso: string | null): string {
  if (!iso) return fig(null);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fig(null);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const st = useSettings();
  const auth = useAuth();
  const lock = useAppLock();
  // Turning the lock ON asks for a face first, inside setEnabled — enabling a
  // lock you cannot open is how somebody gets shut out of their own record.
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
  const signOut = () => {
    Alert.alert('Sign out', 'You will need your email and password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      // Sent back to the sign-in screen explicitly. The only auth gate is the
      // one in app/index.tsx, which redirects when !authed — and that route is
      // not on screen when somebody signs out from Settings. Without this the
      // session ends and the screen simply stays put, showing dashes where the
      // name and email were. Seen in the simulator, not in a test.
      { text: 'Sign out', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('clientSettings.signOut', e); } } },
    ]);
  };
  // Said under the picker rather than left implied. Repple records weight in
  // kilograms and lengths in centimetres whatever this is set to; a client who
  // reads in pounds is reading a conversion, and their scan sheet will say
  // something that looks different. convertedNote returns null for the metric
  // options, so the metric majority is not lectured about a conversion that is
  // not happening.
  const weightNote = convertedNote(st.weightUnit);
  const lengthNote = convertedNote(st.lengthUnit);
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  // null = not read yet · 'failed' = the read itself failed · otherwise the
  // answer, whose requestedAt is null when there is genuinely no request. Those
  // three must never collapse into one another, so they are one value, not a
  // boolean pair that can drift.
  const [deletion, setDeletion] = useState<{ requestedAt: string | null } | 'failed' | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const pendingAt = deletion !== null && deletion !== 'failed' ? deletion.requestedAt : null;

  // fetchDeletionRequestedAt throws on a failed read rather than reporting "no
  // request" — see src/lib/gdpr.ts. Catching it here is what turns that into the
  // visible 'failed' state instead of a silent all-clear.
  const loadDeletion = useCallback(async () => {
    try { setDeletion({ requestedAt: await fetchDeletionRequestedAt() }); }
    catch (e) { reportError('settings.deletionStatus', e); setDeletion('failed'); }
  }, []);
  useEffect(() => { void loadDeletion(); }, [loadDeletion]);

  const exportData = async () => {
    if (dataBusy) return; setDataBusy(true);
    try {
      const res = await exportMyDataDetailed();
      await shareTextFile(res.json, 'repple-my-data.json', 'application/json', 'Export my data');
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
    } finally { setDataBusy(false); }
  };
  const deleteAccount = () => {
    Alert.alert('Delete your account?', 'This requests permanent deletion of your account and all your data. This cannot be undone.', [
      { text: 'Keep my account', style: 'cancel' },
      // The failure branch used to say "We've recorded your request", which was a
      // claim the app could not stand behind — request_account_deletion() had
      // just refused. It now says nothing was scheduled, and does NOT sign the
      // person out, because being signed out of a retry is the last thing you
      // want when the request did not land.
      { text: 'Request deletion', style: 'destructive', onPress: async () => {
        const ok = await requestAccountDeletion();
        await loadDeletion();
        if (!ok) { Alert.alert('Not requested', "We couldn't record your request just now, so nothing has been scheduled. Check your connection and try again, or email support@repplefitness.com from the address on your account."); return; }
        Alert.alert('Deletion requested', 'Your account is scheduled for deletion and your data will be erased. You have been signed out.\n\nYou can withdraw the request from Settings until it is actioned — sign back in to do that.', [{ text: 'OK', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch { /* ignore */ } } }]);
      } },
    ]);
  };
  const withdrawDeletion = () => {
    Alert.alert('Withdraw your deletion request?', 'Your account and everything in it will be kept. You can ask to be deleted again at any time.', [
      { text: 'Leave it pending', style: 'cancel' },
      { text: 'Withdraw request', onPress: async () => {
        if (withdrawBusy) return; setWithdrawBusy(true);
        try {
          const ok = await withdrawAccountDeletion();
          if (!ok) {
            reportError('settings.withdrawDeletion', new Error('withdraw_account_deletion did not clear the request'));
            Alert.alert('Not withdrawn', 'Your deletion request is still in place — nothing has changed. Check your connection and try again, or email support@repplefitness.com from the address on your account.');
            return;
          }
          // Re-read rather than assume: what the screen shows next comes from the
          // profile row, not from the fact that a call returned.
          await loadDeletion();
          Alert.alert('Request withdrawn', 'Your account will be kept and nothing has been deleted.');
        } finally { setWithdrawBusy(false); }
      } },
    ]);
  };

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
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Preferences, legal & version</Text>

        <Rule />

        <Section>
          <SectionHead title="Signed in as" />
          <Line t={t} first label="Name" value={auth.loading ? 'Checking\u2026' : fig(auth.user?.name)} />
          <Line t={t} label="Email" value={auth.loading ? 'Checking\u2026' : fig(auth.user?.email)} />
          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
            <Ghost label="Sign Out" onPress={signOut} />
          </View>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Security" />
          <Row t={t} first
            label={lock.available ? `Require ${lock.label}` : 'Require Face ID'}
            sub={lockSettingNote(lock.available, lock.enabled, lock.label)}
            right={<Toggle t={t} on={lock.enabled} onPress={() => { void toggleLock(); }} />} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Notifications" />
          <Row t={t} first label="Push notifications" sub="Session reminders, PRs, coach messages" right={<Toggle t={t} on={st.notifPush} onPress={() => st.set({ notifPush: !st.notifPush })} />} />
          <Row t={t} label="Email updates" sub="Weekly summary & tips" right={<Toggle t={t} on={st.notifEmail} onPress={() => st.set({ notifEmail: !st.notifEmail })} />} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Units" />
          <Row t={t} first label="Body weight" sub={weightNote ?? 'Your weight, goals and scans'} right={
            <Units options={['kg', 'lb']} value={st.weightUnit} onPick={(u) => st.set({ weightUnit: u })} t={t} />
          } />
          <Row t={t} label="Height & measurements" sub={lengthNote ?? 'Your height and your tape measurements'} right={
            <Units options={['cm', 'in']} value={st.lengthUnit} onPick={(u) => st.set({ lengthUnit: u })} t={t} />
          } />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Appearance" />
          <ListRow icon="palette" title="Theme & accent colour" note="10 palettes, applied live"
            onPress={() => router.push('/(client)/appearance')} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your data" />
          <Pressable onPress={exportData} accessibilityRole="button" accessibilityLabel="Export my data">
            <Row t={t} first label={dataBusy ? 'Preparing export…' : 'Export my data'} sub="Download everything we store about you (JSON)"
              right={<Text style={{ ...ty.head, color: t.brand }}>{'⤓'}</Text>} />
          </Pressable>
          {deletion === null ? (
            // Not read yet. Deliberately not pressable: requesting again would
            // reset deletion_requested_at, restarting somebody's 30 days.
            <Row t={t} label="Delete my account" sub="Checking whether you already have a request in…" right={<Icon name="chevron" size={15} color={t.ink3} />} />
          ) : deletion === 'failed' ? (
            <>
              <Row t={t} label="Deletion status unknown" sub="We couldn't check whether you already have a request in. That's a read that failed, not an answer — it does not mean you have none." right={
                <Pressable onPress={() => { void loadDeletion(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Check your deletion status again"
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try again</Text>
                </Pressable>
              } />
              <Pressable onPress={deleteAccount} accessibilityRole="button" accessibilityLabel="Delete my account">
                <Row t={t} label="Delete my account" sub="Request permanent erasure of your account and data" right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <Icon name="chevron" size={15} color={t.ink3} />
                  </View>
                } />
              </Pressable>
            </>
          ) : pendingAt ? (
            <>
              <Row t={t} label="Deletion requested" sub={`Asked on ${requestedDay(pendingAt)} · your account and data are due to be erased`} right={
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
              } />
              <Pressable onPress={withdrawDeletion} disabled={withdrawBusy} accessibilityRole="button" accessibilityLabel="Withdraw my deletion request">
                <Row t={t} label={withdrawBusy ? 'Withdrawing…' : 'Withdraw my deletion request'} sub="Keep your account. You can withdraw until the deletion is actioned, and ask again at any time."
                  right={<Icon name="chevron" size={15} color={t.ink3} />} />
              </Pressable>
            </>
          ) : (
            <Pressable onPress={deleteAccount} accessibilityRole="button" accessibilityLabel="Delete my account">
              <Row t={t} label="Delete my account" sub="Request permanent erasure of your account and data" right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                  <Icon name="chevron" size={15} color={t.ink3} />
                </View>
              } />
            </Pressable>
          )}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Legal" />
          <Pressable onPress={() => setLegal(legal === 'privacy' ? null : 'privacy')}>
            <Row t={t} first label="Privacy Policy" right={<Text style={{ ...ty.body, color: t.ink3 }}>{legal === 'privacy' ? '▾' : '›'}</Text>} />
          </Pressable>
          {legal === 'privacy' ? <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.sm }}>We store your training, nutrition and body data to power your plan. Health data is never sold or shared with advertisers. You can export or delete your data at any time from your account. Photos and scans are stored securely and visible only to you and your coach.</Text> : null}
          <Pressable onPress={() => setLegal(legal === 'terms' ? null : 'terms')}>
            <Row t={t} label="Terms of Service" right={<Text style={{ ...ty.body, color: t.ink3 }}>{legal === 'terms' ? '▾' : '›'}</Text>} />
          </Pressable>
          {legal === 'terms' ? <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.sm }}>Repple provides fitness and nutrition guidance for general wellness and is not a substitute for medical advice. Consult a physician before starting any program. Coaching is delivered by independent trainers on the platform; billing terms are shown at checkout.</Text> : null}
        </Section>

        <Rule />

        {/* ── Credits ────────────────────────────────────────────────────────
            Its own section above Build, not a grey line beneath it. Every
            exercise description, illustration and muscle list in Repple is
            licensed from RepDB under a free tier whose one condition is a
            visible credit — that is the whole price of 601 illustrated
            movements, and it is cheap. scripts/check-attribution.mjs fails the
            build if this stops being rendered. */}
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

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl }}>Repple · made for coaches & their clients</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
