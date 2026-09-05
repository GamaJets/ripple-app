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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { num } from '../../src/lib/format';
import {
  DELIVERED_WINDOW_DAYS, MARK_WINDOW_DAYS, awaitingOutcome, deliveredBetween, fetchMySessions, windowStart,
} from '../../src/lib/trainerSessions';
import type { PtSession } from '../../src/lib/gymSessions';
import { useAuth } from '../../src/ui/auth';
import {
  compareDrift, bandTitle, bandNote,
  DRIFT_LABEL, DEFAULT_WINDOWS, localDayKey, type Drift,
} from '../../src/lib/clientDrift';
import { useTenant } from '../../src/ui/tenant';
import { useClientDrift } from '../../src/ui/clientDrift';
import { reportError } from '../../src/lib/reportError';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, Image, KeyboardAvoidingView, Platform, ActivityIndicator, Share, Switch, type ViewStyle, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { trialCard } from '../../src/lib/trialGate';
import { useTrialReading } from '../../src/ui/trialReading';
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
import { METRIC_DEFS, METRIC_GROUPS } from '../../src/lib/inbodyMetrics';
import { type RosterClient } from '../../src/lib/trainerMock';
import { COACHED_MODES, COACHED_MODE_SHORT, COACHED_MODE_NOTE_COACH, booksInPerson, type CoachedMode } from '../../src/lib/types';
import { lastActiveLine } from '../../src/lib/lastActiveLine';
import { areaLabel } from '../../src/lib/injuries';
import { supabase } from '../../src/lib/supabase';
import { askAboutClient } from '../../src/lib/coach';
import { sharedAreas, fillName } from '../../src/lib/coachShare';
import { useRoster } from '../../src/ui/roster';
import { searchRoster, rosterSearchLine } from '../../src/lib/rosterSearch';
import { hitSlopFor } from '../../src/lib/a11y';
import { isWhole, worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
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
  LAST_TOUCH_NOTE, codeFigures, enoughToTell, parseSpend, returnLine, spendCurrency, spendFieldValue,
  stayedLine,
  type CodeReturnRow,
} from '../../src/lib/codeReturn';
import { useTrainerInvites } from '../../src/ui/trainerInvites';
import { useClientTags } from '../../src/ui/clientTags';
import { useProgramTemplates, type ProgramTemplate } from '../../src/ui/programTemplates';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { sendCoachMessages } from '../../src/ui/messaging';
import { guardOverwrite } from '../../src/lib/overwriteGuard';
import {
  overwriteBrief, bulkReport, guardRecipients, bulkThreadNote, endCoachingBrief,
  type AssignTarget, type WriteOutcome, type EndTarget,
} from '../../src/lib/bulkActions';
import { listNames } from '../../src/lib/groupProgram';
import { buildRosterExport, rosterExportBlocker, type RosterExportRow } from '../../src/lib/rosterExport';
import { shareTextFile, fileExportAvailable, fileShareBlocker } from '../../src/lib/exportShare';
import { fetchPhotosSharedWithMe, missingSharedFiles, SHARED_URL_TTL_S, type SharedPhoto } from '../../src/lib/photoShare';
import { inviteMessage, joinLink } from '../../src/lib/joinCode';
// Not `import * as Clipboard from 'expo-clipboard'`, which is what this line
// used to be. expo-clipboard's entry point is a single requireNativeModule call
// evaluated at module scope, so on an Android install made before the
// dependency landed that import THREW while this file was being loaded — and
// this file is the coach's home tab. See src/ui/nativeModules.ts.
import { HAS_NATIVE_CLIPBOARD, CLIPBOARD_UNAVAILABLE_NOTE, copyToClipboard, pickDocument, readFileBase64, DOCUMENT_PICKER_UNAVAILABLE_NOTE, FILE_READ_UNAVAILABLE_NOTE } from '../../src/ui/nativeModules';
import { previewCoachRoster, type CoachClientRow, type ImportPreview } from '../../src/lib/csvImport';
import { screenInvites } from '../../src/lib/memberInvites';
import {
  base64ToUtf8, planBlocker, planSummary, resultSummary, rosterPlan,
  type RosterPlan, type RosterResult, type RowOutcome,
} from '../../src/lib/rosterImport';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { useCoachSetup } from '../../src/ui/coachSetup';
import { coachSetupRows, coachSetupCardLine, coachSetupNext, showCoachSetup } from '../../src/lib/coachFirstRun';
import { useDeliveryFact } from '../../src/ui/coachDelivery';
import { deliveryNote, showsInPerson, HIDDEN_NOT_GONE } from '../../src/lib/coachDelivery';
import { EndReasonSheet, UnexplainedDepartures, DEPARTURE_WINDOW_DAYS } from '../../src/ui/EndReasonSheet';
import { type EndReason } from '../../src/lib/endCoaching';
import { promptBookAlerts } from '../../src/ui/coachReminders';
import { useChannelPrefs } from '../../src/ui/coachNotify';
import { channelAllows } from '../../src/lib/coachNotify';
import { fetchMyInvoices } from '../../src/ui/coachInvoices';
import { ageingBook, type CoachInvoice } from '../../src/lib/coachInvoice';
import { homeMoney, homeMoneyDrawn, homeMoneyNote, homeMoneyTitle, type HomeMoney } from '../../src/lib/homeMoney';
import { minorMoney } from '../../src/lib/coachMoney';
// The day every expiry and every overdue judgement below is made against, kept
// current for as long as this tab is mounted — which, for a tab, is the life of
// the app. See the note on `invoiceAgeing`.
import { useToday } from '../../src/ui/today';
import { FORWARD_CHAR, FORWARD_ICON } from '../../src/ui/direction';

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

/**
 * What stands in for Copy Link on a build with no clipboard.
 *
 * Not a button that quietly does nothing, and not one that says "copied" over a
 * clipboard that took nothing: the address itself, selectable, so the coach can
 * still get it into a bio by hand. `note` is drawn once per sheet rather than
 * once per code — the sentence is the same for all of them and a coach with six
 * named campaigns does not need it six times.
 */
function JoinLinkFallback({ t, code, note }: { t: Theme; code: string; note?: boolean }) {
  return (
    <View style={{ marginTop: sp.sm }}>
      {/* Selectable is the whole point of this block. A URL nobody can select
          is a URL nobody can use, and long-press-to-select is off by default on
          a React Native Text. */}
      <Text selectable style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{joinLink(code)}</Text>
      {note ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{CLIPBOARD_UNAVAILABLE_NOTE}</Text>
      ) : null}
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

/**
 * The tools that are about being in a room with somebody.
 *
 * Split out of SHORTCUTS rather than removed from it: for a coach who has said
 * they work online and has nobody on the book training in person, these move
 * BELOW the rest under a line saying why. They are never deleted, never
 * unsearchable — src/lib/features.ts still lists every one of them and Explore
 * still finds them by name — and they come back on their own the moment an
 * in-person client appears. See src/lib/coachDelivery.ts.
 *
 * Schedule and Your Register qualify. It is written as a list because the
 * question "is this an in-person tool?" is the thing worth being able to answer
 * once, and the next chip added here is a one-line decision rather than a
 * rewrite of the branch below.
 *
 * Your Register is the other end of taking a class: it says what the registers
 * a coach took actually came to, and until now nothing in the app linked to it
 * — `/(trainer)/my-register` was named in src/lib/features.ts and nowhere else,
 * so a coach could only reach it by searching Explore for a screen they had no
 * reason to know existed.
 */
const IN_PERSON_SHORTCUTS: [IconName, string, string][] = [
  ['calendar', 'Schedule', '/(trainer)/calendar'],
  ['check', 'Your Register', '/(trainer)/my-register'],
];

const SHORTCUTS: [IconName, string, string][] = [
  // First, and first for a reason. Asked "where is the coach's code to give to
  // clients? it should be readily available", the answer was: press Invite a
  // Client below and read it off a modal sheet whose title is about adding one.
  // Nothing on this screen — or any other — said the sheet held it. This chip is
  // the whole fix on the navigation side: one tap from the coach's home tab to
  // /(trainer)/join-code, which is the code, the link and the share sheet and
  // nothing else. Not in IN_PERSON_SHORTCUTS: an online coach hands their code
  // out more often than a coach who works in a room, not less.
  ['share', 'Your Code', '/(trainer)/join-code'],
  ['bell', 'Broadcast', '/(trainer)/broadcast'],
  ['train', 'Programs', '/(trainer)/builder'],
  ...IN_PERSON_SHORTCUTS,
  ['video', 'Videos', '/(trainer)/videos'],
  ['chart', 'Analytics', '/(trainer)/analytics'],
  ['trophy', 'Leaderboard', '/(trainer)/leaderboard'],
  // Beside Leaderboard because both are read for the same reason — who on this
  // book is worth more than the sessions they buy. It had the same problem Your
  // Register had: `/(trainer)/referrals` was named in src/lib/features.ts and
  // nowhere else in the app, so the screen that says which clients are bringing
  // in other clients could be reached only by searching for it.
  ['people', 'Referrals', '/(trainer)/referrals'],
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


/**
 * What the coach is owed, on the screen they open first.
 *
 * ── Why this card did not exist ────────────────────────────────────────────
 *
 * It is not that the data was not here. This screen has read the entire invoice
 * book for as long as it has fired notifications from it — twenty-two columns,
 * aged into overdue / upcoming / undated on every render — and exactly one
 * number left that memo: `invoiceAgeing.overdue.length`, into `bookState`.
 * `bookState` is not drawn either. It feeds `promptBookAlerts`, a local
 * notification fired at most once a week, and `bookAlert` ranks the invoice
 * line BELOW unmarked sessions — so a coach with three sessions waiting on an
 * outcome was never told about their money at all, by the only thing that would
 * have told them.
 *
 * There was also no route to /(trainer)/invoices anywhere on this screen. The
 * question src/lib/coachInvoice.ts calls "the most common unanswered question
 * in this app" had its answer sitting in this component's memory and no pixel
 * and no tap.
 *
 * ── What it may say ───────────────────────────────────────────────────────
 *
 * Every judgement is src/lib/homeMoney.ts's, for the usual reason: the figure
 * is over the OVERDUE rows alone so it is about the same invoices as the count
 * beside it, a truncated read loses its number and keeps its rows, a failed one
 * draws a card saying so — `UnmarkedSessions` above already makes that
 * distinction, and an absent card here reads as a clear book — and the money is
 * one line per currency, never a sum across them.
 */
function MoneyOwed({ m }: { m: HomeMoney }) {
  const t = useTheme();
  const router = useRouter();
  if (!homeMoneyDrawn(m)) return null;
  return (
    <Card onPress={() => router.push('/(trainer)/invoices')} tone={m.failed ? t.crit : t.s3} style={{ marginBottom: sp.md }}>
      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>{homeMoneyTitle(m)}</Text>
      {/* One row per currency. `minorMoney` is the one money formatter in this
          codebase and it is the only thing here that knows what a minor unit is
          worth; a null from it draws nothing rather than a bare number in a
          currency nobody stated. */}
      {(m.pots ?? []).map((p) => {
        const amount = minorMoney(p.minorUnits, p.currency);
        if (!amount) return null;
        return (
          <View key={p.currency} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: sp.sm }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {p.count} in {p.currency}
            </Text>
            <Text style={{ ...ty.label, ...numeric, color: t.ink }}>{amount}</Text>
          </View>
        );
      })}
      {/* Said once, and never added together. Two currencies are two amounts of
          money — the same rule app/(trainer)/invoices.tsx states beside its own
          per-currency rows. */}
      {(m.pots?.length ?? 0) > 1 ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          These are separate amounts of money and are deliberately not added together.
        </Text>
      ) : null}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{homeMoneyNote(m)}</Text>
    </Card>
  );
}


export default function TrainerClients() {
  const t = useTheme();
  const router = useRouter();
  // Kept current for as long as this screen is mounted, which for a tab is the
  // life of the app. NOT `useMemo(() => localDayKey(Date.now()), [])` and not a
  // day captured inside another memo's body — see `invoiceAgeing`.
  const today = useToday();
  // The trial, from the ACCOUNT, through the same read Billing uses.
  //
  // This was `trialInfo()` — the AsyncStorage counter in src/lib/trial.ts,
  // whose own header says in capitals that it is no longer the authority on
  // anything and which starts again from zero on reinstall. It was rendered
  // here as a flat fact ("12 days left in your free trial") while Billing, one
  // tap away and on the same account, said the start date could not be read.
  // Both were doing what their own code said, and neither knew the other
  // existed. src/ui/trialReading.ts is now the one read and the one clock, so
  // the two screens cannot disagree without that file disagreeing with itself.
  //
  // Read once at mount and never again was also a bug on its own: a tab is
  // never unmounted, so the figure was frozen at launch. `reloadEverything`
  // below re-runs it on focus and on a pull down.
  const { reading: trialReading, reload: reloadTrial } = useTrialReading();
  // `status` was computed by the roster provider and read by nobody, so a
  // refused read reached this screen as an empty list and was announced as
  // "No clients yet" — to a coach who has clients.
  const { roster, status: rosterStatus, addClient, removeClient, setClientMode, refresh: refreshRoster } = useRoster();
  /* ── the nonce the screen's own reads hang off ──────────────────────────
   *
   * Four effects here read the server directly: the roster-wide drift, the
   * coach's own delivered sessions, the coaching relationships that ended, and
   * the Repple invoices behind the overdue banner. They stay four separate
   * effects — each is reported separately and a shared loader would hide a
   * working half behind a broken one — so the refresh bumps this and every one
   * of them re-reads through the code that already knows how to report it.
   *
   * The two effects keyed on `sel` are deliberately NOT on this nonce. They
   * belong to the open client sheet, one of them clears the generated summary
   * the coach may be reading, and the pull below is on the scroll view
   * underneath a modal that would have to be closed to reach it. */
  const [readNonce, setReadNonce] = useState(0);
  // How this coach works: their own declared answer, widened by their roster.
  // Only ever narrows the screen when the coach said "online" AND the roster
  // came back WHOLE AND nobody on it trains in the room. Anything short of all
  // three shows everything. See src/lib/coachDelivery.ts.
  const delivery = useDeliveryFact();
  // Who is being removed, while the "why did they leave" sheet is open. Its own
  // flag rather than a field on `sel`: the client sheet is closed before this
  // one opens, because iOS will not stack two modals from the same parent and
  // check-runtime-traps.mjs exists for exactly that pair.
  const [ending, setEnding] = useState<{ id: string; name: string } | null>(null);
  // The COACH's unit, not the client's: this roster is read by the coach, and
  // `weightDelta` is stored in kilograms. Both places it appeared printed a bare
  // "kg" whatever the coach reads in. `weightDeltaIn` converts the SPAN once —
  // subtracting two separately rounded pound readings is the bug that helper
  // exists to prevent. See app/(trainer)/client-training.tsx, which already
  // draws the same distinction.
  const coachUnit: WeightUnit = useSettings().weightUnit;
  const rosterUnread = rosterStatus === 'error';
  const { tenant, refresh: refreshTenant } = useTenant();
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
  /**
   * The read itself, and the three-plus-one states it produces, now live in
   * src/ui/clientDrift.ts. Every line of it came from here — this screen was
   * the only one that had moved off `atRiskClient`, and the two that had not
   * (analytics.tsx and assistant.tsx) could not move without either copying a
   * hundred lines out of this file or sharing them. Two definitions of "at
   * risk" was the bug; three implementations of the good one would have been
   * the next one.
   *
   * The names below are kept so the four hundred lines that read them do not
   * move: `drift` is the map (null until read, an empty map IS an answer),
   * `driftErr` is a failure and never an absence, `driftRead` is what the read
   * could not cover, `driftActionable` gates ACTING on a verdict as opposed to
   * ordering by it, and `driftActingNote` says out loud why a short list of
   * names is not a clean book.
   */
  const _drift = useClientDrift(roster, tenant?.id ?? null, readNonce);
  const drift = _drift.drift;
  const driftErr = _drift.error;
  const driftRead = _drift.coverage;
  const driftFor = (c: RosterClient): Drift | null => _drift.driftFor(c.id);
  const driftActionable = (c: RosterClient): boolean => _drift.actionable(c.id);
  const driftActingNote: string | null = _drift.note;
  const bands = _drift.bands;

  const { name: coachName, reload: reloadProfile } = useMyTrainerProfile();
  // `status` as well as the two functions, for the reason the notes provider
  // below spells out: `getFeedback` returns `[]` under 'loading' AND under
  // 'error', so the sheet was reading an unread provider as a coach who had
  // never written to this client.
  const { getFeedback, addFeedback, status: fbStatus, reload: reloadFeedback } = useCoachFeedback();
  // A note that never reached the server has to say so, the same way a private
  // note does — `addFeedback` resolves false and the client never sees it.
  const [fbBusy, setFbBusy] = useState(false);
  const { get: getNutri, setAdjust: setNutri, clear: clearNutri, status: nutriStatus, reload: reloadNutri } = useCoachNutrition();
  const [mealPick, setMealPick] = useState<{ pos: number; slot: Slot } | null>(null);
  const [mealQuery, setMealQuery] = useState('');
  const { getNotes, addNote, removeNote, status: notesStatus, reload: reloadNotes } = useCoachNotes();
  // Saving a private note is now a round trip (see src/ui/coachNotes.tsx: it
  // used to be a `useState` that lost every note on relaunch), so the Save
  // button has to be able to say "in flight" and "that did not save".
  const [noteBusy, setNoteBusy] = useState(false);
  // `mine` and `status` as well as the write: a coach who has posted notices
  // could not see one of them anywhere in this app, so "did that go out?" was
  // answered by posting it again. The sheet below lists them.
  const { addAnnouncement, mine: myNotices, status: noticeStatus, reload: reloadNotices } = useAnnouncements();
  const { sent: sentInvites, sendInvite, revokeInvite, status: inviteStatus, reload: reloadInvites } = useInvites();
  /**
   * The addresses this coach already has an open invite for.
   *
   * `screenInvites` takes this to drop a second invite to somebody who already
   * has one — the partial unique index in part 37 enforces the same rule, and a
   * batch that violates it fails halfway with no record of where it stopped.
   *
   * ONLY populated from a whole read. Under any other status this is not an
   * empty set, it is an unknown one, and passing [] would tell the importer
   * that nobody has been invited — which is the collapse src/ui/loadStatus.ts
   * exists to prevent, arriving as a half-failed import instead of as a wrong
   * figure. The import is blocked in that case rather than run on a guess.
   */
  const openInviteEmails = useMemo(
    () => (inviteStatus === 'ready'
      ? sentInvites.filter((i) => i.status === 'pending').map((i) => i.email)
      : []),
    [inviteStatus, sentInvites],
  );
  const { received: trainerInvites, acceptTrainerInvite, declineTrainerInvite, reload: reloadTrainerInvites } = useTrainerInvites();
  const { tagsFor, allTags, addTag, removeTag, status: tagStatus, reload: reloadTags } = useClientTags();
  const { templates, reload: reloadTemplates } = useProgramTemplates();
  // `assignProgramTo` rather than `assignProgram`: this screen assigns to a
  // whole segment at once and has to report on each write by name, which needs
  // the sentence saying why one of them did not land.
  const { assignProgramTo, getProgram, status: programStatus, reload: reloadPrograms } = useAssignedPrograms();
  const [bulkTplOpen, setBulkTplOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Removing a whole segment is the one bulk action on this screen that cannot
  // be retried into a good state, so it gets its own busy flag rather than
  // sharing `bulkBusy` with the assign — a coach who taps Remove while an
  // assign is in flight must be refused by the control that is actually busy.
  const [endBusy, setEndBusy] = useState(false);
  // The segment composer. `msgBody` is the coach's own words and nothing else
  // ever writes to it — see the note on `openBulkMessage`.
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgBody, setMsgBody] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgFailed, setMsgFailed] = useState<string[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [seg, setSeg] = useState<string>('all');
  // ── finding one person ──────────────────────────────────────────────────
  //
  // The only thing on this screen shaped like search was the magnifying glass
  // in the header, and it pushes Explore — which searches TRAINER_NAV, the list
  // of SCREENS. A coach with eighty clients tapped it, typed a name, and was
  // told nothing matches about somebody sitting on their own roster. The chips
  // below filter by delivery, drift and tag; none of them is "the woman I am
  // training in ten minutes".
  //
  // It narrows what the segment already selected, so what the bulk controls act
  // on stays exactly what is listed under them — see `shownRoster`.
  const [rosterQ, setRosterQ] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  /**
   * Accept an invitation to a gym, and say which of the two things happened.
   *
   * The congratulation used to be unconditional. `acceptTrainerInvite` goes to
   * real trouble to make a refusal recoverable — src/ui/trainerInvites.tsx puts
   * the invitation BACK on this dashboard when the RPC did not attach — and the
   * boolean saying so was dropped on the floor. So a coach whose acceptance the
   * server refused was welcomed to a platform they are not on, pushed to set up
   * a profile for it, and then found the invitation sitting on the dashboard
   * again with nothing to explain it. That reads as the app having lost their
   * acceptance rather than never having had it, and joining a gym is the moment
   * a coach's roster, currency and payroll change hands.
   */
  const acceptJoin = async (id: string, ownerName: string | null) => {
    const joined = await acceptTrainerInvite(id);
    if (!joined) {
      Alert.alert('Not joined',
        `You have NOT been added to ${ownerName || 'that gym'} — the server did not accept it, so nothing has changed and none of your clients have moved. `
        + 'The invitation is back on this screen; try it again in a moment, or ask them to send a new one.');
      return;
    }
    Alert.alert('Welcome to the platform', 'You have joined ' + (ownerName || 'the platform') + ' as a trainer. Let us set up your profile.', [{ text: 'Set up profile', onPress: () => router.push('/(trainer)/profile') }, { text: 'Later' }]);
  };
  /**
   * Withdraw an invitation, and only say it is withdrawn when it is.
   *
   * The row used to be filtered off this list on the tap and the result thrown
   * away. An invitation is a live link into the coach's book: cancel one sent to
   * the wrong address, watch it disappear, and that address can still join them
   * — with no second place in the app to check, because the list the row was in
   * is the list that was just filtered.
   */
  const cancelInvite = async (id: string, email: string) => {
    if (await revokeInvite(id)) return;
    Alert.alert('Not cancelled',
      `${email} can still use that invitation to join you — the server did not confirm the cancellation, so it is still live and the row is still here. `
      + 'Try again in a moment.');
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

  // ── bringing a whole book across ─────────────────────────────────────────
  //
  // Adding a client is a name, a goal, a delivery mode, a modal and a round
  // trip. A coach arriving from another product with forty clients does that
  // forty times, and most of them do not — which makes this the largest
  // switching cost in the product.
  //
  // Preview then confirm, which is the shape the Studio console's own invite
  // flow settled on and the shape src/lib/csvImport.ts is built for: it is
  // ALWAYS a dry run, the coach sees exactly what will happen and to whom, and
  // only then does anything reach the database. Nothing here reimplements the
  // reading or the screening — `previewCoachRoster` and `screenInvites` are the
  // same functions the console uses.
  const [impOpen, setImpOpen] = useState(false);
  const [impFile, setImpFile] = useState<string | null>(null);
  const [impPreview, setImpPreview] = useState<ImportPreview<CoachClientRow> | null>(null);
  const [impPlan, setImpPlan] = useState<RosterPlan | null>(null);
  const [impErr, setImpErr] = useState<string | null>(null);
  const [impBusy, setImpBusy] = useState(false);
  const [impResult, setImpResult] = useState<RosterResult | null>(null);

  const resetImport = () => {
    setImpFile(null); setImpPreview(null); setImpPlan(null);
    setImpErr(null); setImpResult(null);
  };

  const chooseRosterFile = async () => {
    setImpErr(null);
    // Both CSV spellings plus the catch-all, because a file exported from a
    // spreadsheet on a Mac often arrives as public.comma-separated-values-text
    // and one exported from a mail client as text/plain. Refusing on the type
    // would refuse a perfectly good file.
    const picked = await pickDocument({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'] });
    // 'cancelled' and 'unavailable' are opposite facts about the same silent
    // screen, and folding them shows nothing either way — see the note on
    // `DocumentPick`. A coach on a build with no picker taps again forever.
    if (picked.outcome === 'cancelled') return;
    if (picked.outcome === 'unavailable') { setImpErr(DOCUMENT_PICKER_UNAVAILABLE_NOTE); return; }
    if (picked.outcome === 'error') { setImpErr('That file could not be opened. Try choosing it again, or export it as CSV first.'); return; }
    const b64 = await readFileBase64(picked.file.uri);
    if (b64 == null) { setImpErr(FILE_READ_UNAVAILABLE_NOTE); return; }
    // Decoded rather than read byte-per-character. A spreadsheet exported
    // anywhere in Europe has accented names in its first column, and the naive
    // read puts "ZoÃ«" on somebody's roster permanently.
    const text = base64ToUtf8(b64);
    if (text == null) { setImpErr('That file could not be read as text. Export it as CSV and try again — nothing has been imported.'); return; }
    const pv = previewCoachRoster(text);
    // A read that has not come back is not "nobody has been invited". Refused
    // here rather than run on the guess: the alternative is re-inviting
    // everybody who already has an open invite, which part 37's partial unique
    // index refuses one row at a time, halfway through the batch.
    if (inviteStatus !== 'ready') {
      setImpFile(picked.file.name || 'your file');
      setImpPreview(pv);
      setImpPlan(null);
      setImpErr('Your existing invites could not be read, so this cannot tell who you have already invited. That is a read that failed rather than a coach who has invited nobody — reopen this screen and try again. Nothing has been imported.');
      return;
    }
    const screened = screenInvites<CoachClientRow>(pv.ready, openInviteEmails);
    const plan = rosterPlan(pv, screened);
    setImpFile(picked.file.name || 'your file');
    setImpPreview(pv);
    setImpPlan(plan);
    setImpResult(null);
    setImpErr(planBlocker(pv, plan));
  };

  const runImport = async () => {
    if (!impPlan || impBusy) return;
    setImpBusy(true);
    const invited = new Set(impPlan.invite.map((r) => r.email));
    const rows: { name: string; outcome: RowOutcome }[] = [];
    // One round trip per row, in order, and the ORDER is what makes the report
    // usable: these are N separate writes and not one transaction, so a
    // connection that drops at row twelve leaves twelve clients across and
    // twenty-eight nowhere. Naming which is what lets a coach re-import the
    // remainder rather than the lot — and re-importing the lot is how somebody
    // ends up with every client twice.
    for (const r of impPlan.create) {
      const added = await addClient(r.name, r.goal ?? '', r.mode);
      if (!added) { rows.push({ name: r.name, outcome: 'failed' }); continue; }
      if (!r.email || !invited.has(r.email)) { rows.push({ name: r.name, outcome: 'added-not-invited' }); continue; }
      // Read, not fired. `sendInvite` resolves false on a refused write, and a
      // client on the roster with no invite recorded will never link when they
      // sign up — with nothing anywhere telling either side.
      const ok = await sendInvite(r.email, r.mode);
      rows.push({ name: r.name, outcome: ok ? 'added' : 'added-invite-failed' });
    }
    setImpBusy(false);
    setImpResult({ rows });
  };
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
    // The wrapper reports whether the copy actually landed rather than throwing
    // on a build with no clipboard at all. The button is not offered on such a
    // build (see JoinLinkFallback below), so this is the second lock on the same
    // door — and a coach told "copied" who then pastes nothing has lost the post.
    if (!(await copyToClipboard(joinLink(code)))) {
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
  /**
   * Open the Invite sheet, with the coach's code and their named codes loaded.
   *
   * Lifted out of the "Invite a Client" button because it is now reached two
   * ways. The second is Getting Started: two of its steps — "Add Your First
   * Client" and "Name a Join Code" — are done in THIS sheet and nowhere else,
   * and both of them used to route to `/(trainer)/dashboard` with no
   * instruction about what to do once they arrived.
   *
   * That is the failure mode the card exists to avoid. A coach tapping "add
   * your first client" landed back on the Clients tab, looking at the same
   * card that had just sent them, with the control that completes the step
   * behind a button they were never told about. A checklist whose items lead
   * nowhere is worse than no checklist, because it teaches the reader to
   * ignore it — and then it is ignored on the row that mattered.
   */
  const openInvite = useCallback(async () => {
    setInvEmail(''); setInvMode('online'); setInvOpen(true);
    setMyCode(null); setMyCodeErr(null);
    const r = await fetchMyJoinCode();
    if (r.ok) setMyCode(r.code); else setMyCodeErr(r.reason);
    await loadCodes();
    // `loadCodes` is redeclared on every render and is not a dependency on
    // purpose: it reads no state, only writes it. Listing it would rebuild
    // this callback every render and re-fire the effect below on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── landing on the control, not merely on the screen ──────────────────
   *
   * `?start=invite`, set by src/lib/coachFirstRun.ts on the two steps that
   * are completed in the sheet above. Consumed once and cleared, so returning
   * to this tab later does not reopen a sheet the coach has already closed —
   * a tab keeps its params, and without the clear the sheet would spring open
   * every time they came back to Clients for the rest of the session.
   *
   * Anything else in `start` is ignored rather than reported: a stale or
   * hand-edited link is not something to put an error in front of a coach
   * about, and the screen it names is the right screen either way. */
  const startParam = useLocalSearchParams<{ start?: string }>().start;
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    // Clearing the param clears the memory of having honoured it. Without
    // this the ref latched: "Add Your First Client" and "Name a Join Code"
    // both open the same sheet, so a coach who used the first one and came
    // back for the second was returned to the tab with nothing open — the
    // dead end this parameter exists to remove, arriving on the second tap
    // instead of the first.
    if (!startParam) { startedFor.current = null; return; }
    if (startedFor.current === startParam) return;
    startedFor.current = startParam;
    if (startParam === 'invite') void openInvite();
    router.setParams({ start: '' });
  }, [startParam, openInvite, router]);

  // The verdict on ranking, computed once for the sheet. enoughToTell refuses
  // outright under anything but a completed read, and refuses again when the
  // two busiest codes cannot be told apart from a coin toss.
  const codeTell = enoughToTell(returns.status, returns.rows);
  const saveSpend = async (row: CodeReturnRow) => {
    const key = row.id ?? '';
    // The currency travels WITH the figure, both here and to the server. It
    // used to be scaled by a flat hundred here while `set_code_spend` resolved
    // a currency of its own to stamp on the result, so on a yen account the
    // number was a hundred times the money AND the label agreed with it. What
    // the coach typed is now scaled in a currency somebody actually stated, and
    // that same currency is what gets stored.
    const parsed = parseSpend(spendDraft[key], spendCurrency(row));
    if (parsed.kind === 'bad') { Alert.alert('Not saved', parsed.reason); return; }
    setSpendBusy(key);
    // A cleared field sends null, which DELETES the record. Sending 0 would
    // tell Repple the campaign was free, and a free campaign has a perfect
    // return and wins every comparison on this screen.
    const r = await saveCodeSpend(
      row.id,
      parsed.kind === 'clear' ? null : parsed.cents,
      parsed.kind === 'clear' ? null : parsed.currency,
    );
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
  }, [coachId, authLoading, readNonce]);

  const unmarked = mySessions === null ? null : awaitingOutcome(mySessions).length;

  /* ── why they left: one read, and it does not live here any more ──────
   *
   * This screen used to run its OWN read of `coaching_relationships` — same
   * coach, same ninety days, no `end_reason` filter — purely to count the
   * reasons, alongside the card's read of the same table WITH the filter. Two
   * round trips to describe one book, and two sections describing it, which is
   * what put the same fact on the screen twice in two voices.
   *
   * `useDepartures` in src/ui/EndReasonSheet.tsx now reads every ending in the
   * window once and the card does both jobs off it: the people still worth
   * asking, and the answers already given. `readNonce` is threaded in so a pull
   * down this screen re-reads it with everything else.
   */
  // ── Nothing prompted the coach to clear this ────────────────────────────
  //
  // The queue exists on app/(trainer)/sessions.tsx and the card above counts
  // it, and both of those require a coach to open the app. Until the queue is
  // cleared the statement, the payroll figure and the analytics revenue line
  // are all short by exactly those sessions, and `settlementBlocker` refuses to
  // settle a period containing them — so the backlog is not untidiness, it is
  // somebody's pay held up.
  //
  // `unmarked` is NULL when the read did not answer, and null never prompts.
  // `bookAlert` enforces that for every figure it is given, and this is the
  // caller that could get it wrong by coercing: a banner about a coach's own
  // business built out of a failed query is how somebody learns to ignore the
  // next one. Weekly, not daily — clearing any of this is a sit-down job.
  //
  // ── the other three things about a coach's own book ──────────────────────
  //
  // The unmarked queue used to be the only one of these the app would tell a
  // coach about without being opened. An invoice ageing past its due date and a
  // client who has stopped training were computed already, on screens somebody
  // had to go and look at, and there is no trigger to hang either on — nothing
  // about a coach's own book has another person's action behind it. So this
  // phone works them out. See `bookAlert` in src/lib/coachNotify.ts for the
  // order and why there is only ever one banner.
  /**
   * The coach's own unpaid book, read once for the banner.
   *
   * One call, and the same one app/(trainer)/client.tsx and the Invoices screen
   * make. `{ rows: [], status: 'loading' }` until it lands, and 'error' is what
   * makes `bookState` pass null rather than nought — an empty list from a read
   * that did not answer is not a coach nobody owes money to.
   */
  /** The coach's answer for the `book` channel. Read here because this is where
   *  the banner is fired from, and a preference applied anywhere else would be
   *  a switch that governs nothing. */
  const channels = useChannelPrefs();
  const [invoices, setInvoices] = useState<{ rows: CoachInvoice[]; status: LoadStatus }>({ rows: [], status: 'loading' });
  useEffect(() => {
    if (!coachId || authLoading) return;
    let live = true;
    (async () => {
      const inv = await fetchMyInvoices();
      if (live) setInvoices(inv);
    })();
    return () => { live = false; };
  }, [coachId, authLoading, readNonce]);
  /**
   * The book, aged against TODAY — and today is a value that moves.
   *
   * This was `localDayKey(Date.now())` inside a memo keyed on `[invoices]`, so
   * the day was fixed at whatever it was when the invoices last landed and no
   * dependency could ever change it. This screen is a TAB: app/(trainer)/
   * _layout.tsx mounts it once and backgrounding a phone does not tear it down,
   * so a coach who opened the app on Sunday and came back on Wednesday had
   * every due date judged against Sunday — and `promptBookAlerts` below fired
   * off that stale copy. app/(trainer)/invoices.tsx already passes `useToday()`
   * to this same call; the two screens could disagree about which invoices were
   * overdue, which is exactly the defect src/ui/today.ts was written for.
   */
  const invoiceAgeing = useMemo(
    () => ageingBook(invoices.rows, invoices.status, today),
    [invoices, today],
  );
  /** What the card below may say about all that — src/lib/homeMoney.ts. The
   *  whole ageing book was computed here already and nothing drew a pixel of
   *  it. */
  const owed = useMemo(() => homeMoney(invoiceAgeing, invoices.status), [invoiceAgeing, invoices.status]);
  const bookState = useMemo(() => ({
    unmarkedSessions: sessionsUnread ? null : unmarked,
    // Null under anything but a whole read: `ageingBook` withholds its own
    // outstanding figure on the same test, and a count over a page of somebody's
    // book is a wrong number rather than a small one.
    invoicesOverdue: invoices.status === 'ready' ? invoiceAgeing.overdue.length : null,
    // Only from a read that can actually support a verdict about who has
    // stopped. `driftActionable` is per client for the suggested check-ins; this
    // is the same question asked of the whole book, and a truncated read
    // disqualifies all of it — see src/lib/clientDrift.ts.
    clientsDrifting: bands && driftRead && !driftRead.truncated && !driftRead.notAsked.size
      ? bands.drifting : null,
    // Nothing coach-wide reads pack balances yet, so this is honestly unknown
    // rather than nought. `bookAlert` declares it so the day a screen does read
    // them, nobody has to reopen the decision about where it ranks.
    packsRunningOut: null,
  }), [sessionsUnread, unmarked, invoiceAgeing, invoices.status, bands, driftRead]);
  useEffect(() => {
    // Defaults to allowed while the preference read has not landed, matching
    // what supabase/functions/send-push does with the same table: a transient
    // fault must not silently swallow the only thing that tells a coach their
    // own money is sitting still.
    const allowed = channels.status === 'ready' ? channelAllows('book', channels.muted) : true;
    void promptBookAlerts(bookState, allowed);
  }, [bookState, channels.status, channels.muted]);
  /** Sessions actually delivered in the last month — a count of recorded
   *  outcomes, not an inference from the clock. Null until the read lands. */
  const delivered = mySessions === null
    ? null
    : deliveredBetween(mySessions, Date.now() - DELIVERED_WINDOW_DAYS * 86_400_000);
  // One unknown count makes the TOTAL unknown. Summing the nulls as zero would
  // quietly report fewer waiting messages than there are, on the tile a coach
  // reads to decide whether anybody needs them.
  //
  // And the roster's OWN status has to come first, for the reason `rosterCount`
  // above already gives. `roster.some(...)` and `roster.reduce(...)` over an
  // empty array are false and 0 respectively, and the roster is empty for the
  // whole of every normal load and permanently under 'error' — so this tile
  // printed a confident "Unread 0" while the Hero directly above it said the
  // roster could not be read. A coach reads that tile to decide whether anybody
  // is waiting on them, and closes the app.
  //
  // ── and the test is over the rows that CAN carry a count ────────────────
  //
  // `roster.some((c) => c.unread == null)` was true forever for any coach with
  // one hand-added client, and it is not a read failing. `coach_unread_counts()`
  // enumerates `clients` — a manually-added `coach_clients` row is a name the
  // coach typed with no account behind it, so it is in no thread, has never
  // been counted, and can NEVER have an unread figure. Nothing about that
  // changes with a retry.
  //
  // So one cash client nulled this tile permanently: "Unread —" for the life of
  // the account, while the Unanswered chip below it happily listed the three
  // people actually waiting. The unknown is real for the LINKED rows and only
  // for them; a hand-added row is not an unknown count, it is the absence of a
  // thread, and summing them as nought is the truthful reading rather than the
  // convenient one. `handAdded` is marked in src/ui/roster.tsx at the only
  // place that knows which table the row came from — `coach_clients.id` is a
  // real uuid, so nothing downstream can work it out from the id.
  const threaded = roster.filter((c) => c.handAdded !== true);
  const unread = isWhole(rosterStatus)
    ? (threaded.some((c) => c.unread == null) ? null : threaded.reduce((a, c) => a + (c.unread ?? 0), 0))
    : null;
  /** Clients whose own adherence figure is below target — the one signal on a
   *  roster row that is evidence ABOUT the person rather than the absence of it.
   *
   *  This was `roster.filter(atRiskClient)`, kept "only for the render where
   *  the drift read has not landed". Two of that function's three clauses are
   *  not evidence: `staleDays` regexes a number out of the display string
   *  `ago()` writes for a human to read, and `noRecordOf` is true whenever
   *  there is no figure and no date — which is true, permanently, of every
   *  client a coach added by hand (`adherence: null, lastActive: 'added by
   *  you'`, src/ui/roster.tsx). Those two clauses are now gone from this file
   *  and from the app; what is left is the figure the client submitted. */
  const lowAdherence = (c: RosterClient): boolean => c.adherence != null && c.adherence < 80;
  const belowTarget = roster.filter(lowAdherence).length;
  /** Drifting plus unknown — the number a coach actually has to act on. Null
   *  until the record has been read, so it renders as an em-dash rather than as
   *  zero.
   *
   *  `bands` alone is not enough, and the path that proves it is the one that
   *  matters most: under `rosterStatus === 'error'` the roster is empty, so
   *  `rosterKey` is '' and the drift effect takes its `if (!ids.length)` branch
   *  and calls `setDrift({})` — a REAL, EMPTY answer about a roster we never
   *  read. `summariseDrift([])` then returns all zeros and this tile said "To
   *  Contact 0" under a Hero saying the roster could not be read. Nobody needs
   *  you, computed from a list we do not have. The same holds for the whole of
   *  a normal load, when the roster is empty for a different reason. */
  const toContact = isWhole(rosterStatus) && bands ? bands.drifting + bands.unknown : null;
  const driftNote = (): string => {
    if (driftErr) return 'Could not work out who is drifting.';
    if (!bands) return 'Working out who is drifting…';
    const parts: string[] = [];
    if (bands.drifting) parts.push(`${bands.drifting} drifting`);
    if (bands.unknown) parts.push(`${bands.unknown} with nothing recorded`);
    if (!parts.length && bands.watch) parts.push(`${bands.watch} slipping`);
    return parts.length ? parts.join(' · ') : 'Everyone is holding their own pattern.';
  };
  /** Every segment count is a count OF THE ROSTER, so none of them may be
   *  quoted unless the roster read was whole — `n: null` renders as a dash.
   *
   *  The chips were the same "0" as the KPI tiles, in a place that reads even
   *  more like a fact: "All 0" sits above a list, so it is not a figure a coach
   *  has to interpret, it is a caption for what they are looking at. Under
   *  'error' it captioned a list that failed to load, and under 'partial' it
   *  captioned a fragment as the whole book. The segment still SELECTS in both
   *  cases — filtering what did load is honest — it just cannot say how many.  */
  const segN = (n: number): number | null => (isWhole(rosterStatus) ? n : null);
  const AUTO_SEGS = [
    { key: 'all', label: 'All', n: segN(roster.length) },
    // The drift segments replace the old At-risk chip rather than sitting
    // beside it: two rules for "who needs attention" on one screen is how the
    // product ended up with two status scales in the first place. Before the
    // read lands there is no honest count, so the old chip stands in.
    ...(bands
      ? [{ key: 'drifting', label: 'Drifting', n: segN(bands.drifting) },
         { key: 'nodata', label: 'Nothing Recorded', n: segN(bands.unknown) }]
      : [{ key: 'below', label: 'Below Target', n: segN(belowTarget) }]),
    // ── who is waiting on a reply ─────────────────────────────────────────
    // R6. This row already draws "3 unread" on it and the segment list could
    // not filter to it, so a coach with forty clients had recency-only ordering
    // on the messages screen and no queue anywhere — which is the exact defect
    // messages.tsx's own header says it was built to close at twenty.
    //
    // The count has a stricter guard than `segN` alone. A roster whose read was
    // whole can still carry rows whose `unread` is null, and one of those is a
    // client who might be waiting; counting them as nought would put a caption
    // saying "Unanswered 0" over a list that is missing them. `null` renders as
    // a dash and the chip still selects, which is the same bargain every other
    // chip on this row makes.
    //
    // Over `threaded` for the reason spelled out on the Unread tile above: a
    // hand-added row can never carry an unread count, because
    // `coach_unread_counts()` enumerates `clients` and there is no account and
    // no thread behind one. Testing it here dashed this chip permanently for
    // any coach with a single cash client — while the chip itself still
    // selected and listed the three people genuinely waiting, so the caption
    // said "unknown" over a list the screen could plainly count.
    { key: 'unanswered', label: 'Unanswered',
      n: threaded.some((c) => c.unread == null) ? null : segN(threaded.filter((c) => (c.unread ?? 0) > 0).length) },
    // One segment per delivery, built from the vocabulary rather than listed by
    // hand — a book with no hybrid clients simply shows a zero, the same as the
    // other two, instead of quietly filing them under Online.
    ...COACHED_MODES.map((m) => ({ key: m, label: COACHED_MODE_SHORT[m], n: segN(roster.filter((c) => c.mode === m).length) })),
  ];
  const matchSeg = (c: RosterClient) =>
    seg === 'all' ? true
    : seg === 'drifting' ? driftFor(c)?.status === 'at_risk'
    : seg === 'nodata' ? driftFor(c)?.status === 'idle'
    : seg === 'below' ? lowAdherence(c)
    // A row whose unread count could not be read is NOT in this list. The
    // segment is a queue a coach works through, and a client who may or may not
    // have written is not something to answer — the chip's own dash says the
    // figure is unknown, and putting an unknown row in the queue would make the
    // list disagree with the caption above it.
    : seg === 'unanswered' ? (c.unread ?? 0) > 0
    : (COACHED_MODES as readonly string[]).includes(seg) ? c.mode === seg
    : tagsFor(c.id).includes(seg);
  // A drift segment cannot be honoured once the read is gone; fall back to the
  // whole book rather than showing an empty list that reads as "none of these".
  const segLive = !(!bands && (seg === 'drifting' || seg === 'nodata'));
  const segRoster = segLive ? roster.filter(matchSeg) : roster;
  // What is on screen, and therefore what every control under the list acts on.
  //
  // The search narrows the segment rather than sitting beside it. The
  // alternative — filtering only the rows and leaving the bulk buttons on the
  // segment — puts "Remove 12 From Your Roster" under three visible names,
  // which is the worst version of a control this file already takes care to
  // print a count on. One list, one count, one set of recipients.
  const shownRoster = searchRoster(segRoster, rosterQ);
  /** The sentence a search over an incomplete read owes the coach, or null.
   *  Only a whole read may say a person is not on the book. */
  const rosterQLine = rosterSearchLine({
    status: rosterStatus, query: rosterQ, matched: shownRoster.length, searched: segRoster.length,
  });
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
  //
  // The push that used to follow this insert has gone. The row's own AFTER
  // INSERT trigger already posts to supabase/functions/notify-message, which
  // writes the inbox row and sends a push to the same person, with the same
  // body, to the same route — so a nudge buzzed the client's phone twice, in
  // two wordings, seconds apart. src/lib/notifyInbox.ts had already stopped the
  // duplicate ROW for exactly this send ("part 26's trigger records that"); the
  // duplicate PUSH went on happening, which is the shape supabase/parts/2392
  // describes. See the long note in src/ui/messaging.ts's `send`.
  const deliverMessage = async (client: RosterClient, body: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { error } = await supabase.from('messages').insert({ client_id: client.id, sender: 'coach', body });
      if (error) return { ok: false, error: error.message };
    } catch (e: any) { return { ok: false, error: e?.message || 'Could not reach the server.' }; }
    return { ok: true };
  };
  const sendNudge = async (client: RosterClient) => {
    const body = 'Hey ' + client.name.split(' ')[0] + ' — checking in! How is your week going? Let me know if you need anything.';
    const r = await deliverMessage(client, body);
    Alert.alert(r.ok ? 'Nudge sent' : 'Not sent',
      r.ok ? 'Saved to your thread with ' + client.name.split(' ')[0] + '. They will see it next time they open Repple.'
           : 'Could not send to ' + client.name.split(' ')[0] + ': ' + (r.error || 'unknown error') + '. Clients you added by hand cannot receive messages until they join.');
  };
  // Who needs proactive attention, and why — drives the suggested check-ins.
  const attnReason = (c: RosterClient): string | null => {
    const d = driftFor(c);
    // Drift speaks first where it can, because it is the only signal that sees
    // a client with no record at all — but only where the read behind it can
    // actually support a verdict about this person. A truncated read and a
    // client the database was never asked about both produce a confident
    // "nothing recorded in 56 days" out of rows that were never seen.
    const acting = driftActionable(c);
    if (acting && d && (d.status === 'at_risk' || d.status === 'idle')) return d.reason;
    // Where the record cannot be acted on, the fallback is the ONE clause that
    // is evidence about this person — a low adherence figure they submitted.
    //
    // It used to be `atRiskClient(c)`, whose other two clauses are
    // `staleDays(c.lastActive) >= 2` — a regex over the display string `ago()`
    // writes for a human to read — and `noRecordOf(c)`, which is true when
    // there is no figure and no date at all. Every client a coach added BY HAND
    // is built with `adherence: null, lastActive: 'added by you'`
    // (src/ui/roster.tsx), so every one of them matched `noRecordOf`
    // permanently and came back here as "Inactive added by you — check in".
    //
    // A coach with twenty cash clients had twenty entries in this list that
    // could never clear, whatever they did about any of them, and learns inside
    // a week to read past all of them — including the one that is real. The
    // absence of a record is not a reason to ring somebody; it is the reason
    // `idle` exists in src/lib/clientDrift.ts, and that band is raised here
    // only when the read behind it actually covered them.
    if ((!d || !acting) && c.adherence != null && c.adherence < 80) return 'Adherence ' + c.adherence + '% — below target';
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
  // ── the client's name used to go to a model, and now does not ──────────
  //
  // This posted `{ name, goal, adherence, reason }` through the unfiltered
  // `askCoach`, so a named person's adherence reached api.anthropic.com every
  // time a coach tapped Draft. The member answered a consent question about
  // their own AI Coach chat, on their own phone; it has never governed this
  // path, and nobody on this screen can answer it for them.
  //
  // `askAboutClient` filters by allowlist (src/lib/coachShare.ts) and the name
  // is not in it. The model writes `{name}` and `fillName` puts the first name
  // back before the coach reads the draft — which is where it was always going
  // to end up, and it never had to leave the phone to get there.
  const draftNudge = async (client: RosterClient) => {
    setDraftClient(client); setDraftText(''); setDraftBusy(true);
    const reason = attnReason(client) || 'general check-in';
    const ctx = {
      goal: client.goal,
      adherence: client.adherence != null ? client.adherence + '%' : 'no check-ins yet',
      lastActive: client.lastActive,
      coachedMode: client.mode,
      // Areas and severity, never the note. The note is seeded from the line
      // off an uploaded medical document (src/lib/injuryExtract.ts) and
      // src/ui/injuryDocs.ts states the rule it would break.
      injuryAreas: sharedAreas(client.injuries ?? []) || 'none disclosed',
      reason,
    };
    const answer = await askAboutClient([{ role: 'user', content: 'Draft a short, warm, personalised check-in message (2-3 sentences) I can send to this client as their coach. Reason for reaching out: ' + reason + '. Encourage them, reference their goal, and invite a reply. Address them as {name} — write that literally, it is filled in afterwards. Write only the message, no preamble.' }], ctx);
    setDraftBusy(false);
    setDraftText(answer.ok
      ? fillName(answer.reply, client.name)
      : ('Hey ' + client.name.split(' ')[0] + ' — checking in on how your week is going. You are working toward ' + client.goal.toLowerCase() + ', and I am here to help. What can I do to make this week easier?'));
  };
  const sendDraft = async () => {
    const client = draftClient; const body = draftText.trim();
    if (!client || !body) return;
    const r = await deliverMessage(client, body);
    if (!r.ok) { Alert.alert('Not sent', 'Could not send to ' + client.name.split(' ')[0] + ': ' + (r.error || 'unknown error') + '. Your draft is still here.'); return; }
    setDraftClient(null); setDraftText('');
    Alert.alert('Sent', 'Saved to your thread with ' + client.name.split(' ')[0] + '.');
  };
  /* ── acting on a whole segment at once ─────────────────────────────────
   *
   * The two controls above the roster used to be the least careful writes in
   * the coach app, and both of them acted on everybody in the segment.
   *
   * MESSAGE. It composed the words itself — "Hey Ana — checking in! How is
   * your week going?" — and inserted them into every thread as `sender:
   * 'coach'`. That is a message under somebody else's name, at scale, which is
   * the one thing this codebase refuses outright: `messages.sender` once came
   * from the caller's own request so a client could post into their own thread
   * as their coach, it was removed, and src/lib/nudge.ts and
   * supabase/parts/140 are both written around never putting it back. The
   * Quiet Clients feature drafts and will not send for exactly this reason,
   * and it would be strange to hold that line there and break it here on a
   * button that reaches thirty people instead of one. It is a composer now:
   * the coach's own words, or nothing goes out.
   *
   * ASSIGN. It fanned a template over the segment with no confirmation, no
   * overwrite guard and no injury gate — so the fastest way in this app to
   * replace thirty training programmes without seeing one of them was to pick
   * a segment here rather than open the template library, which withholds the
   * same control until `assigned_programs` has been read whole. Both guards
   * are consulted now, and the write is preceded by a sentence saying how many
   * of them are on something and who.
   *
   * Both report per client and leave the failures where the coach can reach
   * them. See src/lib/bulkActions.ts.
   */

  /** How the read that DEFINES the current segment went.
   *
   *  The roster read is asked separately (`rosterStatus`); this is about the
   *  second read each segment needs. They are genuinely different: 'All' and
   *  the delivery segments are decided by a column on the roster row itself and
   *  so need nothing more, the drift segments are decided by a read of
   *  check-ins, workouts, sessions and visits that has its own three states,
   *  and a tag segment is decided by `client_tags` — where a failed read makes
   *  every `tagsFor()` come back empty, so a chosen tag matches nobody and
   *  renders identically to a tag that genuinely has nobody in it. */
  const segStatus: LoadStatus =
    seg === 'drifting' || seg === 'nodata'
      ? (driftErr ? 'error' : drift ? 'ready' : 'loading')
      : seg === 'all' || seg === 'below' || (COACHED_MODES as readonly string[]).includes(seg)
        ? 'ready'
        : tagStatus;
  // Reads as the object of a sentence, because it is one: the guard writes
  // "Only part of … came back", and "all of your clients" turns that into
  // "part of all of your clients".
  //
  // The search is part of that object when there is one. "Only part of your
  // client list came back" is a different claim from "only part of your client
  // list, narrowed to the names matching “sar”, came back", and the second is
  // what the coach is looking at.
  const segLabel = (seg === 'all'
    ? 'your client list'
    : `the “${AUTO_SEGS.find((x) => x.key === seg)?.label ?? seg}” segment`)
    + (rosterQ.trim() ? `, narrowed to the names matching “${rosterQ.trim()}”` : '');
  /** Whether "everybody in this segment" is a thing this screen may act on.
   *  Refuses rather than warns, for the reason guardOverwrite does: a banner
   *  does not stop a thumb, and neither a message nor an assign can be undone. */
  const segClaim = guardRecipients(rosterStatus, segStatus, segLabel);
  const nameOf = (id: string) => roster.find((c) => c.id === id)?.name.split(' ')[0] ?? 'A client';

  const openBulkMessage = () => {
    if (!shownRoster.length) return;
    if (!segClaim.allowed) { Alert.alert(segClaim.label as string, segClaim.reason as string); return; }
    setMsgBody(''); setMsgFailed([]); setMsgOpen(true);
  };
  /**
   * Send the coach's typed message into each recipient's own thread.
   *
   * `ids` is passed in so a retry goes to exactly the threads that failed and
   * not to the segment again — re-sending to the people it already reached
   * would put the same words in their thread twice, which reads from their side
   * as their coach repeating themselves.
   */
  const deliverBulk = async (ids: string[]) => {
    const b = msgBody.trim();
    if (!b || !ids.length || msgBusy) return;
    if (!segClaim.allowed) { Alert.alert(segClaim.label as string, segClaim.reason as string); return; }
    setMsgBusy(true);
    try {
      const results = await sendCoachMessages(ids, b);
      const outcomes: WriteOutcome[] = results.map((r) => ({
        clientId: r.clientId, name: nameOf(r.clientId), ok: r.ok, why: r.why,
      }));
      const report = bulkReport('message', outcomes);
      setMsgFailed(report.retry);
      // The composer keeps the words while anything is still unsent. Retyping
      // them is how the second attempt ends up worded differently from the
      // first, in the threads of the people who got both.
      if (!report.retry.length) { setMsgBody(''); setMsgOpen(false); }
      Alert.alert(report.title, report.body);
    } catch {
      Alert.alert('Not Sent', 'The message could not be written to your clients’ threads. Nothing was sent — check your connection and try again.');
    } finally { setMsgBusy(false); }
  };

  /** One assign here is as many overwrites as there are people in the segment,
   *  so it waits until the programmes it would replace have actually been read.
   *  `getProgram` returns null both for a client on nothing and for a client
   *  whose row did not come back, and this screen had no way to tell. */
  const bulkGuard = guardOverwrite(programStatus, 'the programmes these clients are currently on');
  const bulkAssign = async (tpl: ProgramTemplate) => {
    if (bulkBusy) return;
    if (!segClaim.allowed) { Alert.alert(segClaim.label as string, segClaim.reason as string); return; }
    if (!bulkGuard.allowed) { Alert.alert(bulkGuard.label as string, bulkGuard.reason as string); return; }
    const list = shownRoster;
    if (!list.length) return;
    const targets: AssignTarget[] = list.map((c) => ({
      clientId: c.id, name: c.name.split(' ')[0], onProgramme: !!getProgram(c.id),
    }));
    const brief = overwriteBrief(targets, tpl.name);
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(brief.title, brief.body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: brief.confirmLabel, style: brief.replacing.length ? 'destructive' : 'default', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;
    setBulkBusy(true);
    const outcomes: WriteOutcome[] = await Promise.all(targets.map(async (tg) => {
      const r = await assignProgramTo(tg.clientId, tpl.program);
      return { clientId: tg.clientId, name: tg.name, ok: r.ok, why: r.why };
    }));
    setBulkBusy(false);
    const report = bulkReport('assign', outcomes);
    // The sheet closes only when there is nothing left to do. The failures are
    // named in the report and the segment is unchanged behind it, so tapping
    // the same template again retries exactly the people who need it.
    if (!report.retry.length) setBulkTplOpen(false);
    Alert.alert(report.title, report.body);
  };

  /* ── ending the coaching for a whole segment ───────────────────────────
   *
   * The most destructive control in the coach app, and the reason it exists is
   * the ordinary one: a coach cleaning up a year of dormant rows taps through
   * forty confirmations one at a time and gives up at six, so forty people who
   * stopped training in March are still reading as clients in December — in the
   * roster count, in the analytics, in every segment and in every figure
   * computed over the book.
   *
   * Three things it does that the single-client path does not:
   *
   *   · it names the SIZE before anything happens. `endCoachingBrief` puts the
   *     count in the heading and on the button and writes out who, because a
   *     coach cannot tell from "40 clients" whether the one person they did not
   *     mean to include is in there.
   *   · it reports PER CLIENT. `removeClient` returns false both for a refused
   *     write and for a person neither table had anything to remove for, and
   *     the roster puts a refused row back — so a bulk run that half-landed
   *     leaves a roster that disagrees with any single sentence about it.
   *   · it never says "Done" over a partial failure. `bulkReport` has no such
   *     sentence, and the failures are named so the coach knows who is still on
   *     their book.
   *
   * No reason is recorded, deliberately — see the note on `endCoachingBrief`.
   * The Unexplained Departures card goes on asking about each of them
   * individually, which is the only way a reason stays attributable to one
   * person's actual departure.
   */
  const bulkEnd = async () => {
    if (endBusy) return;
    if (!segClaim.allowed) { Alert.alert(segClaim.label as string, segClaim.reason as string); return; }
    const list = shownRoster;
    if (!list.length) return;
    const targets: EndTarget[] = list.map((c) => ({
      clientId: c.id, name: c.name.split(' ')[0], handAdded: c.handAdded === true,
    }));
    const brief = endCoachingBrief(targets);
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(brief.title, brief.body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: brief.confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;
    setEndBusy(true);
    // Sequential, not `Promise.all`. Every one of these is a write against the
    // same roster provider, which removes optimistically and puts the row back
    // when the server refuses — forty of those interleaving produce a list that
    // is briefly whatever the last setState happened to hold. Forty round trips
    // is slower and it is the only version whose end state is the server's.
    const outcomes: WriteOutcome[] = [];
    for (const tg of targets) {
      const ok = await removeClient(tg.clientId);
      outcomes.push({
        clientId: tg.clientId,
        name: tg.name,
        ok,
        // `removeClient` returns a bare boolean and has two ways to reach
        // false — the server refused, or neither table had a row to remove.
        // It cannot say which, so this does not pretend to: the sentence names
        // both and says the roster is unchanged for them, which is the part the
        // coach acts on.
        why: ok ? null : 'nothing was removed — either the server refused it or there was no coaching relationship left to end. They are still on your roster.',
      });
    }
    setEndBusy(false);
    const report = bulkReport('end', outcomes);
    Alert.alert(report.title, report.body);
  };

  /* ── the roster, out of the app ────────────────────────────────────────
   *
   * The safe one of the three, and the one asked for most. Its single hazard is
   * the claim in its own name: a file called "your clients" that holds a
   * thousand of twelve hundred is not a smaller answer, it is a false one, and
   * the coach has no reason to think there were more. src/lib/rosterExport.ts
   * carries the honesty — INCOMPLETE in the filename, a sentence in cell A1 and
   * the same sentence in the share text — and refuses outright on a read that
   * failed, because a CSV with a header row and nothing under it is the most
   * convincing possible statement that a coach has no clients.
   */
  const exportRoster = async () => {
    if (exportBusy) return;
    const why = rosterExportBlocker(rosterStatus, roster.length);
    if (why) { Alert.alert('Nothing to Export', why); return; }
    setExportBusy(true);
    try {
      const rows: RosterExportRow[] = roster.map((c) => ({
        name: c.name,
        goal: c.goal,
        mode: c.mode,
        joinedAt: c.joinedAt ?? null,
        lastActive: c.lastActive,
        adherence: c.adherence,
        weightDeltaKg: c.weightDelta,
        unread: c.unread,
        // Areas only. What a client wrote about their own injury is theirs and
        // does not travel into a spreadsheet the coach may mail on.
        injuryAreas: (c.injuries ?? []).map((i) => areaLabel(i.area)),
        handAdded: c.handAdded === true,
      }));
      // The coach's own unit, and the coach's own calendar day — `new
      // Date().toISOString()` is UTC, which dates a file the day before for
      // anybody west of Greenwich.
      const file = buildRosterExport(rows, rosterStatus, coachUnit, localDayKey(Date.now()));
      const blocked = fileShareBlocker();
      const how = await shareTextFile(file.csv, file.filename, 'text/csv', 'Your clients');
      // Said after, because it is about what actually left the phone. A build
      // that cannot attach a file sends the rows as text, and the coach is
      // entitled to know which of the two they just sent somebody.
      if (how === 'text' && blocked) Alert.alert('Sent as Text', blocked);
      else if (!file.complete) Alert.alert('Exported, but Not Your Whole Book', file.warning as string);
    } catch (e) {
      reportError('dashboard.exportRoster', e);
      Alert.alert('Not Exported', 'The file could not be written. Try again once you have a little free space on your phone.');
    } finally { setExportBusy(false); }
  };
  // ── and the same for the weekly summary ────────────────────────────────
  //
  // This one was worse than the draft: alongside the name it posted
  // `composition` — visceral fat, InBody score, lean and fat mass, and a
  // left/right limb imbalance — and `recentMeals`, a list of what a named
  // person had eaten. That is a body-composition scan and a food diary about
  // somebody who was never asked.
  //
  // Both are gone rather than gated, and the reason is in coachShare.ts: the
  // only person entitled to answer is the member, their answer lives in their
  // own AsyncStorage, and this app cannot read it from the coach's handset. So
  // the summary is written from what the coach may honestly send about somebody
  // else — training, turning up, and which areas are flagged — and the prompt
  // says the composition is not available rather than letting the model infer
  // that there is none.
  const genSummary = async (client: RosterClient) => {
    setAiBusy(true); setAiSummary('');
    const ctx = {
      goal: client.goal,
      adherence: client.adherence != null ? client.adherence + '%' : 'no check-ins yet',
      lastActive: client.lastActive,
      coachedMode: client.mode,
      injuryAreas: sharedAreas(client.injuries ?? []) || 'none disclosed',
      // A COUNT, not the names. "Logged 9 meals this week" is the adherence
      // fact a summary needs; "chicken shawarma, protein shake" is a diary.
      mealsLoggedCount: clientMeals === null ? 'their food log could not be read — do not comment on their food logging' : clientMeals.length,
      programTitle: getProgram(client.id)?.title ?? 'no coach-assigned programme',
    };
    const answer = await askAboutClient([{ role: 'user', content: 'Write a concise 3-4 sentence weekly coaching summary for this client: what is going well, one concern to watch, and one focus for next week. You have their training and attendance only — you have NOT been given any body measurement, scan or weight, so do not refer to composition or comment on it. Refer to them as {name}, written literally. Do not suggest anything that loads a flagged injury area.' }], ctx);
    setAiBusy(false);
    setAiSummary(answer.ok
      ? fillName(answer.reply, client.name)
      : 'Could not generate a summary right now — the AI backend may be unavailable.');
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
  /** Two providers feed the timeline, so it knows as little as the less-read of
   *  them. Under 'partial' the events shown are real and there are more of
   *  them — which is fine for a list nobody counts. */
  const timelineStatus = worstStatus(notesStatus, fbStatus);

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * The coach's home screen, and almost nothing on it is written by the coach.
   * A client joins, trains, goes quiet, accepts an invitation, is added to a
   * gym; a Repple invoice falls overdue; a gym owner sends a coaching
   * invitation. Every one of those arrives from somewhere else, and this
   * screen had no gesture that went and looked.
   *
   * Fourteen sources. The screen already refuses to state a figure whose read
   * was short — `isWhole` gates them one by one — and the same reasoning
   * decides the shape of this: a refresh that moved some of them would leave
   * the roster count and the drift assessment describing different books, and
   * a coach reading "3 going quiet" out of 11 when it was measured against 9. */
  const reloadEverything = useCallback(() => {
    setReadNonce((n) => n + 1);
    return Promise.all([
      refreshRoster(), Promise.resolve(refreshTenant()), reloadProfile(),
      Promise.resolve(reloadFeedback()), Promise.resolve(reloadNutri()),
      Promise.resolve(reloadNotes()), Promise.resolve(reloadNotices()),
      Promise.resolve(reloadInvites()), Promise.resolve(reloadTrainerInvites()),
      Promise.resolve(reloadTags()), Promise.resolve(reloadTemplates()),
      Promise.resolve(reloadPrograms()), Promise.resolve(channels.reload()),
      // The trial too. It is a countdown: read once at mount on a tab that is
      // never unmounted, it is a figure from whenever the app was last cold
      // started, and a coach who leaves Repple open over a weekend was being
      // shown Friday's number on Monday.
      reloadTrial(),
    ]);
  }, [refreshRoster, refreshTenant, reloadProfile, reloadFeedback, reloadNutri, reloadNotes,
      reloadNotices, reloadInvites, reloadTrainerInvites, reloadTags, reloadTemplates,
      reloadPrograms, channels, reloadTrial]);
  const pull = usePullToRefresh(reloadEverything);

  /* ── and the same fourteen when the coach comes back ─────────────────────
   *
   * `readNonce` was bumped by the gesture above and by nothing else, and this
   * file had no `useFocusEffect` at all — so this screen read once, on mount,
   * for the life of the app. It is the coach's HOME tab: they leave it to do
   * the thing it told them to do and return to it immediately afterwards.
   *
   * Mark four sessions, come back, and "4 need an outcome" was still on the
   * card — so the coach marks them again. Log a session from the client screen,
   * come back, and What They've Actually Done had not heard of it. `promptBookAlerts`
   * then fires off that same stale state, which is the version of this that
   * reaches a client.
   *
   * This is the identical defect that stopped a coach accepting a coaching
   * request — `src/ui/CoachRequests.tsx` reading once on mount — and it is
   * fixed the same way. The first focus is skipped because the mount reads are
   * already running; see src/ui/refreshOnFocus.ts. */
  useRefreshOnFocus(reloadEverything);

  const studio = (coachName || 'Your Studio').replace('Coach ', '');
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Coaching</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5, textTransform: 'capitalize' }} numberOfLines={1}>{studio}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
            {/* Every SCREEN in the coach app, and it is the only way into
                Explore that does not disappear once Getting Started is done —
                so it stays pointed there. It reads as "search" to a screen
                reader and read as "search" to a coach looking for a person,
                which is what the field over the roster is now for; the spoken
                label says which of the two this is. */}
            <Ghost icon="search" a11yLabel="Search every screen" onPress={() => router.push('/(trainer)/explore')} />
            {/* A client booking a slot and a client cancelling one are the two
                events that change what a coach's day looks like, and until the
                inbox shipped they existed only as a push — on a build that
                cannot receive one. The row on Me is the way in for somebody
                looking for it; this is the way in for somebody glancing. */}
            <NotificationBell group="trainer" />
          </View>
        </View>

        {/* Clients who found this coach in the public directory and asked to
            be coached. Renders nothing at all when there are none.

            `readNonce` is threaded in so a pull down this screen re-reads the
            requests too. The component owns its own state, so without it the
            gesture refreshed everything around a pending request and not the
            request itself — and it re-reads on focus of its own accord, which
            is what a push arriving while the app is open needs. */}
        <CoachRequests reload={readNonce} />
        <UnmarkedSessions n={unmarked} failed={sessionsUnread} hasGym={!!tenant?.id} />
        {/* Below the unmarked queue and above everything else, which is
            `bookAlert`'s own order arriving on a screen: a session waiting on
            an outcome holds up somebody's pay, and money already earned and not
            collected is the next most expensive thing to leave alone. */}
        <MoneyOwed m={owed} />

        {/* What the band headings below actually mean. "At risk" is measured
            against each client's OWN earlier rate and not against a target, and
            "nothing to assess" is not "fine" — the two readings a coach gets
            wrong are the two that cost a phone call to somebody who trained
            yesterday. src/lib/screenHelp.ts holds the sentences; one row, shut,
            gone for good once dismissed. */}
        <ScreenHelp screen="coach-clients" />

        {/* The first-run list, while it still has something to say. It removes
            itself the moment every row is DONE — and not a moment earlier: a
            row that could not be read keeps it here, because the coach whose
            currency read failed is exactly the coach who needs the currency
            step. Once it goes, Explore and Settings still reach the screen.
            src/lib/coachFirstRun.ts holds the rule. */}
        <CoachSetupRow />

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {/* ── the trial card ───────────────────────────────────────────
              Two defects, and the second is the one a coach saw.

              ONE. The condition was `trial && !billingAvailable()`.
              `billingAvailable()` (src/lib/billing.ts) is true when at least
              one plan has a Stripe price id — i.e. when subscribing is
              actually possible — so the negation meant the card appeared ONLY
              on builds where checkout cannot be started, and vanished on the
              builds where it can. It is now two states rather than one
              condition: the trial is worth telling a coach about either way,
              and what changes is whether this card may promise them a way out
              of it. Where billing is not configured it does not offer a door
              that opens onto a wall.

              TWO. The figure came from `trialInfo()` — AsyncStorage on this
              handset, restarted by a reinstall, gating nothing, and read by
              no other screen. It was printed here as a flat fact while
              Billing said, of the same account, that the start date could not
              be read. `trialCard` in src/lib/trialGate.ts now decides, from
              the account's reading, whether there is a printable figure at
              all — and returns null when there is not, which is why there is
              no `unknown` branch here. The argument for silence over an
              apology is in that function's header; the short of it is that
              nothing is gated on the trial, so a card that cannot state a
              number has nothing to warn anybody about, and Billing carries
              all four states in full one tap away. */}
          {(() => {
            const card = trialCard(trialReading, billingAvailable());
            if (!card) return null;
            const body = (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <Icon name="sparkle" size={20} color={card.expired ? t.ink3 : t.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{card.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{card.note}</Text>
                </View>
                {billingAvailable() ? (
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Upgrade {FORWARD_CHAR}</Text>
                ) : null}
              </View>
            );
            return billingAvailable() ? (
              <Card onPress={() => router.push('/(trainer)/billing')} tone={card.expired ? t.crit : t.brand} style={{ marginBottom: sp.md }}>
                {body}
              </Card>
            ) : (
              <Card tone={card.expired ? t.crit : t.brand} style={{ marginBottom: sp.md }}>
                {body}
              </Card>
            );
          })()}

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

          {/* Why this list is shorter than it should be, or null when it is not.
              Shown whether or not there is anybody in it: an empty list of
              suggested check-ins over a read that could not prove anybody's
              silence is an all-clear made out of our own failure, and a coach
              cannot tell it from a book with nothing wrong in it. */}
          {driftActingNote && active > 0 ? (
            <View style={{ marginBottom: sp.md }}>
              <Notice tone={t.ink3} kicker="Suggested check-ins" title="These are not built on their training"
                note={driftActingNote} />
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
            // ── and each of the three now goes somewhere ────────────────
            //
            // `KpiRow` has taken an `onPress` and `KpiItem` a `route` since it
            // was written, and this row passed neither — so all three tiles
            // were inert. The Unread one is the reason that mattered: the
            // comment beside `unread` above says a coach "reads that tile to
            // decide whether anybody is waiting on them", and there was no
            // route to /(trainer)/messages ANYWHERE on this screen. The tile
            // that answers the question and the screen that acts on it were on
            // the same phone with nothing between them.
            //
            // A tile with no `route` stays disabled and keeps no button role,
            // so the row can be part live and stay honest to a screen reader.
            { label: 'Delivered', value: fig(delivered), unit: delivered == null ? undefined : `/${DELIVERED_WINDOW_DAYS}d`, route: '/(trainer)/sessions' },
            { label: 'Unread', value: fig(unread), route: '/(trainer)/messages' },
            // Null until the record has been read: an em-dash, never a zero
            // that would tell a coach nobody needs them this week. Still
            // tappable on a dash: a coach whose count could not be read is
            // exactly the one who should go and look.
            //
            // Quiet Clients, which is what `toContact` counts — drifting plus
            // nothing-recorded — and the same screen `bookAlert`'s drift banner
            // now opens, so the two agree about where this fact is dealt with.
            { label: 'To Contact', value: fig(toContact), route: '/(trainer)/nudges' },
          ]} onPress={(k) => { if (k.route) router.push(k.route as never); }} />
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

        {/* Why people have left, and the ones still worth asking about — one
            section off one read. src/ui/EndReasonSheet.tsx.

            ── why it is HERE and not at the top ────────────────────────────
            It sat between the first-run row and the block headed "interrupts:
            things that need a decision now", which split that block in two and
            put a ninety-day review above an expired trial and a platform
            invitation. Read as one screen rather than as a stack of cards, this
            is not a morning interrupt: nothing in it is holding up somebody's
            pay or somebody's reply today, and its own deadline is measured in
            months. It is a fact about the business, so it reads directly under
            the business — the count above says how many clients there are, and
            this says who stopped being one and why.

            Renders nothing when there are none and nothing when the read
            failed: this screen already carries four honest warnings and a fifth
            saying "we could not check whether anybody left" is noise.

            `readNonce` is threaded in so a pull down this screen re-reads it.
            The card owns its own state, so without it the gesture refreshed
            everything around this section and not the section itself — the same
            gap `CoachRequests` at the top of the screen had.

            ABOVE the `<Rule />` below and not under it, because the component
            draws its own leading rule. Under it there are two hairlines on a
            screen where this section renders and, on the far commoner screen
            where it renders nothing, none at all between This Month and
            Coaching Tools. */}
        <UnexplainedDepartures reload={readNonce} />

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
          {/* For a coach who works in the room, or one we do not know about,
              this is the list it has always been. For a coach who has said they
              work online and has nobody on the book training in person, the
              in-person tools drop below the rest with the reason on them —
              DE-EMPHASISED, never removed. `showsInPerson` resolves every
              unknown to "show everything", so a roster that failed to load or a
              question nobody answered hides nothing at all. */}
          <ChipGrid
            tone={t.brand}
            items={[
              ...(showsInPerson(delivery) ? SHORTCUTS : SHORTCUTS.filter((sc) => !IN_PERSON_SHORTCUTS.includes(sc)))
                .map(([ic, label, route]) => ({
                  icon: ic, label, key: route, onPress: () => router.push(route as any),
                })),
              // The door onto the notice composer, which had none. The sheet at
              // the bottom of this file — composer, push switch, "Posted
              // before" list — was complete and `bcOpen` was never set true
              // anywhere in the repo, so the only way to post a gym-wide notice
              // was unreachable while `reloadNotices` still paid for a read on
              // every pull-to-refresh. It is a chip rather than a SHORTCUTS row
              // because SHORTCUTS is a table of ROUTES and this is a modal on
              // this screen; giving the table an action arm to hold one entry
              // would make every other row carry a null.
              //
              // Beside Broadcast on purpose: those are the two all-client
              // tools, and a coach who wants one has usually just considered
              // the other. The sheet's own copy at the bottom of this file
              // draws the line — a NOTICE is posted once and read on every
              // client's dashboard; a MESSAGE lands in each person's thread.
              {
                icon: 'info' as IconName,
                label: 'Post a Notice',
                key: '/(trainer)/dashboard#post-a-notice',
                onPress: () => setBcOpen(true),
              },
            ]}
          />
          {!showsInPerson(delivery) ? (
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>In-person tools</Text>
              <ChipGrid
                tone={t.ink3}
                items={IN_PERSON_SHORTCUTS.map(([ic, label, route]) => ({
                  icon: ic, label, key: route, onPress: () => router.push(route as any),
                }))}
              />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {deliveryNote(delivery)} {HIDDEN_NOT_GONE}
              </Text>
            </View>
          ) : null}
        </Section>

        {/* ── pending invites ──────────────────────────────────────────────
            The section used to VANISH when the read failed, because `sent` is
            `[]` under 'error' and the only test was `length > 0`. So the coach
            re-invited people who already have a live invitation, and part 37's
            partial unique index refused it — a second failure with an even less
            useful explanation. This screen already refuses to trust this list
            twice over, for `openInviteEmails` and for the CSV import; this is
            the third place and it was the one a coach reads first. */}
        {inviteStatus === 'error' ? (<>
          <Rule />
          <Section>
            <SectionHead title="Pending Invites" />
            <Flag t={t} tone={t.warn}
              text={'Your open invitations could not be read, so none are listed. That is not a statement that '
                + 'nobody is waiting on you — anyone you have already invited still has a live invitation, and '
                + 'inviting them again will be refused.'} />
          </Section>
        </>) : sentInvites.filter((i) => i.status === 'pending').length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Pending Invites"
              note={inviteStatus === 'ready' ? `${sentInvites.filter((i) => i.status === 'pending').length} awaiting` : undefined} />
            {sentInvites.filter((i) => i.status === 'pending').map((i, idx) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: idx === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="message" size={16} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{i.email}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{COACHED_MODE_SHORT[i.mode]} · awaiting sign-up / accept</Text>
                </View>
                <Ghost label="Cancel" onPress={() => cancelInvite(i.id, i.email)} />
              </View>
            ))}
          </Section>
        </>) : null}

        <Rule />

        {/* ── the roster ─────────────────────────────────────────────────── */}
        <Section>
          {/* `isWhole(rosterStatus)`, not `active > 0`. `active` is
              `roster.length`, so under 'partial' this caption was drawn over a
              FRAGMENT of the book: "2 drifting" counted from part of it, or —
              worse — "Everyone is holding their own pattern", a flat all-clear
              about clients whose rows never came back. The Hero twenty lines
              above was fixed for exactly this and its comment says so; the
              section head kept the old gate. Every other consumer of `bands`
              on this screen already asks (`toContact`, `segN`,
              `bookState.clientsDrifting`). */}
          <SectionHead title="Your Clients"
            note={!isWhole(rosterStatus)
              ? undefined
              : active > 0 ? driftNote() : undefined} />

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
            <View style={{ flex: 1 }}><Ghost label="Invite a Client" onPress={() => { void openInvite(); }} /></View>
            {/* Import sits beside Add rather than under a menu, because the
                moment a coach needs it is their first hour in the product —
                and the alternative to finding it is typing forty clients. */}
            <View style={{ flex: 1 }}><Ghost label="Import Clients" onPress={() => { resetImport(); setImpOpen(true); }} /></View>
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
                <Text style={{ ...ty.label, fontWeight: '500', ...numeric, color: seg === sg.key ? t.brandInk : t.ink2 }}>{sg.label} {fig(sg.n)}</Text>
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

          {/* ── find one person ──────────────────────────────────────────────
              The chips above answer "which kind of client"; this answers "which
              client", which is the question a coach with eighty of them actually
              has. It was answerable nowhere on this screen: the magnifying glass
              in the header opens Explore, and Explore searches the list of
              SCREENS.

              It narrows the segment rather than replacing it, and everything
              below — the bulk controls, their counts, the drift order — is built
              from the result, so what the buttons act on is what is listed. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginBottom: sp.md }}>
            <Icon name="search" size={16} color={t.ink3} />
            <TextInput value={rosterQ} onChangeText={setRosterQ}
              placeholder="Find a client by name" placeholderTextColor={t.ink3}
              autoCapitalize="none" autoCorrect={false} accessibilityLabel="Find a client by name"
              style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
            {rosterQ ? (
              <Pressable onPress={() => setRosterQ('')} hitSlop={hitSlopFor(24)}
                accessibilityRole="button" accessibilityLabel="Clear the client search">
                <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
              </Pressable>
            ) : null}
          </View>

          {/* What the search actually searched. Under anything but a whole read
              that is not the roster, and "nobody matches" said over a read that
              failed tells a coach somebody is not on their book — see
              src/lib/rosterSearch.ts. This line is the only thing on the screen
              that may state an absence, and only under 'ready'. */}
          {rosterQLine ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{rosterQLine}</Text>
          ) : null}

          {/* Out of the app, and only ever the whole book. `exportRoster`
              refuses on a read that failed and marks the file INCOMPLETE on one
              that was truncated — see src/lib/rosterExport.ts. Offered whatever
              the segment or the search is, and it exports `roster` rather than
              what is listed, because a coach exporting their clients means all
              of them. */}
          {roster.length > 0 || rosterStatus !== 'ready' ? (
            <View style={{ marginBottom: sp.md }}>
              <Ghost icon="share" label={exportBusy ? 'Exporting…' : 'Export Roster'} onPress={exportRoster} />
            </View>
          ) : null}

          {/* Offered on every segment including All, which is the one a coach
              most often means by "everybody". It used to be hidden there, so
              the two bulk controls appeared only once a filter had been chosen
              and the most ordinary case had no control at all. */}
          {shownRoster.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
              {/* The count on this button is what the coach consents to, so
                  it is only a number when the two reads behind the segment came
                  back whole. Under anything else the control carries the reason
                  instead and the handler refuses as well — belt and braces,
                  because a message cannot be taken back. */}
              <View style={{ flex: 1 }}><Ghost icon="message"
                label={segClaim.allowed ? `Message ${shownRoster.length}` : 'Cannot Message This Segment'}
                onPress={openBulkMessage} /></View>
              <View style={{ flex: 1 }}><Ghost icon="grid"
                label={segClaim.allowed && bulkGuard.allowed ? 'Assign Program' : 'Cannot Assign Yet'}
                onPress={() => {
                  if (!segClaim.allowed) { Alert.alert(segClaim.label as string, segClaim.reason as string); return; }
                  if (!bulkGuard.allowed) { Alert.alert(bulkGuard.label as string, bulkGuard.reason as string); return; }
                  setBulkTplOpen(true);
                }} /></View>
            </View>
          ) : null}

          {/* Removing the segment. On its own row rather than beside the other
              two, because a destructive control the width of a Ghost sitting
              next to "Message 12" is a thumb-width away from it — and this one
              cannot be taken back for anybody it reaches.

              The count is on the label for the same reason it is in the dialog:
              this button is the last thing the coach reads before the dialog,
              and a bare "Remove" beside a segment chip is how somebody removes
              a book they thought was a filter. Withheld with the reason under
              anything but a whole read of the segment — `guardRecipients`
              refuses rather than warns, and forty irreversible writes over a
              list nobody read whole is the case it was written for. */}
          {shownRoster.length > 0 ? (
            <View style={{ marginBottom: sp.md }}>
              <Ghost
                label={!segClaim.allowed
                  ? 'Cannot Remove This Segment'
                  : endBusy ? 'Removing…' : `Remove ${shownRoster.length} From Your Roster`}
                onPress={() => {
                  if (!segClaim.allowed) { Alert.alert(segClaim.label as string, segClaim.reason as string); return; }
                  void bulkEnd();
                }} />
            </View>
          ) : null}

          {/* An empty list has four causes and they are not interchangeable.
              A search that matched nobody is already spoken for by the line
              under the field — which is the one that knows whether the roster
              was read at all — so this does not say "no clients in this
              segment" over a filtered list and send a coach to check a segment
              that has people in it. */}
          {shownRoster.length === 0 && !rosterQLine ? (
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
                      a rate invented out of an empty window.

                      The fallback used to be `Next: ${c.next}`, and
                      `RosterClient.next` is the literal string '—' in all three
                      places src/ui/roster.tsx builds a client: it is computed
                      nowhere and never has been. So every roster row without a
                      drift reading carried a field called "Next" with a dash
                      after it — a value the app looked as though it had tried
                      and failed to read. Nothing is drawn there instead; why a
                      client has no reading is already said once, above the
                      list, by the drift notices this screen carries. */}
                  {d ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, ...numeric }}>
                      {`${fig(d.recentPerWeek)} / wk · was ${fig(d.baselinePerWeek)}`}
                    </Text>
                  ) : null}
                </View>
              </View>

              {((c.unread != null && c.unread > 0) || showDrift || (!d && lowAdherence(c)) || (c.injuries && c.injuries.length)) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm, marginStart: 38 + sp.md }}>
                  {showDrift ? <Flag t={t} tone={driftTone(t, d!)} text={DRIFT_LABEL[d!.status]} /> : null}
                  {/* Only where a figure they submitted says so. This was
                      `atRiskClient(c)`, true of every hand-added client for
                      ever — so a coach with twenty cash clients opened their
                      home screen to twenty amber flags that could never clear,
                      and learned inside a week to read past all of them,
                      including the one that was real. */}
                  {!d && lowAdherence(c) ? <Flag t={t} tone={t.warn} text="Below target" /> : null}
                  {c.unread != null && c.unread > 0 ? <Flag t={t} tone={t.brand} text={`${c.unread} unread`} /> : null}
                  {c.injuries && c.injuries.length ? <Flag t={t} tone={t.s3} text={c.injuries.some((x) => x.isNew) ? 'New injury' : 'Injury'} /> : null}
                </View>
              ) : null}

              {showDrift ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, marginStart: 38 + sp.md }}>{d!.reason}</Text>
              ) : null}

              {drift && !d ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5, marginStart: 38 + sp.md }}>Not read yet — no drift assessment for this client.</Text>
              ) : null}

              {tagsFor(c.id).length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: sp.sm, marginStart: 38 + sp.md }}>
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
            <>
            {/* ── A way out that is always on screen ────────────────────────
                Reported as "when you click on a client you are not able to
                deselect or exit out — the only way to get out of the window is
                to close out the app completely".

                There WAS a way out, three of them: the scrim, the Android back
                button, and a Close button. The Close button sat at the far
                bottom of a sheet that runs to several screens of scrolling, and
                the scrim above a sheet at 86% height is a strip most of a
                thumb wide. So the honest reading of that report is not "no
                control existed" but "no control was where somebody would look",
                which for a dismissal is the same defect.

                This one is pinned OUTSIDE the ScrollView, so it cannot scroll
                away no matter how much this client's record holds. The one at
                the bottom stays: somebody who has read to the end should not
                have to scroll back up to leave. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                           paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 }}>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize', flex: 1 }} numberOfLines={1}>{sel.name}</Text>
              <Pressable onPress={() => setSel(null)} accessibilityRole="button"
                accessibilityLabel={`Close ${sel.name}`} hitSlop={12}
                style={{ marginStart: sp.md, width: 32, height: 32, borderRadius: 16, alignItems: 'center',
                         justifyContent: 'center', backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.head, color: t.ink2, lineHeight: 24 }}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 30 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
                {/* "next session {sel.next}" is gone from this line for the
                    reason the roster row above gives: that field has never held
                    anything but an em dash. The client's own page answers it
                    properly — src/lib/nextUp.ts, from the bookings that screen
                    already reads. */}
                {/* `lastActive` is a display PHRASE with five shapes and this
                    line used to glue "Last active " to the front of whichever
                    one arrived. Seen on an iPhone 17 Pro on a client added
                    today: "Last active no activity yet." The dash case was the
                    expensive one — "Last active —." reads as a client who has
                    gone quiet, and a dash here means the stats page came back
                    truncated. src/lib/lastActiveLine.ts writes the sentence
                    from the value instead, and tells the four facts apart. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                  {lastActiveLine(sel.lastActive)} What they have actually trained is under What They've Actually Done on their profile.
                </Text>
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="AI Weekly Summary" />
                {aiSummary ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>{aiSummary}</Text> : null}
                {/* Role and state, because the only thing that changed while a
                    summary was being written was the opacity and the word
                    inside — and a control with no `accessibilityRole` is not
                    announced as a button at all, so a coach on VoiceOver had
                    nothing telling them the tap had landed. */}
                <Pressable onPress={() => genSummary(sel)} disabled={aiBusy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: aiBusy, busy: aiBusy }}
                  accessibilityLabel={aiBusy
                    ? `Writing the weekly summary for ${sel.name}`
                    : aiSummary ? `Write the weekly summary for ${sel.name} again` : `Generate an AI weekly summary for ${sel.name}`}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 12, opacity: aiBusy ? 0.6 : 1 }}>
                  {aiBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{aiBusy ? 'Generating…' : aiSummary ? 'Regenerate summary' : 'Generate AI weekly summary'}</Text>
                </Pressable>
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Timeline" />
                {/* The timeline is built from the notes provider and the
                    feedback provider, so it is only as read as the worse of the
                    two — `worstStatus`, src/ui/loadStatus.ts. Both hand back an
                    empty map under 'loading' and under 'error', so an empty
                    `timeline` used to be indistinguishable from a client with
                    no history, and this line asserted the second. The Private
                    Notes section further down already renders these three
                    states; this one now agrees with it. */}
                {/* ── the fourth state, which this chain admitted silently ────
                    Both providers read the coach's ENTIRE history in one capped
                    page — `src/ui/feedback.tsx` :69 and `src/ui/coachNotes.tsx`
                    :114, both `capLimit()` and both `page.truncated ?
                    'partial' : 'ready'`. Newest first, so the thousandth row is
                    the oldest one that survives: a coach two years in, past a
                    thousand notes and feedback items between them, opens a
                    client they last wrote to eight months ago and every row
                    about that client is on the other side of the cap. `timeline`
                    is then empty and this said "No history yet" about a client
                    with a year of it.

                    Said above the rows rather than instead of them: the rows
                    that did come back are real and are worth reading — it is
                    the ABSENCE that cannot be reported, which is the same
                    bargain src/ui/loadStatus.ts describes for 'partial'.

                    `=== 'error'` and `=== 'loading'` name two of the three bad
                    answers and leave the third free, which is why `isWhole` is
                    a function — and why this never showed up in `check:whole`:
                    that gate matches `!==` comparisons, so an `=== 'error'`
                    chain walks straight past it. */}
                {timelineStatus === 'partial' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                    You have more notes and feedback on record than one request returns, so this is
                    not the whole of their history — anything older than the newest thousand is not
                    in it, and an empty stretch below is that limit rather than a quiet period.
                  </Text>
                ) : null}
                {timelineStatus === 'error' ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    This history could not be read, so we cannot say whether there is any.
                  </Text>
                ) : timelineStatus === 'loading' ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>Reading their history…</Text>
                ) : timeline.length === 0 ? (
                  // Only a whole read may say there is none. Under 'partial'
                  // the line above has already said what the emptiness is.
                  isWhole(timelineStatus)
                    ? <Text style={{ ...ty.label, color: t.ink3 }}>No history yet — notes, feedback and check-ins appear here.</Text>
                    : null
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
                      <View style={{ flex: 1, marginEnd: sp.sm }}>
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
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginStart: sp.sm }}>{num(m.kcal)} kcal · {m.via}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Coach Feedback" />
                {/* Same three states as Private Notes, for the same reason.
                    `getFeedback` returns `[]` under 'loading' and under 'error'
                    alike (src/ui/feedback.tsx), so "No feedback yet" was being
                    said over a provider that had not answered — to a coach who
                    may well have written to this client last week, and who
                    would either write it again or conclude they never did. */}
                {fbStatus === 'error' ? (
                  <KitFlag tone={t.crit} style={{ marginBottom: sp.sm }}>
                    Your feedback for {sel.name.split(' ')[0]} could not be read — this is not "no feedback".
                    Anything you send now still goes to them.
                  </KitFlag>
                ) : fbStatus === 'loading' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>Reading your feedback…</Text>
                ) : /* The third bad answer, which naming the first two with
                       `===` left free. `src/ui/feedback.tsx` :69 reads every
                       note this coach has ever written to ANYBODY in one
                       `capLimit()` page, newest first — so past a thousand of
                       them the oldest fall off, and a client last written to
                       eight months ago has all of theirs on the far side of the
                       cap. "No feedback yet" was then said to a coach who wrote
                       them a page, and the coach either writes it again or
                       decides they never did. */
                  fbStatus === 'partial' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                    You have written more feedback than one request returns, so anything older than
                    your newest thousand notes is not below. Nothing here says you have not written
                    to {sel.name.split(' ')[0]}.
                  </Text>
                ) : getFeedback(sel.id).length === 0 ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>No feedback yet. Leave {sel.name.split(' ')[0]} a note below.</Text>
                ) : null}
                {getFeedback(sel.id).map((fitem, i) => (
                  <View key={fitem.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.label, color: t.ink2 }}>{fitem.body}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{new Date(fitem.at).toLocaleDateString()}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <TextInput value={fb} onChangeText={setFb} placeholder="Leave advice or a note…" placeholderTextColor={t.ink3} multiline style={{ ...field(t, 44), flex: 1 }} />
                  {/* The result of the send is read, and the box is cleared
                      only once the row is on the server. This used to throw the
                      boolean away: `addFeedback` returns false when there is no
                      signed-in coach to attribute the note to or the insert is
                      refused, and the old code cleared the input regardless
                      while the provider's optimistic copy sat in the list
                      above — so the coach saw their advice delivered and the
                      client never received it, with nothing anywhere to find
                      out from. Private Notes, twenty lines below, alerts on
                      exactly this. */}
                  <Cta label={fbBusy ? 'Sending…' : 'Send'} onPress={() => {
                    const id = sel.id;
                    const draft = fb;
                    if (!draft.trim() || fbBusy) return;
                    setFbBusy(true);
                    void (async () => {
                      const sent = await addFeedback(id, draft);
                      setFbBusy(false);
                      if (sent) setFb('');
                      else Alert.alert('Not sent', 'That note did not reach your client, so it is still in the box. Check your connection and tap Send again.');
                    })();
                  }} />
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
                ) : /* And the third, for the same reason as the two sections
                       above it. `src/ui/coachNotes.tsx` :114 is one
                       `capLimit()` page of every private note this coach has
                       ever written, newest first. "Nothing here yet" over a
                       truncated read is the sentence this section's own header
                       says it exists to prevent — a coach deciding the thing
                       they are half-remembering did not happen. */
                  notesStatus === 'partial' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                    You have written more notes than one request returns, so anything older than
                    your newest thousand is not below. This is not &quot;no notes&quot; about{' '}
                    {sel.name.split(' ')[0]}.
                  </Text>
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
                // Two steps rather than one, and the second step is the whole
                // point: `end_coaching()` recorded no reason at all, so the
                // only moment a coach could say why somebody left passed in
                // silence every single time. The alert still asks whether they
                // mean it — removing a client is destructive and a picker is
                // not a confirmation — and the sheet then asks why, with an
                // explicit way to record nothing. See src/ui/EndReasonSheet.tsx.
                onPress={() => { const s = sel; Alert.alert('Remove client?', `Remove ${s.name} from your roster?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { setSel(null); setEnding({ id: s.id, name: s.name }); } }]); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, marginTop: sp.lg, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Remove client</Text>
              </Pressable>
              <Cta label="Close" wide onPress={() => setSel(null)} />
            </ScrollView>
            </>
          )}
        </View>
              </KeyboardAvoidingView>

      {/* ── why they left ─────────────────────────────────────────────────
          Opened after the removal is confirmed and before it is performed, so
          the ending and the reason reach the server as ONE call — two calls
          have a state between them (ended, unexplained) that every dropped
          connection reaches, and the ending is the only moment the question
          makes sense. Skipping records nothing and still removes them. */}
      <Modal visible={!!ending} animationType="slide" onRequestClose={() => setEnding(null)}>
        {ending ? (
          <EndReasonSheet
            name={ending.name}
            verb="Remove and Record This"
            onCancel={() => setEnding(null)}
            onDone={(reason: EndReason | null, note: string | null) => {
              const e = ending;
              setEnding(null);
              // The boolean was being discarded. `removeClient` returns false
              // both when the server refuses and when neither table had a row
              // to remove, and in both cases it PUTS THE CLIENT BACK on the
              // roster — so the coach watched somebody leave the list, saw
              // nothing, and found them there again a second later with no
              // explanation. The bulk path above reports every row by name;
              // the single one was silent.
              void (async () => {
                const ok = await removeClient(e.id, reason, note);
                if (!ok) {
                  Alert.alert('Not Removed', `${e.name.split(' ')[0]} is still on your roster. Either the server refused the change or there was no coaching relationship left to end — nothing was written either way, and anything you recorded about why they left was not saved.`);
                }
              })();
            }}
          />
        ) : null}
      </Modal>

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
                    <View style={{ flex: 1, marginEnd: sp.md }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{m.n}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{m.k} kcal · P{m.p} / C{m.c} / F{m.f}</Text>
                    </View>
                    <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
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
          <View style={sheet(t, { maxHeight: '90%' })}>
            {/* Two fields, two chip rows and a note, and the whole sheet had to fit
                the window because nothing in it scrolled. With the keyboard up over
                Name the sheet is taller than what is left, and this one overflows
                upwards — the field being typed into goes off the top. */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.title, color: t.ink }}>Add Client</Text>
              {/* Conditional on the coaching type, because the flat sentence was
                  contradicted by this sheet's own caption four rows further down.
                  Seen on an iPhone 17 Pro with the sheet at its defaults: the
                  header promised "become bookable in your schedule" while the
                  note under the selected Online chip said "They get no booking
                  calendar" — and Online is the default, so the two sentences
                  disagreed on first open, every time. `booksInPerson` is the same
                  predicate the calendar uses to decide who has slots to book. */}
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>
                They join your roster{booksInPerson(newMode) ? ' and become bookable in your schedule' : ''}.
              </Text>
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
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── import a roster ───────────────────────────────────────────────
          Preview, then confirm. The reading is src/lib/csvImport.ts's — the
          same importer the Studio console uses, with a coach's columns — and
          the screening is `screenInvites`, which is what catches an address
          listed twice before the batch fails halfway through with nobody
          knowing where it stopped.
          Nothing reaches the database until Import is pressed. */}
      <Modal visible={impOpen} transparent animationType="slide" onRequestClose={() => setImpOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setImpOpen(false)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: G, paddingBottom: 30, maxHeight: '88%', ...elevation.e2 }}>
            <Text style={{ ...ty.head, color: t.ink }}>Import Your Clients</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>
              A CSV with a Name column. Email, Goal and Delivery are optional. Nothing is written until you confirm, and every row this cannot read with confidence is refused with a reason rather than guessed at.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* This screen has its own <Flag>, which takes the theme and the
                  text as props rather than children — not the kit's. */}
              {impErr ? (
                <View style={{ marginBottom: sp.md }}><Flag t={t} tone={t.warn} text={impErr} /></View>
              ) : null}

              {impResult ? (<>
                {/* Afterwards. Named row by row, because these were N separate
                    writes and a coach who is told "40 imported" when eight
                    failed has no way to find the eight. */}
                <Text style={{ ...ty.body, color: t.ink, marginBottom: sp.md }}>{resultSummary(impResult)}</Text>
                {impResult.rows.filter((r) => r.outcome !== 'added' && r.outcome !== 'added-not-invited').map((r, i) => (
                  <View key={`${r.name}-${i}`} style={{ paddingVertical: 6, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.label, color: t.ink }}>{r.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      {r.outcome === 'failed'
                        ? 'Not saved. They are not on your roster.'
                        : 'On your roster, but no invite was recorded — send them your coaching code.'}
                    </Text>
                  </View>
                ))}
              </>) : impPreview && impPlan ? (<>
                <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>{impFile}</Text>
                <Text style={{ ...ty.body, color: t.ink, marginBottom: sp.md }}>
                  {planSummary(impPlan, impPreview.rows.length)}
                </Text>

                {/* Header columns that matched nothing. Reported and never
                    silently dropped: a coach whose "Phone" column vanished
                    without a word believes it came across. */}
                {impPreview.unmatchedColumns.length ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                    Columns this does not read, and which will not come across: {impPreview.unmatchedColumns.join(', ')}.
                  </Text>
                ) : null}

                {impPlan.rejected.length ? (<>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Rows that will not be imported</Text>
                  {impPlan.rejected.map((r) => (
                    <View key={r.line} style={{ paddingVertical: 5 }}>
                      <Text style={{ ...ty.label, color: t.ink }}>
                        Line {r.line}{r.name ? ` · ${r.name}` : ''}
                      </Text>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{r.reason}</Text>
                    </View>
                  ))}
                </>) : null}

                {impPlan.inviteSkipped.length ? (<>
                  <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.sm }}>Added, but no invite recorded</Text>
                  {impPlan.inviteSkipped.map((r) => (
                    <View key={r.email} style={{ paddingVertical: 5 }}>
                      <Text style={{ ...ty.label, color: t.ink }}>{r.name}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{r.reason}</Text>
                    </View>
                  ))}
                </>) : null}
              </>) : (
                <Text style={{ ...ty.caption, color: t.ink3 }}>
                  Export your client list from wherever it is now and choose the file. One row per client, with a header row on top.
                </Text>
              )}
            </ScrollView>

            <View style={{ height: sp.md }} />
            {impResult ? (
              <Cta label="Done" wide onPress={() => { setImpOpen(false); resetImport(); }} />
            ) : impPlan && !impErr ? (
              <Cta wide disabled={impBusy}
                label={impBusy ? 'Importing…' : `Import ${impPlan.create.length} Client${impPlan.create.length === 1 ? '' : 's'}`}
                onPress={() => { void runImport(); }} />
            ) : (
              <Cta label="Choose a File" wide onPress={() => { void chooseRosterFile(); }} />
            )}
            <View style={{ height: sp.sm }} />
            <Ghost label={impResult ? 'Close' : 'Cancel'} onPress={() => { setImpOpen(false); resetImport(); }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── broadcast ────────────────────────────────────────────────────── */}
      <Modal visible={bcOpen} transparent animationType="slide" onRequestClose={() => setBcOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setBcOpen(false)} />
          <View style={sheet(t, { maxHeight: '90%' })}>
            {/* Post a Notice is the tallest sheet in this file — a five-line
                explanation, a 90pt box, a switch row, the button and the last three
                notices posted. On a 4.7" phone with the keyboard up that is well past
                the window, and the sheet has no scroller of its own to reach the rest
                with. Same shape as the sheets in app/(trainer)/receipts.tsx: a capped
                height and a scroller inside it. */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
            </ScrollView>
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
                  {HAS_NATIVE_CLIPBOARD ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Ghost label="Copy Link for Your Bio" icon="share" onPress={() => copyJoinLink(myCode, 'your main code')} />
                    </View>
                  ) : (
                    <JoinLinkFallback t={t} code={myCode} note />
                  )}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    They enter this in the Repple app under Find a trainer, at the top. You still approve them before they join your roster.
                    Tapping the code sends a message with the link in it; {HAS_NATIVE_CLIPBOARD ? 'Copy Link gives you' : 'above it is'} the bare address, for a bio, a caption,
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
                    {/* No clipboard in this binary, so the address goes on
                        screen where the button would have put it. The sentence
                        explaining why is drawn once, under the main code. */}
                    {c.isLive && !HAS_NATIVE_CLIPBOARD ? <JoinLinkFallback t={t} code={c.code} /> : null}
                  </View>
                  <Pressable
                    onPress={() => { Share.share({ message: inviteMessage(c.code) }).catch(() => {}); }}
                    disabled={!c.isLive}
                    accessibilityRole="button"
                    /* A withdrawn code is refused, and `opacity: 0.5` was the
                       whole of what said so — which a screen reader does not
                       have. The state is announced, and the label says which
                       code it is talking about rather than leaving a coach to
                       tap a dead control and guess. */
                    accessibilityState={{ disabled: !c.isLive }}
                    accessibilityLabel={c.isLive
                      ? `Share the code for ${c.label}, ${c.code.split('').join(' ')}`
                      : `The code for ${c.label} has been withdrawn and cannot be shared`}
                    style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 8, opacity: c.isLive ? 1 : 0.5 }}>
                    <Text style={{ ...ty.label, ...numeric, color: t.ink, letterSpacing: 2 }}>{c.code}</Text>
                  </Pressable>
                  {c.isLive && HAS_NATIVE_CLIPBOARD ? (
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
      {/* ── the segment composer ───────────────────────────────────────────
          The coach's own words, in their own account, into N real threads.
          There is no draft here and nothing writes to this box but the person
          typing in it: the control this replaced composed a check-in itself and
          inserted it as `sender: 'coach'`, which is a message under somebody
          else's name — the one thing src/lib/nudge.ts and supabase/parts/140
          refuse outright, and the reason Quiet Clients drafts and will not
          send. */}
      <Modal visible={msgOpen} transparent animationType="slide" onRequestClose={() => setMsgOpen(false)}>
        <Pressable style={SCRIM} onPress={() => setMsgOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={sheet(t, { maxHeight: '86%' })}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.title, color: t.ink }}>Message {shownRoster.length} Clients</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
                Everyone in {segLabel}. This goes out as you, in your words.
              </Text>

              {/* Every name, before anything is sent. The count is the alarm and
                  the list is what a coach checks a specific person against. */}
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.lg }}>
                {shownRoster.map((c) => c.name).join(', ')}
              </Text>

              {msgFailed.length > 0 ? (
                <Notice tone={t.warn} kicker="Not delivered" title={`${msgFailed.length} did not get the last one`}
                  note={`${listNames(msgFailed.map(nameOf))} — nothing was written to their thread. Clients you added by hand have no account to message until they join.`} />
              ) : null}

              <TextInput value={msgBody} onChangeText={setMsgBody} placeholder="Your message…" placeholderTextColor={t.ink3} multiline
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 120, textAlignVertical: 'top', marginTop: sp.lg, marginBottom: sp.md }} />

              {/* What the client will see, said to the coach and not added to
                  the message. `bulkThreadNote` carries the argument: appending
                  "sent to 12 clients" would put words the coach did not write
                  into a message signed by the coach, and the client could not
                  tell which sentence came from which of them. */}
              {bulkThreadNote(shownRoster.length) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{bulkThreadNote(shownRoster.length)}</Text>
              ) : null}

              <Cta label={msgBusy ? 'Sending…' : `Send to ${shownRoster.length}`} wide
                disabled={!msgBody.trim() || msgBusy || !shownRoster.length}
                onPress={() => deliverBulk(shownRoster.map((c) => c.id))} />

              {/* Retry reaches the threads that failed and no others. Sending to
                  the segment again would put the same words a second time in
                  the thread of everybody it already reached. */}
              {msgFailed.length > 0 && !msgBusy ? (
                <View style={{ marginTop: sp.md }}>
                  <Ghost label={`Try the ${msgFailed.length} That Failed Again`} onPress={() => deliverBulk(msgFailed)} />
                </View>
              ) : null}

              <Pressable onPress={() => setMsgOpen(false)} style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: 6 }}>
                <Text style={{ ...ty.label, color: t.ink3 }}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={bulkTplOpen} transparent animationType="slide" onRequestClose={() => setBulkTplOpen(false)}>
        <Pressable style={SCRIM} onPress={() => setBulkTplOpen(false)} />
        <View style={sheet(t, { maxHeight: '78%' })}>
          <Text style={{ ...ty.title, color: t.ink }}>Assign to {shownRoster.length} Clients</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Pick a program template for everyone in {segLabel}.</Text>
          {/* Said before the template is chosen as well as in the confirmation
              after it, because this is the sheet a coach is scanning while they
              decide — and only sayable off a whole read of assigned_programs,
              which is what `bulkGuard` above has already established. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6, marginBottom: sp.lg }}>
            {(() => {
              const on = shownRoster.filter((c) => !!getProgram(c.id));
              return on.length === 0
                ? 'None of them are on a coach-assigned programme, so nothing here is replaced.'
                : `${on.length} of them are on a programme now — ${listNames(on.slice(0, 4).map((c) => c.name.split(' ')[0]))}${on.length > 4 ? ` and ${on.length - 4} more` : ''}. Whichever template you pick replaces what they are training.`;
            })()}
          </Text>
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


/* ── the first-run list, as one row ─────────────────────────────────────────── */

/**
 * One row on the Clients screen while setting up is unfinished.
 *
 * Its own component, and its own read, deliberately: this screen already mounts
 * a dozen providers and folding eight more queries into the dashboard's own
 * load would make opening the Clients tab wait on whether the coach has
 * uploaded a waiver. It renders NOTHING until the read lands, for the reason
 * src/ui/ScreenHelp.tsx gives — a card that appears for one frame and vanishes
 * is worse than one that never appeared.
 *
 * The count is of rows KNOWN to be outstanding. An unread row is not counted
 * and does not appear in the number, but it does keep the row on screen, which
 * is why "3 things left" and "still worth a look" are two different sentences
 * below rather than one with a number that might be made of our own failure.
 */
function CoachSetupRow() {
  const t = useTheme();
  const router = useRouter();
  const { facts, status, reload } = useCoachSetup();
  // Re-read every time the coach comes back, exactly as
  // app/(trainer)/getting-started.tsx does with the same provider. The card
  // names the NEXT outstanding step and links straight to it, so without this
  // the loop is: tap the row, do the thing, come back, and be told to do it
  // again — the provider's only trigger is its own mount. Pulling down did not
  // fix it either, which is what turns a stale card into a coach believing the
  // setting did not save and going back to change it a second time.
  useRefreshOnFocus(useCallback(() => { void reload(); }, [reload]));
  // The same fact app/(trainer)/getting-started.tsx uses, for the same reason
  // and from the same place. This card names the NEXT outstanding step, and
  // the two screens disagreeing about what is outstanding — this one sending a
  // coach to publish hours that the list itself says do not apply to them — is
  // the drift a second source always produces. One fact, both consumers.
  const delivery = useDeliveryFact();
  if (status === 'loading') return null;
  const rows = coachSetupRows(facts, delivery.shape);
  if (!showCoachSetup(rows)) return null;
  const next = coachSetupNext(rows);
  return (
    <View style={{ marginTop: sp.lg }}>
      <Card onPress={() => router.push('/(trainer)/getting-started')} tone={t.brand}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Icon name="sparkle" size={20} color={t.brand} />
          <View style={{ flex: 1 }}>
            {/* Not a bare `${left} left`. That count deliberately excludes
                rows whose read did not answer, so on its own it understates —
                a coach with two refused reads was told "3 left" for a list
                with five rows they had not done. src/lib/coachFirstRun.ts
                holds the wording and the argument. */}
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
              {coachSetupCardLine(rows)}
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              {next
                ? `Next: ${next.title.toLowerCase()} — until it is done, ${next.breaks}.`
                : 'Some of this could not be checked just now, so it is worth a look before you rely on it.'}
            </Text>
          </View>
          <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
        </View>
      </Card>
    </View>
  );
}
