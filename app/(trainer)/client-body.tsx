// Coach · Body composition. What one client's InBody scans say, over time.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// "When a client does an InBody scan and this information is inputted into the
// client's app, the information should be pushed to the coach's app and the
// client's information is updated in the coach's app so the coach can see the
// trends."
//
// The permission was never the gap. `scans_trainer_read` has granted a coach
// SELECT on their own clients' scans since the first schema file. What was
// missing was a reader: the only coach-side query against `scans` lives in
// client-goals.tsx, and it exists to work out how far along a goal is — a start
// value, a current value, a percentage. No history, no body-fat or muscle
// series, and no sense of when anything was measured. So a client could stand
// on an InBody every month for a year and their coach could see one percentage
// off it, on a screen that is about something else.
//
// A trend is what was asked for. A single latest number is what already existed.
//
// ── Nothing here works anything out ────────────────────────────────────────
//
// Every series, sentence, date and conversion comes from src/lib/clientBody.ts,
// which is pure and tested (src/lib/clientBody.test.ts). This file reads four
// columns and a client row, decides which of four things is true, and draws it.
//
// ── The three metrics do not share a date ──────────────────────────────────
//
// `scans.skeletal_muscle_kg` is nullable — a bathroom scale gives weight and
// body fat and no muscle figure at all — and a scan that did not measure muscle
// contributes NO point to the muscle series. That was a real bug, fixed
// yesterday: read as `?? 0`, the missing figure was charted as a real point and
// differenced against the scan before it, and a dashboard showed a whole body's
// worth of muscle lost overnight.
//
// The consequence for this screen is that the newest muscle reading can be much
// older than the newest weight reading, so every metric carries its OWN date and
// its own age. A single screen-level "last scanned" over all three would report
// a four-month-old muscle figure as three days old, which is the same trap the
// tape sites hit on client-goals.tsx.
//
// ── Typed figures are not machine readings ─────────────────────────────────
//
// `clients.manual_weight_kg` and `manual_body_fat_pct` are what a client without
// an InBody types about themselves, and their own app reads them in preference
// to the newest scan while `manual_at` is the more recent of the two. A coach
// has to see them — they are what is on the client's screen, and a coach quoting
// a scan at somebody whose app says something else looks like a coach who is not
// paying attention — but they are kept out of the series above and labelled as
// typed. Bathroom scales and an InBody disagree by more than most of the changes
// anybody is training for, so a change taken across the two would be reporting
// the equipment rather than the body.
//
// ── The rest of the sheet ──────────────────────────────────────────────────
//
// "On the client app you can see Body composition and the change since the last
// InBody scan / updated measurements. However, this change cannot be seen on
// the coach app."
//
// Three columns is not a body composition. An InBody printout carries visceral
// fat, an InBody score, a BMR, fat and lean mass, lean mass limb by limb, and
// water, protein and minerals — thirteen figures this app already reads off a
// photograph of the sheet and stores in `scans.metrics`
// (supabase/parts/03-scan-metrics.sql). The member has seen all thirteen,
// grouped under four headings with an improving / watch / balance reading over
// the top, since app/(client)/scans.tsx was built. Their coach saw three.
//
// So the whole of it is replicated here, off the SAME module the member's
// screen uses — src/lib/inbodyMetrics.ts, which is pure and shared. There is no
// second composition rule anywhere in this tree and there must never be one: a
// coach and a client disagreeing about which metrics improved would be worse
// than the coach seeing nothing.
//
// ── And the tape, which is the other half of "updated measurements" ────────
//
// `measurements` has carried `measurements_coach_read` since supabase/parts/02
// and this screen never read it. It is the record that moves when the scale
// does not — six weeks of no weight change and two centimetres off a waist —
// and a screen called Body Composition that cannot show it is sending a coach
// to the goals screen to find out whether their client's body changed.
//
// ── The voice ──────────────────────────────────────────────────────────────
//
// Everything the member's screen says, it says to the person whose body it is.
// A coach is reading about somebody else, and "your left arm is 10% behind" is
// a different sentence from "Sam's left arm is 10% behind" in the verb as well
// as the pronoun. `HistoryVoice` (src/ui/ExerciseHistory.tsx) is the mechanism
// the coach's training screens already use for exactly this, carried as parts
// rather than as sentences with a name substituted in, and it is what the
// prose below is assembled from. It also fixes a defect that was already here:
// `who` fell back to "They" and the sentences around it were written with
// "has", so a client whose name had not arrived was told about in the words
// "They has never been scanned".
//
// ── Four states, kept apart ────────────────────────────────────────────────
//
// A read that failed, a read that came back truncated, a client who has never
// been scanned, and real readings. Collapsing any two of them tells a coach
// something false about a person they are about to ring. Nothing on this screen
// is ever a zero standing in for an absence.
//
// The composition table needs the same four said again in its own terms,
// because its emptiness has a cause of its own: `scans.metrics` is nullable and
// most scans do not carry it, so "no breakdown" is common and is NOT "no
// scans" and is not "the read failed". And a client with exactly one breakdown
// has thirteen readings and no change — which is not a change of zero, and is
// said in words rather than drawn as a dash.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, PageHead, Notice, Flag, Spark, fig, Segmented } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { ScanCadencePanel } from '../../src/ui/ScanCadencePanel';
import { SourceChip } from '../../src/ui/ScanSource';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { isoToday } from '../../src/lib/dayPlan';
import { plain, lengthLabel } from '../../src/lib/units';
import { numUpTo, fmtDay } from '../../src/lib/format';
// The sleep and water the member types in by hand, and the switch that decides
// whether a coach may see any of it. The gate is `sleep_logs_coach_read` and
// `hydration_logs_coach_read` (supabase/parts/2670) and it is enforced by
// Postgres — this screen cannot see what a member has not shared, and its whole
// job here is to say WHICH of three silences it is looking at.
import { useWellnessShare, WELLNESS_WINDOW_DAYS } from '../../src/ui/wellnessShare';
import {
  wellnessPanel, averageHours, averageGlasses, qualityMarks,
  notSharedLine, unreadableLine, notAskedLine, nothingLoggedLine, truncatedLine,
} from '../../src/lib/coachWellness';
import { deltaLabel } from '../../src/lib/deltaLabel';
// The window the trend is cut to and the day a row is dated with, off the
// same helpers clientBody.ts itself reads dates through.
import { daysBetweenIso, dayHeading } from '../../src/lib/coachWeek';
// The words behind the chip on each row, so a row read aloud says how the
// reading was taken as well as what it said.
import { readSource, sourceChip } from '../../src/lib/scanProvenance';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import {
  readBodyHistory, bodyBoard, seriesOf, movementOf, readingLine, seriesAgeLine,
  isSeriesStale, metricUnit, metricValue, metricDelta, readManual, manualLine, manualFigures,
  BODY_METRICS, DIRECTION_CAVEAT,
  type BodyHistory, type BodyScanRow, type ManualRow, type ManualEntry, type MetricSeries, type BodyMetricKey,
} from '../../src/lib/clientBody';
// The thirteen composition metrics, the four headings they are grouped under,
// and the improving / watch / balance reading — the same functions
// app/(client)/scans.tsx draws its own table from. Nothing about them is
// re-implemented here; where the coach needed something the module did not do,
// it was added THERE and both screens now call it.
import {
  trendsByGroup, compositionInsights, scansWithMetrics,
  type ScanLike, type ScanMetrics, type MetricTrend,
} from '../../src/lib/inbodyMetrics';
// The tape. Same module the goals screen reads it through, so a waist figure
// reads identically on both coach screens and neither of them works it out.
import {
  readMeasurements, measureBoard, unmeasuredSites, siteChangeLine, siteAgeLine,
  isSiteStale, DIRECTION_CAVEAT as TAPE_CAVEAT,
  type MeasurementRow, type SiteHistory,
} from '../../src/lib/clientMeasurements';
// Third person about the client, second person to the coach — carried as parts
// so the verb changes with the subject. Already the mechanism on
// app/(trainer)/client-training.tsx and src/ui/MuscleWorkPanel.tsx.
import type { HistoryVoice } from '../../src/ui/ExerciseHistory';
import { END_ALIGN } from '../../src/ui/direction';

// `source` rides along with the three figures because "InBody (OCR)" and
// "InBody (manual)" are different amounts of trust in a reading, and a coach
// looking at an outlier is entitled to know which one they are looking at.
//
// `metrics` is the fifth column and the reason the composition table below can
// exist at all: it is the jsonb blob a read of the printout writes, holding
// whichever of the thirteen fields that sheet actually carried. Nullable on the
// table and absent on most rows — a gym scale writes a weight and a body fat
// and nothing else — so its absence is ordinary and is never a zero.
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg, source, metrics';
const MANUAL_COLS = 'manual_weight_kg, manual_body_fat_pct, manual_at';
const MEAS_COLS = 'taken_at, kind, value';

/**
 * A `scans` row as this screen asks for it.
 *
 * `BodyScanRow` is the four columns src/lib/clientBody.ts reads plus `source`.
 * The breakdown is added here rather than there because clientBody.ts is about
 * the three series and has no opinion about composition; the two readers share
 * a query and not a subject.
 */
type CompositionScanRow = BodyScanRow & { metrics?: ScanMetrics | null };

/**
 * Why the mark beside a composition change is coloured here when the mark
 * beside a weight change three sections above it is not.
 *
 * `MetricDef.better` in src/lib/inbodyMetrics.ts is a property of the METRIC:
 * visceral fat is read down and an InBody score is read up, by everybody, on
 * every sheet. That is a different kind of claim from "this client's weight
 * going down is progress", which depends entirely on what they are working
 * toward and is why nothing on the three series is coloured. The member sees
 * this colouring on their own screen and the owner asked for replication, so it
 * is replicated — with the one place it can mislead a coach named out loud.
 */
const COMPOSITION_CAVEAT =
  'The mark beside each change follows the direction that metric is ' +
  'conventionally read in — visceral fat down, InBody score up — and not this ' +
  'client\u2019s own goal, which the sheet does not record. It is the same mark ' +
  'they see on their own screen. Fat and lean mass are the pair to hold it ' +
  'against: somebody deliberately building will move both the way this table ' +
  'calls a warning.';

export default function ClientBody() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  // Arrives from app/(trainer)/client.tsx, so a coach who is already looking at
  // somebody lands on that person rather than on a picker. The picker is still
  // here for the same reason the other per-client screens keep theirs — the
  // screen is reachable without a param.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  // The coach's own unit, not the client's. Every figure below is stored in
  // kilograms whichever unit it was typed in (TF-37), so this changes only what
  // is printed — but printing kilograms to a coach who reads pounds is a wrong
  // number, not a stylistic choice. Body fat is a percentage in every unit
  // system and is not touched by it.
  const wu = useSettings().weightUnit;
  // The tape is stored in centimetres and printed in whatever the COACH reads,
  // the same way the two masses are. A separate setting from the weight one
  // because a coach may well read kilograms and inches.
  const lu = useSettings().lengthUnit;

  // Seeded once, and this screen never unmounts — it is registered `href: null`
  // inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState` initialiser runs
  // for the FIRST client a coach opens it for and for nobody after. Opening it
  // for Ben used to draw Amy. `subjectChange` is the rule, with the reasoning
  // and the string[] hazard in src/lib/routeSubject.ts; it is applied during
  // render rather than in an effect so the wrong person is never painted, not
  // even for one frame.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  // Which composition metric has its series open. A way of looking at one
  // table rather than a second question about the data, so it is local — and
  // it is cleared whenever the subject changes, because this screen never
  // unmounts and an open row would otherwise carry over onto the next client.
  const [compOpen, setCompOpen] = useState<string | null>(null);
  // Which of the three series the top of the screen draws, and how far back
  // the line and the rows reach. The board's Progress opens on one metric
  // with a range under it; both are ways of looking rather than facts about
  // the client, so they are local — and unlike `compOpen` they are kept
  // across subjects, because a coach reading two clients' weight in a row
  // wants weight both times.
  const [metric, setMetric] = useState<BodyMetricKey>('weight');
  const [range, setRange] = useState<'1M' | '3M' | '6M' | '1Y'>('1Y');
  const moved = subjectChange(seenParam, clientId);
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); setCompOpen(null); }

  // Null is "we do not know", never "there are none". The two reads carry their
  // own status because they fail independently and mean different things when
  // they do: a refused `clients` read says nothing about the scans, and a
  // refused `scans` read must not be rendered as a client who has never stood
  // on a machine.
  const [history, setHistory] = useState<BodyHistory | null>(null);
  const [scanStatus, setScanStatus] = useState<LoadStatus>('ready');
  const [manual, setManual] = useState<ManualEntry | null>(null);
  const [manualStatus, setManualStatus] = useState<LoadStatus>('ready');
  // The composition blobs off the SAME rows as `history`, kept in the shape
  // src/lib/inbodyMetrics.ts works in. Deliberately no status of its own: it
  // came out of one query with the three series, so it failed when they failed
  // and was truncated when they were, and a second status would be a second
  // answer to one question — the shape that lets a screen say "no breakdown"
  // about a read that never landed.
  const [comp, setComp] = useState<ScanLike[] | null>(null);
  // The day and the evidence of every scan row that came back, kept beside
  // `comp` rather than folded into `ScanLike` — that shape is shared with the
  // member's own screens, and widening it there to serve one coach panel would
  // be the wrong trade. Null is a failed read and never an empty book.
  const [scanRows, setScanRows] = useState<{ day: string | null; source: string | null }[] | null>(null);
  // The tape. Its own read and its own status, because it is a different table
  // written on a different day: a refused `scans` read says nothing about the
  // measurements, and a refused `measurements` read must not empty the scans.
  const [sites, setSites] = useState<SiteHistory[] | null>(null);
  const [unreadableMeas, setUnreadableMeas] = useState(0);
  const [measStatus, setMeasStatus] = useState<LoadStatus>('ready');
  // Fixed at the moment of the read rather than recomputed on every render, so
  // a screen left open over midnight cannot quietly age a reading under the
  // coach's eyes while they are looking at it. Same as client-goals.tsx.
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));

  // The client whose reads are allowed to reach the screen. Tapping through a
  // book of clients starts a read per tap and they do not come back in order, so
  // without this a slow answer for the person tapped first can land under the
  // name of the person tapped second — one client's body attributed to another,
  // which is worse than showing nothing at all.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string, askable: boolean) => {
    wanted.current = id;
    setScanStatus('loading'); setManualStatus('loading'); setMeasStatus('loading');
    setHistory(null); setManual(null); setComp(null);
    setSites(null); setUnreadableMeas(0);
    const today = isoToday(new Date());

    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account, so nothing server-backed is asked for them.
    //
    // This was `isQueryableId(id)` alone, on the belief that such a client
    // carries an id the phone invented and Postgres would refuse. It does not:
    // `coach_clients.id` is uuid DEFAULT gen_random_uuid(), so from the first
    // round trip onward the guard passed, the read ran, it came back with zero
    // rows and NO error, and this screen rendered that as "they have none". The
    // roster is the only thing that knows which table the row came from — see
    // src/lib/clientRecord.ts.
    if (!askable) {
      setScanStatus('error'); setManualStatus('error'); setMeasStatus('error');
      return;
    }

    const [scanRes, cliRes, measRes] = await Promise.all([
      // Newest first, unlike client-goals.tsx, and deliberately. Scans are
      // append-only and this screen wants the recent ones: if the cap bites, the
      // rows that fall off the end should be the oldest and least useful rather
      // than the ones describing the body that is training now. `taken_at` is a
      // DATE and nothing stops two scans sharing one, so the id settles the
      // ties — an order with ties in it is not an order, and at the cap the
      // server may break them differently on each read.
      //
      // `created_at` sits between the two since a coach reported "can't see
      // the updated body scan". `scans.id` is a uuid_generate_v4(), so on its
      // own it settled a tie STABLY and ARBITRARILY: of two scans dated the
      // same day — a typed entry and then the InBody sheet, or a scan entered
      // again to correct it — a coin decided which one this screen called the
      // newest, and it could be the one the client had just replaced. When the
      // row was written is the only thing on it that knows which came second.
      // The id stays last, for two rows written in the same microsecond.
      supabase.from('scans').select(SCAN_COLS)
        .eq('client_id', id)
        .order('taken_at', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      // The client's own row, for the figures they typed. RLS on `clients` is
      // what limits this to a coach's own book; the filter is about which client
      // is on screen rather than about who may be seen.
      supabase.from('clients').select(MANUAL_COLS).eq('id', id).limit(1),
      // Newest first for the same reason the scans are, and with the id
      // settling the ties for the same reason too: `taken_at` is a DATE, a
      // client who measures five sites on one day writes five rows carrying
      // the same one, and an order with ties in it is not an order to cut a
      // page on — at the cap the server may break them differently on each
      // read, so a chest reading that was here yesterday is simply gone today.
      supabase.from('measurements').select(MEAS_COLS)
        .eq('user_id', id)
        .order('taken_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
    ]);
    if (wanted.current !== id) return;
    setTodayISO(today);

    if (scanRes.error) {
      reportError('clientBody.scans', scanRes.error);
      setHistory(null);
      // Null, not an empty list. `trendsByGroup([])` answers "no metric was
      // ever measured", which is a fact about the client; a failed read is a
      // fact about the connection, and the screen must be able to tell them
      // apart from the value alone.
      setComp(null);
      setScanRows(null);
      setScanStatus('error');
    } else {
      const page = capped((scanRes.data ?? []) as unknown as CompositionScanRow[]);
      // Handed over OLDEST first, which is not how they were read. Both
      // `readBodyHistory` and `metricTrends` order by DAY with a stable sort
      // and then take the last entry as the latest — and a stable sort keeps
      // two scans dated the same day in the order they arrived. Arriving
      // newest-first, the scan a client had just added sat BEFORE the one it
      // replaced, so "latest" was the older of the pair: the figure, its delta
      // and the composition table all described the scan the coach had already
      // seen. The member's own app never had this, because src/ui/clientData.tsx
      // turns its page round before anything reads it; this does the same.
      // The read stays newest-first — that decides which end the cap cuts.
      const oldestFirst = page.rows.slice().reverse();
      setHistory(readBodyHistory(oldestFirst));
      // Carried through untouched. A row with no `metrics` contributes no
      // point to any composition metric — the same rule as the missing muscle
      // figure above it, and for the same reason: absence is not zero.
      setComp(oldestFirst.map((r) => ({ takenAt: r.taken_at, metrics: r.metrics ?? undefined })));
      setScanRows(page.rows.map((r) => ({ day: r.taken_at ?? null, source: r.source ?? null })));
      setScanStatus(page.truncated ? 'partial' : 'ready');
    }

    if (cliRes.error) {
      reportError('clientBody.manual', cliRes.error);
      setManual(null);
      setManualStatus('error');
    } else {
      const rows = (cliRes.data ?? []) as unknown as ManualRow[];
      // No row is a real answer here and not a failure: a client added to the
      // book by hand has no `clients` row of their own to carry typed figures.
      setManual(readManual(rows[0] ?? null));
      setManualStatus('ready');
    }

    if (measRes.error) {
      reportError('clientBody.measurements', measRes.error);
      setSites(null);
      setMeasStatus('error');
    } else {
      const page = capped((measRes.data ?? []) as unknown as MeasurementRow[]);
      const read = readMeasurements(page.rows);
      setSites(read.sites);
      setUnreadableMeas(read.skipped);
      setMeasStatus(page.truncated ? 'partial' : 'ready');
    }
  }, []);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  /** Whether the server may be asked about this person at all. Recomputed on
   *  every render rather than inside `load`, so that a roster which arrives
   *  AFTER the read — and says this row was typed in by hand — re-runs the
   *  effect and withdraws the answer instead of leaving an empty screen
   *  standing as a fact about them. `handAdded` undefined is "the roster has
   *  not said", which goes on asking. */
  const askable = clientIsQueryable(picked, client?.handAdded);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      // Deselecting has to disown the read in flight too, or it lands on a
      // screen that is no longer showing anybody.
      wanted.current = null;
      setHistory(null); setManual(null); setComp(null);
      setSites(null); setUnreadableMeas(0); setCompOpen(null);
      setScanStatus('ready'); setManualStatus('ready'); setMeasStatus('ready');
      return;
    }
    void load(picked, askable);
  }, [picked, askable, load]);

  // The member's typed sleep and water, read only if they have said so. Its own
  // hook and its own statuses, because it fails independently of the scans: a
  // refused `scans` read says nothing about their nights, and a member who has
  // not shared their nights has a body composition that is still perfectly
  // readable. `askable` travels with it for the same reason it travels with
  // `load` — a hand-added client has no account, so nothing was ever asked of
  // them and no read of theirs ever failed.
  const wellness = useWellnessShare(picked, askable);
  // Held by identity rather than through `wellness`, which is a fresh object on
  // every render: a pull handler rebuilt every render would hand the
  // RefreshControl a new callback each time. `refresh` is a useCallback and
  // changes only when the subject does.
  const wellnessRefresh = wellness.refresh;

  // The scans and the manual entries are written by the CLIENT, on their own
  // phone, and this screen is where a coach finds out whether a weigh-in
  // happened. `load` reads both together and is the whole of what this screen
  // shows about the person; the roster beside it is the picker and the name.
  //
  // With nobody picked there is only the picker, so the roster is the whole of
  // what a pull can honestly ask for.
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    r.refresh(),
    ...(picked ? [load(picked, askable), wellnessRefresh()] : []),
  ]), [r, picked, askable, load, wellnessRefresh]));

  // The other half of "can't see the updated body scan". Every coach screen is
  // a tab mounted ONCE (src/ui/refreshOnFocus.ts), and the effect above reads
  // when `picked` changes and at no other time — so a coach who had opened
  // this client's body once went on being shown that read for the life of the
  // app, however many scans the client added afterwards, unless they happened
  // to pull. Coming back to the screen is the moment a coach is asking "has
  // anything changed", so it goes and looks. The scans and the typed figures
  // only: the roster is the dashboard's to refresh, and it does so on its own
  // focus.
  useRefreshOnFocus(useCallback(() => {
    if (!USE_SUPABASE || !picked) return;
    void load(picked, askable);
    void wellnessRefresh();
  }, [picked, askable, load, wellnessRefresh]));

  const fullName = client?.name ?? '';
  const who = fullName ? fullName.split(' ')[0] : 'They';
  /**
   * How this screen refers to the person whose body it is showing.
   *
   * The member's own version of every sentence below is written to them —
   * "your left arm", "you have". A coach is reading about somebody else, and
   * the difference is in the verb as well as the pronoun, which is exactly why
   * `HistoryVoice` carries parts rather than whole sentences with a name
   * dropped into them.
   *
   * A name we do not have must not become "They's", and it must not become
   * "They has" either — which is what this screen said before the voice
   * arrived, because `who` fell back to a plural and the sentences around it
   * were written with a singular verb. The fallback is third-person plural
   * throughout.
   */
  const voice: HistoryVoice = fullName
    ? { they: who, their: `${who}'s`, have: 'has' }
    : { they: 'They', their: 'their', have: 'have' };

  // 'error' hands `bodyBoard` a null, which is the only way it can answer
  // 'unreadable'. Under any other status the history is the server's own answer,
  // and an empty one under 'ready' genuinely means nobody has scanned them.
  const board = useMemo(
    () => bodyBoard(scanStatus === 'error' ? null : history),
    [scanStatus, history],
  );

  /* ── the composition breakdown, off the member's own module ────────────
     `comp` null is a read that did not come back and NOT a client with no
     breakdown; it is held apart here so that neither of the two can be
     rendered by the branch that belongs to the other. Empty-list-on-null would
     collapse them, which is the defect this whole screen is written against. */
  const compTrends = useMemo(() => (comp ? trendsByGroup(comp) : []), [comp]);
  const compInsights = useMemo(() => (comp ? compositionInsights(comp) : null), [comp]);
  /** How many scans carried a breakdown at all — not how many scans there are.
   *  One is the number that changes what the table may say: thirteen readings
   *  and no change is not a change of nothing. */
  const compScans = useMemo(() => (comp ? scansWithMetrics(comp) : 0), [comp]);

  // 'error' hands `measureBoard` a null, which is the only way it can answer
  // 'unreadable'. Under any other status the sites are the server's own answer.
  const tape = useMemo(
    () => measureBoard(measStatus === 'error' ? null : sites),
    [measStatus, sites],
  );

  /* ── which of the silences this is ─────────────────────────────────────
     Three empty screens with three different causes, and a coach acts
     differently on each: the member has not shared (their decision, and not
     ours to describe as an absence), the member shared and has logged nothing
     (the only one a coach may raise with them), and the read failed (unknown).
     `wellnessPanel` holds that precedence and is tested on it; this file only
     draws whichever verdict comes back. */
  const wellnessView = useMemo(
    () => wellnessPanel({
      askable,
      shared: wellness.shared,
      flagStatus: wellness.flagStatus,
      sleepStatus: wellness.sleepStatus,
      waterStatus: wellness.waterStatus,
      sleep: wellness.sleep,
      water: wellness.water,
    }),
    [askable, wellness.shared, wellness.flagStatus, wellness.sleepStatus, wellness.waterStatus, wellness.sleep, wellness.water],
  );

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /** The mark in the circle at the start of each row: the instrument the
   *  metric is read off, not a judgement about the reading. */
  const ROW_ICON: Record<BodyMetricKey, 'scale' | 'target' | 'dumbbell'> = { weight: 'scale', bodyfat: 'target', muscle: 'dumbbell' };

  /**
   * The chosen metric, the board's way: the latest figure large, its movement
   * since the reading before it, the line over the chosen range, the range
   * chips, then every reading in that range as a dated row.
   *
   * The change gets a sign and no colour. Weight falling is what one client is
   * training for and the thing another one is trying to stop, and skeletal
   * muscle falling alongside it means something different again — the record
   * does not say which, so this screen does not paint it in. The board's green
   * "−2.4 kg" is exactly that judgement, and DIRECTION_CAVEAT under the rows
   * says why it is withheld. The only tone on the block is on the AGE, and
   * that is a fact about the record rather than about the body: a reading from
   * four months ago is out of date whatever it says.
   *
   * The movement under the figure is against the reading BEFORE it — the
   * board's "−2.4 kg" is one step — and names the day it is measured from.
   * The movement across everything that came back is `readingLine`, under the
   * chart, where the span is what is being looked at.
   */
  const heroSection = (s: MetricSeries, scans: number) => {
    const unit = metricUnit(s.key, wu);
    const stale = isSeriesStale(s, todayISO);
    const readings = s.readings;
    const latest = readings[readings.length - 1] ?? null;
    const prior = readings.length >= 2 ? readings[readings.length - 2] : null;
    // The window, in days back from the day of the read. `todayISO` is fixed
    // at the moment of the read, so a screen left open over midnight cannot
    // quietly move the window under the coach's eyes. A reading whose date
    // this build cannot parse is left out of the window rather than dated to
    // the epoch; it is still one of `readings`, and still counted.
    const days = range === '1M' ? 31 : range === '3M' ? 93 : range === '6M' ? 186 : 366;
    const rangeWord = range === '1M' ? 'month' : range === '3M' ? '3 months' : range === '6M' ? '6 months' : 'year';
    // Each reading with the one before it, so a row's change is against the
    // reading it actually followed — which for the earliest row in the window
    // is a reading OUTSIDE the window, not "no earlier reading".
    const inRange = readings
      .map((p, i) => ({ p, prior: readings[i - 1] ?? null }))
      .filter(({ p }) => { const age = daysBetweenIso(p.atISO, todayISO); return age != null && age <= days; });
    // Converted for display one point at a time; every CHANGE is converted as
    // a span through `metricDelta`, never off two rounded ends.
    const vals = inRange.map(({ p }) => metricValue(p.v, s.key, wu));
    const mv = movementOf(s);
    const figure = latest ? plain(metricValue(latest.v, s.key, wu)) : null;
    const moved = latest && prior
      ? deltaLabel(metricDelta(latest.v - prior.v, s.key, wu), { since: dayHeading(prior.atISO), unit })
      : readingLine(s, wu);
    const age = seriesAgeLine(s, todayISO);
    return (
      <>
        <Section>
          {/* One stop for the ear: label, figure, movement, age. Four Texts
              were four stops that read as four unrelated facts. */}
          <View accessible accessibilityLabel={`${s.label}, ${figure == null ? 'no reading' : `${figure} ${unit}`}. ${moved} ${age}`}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{s.label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: sp.sm }}>
              {/* A dash, never a zero. A metric nobody has measured has no
                  figure, and "0 kg" is a specific and false claim about a body. */}
              <Text style={{ ...value(32), color: t.ink }}>{fig(figure)}</Text>
              {latest ? (
                <Text style={{ ...ty.body, ...numeric, color: t.ink3, marginStart: 5 }}>{unit}</Text>
              ) : null}
            </View>
            <Text style={{ ...ty.label, color: t.ink2, marginTop: 3 }}>{moved}</Text>
            {/* seriesAgeLine already says how old the reading is. warn as micro
                ink is 3.87–4.08:1 on the light palettes, so it goes in the dot. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sp.xs }}>
              {stale ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
              <Text style={{ ...ty.micro, color: stale ? t.ink2 : t.ink3, flex: 1 }}>{age}</Text>
            </View>
          </View>

          {/* A line needs two points. One reading is drawn as the reading it
              is — a figure and a date — rather than as a trend through a single
              point, which is the thing this screen was asked to stop doing.
              `labels` is what puts a DATE on the readout when the coach touches
              the line. */}
          {vals.length > 1 ? (
            <View style={{ marginTop: sp.lg }}>
              <Spark data={vals} labels={inRange.map(({ p }) => p.atISO)} unit={` ${unit}`} />
              {/* The whole span that came back, not the window: `readingLine`
                  words it "since ⟨date⟩" rather than "since their first scan"
                  because under a truncated read the oldest scans are the ones
                  that did not arrive. */}
              {mv ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{readingLine(s, wu)}</Text>
              ) : null}
            </View>
          ) : readings.length > 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
              {readings.length === 1
                ? 'One reading is drawn as the reading it is — a figure and a date — rather than as a trend through a single point.'
                : inRange.length === 0
                  ? `Nothing in the last ${rangeWord}. Widen the range to see the trend.`
                  : `One reading in the last ${rangeWord} — widen the range to see the trend.`}
            </Text>
          ) : null}

          {/* The kit's Segmented. The range stays ON the card whose line it
              changes — the review's rule 8 — and each abbreviation is said in
              full, because "3M" is read out as "three em". */}
          <Segmented style={{ marginTop: sp.lg }} value={range} onChange={setRange}
            options={[
              { key: '1M', label: '1M', a11yLabel: 'Last month' },
              { key: '3M', label: '3M', a11yLabel: 'Last 3 months' },
              { key: '6M', label: '6M', a11yLabel: 'Last 6 months' },
              { key: '1Y', label: '1Y', a11yLabel: 'Last year' },
            ] as const} />
        </Section>

        {/* ── every reading in the window, newest first ──────────────────
            The board's dated list. Each row is one scan's figure for this
            metric, the day it was taken, its change against the reading
            before it, and the chip saying how it was taken — the mark that
            tells a coach looking at an outlier which instrument they are
            looking at. */}
        <Section>
          <SectionHead
            title={s.label}
            note={`${scans === 1 ? '1 scan' : `${scans} scans`} · ${inRange.length} in the last ${rangeWord}`}
          />
          {inRange.length === 0 ? (
            <Text style={{ ...ty.body, color: t.ink2 }}>
              {readings.length ? `No ${s.label.toLowerCase()} reading in the last ${rangeWord}. Widen the range to see earlier ones.` : readingLine(s, wu)}
            </Text>
          ) : inRange.slice().reverse().map(({ p, prior: before }, i) => {
            const v = plain(metricValue(p.v, s.key, wu));
            // Under 'partial' the row with nothing before it is the earliest
            // that ARRIVED; calling it the first would be a claim the read
            // cannot support.
            const d = before
              ? deltaLabel(metricDelta(p.v - before.v, s.key, wu), { since: null, unit })
              : isWhole(scanStatus) ? 'First reading' : 'Earliest that arrived';
            const how = sourceChip(readSource(p.source));
            return (
              <View key={`${p.atISO}-${i}`} accessible
                accessibilityLabel={`${v} ${unit}, ${dayHeading(p.atISO)}. ${d}. ${how}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                {/* A circle, as the board draws every row's icon. */}
                <View style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={ROW_ICON[s.key]} size={17} color={t.ink2} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{v} {unit}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dayHeading(p.atISO)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{d}</Text>
                  <SourceChip source={p.source} />
                </View>
              </View>
            );
          })}
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{DIRECTION_CAVEAT}</Text>
        </Section>
      </>
    );
  };

  /**
   * One composition metric: what the sheet last said, how far it moved since
   * the scan before it that measured the same thing, and — on a tap — every
   * reading behind it.
   *
   * Two things here are said differently from the member's own version of this
   * row, and both are the same correction. Their screen prints an em dash for a
   * metric with one reading AND for a metric that genuinely did not move, so
   * two opposite facts wear one mark. A coach reading thirteen rows at a glance
   * gets the words instead: "1 reading" where there is nothing to compare
   * against, "unchanged" where there is and it did not.
   *
   * The figure goes through `numUpTo` rather than being interpolated: BMR is
   * the one metric here that passes a thousand, and 1750 with no separator is
   * the defect check-numbers.mjs exists for. It also puts the decimal
   * separator in the reader's own language, which a bare interpolation cannot.
   */
  const compRow = (it: MetricTrend) => {
    const key = String(it.def.key);
    const open = compOpen === key;
    // A series with one point has no line to draw, so the row is not a control
    // at all rather than a control that does nothing when a screen reader
    // announces it as one.
    const canOpen = it.series.length >= 2;
    const figure = `${numUpTo(it.latest, it.def.decimals ?? 0)} ${it.def.unit}`;
    const moved = it.delta == null
      ? 'One reading, so there is nothing to compare it against.'
      : deltaLabel(it.delta, { since: null, decimals: it.def.decimals ?? 0, noChange: 'unchanged' });
    const inner = (
      <>
        <Text style={{ ...ty.label, color: t.ink2 }}>
          {it.def.label}{canOpen ? (open ? '  \u25B4' : '  \u25BE') : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink }}>{figure}</Text>
          {it.delta == null ? (
            <Text style={{ ...ty.caption, color: t.ink3, minWidth: 62, textAlign: END_ALIGN }}>1 reading</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 62, justifyContent: 'flex-end' }}>
              {/* No dot on a movement of nothing. `good` is null there by
                  construction, and a neutral dot beside the word "unchanged"
                  is a mark standing in for an absence of one. */}
              {it.good != null ? (
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: it.good ? t.brand : t.warn, flexShrink: 0 }} />
              ) : null}
              <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{moved}</Text>
            </View>
          )}
        </View>
      </>
    );
    const rowStyle = {
      flexDirection: 'row' as const, alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring,
    };
    return (
      <View key={key}>
        {canOpen ? (
          <Pressable
            onPress={() => setCompOpen(open ? null : key)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            // Assembled for the ear, not lifted off one field of the row: a
            // label on a Pressable REPLACES everything its children say, so a
            // bare `it.def.label` here would drop the figure and the change.
            accessibilityLabel={`${it.def.label}, ${figure}. ${moved}.`}
            accessibilityHint="Shows every reading behind this figure"
            style={rowStyle}
          >
            {inner}
          </Pressable>
        ) : (
          <View style={rowStyle}>{inner}</View>
        )}
        {open && canOpen ? (
          <View style={{ paddingVertical: sp.sm }}><Spark data={it.series} h={54} /></View>
        ) : null}
      </View>
    );
  };

  /**
   * One tape site: what it said, how it has moved, and how old that is.
   *
   * The same row as app/(trainer)/client-goals.tsx draws, deliberately, and
   * through the same module — a waist figure that reads one way on the goals
   * screen and another here is the friction the shared module exists to stop.
   * The change gets a sign and no colour: the client's own screen paints a fall
   * in `t.brand`, which is right on the screen of the person who knows what
   * they are training for and wrong on one where a coach reads five sites at
   * once and the same green would mean "good" on a waist and "losing the arm
   * they are building" one line below it.
   */
  const siteRow = (h: SiteHistory, i: number) => {
    const stale = isSiteStale(h, todayISO);
    return (
      <View key={h.key} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
          <Text style={{ ...ty.body, color: t.ink, fontWeight: '600' }}>{h.label}</Text>
          <Text style={{ ...ty.body, ...numeric, color: t.ink, fontWeight: '500' }}>
            {fig(lengthLabel(h.latest.cm, lu))}
          </Text>
        </View>
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{siteChangeLine(h, lu)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sp.xs }}>
          {stale ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
          <Text style={{ ...ty.micro, color: stale ? t.ink2 : t.ink3, flex: 1 }}>{siteAgeLine(h, todayISO)}</Text>
        </View>
      </View>
    );
  };

  const G = layout.gutter;

  /**
   * The client picker. Above everything while nobody is chosen, because there
   * is nothing else to draw; under the record once somebody is, because the
   * board opens this screen on a client's figure and not on a list of names.
   * The screen is reachable without a param, so the picker cannot go.
   */
  const picker = (
    <Section>
      <SectionHead title={picked ? 'Switch Client' : 'Client'} />
      {r.roster.length === 0 && isWhole(r.status) ? (
        <EmptyRoster lacks="there are no scans to look at" />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {r.roster.map((c) => (
            <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
              accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
              accessibilityLabel={c.name} style={chip(picked === c.id)}>
              <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Section>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── the board's head: back, and the title on the centre line ────
            The client's name sits under it because this is one person's
            record and the picker that names them is now below the fold. */}
        <PageHead title="Progress" subtitle={fullName || undefined} />

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Scans belong to the client and live on the server, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have never been scanned." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            {!picked ? picker : null}

            {/* ── Weight / Body Fat / Muscle / Photos, as the board draws them
                The first three are the series this screen reads; Photos is
                the pictures this client has sent, which are their own screen
                under their own grant (see client-photos.tsx) and are opened
                there rather than drawn here. */}
            {picked ? (
              <Segmented style={{ marginTop: sp.lg }} value={metric} onChange={(k) => { if (k !== 'photos') setMetric(k); }}
                options={[
                  /* "Skeletal Muscle" is the series' name and does not fit
                     a quarter of the bar; the hero under it says it in full,
                     and so does the spoken label. */
                  ...BODY_METRICS.map((m) => ({ key: m.key, label: m.key === 'muscle' ? 'Muscle' : m.label, a11yLabel: m.label })),
                  /* A segment that goes somewhere instead of selecting: the
                     kit never draws it as chosen. */
                  { key: 'photos' as const, label: 'Photos',
                    onPress: () => router.push({ pathname: '/(trainer)/client-photos', params: { clientId: picked, name: fullName } } as any) },
                ]} />
            ) : null}

            {picked && !askable ? (
              /* ── the third answer ──────────────────────────────────────────
                 It takes the WHOLE body rather than one section of it. Every
                 panel below — the scan cadence, the scans, their profile, the
                 tape, the sleep and water they share — is the same absent
                 record said six ways, and each has its own sentence about the
                 person. A notice on top of six of those is still six of those,
                 and the cadence panel in particular is drawn under EVERY status
                 by design, so it would have gone on saying how often somebody
                 with no account is being scanned.

                 The Unreadable notice below used to hedge at this case — "If
                 they were added to your book by hand they have no account for
                 scans to belong to, which reads the same way from here." It
                 does not read the same way from here: `askable` knows, because
                 the roster knows which of its two tables the row came from. So
                 the guess is gone from that notice, where it was shown to every
                 coach whose connection had merely dropped, and the case it was
                 guessing at is this branch.

                 The same distinction `wellnessPanel`'s `not-asked` kind keeps
                 apart from `unreadable` in src/lib/coachWellness.ts. */
              <View>
                <Rule />
                <Section>
                  <Notice kicker="No account" title={`${fullName || 'This client'} has no Repple account`}
                    note={`You added ${who} to your book by hand, so there is no account for a scan, a weigh-in, a tape measurement or a night's sleep to belong to. Nothing of theirs was asked for and nothing was refused — this is not an empty body-composition record and it is not a failed read. Invite them from your client list and this screen fills in from the day they accept.`} />
                </Section>
              </View>
            ) : picked ? (
              <View>
                {/* The states, kept apart. Each is a different fact about this
                    person and each starts a different conversation. */}
                {scanStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their scans…</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their scans could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${voice.they} ${voice.have} never been scanned — that is a different fact and a different conversation.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their Scans'} note="never scanned" />
                    {/* "The read came back and it was empty" is only true when
                        nothing was dropped. Rows that arrived and could not be
                        used are a different story, and the flag below tells it
                        rather than letting this sentence overstate. */}
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {voice.they} {voice.have}n&rsquo;t recorded a usable InBody scan.
                      {history && history.skipped > 0
                        ? ' Rows did come back; none of them carried a dated figure this build can read.'
                        : ' The read came back and it was empty, so this is about them rather than about the connection — which makes it worth raising.'}
                      {' '}Their own app records a scan from a photo of the sheet.
                    </Text>
                  </Section>
                ) : (
                  <>
                    {heroSection(seriesOf(board.history, metric), board.history.scans)}

                    {/* ── the rest of the sheet ─────────────────────────────
                        Three columns is not a body composition. Everything
                        above comes off `weight_kg`, `body_fat_pct` and
                        `skeletal_muscle_kg`; this is `scans.metrics` — the
                        thirteen figures the member has been reading on their
                        own Progress screen, under the same four headings, with
                        the same improving / watch / balance line over the top.

                        Every one of them is computed in
                        src/lib/inbodyMetrics.ts, which both screens call. There
                        is no second composition rule in this tree. */}
                    <Rule />
                    <Section>
                      {/* A count of BREAKDOWNS, not of scans, because they are
                          usually different numbers and the difference is what
                          a coach needs: six scans and one sheet is one reading
                          of everything below it. "None" is only said under a
                          whole read — under 'partial' the sheets that did not
                          arrive are the oldest, and naming zero would be
                          counting rows nobody asked for. */}
                      <SectionHead
                        title="Composition"
                        note={compScans === 0 ? (isWhole(scanStatus) ? 'no breakdown' : 'not shown')
                          : compScans === 1 ? 'one breakdown'
                          : `${compScans} breakdowns`}
                      />
                      {/* The same sentence the client's own screen carries, for
                          the same reason: this table is a transcription of an
                          InBody printout and is not converted, while the weight
                          and muscle figures above it are in the reader's unit. A
                          coach comparing the two needs to know that is on
                          purpose before they query it with the client. */}
                      {compTrends.length > 0 ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                          As their InBody printed it — kilograms, litres and its own
                          scores. The figures above are in your unit.
                        </Text>
                      ) : null}
                      {compTrends.length === 0 || compInsights == null ? (
                        // The FOURTH state, and the one only this table has:
                        // scans exist and none of them carried a breakdown.
                        // `isWhole` rather than a check for 'error' — under
                        // 'partial' the rows that did not arrive are the oldest,
                        // so a client whose only sheet-read scans are from
                        // February would be told they have never had one.
                        <Text style={{ ...ty.body, color: t.ink2 }}>
                          {isWhole(scanStatus)
                            ? `Their scans carry a weight, a body fat and — sometimes — a muscle figure, and none of them carries the full breakdown: no visceral fat, no InBody score, no BMR, no fat or lean mass, no limb-by-limb lean, no water, protein or minerals. Those fields are written when a scan is read from a photograph of the printout, so a figure typed in by hand leaves this part of the record empty. It is not a gap in what ${voice.they} ${voice.have} done — the three series above are ${voice.their} scans, in full.`
                            : `The breakdown is withheld because this read came back at the row limit, and the scans that did not arrive are the oldest. An empty table here would say ${voice.their} sheets carry nothing, which is not something a partial read can know. Pull down to read again.`}
                        </Text>
                      ) : (
                        <>
                          <Text style={{ ...ty.label, color: t.ink3 }}>{COMPOSITION_CAVEAT}</Text>
                          {/* One scan is not a change. Said in a sentence
                              rather than left to thirteen dashes, because a
                              dash beside a figure reads as "it did not move". */}
                          {compScans === 1 ? (
                            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>
                              One scan carries a breakdown, so every figure below is a reading and
                              none of them is a change. A second sheet is what turns this into
                              progress; until there is one, &ldquo;1 reading&rdquo; beside a metric
                              means exactly that, and not that it has stood still.
                            </Text>
                          ) : null}
                          {compInsights.improving.length > 0 || compInsights.watch.length > 0 || compInsights.balance.length > 0 ? (
                            <View style={{ marginTop: sp.md, marginBottom: sp.lg }}>
                              {compInsights.improving.length > 0 ? (
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand, marginTop: 6 }} />
                                  <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>
                                    <Text style={{ fontWeight: '500', color: t.ink }}>Improving  </Text>
                                    {compInsights.improving.join('  \u00B7  ')}
                                  </Text>
                                </View>
                              ) : null}
                              {compInsights.watch.length > 0 ? (
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 6 }}>
                                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, marginTop: 6 }} />
                                  <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>
                                    <Text style={{ fontWeight: '500', color: t.ink }}>Watch  </Text>
                                    {compInsights.watch.join('  \u00B7  ')}
                                  </Text>
                                </View>
                              ) : null}
                              {/* Left-right balance is the one reading a
                                  SINGLE sheet can support — it compares two
                                  limbs on the same day rather than one limb
                                  across two days — so it survives the
                                  one-breakdown case above, correctly. */}
                              {compInsights.balance.map((b) => (
                                <Text key={b} style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{b}</Text>
                              ))}
                            </View>
                          ) : null}
                          {compTrends.map((grp) => (
                            <View key={grp.group} style={{ marginBottom: sp.lg }}>
                              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{grp.group}</Text>
                              {grp.items.map(compRow)}
                            </View>
                          ))}
                          <Text style={{ ...ty.micro, color: t.ink3 }}>
                            Left in the units the InBody sheet itself printed — kilograms beside
                            litres, kcal, points and a visceral-fat level — and not converted into
                            the weight unit you read the three series above in. The segmental lean
                            figures are carried to a hundredth of a kilogram, a grain whole pounds
                            cannot represent at all, and converting them would need a second and
                            finer rule for pounds than the rest of this app uses. Two rules for one
                            unit is how the same reading ends up printed two ways.
                          </Text>
                        </>
                      )}
                    </Section>
                  </>
                )}

                {/* How often this person is actually being scanned. It sat
                    above the readings — because the cadence decides what the
                    latest figure is worth: a single scan in March is not a
                    trend, and a gap since January is the fact that starts the
                    conversation rather than the number at the top of it. The
                    board opens on the figure and its line, so the cadence now
                    sits directly under them and ahead of the rest of the
                    sheet; the age line under the figure carries the same
                    warning into the first viewport.

                    Drawn under every status: the panel distinguishes a failed
                    read, a truncated one and genuinely-too-few itself, and a
                    coach seeing nothing here would read it as "scanned often
                    enough", which is the one thing it must never imply. */}
                <ScanCadencePanel
                  days={(scanRows ?? []).map((r) => r.day)}
                  status={scanRows === null ? 'error' : scanStatus}
                  today={todayISO}
                  subject={{ they: voice.they, have: voice.have }} />

                {/* Two things the sections above cannot say for themselves. */}
                {scanStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their scans came back at the row limit, so the newest are here and the oldest
                      are not. Every change above is measured from the earliest reading that
                      arrived, which is why each one names the date it is measured from rather than
                      calling it their first scan.
                    </Flag>
                  </Section>
                ) : null}
                {history && history.skipped > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {history.skipped === 1
                        ? 'One further row is on record carrying no date, or no figure this build can read, so it is not counted or drawn above.'
                        : `${history.skipped} further rows are on record carrying no date, or no figure this build can read, so they are not counted or drawn above.`}
                    </Flag>
                  </Section>
                ) : null}

                {/* ── what they typed ───────────────────────────────────────
                    Separate from the series above, and labelled, because a
                    figure somebody typed and a figure a machine measured are
                    not the same kind of thing — and because this is what the
                    client is looking at on their own phone. */}
                <Rule />
                {manualStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their profile…</Text></Section>
                ) : manualStatus === 'error' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their profile could not be read"
                      note={`Whether ${voice.they} ${voice.have} typed a weight or body fat by hand is unknown rather than no. The scans above came from a different read and are unaffected either way.`} />
                  </Section>
                ) : manual == null ? (
                  <Section>
                    <SectionHead title="Typed by Hand" note="none" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      Nothing typed. Every figure above came off a scan sheet, so there is no
                      hand-entered number sitting under the same heading as a machine reading.
                    </Text>
                  </Section>
                ) : (
                  <Section>
                    <SectionHead title="Typed by Hand" note="not a scan" />
                    {/* Which figure the client's own app is showing them is a
                        comparison against their newest scan, so it can only be
                        made once that read has landed. Under a failed or
                        in-flight scan read the figures are still shown and the
                        comparison is withheld — saying "there is no scan on
                        record" when nobody could ask would be a claim about
                        their record made out of our connection. */}
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {
                        // whole-ok: 'partial' falls through to `manualLine` on
                        // purpose, because the only thing this line asks of the
                        // scan read is which of two dates is NEWER — the
                        // client's typed entry, or their latest scan.
                        // `capped()` hands back the newest rows, so the newest
                        // scan under a truncated read is the same row it would
                        // be under a whole one; the truncation eats the OLDEST
                        // scans, which this comparison never looks at.
                        // `manualLine`'s one dangerous branch is the
                        // null-latestScanISO sentence, "there is no scan on
                        // record", and that is unreachable here: 'partial'
                        // means the page came back FULL, so there are a
                        // thousand scans and a newest among them. The section
                        // that does COUNT scans is a hundred and fifty lines up
                        // and gated on `isWhole`, and this screen's own
                        // row-limit note sits at the top of the same block.
                        scanStatus === 'error' || scanStatus === 'loading'
                          ? `${manualFigures(manual, wu, who)} Their scans could not be read just now, so which of the two their own app is showing them cannot be said from here.`
                          : manualLine(manual, history?.latestScanISO ?? null, wu, who)
                      }
                    </Text>
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                      Deliberately not a point on any line above. A set of bathroom scales and an
                      InBody disagree by more than most of what anybody is training for, so a change
                      measured across the two would be reporting the equipment rather than the body.
                    </Text>
                  </Section>
                )}

                {/* ── the tape ────────────────────────────────────────────
                    The other half of "InBody scan / updated measurements", and
                    the record that moves when the scale does not: a client
                    whose weight has not shifted in six weeks can still have
                    lost two centimetres off their waist and put one on their
                    arm. `measurements_coach_read` has granted this since
                    supabase/parts/02 and this screen never asked for it, so a
                    coach looking at Body Composition had to open the goals
                    screen to find out whether the body had changed.

                    Its own read and its own status, so four states again —
                    and a refused measurements read never renders as a client
                    who has stopped measuring. */}
                <Rule />
                {measStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their tape measurements…</Text></Section>
                ) : tape.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their tape measurements could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${voice.they} ${voice.have} never measured — everything above came from different reads and is unaffected either way.`} />
                  </Section>
                ) : tape.state === 'none' ? (
                  <Section>
                    <SectionHead title="Tape" note="none recorded" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {voice.they} {voice.have}n&rsquo;t logged a tape measurement. The read came back
                      and it was empty, so this is about them rather than about the connection —
                      and it is the one record that moves when the scale doesn&rsquo;t.
                    </Text>
                  </Section>
                ) : (
                  <Section>
                    <SectionHead title="Tape" note={`${tape.sites.length} ${tape.sites.length === 1 ? 'site' : 'sites'}`} />
                    <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>{TAPE_CAVEAT}</Text>
                    {tape.sites.map(siteRow)}
                    {/* Only under a whole read. Under 'partial' a site is
                        missing from the list either because nobody has measured
                        it or because its rows are older than the row limit, and
                        naming it as never measured would pick the wrong one. */}
                    {isWhole(measStatus) && unmeasuredSites(tape.sites).length > 0 ? (
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                        Nothing on record for {unmeasuredSites(tape.sites).join(', ').toLowerCase()} — the
                        client&rsquo;s own screen offers those boxes and they have been left empty.
                      </Text>
                    ) : null}
                  </Section>
                )}

                {measStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their measurements came back at the row limit, so the newest are here and
                      older ones may not be. A site showing one reading may have earlier ones that
                      did not arrive, and every change is measured against the most recent earlier
                      reading that did.
                    </Flag>
                  </Section>
                ) : null}
                {unreadableMeas > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {unreadableMeas === 1
                        ? 'One more measurement is on record in a shape this version of the app cannot show, so it is not counted above.'
                        : `${unreadableMeas} more measurements are on record in a shape this version of the app cannot show, so they are not counted above.`}
                    </Flag>
                  </Section>
                ) : null}

                {/* ── the nights and glasses they type in themselves ──────
                    Backlog item Coach #33, built the way its refusal asked for
                    rather than the way it was first written. `sleep_logs` and
                    `hydration_logs` had exactly one policy each — the member's
                    own — and part 109 refused to add a blanket coach read on
                    the grounds that it would be the only sleep source skipping
                    a member-controlled switch, for exactly the members with no
                    wearable. supabase/parts/2670 is the switch; this is its
                    reader.

                    Nothing below is drawn from an absence. RLS answers a coach
                    reading a member who has not shared with zero rows and NO
                    error, which at the wire is identical to a member who
                    shared and logged nothing — so the consent flag is read
                    alongside the logs and `wellnessPanel` decides which of the
                    two sentences is true. */}
                <Rule />
                <Section>
                  <SectionHead
                    title="Sleep &amp; Water"
                    note={wellnessView.kind === 'shared' ? `last ${WELLNESS_WINDOW_DAYS} days` : undefined} />
                  {wellnessView.kind === 'not-asked' ? (
                    <Text style={{ ...ty.body, color: t.ink2 }}>{notAskedLine(voice)}</Text>
                  ) : wellnessView.kind === 'loading' ? (
                    <Text style={{ ...ty.body, color: t.ink3 }}>Reading what they have chosen to share…</Text>
                  ) : wellnessView.kind === 'unreadable' ? (
                    // Never "they have not shared" and never "nothing logged".
                    // Both would be facts about the member invented out of our
                    // own failed read.
                    <Notice tone={t.warn} kicker="Unreadable" title="This could not be read"
                      note={unreadableLine(voice)} />
                  ) : wellnessView.kind === 'not-shared' ? (
                    // Says nothing whatever about whether there is anything to
                    // see. That half is not this account's to infer.
                    <Text style={{ ...ty.body, color: t.ink2 }}>{notSharedLine(voice)}</Text>
                  ) : (
                    <>
                      {/* ── the nights ──────────────────────────────────── */}
                      {wellness.sleepStatus === 'error' ? (
                        <Flag tone={t.warn}>
                          Their sleep log could not be read just now. This is not a statement that
                          there are no nights in it.
                        </Flag>
                      ) : wellnessView.nights.length === 0 ? (
                        <Text style={{ ...ty.body, color: t.ink2 }}>
                          {/* Only sayable because the read finished AND came
                              back whole. Under 'partial' an empty list would
                              mean the page was full of something else, which
                              cannot happen — but the gate is stated rather
                              than reasoned about at every call site. */}
                          {wellnessView.nightsWhole
                            ? nothingLoggedLine(voice)
                            : 'Their nights came back at the row limit, so nothing can be said about what is in them.'}
                        </Text>
                      ) : (
                        <>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                            <Text style={{ ...ty.title, ...numeric, color: t.ink }}>
                              {/* A dash, not a zero, whenever the set is not
                                  known to be whole — an average over a prefix
                                  of somebody's nights is not their average. */}
                              {fig(averageHours(wellnessView.nights, wellnessView.nightsWhole) == null
                                ? null
                                : numUpTo(averageHours(wellnessView.nights, wellnessView.nightsWhole), 1))}
                            </Text>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              hours a night on average, over {wellnessView.nights.length}{' '}
                              {wellnessView.nights.length === 1 ? 'night' : 'nights'} they logged
                            </Text>
                          </View>
                          {wellnessView.nights.slice(0, 8).map((n) => (
                            <View key={n.night} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.sm }}>
                              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{fmtDay(n.night)}</Text>
                              {/* Two entries for one night are shown as two.
                                  Averaging them would print a figure the
                                  member never typed, which is the move
                                  src/lib/readiness.ts refuses to make and is
                                  not going to be made here for a coach. */}
                              {n.entries.map((e, j) => (
                                <Text key={j} style={{ ...ty.caption, ...numeric, color: t.ink2 }}>
                                  {numUpTo(e.hours, 1)}h{' '}
                                  <Text style={{ color: t.ink3 }}
                                    accessibilityLabel={`quality ${Math.round(e.quality)} out of 5`}>
                                    {qualityMarks(e.quality)}
                                  </Text>
                                </Text>
                              ))}
                            </View>
                          ))}
                          {!wellnessView.nightsWhole ? (
                            <Flag tone={t.warn} style={{ marginTop: sp.md }}>{truncatedLine('nights')}</Flag>
                          ) : null}
                        </>
                      )}

                      {/* ── the water ───────────────────────────────────── */}
                      <Rule inset={0} />
                      {wellness.waterStatus === 'error' ? (
                        <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                          Their water count could not be read just now, so no day below is a day
                          they drank nothing.
                        </Flag>
                      ) : wellnessView.water.length === 0 ? (
                        <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
                          {wellnessView.waterWhole
                            ? `No day in the last ${WELLNESS_WINDOW_DAYS} days has a glass count. A day with no row is a day they did not use the counter, which is not a day they drank nothing.`
                            : 'Their water counts came back at the row limit, so nothing can be said about them.'}
                        </Text>
                      ) : (
                        <>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md, marginTop: sp.md }}>
                            <Text style={{ ...ty.title, ...numeric, color: t.ink }}>
                              {fig(averageGlasses(wellnessView.water, wellnessView.waterWhole) == null
                                ? null
                                : numUpTo(averageGlasses(wellnessView.water, wellnessView.waterWhole), 1))}
                            </Text>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {/* The divisor is days RECORDED, printed beside
                                  the figure so a coach can see how thin it is.
                                  Dividing by days elapsed would report every
                                  day they did not open the app as a zero. */}
                              glasses on average, across {wellnessView.water.length}{' '}
                              {wellnessView.water.length === 1 ? 'day' : 'days'} they counted
                            </Text>
                          </View>
                          {!wellnessView.waterWhole ? (
                            <Flag tone={t.warn} style={{ marginTop: sp.md }}>{truncatedLine('days')}</Flag>
                          ) : null}
                        </>
                      )}

                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                        These are typed in by hand, not measured by a device, and {voice.they}{' '}
                        {voice.have} chosen to show them to you. {voice.they} can turn that off at
                        any time, and doing so hides what is above as well as what comes next.
                      </Text>
                    </>
                  )}
                </Section>
              </View>
            ) : null}

            {picked ? picker : null}
          </>
        )}

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Every InBody scan a client has recorded — the three series with the date of each
          reading, the full composition breakdown off the sheet, and their tape measurements. You
          can read these; you can&rsquo;t change them — a scan is theirs to take and theirs to
          enter.
        </Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          Body fat is a percentage and reads the same in every unit system. Weight and skeletal
          muscle are stored in kilograms, tape measurements in centimetres, and both are shown in
          the units you set on your own Settings screen; every change is converted once, as a span,
          so the same movement cannot report two different figures on two different months. The
          composition table is the one exception, and says so where it stands: it is a
          transcription of a printout and stays in the printout&rsquo;s own units.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
