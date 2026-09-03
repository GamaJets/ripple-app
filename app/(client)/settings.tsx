// Client · Settings & About. Who you are signed in as (and the way back out),
// the push switch, unit preference, legal, your data (GDPR export / erasure),
// and the build this phone is actually running. Profile hub.
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
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { BRAND } from '../../src/lib/brands';
import { View, Text, Pressable, ScrollView, Alert, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';
import { BuildInfo } from '../../src/ui/BuildInfo';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, fig } from '../../src/ui/kit';
import { RepdbAttribution } from '../../src/ui/Attribution';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { useSettings } from '../../src/ui/settings';
import { convertedNote } from '../../src/lib/units';
import { deviceUnitNote } from '../../src/lib/unitPreference';
import { useAuth } from '../../src/ui/auth';
import { useAppLock, LOCK_PLATFORM } from '../../src/ui/appLock';
import { openLegalDoc } from '../../src/ui/legal';
import { lockSettingNote, lockMethodsLabel, lockSettingsLabel, defaultLockLabel } from '../../src/lib/appLock';
import { restSoundNote, type SoundPlatform } from '../../src/lib/restTimer';
import { SOUNDS_AVAILABLE } from '../../src/ui/sounds';
import {
  exportMyDataDetailed, requestAccountDeletion, withdrawAccountDeletion, fetchDeletionRequestedAt,
  readMyFile, MY_DATA_FILENAME, type ExportFile,
} from '../../src/lib/gdpr';
import { shareTextFile, shareBinaryFile, fileShareBlocker } from '../../src/lib/exportShare';
// What the export claims to hold, what a short one says, and what deleting an
// account actually does to the FILES. All of it in one place so the sentences a
// member reads at the two most consequential moments in this app can be
// asserted under `npm test` without a device.
import {
  fileSizeLabel, filesRowNote, saveFileFailure, incompleteExportLine,
  DELETION_FILES_NOTE, EXPORT_ROW_NOTE,
} from '../../src/lib/dataExport';
import { reportError } from '../../src/lib/reportError';
import { appLocale } from '../../src/lib/locale';
import { END_ALIGN, FORWARD_CHAR, FORWARD_ICON } from '../../src/ui/direction';

/**
 * Which phone the rest-timer sound note is about.
 *
 * Read once at module load, because it cannot change while the app is running —
 * the same reasoning as DEVICE_REGION in src/ui/settings.tsx. It exists because
 * that note used to name the MUTE SWITCH on every platform and Android phones
 * do not have one, so the only sentence explaining a silent chime sent Android
 * members hunting for a control that is not on their handset. See restSoundNote.
 */
const SOUND_PLATFORM: SoundPlatform =
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';

/**
 * The pill switch used down the right-hand side of this screen.
 *
 * It is a real switch and announced as one. Before this it was an unnamed
 * button whose entire state — on or off — was which side a white dot sat on and
 * what colour the track was: nothing a screen reader can read, and nothing a
 * person who cannot separate the accent from surface3 can see either. The row's
 * own label is beside it rather than inside it, so `label` is passed in.
 *
 * 48 × 28 is also under the 44pt minimum on both axes; the slop brings the
 * boundary out to 44 without moving the drawing.
 */
function Toggle({ t, on, onPress, label }: { t: Theme; on: boolean; onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
      style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', padding: 3 }}>
      <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}

/** A label and a fact, the same line the trainer and owner settings screens use. */
function Line({ t, label, value, first }: { t: Theme; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: END_ALIGN }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Row({ t, label, sub, right, first }: { t: Theme; label: string; sub?: string; right: React.ReactNode; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flex: 1, paddingEnd: sp.md }}>
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
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  // Whether this phone can reach us, so a refusal and a basement do not get the
  // same sentence. See src/lib/reachability.ts.
  const reach = useReachability();
  const st = useSettings();
  const auth = useAuth();
  const lock = useAppLock();
  // The row's own name. `lock.label` is the real device word once the hardware
  // has answered; before that, and when there is no hardware, it is the neutral
  // one for this handset rather than 'Face ID' on a phone that has none.
  const lockRowLabel = lock.available ? `Require ${lock.label}` : `Require ${defaultLockLabel(LOCK_PLATFORM)}`;
  // Turning the lock ON asks for a face first, inside setEnabled — enabling a
  // lock you cannot open is how somebody gets shut out of their own record.
  const toggleLock = async () => {
    if (!lock.available) {
      // Was "Set up Face ID, Touch ID or a passcode in iOS Settings" on every
      // platform — the identical failure SOUND_PLATFORM above exists to stop,
      // one section down in the same file: an Android member sent looking for
      // an Apple feature inside an Apple settings app. The vocabulary is the
      // handset's now; see src/lib/appLock.ts.
      Alert.alert('Not available on this device',
        `Set up ${lockMethodsLabel(LOCK_PLATFORM)} in ${lockSettingsLabel(LOCK_PLATFORM)}, then this can be turned on.`);
      return;
    }
    const want = !lock.enabled;
    const ok = await lock.setEnabled(want);
    if (!ok && want) {
      Alert.alert('Not turned on', `${lock.label} was not confirmed, so the lock is still off.`);
    }
  };
  // ── The notification switches ─────────────────────────────────────────────
  //
  // There were two here, and neither did anything. Nothing in the app read
  // `notifPush` or `notifEmail` — a grep across app/ and src/ found the
  // declaration, this screen, and no third mention — so both switches slid
  // across, persisted their new position and changed nothing whatsoever. A
  // member could turn push off and go on receiving every notification Repple
  // sends, for ever, with the app showing them their own choice not being
  // honoured.
  //
  // "Email Updates · Weekly summary & tips" is gone rather than wired up.
  // Repple sends no email: there is no mail provider key, no mail edge function
  // and no code anywhere that composes a message. That row was not an
  // unimplemented preference, it was a description of a product feature that
  // does not exist, and a switch cannot be connected to a system nobody has
  // built. Bring the row back on the day the weekly email does.
  //
  // Push is now real, gated at `push_tokens` in src/ui/settings.tsx — see the
  // long note there for why the gate lives at the token rather than at each
  // sender. This handler exists because the answer takes a round trip and can
  // come back "no": a switch that slides across and then quietly delivers
  // nothing is the bug being fixed, so each outcome gets a sentence.
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
      Alert.alert('Turned off on your phone',
        // Not "…switched off for Repple". This is a white-label build and the
        // app on this phone may not be called Repple at all.
        "Notifications are switched off for this app in your phone's own Settings, so nothing can be delivered until you turn them back on there. Your choice here has been saved.");
      return;
    }
    // 'off-pending'. Said out loud rather than hoped over: somebody who has just
    // turned notifications off and then gets one needs to have been told it
    // might happen.
    Alert.alert('Saved, but not confirmed',
      "Push notifications are off from now on, but we couldn't confirm this phone has been taken off the list — you may still get one until the next time you open the app. Nothing else has changed.");
  };

  const signOut = () => {
    Alert.alert('Sign out', 'You will need your email and password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      // Sent back to the sign-in screen explicitly. The only auth gate is the
      // one in app/index.tsx, which redirects when !authed — and that route is
      // not on screen when somebody signs out from Settings. Without this the
      // session ends and the screen simply stays put, showing dashes where the
      // name and email were. Seen in the simulator, not in a test.
      // `auth.signOut()` is not awaited on purpose, and it is not fire-and-
      // forget either: it clears the user from the tree synchronously and then
      // finishes the teardown — revoking this handset's push registration while
      // the session is still alive, cancelling the reminders the phone itself
      // is holding, and clearing the notification categories, quiet hours and
      // biometric lock that used to be inherited by the next person to sign in
      // here. That work used to be absent entirely: this screen had
      // `revokePushToken` a scroll away in the provider it reads and signed out
      // without it, so the previous member's coach could still reach this
      // handset. It lives in src/ui/auth.tsx now rather than on this screen,
      // because the coach and owner apps sign out too.
      { text: 'Sign out', onPress: () => { try { void auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('clientSettings.signOut', e); } } },
    ]);
  };
  // Said under the picker rather than left implied. Repple records weight in
  // kilograms and lengths in centimetres whatever this is set to; a client who
  // reads in pounds is reading a conversion, and their scan sheet will say
  // something that looks different. convertedNote returns null for the metric
  // options, so the metric majority is not lectured about a conversion that is
  // not happening.
  //
  // ── And the sentence that has to come FIRST ──────────────────────────────
  //
  // `clients.weight_unit` is NULL until somebody taps one of these pills, and
  // for anybody who never has, the tinted pill below is the app's guess off the
  // phone's region rather than their answer. This is the screen that owns that
  // preference, so this is where the guess is admitted — `deviceUnitNote`
  // returns null once a real choice exists, so nobody who has chosen is told
  // anything.
  //
  // It wins over `convertedNote` when both would apply. Telling an American
  // member that their pounds are converted from the kilograms on their record
  // is true, and it answers a question they never asked while burying the one
  // they should be asked: nobody ever checked that they read in pounds at all.
  //
  // The guessed unit is still TINTED rather than left unselected. An untinted
  // row would say "no answer" more purely and read as "the app is showing you
  // nothing", and a screen reader would announce two unselected radios beside a
  // Weight column full of pounds. The pill shows what is in use; the line under
  // it says who decided.
  const weightNote = deviceUnitNote(st.weightUnit, st.weightSource) ?? convertedNote(st.weightUnit);
  const lengthNote = deviceUnitNote(st.lengthUnit, st.lengthSource) ?? convertedNote(st.lengthUnit);
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  // The manifest from the last export, and whether the read behind it finished.
  // Held rather than re-fetched so "Save My Files" lists exactly what the file
  // the member is holding says they have — the two must not disagree.
  const [files, setFiles] = useState<ExportFile[] | null>(null);
  const [filesComplete, setFilesComplete] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [savingPath, setSavingPath] = useState<string | null>(null);
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

  // Whether this account has an open deletion request is the one thing on this
  // screen read from the server — everything else is the session, this device's
  // lock and this device's preferences. It is also the one worth being current:
  // the 30-day clock it reports is the whole of what the screen promises.
  const pull = usePullToRefresh(loadDeletion);

  const exportData = async () => {
    if (dataBusy) return; setDataBusy(true);
    try {
      const res = await exportMyDataDetailed();
      // The filename comes from the brand, not from a literal. A member of a
      // white-labelled chain saving `repple-my-data.json` has been handed a file
      // named after a company they do not deal with, and it is the name they
      // will search for in two years — the argument is in src/lib/gdpr.ts and
      // this screen was the one place still ignoring it.
      await shareTextFile(res.json, MY_DATA_FILENAME, 'application/json', 'Export my data');
      // The manifest, so the files can be saved from the row below. Kept
      // whether or not the export was complete, along with WHETHER it was —
      // a count over a short read is the same defect as an empty table over a
      // refused one.
      setFiles(res.files);
      setFilesComplete(res.complete);
      if (!res.complete) {
        // A partial export handed over silently is the same failure one level
        // up: somebody deletes their account believing they have a copy. The
        // parts are NAMED rather than counted, because "3 parts" tells nobody
        // whether their payments are in the file.
        Alert.alert(
          'That copy is incomplete',
          incompleteExportLine(res.failed.map((f) => f.table), BRAND.supportEmail),
        );
      }
    } finally { setDataBusy(false); }
  };

  /**
   * Hand one of the member's own files to the share sheet.
   *
   * One at a time, and that is not a limitation being apologised for: the share
   * sheet takes one file, and a member's message attachments can be 64 MB of
   * video each (supabase/parts/124), so a bundle assembled in memory is a crash
   * at the exact moment somebody is taking their last copy.
   *
   * `shareBinaryFile` reports whether it actually landed. A silent success here
   * would be somebody believing they have saved a physiotherapy report they
   * have not.
   */
  const saveFile = async (f: ExportFile) => {
    if (savingPath) return;
    setSavingPath(f.path);
    try {
      const b64 = await readMyFile(f.bucket, f.path);
      if (!b64) { Alert.alert('Not saved', saveFileFailure(fileShareBlocker())); return; }
      // The object key's last segment. It is the name this app chose at upload
      // and is already safe on every platform (see `injuryDocObjectPath` and
      // `messageAttachmentPath`), so nothing here has to invent one.
      const name = f.path.split('/').pop() || 'file';
      const ok = await shareBinaryFile(b64, name, 'application/octet-stream', 'Save this file');
      if (!ok) Alert.alert('Not saved', saveFileFailure(fileShareBlocker()));
    } finally { setSavingPath(null); }
  };
  const deleteAccount = () => {
    // The files are named, and what actually happens to them is stated rather
    // than smoothed over. This alert used to say nothing about them at all, so
    // somebody deleting their account had no reason to think their
    // physiotherapy report was anywhere but gone with it.
    Alert.alert(
      'Delete your account?',
      'This requests permanent deletion of your account and all your data. This cannot be undone.\n\n'
      + DELETION_FILES_NOTE,
      [
      { text: 'Keep my account', style: 'cancel' },
      // The failure branch used to say "We've recorded your request", which was a
      // claim the app could not stand behind — request_account_deletion() had
      // just refused. It now says nothing was scheduled, and does NOT sign the
      // person out, because being signed out of a retry is the last thing you
      // want when the request did not land.
      { text: 'Request deletion', style: 'destructive', onPress: async () => {
        const ok = await requestAccountDeletion();
        await loadDeletion();
        // "Check your connection" was printed here whatever had happened, and
        // account deletion is the worst screen in the app to say it on: a
        // request the server READ and declined is a policy answer, and sending
        // somebody to their router over it means they try again, and again,
        // with no idea why. `retryLine` says which — src/lib/reachability.ts.
        // `BRAND.supportEmail`, not the literal. This screen already does it
        // properly fifty lines up, in `incompleteExportLine` — and the address
        // it hardcoded here is the SUPPLIER'S. A member of a white-label gym,
        // at the one moment they most need an escalation that works, was sent
        // to a company they have never heard of, that cannot act for their gym,
        // and whose existence they were never told about.
        if (!ok) { Alert.alert('Not requested', `We couldn't record your request just now, so nothing has been scheduled. ${retryLine(reach)} You can also email ${BRAND.supportEmail} from the address on your account.`); return; }
        Alert.alert('Deletion requested', 'Your account is scheduled for deletion and your data will be erased. You have been signed out.\n\nYou can withdraw the request from Settings until it is actioned — sign back in to do that.', [{ text: 'OK', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch { /* ignore */ } } }]);
      } },
      ],
    );
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
            Alert.alert('Not withdrawn', `Your deletion request is still in place — nothing has changed. ${retryLine(reach)} You can also email ${BRAND.supportEmail} from the address on your account.`);
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

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
          {/* The middle ground this section did not have. It offered sign-out
              and, further down, account deletion \u2014 so the only thing a member
              could do about a password they had reason to distrust was leave
              the app and use the "forgotten password" flow for a password they
              had not forgotten, and there was nothing at all they could do
              about an email address they no longer had access to. Which is the
              address every route back into the account goes to. */}
          <ListRow icon="settings" title="Password & Email" note="Change your password or the address you sign in with"
            onPress={() => router.push('/(client)/account')} />
          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
            <Ghost label="Sign Out" onPress={signOut} />
          </View>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Security" />
          {/* The unavailable label was 'Require Face ID' on every handset. An
              Android phone has no Face ID, so the row named a feature the
              member could not have and the note under it told them to go and
              find it in iOS Settings. */}
          <Row t={t} first
            label={lockRowLabel}
            sub={lockSettingNote(lock.available, lock.enabled, lock.label, LOCK_PLATFORM, BRAND.label)}
            right={<Toggle t={t} on={lock.enabled} label={lockRowLabel} onPress={() => { void toggleLock(); }} />} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Notifications" />
          <Row t={t} first label="Push Notifications" sub="Session reminders, class reminders, coach messages"
            right={<Toggle t={t} on={st.notifPush} label="Push Notifications" onPress={() => { void togglePush(); }} />} />
          {/* The rest-timer sound.
              Not folded into the push switch, and not a coach setting. It is a
              noise this handset makes in whatever room it is in, so it belongs
              to the person holding it — the same reasoning that keeps push
              device-local rather than on the account.
              It gates the sound for real: `set` publishes the answer to
              src/lib/restTimer.ts's latch in the same statement it stores it,
              and src/ui/sounds.ts will not play anything the latch has not said
              yes to. This screen has shipped a switch that was read by nothing
              before — see the long note above togglePush — and this one is
              wired at the speaker rather than at each call site so there is no
              second place to forget it. */}
          <Row t={t} label="Rest Timer Sound" sub={restSoundNote(SOUNDS_AVAILABLE, SOUND_PLATFORM)}
            right={<Toggle t={t} on={st.restSound} label="Rest Timer Sound" onPress={() => st.set({ restSound: !st.restSound })} />} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Units" />
          <Row t={t} first label="Body Weight" sub={weightNote ?? 'Your weight, goals and scans'} right={
            <Units options={['kg', 'lb']} value={st.weightUnit} onPick={(u) => st.set({ weightUnit: u })} t={t} />
          } />
          <Row t={t} label="Height & Measurements" sub={lengthNote ?? 'Your height and your tape measurements'} right={
            <Units options={['cm', 'in']} value={st.lengthUnit} onPick={(u) => st.set({ lengthUnit: u })} t={t} />
          } />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Appearance" />
          <ListRow icon="palette" title="Theme & Accent Colour" note="10 palettes, applied live"
            onPress={() => router.push('/(client)/appearance')} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your Data" />
          <Pressable onPress={exportData} accessibilityRole="button" accessibilityLabel="Export my data">
            {/* The note names the money and the bookings, because the whole
                defect was that it had neither and nobody could tell. It promises
                a LIST of files rather than the files: those are saved one at a
                time from the row below, and a JSON bundle cannot carry them. */}
            <Row t={t} first label={dataBusy ? 'Preparing Export…' : 'Export My Data'} sub={EXPORT_ROW_NOTE}
              right={<Text style={{ ...ty.head, color: t.brand }}>{'⤓'}</Text>} />
          </Pressable>
          {/* Only after an export, because the manifest is what the export
              produced and this row must list exactly what that file says the
              member has. `filesRowNote` refuses to state a count over a read
              that came back short. */}
          {files !== null ? (
            <Pressable onPress={() => setFilesOpen(true)} accessibilityRole="button"
              accessibilityLabel="Save my files" disabled={files.length === 0}
              accessibilityState={{ disabled: files.length === 0 }}>
              <Row t={t} label="Save My Files" sub={filesRowNote(files.length, filesComplete)}
                right={files.length > 0 ? <Icon name={FORWARD_ICON} size={15} color={t.ink3} /> : undefined} />
            </Pressable>
          ) : null}
          {deletion === null ? (
            // Not read yet. Deliberately not pressable: requesting again would
            // reset deletion_requested_at, restarting somebody's 30 days.
            <Row t={t} label="Delete My Account" sub="Checking whether you already have a request in…" right={<Icon name={FORWARD_ICON} size={15} color={t.ink3} />} />
          ) : deletion === 'failed' ? (
            <>
              <Row t={t} label="Deletion Status Unknown" sub="We couldn't check whether you already have a request in. That's a read that failed, not an answer — it does not mean you have none." right={
                <Pressable onPress={() => { void loadDeletion(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Check your deletion status again"
                  style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try Again</Text>
                </Pressable>
              } />
              <Pressable onPress={deleteAccount} accessibilityRole="button" accessibilityLabel="Delete my account">
                <Row t={t} label="Delete My Account" sub="Request permanent erasure of your account and data" right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
                  </View>
                } />
              </Pressable>
            </>
          ) : pendingAt ? (
            <>
              <Row t={t} label="Deletion Requested" sub={`Asked on ${requestedDay(pendingAt)} · your account and data are due to be erased`} right={
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
              } />
              <Pressable onPress={withdrawDeletion} disabled={withdrawBusy} accessibilityRole="button" accessibilityLabel="Withdraw my deletion request">
                <Row t={t} label={withdrawBusy ? 'Withdrawing…' : 'Withdraw My Deletion Request'} sub="Keep your account. You can withdraw until the deletion is actioned, and ask again at any time."
                  right={<Icon name={FORWARD_ICON} size={15} color={t.ink3} />} />
              </Pressable>
            </>
          ) : (
            <Pressable onPress={deleteAccount} accessibilityRole="button" accessibilityLabel="Delete my account">
              <Row t={t} label="Delete My Account" sub="Request permanent erasure of your account and data" right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                  <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
                </View>
              } />
            </Pressable>
          )}
        </Section>

        <Rule />

        {/* ── Legal ──────────────────────────────────────────────────────
            The four sentences below are a SUMMARY, and they used to be the only
            legal text reachable anywhere in this product: sign-up asserted
            agreement to a Terms and a Privacy Policy with no route to either,
            and this paraphrase — written by us, about ourselves — stood in for
            both. A summary is the part of a document we thought was worth
            mentioning; it is not what anybody agreed to.

            The summary stays, because it is genuinely the useful thing to read
            first. What is new is that it says what it is, and the document
            itself is one tap under it. See src/ui/legal.ts. */}
        <Section>
          <SectionHead title="Legal" />
          <Pressable onPress={() => setLegal(legal === 'privacy' ? null : 'privacy')}>
            <Row t={t} first label="Privacy Policy" right={<Text style={{ ...ty.body, color: t.ink3 }}>{legal === 'privacy' ? '▾' : FORWARD_CHAR}</Text>} />
          </Pressable>
          {legal === 'privacy' ? (
            <View style={{ paddingVertical: sp.sm, gap: sp.md }}>
              <Text style={{ ...ty.label, color: t.ink3 }}>In short: we store your training, nutrition and body data to power your plan. Health data is never sold or shared with advertisers. You can export or delete your data at any time from your account. Photos and scans are stored securely and visible only to you and your coach.</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>That is a summary we wrote. The policy you agreed to is the full document.</Text>
              <View style={{ flexDirection: 'row' }}>
                <Ghost label="Read The Privacy Policy" onPress={() => { void openLegalDoc('privacy'); }} />
              </View>
            </View>
          ) : null}
          <Pressable onPress={() => setLegal(legal === 'terms' ? null : 'terms')}>
            <Row t={t} label="Terms of Service" right={<Text style={{ ...ty.body, color: t.ink3 }}>{legal === 'terms' ? '▾' : FORWARD_CHAR}</Text>} />
          </Pressable>
          {legal === 'terms' ? (
            <View style={{ paddingVertical: sp.sm, gap: sp.md }}>
              <Text style={{ ...ty.label, color: t.ink3 }}>In short: {BRAND.label} provides fitness and nutrition guidance for general wellness and is not a substitute for medical advice. Consult a physician before starting any program. Coaching is delivered by independent trainers on the platform; billing terms are shown at checkout.</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>That is a summary we wrote. The terms you agreed to are the full document.</Text>
              <View style={{ flexDirection: 'row' }}>
                <Ghost label="Read The Terms Of Service" onPress={() => { void openLegalDoc('terms'); }} />
              </View>
            </View>
          ) : null}
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

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl }}>{BRAND.label} · made for coaches &amp; their clients</Text>
      </ScrollView>

      {/* ── your files ──────────────────────────────────────────────────────
          One at a time, and that is not an apology. The share sheet takes one
          file, and a member's message attachments can be 64 MB of video each
          (supabase/parts/124) — a bundle assembled in memory is a crash at the
          exact moment somebody is taking the last copy of their records.

          Every row says what the file is in words rather than showing a storage
          key, and the injury documents say plainly that nobody else can see
          them, because that is the promise the rest of the product makes about
          them and this is the one screen where the member gets them back. */}
      <Modal visible={filesOpen} transparent animationType="slide" onRequestClose={() => setFilesOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setFilesOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: layout.gutter, paddingBottom: sp.xxl, maxHeight: '86%', ...elevation.e2 }}>
          <Text style={{ ...ty.title, color: t.ink }}>Your files</Text>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm, marginBottom: sp.lg }}>
            {filesRowNote(files?.length ?? 0, filesComplete)} Tap one to save it to your phone.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {(files ?? []).map((f, i) => (
              <View key={f.path}>
                {i > 0 ? <Rule /> : null}
                <Pressable onPress={() => { void saveFile(f); }} disabled={!!savingPath}
                  accessibilityRole="button" accessibilityLabel={`Save ${f.what}`}
                  accessibilityState={{ disabled: !!savingPath }}
                  style={{ paddingVertical: sp.md, opacity: savingPath && savingPath !== f.path ? 0.5 : 1 }}>
                  <Text style={{ ...ty.body, color: t.ink }}>{f.what}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {savingPath === f.path ? 'Saving…' : fileSizeLabel(f.sizeBytes)}
                  </Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setFilesOpen(false)} accessibilityRole="button"
              accessibilityLabel="Close your files"
              style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
