// Trainer · Clients — the roster: who needs a check-in, who is on track, and the
// detail sheet behind each client.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional, modal and route from the
// previous version is preserved — only the presentation changed: the serif studio
// name is gone, the three bordered stat boxes and the per-client
// bordered cards became hairline-separated rows, and a card is now spent only on
// the things that need a decision (trial, platform invite, suggested check-ins).
//
// Removed — fabricated data, not a style change:
//   · `hasLog = sel?.id === 'c1'` gated a whole "live training snapshot" inside
//     the client sheet: streak, longest streak, this week's sessions and volume,
//     program adherence, personal records, recent sessions, and a "Latest
//     Check-in" line (weight · energy · sleep · mood · adherence) that was also
//     spliced into the client's timeline. None of it belonged to the client —
//     `useWorkoutLog` and `useCheckIns` read the *signed-in user's* rows,
//     i.e. the coach's own training, rendered under the client's name. `c1` was
//     the id of one of the five invented clients already deleted from
//     `trainerMock`, so the branch was unreachable as well as wrong. Its
//     else-branch — the honest "history appears here once they log workouts" —
//     is now what every client shows, alongside the real coach-assigned program.
//   · a `DEMO` badge hardcoded to the ids `c1`–`c5` — the same five invented
//     clients.
// Both providers are still mounted (they are shared context) but nothing on this
// screen renders one person's data as another's.
import { useEffect, useState } from 'react';
import { num } from '../../src/lib/format';
import {
  DELIVERED_WINDOW_DAYS, MARK_WINDOW_DAYS, awaitingOutcome, deliveredBetween, fetchMySessions, windowStart,
} from '../../src/lib/trainerSessions';
import type { PtSession } from '../../src/lib/gymSessions';
import { useAuth } from '../../src/ui/auth';
import {
  assessDrift, fetchClientActivity, compareDrift, summariseDrift, bandTitle, bandNote,
  DRIFT_LABEL, DEFAULT_WINDOWS, type Drift,
} from '../../src/lib/clientDrift';
import { useTenant } from '../../src/ui/tenant';
import { reportError } from '../../src/lib/reportError';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, Image, KeyboardAvoidingView, Platform, ActivityIndicator, Share, Switch, type ViewStyle, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { trialInfo } from '../../src/lib/trial';
import { deltaLabel, movementIsProgress } from '../../src/lib/deltaLabel';
import { weightDeltaIn, type WeightUnit } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { goalToEnum } from '../../src/lib/rosterMerge';
import { billingAvailable } from '../../src/lib/billing';
import { Icon, type IconName } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Notice, PartialRead, ChipGrid, Field, fig, Flag as KitFlag } from '../../src/ui/kit';
import { NotificationBell } from '../../src/ui/notifications';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { CoachRequests } from '../../src/ui/CoachRequests';
import { atRiskClient } from '../../src/lib/trainerMock';
import { METRIC_DEFS, METRIC_GROUPS } from '../../src/lib/inbodyMetrics';
import { type RosterClient } from '../../src/lib/trainerMock';
import { COACHED_MODES, COACHED_MODE_SHORT, COACHED_MODE_NOTE_COACH, type CoachedMode } from '../../src/lib/types';
import { areaLabel } from '../../src/lib/injuries';
import { supabase } from '../../src/lib/supabase';
import { askCoach } from '../../src/lib/coach';
import { useRoster } from '../../src/ui/roster';
import { isWhole } from '../../src/ui/loadStatus';
import { useCoachFeedback } from '../../src/ui/feedback';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { slotsFor, searchMeals, mealAt, type Slot } from '../../src/lib/meals';
import { useCoachNotes } from '../../src/ui/coachNotes';
import { useAnnouncements } from '../../src/ui/announcements';
import { deliverySummary, pushConsequence } from '../../src/lib/notifyCopy';
import { inboxAge } from '../../src/lib/notifyInbox';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useCheckIns } from '../../src/ui/checkins';
import { useInvites } from '../../src/ui/invites';
import {
  fetchMyJoinCode, rotateJoinCode, fetchMyJoinCodes, createJoinCode, revokeJoinCode, fetchMyCodeReturns,
  saveCodeSpend, type JoinCodesRead, type CodeReturnsRead,
} from '../../src/ui/joinCode';
import {
  codeCountLine, labelProblem, canCreateCode, DEFAULT_CODE_NOTE, MAX_LABEL, MAX_LIVE_CODES,
  type JoinCodeRow,
} from '../../src/lib/joinCodes';
import {
  LAST_TOUCH_NOTE, codeFigures, enoughToTell, parseSpend, returnLine, spendFieldValue, stayedLine,
  type CodeReturnRow,
} from '../../src/lib/codeReturn';
import { useTrainerInvites } from '../../src/ui/trainerInvites';
import { useClientTags } from '../../src/ui/clientTags';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { fetchPhotosSharedWithMe, missingSharedFiles, SHARED_URL_TTL_S, type SharedPhoto } from '../../src/lib/photoShare';
import { inviteMessage, joinLink } from '../../src/lib/joinCode';
import * as Clipboard from 'expo-clipboard';

/* ── local presentation ───────────────────────────────────────────────────── */

/** The scrim behind every sheet on this screen. */
const SCRIM: ViewStyle = { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' };

/** A bottom sheet's surface. Sheets sit at e2. */
const sheet = (t: Theme, extra?: ViewStyle): ViewStyle => ({
  backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
  padding: 20, paddingBottom: 30, ...elevation.e2, ...extra,
});

/** A text field. One shape, used by every input in every sheet here. */
const field = (t: Theme, tall?: number): TextStyle => ({
  ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
  paddingHorizontal: sp.md, paddingVertical: 11,
  ...(tall ? { minHeight: tall, textAlignVertical: 'top' as const } : null),
});

/** A quiet uppercase label inside a sheet (the kit's SectionHead is for screens). */
function SheetHead({ t, title }: { t: Theme; title: string }) {
  return <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{title}</Text>;
}

/**
 * One figure in the per-code money row: a caption and a value.
 *
 * A component rather than four inline Texts because the value arrives already
 * formatted — codeFigures() puts every one of them through money() or num(),
 * and renders a dash for anything the read did not establish. Passing it as a
 * prop keeps the formatting in one place instead of four.
 */
function CodeFig({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.label, ...numeric, color: t.ink, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

/** One selectable option. Every picker on this screen is built from these. */
function Chip({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    // Selected is a fill colour and nothing else. The other Chip helpers in the
    // coach app (calendar.tsx, client.tsx) already say so; this one did not.
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{
      flex: 1, alignItems: 'center', paddingVertical: 10,
      borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2,
    }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The mark beside a drift verdict.
 *
 * UNKNOWN gets its own colour rather than a dimmed version of either end. It is
 * not a mild at-risk and it is not a quiet on-track; it is a different kind of
 * thing, and a coach scanning the list has to be able to see that without
 * reading the word.
 */
function driftTone(t: Theme, d: Drift): string {
  switch (d.status) {
    case 'at_risk': return t.crit;
    case 'idle': return t.s5;
    case 'watch': return t.warn;
    default: return t.brand;
  }
}

/** A client's initials — the roster's only ornament. */
function Initials({ t, name, size = 38 }: { t: Theme; name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{name.split(' ').map((x) => x[0]).join('')}</Text>
    </View>
  );
}

/** Status reads as a coloured mark beside ink-coloured text, never as text colour. */
function Flag({ t, tone, text }: { t: Theme; tone: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: tone }} />
      <Text style={{ ...ty.caption, color: t.ink2 }}>{text}</Text>
    </View>
  );
}

/** A 3px meter — the same mark the kit's <Meter/> draws, without its read-out. */
function Bar({ t, pct, good }: { t: Theme; pct: number; good: boolean }) {
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden' }}>
      <View style={{ height: 3, borderRadius: 2, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: t.brand, opacity: good ? 1 : 0.5 }} />
    </View>
  );
}

const SHORTCUTS: [IconName, string, string][] = [
  ['bell', 'Broadcast', '/(trainer)/broadcast'],
  ['train', 'Programs', '/(trainer)/builder'],
  ['calendar', 'Schedule', '/(trainer)/calendar'],
  ['video', 'Videos', '/(trainer)/videos'],
  ['chart', 'Analytics', '/(trainer)/analytics'],
  ['trophy', 'Leaderboard', '/(trainer)/leaderboard'],
  ['message', 'Feedback', '/(trainer)/feedback'],
  // The coach's own tracking, last and together because these three are the
  // only things here that are not about a client. My Training was reachable
  // only from a row inside Profile, which is buried — and a coach who cannot
  // find where to log their own session logs it nowhere, or worse, into
  // somebody else's record. Nutrition and Progress sit beside it rather than
  // anywhere else for exactly that reason: the same coach, on the same day,
  // looking for the same thing.
  ['dumbbell', 'My Training', '/(trainer)/my-training'],
  ['meals', 'My Nutrition', '/(trainer)/my-nutrition'],
  ['progress', 'My Progress', '/(trainer)/my-progress'],
];

/**
 * Sessions that have happened but nobody has said what happened.
 *
 * Renders NOTHING when the queue is empty — a dashboard that permanently
 * carries an "all clear" card teaches people to stop reading it. It appears
 * only when there is something to do, which is also exactly when payroll is
 * blocked, because payrollTotal() refuses to guess while any session is
 * unmarked.
 *
 * The count starts at null, not 0. Silence on this dashboard means "nothing is
 * outstanding", so a read that was refused or never arrived must not be allowed
 * to produce that silence — a coach who sees no card concludes payroll is clear
 * and settles it, when the app simply never found out. Zero hides the card;
 * unknown says so.
 *
 * ── and why it no longer reads anything itself ─────────────────────────────
 *
 * It used to open its own effect with `if (!tenant?.id) return;`. A coach with
 * no gym has no tenant, so the effect returned immediately, `n` stayed null,
 * and null hides the card — which on this dashboard is the sentence "nothing is
 * outstanding". An independent trainer was told, silently and by omission, that
 * every session he had ever delivered was accounted for. There was no error to
 * see and nothing on screen to disbelieve.
 *
 * The count is now read by `trainer_id` (src/lib/trainerSessions.ts) in the
 * screen below, alongside the delivered figure, because both come from the same
 * rows and one read is enough. The card takes what that read found.
 */
function UnmarkedSessions({ n, failed, hasGym }: { n: number | null; failed: boolean; hasGym: boolean }) {
  const t = useTheme();
  const router = useRouter();

  if (failed) {
    return (
      <Card onPress={() => router.push('/(trainer)/sessions')} tone={t.crit} style={{ marginBottom: sp.md }}>
        <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>
          Could not check for unmarked sessions
        </Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
          This is not the same as none outstanding. Open Mark sessions to try again{hasGym ? ' before payroll' : ''}.
        </Text>
      </Card>
    );
  }
  if (n === null || n === 0) return null;
  return (
    <Card onPress={() => router.push('/(trainer)/sessions')} tone={t.s3} style={{ marginBottom: sp.md }}>
      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>
        {n} session{n === 1 ? '' : 's'} need an outcome
      </Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
        {hasGym ? 'Payroll cannot be worked out' : 'Your delivered count is incomplete'} until {n === 1 ? 'it is' : 'they are'} marked. One tap each.
      </Text>
    </Card>
  );
}

export default function TrainerClients() {
  const t = useTheme();
  const router = useRouter();
  const [trial, setTrial] = useState<{ daysLeft: number; expired: boolean } | null>(null);
  useEffect(() => { trialInfo().then((ti) => setTrial({ daysLeft: ti.daysLeft, expired: ti.expired })); }, []);
  // `status` was computed by the roster provider and read by nobody, so a
  // refused read reached this screen as an empty list and was announced as
  // "No clients yet" — to a coach who has clients.
  const { roster, status: rosterStatus, addClient, removeClient, setClientMode } = useRoster();
  // The COACH's unit, not the client's: this roster is read by the coach, and
  // `weightDelta` is stored in kilograms. Both places it appeared printed a bare
  // "kg" whatever the coach reads in. `weightDeltaIn` converts the SPAN once —
  // subtracting two separately rounded pound readings is the bug that helper
  // exists to prevent. See app/(trainer)/client-training.tsx, which already
  // draws the same distinction.
  const coachUnit: WeightUnit = useSettings().weightUnit;
  const rosterUnread = rosterStatus === 'error';
  const { tenant } = useTenant();
  // The signed-in coach. Their own sessions are keyed on this, not on a gym —
  // which is the whole reason an independent trainer saw nothing here.
  const { user: authUser, loading: authLoading } = useAuth();
  const coachId = authUser?.id ?? null;

  // ── who is drifting ───────────────────────────────────────────────────────
  //
  // The book used to arrive in whatever order the roster query returned, which
  // is roughly alphabetical. With twenty-five clients that hides the three who
  // need a call this week. This reads each client's own record and orders on
  // the break in their own pattern — see src/lib/clientDrift.ts for what
  // "drifting" means and why absence of data is its own answer.
  //
  // THREE renders, never two:
  //   drift === null && !driftErr → not read yet. Claim nothing.
  //   drift !== null              → read. An empty map is a real answer.
  //   driftErr !== null           → the read failed. Say so, and say the list
  //                                 is in its ordinary order — never let a
  //                                 failed read look like "nobody is drifting".
  const [drift, setDrift] = useState<Record<string, Drift> | null>(null);
  const [driftErr, setDriftErr] = useState<string | null>(null);
  const rosterKey = roster.map((c) => c.id).join(',');
  useEffect(() => {
    const ids = rosterKey ? rosterKey.split(',') : [];
    let live = true;
    setDriftErr(null);
    if (!ids.length) { setDrift({}); return; }
    setDrift(null);
    (async () => {
      try {
        const events = await fetchClientActivity(supabase, ids, {
          days: DEFAULT_WINDOWS.historyDays,
          tenantId: tenant?.id ?? null,
        });
        if (!live) return;
        const map: Record<string, Drift> = {};
        // `since` is the client's join date, and passing it changes two things.
        // A client added yesterday and a client silent for eight weeks both
        // have no recent activity, so without it they were indistinguishable —
        // both UNKNOWN, both told "nothing recorded in the last 56 days", which
        // is a strange thing to say about somebody who joined on Tuesday. It
        // also clamps the drift baseline to the period they were actually on
        // the book, so a real fall is not diluted by weeks they did not exist
        // for. It comes from coach_clients.created_at or the coaching
        // relationship; null where genuinely unknown, never guessed.
        const joinedOf: Record<string, string | null> = {};
        for (const c of roster) joinedOf[c.id] = c.joinedAt ?? null;
        for (const id of ids) {
          map[id] = assessDrift({ clientId: id, events: events[id] ?? [], since: joinedOf[id] ?? null });
        }
        setDrift(map);
      } catch (e: any) {
        if (!live) return;
        reportError('dashboard.clientDrift', e);
        setDrift(null);
        setDriftErr(e?.message || 'Could not read the training record.');
      }
    })();
    return () => { live = false; };
  }, [rosterKey, tenant?.id]);
  const driftFor = (c: RosterClient): Drift | null => (drift ? drift[c.id] ?? null : null);
  const bands = summariseDrift(drift ? roster.map((c) => drift[c.id]).filter((d): d is Drift => !!d) : null);

  const { name: coachName } = useMyTrainerProfile();
  const { getFeedback, addFeedback } = useCoachFeedback();
  const { get: getNutri, setAdjust: setNutri, clear: clearNutri, status: nutriStatus } = useCoachNutrition();
  const [mealPick, setMealPick] = useState<{ pos: number; slot: Slot } | null>(null);
  const [mealQuery, setMealQuery] = useState('');
  const { getNotes, addNote, removeNote, status: notesStatus } = useCoachNotes();
  // Saving a private note is now a round trip (see src/ui/coachNotes.tsx: it
  // used to be a `useState` that lost every note on relaunch), so the Save
  // button has to be able to say "in flight" and "that did not save".
  const [noteBusy, setNoteBusy] = useState(false);
  // `mine` and `status` as well as the write: a coach who has posted notices
  // could not see one of them anywhere in this app, so "did that go out?" was
  // answered by posting it again. The sheet below lists them.
  const { addAnnouncement, mine: myNotices, status: noticeStatus } = useAnnouncements();
  const { sent: sentInvites, sendInvite, revokeInvite } = useInvites();
  const { received: trainerInvites, acceptTrainerInvite, declineTrainerInvite } = useTrainerInvites();
  const { tagsFor, allTags, addTag, removeTag } = useClientTags();
  const { templates } = useProgramTemplates();
  const { assignProgram, getProgram } = useAssignedPrograms();
  const [bulkTplOpen, setBulkTplOpen] = useState(false);
  const [seg, setSeg] = useState<string>('all');
  const [tagDraft, setTagDraft] = useState('');
  const acceptJoin = async (id: string, ownerName: string | null) => {
    await acceptTrainerInvite(id);
    Alert.alert('Welcome to the platform', 'You have joined ' + (ownerName || 'the platform') + ' as a trainer. Let us set up your profile.', [{ text: 'Set up profile', onPress: () => router.push('/(trainer)/profile') }, { text: 'Later' }]);
  };
  const [pnote, setPnote] = useState('');
  const [bcOpen, setBcOpen] = useState(false);
  const [bcText, setBcText] = useState('');
  // Off by default, and it is a separate decision from posting. A notice always
  // reaches the client's notifications and their Notices screen; the push is
  // the part that rings a phone, at whatever hour it is where they are, and the
  // person who wrote the words is the only one who can judge whether this one
  // is worth that.
  const [bcPush, setBcPush] = useState(false);
  const [bcBusy, setBcBusy] = useState(false);
  const [fb, setFb] = useState('');
  const [nnote, setNnote] = useState('');
  const [sel, setSel] = useState<RosterClient | null>(null);
  // The meal picker is a slot on ONE client, so it cannot outlive the sheet
  // that named them. Closing the client sheet while it is open leaves
  // `mealPick` set, and the next client opened would have the picker spring up
  // unasked — on their breakfast, ready to write a meal to somebody the coach
  // had not chosen it for.
  useEffect(() => { if (!sel) setMealPick(null); }, [sel]);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('Fat loss');
  const [newMode, setNewMode] = useState<CoachedMode>('online');
  const [invOpen, setInvOpen] = useState(false);
  // Copying the bare link, for the places an online coach actually earns
  // clients: an Instagram bio, a TikTok link-in-bio, a YouTube description.
  // Those fields take a URL and nothing else, so `inviteMessage` — a whole
  // sentence, and right for WhatsApp — is unusable in them. Reported, because
  // a coach who is told it copied and then pastes nothing has lost the post.
  const copyJoinLink = async (code: string, label: string) => {
    try {
      await Clipboard.setStringAsync(joinLink(code));
    } catch {
      Alert.alert('Not copied', `The link for ${label} could not be copied. It is ${joinLink(code)} — write it down, or use Share instead.`, [{ text: 'OK' }]);
      return;
    }
    // The destination sentence is not a nicety. If a coach points a paid ad at
    // their profile instead of at this link, the click is untracked and the
    // money that produced it can never be tied to the clients it produced — and
    // no amount of work afterwards recovers it, because the join simply arrives
    // with no code on it. Saying so at the moment they copy is the only point
    // where it is still free to get right.
    Alert.alert(
      'Link copied',
      `Paste it into your bio, a caption or a description. Anybody who joins through it is attributed to ${label}, so you can see which post brought them.\n\n` +
        'Running an ad? Use this as the ad’s destination — not your profile. It is what lets what you spent be matched to the clients it actually brought.',
      [{ text: 'Done' }],
    );
  };

  // The coach's own join code. Read when the sheet opens rather than on every
  // dashboard mount: it is only ever looked at here, and allocating one is a
  // write.
  const [myCode, setMyCode] = useState<string | null>(null);
  const [myCodeErr, setMyCodeErr] = useState<string | null>(null);
  // Every code this coach holds, and the status of the read that produced them.
  // The rows alone cannot tell "nobody has used it" from "we could not check",
  // and those are the two answers a coach acts on in opposite directions — see
  // src/ui/loadStatus.ts. codeCountLine below refuses to state a figure under
  // anything but a completed read.
  const [codes, setCodes] = useState<JoinCodesRead>({ status: 'loading', rows: [] });
  const [newCodeLabel, setNewCodeLabel] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  // Re-read rather than patching a row in place after a write: the list is the
  // only thing that says which codes are live, and a local edit would show a
  // code as off whether or not the server agreed.
  // What each code cost and returned. A separate read from the list above: it
  // walks purchases and relationships, and the codes list is opened far more
  // often than the money is looked at. Its own status, because a failure here
  // must not make the codes themselves look unreadable, and — the point —
  // because an empty answer under a failure is not a channel that earned
  // nothing. See src/lib/codeReturn.ts.
  const [returns, setReturns] = useState<CodeReturnsRead>({ status: 'loading', rows: [] });
  // What the coach is typing into each code's spend field, keyed by code id
  // ('' is the default code, which has no id). Held apart from the rows so a
  // half-typed number is never mistaken for a recorded one.
  const [spendDraft, setSpendDraft] = useState<Record<string, string>>({});
  const [spendBusy, setSpendBusy] = useState<string | null>(null);
  const loadCodes = async () => {
    setCodes((c) => ({ ...c, status: 'loading' }));
    setReturns((r) => ({ ...r, status: 'loading' }));
    setCodes(await fetchMyJoinCodes());
    const r = await fetchMyCodeReturns();
    setReturns(r);
    // Reseed the fields from the server's answer, so a draft left over from a
    // failed save cannot sit on screen looking like the recorded figure.
    setSpendDraft(Object.fromEntries(r.rows.map((x) => [x.id ?? '', spendFieldValue(x)])));
  };
  // The verdict on ranking, computed once for the sheet. enoughToTell refuses
  // outright under anything but a completed read, and refuses again when the
  // two busiest codes cannot be told apart from a coin toss.
  const codeTell = enoughToTell(returns.status, returns.rows);
  const saveSpend = async (row: CodeReturnRow) => {
    const key = row.id ?? '';
    const parsed = parseSpend(spendDraft[key]);
    if (parsed.kind === 'bad') { Alert.alert('Not saved', parsed.reason); return; }
    setSpendBusy(key);
    // A cleared field sends null, which DELETES the record. Sending 0 would
    // tell Repple the campaign was free, and a free campaign has a perfect
    // return and wins every comparison on this screen.
    const r = await saveCodeSpend(row.id, parsed.kind === 'clear' ? null : parsed.cents);
    setSpendBusy(null);
    if (!r.ok) { Alert.alert('Not saved', r.reason); return; }
    await loadCodes();
  };
  const namedCodes = codes.rows.filter((r) => !r.isDefault);
  // The main code's row, or a zeroed stand-in when the read produced none —
  // which happens only when the code was allocated after the list was read,
  // i.e. a code so new nobody can have used it. The stand-in states nothing on
  // its own: codeCountLine gates every figure on the status above.
  const defaultCodeRow: JoinCodeRow = codes.rows.find((r) => r.isDefault) ?? {
    id: null, code: myCode ?? '', label: 'Your main code',
    isDefault: true, isLive: true, createdAt: null, joined: 0, pending: 0,
  };
  const [invEmail, setInvEmail] = useState('');
  const [invMode, setInvMode] = useState<CoachedMode>('online');
  const [newEmail, setNewEmail] = useState('');
  // null means "we have not been able to read this client's food log", which is
  // a different sentence from "they have logged nothing". The distinction is
  // load-bearing twice over: the Recent meals section is hidden when the array
  // is empty, and genSummary() below hands the same value to the AI, which will
  // happily write "you are not logging your meals" into a coaching summary the
  // coach sends on. See the read below.
  const [clientMeals, setClientMeals] = useState<{ name: string; kcal: number; via: string }[] | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [draftClient, setDraftClient] = useState<RosterClient | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAiSummary('');
    if (!sel) { setClientMeals(null); return; }
    setClientMeals(null);
    (async () => {
      try {
        // `error` was not destructured here. supabase-js resolves rather than
        // throwing, so an RLS refusal or a dropped connection arrived as
        // data === null, `data || []` turned that into an empty list, and the
        // coach was shown a client who had logged no meals at all — then told
        // the AI the same thing.
        const { data, error } = await supabase.from('food_logs').select('name, kcal, via').eq('client_id', sel.id).order('logged_at', { ascending: false }).limit(6);
        if (cancelled) return;
        if (error || !data) { setClientMeals(null); return; }
        setClientMeals(data.map((r: any) => ({ name: r.name, kcal: r.kcal, via: r.via })));
      } catch { if (!cancelled) setClientMeals(null); }
    })();
    return () => { cancelled = true; };
  }, [sel]);
  // ── progress photos this client SENT ────────────────────────────────────
  // A coach sees a progress photo for exactly one reason: the client sent that
  // photo. There is no roster-wide read and no "linked trainer" policy behind
  // this — supabase/parts/47-share-progress-photo.sql grants the row and the
  // file per photo, per coach, and only while the coaching link is live.
  //
  // `null` here is "not read yet, or the read failed", never "they have sent
  // nothing". Those are different facts about another person's body and the
  // sheet renders them differently.
  const [shared, setShared] = useState<SharedPhoto[] | null>(null);
  const [sharedErr, setSharedErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setShared(null);
    setSharedErr(null);
    if (!sel) return;
    // A coach-created client (coach_clients) has no account and therefore no
    // photos; its id is not a uuid, so asking would be a guaranteed error.
    if (!sel.id.includes('-')) { setShared([]); return; }
    const forClient = sel.id;
    (async () => {
      try {
        const list = await fetchPhotosSharedWithMe(forClient);
        if (!cancelled) { setShared(list); setSharedErr(null); }
      } catch (e) {
        reportError('trainer.sharedPhotos', e);
        if (!cancelled) { setShared(null); setSharedErr('Could not load what they have sent you.'); }
      }
    })();
    return () => { cancelled = true; };
  }, [sel]);
  const active = roster.length;
  // How many clients there are, as opposed to how many came back.
  //
  // `active` is the length of whatever loaded, and it leads this screen as the
  // hero figure. Under a refused read that is a large, confident "0" beside the
  // words "Active Clients" — telling a coach with a full book that they have
  // none, which is the most expensive sentence this app can say. Under a
  // TRUNCATED read it is worse, because a plausible smaller number gives the
  // coach nothing to doubt: analytics.tsx refuses 'partial' alongside 'error'
  // for exactly this reason, and this screen is the one people actually open.
  //
  // Null unless the roster read was whole; `fig()` renders that as a dash, and
  // the note below says which of the two it is. The rows themselves are still
  // listed either way — the PEOPLE who loaded are real, it is only the COUNT of
  // them that may not be quoted.
  const rosterCount = isWhole(rosterStatus) ? active : null;

  // ── the coach's own sessions, read once for the two figures that need them ─
  //
  // By `trainer_id`, not by `tenant_id`: see src/lib/trainerSessions.ts. Both
  // the unmarked-sessions card above and the delivered figure below come out of
  // this one read, because they are the same rows asked two questions.
  //
  // Three states, and the third is the one that matters. `null` under
  // `sessionsUnread` means the read failed and NOTHING is known — not zero.
  // Zero would hide the card and print a confident "0" in a KPI row, which are
  // both claims this screen would have no basis for.
  const [mySessions, setMySessions] = useState<PtSession[] | null>(null);
  const [sessionsUnread, setSessionsUnread] = useState(false);
  useEffect(() => {
    if (authLoading) return;
    let live = true;
    if (!coachId) { setMySessions(null); setSessionsUnread(true); return; }
    (async () => {
      try {
        const rows = await fetchMySessions(supabase, coachId, windowStart(MARK_WINDOW_DAYS), new Date().toISOString());
        if (live) { setMySessions(rows); setSessionsUnread(false); }
      } catch (e) {
        reportError('dashboard.mySessions', e);
        if (live) { setMySessions(null); setSessionsUnread(true); }
      }
    })();
    return () => { live = false; };
  }, [coachId, authLoading]);

  const unmarked = mySessions === null ? null : awaitingOutcome(mySessions).length;
  /** Sessions actually delivered in the last month — a count of recorded
   *  outcomes, not an inference from the clock. Null until the read lands. */
  const delivered = mySessions === null
    ? null
    : deliveredBetween(mySessions, Date.now() - DELIVERED_WINDOW_DAYS * 86_400_000);
  // One unknown count makes the TOTAL unknown. Summing the nulls as zero would
  // quietly report fewer waiting messages than there are, on the tile a coach
  // reads to decide whether anybody needs them.
  const unread = roster.some((c) => c.unread == null)
    ? null
    : roster.reduce((a, c) => a + (c.unread ?? 0), 0);
  // The legacy signal, kept only for the render where the drift read has not
  // landed. It cannot see the client this whole feature is about: with
  // `adherence: null` and `lastActive: 'no activity yet'` both of its clauses
  // are false, so a client nobody has heard from reads as not at risk.
  const atRisk = roster.filter(atRiskClient).length;
  /** Drifting plus unknown — the number a coach actually has to act on. Null
   *  until the read lands, so it renders as an em-dash rather than as zero. */
  const toContact = bands ? bands.drifting + bands.unknown : null;
  const driftNote = (): string => {
    if (driftErr) return 'Could not work out who is drifting.';
    if (!bands) return 'Working out who is drifting…';
    const parts: string[] = [];
    if (bands.drifting) parts.push(`${bands.drifting} drifting`);
    if (bands.unknown) parts.push(`${bands.unknown} with nothing recorded`);
    if (!parts.length && bands.watch) parts.push(`${bands.watch} slipping`);
    return parts.length ? parts.join(' · ') : 'Everyone is holding their own pattern.';
  };
  const AUTO_SEGS = [
    { key: 'all', label: 'All', n: roster.length },
    // The drift segments replace the old At-risk chip rather than sitting
    // beside it: two rules for "who needs attention" on one screen is how the
    // product ended up with two status scales in the first place. Before the
    // read lands there is no honest count, so the old chip stands in.
    ...(bands
      ? [{ key: 'drifting', label: 'Drifting', n: bands.drifting },
         { key: 'nodata', label: 'Nothing Recorded', n: bands.unknown }]
      : [{ key: 'atrisk', label: 'At-risk', n: atRisk }]),
    // One segment per delivery, built from the vocabulary rather than listed by
    // hand — a book with no hybrid clients simply shows a zero, the same as the
    // other two, instead of quietly filing them under Online.
    ...COACHED_MODES.map((m) => ({ key: m, label: COACHED_MODE_SHORT[m], n: roster.filter((c) => c.mode === m).length })),
  ];
  const matchSeg = (c: RosterClient) =>
    seg === 'all' ? true
    : seg === 'drifting' ? driftFor(c)?.status === 'at_risk'
    : seg === 'nodata' ? driftFor(c)?.status === 'idle'
    : seg === 'atrisk' ? atRiskClient(c)
    : (COACHED_MODES as readonly string[]).includes(seg) ? c.mode === seg
    : tagsFor(c.id).includes(seg);
  // A drift segment cannot be honoured once the read is gone; fall back to the
  // whole book rather than showing an empty list that reads as "none of these".
  const segLive = !(!bands && (seg === 'drifting' || seg === 'nodata'));
  const shownRoster = segLive ? roster.filter(matchSeg) : roster;
  // The book, in drift order once it can be. Until then it keeps the order it
  // came in — with a line above it saying that is what this is.
  const driftRows: { c: RosterClient; d: Drift | null }[] = (() => {
    const pairs = shownRoster.map((c) => ({ c, d: driftFor(c) }));
    if (!drift) return pairs;
    const assessed = pairs.filter((p) => p.d).sort((a, b) => compareDrift(a.d!, b.d!));
    // Only reachable for the render between a roster change and the next read.
    // They carry their own "not read yet" line rather than passing as fine.
    return [...assessed, ...pairs.filter((p) => !p.d)];
  })();
  // Awaits the insert and reports what actually happened. This used to be
  // fire-and-forget with both handlers empty, and the alert fired synchronously
  // regardless — so a client added by hand (a coach_clients row with no user
  // account behind it) got "Nudge sent" while the insert failed on the foreign
  // key and no push had anywhere to go.
  const deliverMessage = async (client: RosterClient, body: string, pushTitle: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { error } = await supabase.from('messages').insert({ client_id: client.id, sender: 'coach', body });
      if (error) return { ok: false, error: error.message };
    } catch (e: any) { return { ok: false, error: e?.message || 'Could not reach the server.' }; }
    try { supabase.functions.invoke('send-push', { body: { user_ids: [client.id], title: pushTitle, body, data: { route: '/(client)/messages' } } }).then(() => {}, () => {}); } catch { /* the message is saved; the push is a bonus */ }
    return { ok: true };
  };
  const sendNudge = async (client: RosterClient) => {
    const body = 'Hey ' + client.name.split(' ')[0] + ' — checking in! How is your week going? Let me know if you need anything.';
    const r = await deliverMessage(client, body, 'A nudge from your coach');
    Alert.alert(r.ok ? 'Nudge sent' : 'Not sent',
      r.ok ? 'Saved to your thread with ' + client.name.split(' ')[0] + '. They will see it next time they open Repple.'
           : 'Could not send to ' + client.name.split(' ')[0] + ': ' + (r.error || 'unknown error') + '. Clients you added by hand cannot receive messages until they join.');
  };
  // Who needs proactive attention, and why — drives the suggested check-ins.
  const attnReason = (c: RosterClient): string | null => {
    const d = driftFor(c);
    // Drift speaks first where it can, because it is the only signal that sees
    // a client with no record at all.
    if (d && (d.status === 'at_risk' || d.status === 'idle')) return d.reason;
    if (!d && atRiskClient(c)) return (c.adherence != null && c.adherence < 80) ? 'Adherence ' + c.adherence + '% — below target' : 'Inactive ' + c.lastActive + ' — check in';
    if (c.unread != null && c.unread > 0) return c.unread + ' unread message' + (c.unread > 1 ? 's' : '');
    return null;
  };
  const needsAttention = roster.filter((c) => attnReason(c)).sort((a, b) => {
    const da = driftFor(a), db = driftFor(b);
    if (da && db) return compareDrift(da, db);
    // Before the read lands, order on the only figure the row carries — and a
    // client who has never submitted a check-in is not a perfect score. This
    // used to be `?? 999`, which sorted exactly those clients to the bottom.
    return (a.adherence ?? -1) - (b.adherence ?? -1);
  });
  // AI-draft a personalised check-in the coach reviews before sending.
  const draftNudge = async (client: RosterClient) => {
    setDraftClient(client); setDraftText(''); setDraftBusy(true);
    const reason = attnReason(client) || 'general check-in';
    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence != null ? client.adherence + '%' : 'no check-ins yet', reason };
    const reply = await askCoach([{ role: 'user', content: 'Draft a short, warm, personalised check-in message (2-3 sentences) I can send to this client as their coach. Reason for reaching out: ' + reason + '. Encourage them, reference their goal, and invite a reply. Write only the message, no preamble.' }], ctx);
    setDraftBusy(false);
    setDraftText(reply || ('Hey ' + client.name.split(' ')[0] + ' — checking in on how your week is going. You are working toward ' + client.goal.toLowerCase() + ', and I am here to help. What can I do to make this week easier?'));
  };
  const sendDraft = async () => {
    const client = draftClient; const body = draftText.trim();
    if (!client || !body) return;
    const r = await deliverMessage(client, body, 'A note from your coach');
    if (!r.ok) { Alert.alert('Not sent', 'Could not send to ' + client.name.split(' ')[0] + ': ' + (r.error || 'unknown error') + '. Your draft is still here.'); return; }
    setDraftClient(null); setDraftText('');
    Alert.alert('Sent', 'Saved to your thread with ' + client.name.split(' ')[0] + '.');
  };
  const bulkMessage = () => {
    const list = shownRoster;
    if (!list.length) return;
    Alert.alert('Message ' + list.length + ' clients?', 'Send a check-in nudge to everyone in this segment.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => { (async () => {
      const results = await Promise.all(list.map((c) => deliverMessage(c, 'Hey ' + c.name.split(' ')[0] + ' — checking in! How is your week going? Let me know if you need anything.', 'A nudge from your coach')));
      const sent = results.filter((r) => r.ok).length;
      const failed = results.length - sent;
      Alert.alert(failed ? 'Partly sent' : 'Sent', failed ? sent + ' of ' + results.length + ' went through. ' + failed + ' could not be delivered — clients added by hand cannot receive messages until they join.' : 'Sent to all ' + sent + '.');
    })(); } }]);
  };
  const bulkAssign = async (tpl: any) => {
    const list = shownRoster;
    const results = await Promise.all(list.map((c) => assignProgram(c.id, tpl.program)));
    const okCount = results.filter(Boolean).length;
    setBulkTplOpen(false);
    Alert.alert(okCount === list.length ? 'Assigned' : 'Partly assigned',
      okCount === list.length
        ? '"' + tpl.name + '" assigned to ' + list.length + ' client' + (list.length > 1 ? 's' : '') + ' in this segment.'
        : okCount + ' of ' + list.length + ' saved. The rest are on this device only — clients you added by hand have no Train tab until they join.');
  };
  const genSummary = async (client: RosterClient) => {
    setAiBusy(true); setAiSummary('');
    const m = client.metrics;
    const compStr = m ? [m.visceralFat != null ? 'visceral fat ' + m.visceralFat : '', m.inbodyScore != null ? 'InBody score ' + m.inbodyScore : '', m.leanMassKg != null ? 'lean mass ' + m.leanMassKg + 'kg' : '', m.fatMassKg != null ? 'fat mass ' + m.fatMassKg + 'kg' : '', (m.leanArmLKg != null && m.leanArmRKg != null && Math.abs(m.leanArmLKg - m.leanArmRKg) / Math.max(m.leanArmLKg, m.leanArmRKg) >= 0.1) ? 'arm imbalance' : '', (m.leanLegLKg != null && m.leanLegRKg != null && Math.abs(m.leanLegLKg - m.leanLegRKg) / Math.max(m.leanLegLKg, m.leanLegRKg) >= 0.1) ? 'leg imbalance' : ''].filter(Boolean).join(', ') : '';
    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence != null ? client.adherence + '%' : 'no check-ins yet', recentMeals: clientMeals === null ? 'their food log could not be read — do not comment on their food logging' : (clientMeals.map((mm) => mm.name).join(', ') || 'no meals logged yet'), composition: compStr || 'no InBody scan yet' };
    const reply = await askCoach([{ role: 'user', content: 'Write a concise 3-4 sentence weekly coaching summary for this client: what is going well, one concern to watch, and one focus for next week. Use their adherence, recent meals and InBody composition where available.' }], ctx);
    setAiBusy(false);
    setAiSummary(reply || 'Could not generate a summary right now — the AI backend may be unavailable.');
  };

  // Both of these read the *signed-in user's* own rows. They stay mounted (the
  // providers are shared app-wide) but nothing on this screen may render them as
  // a client's training data — see the note at the top of this file.
  useWorkoutLog();
  useCheckIns();
  const selProgram = sel ? getProgram(sel.id) : null;
  const timeline = sel ? [
    ...getNotes(sel.id).map((n) => ({ id: 'n' + n.id, at: n.at, body: n.body, kind: 'Note' as const })),
    ...getFeedback(sel.id).map((fb) => ({ id: 'f' + fb.id, at: fb.at, body: fb.body, kind: 'Feedback' as const })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];

  const studio = (coachName || 'Your Studio').replace('Coach ', '');
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Coaching</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5, textTransform: 'capitalize' }} numberOfLines={1}>{studio}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
            <Ghost icon="search" onPress={() => router.push('/(trainer)/explore')} />
            {/* A client booking a slot and a client cancelling one are the two
                events that change what a coach's day looks like, and until the
                inbox shipped they existed only as a push — on a build that
                cannot receive one. The row on Me is the way in for somebody
                looking for it; this is the way in for somebody glancing. */}
            <NotificationBell group="trainer" />
          </View>
        </View>

        {/* Clients who found this coach in the public directory and asked to
            be coached. Renders nothing at all when there are none. */}
        <CoachRequests />
        <UnmarkedSessions n={unmarked} failed={sessionsUnread} hasGym={!!tenant?.id} />

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {/* ── the trial card, and the condition that was exactly backwards ──
              This read `trial && !billingAvailable()`.

              `billingAvailable()` (src/lib/billing.ts) is true when at least
              one plan has a Stripe price id — i.e. when subscribing is
              actually possible. So the negation meant the card appeared ONLY
              on builds where checkout cannot be started, and vanished on the
              builds where it can. Both halves are wrong and they are wrong in
              opposite directions: a coach who could have upgraded was never
              asked, and a coach who could not was shown "Upgrade ›", sent to
              the billing screen, and left there with nothing to buy — which is
              the worse of the two, because it happens at the moment their
              trial has just expired and they are trying to keep working.

              It is now two states rather than one condition. The trial is
              worth telling a coach about either way; what changes is whether
              this card is allowed to promise them a way out of it. Where
              billing is not configured it says what is true — their trial is
              running, or has ended — and does not offer a door that opens onto
              a wall. */}
          {trial ? (
            billingAvailable() ? (
              <Card onPress={() => router.push('/(trainer)/billing')} tone={trial.expired ? t.crit : t.brand} style={{ marginBottom: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <Icon name="sparkle" size={20} color={trial.expired ? t.ink3 : t.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{trial.expired ? 'Your free trial has ended' : `${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'} left in your free trial`}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{trial.expired ? 'Upgrade to keep coaching your clients.' : 'Upgrade any time to unlock everything.'}</Text>
                  </View>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Upgrade ›</Text>
                </View>
              </Card>
            ) : (
              <Card tone={trial.expired ? t.crit : t.brand} style={{ marginBottom: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <Icon name="sparkle" size={20} color={trial.expired ? t.ink3 : t.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{trial.expired ? 'Your free trial has ended' : `${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'} left in your free trial`}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Subscriptions are not open yet — keep coaching, and we will be in touch before anything changes.</Text>
                  </View>
                </View>
              </Card>
            )
          ) : null}

          {trainerInvites.length > 0 ? (
            <View>
              {trainerInvites.map((iv) => (
                <Notice key={iv.id} tone={t.brand} kicker="Platform invitation"
                  title={`${iv.ownerName || 'Repple'} invited you to coach`}
                  note="Accept to join the platform as a trainer and set up your coaching profile.">
                  <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                    <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineTrainerInvite(iv.id)} /></View>
                    <View style={{ flex: 2 }}><Cta label="Accept & Set Up Profile" wide onPress={() => acceptJoin(iv.id, iv.ownerName)} /></View>
                  </View>
                </Notice>
              ))}
            </View>
          ) : null}

          {needsAttention.length > 0 ? (
            <Notice tone={t.warn} kicker="Suggested check-ins"
              title={`${needsAttention.length} client${needsAttention.length > 1 ? 's' : ''} could use a nudge`}
              note="Draft one with AI, review it, then send.">
              <View style={{ marginTop: sp.sm }}>
                {needsAttention.slice(0, 4).map((c) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, marginTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                    <Initials t={t} name={c.name} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                      <View style={{ marginTop: 3 }}><Flag t={t} tone={t.warn} text={attnReason(c) || ''} /></View>
                    </View>
                    <Cta label="Draft" onPress={() => draftNudge(c)} />
                  </View>
                ))}
              </View>
            </Notice>
          ) : null}
        </View>

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <Hero
          label="Active Clients"
          figure={fig(rosterCount)}
          // 'partial' gets its own sentence rather than falling through to the
          // drift summary. It used to print the short count with no hint that
          // it was short, and the drift note underneath it ("2 drifting") was
          // computed over the same fragment — two figures about a book neither
          // of them had seen the whole of.
          note={rosterStatus === 'error'
            ? 'Your roster could not be read, so this is not a count of zero. The clients listed below are the ones that did come back.'
            : rosterStatus === 'partial'
              ? 'Only part of your roster came back, so it cannot be counted — a subtotal here would read as your whole book.'
              : rosterStatus === 'loading'
                ? 'Reading your roster…'
                : active === 0 ? 'No clients yet — add or invite your first below.' : driftNote()}
          tone={toContact == null ? t.ink3 : toContact > 0 ? t.warn : t.brand}
          onPress={() => router.push('/(trainer)/analytics')}
        />

        <Rule />

        {/* ── the business, in three columns ──────────────────────────────── */}
        <Section>
          <SectionHead title="This Month" note="Analytics" onPress={() => router.push('/(trainer)/analytics')} />
          <KpiRow items={[
            // ── what used to be here, and why it is gone ────────────────
            //
            // "Est. Revenue", computed as `active clients × 4 × session fee`
            // and printed with a hardcoded '$'.
            //
            // The 4 was a number nobody chose. No client of this app has ever
            // been asked how often they train, nothing anywhere records it, and
            // four a month is not a default — it is an invention, multiplied by
            // a real headcount and a real fee to produce something with the
            // shape of a measurement. A coach with eight clients and a £60 rate
            // read "£1,920/mo" and had no way to tell it apart from a figure
            // derived from their actual work.
            //
            // The '$' was the second invention, and part 99
            // (supabase/parts/99-tenant-currency.sql) exists precisely to stop
            // it: Repple is white-labelled, `tenants.currency` is nullable
            // because a gym that has not said is not to be guessed at, and
            // there is no currency column on `trainers` at all. So an
            // independent coach's rate is a number whose unit this app does not
            // know. Printing a dollar sign in front of it in front of a London
            // trainer is not a formatting slip; it is a wrong number.
            //
            // What replaces it is a count of sessions with a RECORDED outcome
            // of 'completed' in the last month — real work, really marked,
            // needing no currency to state. A dash until the read lands.
            { label: 'Delivered', value: fig(delivered), unit: delivered == null ? undefined : `/${DELIVERED_WINDOW_DAYS}d` },
            { label: 'Unread', value: fig(unread) },
            // Null until the record has been read: an em-dash, never a zero
            // that would tell a coach nobody needs them this week.
            { label: 'To Contact', value: fig(toContact) },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {sessionsUnread
              ? 'Your sessions could not be read, so this is not a count of none.'
              : delivered == null
                ? 'Reading your sessions…'
                : unmarked
                  ? `Sessions marked as delivered in the last ${DELIVERED_WINDOW_DAYS} days. ${unmarked} more ${unmarked === 1 ? 'is' : 'are'} waiting on an outcome and ${unmarked === 1 ? 'is' : 'are'} not counted here.`
                  : `Sessions marked as delivered in the last ${DELIVERED_WINDOW_DAYS} days.`}
          </Text>
        </Section>

        <Rule />

        {/* ── coaching tools ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaching Tools" />
          {/* Seven destinations, and this was a horizontal ScrollView with its
              indicator hidden — so Analytics, Leaderboard and Feedback sat past
              the right edge of a phone with nothing on screen saying they were
              there. The client app's Train tab had the identical fault and hid
              most of its row; ChipGrid wraps instead. It has to be a plain View
              to do it: flexWrap is inert inside a horizontal ScrollView, which
              lays out on one unbounded axis, so this could not be fixed in
              place. `tone` keeps the coach's icons in brand, as they were.
              `key` is the route, so two chips sharing a word cannot collide. */}
          <ChipGrid
            tone={t.brand}
            items={SHORTCUTS.map(([ic, label, route]) => ({
              icon: ic, label, key: route, onPress: () => router.push(route as any),
            }))}
          />
        </Section>

        {/* ── pending invites ────────────────────────────────────────────── */}
        {sentInvites.filter((i) => i.status === 'pending').length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Pending Invites" note={`${sentInvites.filter((i) => i.status === 'pending').length} awaiting`} />
            {sentInvites.filter((i) => i.status === 'pending').map((i, idx) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: idx === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="message" size={16} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{i.email}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{COACHED_MODE_SHORT[i.mode]} · awaiting sign-up / accept</Text>
                </View>
                <Ghost label="Cancel" onPress={() => revokeInvite(i.id)} />
              </View>
            ))}
          </Section>
        </>) : null}

        <Rule />

        {/* ── the roster ─────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Clients" note={active > 0 ? driftNote() : undefined} />

          {/* The read failed. Say so, say what it cost, and do NOT let the
              ordinary order pass for the drift order. */}
          {driftErr && active > 0 ? (
            <Notice tone={t.crit} kicker="Order unavailable"
              title="Could not read who is drifting"
              note={driftErr + ' The list below is in its usual order, not by who needs a call.'} />
          ) : null}

          {/* Read, and the record is empty for everyone. Distinct from both of
              the other two renders, and explicitly not an all-clear. */}
          {bands && bands.total > 0 && bands.unknown === bands.total ? (
            <Notice tone={t.s5} kicker="Nothing recorded"
              title={`No record for ${bands.total === 1 ? 'this client' : 'any of your ' + bands.total + ' clients'}`}
              note={`No check-ins, logged workouts, sessions or visits in the last ${DEFAULT_WINDOWS.historyDays} days. That is not the same as everyone being fine — it means there is nothing here to judge them on.`} />
          ) : null}

          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
            {/* Two buttons, and they used to be called "Add a client" and
                "Add client" — eight characters apart, side by side, doing
                different things. The prominent one made a roster entry; the
                other opened the sheet that shows the coaching code. A coach
                pressed the prominent one and asked "is this the only way? I
                don't see a trainer's code", which is the only reasonable
                reading of that pair. The sheet's own failure text already
                called it "Invite a client"; the button label had drifted. */}
            <View style={{ flex: 1 }}><Ghost label="Invite a Client" onPress={async () => {
                setInvEmail(''); setInvMode('online'); setInvOpen(true);
                setMyCode(null); setMyCodeErr(null);
                const r = await fetchMyJoinCode();
                if (r.ok) setMyCode(r.code); else setMyCodeErr(r.reason);
                await loadCodes();
              }} /></View>
            <View style={{ flex: 1 }}><Cta label="Add Client" wide onPress={async () => {
                setNewName(''); setNewEmail(''); setNewGoal('Fat loss'); setNewMode('online'); setAddOpen(true);
                // The code is needed by the alert at the end of THIS flow, so
                // it has to be loaded on this path too. It was only ever
                // fetched by the button beside this one.
                if (!myCode) {
                  const r = await fetchMyJoinCode();
                  if (r.ok) setMyCode(r.code); else setMyCodeErr(r.reason);
                }
              }} /></View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2, marginBottom: sp.md }} contentContainerStyle={{ gap: sp.sm, paddingHorizontal: 2 }}>
            {AUTO_SEGS.map((sg) => (
              <Pressable key={sg.key} onPress={() => setSeg(sg.key)}
                style={{ backgroundColor: seg === sg.key ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 7 }}>
                <Text style={{ ...ty.label, fontWeight: '500', ...numeric, color: seg === sg.key ? t.brandInk : t.ink2 }}>{sg.label} {sg.n}</Text>
              </Pressable>
            ))}
            {allTags.map((tg) => (
              <Pressable key={tg} onPress={() => setSeg(tg)}
                style={{ backgroundColor: seg === tg ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ ...ty.label, color: seg === tg ? t.brandInk : t.ink3 }}>#</Text>
                <Text style={{ ...ty.label, fontWeight: '500', color: seg === tg ? t.brandInk : t.ink2, textTransform: 'capitalize' }}>{tg}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {seg !== 'all' && shownRoster.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
              <View style={{ flex: 1 }}><Ghost icon="message" label={`Message ${shownRoster.length}`} onPress={bulkMessage} /></View>
              <View style={{ flex: 1 }}><Ghost icon="grid" label="Assign Program" onPress={() => setBulkTplOpen(true)} /></View>
            </View>
          ) : null}

          {shownRoster.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {rosterUnread && roster.length === 0
                ? 'Your roster could not be read, so this is not "no clients" — pull down to try again.'
                : roster.length === 0 ? 'No clients yet. Add or invite your first — they connect once they accept in the app.' : 'No clients in this segment.'}
            </Text>
          ) : null}

          {/* Not read yet. The list is on screen and usable; it just is not
              sorted by drift, and it says so rather than implying it is. */}
          {!drift && !driftErr && shownRoster.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
              <ActivityIndicator size="small" color={t.ink3} />
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                Reading check-ins, logs, sessions and visits — the order below is not by drift yet.
              </Text>
            </View>
          ) : null}

          {driftRows.map(({ c, d }, idx) => {
            const prev = idx > 0 ? driftRows[idx - 1].d : null;
            const opensBand = !!d && (!prev || prev.status !== d.status);
            // Drift is stated on the row only where there is something to act
            // on. "Holding their pattern" is said once, by the band heading.
            const showDrift = !!d && d.status !== 'on_track';
            return (
            <View key={c.id}>
              {opensBand ? (
                <View style={{ marginTop: idx === 0 ? 0 : sp.xl, marginBottom: sp.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: driftTone(t, d!) }} />
                    <Text style={{ ...ty.micro, color: t.ink3 }}>{bandTitle(d!.status)}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{bandNote(d!.status, DEFAULT_WINDOWS)}</Text>
                </View>
              ) : null}
            <Pressable onPress={() => setSel(c)}
              style={{ paddingVertical: sp.lg, borderTopWidth: idx === 0 || opensBand ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <Initials t={t} name={c.name} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal} · {COACHED_MODE_SHORT[c.mode]} · {c.lastActive}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {/* No scan, no delta. "0 kg" said this client had held
                        their weight exactly, which is a measurement nobody
                        took — the same invented zero the rest of this screen
                        renders as a dash. */}
                    {/* `<= 0` painted the accent dot for every client whose
                        weight had come down — including the ones the coach
                        recorded as building muscle, and including a delta of
                        exactly zero, which is not a direction at all. The goal
                        on the row decides it, and where the goal is unknown or
                        has no opinion the mark stays neutral. */}
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: movementIsProgress(c.weightDelta, goalToEnum(c.goal), 'weight') ? t.brand : t.ink3 }} />
                    <Text style={{ ...ty.label, fontWeight: '500', ...numeric, color: t.ink }}>
                      {deltaLabel(weightDeltaIn(c.weightDelta, coachUnit), { since: null, unit: coachUnit, noChange: 'No change', noBaseline: '—' })}
                    </Text>
                  </View>
                  {/* Days a week, against what this person's own weeks used to
                      look like. An em-dash where there is no baseline — never
                      a rate invented out of an empty window. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, ...numeric }}>
                    {d ? `${fig(d.recentPerWeek)} / wk · was ${fig(d.baselinePerWeek)}` : `Next: ${c.next}`}
                  </Text>
                </View>
              </View>

              {((c.unread != null && c.unread > 0) || showDrift || (!d && atRiskClient(c)) || (c.injuries && c.injuries.length)) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm, marginLeft: 38 + sp.md }}>
                  {showDrift ? <Flag t={t} tone={driftTone(t, d!)} text={DRIFT_LABEL[d!.status]} /> : null}
                  {!d && atRiskClient(c) ? <Flag t={t} tone={t.warn} text="Needs a check-in" /> : null}
                  {c.unread != null && c.unread > 0 ? <Flag t={t} tone={t.brand} text={`${c.unread} unread`} /> : null}
                  {c.injuries && c.injuries.length ? <Flag t={t} tone={t.s3} text={c.injuries.some((x) => x.isNew) ? 'New injury' : 'Injury'} /> : null}
                </View>
              ) : null}

              {showDrift ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, marginLeft: 38 + sp.md }}>{d!.reason}</Text>
              ) : null}

              {drift && !d ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, marginLeft: 38 + sp.md }}>Not read yet — no drift assessment for this client.</Text>
              ) : null}

              {tagsFor(c.id).length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: sp.sm, marginLeft: 38 + sp.md }}>
                  {tagsFor(c.id).map((tg) => (
                    <View key={tg} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ ...ty.caption, color: t.ink3, textTransform: 'capitalize' }}>{tg}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ marginTop: sp.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Plan Adherence</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{c.adherence != null ? c.adherence + '%' : 'no check-ins yet'}</Text>
                </View>
                {c.adherence != null ? <Bar t={t} pct={c.adherence} good={c.adherence >= 85} /> : null}
              </View>
            </Pressable>
            </View>
            );
          })}
        </Section>

      </ScrollView>

      {/* ── client detail ────────────────────────────────────────────────── */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={SCRIM} onPress={() => setSel(null)} />
        <View style={sheet(t, { padding: 0, paddingBottom: 0, maxHeight: '86%' })}>
          {sel && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>{sel.name}</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>{sel.goal} · {sel.weightDelta == null ? 'no scans yet' : deltaLabel(weightDeltaIn(sel.weightDelta, coachUnit), { since: null, unit: coachUnit, noChange: 'no change', noBaseline: 'no scans yet' })} · {sel.adherence != null ? sel.adherence + '% adherence' : 'no check-ins yet'}</Text>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Delivery" />
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  {COACHED_MODES.map((m) => (
                    <Chip key={m} t={t} label={COACHED_MODE_SHORT[m]} on={sel.mode === m}
                      onPress={() => { setClientMode(sel.id, m); setSel({ ...sel, mode: m }); }} />
                  ))}
                </View>
              </View>

              {sel.metrics && Object.values(sel.metrics).some((v) => v != null) ? (
                <View style={{ marginBottom: sp.xl }}>
                  <SheetHead t={t} title="Body Composition · latest scan" />
                  {METRIC_GROUPS.map((g) => {
                    const items = METRIC_DEFS.filter((d) => d.group === g && sel.metrics && sel.metrics[d.key] != null);
                    if (!items.length) return null;
                    return (
                      <View key={g} style={{ marginBottom: sp.md }}>
                        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 4 }}>{g}</Text>
                        {items.map((d) => (
                          <View key={String(d.key)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                            <Text style={{ ...ty.label, color: t.ink2 }}>{d.label}</Text>
                            <Text style={{ ...ty.label, fontWeight: '500', ...numeric, color: t.ink }}>{sel.metrics![d.key]} {d.unit}</Text>
                          </View>
                        ))}
                      </View>
                    );
                  })}
                  {(() => {
                    const m = sel.metrics!; const out: string[] = [];
                    const pair = (l?: number, r?: number, name?: string) => { if (l == null || r == null || !l || !r) return; const diff = Math.abs(l - r) / Math.max(l, r); if (diff >= 0.1) out.push(name + ': ' + (l < r ? 'left' : 'right') + ' ' + Math.round(diff * 100) + '% behind'); };
                    pair(m.leanArmLKg, m.leanArmRKg, 'Arms'); pair(m.leanLegLKg, m.leanLegRKg, 'Legs');
                    return out.length ? <Flag t={t} tone={t.warn} text={out.join('  ·  ') + ' — cue the weaker side.'} /> : null;
                  })()}
                </View>
              ) : null}

              {/* ── progress photos this client sent ─────────────────────────
                  The ONLY route by which a progress photo reaches a coach. There
                  is no roster-wide read behind this: each of these is a photo
                  this person chose, one at a time, and each can be withdrawn.
                  The three states below are deliberately unalike — "could not
                  read the list" must never look like "they have sent nothing",
                  because the second is a fact about them and the first is not. */}
              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title={`Progress photos · sent by ${sel.name.split(' ')[0]}`} />
                {sharedErr ? (
                  <KitFlag tone={t.warn}>
                    {sharedErr} That is not the same as them having sent none — the list could not be read, so this sheet cannot say either way.
                  </KitFlag>
                ) : shared === null ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>Loading what they have sent you…</Text>
                ) : shared.length === 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    {sel.name.split(' ')[0]} has not sent you any progress photos. You see one only when they send that photo — there is nothing to turn on here, and being their coach does not show you the rest.
                  </Text>
                ) : (
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.md }}>
                      {shared.map((p) => (
                        <View key={p.id}>
                          {p.url ? (
                            <Image source={{ uri: p.url }} style={{ width: 104, height: 142, borderRadius: radius.md, backgroundColor: t.surface2 }} />
                          ) : (
                            // The grant is here and the file would not sign.
                            // A gap, not a blank frame that reads as loading.
                            <View style={{ width: 104, height: 142, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.sm }}>
                              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Picture{'\n'}unavailable</Text>
                            </View>
                          )}
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, textAlign: 'center' }}>{new Date(p.takenAt).toLocaleDateString()}</Text>
                        </View>
                      ))}
                    </ScrollView>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                      {shared.length === 1 ? 'One photo' : shared.length + ' photos'}, sent by {sel.name.split(' ')[0]} — and only these. They can take any of them back whenever they like; once they do, it stops opening here within {Math.round(SHARED_URL_TTL_S / 60)} minutes.
                    </Text>
                    {(missingSharedFiles(shared) ?? 0) > 0 ? (
                      <KitFlag tone={t.warn} style={{ marginTop: 4 }}>
                        {missingSharedFiles(shared) === 1 ? 'One of these has no picture behind it any more.' : `${missingSharedFiles(shared)} of these have no picture behind them any more.`}
                      </KitFlag>
                    ) : null}
                  </View>
                )}
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Tags" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: sp.sm }}>
                  {tagsFor(sel.id).length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No tags yet.</Text> : null}
                  {tagsFor(sel.id).map((tg) => (
                    <Pressable key={tg} onPress={() => removeTag(sel.id, tg)} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ ...ty.caption, color: t.ink2, textTransform: 'capitalize' }}>{tg}</Text>
                      <Icon name="minus" size={12} color={t.ink3} />
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <TextInput value={tagDraft} onChangeText={setTagDraft} placeholder="Add a tag — e.g. comp prep" placeholderTextColor={t.ink3} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => { if (tagDraft.trim()) { addTag(sel.id, tagDraft); setTagDraft(''); } }} style={{ ...field(t), flex: 1 }} />
                  <Cta label="Add" onPress={() => { if (tagDraft.trim()) { addTag(sel.id, tagDraft); setTagDraft(''); } }} />
                </View>
                {allTags.filter((tg) => !tagsFor(sel.id).includes(tg)).length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.sm }}>
                    {allTags.filter((tg) => !tagsFor(sel.id).includes(tg)).map((tg) => (
                      <Pressable key={tg} onPress={() => addTag(sel.id, tg)} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 4 }}>
                        <Text style={{ ...ty.caption, color: t.ink3, textTransform: 'capitalize' }}>+ {tg}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {sel.injuries && sel.injuries.length ? (
                <View style={{ marginBottom: sp.xl }}>
                  <SheetHead t={t} title="Injuries & Limitations · disclosed at onboarding" />
                  {sel.injuries.map((inj, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                      <Icon name="heart" size={14} color={t.s3} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{areaLabel(inj.area)}</Text>
                          <Text style={{ ...ty.caption, color: t.ink2, textTransform: 'capitalize' }}>· {inj.severity}</Text>
                          {inj.isNew ? <Flag t={t} tone={t.s3} text="New" /> : null}
                        </View>
                        {inj.note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{inj.note}</Text> : null}
                      </View>
                    </View>
                  ))}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Their plan automatically flags and swaps moves that load these areas.</Text>
                </View>
              ) : null}

              {/* Training history is per-client and comes from the client's own
                  logs. Until those exist there is nothing honest to show here. */}
              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Training" />
                <Text style={{ ...ty.label, color: t.ink2 }}>
                  {selProgram
                    ? `Assigned program: ${selProgram.title} · ${selProgram.days.length} day${selProgram.days.length === 1 ? '' : 's'} a week.`
                    : 'No program assigned yet.'}
                </Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                  Last active {sel.lastActive} · next session {sel.next}. What they have actually trained is under What They've Actually Done on their profile.
                </Text>
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="AI Weekly Summary" />
                {aiSummary ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>{aiSummary}</Text> : null}
                <Pressable onPress={() => genSummary(sel)} disabled={aiBusy}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 12, opacity: aiBusy ? 0.6 : 1 }}>
                  {aiBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{aiBusy ? 'Generating…' : aiSummary ? 'Regenerate summary' : 'Generate AI weekly summary'}</Text>
                </Pressable>
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Timeline" />
                {timeline.length === 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>No history yet — notes, feedback and check-ins appear here.</Text>
                ) : timeline.slice(0, 8).map((ev) => (
                  <View key={ev.id} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                    <View style={{ alignItems: 'center' }}>
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, marginTop: 5, backgroundColor: ev.kind === 'Feedback' ? t.brand : t.ink3 }} />
                      <View style={{ flex: 1, width: hairline, backgroundColor: t.ring, marginTop: 2 }} />
                    </View>
                    <View style={{ flex: 1, paddingBottom: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{ev.kind}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3 }}>{new Date(ev.at).toLocaleDateString()}</Text>
                      </View>
                      <Text style={{ ...ty.label, color: t.ink2 }}>{ev.body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Meal Plan Targets" />
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>Shape {sel.name.split(' ')[0]}'s daily calories, protein, carbs & fat — applies to their Meals tab live.</Text>

                {/* The controls are withheld, not just annotated, when the
                    adjustment could not be read.
                    `getNutri(id)?.[key] ?? 0` cannot tell "no adjustment set"
                    from "we could not read the adjustment", so under a failed
                    read every chip row highlighted 0 — and a coach looking at
                    a client they had already cut 300 kcal from would be shown
                    a plan of no change. Tapping any chip then upserts, so the
                    next tap would have overwritten the real figures with what
                    the screen had guessed. Offering nothing is the only
                    version of this that cannot destroy what is on the server. */}
                {nutriStatus === 'error' ? (
                  <KitFlag tone={t.warn}>
                    {sel.name.split(' ')[0]}&rsquo;s current adjustment could not be read, so it is not shown
                    and cannot be changed here — anything set now would overwrite figures we
                    cannot see. Their Meals tab is unaffected. Try again once you are connected.
                  </KitFlag>
                ) : nutriStatus === 'loading' ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>Reading their current targets…</Text>
                ) : (
                <>
                {([
                  ['Calories', [-300, -150, 0, 150, 300], 'kcalDelta'],
                  ['Protein (g)', [0, 10, 20, 30], 'proteinDelta'],
                  ['Carbs (g)', [-50, -25, 0, 25, 50], 'carbDelta'],
                  ['Fat (g)', [-20, -10, 0, 10, 20], 'fatDelta'],
                ] as const).map(([label, opts, key]) => (
                  <View key={key} style={{ marginBottom: sp.md }}>
                    <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>{label}</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {opts.map((v) => (
                        <Chip key={v} t={t} label={v > 0 ? '+' + v : String(v)} on={(getNutri(sel.id)?.[key] ?? 0) === v}
                          onPress={() => setNutri(sel.id, { [key]: v })} />
                      ))}
                    </View>
                  </View>
                ))}
                <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6, marginTop: 4 }}>Set specific meals</Text>
                {slotsFor(sel.mealsPerDay || 3).map((slot, pos) => {
                  const ovIdx = getNutri(sel.id)?.mealOverride?.[pos];
                  const dietForPick = (sel.diet || 'meat') as any;
                  const picked = ovIdx != null ? mealAt(dietForPick, slot, ovIdx, (sel.avoid ?? []) as any) : null;
                  return (
                    <View key={pos} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                      <View style={{ flex: 1, marginRight: sp.sm }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{slot}</Text>
                        <Text style={{ ...ty.label, fontWeight: picked ? '500' : '400', color: picked ? t.ink : t.ink3, marginTop: 2 }} numberOfLines={1}>{picked ? picked.n : 'Auto (client picks)'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {picked ? <Ghost label="Clear" onPress={() => setNutri(sel.id, { mealOverride: (() => { const mm = { ...(getNutri(sel.id)?.mealOverride ?? {}) }; delete mm[pos]; return mm; })() })} /> : null}
                        <Cta label={picked ? 'Change' : 'Choose'} onPress={() => { setMealQuery(''); setMealPick({ pos, slot }); }} />
                      </View>
                    </View>
                  );
                })}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                  <TextInput value={nnote} onChangeText={setNnote} placeholder="Note on the plan (optional)…" placeholderTextColor={t.ink3} style={{ ...field(t), flex: 1 }} />
                  <Cta label="Save" onPress={() => { setNutri(sel.id, { note: nnote.trim() }); }} />
                </View>
                {getNutri(sel.id) ? (
                  <Pressable onPress={() => { clearNutri(sel.id); setNnote(''); }} style={{ paddingVertical: sp.sm, marginTop: 2 }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>Clear adjustment</Text>
                  </Pressable>
                ) : null}
                </>
                )}
              </View>

              {clientMeals === null ? (
                <View style={{ marginBottom: sp.xl }}>
                  <SheetHead t={t} title="Recent Meals Logged" />
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Could not read {sel.name.split(' ')[0]}’s food log. This does not mean they have not been logging.
                  </Text>
                </View>
              ) : clientMeals.length > 0 ? (
                <View style={{ marginBottom: sp.xl }}>
                  <SheetHead t={t} title="Recent Meals Logged" />
                  {clientMeals.map((m, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.sm, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }} numberOfLines={1}>{m.name}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginLeft: sp.sm }}>{num(m.kcal)} kcal · {m.via}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Coach Feedback" />
                {getFeedback(sel.id).length === 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>No feedback yet. Leave {sel.name.split(' ')[0]} a note below.</Text>
                ) : getFeedback(sel.id).map((fitem, i) => (
                  <View key={fitem.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.label, color: t.ink2 }}>{fitem.body}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{new Date(fitem.at).toLocaleDateString()}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <TextInput value={fb} onChangeText={setFb} placeholder="Leave advice or a note…" placeholderTextColor={t.ink3} multiline style={{ ...field(t, 44), flex: 1 }} />
                  <Cta label="Send" onPress={() => { const id = sel.id; if (fb.trim()) { addFeedback(id, fb); setFb(''); } }} />
                </View>
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Private Notes (only you)" />
                {/* Three renders, and the middle one is the whole point.
                    'error' with an empty list means the notes could NOT be
                    read — it is not a coach who has written nothing. Say so,
                    because the alternative is a coach concluding they never
                    wrote down the thing they are half-remembering, and writing
                    it again, or worse, deciding it did not happen. */}
                {notesStatus === 'error' ? (
                  <KitFlag tone={t.crit} style={{ marginBottom: sp.sm }}>
                    Your notes could not be read — this is not "no notes". Anything you save now
                    will still be stored, but check back once you have a connection.
                  </KitFlag>
                ) : notesStatus === 'loading' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>Reading your notes…</Text>
                ) : getNotes(sel.id).length === 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                    Nothing here yet. Only you can see what you write below.
                  </Text>
                ) : null}
                {getNotes(sel.id).map((n, i) => (
                  <View key={n.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.label, color: t.ink2 }}>{n.body}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{new Date(n.at).toLocaleDateString()}</Text>
                    </View>
                    {/* The delete is confirmed and its RESULT is read. A
                        PostgREST delete that matches no rows returns no error,
                        so removeNote reports the row count instead — and a note
                        that is still on the server must not disappear from this
                        list as though it were gone. */}
                    <Pressable onPress={() => {
                      const cid = sel.id;
                      Alert.alert('Delete this note?', 'It is only visible to you, and this cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
                          const gone = await removeNote(cid, n.id);
                          if (!gone) Alert.alert('Not deleted', 'That note is still saved. Check your connection and try again.');
                        })(); } },
                      ]);
                    }} hitSlop={8}
                          accessibilityRole="button" accessibilityLabel="Remove note">
                      <Icon name="minus" size={14} color={t.ink3} />
                    </Pressable>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <TextInput value={pnote} onChangeText={setPnote} placeholder="Private note (client can't see this)…" placeholderTextColor={t.ink3} multiline style={{ ...field(t, 44), flex: 1 }} />
                  {/* The text is cleared only once the note is stored. It used
                      to be cleared immediately, which is how a note that was
                      never saved anywhere also stopped being recoverable by
                      the person who had just typed it. */}
                  <Ghost label={noteBusy ? 'Saving…' : 'Save'} onPress={() => {
                    const cid = sel.id;
                    const draft = pnote;
                    if (!draft.trim() || noteBusy) return;
                    setNoteBusy(true);
                    void (async () => {
                      const saved = await addNote(cid, draft);
                      setNoteBusy(false);
                      if (saved) setPnote('');
                      else Alert.alert('Not saved', 'That note was not stored, so it is still in the box. Check your connection and tap Save again.');
                    })();
                  }} />
                </View>
              </View>

              {/* ── the way out of this sheet ────────────────────────────────
                  Eight rows stood here: their checklist, what they're working
                  toward, the week they've planned, the photos they sent, log a
                  session, message, the program builder — each one a destination
                  added on the day its screen was built, and each one a line of
                  static text that could not say whether there was anything
                  behind it. A coach reading "Progress photos they sent you"
                  could not tell it from "they have sent you none".
                  They are now one route, to app/(trainer)/client.tsx, which
                  reads each of those screens' own sources and puts a live line
                  under every destination — plus the thing this sheet never had:
                  when this person was last seen at all. Nothing has been taken
                  away; the same seven screens are one tap further on and one
                  sentence better described. */}
              <ListRow icon="people" title={`Open ${sel.name.split(' ')[0]}`}
                note="How they are doing, and the way in to their goals, week, checklist, photos, program, sessions and thread"
                onPress={() => { const id = sel.id; const nm = sel.name; setSel(null); router.push({ pathname: '/(trainer)/client', params: { clientId: id, name: nm } }); }} />

              {/* Logging a session was FOUR taps from here — this sheet, then
                  Open, then the client screen, then the row on it — and it is
                  the thing a coach does immediately after finishing with
                  somebody, often standing on the gym floor. It is the one
                  action worth putting beside Open rather than behind it.

                  Same destination and same params as the client screen's own
                  row, so there is one log-session path and not two that can
                  drift. */}
              <ListRow icon="train" title="Log a Session You Ran"
                note={`Goes into ${sel.name.split(' ')[0]}'s own record, marked as logged by you.`}
                onPress={() => { const id = sel.id; const nm = sel.name; setSel(null); router.push({ pathname: '/(trainer)/log-session', params: { clientId: id, name: nm } }); }} />

              {/* Stays here rather than moving: it writes a message, which is
                  the same kind of thing as the feedback box and the private
                  notes above it, and the client screen is read-only by
                  construction. */}
              <ListRow icon="bell" title="Send a Check-in Nudge" note={'A quick "how is it going?" message'} onPress={() => sendNudge(sel)} />

              <Pressable
                onPress={() => { const s = sel; Alert.alert('Remove client?', `Remove ${s.name} from your roster?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { removeClient(s.id); setSel(null); } }]); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, marginTop: sp.lg, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Remove client</Text>
              </Pressable>
              <Cta label="Close" wide onPress={() => setSel(null)} />
            </ScrollView>
          )}
        </View>
              </KeyboardAvoidingView>

      {/* ── coach meal picker ─────────────────────────────────────────────
          Nested in the client sheet on purpose. "Choose" is only ever tapped
          on a meal row above, and the picker reads `sel` for the diet, the
          allergens and the name it writes to — it has no meaning without this
          sheet open. As a sibling `<Modal>` at the screen root it was worse
          than meaningless: iOS presents each modal in its own window and puts
          one opened from the root beneath the sheet already showing, so
          "Choose" set `mealPick`, mounted the picker out of sight behind the
          client sheet, and left a coach tapping a button that never did
          anything. Nested here it presents above the sheet it belongs to. */}
      <Modal visible={!!mealPick} transparent animationType="slide" onRequestClose={() => setMealPick(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={SCRIM} onPress={() => setMealPick(null)} />
        <View style={sheet(t, { maxHeight: '80%' })}>
          {mealPick && sel ? (
            <>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>Pick a {mealPick.slot.toLowerCase()}</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>For {sel.name.split(' ')[0]} · {sel.diet || 'meat'} plan · tap to assign</Text>
              <TextInput value={mealQuery} onChangeText={setMealQuery} placeholder="Search meals…" placeholderTextColor={t.ink3} style={{ ...field(t), marginBottom: sp.md }} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                {searchMeals((sel.diet || 'meat') as any, mealPick.slot, mealQuery, 40, (sel.avoid ?? []) as any).map((m) => (
                  <Pressable key={m.idx} onPress={() => { setNutri(sel.id, { mealOverride: { ...(getNutri(sel.id)?.mealOverride ?? {}), [mealPick.pos]: m.idx } }); setMealPick(null); }}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                    <View style={{ flex: 1, marginRight: sp.md }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{m.n}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{m.k} kcal · P{m.p} / C{m.c} / F{m.f}</Text>
                    </View>
                    <Icon name="chevron" size={16} color={t.ink3} />
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
              </KeyboardAvoidingView>
      </Modal>
      {/* ── end of the client sheet, which the meal picker sits inside ──── */}
      </Modal>

      {/* ── add a client ─────────────────────────────────────────────────── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setAddOpen(false)} />
          <View style={sheet(t)}>
            <Text style={{ ...ty.title, color: t.ink }}>Add Client</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>They join your roster and become bookable in your schedule.</Text>
            <SheetHead t={t} title="Name" />
            <TextInput value={newName} onChangeText={setNewName} placeholder="Client name" placeholderTextColor={t.ink3} style={{ ...field(t), marginBottom: sp.lg }} />
            <SheetHead t={t} title="Email · optional, records an invite" />
            <TextInput value={newEmail} onChangeText={setNewEmail} placeholder="client@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={{ ...field(t), marginBottom: sp.lg }} />
            <SheetHead t={t} title="Goal" />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {['Fat loss', 'Build muscle', 'Tone'].map((g) => (
                <Chip key={g} t={t} label={g} on={newGoal === g} onPress={() => setNewGoal(g)} />
              ))}
            </View>
            <SheetHead t={t} title="Coaching Type" />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.sm }}>
              {COACHED_MODES.map((id) => (
                <Chip key={id} t={t} label={COACHED_MODE_SHORT[id]} on={newMode === id} onPress={() => setNewMode(id)} />
              ))}
            </View>
            {/* What the chip above does, for the one that is selected. Three
                delivery names in a row are three words until something says
                which client screens each of them turns on. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>{COACHED_MODE_NOTE_COACH[newMode]}</Text>
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setAddOpen(false)} /></View>
              <View style={{ flex: 2 }}>
                <Cta label="Add Client" wide onPress={async () => {
                  if (!newName.trim()) { Alert.alert('Add a name', 'Enter the client name.'); return; }
                  // Awaited and READ, like sendInvite two lines down already
                  // was. Firing this and moving on is why a coach could add
                  // somebody, watch them appear, and find them gone at the next
                  // launch: the row is added to local state first and the
                  // server write can refuse without anything on screen
                  // changing. If it did not land, say so and keep the sheet
                  // open with what they typed still in it.
                  const added = await addClient(newName, newGoal, newMode);
                  if (!added) {
                    Alert.alert(
                      'Not saved',
                      `${newName.trim()} is showing on this phone but was not recorded, so they will be gone when you next open the app. Check your connection and try again.`,
                    );
                    return;
                  }
                  const em = newEmail.trim();
                  const wanted = !!em && em.includes('@');
                  // Awaited and read. sendInvite resolves false when the write
                  // was refused, and this used to announce success either way.
                  const invited = wanted ? await sendInvite(em, newMode) : false;
                  setAddOpen(false);
                  const nm = newName.trim();
                  // The code goes IN the alert, because this is the moment the
                  // coach needs it. This used to end on "tell them yourself so
                  // they know to install it" without giving them anything to
                  // tell — the coaching code lived behind a different button,
                  // on a different sheet, also called "Add a client". A tester
                  // asked "is this the only way? I don't see a trainer's code".
                  //
                  // It also matters that the code is the RELIABLE path: the
                  // email invite only links if they sign up with that address
                  // spelled exactly the same way, and nothing tells either side
                  // when it does not.
                  const codeLine = myCode
                    ? '\n\nYour coaching code is ' + myCode + '. That works whoever they are and whatever address they sign up with — send it to them.'
                    : '';
                  const buttons: any[] = [{ text: invited || !wanted ? 'Great' : 'OK' }];
                  if (myCode) {
                    buttons.unshift({
                      text: 'Share code',
                      onPress: () => Share.share({
                        message: inviteMessage(myCode),
                      }).catch(() => {}),
                    });
                  }
                  Alert.alert('Client added',
                    (!wanted
                      ? nm + ' is now on your roster.'
                      : invited
                        ? nm + ' is on your roster. Repple does not send email — ' + em + ' is recorded as an invite, and they link to you the first time they sign in to Repple with that address.'
                        : nm + ' is on your roster, but the invite for ' + em + ' was NOT recorded, so they will not link to you when they sign in.') + codeLine,
                    buttons);
                }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── broadcast ────────────────────────────────────────────────────── */}
      <Modal visible={bcOpen} transparent animationType="slide" onRequestClose={() => setBcOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setBcOpen(false)} />
          <View style={sheet(t)}>
            {/* Was "Broadcast to All Clients", which is the name of a
                DIFFERENT screen — app/(trainer)/broadcast.tsx, whose own
                subtitle is "Send one message to a whole segment of your
                clients". So a coach met two all-client tools both called
                Broadcast, and was sent from one to the other to do the thing
                neither of them does. These are a NOTICE (posted once, seen on
                every dashboard) and a MESSAGE (written into each person's
                thread, with a push). Named for what they are. */}
            <Text style={{ ...ty.title, color: t.ink }}>Post a Notice</Text>
            {/* This copy has now been wrong in both directions, which is worth
                recording.

                It first promised "Everyone on your roster sees this on their
                dashboard" and confirmed "Sent" over an in-memory store with no
                table behind it — a coach believing they had told forty clients
                about a cancelled class. It was corrected to say the note stayed
                on this device, which was true of the store as it then was.

                `announcements` is real now (part 109): a row addressed to this
                coach's current roster, which their clients read on their own
                dashboards. So the correction became the lie — a coach could pin
                a note believing it private and put it in front of every client
                they have. That is worse than the original, because the original
                over-promised reach and this one under-promised it.

                The rule this file keeps relearning: the sentence describes what
                the write does TODAY, and it moves when the write moves. */}
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.lg }}>Every client on your roster sees this on their dashboard, in their notifications, and in their Notices — where it stays after today. It is not a message and does not land in anyone’s thread; for that, use Broadcast.</Text>
            <TextInput value={bcText} onChangeText={setBcText} placeholder="Your announcement…" placeholderTextColor={t.ink3} multiline style={{ ...field(t, 90), marginBottom: sp.md }} />

            {/* The push is its own decision and the label says what it does.
                Before this, a notice reached nobody at all; the temptation on
                fixing that is to push every one of them, and a coach who can
                ring forty phones at three in the morning should have to choose
                it. There is no scheduler in this app and nothing records what
                timezone anybody is in, so a "sends in the morning" option would
                be a promise nothing here could keep — the honest control says
                NOW, and lets the words be judged against that. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, color: t.ink }}>Also send a push</Text>
                <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{pushConsequence('coach', null)}</Text>
              </View>
              <Switch value={bcPush} onValueChange={setBcPush} />
            </View>

            {/* Awaited, and the answer read. `addAnnouncement` reaches a server
                now, so announcing "Posted" on the tap would be the same class of
                claim this modal has already made twice. What it reports is what
                the fan-out COUNTED — rows notify_users() actually wrote — and
                never the size of the roster, which is the false figure
                app/(owner)/promotions.tsx used to print. */}
            <View pointerEvents={bcBusy ? 'none' : 'auto'} style={{ opacity: bcBusy ? 0.6 : 1 }}>
              <Cta label={bcBusy ? 'Posting…' : 'Post to My Clients'} wide onPress={async () => {
                if (!bcText.trim()) { Alert.alert('Write something', 'Enter your announcement.'); return; }
                setBcBusy(true);
                let res;
                try { res = await addAnnouncement(bcText, { push: bcPush }); } finally { setBcBusy(false); }
                if (!res.ok || !res.delivery) {
                  // The sheet stays open with the text in it: they wrote it once.
                  Alert.alert('Not posted', 'That could not be posted, so your clients have not seen it. Your words are still here — try again in a moment.');
                  return;
                }
                const summary = deliverySummary(res.delivery);
                setBcText(''); setBcPush(false); setBcOpen(false);
                Alert.alert('Posted', `${summary}\n\nTo write into people’s threads instead — everyone, or one tag — use Broadcast.`,
                  [{ text: 'Open Broadcast', onPress: () => router.push('/(trainer)/broadcast') }, { text: 'Done', style: 'cancel' }]);
              }} />
            </View>

            {/* What this coach has already posted. A notice used to be
                write-only from here — nothing in the coach's app showed one
                back — so the only way to check whether Thursday's cancellation
                went out was to post it again. */}
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Posted before</Text>
              {noticeStatus === 'error' ? (
                // An empty list under 'error' is unknown, not "you have posted
                // none" — src/ui/loadStatus.ts.
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>
                  Your posted notices could not be read just now. This is not a statement that you have none.
                </Text>
              ) : myNotices.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>
                  {noticeStatus === 'loading' ? 'Reading your notices…' : 'Nothing posted yet.'}
                </Text>
              ) : myNotices.slice(0, 3).map((a) => (
                <View key={a.id} style={{ marginTop: sp.sm }}>
                  <Text style={{ ...ty.label, color: t.ink2 }} numberOfLines={2}>{a.body}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{inboxAge(a.at)}</Text>
                </View>
              ))}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── invite by email ──────────────────────────────────────────────── */}
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setInvOpen(false)} />
          {/* Capped and scrolled, following the meal and template sheets on
              this screen. The code section used to be one code and one line;
              it is now a list that grows with every campaign a coach runs, and
              an uncapped sheet pushes Send Invite off the bottom of the phone
              with nothing to scroll. The title and the two buttons stay put so
              the sheet can always be finished or abandoned. */}
          <View style={sheet(t, { maxHeight: '88%' })}>
            <Text style={{ ...ty.title, color: t.ink }}>Add a Client</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>Two ways in. The code works whoever they are and whatever address they signed up with; the email invite only reaches them if you spell it exactly as they did.</Text>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {/* ── the codes ────────────────────────────────────────────
                One code became several. A coach running a gym flyer, an
                Instagram bio link and a referral card was running three
                campaigns through one string and got one fused number back, so
                "which of these worked?" had no answer — and the only lever on
                offer, New Code, DESTROYED the code already printed on the card
                in order to make a second one. Named codes run in parallel; see
                supabase/parts/81-coach-join-codes.sql.

                New Code is kept, and only for the default code. It is not a
                campaign tool and never was — it is the remedy for a code that
                has got somewhere the coach did not put it, and there is no
                other way to stop a string that is loose in the world. Named
                codes are turned off individually instead, which keeps their
                history; rotating deliberately does not, and that is why it is
                still behind a destructive confirmation. */}
            <SheetHead t={t} title="Your Main Code" />
            <View style={{ marginBottom: sp.xl }}>
              {myCodeErr ? (
                <Text style={{ ...ty.label, color: t.ink2 }}>{myCodeErr}</Text>
              ) : myCode == null ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading your code…</Text>
              ) : (
                <>
                  <Pressable
                    onPress={() => {
                      // Share, not copy: expo-clipboard is a native module and
                      // would need a new binary before any coach could use this.
                      // Share is core React Native, and is what a coach actually
                      // does with a code — sends it to the person standing there.
                      Share.share({ message: inviteMessage(myCode) })
                        .catch(() => { /* dismissing the sheet is not a failure; the code is on screen */ });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Share your coaching code, ${myCode.split('').join(' ')}`}
                    style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.lg, alignItems: 'center' }}>
                    {/* Letter-spaced and in the numeric face: this gets read out
                        loud across a gym floor and copied by hand. */}
                    <Text style={{ ...value(30), color: t.ink, letterSpacing: 6 }}>{myCode}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>Tap to send it to them</Text>
                  </Pressable>
                  <View style={{ marginTop: sp.sm }}>
                    <Ghost label="Copy Link for Your Bio" icon="share" onPress={() => copyJoinLink(myCode, 'your main code')} />
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    They enter this in the Repple app under Find a trainer, at the top. You still approve them before they join your roster.
                    Tapping the code sends a message with the link in it; Copy Link gives you the bare address, for a bio, a caption,
                    or the destination of an ad — which is the one that lets what you spend be matched to who it brought.
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sp.md }}>
                    {/* "Is the code working?" is the first thing anybody asks
                        about a code. Unread is not zero, and codeCountLine
                        refuses to print a figure the read did not establish —
                        a coach shown "0 joined" because the request failed
                        concludes the campaign failed and stops running it. */}
                    <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{codeCountLine(codes.status, defaultCodeRow)}</Text>
                    <Ghost label="New Code" onPress={() => {
                      Alert.alert(
                        'Issue a new code?',
                        'Your current code stops working straight away. Anyone you have already given it to will not be able to use it, and clients who already joined are unaffected.\n\nTo run a second code alongside this one — for a flyer or a bio link — make a named code below instead.',
                        [
                          { text: 'Keep it' },
                          { text: 'New code', style: 'destructive', onPress: async () => {
                            const r = await rotateJoinCode();
                            if (r.ok) { setMyCode(r.code); setMyCodeErr(null); await loadCodes(); }
                            else Alert.alert('Not changed', r.reason);
                          } },
                        ],
                      );
                    }} />
                  </View>
                  {/* The main code's count is not only its own — it carries every
                      join by code that no named code claims, including codes New
                      Code has replaced. Said out loud, because otherwise the
                      number reads as belonging to the six characters above it. */}
                  {codes.status === 'ready' ? (
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: 4 }}>{DEFAULT_CODE_NOTE}</Text>
                  ) : null}
                </>
              )}
            </View>

            {/* ── named codes ──────────────────────────────────────────── */}
            <SheetHead t={t} title="Codes You Have Named" />
            <View style={{ marginBottom: sp.xl }}>
              {/* An empty list means "you have made none" ONLY under a completed
                  read. Under a failure it means the app does not know, and the
                  create form is hidden with it: a coach who cannot see their
                  existing codes cannot tell whether the one they are about to
                  make is a duplicate. */}
              {codes.status === 'error' ? (
                <Notice
                  tone={t.warn}
                  kicker="Not read"
                  title="Your named codes could not be read"
                  note={codes.reason ?? 'Nothing here is a count. Close this and open it again once you have a connection.'}
                />
              ) : codes.status === 'partial' ? (
                <PartialRead what="codes" shown={namedCodes.length} />
              ) : codes.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading your codes…</Text>
              ) : namedCodes.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  None yet. A named code tells you which of the things you did brought somebody in — one for the gym flyer, one for your Instagram bio, both live at once.
                </Text>
              ) : null}

              {namedCodes.map((c) => (
                <View key={c.id ?? c.code} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: c.isLive ? t.ink : t.ink3 }}>{c.label}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{codeCountLine(codes.status, c)}</Text>
                    {!c.isLive ? (
                      // Kept on screen with its counts. A campaign that is over
                      // still tells the coach what it did, and deleting the row
                      // would make it look as though it never ran.
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }}>Turned off — it takes nobody new.</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => { Share.share({ message: inviteMessage(c.code) }).catch(() => {}); }}
                    disabled={!c.isLive}
                    accessibilityRole="button"
                    accessibilityLabel={`Share the code for ${c.label}, ${c.code.split('').join(' ')}`}
                    style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 8, opacity: c.isLive ? 1 : 0.5 }}>
                    <Text style={{ ...ty.label, ...numeric, color: t.ink, letterSpacing: 2 }}>{c.code}</Text>
                  </Pressable>
                  {c.isLive ? (
                    <Ghost label="Copy Link" icon="share" onPress={() => copyJoinLink(c.code, c.label)} />
                  ) : null}
                  {c.isLive && c.id ? (
                    <Ghost label="Turn Off" onPress={() => {
                      const id = c.id as string;
                      Alert.alert(
                        `Turn off “${c.label}”?`,
                        'It stops working for anyone you have given it to. Clients who already joined with it are unaffected, and it keeps its count so you can still see what it brought in.',
                        [
                          { text: 'Keep it' },
                          { text: 'Turn it off', style: 'destructive', onPress: async () => {
                            const r = await revokeJoinCode(id);
                            // Re-read rather than editing the row in place: the
                            // list is the only thing that says which codes are
                            // live, and a local edit would show it off whether
                            // or not the server agreed.
                            if (r.ok) await loadCodes();
                            else Alert.alert('Still on', r.reason);
                          } },
                        ],
                      );
                    }} />
                  ) : null}
                </View>
              ))}

              {codes.status === 'ready' ? (
                <View style={{ marginTop: sp.md }}>
                  {canCreateCode(codes.rows) ? (
                    <>
                      <TextInput
                        value={newCodeLabel}
                        onChangeText={setNewCodeLabel}
                        placeholder="Name it — “Gym flyer”, “Instagram bio”"
                        placeholderTextColor={t.ink3}
                        maxLength={MAX_LABEL}
                        style={{ ...field(t), marginBottom: sp.sm }}
                      />
                      <Ghost label={codeBusy ? 'Making…' : 'Make a Named Code'} onPress={async () => {
                        if (codeBusy) return;
                        // Checked here as well as in Postgres so a blank or
                        // duplicate name costs nothing to find out about. The
                        // server stays the authority — two devices can create
                        // codes at once and only it sees both.
                        const problem = labelProblem(newCodeLabel, codes.rows.filter((r) => r.isLive && !r.isDefault).map((r) => r.label));
                        if (problem) { Alert.alert('Name it first', problem); return; }
                        setCodeBusy(true);
                        const r = await createJoinCode(newCodeLabel);
                        setCodeBusy(false);
                        if (!r.ok) { Alert.alert('Not made', r.reason); return; }
                        setNewCodeLabel('');
                        await loadCodes();
                        Alert.alert(
                          'Code made',
                          `${r.label}: ${r.code}. Put this one wherever that campaign lives — anyone who joins with it is counted against it.`,
                          [{ text: 'Share it', onPress: () => { Share.share({ message: inviteMessage(r.code) }).catch(() => {}); } }, { text: 'Done', style: 'cancel' }],
                        );
                      }} />
                    </>
                  ) : (
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      You have {MAX_LIVE_CODES} codes live at once, which is the most Repple will issue. Turn one off to make another.
                    </Text>
                  )}
                </View>
              ) : null}
            </View>

            {/* ── what each code cost, and what it returned ─────────────
                The counts above answer "which of the things I did brought
                people in?". They do not answer the question an online coach
                spends money on: "which of them returned money?". Twenty joins
                off a code that cost £400 in ads and four off a code that cost
                nothing are not comparable numbers, and a coach reading only
                the joins pours next month's budget into the loser.

                Repple can see two of the three figures — who came in on which
                code, and what they then paid. The third, what the coach spent,
                exists nowhere in this database; nothing here sees an Instagram
                invoice. So it is asked for, per code, and an empty field means
                UNKNOWN rather than free. See src/lib/codeReturn.ts. */}
            <SheetHead t={t} title="What Each Code Returned" />
            <View style={{ marginBottom: sp.xl }}>
              {/* Said once, up front, and not as a footnote. Every figure below
                  is last touch: somebody who saw an Instagram post and later
                  joined off a friend's code is the friend's, and Instagram gets
                  nothing for the work that started it. A coach about to move a
                  budget on these numbers is owed that sentence first. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{LAST_TOUCH_NOTE}</Text>

              {returns.status === 'error' ? (
                <Notice
                  tone={t.warn}
                  kicker="Not read"
                  title="What your codes returned could not be read"
                  note={returns.reason ?? 'Nothing here is a figure. Close this and open it again once you have a connection.'}
                />
              ) : returns.status === 'partial' ? (
                <PartialRead what="clients" shown={returns.rows.length} />
              ) : returns.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Working out what each code returned…</Text>
              ) : codeTell.rankable ? (
                <Notice tone={t.good} kicker="Enough to tell" title={`${codeTell.best.label} is ahead of ${codeTell.runnerUp.label}`} note={codeTell.note} />
              ) : (
                // The important one. A coach with twelve clients seeing
                // "Instagram 4, TikTok 1" has learned nothing — that gap is
                // what a fair coin does more than a third of the time — and a
                // screen that ranked them would be spending their money on
                // noise it had dressed up as a finding. So no comparison is
                // drawn at all, and the reason is stated instead.
                <Notice tone={t.s3} kicker="Not enough yet" title="Too early to say which is working" note={codeTell.note} />
              )}

              {returns.rows.map((c) => {
                const fgs = codeFigures(returns.status, c);
                const key = c.id ?? '';
                return (
                  <View key={key || c.code} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: c.isLive ? t.ink : t.ink3 }}>{c.label}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{stayedLine(returns.status, c)}</Text>
                    <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                      <CodeFig t={t} label="Spent" value={fgs.spent} />
                      <CodeFig t={t} label="Clients" value={fgs.clients} />
                      <CodeFig t={t} label="They paid" value={fgs.revenue} />
                      <CodeFig t={t} label="Each cost" value={fgs.perClient} />
                    </View>
                    {returnLine(returns.status, c) ? (
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>{returnLine(returns.status, c)}</Text>
                    ) : null}
                    {returns.status === 'ready' ? (
                      // The whole sentence — what the box is FOR and that it may
                      // be left empty — was a placeholder, so it was gone the
                      // moment a figure was in it, and a coach coming back to
                      // correct a recorded spend saw an unlabelled amount beside
                      // a Save button. The currency is the one already recorded
                      // against this code; where nothing is recorded yet there
                      // is none to state, and Repple does not invent one (part
                      // 99 — `tenants.currency` is nullable because a gym that
                      // has not said is not to be guessed at).
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm, marginTop: sp.sm }}>
                        <Field
                          label="What it cost you"
                          hint={c.spend?.currency ? `${c.spend.currency} · leave empty to clear` : 'leave empty if you don’t know'}
                          a11y={c.spend?.currency ? `What this code cost you, in ${c.spend.currency}` : 'What this code cost you'}
                        >
                          <TextInput
                            value={spendDraft[key] ?? ''}
                            onChangeText={(v) => setSpendDraft((d) => ({ ...d, [key]: v }))}
                            keyboardType="decimal-pad"
                            style={field(t)}
                          />
                        </Field>
                        <Ghost label={spendBusy === key ? 'Saving…' : 'Save'} onPress={() => { if (spendBusy) return; saveSpend(c); }} />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <Rule />
            <View style={{ height: sp.lg }} />
            <SheetHead t={t} title="Or Invite by Email" />
            <TextInput value={invEmail} onChangeText={setInvEmail} placeholder="client@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={{ ...field(t), marginBottom: sp.lg }} />
            <SheetHead t={t} title="Coaching Type" />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.sm }}>
              {COACHED_MODES.map((id) => (
                <Chip key={id} t={t} label={COACHED_MODE_SHORT[id]} on={invMode === id} onPress={() => setInvMode(id)} />
              ))}
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xl }}>{COACHED_MODE_NOTE_COACH[invMode]}</Text>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setInvOpen(false)} /></View>
              <View style={{ flex: 2 }}>
                <Cta label="Send Invite" wide onPress={async () => {
                  const e = invEmail.trim();
                  if (!e || !e.includes('@')) { Alert.alert('Enter an email', 'Add a valid client email address.'); return; }
                  const ok = await sendInvite(e, invMode);
                  setInvOpen(false);
                  // "Invitation sent" was the wrong two words: nothing is sent.
                  // The invite waits in Repple for that address to sign in, and
                  // the only person who can tell them it exists is the coach.
                  Alert.alert(
                    ok ? 'Invite recorded' : 'Invite not recorded',
                    ok
                      ? 'Repple does not send email. ' + e + ' is saved as your ' + COACHED_MODE_SHORT[invMode].toLowerCase() + ' coaching invite and they link to you the first time they sign in to Repple with that address. Tell them yourself so they know to install it.'
                      : 'Nothing was saved for ' + e + ', so no invite is waiting for them. Check your connection and try again.',
                    [{ text: ok ? 'Done' : 'OK' }]);
                }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── AI check-in draft review ─────────────────────────────────────── */}
      <Modal visible={!!draftClient} transparent animationType="slide" onRequestClose={() => setDraftClient(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={SCRIM} onPress={() => setDraftClient(null)} />
        <View style={sheet(t)}>
          {draftClient && (
            <>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>Check in with {draftClient.name.split(' ')[0]}</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>{attnReason(draftClient)} · edit the draft before sending.</Text>
              {draftBusy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, padding: 20, marginBottom: sp.lg }}>
                  <ActivityIndicator color={t.brand} />
                  <Text style={{ ...ty.label, color: t.ink3 }}>Drafting a personalised check-in…</Text>
                </View>
              ) : (
                <TextInput value={draftText} onChangeText={setDraftText} multiline placeholder="Your message…" placeholderTextColor={t.ink3} style={{ ...field(t, 110), marginBottom: sp.lg }} />
              )}
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <Ghost icon="sparkle" label="Redraft" onPress={() => draftNudge(draftClient)} />
                <View style={{ flex: 1 }}>
                  <Cta label="Send Check-in" wide onPress={sendDraft} />
                </View>
              </View>
              <Pressable onPress={() => setDraftClient(null)} style={{ paddingVertical: sp.md, alignItems: 'center' }}>
                <Text style={{ ...ty.label, color: t.ink3 }}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
              </KeyboardAvoidingView>
      </Modal>

      {/* ── bulk program assign ──────────────────────────────────────────── */}
      <Modal visible={bulkTplOpen} transparent animationType="slide" onRequestClose={() => setBulkTplOpen(false)}>
        <Pressable style={SCRIM} onPress={() => setBulkTplOpen(false)} />
        <View style={sheet(t, { maxHeight: '78%' })}>
          <Text style={{ ...ty.title, color: t.ink }}>Assign to {shownRoster.length} clients</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>Pick a program template for everyone in this segment.</Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {templates.map((tpl) => {
              const dc = tpl.program.days.length; const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <ListRow key={tpl.id} icon="grid" title={tpl.name} note={`${dc} days · ${ec} exercises`} onPress={() => bulkAssign(tpl)} />
              );
            })}
          </ScrollView>
          <Pressable onPress={() => setBulkTplOpen(false)} style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: 6 }}>
            <Text style={{ ...ty.label, color: t.ink3 }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
