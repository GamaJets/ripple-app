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
// ── And a whole channel muted is not "not at eleven at night" ──────────────
//
// The five switches have no time dimension, and the complaint they came from
// was an hour rather than a category: a coach who mutes client messages to stop
// the 11pm ping has stopped their clients being able to reach them at all.
//
// Quiet hours for a coach cannot work the way the member's do. Every
// coach-directed notification is remote, so there is no scheduled trigger on
// this phone to move and nothing here knows what hour it is where the server
// is deciding. The window and an IANA zone are therefore stored server-side
// (supabase/parts/530) and the hour arithmetic happens in Postgres.
//
// Which leaves one honest problem, and this screen is where it is answered:
// none of that does anything until the two edge functions are redeployed to
// read it, and a switch the server does not apply is worse than no switch —
// the coach stops expecting the ping, gets it anyway, and stops trusting this
// page. So the control is drawn only when the server SAYS it applies quiet
// hours, and says which of the three states it is in otherwise. See
// `quietAvailability` in src/lib/quietHours.ts.
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
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, Alert, Pressable, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, Flag, fig } from '../../src/ui/kit';
import { useSettings } from '../../src/ui/settings';
import { convertedNote } from '../../src/lib/units';
import { fmtDay } from '../../src/lib/format';
import { sp, layout, hairline, type as ty, radius, elevation } from '../../src/theme/scale';
import { BuildInfo } from '../../src/ui/BuildInfo';
import { useAuth } from '../../src/ui/auth';
import { useAppLock } from '../../src/ui/appLock';
import { lockSettingNote } from '../../src/lib/appLock';
import { useTenant } from '../../src/ui/tenant';
import { CURRENCY_CHOICES, setCurrencyLine, WHY_NOT_A_REPRICE, type SetCurrencyOutcome } from '../../src/lib/coachCurrency';
import { fetchMyCurrency, setMyCoachCurrency } from '../../src/lib/myCurrency';
import { myCurrencyLine, type MyCurrency } from '../../src/lib/currencySource';
import {
  exportMyDataDetailed, readMyFile, requestAccountDeletion, withdrawAccountDeletion,
  fetchDeletionRequestedAt, type ExportFile,
} from '../../src/lib/gdpr';
import { fileShareBlocker, shareBinaryFile, shareTextFile } from '../../src/lib/exportShare';
import { BRAND } from '../../src/lib/brands';
import {
  COACH_DELETION_FILES_NOTE,
  coachDataFilename, fileSizeLabel, filesRowNote, incompleteExportLine, saveFileFailure,
} from '../../src/lib/dataExport';
import { reportError } from '../../src/lib/reportError';
import { parseCooldown, cooldownText, cooldownNote, MIN_NUDGE_COOLDOWN, MAX_NUDGE_COOLDOWN } from '../../src/lib/coachPrefs';
import { fetchCoachPrefs, saveCoachPrefs } from '../../src/lib/coachPrefsStore';
import { rateFieldNote } from '../../src/lib/coachPrefs';
import { useChannelPrefs, setChannel } from '../../src/ui/coachNotify';
import {
  COACH_CHANNELS, channelState, channelsNote,
  CHANNEL_UNKNOWN_LABEL, CHANNEL_MASTER_NOTE, CHANNEL_STILL_RECORDED,
  CHANNEL_ACCOUNT_WIDE, CHANNEL_LOCAL_NOTE,
} from '../../src/lib/coachNotify';
import { useQuietHours, saveQuietHours } from '../../src/ui/quietHours';
import {
  SUGGESTED_QUIET, deviceZone, hourLabel, windowLabel, quietAvailability,
  zoneMovedNote, QUIET_HELD_NOT_DELAYED, QUIET_ZONE_NOTE, QUIET_ORDER_NOTE,
  type QuietHours,
} from '../../src/lib/quietHours';
import { END_ALIGN } from '../../src/ui/direction';

/** A label and its value. `value` is already a string — see `fig`. */
function Line({ t, label, value, first }: { t: Theme; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: END_ALIGN }} numberOfLines={1}>{value}</Text>
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

/**
 * The same row, for a switch whose position may be UNKNOWN.
 *
 * `SwitchRow` above takes a boolean, and a boolean cannot say "we have not read
 * your answer yet" — it has to pick one of the two, and picking "on" is the app
 * stating a fact about somebody's settings that it has not looked up, on the
 * screen they came to in order to control them. A coach who then taps it has
 * just saved the value the app was guessing.
 *
 * So 'unknown' draws neither position: the track is neutral, the knob is
 * centred, and the row says which. It is still pressable — turning something
 * off is a valid thing to want to do — and the handler reports what the server
 * actually took.
 */
function TriSwitchRow({ t, label, note, state, onPress, first }: {
  t: Theme; label: string; note: string; state: 'on' | 'off' | 'unknown'; onPress: () => void; first?: boolean;
}) {
  const on = state === 'on';
  const unknown = state === 'unknown';
  return (
    <Pressable onPress={onPress} accessibilityRole="switch"
      accessibilityState={{ checked: unknown ? 'mixed' : on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: first ? 0 : sp.lg }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, color: t.ink }}>{label}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          {unknown ? `${CHANNEL_UNKNOWN_LABEL} — ${note}` : note}
        </Text>
      </View>
      <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: unknown ? t.surface2 : on ? t.brand : t.surface3, borderWidth: hairline, borderColor: unknown ? t.ring : on ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
        <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: unknown ? t.ink3 : on ? t.brandInk : t.ink3, alignSelf: unknown ? 'center' : on ? 'flex-end' : 'flex-start', opacity: unknown ? 0.45 : 1 }} />
      </View>
    </Pressable>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: 'Gym owner', trainer: 'Trainer', client: 'Member' };

/**
 * A timestamp as the day it happened, or a dash. Never the string "null".
 *
 * `String(iso).slice(0, 10)` is the UTC date of a timestamptz, and the sentence
 * this feeds — "You asked to be deleted on X" — is about a day in the coach's
 * own life. A coach at UTC+14 who tapped the button at nine on the morning of
 * the 1st was told they had asked on the 31st; one at UTC-11 who tapped it in
 * the evening was told they had asked tomorrow. Neither is a date they could
 * check against their own memory of doing it, which is the only thing this line
 * is for. `fmtDay` reads the instant in the reader's own zone and writes it the
 * way their locale writes a day, instead of as a bare column value.
 */
function day(iso: string | null): string {
  if (!iso) return '—';
  return fmtDay(iso);
}

export default function TrainerSettings() {
  const t = useTheme();
  const router = useRouter();
  const st = useSettings();

  /* ── the five categories ───────────────────────────────────────────────
   *
   * `channels.status` is carried out to every switch rather than collapsed to a
   * boolean. Under 'loading' and 'error' the muted set is empty, and an empty
   * muted set means "everything on" — so a screen that only read the set would
   * draw five switches in the on position over a read that never happened.
   */
  const channels = useChannelPrefs();
  const channelNote = channelsNote(channels.status);
  const toggleChannel = async (key: (typeof COACH_CHANNELS)[number]['key']) => {
    // Toggling from 'unknown' would save a value nobody read. A coach who wants
    // one off while the read is failing can have it once the read lands, and
    // the row already says which of the two states this is.
    const state = channelState(key, channels.muted, channels.status);
    if (state === 'unknown') {
      Alert.alert('Not Changed', channelNote ?? 'Your notification settings have not been read yet, so nothing was changed. Turning one on or off now would save over whatever is actually stored.');
      return;
    }
    const next = state === 'off';
    const ok = await setChannel(key, next);
    if (!ok) {
      Alert.alert('Not Saved', 'The server did not take that change, so nothing has moved. Your notifications carry on exactly as they were — try again once you have signal.');
    }
    // Re-read rather than assume: what the switch shows next comes from the
    // row, which is the same discipline `loadPending` above keeps.
    await channels.reload();
  };
  /* ── the hours, as opposed to the categories ──────────────────────────
   *
   * Held apart from the five switches above on purpose. Those say WHAT a coach
   * hears about; this says WHEN, and it is the answer to the complaint the five
   * were a partial fix for.
   *
   * Nothing here is drawn unless the server says it applies quiet hours.
   * `enforced` is a row part 530 ships FALSE and somebody flips by hand at the
   * moment they deploy the two edge functions — so between the SQL landing and
   * the deploy, this section is a sentence rather than a switch. Unread is its
   * own third state and reads differently again: "could not find out" is not
   * "your server does not do this".
   */
  const quiet = useQuietHours();
  const avail = quietAvailability(quiet.status === 'ready' ? quiet.enforced : null);
  const zone = deviceZone();
  const [quietBusy, setQuietBusy] = useState(false);
  /** The stored window, bound once so every hour on screen comes from the same
   *  one the guard tested. */
  const quietWindow = quiet.quiet;

  /** Save a window, or clear it, and say what the server actually took. Never
   *  patched locally: what the switch shows next comes from the row, which is
   *  the discipline every other control on this screen keeps. */
  const putQuiet = async (next: QuietHours | null) => {
    if (quietBusy) return;
    setQuietBusy(true);
    try {
      const ok = await saveQuietHours(next);
      if (!ok) {
        Alert.alert('Not Saved',
          'The server did not take that, so your quiet hours are exactly as they were. Try again once you have signal.');
        return;
      }
      await quiet.reload();
    } finally { setQuietBusy(false); }
  };

  const turnQuietOn = () => {
    // No zone, no window. Storing UTC on a coach's behalf would put a London
    // coach's 10pm at 11pm for half the year and a Los Angeles coach's in the
    // afternoon — a silence at the wrong hours is harder to diagnose than none.
    if (!zone) {
      Alert.alert('Cannot set quiet hours on this phone',
        "This phone did not report which timezone it is in, and quiet hours are applied by a server that has no other way to know. Without it the hours would be applied in the wrong ones, so nothing has been set.");
      return;
    }
    void putQuiet({ ...SUGGESTED_QUIET, tz: zone });
  };

  /** Move one end of the window. The other end and the zone are carried
   *  through unchanged — re-reading the device zone here would silently move a
   *  coach's window to wherever they are standing when they nudge an hour. */
  const moveQuiet = (which: 'fromHour' | 'toHour', by: 1 | -1) => {
    if (!quiet.quiet) return;
    const next = { ...quiet.quiet, [which]: (quiet.quiet[which] + by + 24) % 24 };
    // A zero-length window is refused by the database and would mean nothing
    // here either. Skipped over rather than rejected: the coach is holding a
    // stepper and an error dialog on the tenth tap is not an answer.
    if (next.fromHour === next.toHour) next[which] = (next[which] + by + 24) % 24;
    void putQuiet(next);
  };

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

  // ── How often the app may raise the same client ────────────────────────
  //
  // `MIN_COOLDOWN_DAYS = 7` and `DISMISS_FLOOR_DAYS = 30` were module constants
  // and one set of numbers for every coach. There is no one set: a coach whose
  // clients come to a room every Tuesday knows within a week that somebody has
  // stopped, and a coach with an online-only book needs a fortnight before
  // silence means anything. Both were given seven days, and both complained
  // about it from opposite directions.
  //
  // It is a FLOOR and not an override. The per-client pacing — off each
  // client's own rhythm — survives it, which is the part that works. See
  // `cooldownFloor` in src/lib/interventions.ts.
  //
  // Three states in the box, exactly as the class-rate box has: empty is an
  // instruction (give me the app's own pacing back) and is saved as NULL;
  // half-typed is not an instruction and is never saved; a number is a number.
  // `parseCooldown` is what keeps them apart, and a `parseInt` here would take
  // the 1 out of a "14" being typed and silence nothing for a day.
  const [cooldownBox, setCooldownBox] = useState('');
  const [cooldownStored, setCooldownStored] = useState<number | null>(null);
  const [cooldownStatus, setCooldownStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cooldownMsg, setCooldownMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { prefs, status } = await fetchCoachPrefs();
      if (!live) return;
      setCooldownStatus(status === 'ready' ? 'ready' : 'error');
      // Only fill the box from a read that ANSWERED. An empty box after a
      // refused read is empty for that reason and not because the coach has no
      // preference, and typing into it would save over what is there — the
      // failure `goalsEmptyLine` was written about, on a different field.
      if (status === 'ready') {
        setCooldownStored(prefs.nudgeCooldownDays);
        setCooldownBox(cooldownText(prefs.nudgeCooldownDays));
      }
    })();
    return () => { live = false; };
  }, [auth.user?.id]);

  const saveCooldown = async () => {
    const parsed = parseCooldown(cooldownBox);
    if (parsed.kind === 'invalid') {
      setCooldownMsg(`That is not a number of days this can use. Give it a whole number between ${MIN_NUDGE_COOLDOWN} and ${MAX_NUDGE_COOLDOWN}, or clear the box to go back to the app's own pacing.`);
      return;
    }
    const value = parsed.kind === 'empty' ? null : parsed.value;
    const ok = await saveCoachPrefs({ nudgeCooldownDays: value });
    if (!ok) {
      // Not "saved". The write is checked for a row count rather than for the
      // absence of an error, because a refused upsert comes back clean.
      setCooldownMsg('That did not save, so the window is unchanged. Nothing on your Quiet Clients screen has moved.');
      return;
    }
    setCooldownStored(value);
    setCooldownBox(cooldownText(value));
    setCooldownMsg(value == null
      ? 'Cleared. Each client is paced off their own rhythm again.'
      : `Saved. Nobody will be suggested twice inside ${value} day${value === 1 ? '' : 's'}.`);
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

  const { tenant, role, status: tenantStatus, loading: tenantLoading, refresh: refreshTenant, updateTenant, setOwnCurrency } = useTenant();

  // ── The currency, and the reason this control is on the COACH's screen ──
  //
  // Six screens in this app withhold every money figure when
  // `tenants.currency` is null — analytics, invoices, payments, profile and two
  // more — and all six end by telling the coach that "an owner sets one in the
  // gym settings". Nothing in the product offered the coach any way to fix it,
  // and for most coaches that sentence names nobody: part 153 measured that
  // every coach sits ALONE in a personal tenant, and part 99 gave the column no
  // default, so a coach who signs up today is permanently unpriced. Their
  // packages cannot be created at all — `createPackage` refuses to insert
  // without an explicit currency, correctly.
  //
  // Two routes, because there are two authorisations and neither covers the
  // other. An owner writes `tenants` directly under `tenants_owner_rw`, which
  // is what app/(owner)/ops.tsx already does. A coach cannot: `is_owner_of()`
  // requires `profiles.role = 'owner'`, so their UPDATE matches zero rows and
  // PostgREST calls that a success. They go through
  // `set_my_tenant_currency()` (supabase/parts/164), which is security definer
  // and grants exactly one thing — the sole occupant of a tenant may name its
  // currency once.
  //
  // `msg` is null until something has been attempted. An empty string and a
  // sentence are different states here and the screen must not draw a blank
  // flag when nothing has happened.
  const [curMsg, setCurMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [curBusy, setCurBusy] = useState(false);

  // ── the THIRD route, for a coach who has no gym at all ──────────────────
  //
  // The two routes above both write `tenants.currency`, and both need a
  // tenant. A coach whose `profiles.tenant_id` is null has none, so this
  // screen used to draw them one sentence — "This account is not attached to a
  // gym, so there is nothing here to price" — and no control of any kind.
  // That is not a dead end in some corner of the product: it is Add Package
  // disabled, no invoice issuable, and every session filed at a null rate,
  // for the coach this app is mostly sold to. `revoke_staff_role()` (part 711)
  // puts a coach into exactly that state by design, the moment a gym takes
  // them off its staff.
  //
  // Part 940 gives them `trainers.currency`, and `fetchMyCurrency` reads the
  // two in the one order that can never disagree: the gym wherever there is
  // one, their own only where there is not. `own` here is that read, and the
  // picker below is drawn from `own.canSetOwn` rather than from "there is no
  // code" — because a failed read has no code either, and offering a choice
  // over one is how a currency that already exists gets overwritten.
  const [own, setOwn] = useState<MyCurrency | null>(null);
  const loadOwnCurrency = useCallback(async () => { setOwn(await fetchMyCurrency()); }, []);
  useEffect(() => { void loadOwnCurrency(); }, [loadOwnCurrency]);

  const chooseCurrency = async (code: string) => {
    if (curBusy) return;
    setCurBusy(true);
    setCurMsg(null);
    let outcome: SetCurrencyOutcome;
    if (role === 'owner') {
      // The owner's own route. `updateTenant` counts the rows it wrote, so a
      // false here is a write that really did not land rather than an RLS
      // narrowing reported as success.
      outcome = (await updateTenant({ currency: code })) ? 'set' : 'refused';
    } else if (!tenant && tenantStatus === 'ready') {
      // No gym, established rather than assumed — `tenantStatus === 'ready'`
      // is doing the work here, because `!tenant` is also true of a read that
      // failed. The server checks the same thing again and refuses with
      // 'has-tenant' if it disagrees; this only decides which route to try.
      outcome = await setMyCoachCurrency(code);
    } else {
      outcome = await setOwnCurrency(code);
    }
    setCurBusy(false);
    setCurMsg({ bad: outcome !== 'set', text: setCurrencyLine(outcome, code) });
    // Re-read rather than patch. The provider holds the row and six other
    // screens read the column for themselves; a local patch here would be a
    // second copy of the answer written by the one caller with a reason to be
    // optimistic about it. `setOwnCurrency` refreshes itself, so this is only
    // the owner branch above catching up.
    if (outcome === 'set' && role === 'owner') refreshTenant();
    // The coach's own currency is not in the tenant provider, so it is re-read
    // here for the same reason: what the screen says next has to come from the
    // database rather than from the tap that hoped it would.
    if (outcome === 'set') void loadOwnCurrency();
  };

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
              Alert.alert('Not withdrawn', `Your deletion request is still in place — nothing has changed. Check your connection and try again, or email ${BRAND.supportEmail} from the address on your account.`);
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

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Four server reads sit behind this screen and each one has a state where
   * an unread answer looks exactly like a real one: the notification channels
   * (an empty muted set is "everything on"), the quiet-hours window and
   * whether the server enforces it, the gym row, and whether a deletion
   * request is pending — the last being the one a coach comes back to this
   * screen specifically to check.
   *
   * The units and the app lock are not in here. Both live on this handset,
   * this screen is the only thing that writes them, and there is no other copy
   * for a refresh to go and find. */
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    loadPending(), Promise.resolve(channels.reload()),
    Promise.resolve(quiet.reload()), Promise.resolve(refreshTenant()),
  ]), [loadPending, channels, quiet, refreshTenant]));

  /**
   * The manifest the last export produced, or null before there has been one.
   *
   * `exportMyDataDetailed` has returned `files` since the day it was written and
   * this screen took `res.json` and threw the rest away — so a coach's
   * photographs, their message attachments and any injury document of their own
   * were the one part of their record they could not get back, on the screen
   * whose whole purpose is getting it back. The member's side of the app
   * (app/(client)/settings.tsx) has had this since the manifest existed.
   *
   * Held rather than re-fetched, so the row below lists exactly what the file
   * they just saved says they have. `complete` is kept beside it because a
   * count over a short read is the same defect as `"workouts": []` over a
   * refused one — `filesRowNote` refuses to state one.
   */
  const [files, setFiles] = useState<ExportFile[] | null>(null);
  const [filesComplete, setFilesComplete] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [savingPath, setSavingPath] = useState<string | null>(null);

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // `coach: true` is what puts the coach's OWN business in the file. Without
      // it this screen handed a coach the member export — profiles, workouts,
      // food logs, scans, bookings, what they had PAID — and not one row of
      // what they charge, what they invoiced, what reached their bank or what
      // it cost them. See COACH_TABLES in src/lib/gdpr.ts, which also explains
      // why those tables are filtered by hand instead of left to RLS.
      const res = await exportMyDataDetailed({ coach: true });
      const json = res.json;
      // The filename comes from the brand rather than from a literal, the same
      // argument `MY_DATA_FILENAME` makes for the member's half: a coach at a
      // white-labelled chain saving 'repple-coach-my-data.json' has been handed
      // a file named after a company they do not deal with.
      await shareTextFile(json, coachDataFilename(BRAND.id), 'application/json', 'Export my data');
      // The manifest, so the files can be saved from the row below. Kept
      // whether or not the export was complete, along with WHETHER it was.
      setFiles(res.files);
      setFilesComplete(res.complete);
      if (!res.complete) {
        // A partial export handed over silently is the same failure one level
        // up: somebody deletes their account believing they have a copy. The
        // parts are NAMED rather than counted, and the sentence is the one the
        // member's screen shows, from src/lib/dataExport.ts — two wordings for
        // one fact is how they come to disagree.
        Alert.alert('That copy is incomplete',
          incompleteExportLine(res.failed.map((f) => f.table), BRAND.supportEmail));
      }
    } catch (e) {
      reportError('trainerSettings.export', e);
      Alert.alert('Export failed', 'Nothing was exported. Check your connection and try again.');
    } finally { setExporting(false); }
  };

  /**
   * Hand one of the coach's own files to the share sheet.
   *
   * One at a time, and that is not a limitation being apologised for: the share
   * sheet takes one file, and a message attachment can be 64 MB of video
   * (supabase/parts/124), so a bundle assembled in memory is a crash at the
   * exact moment somebody is taking their last copy.
   *
   * `shareBinaryFile` reports whether it actually landed, and a silent success
   * would be somebody believing they have saved something they have not.
   */
  const saveFile = async (f: ExportFile) => {
    if (savingPath) return;
    setSavingPath(f.path);
    try {
      const b64 = await readMyFile(f.bucket, f.path);
      if (!b64) { Alert.alert('Not saved', saveFileFailure(fileShareBlocker())); return; }
      // The object key's last segment — the name this app chose at upload, and
      // already safe on every platform, so nothing here has to invent one.
      const name = f.path.split('/').pop() || 'file';
      const ok = await shareBinaryFile(b64, name, 'application/octet-stream', 'Save this file');
      if (!ok) Alert.alert('Not saved', saveFileFailure(fileShareBlocker()));
    } finally { setSavingPath(null); }
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
      `${tenant ? `The owner of ${tenant.name}` : "Your gym's owner"} has 30 days to action this. It cannot be undone once they do.\n\n` +
      // The sentence above promises "your videos, your messages and your session
      // history" are erased, and the member's screen has carried the countervailing
      // detail since it was written (app/(client)/settings.tsx:396). This screen
      // carried none of it. Parts 1120, 1151 and 1152 are now applied, so what
      // this note has to be careful about has MOVED rather than gone: coach-logos,
      // coach-docs, exercise-videos and the coach's half of message-media are all
      // on `object_purge` now, and a coach whose documents have been accepted can
      // be erased — but a queued row is a delete that has been SENT, and the
      // acceptances go with the account. Both are said out loud in the wording.
      // One wording, from src/lib/dataExport.ts, so the two screens cannot drift.
      COACH_DELETION_FILES_NOTE,
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
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The padding stays at 40: the field sits well above the end of this screen, and the
          inset iOS adds already gives the focused row the room it needs to rise. Padding it
          out to a keyboard's height here would only scroll into empty space. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Settings</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Who you are signed in as, your data & this build</Text>

        <Rule />

        {/* The permanent way back to the first-run list. The row on the Clients
            screen removes itself once every step is done, and a screen reachable
            only from a row that removes itself is a screen that becomes
            unreachable by being used — so this one and the Explore entry never
            go away. The currency control further down this screen is the first
            item on that list, which is the other reason it belongs here. */}
        <Section>
          <SectionHead title="Getting Started" />
          <ListRow icon="sparkle" title="Getting Started"
            note="What is set up, and what is still worth doing"
            onPress={() => router.push('/(trainer)/getting-started')} />
        </Section>

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

          {/* ── the categories ────────────────────────────────────────────
              The switch above is all-or-nothing by construction: it removes
              this handset's row from `push_tokens`, which is the table the
              send-push function resolves recipients from. So a coach who muted
              to stop 11pm chat pings also stopped hearing that a client's card
              was declined, and would not turn it back on.

              The first five are a SERVER preference, because those
              notifications are remote — sent by a client's handset, by a
              trigger, or by an edge function — and a device-local switch would
              read "off" while the banner kept arriving. The filter is applied
              in supabase/functions/send-push and notify-message, where the
              recipients are resolved. src/lib/coachNotify.ts carries the whole
              argument.

              The sixth, Your Own Book, is the one thing on this list that is
              not somebody else doing something — an unmarked session, an
              overdue invoice, a client who has stopped — so there is no trigger
              to hang it on and this phone works it out. The ANSWER still lives
              in the same table, so it follows the coach between phones; only
              the place it is applied differs, and `CoachChannelDef.local` is
              what says which is which.

              An unread preference is NOT "opted in": a switch whose value has
              not been read draws in neither position and says so, because a
              coach who taps a guessed switch has just saved the guess. */}
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>What you are told about</Text>
            {channelNote ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{channelNote}</Text>
            ) : null}
            {COACH_CHANNELS.map((c, i) => (
              <View key={c.key}>
                <TriSwitchRow t={t} first={i === 0 && !channelNote}
                  label={c.title}
                  note={c.note}
                  state={channelState(c.key, channels.muted, channels.status)}
                  onPress={() => { void toggleChannel(c.key); }} />
                {/* Only under the two switches whose muting costs something a
                    coach would not notice, and each says its OWN cost — a
                    failed subscription payment and an unmarked session are
                    different harms, and one shared sentence would have named
                    the wrong one under one of them. */}
                {c.quietCost && channelState(c.key, channels.muted, channels.status) === 'off' ? (
                  <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{c.quietCost}</Flag>
                ) : null}
                {/* And under the one that this phone works out for itself,
                    because "arrives with no signal" and "only as current as the
                    last time you opened the app" are both true of it and of
                    nothing else in the list. */}
                {c.local ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{CHANNEL_LOCAL_NOTE}</Text>
                ) : null}
              </View>
            ))}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{CHANNEL_STILL_RECORDED}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{CHANNEL_ACCOUNT_WIDE}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{CHANNEL_MASTER_NOTE}</Text>
          </View>

          {/* ── the hours ──────────────────────────────────────────────────
              The five switches above answer "what am I told about" and the
              complaint they came from was "at eleven at night". This is the
              other half.

              It is drawn only when the server says it applies it. Between part
              530 landing and supabase/functions/send-push and notify-message
              being redeployed to read it, a switch here would be a coach
              turning quiet hours on and being buzzed at 11pm anyway — after
              which they will not trust the switches above either. Three states,
              three sentences: available, not yet, and could-not-find-out. */}
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>When you will not be buzzed</Text>

            {quiet.status === 'loading' ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Reading your quiet hours…</Text>
            ) : !avail.available ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{avail.note}</Text>
            ) : (<>
              <SwitchRow t={t} first
                label="Quiet Hours"
                note={quiet.quiet
                  ? `Your phone stays quiet from ${windowLabel(quiet.quiet)}`
                  : 'Hold pushes overnight, or over whatever hours you choose'}
                on={!!quiet.quiet}
                onPress={() => { if (quiet.quiet) void putQuiet(null); else turnQuietOn(); }} />

              {/* Bound once. `quiet.quiet` is a property on a hook's return
                  value and TypeScript cannot narrow it across the callbacks
                  below — and neither can a reader, which is the better reason:
                  every hour drawn here has to come from the same window the
                  guard above tested. */}
              {quietWindow ? (<>
                {/* Two steppers rather than a picker: this is a whole hour on
                    either end and there are only ever two numbers to move. The
                    labels say the hour rather than the digit, because "22" and
                    "10pm" are the same fact and only one of them is what a
                    coach thinks in. */}
                <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.lg }}>
                  {([['fromHour', 'From'], ['toHour', 'Until']] as const).map(([key, label]) => (
                    <View key={key} style={{ flex: 1 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{label}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 4 }}>
                        <Pressable onPress={() => moveQuiet(key, -1)} disabled={quietBusy} hitSlop={8}
                          accessibilityRole="button" accessibilityLabel={`An hour earlier, ${label.toLowerCase()}`}
                          style={{ paddingHorizontal: sp.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: t.surface2, opacity: quietBusy ? 0.5 : 1 }}>
                          <Text style={{ ...ty.label, color: t.ink2 }}>−</Text>
                        </Pressable>
                        <Text style={{ ...ty.body, color: t.ink, minWidth: 68, textAlign: 'center' }}>
                          {hourLabel(quietWindow[key])}
                        </Text>
                        <Pressable onPress={() => moveQuiet(key, 1)} disabled={quietBusy} hitSlop={8}
                          accessibilityRole="button" accessibilityLabel={`An hour later, ${label.toLowerCase()}`}
                          style={{ paddingHorizontal: sp.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: t.surface2, opacity: quietBusy ? 0.5 : 1 }}>
                          <Text style={{ ...ty.label, color: t.ink2 }}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Said where it is true and nowhere else: a coach who set
                    these in London and is now in Dubai is silent from 2am
                    local, and nothing else on this screen would explain it. */}
                {zoneMovedNote(quietWindow.tz, zone) ? (
                  <Flag tone={t.warn} style={{ marginTop: sp.md }}>{zoneMovedNote(quietWindow.tz, zone)}</Flag>
                ) : null}

                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{QUIET_HELD_NOT_DELAYED}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{QUIET_ZONE_NOTE}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{QUIET_ORDER_NOTE}</Text>
              </>) : null}
            </>)}
          </View>
        </Section>

        <Rule />

        {/* How often Quiet Clients may raise the same person. See the long note
            on `saveCooldown` above for why this is a floor rather than an
            override, and why the box has three states rather than two. */}
        <Section>
          <SectionHead title="Quiet Clients" />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md }}>
            <View style={{ flex: 1, paddingEnd: sp.md }}>
              <Text style={{ ...ty.body, color: t.ink }}>Shortest gap between approaches</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {cooldownStatus === 'ready'
                  ? cooldownNote(cooldownStored)
                  : (rateFieldNote(cooldownStatus === 'loading' ? 'loading' : 'error') ?? '')}
              </Text>
            </View>
            <TextInput
              value={cooldownBox}
              onChangeText={(v) => { setCooldownBox(v); setCooldownMsg(null); }}
              onBlur={() => { void saveCooldown(); }}
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Shortest number of days between two approaches to the same client"
              placeholder="days"
              placeholderTextColor={t.ink3}
              style={{
                ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
                paddingHorizontal: sp.md, paddingVertical: 10, minWidth: 84, textAlign: END_ALIGN,
              }}
            />
          </View>
          {cooldownMsg ? (
            <Flag tone={/did not save|not a number/.test(cooldownMsg) ? t.crit : t.good}>{cooldownMsg}</Flag>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            This is a floor and not a schedule. Each client is still paced off how often they used to train, so
            somebody who came fortnightly is left longer than somebody who came daily. Nothing here sends anything
            to anybody.
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
            <View style={{ flex: 1, paddingEnd: sp.md }}>
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

        {/* Currency.
            The setting six other screens point at and none of them could
            reach. See the note on `chooseCurrency` above for why there are two
            write routes and why a coach needed one at all.
            Ordered deliberately: the read has to be established before
            anything is said about what is set, because a tenant that could not
            be read holds an unknown currency and not a missing one — and
            "your gym has not set a currency" is precisely the sentence
            src/lib/currencyGap.ts exists to stop being said about a failed
            read. */}
        <Section>
          <SectionHead title="Currency" />
          {tenantStatus === 'loading' || tenantLoading ? (
            <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.md }}>Reading your gym…</Text>
          ) : tenantStatus === 'error' ? (
            // UNKNOWN, not unset. Nothing is offered: a picker drawn over a
            // failed read would let a coach set a currency onto a tenant that
            // may already have one, which is the reprice this whole control
            // refuses to perform.
            <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
              Your gym could not be read, so what it charges in is not known. That is a read that failed rather than a setting nobody has made, and nothing can be changed until it can be read.
            </Flag>
          ) : !tenant ? (
            // NO GYM — and, since part 940, no longer a dead end.
            //
            // Four different sentences under here and they are four different
            // facts. `own` is null until the read comes back; after that the
            // gap says which of "could not read", "not deployed yet", "no
            // coach record" and "you have not chosen" is true, and only the
            // last of them draws a picker. `canSetOwn` is the gate rather than
            // "there is no code", because a failed read has no code either and
            // a picker over one can overwrite a currency that already exists.
            !own ? (
              <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.md }}>Reading what you charge in…</Text>
            ) : own.currency ? (<>
              <Line t={t} first label="Priced in" value={own.currency} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{WHY_NOT_A_REPRICE}</Text>
            </>) : own.canSetOwn ? (<>
              <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.md }}>
                You are attached to no gym, so what you charge in is yours to say — and until you say it every amount in this app is withheld rather than guessed at: your analytics, your invoices, the price of anything you sell and the rate every session is filed at. Repple is white-labelled and there is no default that would be right for both a London coach and a Tokyo one. Choose once. It is not editable afterwards, because every price you go on to store is denominated in it.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {CURRENCY_CHOICES.map((c) => (
                  <Pressable key={c} onPress={() => { void chooseCurrency(c); }} disabled={curBusy}
                    accessibilityRole="button" accessibilityState={{ disabled: curBusy }}
                    accessibilityLabel={`Price me in ${c}`}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: t.surface2, opacity: curBusy ? 0.5 : 1 }}>
                    <Text style={{ ...ty.label, color: t.ink2 }}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </>) : (
              // Everything else this read can come back as. A mark, never ink
              // on the sentence: nothing here has gone wrong on the coach's
              // account, and two of the three are somebody else's deploy.
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                {myCurrencyLine(own.gap ?? 'unreadable', 'nothing in this app can be priced')}
              </Flag>
            )
          ) : tenant.currency ? (<>
            <Line t={t} first label="Priced in" value={tenant.currency} />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{WHY_NOT_A_REPRICE}</Text>
          </>) : (<>
            <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.md }}>
              Nobody has said what you charge in, so every amount in this app is withheld rather than guessed at — your analytics, your invoices and the price of anything you sell. Repple is white-labelled and there is no default that would be right for both a London gym and a Dubai one. Choose once and every screen follows.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {CURRENCY_CHOICES.map((c) => (
                <Pressable key={c} onPress={() => { void chooseCurrency(c); }} disabled={curBusy}
                  accessibilityRole="button" accessibilityState={{ disabled: curBusy }}
                  accessibilityLabel={`Price me in ${c}`}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: t.surface2, opacity: curBusy ? 0.5 : 1 }}>
                  <Text style={{ ...ty.label, color: t.ink2 }}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </>)}
          {/* Said whichever branch drew it, because 'already set' and 'you
              share this gym' both arrive after the picker has been replaced by
              the state they describe. A flag for anything that did not land:
              a coach who taps a currency and gets a quiet grey line reads it as
              having worked. */}
          {curMsg ? (
            curMsg.bad
              ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{curMsg.text}</Flag>
              : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{curMsg.text}</Text>
          ) : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Account &amp; Sign-in" />
          {/* The other half of src/lib/accountSecurity.ts. It was written,
              tested and wired into the CLIENT app only, so a coach who wanted
              to change their password had to sign out and trigger a reset email
              for a password they had not forgotten — and had no route at all to
              a new address, which is the only way back in if they lose it. */}
          <ListRow icon="lock" title="Change Password or Email"
            note="The password you sign in with, and the address a reset would go to"
            onPress={() => router.push('/(trainer)/account')} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your Data" />
          <ListRow icon="share" title={exporting ? 'Preparing Export…' : 'Export My Data'}
            note="Your account and your coaching business — your price list, invoices, receipts, payouts, costs and enquiries — as a JSON file you can keep, plus a list of every file you hold"
            onPress={exportData} />
          {/* Only after an export, because the manifest is what the export
              produced and this row must list exactly what that file says the
              coach holds. `filesRowNote` refuses to state a count over a read
              that came back short. A JSON bundle cannot carry the bytes — a
              message attachment is up to 64 MB of video and base64 in a string
              is a third larger again — so the files are saved one at a time. */}
          {files !== null ? (
            <ListRow icon="camera" title="Save My Files"
              note={filesRowNote(files.length, filesComplete)}
              onPress={() => { if (files.length > 0) setFilesOpen(true); }} />
          ) : null}
          {pending?.requestedAt ? (
            <ListRow icon="back" title={withdrawing ? 'Withdrawing…' : 'Withdraw My Deletion Request'}
              note="Keep your account. You can withdraw right up until the deletion is carried out."
              onPress={withdraw} />
          ) : (
            <ListRow icon="minus" tone={t.crit} title={deleting ? 'Requesting…' : 'Delete My Account'}
              note="Ask for your account and your data to be erased permanently"
              onPress={deleteAccount} />
          )}
          {/* crit as ink measures 3.03–4.05:1 on all ten palettes, so the one
              line saying the deletion request could not be read was the least
              legible thing in the section. The dot carries crit at the 3:1 a
              mark needs; the sentence stays ink. */}
          {pendingFailed
            ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{requestLine}</Flag>
            : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{requestLine}</Text>}
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

      {/* The files themselves, one at a time. Named in the coach's own words by
          `FILE_KINDS` in src/lib/gdpr.ts, because "photo_1724.jpg" tells nobody
          which of these is their physiotherapy report. */}
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
