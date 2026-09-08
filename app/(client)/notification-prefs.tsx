// Client · Notification preferences. Which kinds of notification this app
// sends, and the hours it will not send them in.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// One row on the settings screen — "Push Notifications" — covering session
// reminders, class reminders, coach messages, notices and invoices together.
// So the only way to stop a 6am class reminder was to stop hearing from your
// coach, and the only way to sleep through a 3am hydration nudge was to turn
// everything off and lose the session reminders with it.
//
// ── The one thing this screen must not do ─────────────────────────────────
//
// Offer a switch it cannot honour. Everything in the first list is scheduled BY
// THIS PHONE and is gated inside src/ui/pushNotifications.ts, where a caller
// cannot skip it. That is the failure src/lib/pushConsent.ts exists for,
// pointing the other way, and it is still the rule.
//
// ── What this screen refused, and what changed ────────────────────────────
//
// This paragraph used to end: the coach-and-gym category "is sent from the
// server, which has never heard of these preferences — so it is shown as a row
// that says so rather than as a switch that would read 'off' while the banners
// went on arriving". The section below it was a paragraph of prose where five
// switches now are.
//
// That was true, and the half of it that was load-bearing has stopped being.
// The premise was that the only place a preference could live is this handset,
// and a handset cannot gate somebody else's send. `notify_channel_prefs` (parts
// 251 and 730) is on the ACCOUNT, its `ncp_self` policy is `user_id =
// auth.uid()` for any authenticated account rather than for coaches, and both
// senders filter on it: supabase/functions/send-push drops muted recipients
// before it reads their tokens, and supabase/functions/notify-message applies
// 'chat' to its `recipient` — which is the member whenever a coach writes. So
// the server has been able to honour a member's answer since those deployed,
// and the only thing missing was a screen that asked for one. The reasoning is
// kept rather than deleted because it is still the reasoning: what is offered
// below is offered because it is stored where the sender can read it, and the
// device-local list above is still refused a remote category for exactly the
// argument this paragraph used to make about all of them.
//
// The full case, including which of the five reach everything their label names
// and which reach only the server's half, is in src/lib/notifyPrefs.ts. So is
// the one thing this screen may not say: the table holds no rows at all, so
// nothing has ever been suppressed for anybody, and every sentence under these
// switches states what the senders do with a row rather than reporting an
// effect somebody has had.
//
// ── What the Quiet Hours section below is now ─────────────────────────────
//
// It used to be a device switch and two boxes, and everything it governed was
// scheduled by this handset. The half a member could not reach was the one that
// matters most to them: `notify_quiet_hours` (part 530) is keyed on `user_id`
// with an `authenticated` RLS policy, supabase/functions/send-push filters
// every recipient id through `notify_quiet_now` and notify-message applies it
// to `recipient` — which is the CLIENT whenever a coach sends. The server has
// honoured a member's quiet hours since that shipped, and the only screen that
// ever drew the control was app/(trainer)/settings.tsx.
//
// So a member was silenced at 3am by a rule nothing offered them, and their one
// control over their coach's midnight message was the master Push Notifications
// switch, which takes the handset out of `push_tokens` entirely.
//
// One window, written to both halves, is what src/lib/clientQuiet.ts exists to
// make sayable: the two mechanisms behave differently — this app HOLDS a
// reminder it scheduled and the server SUPPRESSES a push it cannot take back —
// and a member who set one window meaning one thing has to be told both. Its
// four sentences are printed under the control verbatim; nothing here restates
// them in its own words.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Ghost, Field, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useNotifyPrefs } from '../../src/ui/notifyPrefs';
import {
  CATEGORIES, allows,
  MEMBER_CHANNELS, MEMBER_CHANNELS_ACCOUNT, MEMBER_CHANNELS_NOT_COVERED,
  MEMBER_CHANNELS_REACH, MEMBER_CHANNELS_STILL_RECORDED,
  type MemberChannel,
} from '../../src/lib/notifyPrefs';
// The member's switches are stored in the same table the coach's are, so they
// are read and written by the same two functions rather than by a second copy
// of them, and their state machine — 'unknown' for a read that has not landed
// or failed, never 'on' — is the one already under test in coachNotify.test.ts.
import { useChannelPrefs, setChannel } from '../../src/ui/coachNotify';
import { channelState, channelsNote, CHANNEL_UNKNOWN_LABEL } from '../../src/lib/coachNotify';
import { pushAvailable } from '../../src/ui/pushNotifications';
import { BACK_ICON } from '../../src/ui/direction';
import { useQuietHours, saveQuietHours } from '../../src/ui/quietHours';
import {
  SUGGESTED_QUIET, deviceZone, hourLabel, quietAvailability, zoneMovedNote,
} from '../../src/lib/quietHours';
import {
  QUIET_COST, QUIET_LOCAL_EFFECT, QUIET_REMOTE_EFFECT, QUIET_ZONE_KEPT,
  quietNow, quietSaveNote, quietView,
} from '../../src/lib/clientQuiet';
import { isWhole } from '../../src/ui/loadStatus';
import { useNow } from '../../src/ui/today';

/* ── the six sentences src/lib/clientQuiet.ts does not carry ───────────────
 *
 * That module holds what a SAVED window does and what a half-saved one did.
 * These are the states around it that a screen has and a pure module does not:
 * the account read that has not landed or failed, a window being TURNED OFF
 * rather than set, a draft that has been typed and not saved, and a server that
 * does not apply the remote half at all. None of them restates a sentence from
 * clientQuiet in different words — where one of those fits, it is printed.
 */

/** The account read failed. Not "you have no quiet hours": a failed select is
 *  the one thing that must never render as an answer, and offering the control
 *  over a window we could not read would let a save overwrite hours the member
 *  set on another handset with whatever this one happens to show. */
const QUIET_READ_FAILED =
  'Your quiet hours could not be read from your account, so they are not shown and cannot be changed here right '
  + 'now. That is a read that failed rather than an answer — open this again once you have signal.';

/** Saved, on a server that does not apply the remote half. The local effect is
 *  real and is stated; the remote one is not claimed. */
const QUIET_PHONE_ONLY_SAVED =
  'Saved on this phone. Reminders this app sets will wait for the morning; anything sent to you is unaffected, '
  + 'because this server does not apply quiet hours to what it sends.';

/** Turned off on such a server. */
const QUIET_PHONE_ONLY_OFF =
  'Quiet hours are off on this phone. Reminders this app sets arrive whenever they are due.';

/** Turned off, both halves. Says what now arrives rather than "done". */
const QUIET_OFF_SAVED =
  'Quiet hours are off. Reminders this app sets arrive whenever they are due, and anything sent to you buzzes at '
  + 'whatever hour it is sent.';

/** Turned off on the phone and not on the account — the mirror of the
 *  half-save `quietSaveNote` names, and the one a member would otherwise read
 *  as "off" while their coach's messages stayed silent all night. */
const QUIET_OFF_HALF =
  'Only half of this turned off. Reminders this app sets now arrive whenever they are due, but your account still '
  + 'has quiet hours on it, so anything sent to you stays silent inside them. Try again once you have signal.';

/** A typed window is not a set one. Shown while the boxes disagree with what is
 *  actually in force, because two hours on a screen read as two hours applied. */
const QUIET_UNSAVED =
  'These hours are not in force yet. Save them.';

/** Tapped while the account read has not landed or has failed. Not a save and
 *  not a refusal by the server — nothing was sent, and saying so is the
 *  difference between "try again" and "this control does not work". */
const CHANNEL_NOT_READ =
  'Your account has not told us which of these you have turned off, so nothing was changed. Turning one now would save over whatever is actually stored.';

/** The server refused, or the write reached nothing. `setChannel` counts rows
 *  rather than trusting the absence of an error, so this covers both. */
const CHANNEL_NOT_SAVED =
  'That change was not saved, so nothing has moved — your notifications carry on exactly as they were. Try again once you have signal.';

/**
 * The one thing the master switch does that these cannot.
 *
 * The member's version of `CHANNEL_MASTER_NOTE`, worded for the switch they
 * actually have: theirs is in the phone's own Settings and in the app's,
 * and it takes this handset out of `push_tokens` altogether.
 */
const CHANNEL_MASTER =
  'These only matter while Push Notifications is on. Turning that off takes this phone off the list entirely, so nothing arrives whatever is set here.';

/** A tri-state switch. `unknown` is a real answer and neither position is: a
 *  switch drawn on over a read that never happened is the app stating a fact
 *  about somebody's settings that it has not looked up. The pattern is
 *  `TriSwitchRow` in app/(trainer)/settings.tsx and the colours are this
 *  screen's own. */
function TriSwitch({ t, label, state, onPress }: {
  t: ReturnType<typeof useTheme>; label: string; state: 'on' | 'off' | 'unknown'; onPress: () => void;
}) {
  const on = state === 'on';
  const unknown = state === 'unknown';
  return (
    <Pressable onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: unknown ? 'mixed' : on }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
      style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: unknown ? t.surface2 : on ? t.brand : t.surface3, borderWidth: hairline, borderColor: t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
      <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: unknown ? t.ink3 : '#fff', alignSelf: unknown ? 'center' : on ? 'flex-end' : 'flex-start', opacity: unknown ? 0.45 : 1 }} />
    </Pressable>
  );
}

export default function NotificationPrefs() {
  const t = useTheme();
  const router = useRouter();
  const { prefs, loaded, setCategory, setQuiet, setQuietHours } = useNotifyPrefs();

  const switches = CATEGORIES.filter((c) => c.local);
  const G = layout.gutter;

  /* ── the switches that are not this phone's ────────────────────────────
   *
   * `useChannelPrefs` and `setChannel` are the coach's own reader and writer,
   * used unchanged. There is one table, one filter and one state machine, and a
   * second copy of any of them for the member would be a second chance to
   * disagree with the server about what `enabled = false` means.
   *
   * `channelState` and not `muted.has(key)`. Under 'loading', 'partial' and
   * 'error' the muted set is empty, and an empty set reads as everything on —
   * so a screen that consulted the set alone would draw five switches in the on
   * position over a read that has not happened, on the screen a member opened
   * in order to find out what is on. `isWhole` is the same rule this file
   * already applies to the quiet-hours read, spelled the way that module spells
   * it.
   */
  const channels = useChannelPrefs();
  const channelNote = channelsNote(channels.status);
  const [channelSaid, setChannelSaid] = useState<{ note: string; ok: boolean } | null>(null);
  const toggleChannel = async (key: MemberChannel, title: string) => {
    const state = channelState(key, channels.muted, channels.status);
    // Refused from 'unknown' rather than guessed. Tapping here would write the
    // position the screen happens to be drawing, which is not an answer anybody
    // gave — and on this table the value written is the one the server obeys.
    if (state === 'unknown') {
      setChannelSaid({ note: channelNote ?? CHANNEL_NOT_READ, ok: false });
      return;
    }
    const next = state === 'off';
    const ok = await setChannel(key, next);
    // Said from what the server took, never from the tap. `setChannel` counts
    // the rows it changed, so a write that landed nowhere reports as one.
    setChannelSaid(ok
      ? { note: `${title} is ${next ? 'on' : 'off'} on your account.`, ok: true }
      : { note: CHANNEL_NOT_SAVED, ok: false });
    // Re-read rather than assume: what the switch shows next comes from the
    // row, which is the discipline the quiet-hours save below keeps too.
    await channels.reload();
  };

  /* ── one window, two mechanisms ────────────────────────────────────────
   *
   * The same wiring as app/(trainer)/settings.tsx — `useQuietHours` for the
   * account row and the rollout, `saveQuietHours` for the write, and the write
   * counted from the rows it handed back rather than from the absence of an
   * error. What differs is that a member has a SECOND half: `NotifyPrefs.quiet`
   * on this handset, which moves the reminders this app schedules. Both are
   * written from one control.
   */
  const quiet = useQuietHours();
  /* `isWhole`, not `!== 'error'`. 'loading' here means the account row has not
   * come back, and a window drawn from that is this screen telling a member
   * they have no quiet hours for as long as the read takes — after which a save
   * would write that over the hours they set on their last phone. */
  const quietRead = isWhole(quiet.status);
  const avail = quietAvailability(quietRead ? quiet.enforced : null);
  /** Whether the SERVER half is on offer at all. False between part 530's SQL
   *  landing and send-push/notify-message being deployed to read the view, and
   *  false on a database that never had part 530. The device half works either
   *  way, so the control stays — what changes is which sentences are true. */
  const remoteHalf = avail.available;
  const zone = deviceZone();
  const now = useNow();
  /* `stored` is passed as null when the remote half is not applied, because
   * `quietView`'s server-only sentence says the row "is already stopping
   * anything sent to you" — which on a server that has not deployed the filter
   * would be a promise nothing keeps. */
  const view = quietView(prefs, remoteHalf ? quiet.quiet : null);

  const [draftOn, setDraftOn] = useState<boolean | null>(null);
  const [draftFrom, setDraftFrom] = useState<number>(SUGGESTED_QUIET.fromHour);
  const [draftTo, setDraftTo] = useState<number>(SUGGESTED_QUIET.toHour);
  const [quietBusy, setQuietBusy] = useState(false);
  /** What the last save actually did, and whether it did all of it. The flag
   *  under the button is toned from `ok` rather than always warned: a save that
   *  landed in both halves is not a warning, and a half-save is not a success. */
  const [quietNote, setQuietNote] = useState<{ note: string; ok: boolean } | null>(null);

  // Seeded from what is in force, and re-seeded only when THAT moves — after a
  // save, or when the account read lands on a handset that had nothing. Not per
  // render: the member is typing into these boxes.
  useEffect(() => {
    if (!loaded || !quietRead) return;
    setDraftOn(view.fromHour != null);
    if (view.fromHour != null && view.toHour != null) {
      setDraftFrom(view.fromHour);
      setDraftTo(view.toHour);
    }
  }, [loaded, quietRead, view.fromHour, view.toHour]);

  const quietOn = draftOn ?? (view.fromHour != null);
  /** A zero-length window is refused by the database and means nothing here
   *  either. Not saveable, and said on the screen rather than in a dialog. */
  const quietEmpty = quietOn && draftFrom === draftTo;
  /** The boxes disagree with what is applied. */
  const quietUnsaved = quietOn !== (view.fromHour != null)
    || (quietOn && (draftFrom !== view.fromHour || draftTo !== view.toHour));
  /** Nothing typed, but the two halves are not both holding this window — the
   *  state every member who used the old screen is in, and the one thing a save
   *  is FOR even when the hours on screen are already right. */
  const quietSplit = remoteHalf && quietOn && (view.source === 'device-only' || view.source === 'server-only');

  /**
   * Write the window to both halves and say which of them took it.
   *
   * The device half goes through `useNotifyPrefs`, which sets the latch, the
   * state and then AsyncStorage — it is applied for this session whatever the
   * store does, which is why it is reported as written. The server half is a
   * PostgREST upsert whose success is counted from the rows returned, and the
   * ordinary partial outcome — this phone quiet, everything sent to you not —
   * is most of what the member asked for, missing. `quietSaveNote` is what says
   * so; "Saved" over that is the one thing a settings screen must never say.
   */
  const putQuiet = async () => {
    if (quietBusy || quietEmpty) return;
    const z = zone;
    // No zone, no window on the account. The hours are applied by Postgres
    // against a stored IANA name, and writing UTC on a member's behalf would put
    // a London member's 10pm at 11pm for half the year. The device half would
    // still work, but saving one and not the other silently is exactly the
    // half-state `quietSaveNote` exists to refuse to hide.
    if (quietOn && remoteHalf && !z) {
      Alert.alert('Cannot set quiet hours on this phone',
        'This phone did not report which timezone it is in, and the hours that stop anything sent to you are applied by a server that has no other way to know. Without it they would be applied in the wrong ones, so nothing has been changed.');
      return;
    }
    setQuietBusy(true);
    setQuietNote(null);
    try {
      if (quietOn) { setQuietHours(draftFrom, draftTo); setQuiet(true); } else { setQuiet(false); }
      if (!remoteHalf) {
        setQuietNote({ note: quietOn ? QUIET_PHONE_ONLY_SAVED : QUIET_PHONE_ONLY_OFF, ok: true });
        return;
      }
      const server = await saveQuietHours(
        quietOn && z ? { fromHour: draftFrom, toHour: draftTo, tz: z } : null,
      );
      const said = quietSaveNote({ device: true, server });
      setQuietNote(quietOn
        ? { note: said.note, ok: said.saved }
        : { note: server ? QUIET_OFF_SAVED : QUIET_OFF_HALF, ok: server });
      // Re-read rather than assume. What the boxes show next comes from the
      // row, which is the discipline the coach's screen keeps for the same
      // control.
      await quiet.reload();
    } finally { setQuietBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What reaches you, and when</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Notifications</Text>
          </View>
        </View>

        {/* Said before any switch, because a switch on a build that cannot
            schedule anything is a control with no effect, and the member has
            no other way to find that out. */}
        {!pushAvailable() ? (
          <Section>
            <Notice
              tone={t.warn}
              kicker="Not sending yet"
              title="This build cannot schedule notifications"
              note="Your choices here are kept and will be honoured, but nothing is being sent on this version of the app at all."
            />
          </Section>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="What This App Sends" />
          {switches.map((c, i) => {
            const on = allows(c.key, prefs);
            return (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.note}</Text>
                </View>
                {/* A switch, announced as one, and 48 x 28 with hit slop to
                    clear the 44pt minimum. The pattern from the reminders
                    screen, which had to fix exactly this. */}
                <Pressable onPress={() => setCategory(c.key, !on)}
                  accessibilityRole="switch"
                  accessibilityLabel={c.title}
                  accessibilityState={{ checked: on }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
                  style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
                  <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
                </Pressable>
              </View>
            );
          })}
          {/* Until the store answers, these switches show the defaults rather
              than the member's own answers, and they may differ. Said out loud
              for the fraction of a second it lasts, because a switch showing
              somebody else's answer is exactly the thing this screen is for. */}
          {!loaded ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Reading your choices…</Text>
          ) : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Quiet Hours" />

          {/* Three answers and three sentences. Both stores have to have
              answered before there is one window to draw: this handset's
              preferences say whether reminders are already being held, the
              account row says whether anything sent to the member is. Until
              they have, "None set" would be this screen telling somebody they
              have no quiet hours while it was still finding out — and a failed
              read is not the same as a member who has set none. */}
          {!loaded || !quietRead ? (
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {!loaded || quiet.status === 'loading' ? 'Reading your quiet hours…' : QUIET_READ_FAILED}
            </Text>
          ) : (<>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Quiet Hours</Text>
                {/* What is IN FORCE, from `quietView` — never the boxes below,
                    which are a draft until somebody saves them. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {view.fromHour != null && view.toHour != null
                    ? `Set from ${hourLabel(view.fromHour)} to ${hourLabel(view.toHour)}.`
                    : 'None set, so notifications arrive whenever they are due or sent.'}
                </Text>
              </View>
              <Pressable onPress={() => { setDraftOn(!quietOn); setQuietNote(null); }}
                accessibilityRole="switch"
                accessibilityLabel="Quiet hours"
                accessibilityState={{ checked: quietOn }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
                style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: quietOn ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
                <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: quietOn ? 'flex-end' : 'flex-start' }} />
              </Pressable>
            </View>

            {quietOn ? (
              <View style={{ marginTop: sp.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
                  <Field label="From" hint="24h" style={{ flex: 0 }} a11y="Quiet hours start, on a 24-hour clock">
                    <TextInput
                      value={String(draftFrom)}
                      onChangeText={(x) => { setDraftFrom(Math.min(23, Math.max(0, parseInt(x, 10) || 0))); setQuietNote(null); }}
                      keyboardType="number-pad"
                      accessibilityLabel="Quiet hours start, on a 24-hour clock"
                      style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, width: 54, textAlign: 'center' }} />
                  </Field>
                  <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>to</Text>
                  <Field label="To" hint="24h" style={{ flex: 0 }} a11y="Quiet hours end, on a 24-hour clock">
                    <TextInput
                      value={String(draftTo)}
                      onChangeText={(x) => { setDraftTo(Math.min(23, Math.max(0, parseInt(x, 10) || 0))); setQuietNote(null); }}
                      keyboardType="number-pad"
                      accessibilityLabel="Quiet hours end, on a 24-hour clock"
                      style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, width: 54, textAlign: 'center' }} />
                  </Field>
                  {/* The same 24-hour boxes as the reminders screen, with the
                      same echo beside them. Somebody who wants quiet from nine in
                      the evening types 9 and gets nine in the morning otherwise. */}
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, flex: 1, paddingBottom: 13 }}>
                    {`${hourLabel(draftFrom)} to ${hourLabel(draftTo)}`}
                  </Text>
                </View>

                {quietEmpty ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>Nothing would be held — the two hours are the same, so the window is empty.</Text>
                  </View>
                ) : null}

                {/* `quietNow` is `hourInWindow` called once more — the same
                    arithmetic `notify_quiet_now` and `inQuietHours` each do, so
                    this preview cannot disagree with either of them about an
                    hour. Withheld when the stored zone is not this phone's,
                    because then the hour here is not the hour the server reads.
                    The hour it judged is printed so a screen left open cannot
                    quietly become wrong about it. */}
                {view.fromHour != null && !quietUnsaved && !zoneMovedNote(remoteHalf ? quiet.quiet?.tz : null, zone) ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    {quietNow(now.getHours(), view)
                      ? `It is ${hourLabel(now.getHours())}, which is inside the hours you have set.`
                      : `It is ${hourLabel(now.getHours())}, which is outside the hours you have set.`}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Save writes both halves at once, which is the whole point of the
                control: two windows on one screen would be the worse answer,
                and one window that reached only the handset is what a member
                already had. */}
            <View style={{ marginTop: sp.lg }}>
              <Cta
                label={quietOn ? 'Save Quiet Hours' : 'Turn Quiet Hours Off'}
                a11yLabel={quietOn ? 'Save quiet hours' : 'Turn quiet hours off'}
                wide
                disabled={quietBusy || quietEmpty || !(quietUnsaved || quietSplit)}
                onPress={() => { void putQuiet(); }} />
              {quietUnsaved && !quietEmpty ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{QUIET_UNSAVED}</Text>
              ) : null}
            </View>

            {quietNote ? (
              <Flag tone={quietNote.ok ? t.good : t.warn} style={{ marginTop: sp.md }}>{quietNote.note}</Flag>
            ) : null}

            {/* Said where it is true and nowhere else: a member who set these in
                London and is now in Dubai is silent from 2am local, and nothing
                else on this screen would explain it. */}
            {remoteHalf && zoneMovedNote(quiet.quiet?.tz, zone) ? (
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{zoneMovedNote(quiet.quiet?.tz, zone)}</Flag>
            ) : null}

            {/* What one window does to each half, and what it costs. Both
                sentences and not one, because they are genuinely different
                behaviours and the difference is the whole of what somebody
                would otherwise get wrong. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{QUIET_LOCAL_EFFECT}</Text>
            {remoteHalf ? (<>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{QUIET_REMOTE_EFFECT}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{QUIET_COST}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{QUIET_ZONE_KEPT}</Text>
              {view.note ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{view.note}</Text> : null}
            </>) : avail.note ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{avail.note}</Text>
            ) : null}
          </>)}
        </Section>

        <Rule />

        {/* ── what is sent TO you ──────────────────────────────────────────
            This section was a paragraph explaining why it could not be
            switches. The reasoning is kept in the header of this file and in
            src/lib/notifyPrefs.ts, because it is still the reasoning: these are
            switches only because the answer is stored on the account, where the
            two senders read it, rather than on this handset, which sends none
            of them. */}
        <Section>
          <SectionHead title="Sent To You" />

          {/* Before any switch, for the same reason the build warning is drawn
              before the first list: a switch whose position was never read is
              worse than no switch, and this is the only sentence that says so
              while it is true. */}
          {channelNote ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{channelNote}</Text>
          ) : null}

          {MEMBER_CHANNELS.map((c, i) => {
            const state = channelState(c.key, channels.muted, channels.status);
            return (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                  {/* The unknown label goes in front of the note rather than
                      replacing it: what the switch governs is true whether or
                      not the position has been read, and dropping the note
                      would leave a row that says only that something failed. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {state === 'unknown' ? `${CHANNEL_UNKNOWN_LABEL} — ${c.note}` : c.note}
                  </Text>
                </View>
                <TriSwitch t={t} label={c.title} state={state}
                  onPress={() => { void toggleChannel(c.key, c.title); }} />
              </View>
            );
          })}

          {channelSaid ? (
            <Flag tone={channelSaid.ok ? t.good : t.warn} style={{ marginTop: sp.md }}>{channelSaid.note}</Flag>
          ) : null}

          {/* Four sentences, and each is a different thing a member would
              otherwise get wrong: how far a switch reaches, that muting does
              not lose the message, that these follow them off this phone, and
              the one kind no switch here covers. None of them reports that a
              notification was or was not suppressed, because no row in that
              table has ever existed to suppress one. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{MEMBER_CHANNELS_REACH}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{MEMBER_CHANNELS_STILL_RECORDED}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{MEMBER_CHANNELS_ACCOUNT}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{MEMBER_CHANNELS_NOT_COVERED}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{CHANNEL_MASTER}</Text>
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            The switches under What This App Sends are kept on this phone, and only this phone. If you use the app on a second phone, that one has its own answers — and signing out clears them, so the next person to sign in here starts from the defaults rather than yours. The switches under Sent To You are the other way round: they are stored on your account, so they are the same wherever you sign in. Quiet hours are both — the account holds the window that stops what is sent to you, and this phone holds the one that delays the reminders it sets itself.
          </Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
