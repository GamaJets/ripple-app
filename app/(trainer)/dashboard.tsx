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
import { fetchAwaitingOutcome } from '../../src/lib/gymSessions';
import {
  assessDrift, fetchClientActivity, compareDrift, summariseDrift, bandTitle, bandNote,
  DRIFT_LABEL, DEFAULT_WINDOWS, type Drift,
} from '../../src/lib/clientDrift';
import { useTenant } from '../../src/ui/tenant';
import { reportError } from '../../src/lib/reportError';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, Image, KeyboardAvoidingView, Platform, ActivityIndicator, type ViewStyle, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { trialInfo } from '../../src/lib/trial';
import { billingAvailable } from '../../src/lib/billing';
import { Icon, type IconName } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric } from '../../src/theme/scale';
import { useCoachProfile } from '../../src/ui/coachProfile';
import { CoachRequests } from '../../src/ui/CoachRequests';
import { atRiskClient } from '../../src/lib/trainerMock';
import { METRIC_DEFS, METRIC_GROUPS } from '../../src/lib/inbodyMetrics';
import { type RosterClient } from '../../src/lib/trainerMock';
import { areaLabel } from '../../src/lib/injuries';
import { supabase } from '../../src/lib/supabase';
import { askCoach } from '../../src/lib/coach';
import { useRoster } from '../../src/ui/roster';
import { useSessions } from '../../src/ui/sessions';
import { monthToDateRevenue, unmarkedNote } from '../../src/lib/coachRevenue';
import { useCoachFeedback } from '../../src/ui/feedback';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { slotsFor, searchMeals, mealAt, type Slot } from '../../src/lib/meals';
import { useCoachNotes } from '../../src/ui/coachNotes';
import { useAnnouncements } from '../../src/ui/announcements';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useCheckIns } from '../../src/ui/checkins';
import { useInvites } from '../../src/ui/invites';
import { useTrainerInvites } from '../../src/ui/trainerInvites';
import { useClientTags } from '../../src/ui/clientTags';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { fetchPhotosSharedWithMe, missingSharedFiles, SHARED_URL_TTL_S, type SharedPhoto } from '../../src/lib/photoShare';

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

/** One selectable option. Every picker on this screen is built from these. */
function Chip({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
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
];

/**
 * Sessions that have happened but nobody has said what happened.
 *
 * Renders NOTHING when the queue is empty — a dashboard that permanently
 * carries an "all clear" card teaches people to stop reading it. It appears
 * only when there is something to do, which is also exactly when payroll is
 * blocked, because payrollTotal() refuses to guess while any session is
 * unmarked.
 */
function UnmarkedSessions() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!tenant?.id) return;
      try {
        const since = new Date(Date.now() - 90 * 86400_000).toISOString();
        const rows = await fetchAwaitingOutcome(supabase, tenant.id, since);
        if (live) setN(rows.length);
      } catch (e) { reportError('dashboard.awaiting', e); }
    })();
    return () => { live = false; };
  }, [tenant?.id]);

  if (n === 0) return null;
  return (
    <Card onPress={() => router.push('/(trainer)/sessions')} tone={t.s3} style={{ marginBottom: sp.md }}>
      <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>
        {n} session{n === 1 ? '' : 's'} need an outcome
      </Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
        Payroll cannot be worked out until {n === 1 ? 'it is' : 'they are'} marked. One tap each.
      </Text>
    </Card>
  );
}

export default function TrainerClients() {
  const t = useTheme();
  const router = useRouter();
  const [trial, setTrial] = useState<{ daysLeft: number; expired: boolean } | null>(null);
  useEffect(() => { trialInfo().then((ti) => setTrial({ daysLeft: ti.daysLeft, expired: ti.expired })); }, []);
  const { roster, addClient, removeClient, setClientMode } = useRoster();
  const { sessions } = useSessions();
  const { tenant } = useTenant();

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

  const { sessionFee, name: coachName } = useCoachProfile();
  const { getFeedback, addFeedback } = useCoachFeedback();
  const { get: getNutri, setAdjust: setNutri, clear: clearNutri } = useCoachNutrition();
  const [mealPick, setMealPick] = useState<{ pos: number; slot: Slot } | null>(null);
  const [mealQuery, setMealQuery] = useState('');
  const { getNotes, addNote, removeNote } = useCoachNotes();
  const { addAnnouncement } = useAnnouncements();
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
  const [fb, setFb] = useState('');
  const [nnote, setNnote] = useState('');
  const [sel, setSel] = useState<RosterClient | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('Fat loss');
  const [newMode, setNewMode] = useState<'online' | 'inperson'>('online');
  const [invOpen, setInvOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invMode, setInvMode] = useState<'online' | 'inperson'>('online');
  const [newEmail, setNewEmail] = useState('');
  const [clientMeals, setClientMeals] = useState<{ name: string; kcal: number; via: string }[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [draftClient, setDraftClient] = useState<RosterClient | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAiSummary('');
    if (!sel) { setClientMeals([]); return; }
    (async () => {
      try {
        const { data } = await supabase.from('food_logs').select('name, kcal, via').eq('client_id', sel.id).order('logged_at', { ascending: false }).limit(6);
        if (!cancelled) setClientMeals((data || []).map((r: any) => ({ name: r.name, kcal: r.kcal, via: r.via })));
      } catch { if (!cancelled) setClientMeals([]); }
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
  // Was `active * sessionFee * 4` — a headcount times an assumed four sessions
  // a month, labelled "Est. revenue". It is the fabrication the Analytics
  // screen removed and this one kept, so the same coach could read $1,500/mo
  // here and the truth there. It moved when the roster moved: adding a client
  // who never booked raised it. Now it is delivered sessions at the coach's own
  // rate, from the one definition in src/lib/coachRevenue.ts.
  const month = monthToDateRevenue(sessions, sessionFee > 0 ? sessionFee : null);
  const unread = roster.reduce((a, c) => a + c.unread, 0);
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
         { key: 'nodata', label: 'Nothing recorded', n: bands.unknown }]
      : [{ key: 'atrisk', label: 'At-risk', n: atRisk }]),
    { key: 'online', label: 'Online', n: roster.filter((c) => c.mode === 'online').length },
    { key: 'inperson', label: 'In-person', n: roster.filter((c) => c.mode === 'inperson').length },
  ];
  const matchSeg = (c: RosterClient) =>
    seg === 'all' ? true
    : seg === 'drifting' ? driftFor(c)?.status === 'at_risk'
    : seg === 'nodata' ? driftFor(c)?.status === 'idle'
    : seg === 'atrisk' ? atRiskClient(c)
    : seg === 'online' ? c.mode === 'online'
    : seg === 'inperson' ? c.mode === 'inperson'
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
    if (c.unread > 0) return c.unread + ' unread message' + (c.unread > 1 ? 's' : '');
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
    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence != null ? client.adherence + '%' : 'no check-ins yet', recentMeals: clientMeals.map((mm) => mm.name).join(', ') || 'no meals logged yet', composition: compStr || 'no InBody scan yet' };
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
          </View>
        </View>

        {/* Clients who found this coach in the public directory and asked to
            be coached. Renders nothing at all when there are none. */}
        <CoachRequests />
        <UnmarkedSessions />

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {trial && !billingAvailable() ? (
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
          ) : null}

          {trainerInvites.length > 0 ? (
            <View>
              {trainerInvites.map((iv) => (
                <Notice key={iv.id} tone={t.brand} kicker={`Platform invitation${iv.demo ? ' · sample' : ''}`}
                  title={`${iv.ownerName || 'Repple'} invited you to coach`}
                  note="Accept to join the platform as a trainer and set up your coaching profile.">
                  <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                    <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineTrainerInvite(iv.id)} /></View>
                    <View style={{ flex: 2 }}><Cta label="Accept & set up profile" wide onPress={() => acceptJoin(iv.id, iv.ownerName)} /></View>
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
          label="Active clients"
          figure={fig(active)}
          note={active === 0 ? 'No clients yet — add or invite your first below.' : driftNote()}
          tone={toContact == null ? t.ink3 : toContact > 0 ? t.warn : t.brand}
          onPress={() => router.push('/(trainer)/analytics')}
        />

        <Rule />

        {/* ── the business, in three columns ──────────────────────────────── */}
        <Section>
          <SectionHead title="This month" note="Analytics" onPress={() => router.push('/(trainer)/analytics')} />
          <KpiRow items={[
            // Null when no rate is set: an em-dash, not "$0", which would read
            // as a month's earnings rather than as a missing setting.
            { label: 'Revenue', value: month.revenue == null ? fig(null) : '$' + month.revenue.toLocaleString(), unit: 'this mo' },
            { label: 'Unread', value: fig(unread) },
            // Null until the record has been read: an em-dash, never a zero
            // that would tell a coach nobody needs them this week.
            { label: 'To contact', value: fig(toContact) },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {active === 0
              ? 'Revenue appears once you have clients, a session rate, and sessions marked as delivered.'
              : sessionFee <= 0
              ? 'Set a session rate in your profile to see what this month is worth.'
              : [`${month.delivered} session${month.delivered === 1 ? '' : 's'} marked delivered this month at $${sessionFee}.`,
                 unmarkedNote(month)].filter(Boolean).join(' ')}
          </Text>
        </Section>

        <Rule />

        {/* ── coaching tools ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaching tools" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: sp.sm, paddingHorizontal: 2 }}>
            {SHORTCUTS.map(([ic, label, route]) => (
              <Pressable key={route} onPress={() => router.push(route as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 8 }}>
                <Icon name={ic} size={14} color={t.brand} />
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Section>

        {/* ── pending invites ────────────────────────────────────────────── */}
        {sentInvites.filter((i) => i.status === 'pending').length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Pending invites" note={`${sentInvites.filter((i) => i.status === 'pending').length} awaiting`} />
            {sentInvites.filter((i) => i.status === 'pending').map((i, idx) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: idx === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="message" size={16} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{i.email}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{i.mode === 'inperson' ? 'In-person' : 'Online'} · awaiting sign-up / accept</Text>
                </View>
                <Ghost label="Cancel" onPress={() => revokeInvite(i.id)} />
              </View>
            ))}
          </Section>
        </>) : null}

        <Rule />

        {/* ── the roster ─────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your clients" note={active > 0 ? driftNote() : undefined} />

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
            <View style={{ flex: 1 }}><Ghost label="Invite by email" onPress={() => { setInvEmail(''); setInvMode('online'); setInvOpen(true); }} /></View>
            <View style={{ flex: 1 }}><Cta label="Add client" wide onPress={() => { setNewName(''); setNewEmail(''); setNewGoal('Fat loss'); setNewMode('online'); setAddOpen(true); }} /></View>
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
              <View style={{ flex: 1 }}><Ghost icon="grid" label="Assign program" onPress={() => setBulkTplOpen(true)} /></View>
            </View>
          ) : null}

          {shownRoster.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {roster.length === 0 ? 'No clients yet. Add or invite your first — they connect once they accept in the app.' : 'No clients in this segment.'}
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
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal} · {c.mode === 'inperson' ? 'In-person' : 'Online'} · {c.lastActive}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.weightDelta <= 0 ? t.brand : t.ink3 }} />
                    <Text style={{ ...ty.label, fontWeight: '500', ...numeric, color: t.ink }}>{c.weightDelta > 0 ? '+' : ''}{c.weightDelta} kg</Text>
                  </View>
                  {/* Days a week, against what this person's own weeks used to
                      look like. An em-dash where there is no baseline — never
                      a rate invented out of an empty window. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, ...numeric }}>
                    {d ? `${fig(d.recentPerWeek)} / wk · was ${fig(d.baselinePerWeek)}` : `Next: ${c.next}`}
                  </Text>
                </View>
              </View>

              {(c.unread > 0 || showDrift || (!d && atRiskClient(c)) || (c.injuries && c.injuries.length)) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm, marginLeft: 38 + sp.md }}>
                  {showDrift ? <Flag t={t} tone={driftTone(t, d!)} text={DRIFT_LABEL[d!.status]} /> : null}
                  {!d && atRiskClient(c) ? <Flag t={t} tone={t.warn} text="Needs a check-in" /> : null}
                  {c.unread > 0 ? <Flag t={t} tone={t.brand} text={`${c.unread} unread`} /> : null}
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
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Plan adherence</Text>
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
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>{sel.goal} · {sel.weightDelta > 0 ? '+' : ''}{sel.weightDelta} kg · {sel.adherence != null ? sel.adherence + '% adherence' : 'no check-ins yet'}</Text>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Delivery" />
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  {([['inperson', 'In-person'], ['online', 'Online']] as const).map(([m, label]) => (
                    <Chip key={m} t={t} label={label} on={sel.mode === m}
                      onPress={() => { setClientMode(sel.id, m); setSel({ ...sel, mode: m }); }} />
                  ))}
                </View>
              </View>

              {sel.metrics && Object.values(sel.metrics).some((v) => v != null) ? (
                <View style={{ marginBottom: sp.xl }}>
                  <SheetHead t={t} title="Body composition · latest scan" />
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
                  <Text style={{ ...ty.label, color: t.warn }}>
                    {sharedErr} That is not the same as them having sent none — the list could not be read, so this sheet cannot say either way.
                  </Text>
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
                      <Text style={{ ...ty.caption, color: t.warn, marginTop: 4 }}>
                        {missingSharedFiles(shared) === 1 ? 'One of these has no picture behind it any more.' : `${missingSharedFiles(shared)} of these have no picture behind them any more.`}
                      </Text>
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
                  <SheetHead t={t} title="Injuries & limitations · disclosed at onboarding" />
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
                  Last active {sel.lastActive} · next session {sel.next}. Session history appears here once {sel.name.split(' ')[0]} logs workouts.
                </Text>
              </View>

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="AI weekly summary" />
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
                <SheetHead t={t} title="Meal plan targets" />
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>Shape {sel.name.split(' ')[0]}'s daily calories, protein, carbs & fat — applies to their Meals tab live.</Text>
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
              </View>

              {clientMeals.length > 0 ? (
                <View style={{ marginBottom: sp.xl }}>
                  <SheetHead t={t} title="Recent meals logged" />
                  {clientMeals.map((m, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.sm, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }} numberOfLines={1}>{m.name}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginLeft: sp.sm }}>{m.kcal} kcal · {m.via}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ marginBottom: sp.xl }}>
                <SheetHead t={t} title="Coach feedback" />
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
                <SheetHead t={t} title="Private notes (only you)" />
                {getNotes(sel.id).map((n, i) => (
                  <View key={n.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{n.body}</Text>
                    <Pressable onPress={() => removeNote(sel.id, n.id)} hitSlop={8}
                          accessibilityRole="button" accessibilityLabel="Remove note">
                      <Icon name="minus" size={14} color={t.ink3} />
                    </Pressable>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <TextInput value={pnote} onChangeText={setPnote} placeholder="Private note (client can't see this)…" placeholderTextColor={t.ink3} multiline style={{ ...field(t, 44), flex: 1 }} />
                  <Ghost label="Save" onPress={() => { const id = sel.id; if (pnote.trim()) { addNote(id, pnote); setPnote(''); } }} />
                </View>
              </View>

              <ListRow icon="bell" title="Send a check-in nudge" note={'A quick "how is it going?" message'} onPress={() => sendNudge(sel)} />
              <ListRow icon="chat" title={`Message ${sel.name.split(' ')[0]}`} note="Open your chat thread"
                onPress={() => { const id = sel.id; const nm = sel.name; setSel(null); router.push({ pathname: '/(trainer)/chat', params: { clientId: id, name: nm } }); }} />
              <ListRow icon="grid" title="Open program builder" note={`Edit sets, reps & exercises for ${sel.name.split(' ')[0]}`}
                onPress={() => { const id = sel.id; setSel(null); router.push({ pathname: '/(trainer)/builder', params: { clientId: id } }); }} />

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
      </Modal>

      {/* ── add a client ─────────────────────────────────────────────────── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setAddOpen(false)} />
          <View style={sheet(t)}>
            <Text style={{ ...ty.title, color: t.ink }}>Add client</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>They join your roster and become bookable in your schedule.</Text>
            <SheetHead t={t} title="Name" />
            <TextInput value={newName} onChangeText={setNewName} placeholder="Client name" placeholderTextColor={t.ink3} style={{ ...field(t), marginBottom: sp.lg }} />
            <SheetHead t={t} title="Email · optional, sends an app invite" />
            <TextInput value={newEmail} onChangeText={setNewEmail} placeholder="client@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={{ ...field(t), marginBottom: sp.lg }} />
            <SheetHead t={t} title="Goal" />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {['Fat loss', 'Build muscle', 'Tone'].map((g) => (
                <Chip key={g} t={t} label={g} on={newGoal === g} onPress={() => setNewGoal(g)} />
              ))}
            </View>
            <SheetHead t={t} title="Coaching type" />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.xl }}>
              {([['online', 'Online'], ['inperson', 'In-person']] as const).map(([id, label]) => (
                <Chip key={id} t={t} label={label} on={newMode === id} onPress={() => setNewMode(id)} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setAddOpen(false)} /></View>
              <View style={{ flex: 2 }}>
                <Cta label="Add client" wide onPress={() => { if (!newName.trim()) { Alert.alert('Add a name', 'Enter the client name.'); return; } addClient(newName, newGoal, newMode); const em = newEmail.trim(); const invited = !!em && em.includes('@'); if (invited) { sendInvite(em, newMode); } setAddOpen(false); Alert.alert('Client added', invited ? newName.trim() + ' is on your roster. Repple does not send email — ' + em + ' is recorded as an invite, and they link to you the first time they sign in to Repple with that address. Tell them yourself so they know to install it.' : newName.trim() + ' is now on your roster.', [{ text: 'Great' }]); }} />
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
            <Text style={{ ...ty.title, color: t.ink }}>Broadcast to all clients</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>Everyone on your roster sees this on their dashboard.</Text>
            <TextInput value={bcText} onChangeText={setBcText} placeholder="Your announcement…" placeholderTextColor={t.ink3} multiline style={{ ...field(t, 90), marginBottom: sp.lg }} />
            <Cta label="Send to all clients" wide onPress={() => { if (!bcText.trim()) { Alert.alert('Write something', 'Enter your announcement.'); return; } addAnnouncement(bcText); setBcOpen(false); Alert.alert('Sent', 'Your clients will see this on their dashboard.'); }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── invite by email ──────────────────────────────────────────────── */}
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SCRIM} onPress={() => setInvOpen(false)} />
          <View style={sheet(t)}>
            <Text style={{ ...ty.title, color: t.ink }}>Invite a client by email</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.xl }}>They see your invitation in the Repple app when they sign in with this email; accepting links them to you.</Text>
            <SheetHead t={t} title="Email" />
            <TextInput value={invEmail} onChangeText={setInvEmail} placeholder="client@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={{ ...field(t), marginBottom: sp.lg }} />
            <SheetHead t={t} title="Coaching type" />
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.xl }}>
              {([['online', 'Online'], ['inperson', 'In-person']] as const).map(([id, label]) => (
                <Chip key={id} t={t} label={label} on={invMode === id} onPress={() => setInvMode(id)} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => setInvOpen(false)} /></View>
              <View style={{ flex: 2 }}>
                <Cta label="Send invite" wide onPress={() => { const e = invEmail.trim(); if (!e || !e.includes('@')) { Alert.alert('Enter an email', 'Add a valid client email address.'); return; } sendInvite(e, invMode); setInvOpen(false); Alert.alert('Invitation sent', e + ' will see your ' + (invMode === 'inperson' ? 'in-person' : 'online') + ' coaching invite when they sign in to Repple.', [{ text: 'Done' }]); }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── coach meal picker ────────────────────────────────────────────── */}
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
                  <Cta label="Send check-in" wide onPress={sendDraft} />
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
