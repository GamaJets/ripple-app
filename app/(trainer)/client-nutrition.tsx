// Coach · Nutrition. One client's targets, and the week of meals their coach
// writes them.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// A coach could already move a client's calories and macros — `coach_nutrition`
// carries four deltas and a note, and the client's Meals tab layers them
// through `applyCoachAdjust`. What they could not do is write a plan. The only
// authoring that existed was `meal_override`: a flat position → catalogue-index
// map that pins one meal per slot for ONE day, with no weekday attached to it,
// edited nowhere in the coach app at all. A client could be told what to eat on
// an unnamed day and nothing else.
//
// This composes a week. Seven days, each with the client's own slots, each slot
// a meal from the catalogue their diet and their allergens define — and the
// macros that follow from those meals, computed by the same `buildPlan` their
// own phone runs, so the coach is looking at the client's screen rather than an
// approximation of it.
//
// ── Nothing here works out what anybody should eat ─────────────────────────
//
// Every calorie and macro figure on this screen comes from `macrosFor` in
// src/lib/nutrition.ts — Katch–McArdle from the client's own weight, body fat
// and activity, adjusted by the goal-and-date plan in src/lib/goalEnergy.ts —
// with this coach's own deltas layered on by `applyCoachAdjust`. This file
// computes none of it and stores none of it. A coach choosing a calorie target
// is a coaching decision; the app does not turn it into a clinical one, does
// not diagnose, and nowhere tells anybody a figure is safe. The one sentence
// this screen writes about the arithmetic (`planServingNote`) says what the
// client's app will do with the portions and passes no judgement on either
// number.
//
// ── The allergens are not advice, they are the index space ─────────────────
//
// `clients.avoid` and `clients.diet` are surfaced at the top of this screen the
// way app/(trainer)/builder.tsx surfaces a client's injuries, and for a harder
// reason than good manners. `mealAt(diet, slot, idx, avoid)` resolves an index
// through pools that `avoid` has already FILTERED, so shrinking a pool
// renumbers every index after it: the same number is a different dinner. Every
// meal composed here is therefore picked from the client's OWN filtered
// catalogue, the filter is stored with the plan, and `planStale` in
// src/lib/mealPlan.ts is what notices when the client has moved out from under
// it — a nut allergy disclosed on Wednesday against a plan written on Monday.
//
// `guardPlan` withholds the send until that read has landed. Composing a plan
// over an allergen list that did not load is exactly how a disclosed allergen
// reaches a client, and it is the same refusal `guardInjuries` makes on the
// program builder.
//
// ── The client's food log is read, never written ───────────────────────────
//
// It is not read here at all. What they logged is theirs; this screen is about
// what their coach is proposing, and mixing the two would put a coach's
// authoring inside a record only the client may add to.
//
// ── Four states, kept apart ────────────────────────────────────────────────
//
// A read that failed, a read that came back truncated, a client with no plan,
// and a plan. An unread plan is NEVER drawn as "no plan set": that would tell a
// coach their client has nothing while a week sits on the server, and invite
// them to overwrite it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mealPhoto } from '../../src/ui/mealPhotos';

import { titleCaseName, mealTitle, mealTitleParts } from '../../src/lib/exerciseName';// The instant the energy plan's deadline is measured against, recomputed at
// local midnight, on foreground and on focus. See the memo below.
import { useNow } from '../../src/ui/today';
import { View, Text, ScrollView, Pressable, Modal, TextInput, Alert, Linking, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, PageHead, Cta, Notice, Flag, Meter, Ring, Expandable, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, font } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { useRoster } from '../../src/ui/roster';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { isoToday } from '../../src/lib/dayPlan';
import { num } from '../../src/lib/format';
import { readGoals, seriesFrom, type GoalRow, type ScanRow, type WeighInRow } from '../../src/lib/clientGoals';
import { energyPlanFor } from '../../src/lib/goalEnergy';
import { maintenanceFor, DIET_LABEL, macroWords } from '../../src/lib/nutrition';
import {
  buildPlan, catalogSize, searchMeals, swapIndex, ALLERGENS, excludedAllergens, normaliseDislike, preferNotDisliked,
  readAllergenColumn, readDislikes, type Allergen, type PlanInput, type Slot,
} from '../../src/lib/meals';
import { writeFailure } from '../../src/lib/wroteRows';
import {
  PLAN_DAYS, PLAN_WEEKDAYS, copyPlanDay, guardPlan, planDayBaseKcal, planDayIndex,
  planDayOverride, planEmptySlotsLine, planProteinNote, planServingNote, planStale, planStaleLine, seedPlan, setPlanMeal,
  type CoachMealPlan,
} from '../../src/lib/mealPlan';
import {
  RECIPE_ATTRIBUTION, RECIPE_DISCLAIMER, portionRecipe,
} from '../../src/lib/recipes';
import {
  coachRecipeRefAt, coachRecipeSearch, copyCoachRecipeDay, hasCoachRecipes,
  withCoachRecipeAt, withoutCoachRecipeAt, type CoachRecipeRefs,
} from '../../src/lib/coachRecipeRefs';
import { useRecipeSearch } from '../../src/ui/useRecipeSearch';
import { GuardedImage } from '../../src/ui/GuardedImage';
import { hitSlopFor } from '../../src/lib/a11y';
import type { Diet, Goal } from '../../src/lib/types';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import { FORWARD_ARROW, FORWARD_ICON } from '../../src/ui/direction';

const CLIENT_COLS = 'diet, meals_per_day, avoid, coach_avoid, dislikes, goal, activity, manual_weight_kg, manual_body_fat_pct';
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg';
const CHECKIN_COLS = 'at, weight_kg';
const GOAL_COLS = 'id, kind, target_value, title, target_date, achieved_at, created_at';

const DIETS: readonly Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const GOALS: readonly Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat Loss', tone: 'Tone', muscle: 'Build Muscle' };
const ALLERGEN_LABEL = new Map(ALLERGENS.map((a) => [a.id, a.label]));

/** The recipe library's backlink. Reported rather than swallowed, so a handset
 *  with no browser for it is a line in telemetry and not a dead tap. */
const openLink = (where: string, url: string) => { Linking.openURL(url).catch((e) => reportError(where, e)); };

/** The client's row, as much of it as this screen can use. Every field is
 *  nullable because every one of them is nullable in the table, and a missing
 *  one is a fact about the profile rather than a value to substitute. */
interface Profile {
  diet: Diet | null;
  mealsPerDay: 3 | 4 | 5 | null;
  /** EVERYTHING kept out of their meals: `excludedAllergens(ownAvoid,
   *  coachAvoid)`. Every filter on this screen reads this, never `ownAvoid`. */
  avoid: Allergen[];
  /** The member's own list. Theirs alone: the database refuses a coach's
   *  change to it (clients_avoid_is_the_clients). Shown, never edited here. */
  ownAvoid: Allergen[];
  /** What the client told this coach, `clients.coach_avoid`. The coach's. */
  coachAvoid: Allergen[];
  /** Ingredient words they would rather not eat. Either of them may edit. */
  dislikes: string[];
  goal: Goal | null;
  activity: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
}

const asNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** The macro colours, the same on the rings and the meters and the same as
 *  the client's own Meals tab. Keyed by the ring's label. */
const MACRO_TONE: Record<string, Tone> = { Calories: 'orange', Protein: 'blue', Carbs: 'amber', Fat: 'purple' };

export default function ClientNutrition() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const cn = useCoachNutrition();
  // Arrives from app/(trainer)/client.tsx so a coach already looking at
  // somebody lands on them. The picker stays for the same reason the other
  // per-client screens keep theirs: the screen is reachable without a param.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  // Seeded once, and this screen never unmounts — it is registered `href: null`
  // inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState` initialiser runs
  // for the FIRST client a coach opens it for and for nobody after. Opening it
  // for Ben used to draw Amy. `subjectChange` is the rule, with the reasoning
  // and the string[] hazard in src/lib/routeSubject.ts; it is applied during
  // render rather than in an effect so the wrong person is never painted, not
  // even for one frame.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  // Plan or Targets, the board's two segments that show something in place.
  // Recipes is the third word on the bar and is an action, not a state: it
  // opens the catalogue sheet, as it does on the client's own Meals tab.
  const [view, setView] = useState<'plan' | 'targets'>('plan');
  const moved = subjectChange(seenParam, clientId);
  // The segment is a way of looking at one client's plan, so it opens on
  // Plan again for the next one — this screen never unmounts.
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); setView('plan'); }

  // Null is "we do not know", never "there is none". The profile carries its
  // own status because it is the one that decides whether a plan may be
  // composed at all — see guardPlan.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileStatus, setProfileStatus] = useState<LoadStatus>('ready');
  // Whether the SCANS read failed, as opposed to coming back short or coming
  // back empty. All three used to end at the same place: the error was reported
  // to telemetry and then dropped, `scans` stayed `[]`, and the status was set
  // from `scanTruncated` alone — which is false when the read never happened.
  // So a refused scan read was recorded as 'ready', i.e. as "this client has
  // never been scanned", and that is the one thing it does not mean.
  //
  // It mattered twice over. `weightKg` falls back to `manual_weight_kg` when no
  // scan is found, so a client who had typed a weight got a plan composed
  // against the TYPED figure while their own Meals tab stayed scaled to their
  // newest scan — two different bodies, no sign of it on either screen — and
  // guardPlan saw 'ready', so Send was live. A client who had typed nothing was
  // told "there is nothing to scale a plan to… they set every one of them in
  // their own app", which blames them for our connection.
  const [scansUnread, setScansUnread] = useState(false);
  /**
   * The same two facts about the CHECK-IN read, which used to be neither.
   *
   * `weighIns = capped(...).rows` took the rows and dropped `.truncated` on the
   * floor, three lines below a scans read that carries it. Both matter here and
   * one of them matters more than it looks: the weigh-ins go into `series`,
   * `series.weight` goes into `energyPlanFor`, and the energy plan is what the
   * composed week is built on. So a client who has checked in weekly for twenty
   * years had their week planned off their FIRST thousand weigh-ins, drawn as a
   * current trend, with nothing on screen to say the read stopped — the exact
   * pair src/lib/historyWindow.ts names.
   */
  const [weighUnread, setWeighUnread] = useState(false);
  const [weighShort, setWeighShort] = useState(false);
  const [series, setSeries] = useState<{ weight: { t: string; v: number }[] } | null>(null);
  const [goals, setGoals] = useState<ReturnType<typeof readGoals>['goals']>([]);
  const [goalStatus, setGoalStatus] = useState<LoadStatus>('ready');
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));

  const [draft, setDraft] = useState<CoachMealPlan | null>(null);
  const [dayIdx, setDayIdx] = useState<number>(() => planDayIndex(isoToday(new Date())) ?? 0);
  const [pick, setPick] = useState<{ pos: number; slot: Slot } | null>(null);
  // The real recipes pinned into the draft week, day → position. Null until
  // the client's row has been read, exactly as `draft` is null until then: an
  // unread column is not a client with no recipes, and seeding `{}` over one
  // would send an empty map back and unpin what the coach had chosen.
  const [refs, setRefs] = useState<CoachRecipeRefs | null>(null);
  // A search costs money, so it takes a tap. False on every open of the sheet
  // and on every change of slot — see `choose`.
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  // The coach's two writes to the client's row: their own allergen notes and
  // the client's dislikes. `noteError` is why the last one did not land, drawn
  // until the next one does; the chips move only on a write that landed.
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [dislikeDraft, setDislikeDraft] = useState('');

  // Tapping through a book of clients starts a read per tap and they do not
  // come back in order. Without this a slow answer for the person tapped first
  // lands under the name of the person tapped second — one client's allergens
  // attributed to another, which is the worst thing this screen could do.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string, askable: boolean) => {
    wanted.current = id;
    setProfileStatus('loading'); setGoalStatus('loading');
    setProfile(null); setSeries(null); setGoals([]); setDraft(null); setRefs(null);
    const today = isoToday(new Date());

    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account, so nothing server-backed is asked for them.
    //
    // This was `isQueryableId(id)` alone, on the belief that such a client
    // carries an id the phone invented and Postgres would refuse. It does not:
    // `coach_clients.id` is uuid DEFAULT gen_random_uuid(), so from the first
    // round trip onward the guard passed, every read ran, each came back with
    // zero rows and NO error, and this screen rendered that as a fact about the
    // person. The roster is the only thing that knows which table the row came
    // from — see src/lib/clientRecord.ts.
    if (!askable) {
      setProfileStatus('error'); setGoalStatus('error');
      return;
    }

    // RLS is what limits every one of these to a client this coach actually
    // coaches; the filters are about which client is on screen rather than
    // about who may be seen.
    const [cliRes, scanRes, ciRes, goalRes] = await Promise.all([
      supabase.from('clients').select(CLIENT_COLS).eq('id', id).limit(1),
      // NEWEST-FIRST, and reversed back into ascending order once the page has
      // been measured. `ascending: true` with a cap is the pair
      // src/lib/historyWindow.ts:5-18 documents by name: PostgREST answers with
      // at most a thousand rows and says nothing, so an ascending read hands
      // back the OLDEST thousand and stops. A client who checks in weekly for
      // twenty years, or daily for three, crosses that — and their coach was
      // then shown the first thousand weigh-ins drawn as a current trend, which
      // is the same shape as the screen that told a member "nothing logged
      // since Mar 2023" the morning after they trained. Reading downward puts
      // the cut at the far end of their history instead.
      //
      // The id settles ties, exactly as it does on client-goals.tsx: a client
      // weighed twice on the same instant writes rows the server may order
      // differently on each request, and an order with ties in it is not an
      // order a page boundary can be drawn on.
      supabase.from('scans').select(SCAN_COLS).eq('client_id', id)
        .order('taken_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit()),
      supabase.from('check_ins').select(CHECKIN_COLS).eq('user_id', id)
        .order('at', { ascending: false }).order('id', { ascending: false }).limit(capLimit()),
      supabase.from('goal_targets').select(GOAL_COLS).eq('client_id', id)
        .order('created_at', { ascending: false }).limit(capLimit()),
    ]);
    if (wanted.current !== id) return;
    setTodayISO(today);

    let scans: ScanRow[] = [];
    let scanTruncated = false;
    let scanFailed = false;
    if (scanRes.error) {
      reportError('clientNutrition.scans', scanRes.error, { clientId: id });
      scanFailed = true;
    } else {
      const page = capped((scanRes.data ?? []) as unknown as ScanRow[]);
      // Back into ascending order. The read is downward so the cap bites the
      // oldest rows; the order the chart draws in is not the order the rows
      // have to arrive in.
      scans = page.rows.slice().reverse(); scanTruncated = page.truncated;
    }

    // The weigh-ins carry their own truncation and their own failure, and both
    // used to be discarded: this was `weighIns = capped(...).rows`, taking the
    // rows and dropping `.truncated` on the floor three lines under a scans
    // read that carries it. So the weight chart could be built from an unknown
    // fraction of a client's record with nothing on screen saying the read was
    // short — and `profileStatus`, which gates Send, said 'ready' about it.
    // Both are named here for the same reason `scanFailed` is: "came back
    // short" and "did not come back" are different things to tell a coach, and
    // neither of them is "here is your client's weight trend".
    let weighIns: WeighInRow[] = [];
    let weighTruncated = false;
    let weighFailed = false;
    if (ciRes.error) {
      reportError('clientNutrition.checkIns', ciRes.error, { clientId: id });
      weighFailed = true;
    } else {
      const page = capped((ciRes.data ?? []) as unknown as WeighInRow[]);
      weighIns = page.rows.slice().reverse(); weighTruncated = page.truncated;
    }

    setSeries(seriesFrom(scans, weighIns));

    if (goalRes.error) {
      reportError('clientNutrition.goals', goalRes.error, { clientId: id });
      setGoalStatus('error');
    } else {
      const page = capped((goalRes.data ?? []) as unknown as GoalRow[]);
      setGoals(readGoals(page.rows).goals);
      setGoalStatus(page.truncated ? 'partial' : 'ready');
    }

    if (cliRes.error) {
      reportError('clientNutrition.profile', cliRes.error, { clientId: id });
      setProfile(null);
      setProfileStatus('error');
      return;
    }
    const row = ((cliRes.data ?? []) as unknown as Record<string, unknown>[])[0] ?? null;
    if (!row) {
      // No row is a real answer: somebody added to the book by hand has no
      // `clients` row to carry a diet or an allergen list. It is still not a
      // profile a plan can be composed against, so it reads as error rather
      // than as an empty-but-known one.
      setProfile(null);
      setProfileStatus('error');
      return;
    }
    // The newest scan wins over what they typed, and what they typed is used
    // only where no scan exists — the same order their own Meals tab reads.
    const lastScan = [...scans].reverse().find((s) => asNum(s.weight_kg) != null) ?? null;
    const lastBf = [...scans].reverse().find((s) => asNum(s.body_fat_pct) != null) ?? null;
    const mpd = asNum(row.meals_per_day);
    // Both allergen lists and the dislikes, or no profile. A row that came back
    // without a readable `coach_avoid` has not told us the whole exclusion
    // list, so it is the same as a row that did not come back: an unread coach
    // list is unknown, never "the coach noted nothing", and guardPlan holds
    // the send on the 'error' this sets.
    const ownAvoid = readAllergenColumn(row.avoid);
    const coachAvoid = readAllergenColumn(row.coach_avoid);
    const avoid = excludedAllergens(ownAvoid, coachAvoid);
    const dislikes = readDislikes(row.dislikes);
    if (!ownAvoid || !coachAvoid || !avoid || !dislikes) {
      reportError('clientNutrition.profile', new Error('allergen or dislike columns unreadable'), { clientId: id });
      setProfile(null);
      setProfileStatus('error');
      return;
    }
    setProfile({
      diet: DIETS.includes(row.diet as Diet) ? (row.diet as Diet) : null,
      mealsPerDay: mpd === 3 || mpd === 4 || mpd === 5 ? mpd : null,
      avoid, ownAvoid, coachAvoid, dislikes,
      goal: GOALS.includes(row.goal as Goal) ? (row.goal as Goal) : null,
      activity: asNum(row.activity),
      weightKg: lastScan ? asNum(lastScan.weight_kg) : asNum(row.manual_weight_kg),
      bodyFatPct: lastBf ? asNum(lastBf.body_fat_pct) : asNum(row.manual_body_fat_pct),
    });
    // Truncated scans are 'partial' rather than 'ready': the weight this plan
    // is scaled to would be taken from an unknown fraction of their record. A
    // REFUSED scan read is at least as bad — none of their record arrived — and
    // used to fall through to 'ready', which is why it is named here rather
    // than left to `scanTruncated`, a flag that is false precisely when the
    // read did not happen. Both block Send through guardPlan; the Flag below
    // says which of the two it was, because "came back short" and "did not come
    // back" are different things to tell a coach.
    setScansUnread(scanFailed);
    setWeighUnread(weighFailed);
    setWeighShort(weighTruncated);
    // The check-in read counts towards this for the same reason the scan read
    // does, and it is not a lesser reason: `series.weight` is what
    // `energyPlanFor` reads, so a short or refused weigh-in history changes the
    // energy the composed week is built on. A plan sent on it would be scaled
    // to a trend taken from an unknown fraction of the client's record.
    setProfileStatus(scanFailed || scanTruncated || weighFailed || weighTruncated ? 'partial' : 'ready');
  }, []);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  /** Whether the server may be asked about this person at all. Computed at
   *  render rather than inside `load`, so a roster that arrives AFTER the read
   *  and says this row was typed in by hand re-runs the effect and withdraws
   *  the answer, instead of leaving an empty screen standing as a fact about
   *  them. `handAdded` undefined is "the roster has not said", which goes on
   *  asking — only an explicit true withholds. */
  const askable = clientIsQueryable(picked, client?.handAdded);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      wanted.current = null;
      setProfile(null); setSeries(null); setGoals([]); setDraft(null); setRefs(null);
      setProfileStatus('ready'); setGoalStatus('ready');
      return;
    }
    void load(picked, askable);
  }, [picked, askable, load]);

  // Three reads: the client's own profile and food series, the coach's stored
  // adjustments and plan, and the roster the picker and header come off. The
  // first two are crossed on every line of this screen — a target is the
  // client's figures plus the coach's delta — so they are asked for together.
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    r.refresh(), Promise.resolve(cn.reload()),
    ...(picked ? [load(picked, askable)] : []),
  ]), [r, cn, picked, askable, load]));
  const who = client?.name.split(' ')[0] ?? 'They';
  const adjust = picked ? cn.get(picked) : null;
  /** The instant the goal deadline below is measured against. State, not a
   *  render-body read: this screen is registered `href: null`, so it mounts
   *  once and does not redraw while nobody is touching it. */
  const nowMs = useNow().getTime();

  /** Everything `buildPlan` needs, or null when the profile cannot support a
   *  plan. Never a placeholder body: a 70 kg / 20% stand-in presented as this
   *  client's plan is the defect their own Meals tab was fixed for. */
  const input: PlanInput | null = useMemo(() => {
    if (!picked || !profile) return null;
    const { diet, mealsPerDay, goal, activity, weightKg, bodyFatPct } = profile;
    if (!diet || !mealsPerDay || !goal || activity == null || weightKg == null || bodyFatPct == null) return null;
    const openWeightGoal = goals.find((g) => g.kind === 'weight' && !g.achievedAtISO) ?? null;
    const energyPlan = energyPlanFor({
      goal: openWeightGoal,
      weightSeries: series?.weight ?? [],
      tdeeKcal: maintenanceFor({ weightKg, bodyFatPct, activity }).tdee,
      // `nowMs` from `useNow`, never a bare `Date.now()` in a memo body. This
      // memo is keyed on the picked client, their profile, their goals and the
      // coach's adjustments — five things that move when a read answers and
      // none of which moves when time passes. `energyPlanFor` measures how long
      // is left until the client's goal date off this instant, so the deadline
      // stopped counting down at whatever moment the reads landed: a screen
      // left open said the same "11 weeks to go" on Monday and on the following
      // Monday, and the daily calorie target derived from it was a week's worth
      // of deficit too gentle. `check:frozen-day` looks for an EMPTY dependency
      // array and cannot see this shape; `check:frozen-hook` names it.
      nowMs,
    });
    return {
      id: picked, weightKg, bodyFatPct, activity, goal, diet, mealsPerDay,
      // Seeded FROM the pin the coach may already have set, so the week this
      // screen composes contains it and clearing `meal_override` on send loses
      // nothing. See setPlan in src/ui/coachNutrition.tsx.
      mealOverride: adjust?.mealOverride ?? {},
      coachAdjust: adjust ?? undefined,
      avoid: profile.avoid,
      dislikes: profile.dislikes,
      energyPlan,
    };
  }, [picked, profile, goals, series, adjust, nowMs]);

  // The stored plan, and the working copy. The draft is seeded once per client
  // and never re-seeded underneath an edit in progress.
  //
  // Nothing is seeded until the plan read has actually landed, and that is the
  // LoadStatus rule rather than caution. Seeding a fresh week while the read is
  // in flight would put a plan on screen that is not theirs, and a coach who
  // edited it would be working over one they were never shown — the same
  // failure as printing "no plan set" over a read that never came back. Under
  // a failed read there is no draft at all and the notice above says why.
  const stored = adjust?.plan ?? null;
  const storedRefs = adjust?.recipeRefs;
  useEffect(() => {
    if (!input || cn.status !== 'ready') return;
    setDraft((d) => d ?? stored ?? seedPlan(input, new Date().toISOString()));
    // Seeded beside the week it belongs to and under the same status rule.
    // `?? x` and not an assignment, so a recipe the coach has just pinned is
    // not thrown away by a read that was already in flight when they did.
    setRefs((x) => x ?? storedRefs ?? {});
  }, [input, stored, storedRefs, cn.status]);

  const stale = useMemo(
    () => (stored && profile?.diet && profile.mealsPerDay
      ? planStale(stored, profile.diet, profile.avoid, profile.mealsPerDay)
      : null),
    [stored, profile],
  );
  const draftStale = useMemo(
    () => (draft && profile?.diet && profile.mealsPerDay
      ? planStale(draft, profile.diet, profile.avoid, profile.mealsPerDay)
      : null),
    [draft, profile],
  );

  const guard = guardPlan(profileStatus, cn.status, draftStale, client?.name ?? 'this client');
  // A slot their allergens leave nothing to generate for. Sent empty, never
  // filled with the allergen, and said here beside Send so it is not a
  // plan that merely looks complete.
  const emptyLine = profile?.diet && profile.mealsPerDay
    ? planEmptySlotsLine(profile.diet, profile.mealsPerDay, profile.avoid, who)
    : null;

  // The day being edited, run through the client's own builder. This is the
  // whole point of the screen: what is drawn below is what their phone draws.
  const built = useMemo(() => {
    if (!input || !draft) return null;
    return buildPlan({ ...input, mealOverride: planDayOverride(draft, dayIdx) });
  }, [input, draft, dayIdx]);

  const results = useMemo(() => {
    if (!pick || !profile?.diet) return [];
    return searchMeals(profile.diet, pick.slot, query, 30, profile.avoid, profile.dislikes);
  }, [pick, query, profile]);

  /** The row the sheet is about to replace. Its `K` is the slot's share, so it
   *  is what the recipe search is narrowed by and what a result is portioned
   *  to. It stays the GENERATED row even where a recipe is already pinned:
   *  a pinned recipe leaves the plan's own meal underneath it, which is what
   *  the client's app falls back to when the recipe cannot be read. */
  const picking = pick && built ? built.plan[pick.pos] ?? null : null;

  // ── Real recipes, searched on the CLIENT's restrictions ─────────────────
  //
  // `coachRecipeSearch` decides whether to ask at all, and it is tested in
  // src/lib/coachRecipeRefs.test.ts because the answer has to be "no" whenever
  // this client's profile did not come back whole. A search filtered by an
  // empty `avoid` would list dishes as chosen for somebody whose allergens
  // nobody has read — the same substitution `guardPlan` withholds the send
  // for, made one step earlier so it is never even drawn.
  //
  // Null is also what costs nothing. Spoonacular's Cook plan BILLS an overrun
  // at $0.005 a point rather than refusing it, so every avoidable request is a
  // charge: nothing is asked until the coach taps Recipes, the 500 ms debounce
  // and the three-character minimum are the hook's, and a failed search is
  // repeated only by a tap on Try Again.
  const recipeParams = coachRecipeSearch({
    open: recipesOpen,
    profileStatus,
    slot: pick?.slot ?? null,
    diet: profile?.diet ?? null,
    // Null is UNREAD. An empty array is a client who was read and avoids
    // nothing, and only that one may be searched against. The two lists go in
    // separately and `coachRecipeSearch` sends their union, so neither can be
    // left out of the Spoonacular exclusions by a caller.
    avoid: profile ? profile.ownAvoid : null,
    coachAvoid: profile ? profile.coachAvoid : null,
    query,
    targetKcal: picking ? (picking.slotKcal ?? picking.K) : null,
    number: 8,
  });
  const recipes = useRecipeSearch(recipeParams);
  const found = recipes.result;
  const recipeRows = found && (found.status === 'ready' || found.status === 'partial')
    ? preferNotDisliked(found.meals, profile?.dislikes ?? []).rows.map((m) => portionRecipe(m, picking ? (picking.slotKcal ?? picking.K) : null, pick?.pos ?? 0))
    : [];
  /** What the coach pinned at this day's slot, drawn instead of the generated
   *  meal's name. The ref carries a title and an image and no figures — that
   *  is the whole licence — so nothing here is re-fetched to draw a row. */
  const refAt = (pos: number) => coachRecipeRefAt(refs ?? {}, dayIdx, pos);
  const dayRecipes = Object.keys(refs?.[dayIdx] ?? {}).length;
  const weekHasRecipes = hasCoachRecipes(refs ?? {});

  /** Write the coach's note or the dislikes, and move the screen only when the
   *  row actually changed. Never `avoid`: that column is the member's, and
   *  the database refuses it from here. */
  const writeRow = async (patch: { coach_avoid: Allergen[] } | { dislikes: string[] }, what: string) => {
    if (!picked || !profile || noteBusy) return;
    setNoteBusy(true);
    try {
      const res = await supabase.from('clients').update(patch, { count: 'exact' }).eq('id', picked);
      const why = writeFailure(what, res);
      if (why) {
        reportError('clientNutrition.note', res.error ?? new Error(why), { clientId: picked });
        // A refusal from the database carries its own reason, and it is the
        // one worth reading (the allergen trigger says whose list it is).
        setNoteError(res.error?.code === '42501' && res.error.message ? `${why} ${res.error.message}` : why);
      } else {
        setNoteError(null);
        setProfile((p) => {
          if (!p) return p;
          const next = { ...p, ...('coach_avoid' in patch ? { coachAvoid: patch.coach_avoid } : { dislikes: patch.dislikes }) };
          return { ...next, avoid: excludedAllergens(next.ownAvoid, next.coachAvoid) ?? next.avoid };
        });
      }
    } catch (e) {
      reportError('clientNutrition.note', e, { clientId: picked });
      setNoteError(`${what} could not be saved. Check your connection and try again.`);
    } finally {
      setNoteBusy(false);
    }
  };
  const toggleCoachAvoid = (a: Allergen) => {
    if (!profile) return;
    const on = profile.coachAvoid.includes(a);
    void writeRow({ coach_avoid: on ? profile.coachAvoid.filter((x) => x !== a) : [...profile.coachAvoid, a] }, 'Your note');
  };
  const addDislike = () => {
    const w = normaliseDislike(dislikeDraft);
    if (!w || !profile) return;
    setDislikeDraft('');
    if (!profile.dislikes.includes(w)) void writeRow({ dislikes: [...profile.dislikes, w] }, 'Their dislikes');
  };

  const send = async () => {
    if (!picked || !draft || !guard.allowed || sending) return;
    setSending(true);
    // The refs go WITH the week, in the one statement that writes it, under
    // the one guard that allows it. There is deliberately no other way to put
    // a recipe on a client: a second write here would be a second door past
    // `guardPlan`, and a recipe assigned over an allergen list that could not
    // be read is the assignment this screen exists to refuse.
    const ok = await cn.setPlan(picked, { ...draft, writtenAt: new Date().toISOString() }, refs ?? {});
    setSending(false);
    if (ok) Alert.alert('Sent', `${who} has the week on their Meals tab.`);
    else Alert.alert('Not Sent', 'The plan did not reach the server, so nothing has changed on their phone. Check your connection and try again.');
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });
  /** One segment of the board's bar: an ink fill under the chosen word, the
   *  ground colour for the word itself. The same pill the client's Meals tab
   *  draws its slot bar with, so coach and client read one control. */
  const seg = (on: boolean) => ({
    flex: 1, minHeight: 40, borderRadius: radius.pill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: on ? t.ink : 'transparent',
  });
  const G = layout.gutter;
  const todayIdx = planDayIndex(todayISO);

  /** Whether the coach's four deltas move anything at all. */
  const adjusted = !!(adjust && (adjust.kcalDelta || adjust.proteinDelta || adjust.carbDelta || adjust.fatDelta));

  /**
   * The board's four rings, in its order. Each carries the target inside it
   * and an arc for how much of that target the day the coach has composed
   * supplies — the same ratio the Meters under Targets draw as bars. A dash
   * and no arc while there is no `built`: the notices above the rings say
   * which read is missing, and a ring drawn around a figure this screen does
   * not have would be the placeholder body the header refuses.
   *
   * A day holding a pinned recipe has no arc either, and for the same rule.
   * The target inside the ring is the client's own and stands; the arc is the
   * COMPOSED day, and a recipe's figures are not stored — they are read from
   * the library when the dish is opened. Drawing `built.tot` over a slot the
   * recipe has replaced would total a meal the client is not going to eat.
   */
  const composedWhole = !!built && dayRecipes === 0;
  const rings: { label: string; figure: string | null; arc: number | null; spoken: string }[] = built
    ? [
      { label: 'Calories', figure: num(built.target.kcal), arc: composedWhole ? built.tot.K / (built.target.kcal || 1) : null,
        spoken: `Calories, target ${num(built.target.kcal)} kcal a day${composedWhole ? `. The day you have composed comes to ${num(Math.round(built.tot.K))}` : ''}` },
      { label: 'Protein', figure: `${num(built.target.protein)} g`, arc: composedWhole ? built.tot.P / (built.target.protein || 1) : null,
        spoken: `Protein, target ${num(built.target.protein)} grams${composedWhole ? `. The day you have composed comes to ${num(Math.round(built.tot.P))}` : ''}` },
      { label: 'Carbs', figure: `${num(built.target.carbs)} g`, arc: composedWhole ? built.tot.C / (built.target.carbs || 1) : null,
        spoken: `Carbs, target ${num(built.target.carbs)} grams${composedWhole ? `. The day you have composed comes to ${num(Math.round(built.tot.C))}` : ''}` },
      { label: 'Fat', figure: `${num(built.target.fat)} g`, arc: composedWhole ? built.tot.F / (built.target.fat || 1) : null,
        spoken: `Fat, target ${num(built.target.fat)} grams${composedWhole ? `. The day you have composed comes to ${num(Math.round(built.tot.F))}` : ''}` },
    ]
    : ['Calories', 'Protein', 'Carbs', 'Fat'].map((label) => ({
      label, figure: null, arc: null, spoken: `${label} target not known yet`,
    }));

  /**
   * The client picker. Above everything while nobody is chosen, because there
   * is nothing else to draw; under the plan once somebody is, because the
   * board opens this screen on a client's targets and not on a list of names.
   * The screen is reachable without a param, so the picker cannot go.
   */
  const picker = (
    <Section>
      <SectionHead title={picked ? 'Switch Client' : 'Client'} />
      {r.roster.length === 0 && isWhole(r.status) ? (
        <EmptyRoster lacks="there is nobody to write a plan for" />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {r.roster.map((c) => (
            <Pressable key={c.id} onPress={() => { setPicked(c.id === picked ? null : c.id); setView('plan'); }}
              accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
              accessibilityLabel={c.name} style={chip(picked === c.id)}>
              <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Section>
  );

  /**
   * Opens the catalogue sheet on one slot of the day being edited. The meal
   * rows open it on their own slot; the Recipes segment opens it on the first,
   * which is what the client's own Recipes segment does.
   */
  const choose = (pos: number, slot: Slot) => { setQuery(''); setRecipesOpen(false); setPick({ pos, slot }); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── the board's head: back, and the title on the centre line ────
            The client's name sits under it because this is one person's plan
            and the picker that names them is now below the fold. */}
        <PageHead title="Nutrition Plan" subtitle={client?.name} />

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not Loaded" title="This build is running without the server"
              note="A client's diet, allergens and body live on the server, so there is no local copy of somebody else's to compose against. Nothing below is a claim about what they have disclosed." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back. Pull back and open this again once you are connected." />
              </Section>
            ) : null}

            {!picked ? picker : null}

            {/* ── Plan / Targets / Recipes, as the board draws them ────────
                Plan is the rings and the day's meals; Targets is where the
                figures come from and what the composed day does to them;
                Recipes opens the catalogue sheet on the first slot, the way
                the client's own Meals tab does, and is off until there is a
                day to open. Same three words over the same things on both
                apps. */}
            {picked ? (
              <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.pill, padding: 3, marginTop: sp.lg }}>
                <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === 'plan' }} accessibilityLabel="Plan"
                  onPress={() => setView('plan')} style={seg(view === 'plan')}>
                  <Text style={{ ...ty.label, ...font(view === 'plan' ? '600' : '500'), color: view === 'plan' ? t.bg : t.ink2 }}>Plan</Text>
                </Pressable>
                <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === 'targets' }} accessibilityLabel="Targets"
                  onPress={() => setView('targets')} style={seg(view === 'targets')}>
                  <Text style={{ ...ty.label, ...font(view === 'targets' ? '600' : '500'), color: view === 'targets' ? t.bg : t.ink2 }}>Targets</Text>
                </Pressable>
                <Pressable accessibilityRole="tab" accessibilityState={{ selected: false, disabled: !built }} accessibilityLabel="Recipes"
                  disabled={!built} onPress={() => { if (built?.plan[0]) choose(0, built.plan[0].slot); }} style={seg(false)}>
                  <Text style={{ ...ty.label, ...font('500'), color: built ? t.ink2 : t.ink3 }}>Recipes</Text>
                </Pressable>
              </View>
            ) : null}

            {picked && !askable ? (
              /* ── the third answer ──────────────────────────────────────────
                 It takes the WHOLE body, and here that is a refusal to WRITE as
                 much as a refusal to claim. `coach_nutrition.client_id`
                 references `profiles(id)`, so a plan written for a client the
                 coach typed in by hand cannot land — the upsert fails on the
                 foreign key — and the four reads behind the targets all resolve
                 `is_my_client()`, an EXISTS over `clients`, so they came back
                 empty with no error and this screen drew somebody's allergens,
                 their goal and their scan history as things they had not
                 supplied.

                 The Unreadable notice below used to hedge at it — "If they were
                 added to your book by hand they have no account to carry a diet
                 or an allergen list, which reads the same way from this screen."
                 It does not read the same way: `askable` knows, because the
                 roster knows which of its two tables the row came from. The
                 guess is gone from that notice, where it was shown to every
                 coach whose connection had merely dropped.

                 The same distinction `wellnessPanel`'s `not-asked` kind keeps
                 apart from `unreadable` in src/lib/coachWellness.ts. */
              <View>
                <Section>
                  <Notice kicker="No Account" title={`${client?.name ?? 'This client'} has no Repple account`}
                    note={`You added ${who === 'They' ? 'them' : who} to your book by hand, so there is no account to carry a diet, an allergen list or a calorie target, and nowhere for a plan you write here to be delivered to. Nothing of theirs was asked for and nothing was refused. Invite them from your client list and this screen works properly from the day they accept.`} />
                </Section>
              </View>
            ) : picked ? (
              <View>
                {/* ── what could not be read, before anything that depends on it
                    Each of these is a different fact about the reads behind
                    the rings, said above them whichever segment is open,
                    because a dash in a ring is only honest if the sentence
                    saying why is on the same screen. In the ordinary case
                    none of them fires and the rings sit directly under the
                    bar, as the board draws them. */}
                {profileStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their diet and allergens…</Text></Section>
                ) : profileStatus === 'error' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their profile could not be read"
                      note={`What ${who} avoids is unknown rather than nothing, so no meal can be picked for them from here.`} />
                  </Section>
                ) : null}

                {profileStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {scansUnread
                        ? `Their scans could not be read, so this screen does not know what ${who} weighs. Any weight shown below is one they typed themselves, and their own Meals tab scales to their newest scan, so the two can be different bodies. The week can be read; it should not be sent on this, and an empty scan record here is not a claim that they have never been scanned.`
                        : weighUnread
                          ? `Their check-ins could not be read, so the weight trend this week is planned against is missing entirely. What is charted below is scans alone. The week can be read; it should not be sent on this, and an empty chart here is not a claim that ${who} has stopped weighing in.`
                          : weighShort
                            ? 'Their check-ins came back at the row limit, so the weight trend this week is planned against was taken from part of their record rather than all of it. The week can be read; it should not be sent on this.'
                            : 'Their scans came back at the row limit, so the weight this plan is scaled to was taken from an unknown fraction of their record. The week can be read; it should not be sent on this.'}
                    </Flag>
                  </Section>
                ) : null}
                {goalStatus === 'error' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their goals could not be read, so the target below is built from their general
                      goal rather than from a target weight and date they may have set. Their own app
                      would then be showing them a different figure from this one.
                    </Flag>
                  </Section>
                ) : null}

                {/* ── the plan they already have ─────────────────────────── */}
                {cn.status === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their current plan…</Text></Section>
                ) : cn.status === 'error' || cn.status === 'partial' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their current plan could not be read"
                      note={`Whether ${who} already has a week from you is unknown rather than no. Nothing below is a claim that they have none, and sending would overwrite a plan you have not been shown.`} />
                  </Section>
                ) : stale && stale.stale ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Out of Date" title="The plan they are following no longer matches their profile"
                      note={planStaleLine(stale, who) ?? ''} />
                  </Section>
                ) : null}

                {profileStatus === 'ready' && !input ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Not Enough Profile" title="There is nothing to scale a plan to"
                      note={`A day's meals are scaled to lean body mass, which needs a weight and a body-fat figure, plus a diet, an activity level, a goal and a number of meals a day. ${who} is missing at least one of those, and this screen will not stand a placeholder body in for it. They set every one of them in their own app.`} />
                  </Section>
                ) : null}

                {view === 'plan' ? (
                  <>
                    {/* ── Daily Targets: the board's four rings, two by two ──
                        Drawn under every status once a client is chosen, so
                        the first viewport is the board's whether or not the
                        reads have landed. The figures inside are `built.target`
                        — `macrosFor` off the client's own body and goal, moved
                        by this coach's deltas — or a dash. */}
                    <Section>
                      <SectionHead title="Daily Targets" note={built ? (adjusted ? 'Your Adjustment Applied' : 'Unadjusted') : undefined} />
                      {/* The kit's Ring, each macro in the colour it has
                          everywhere in the app. Half the card wide so four
                          fall two by two. The arc is the COMPOSED day against
                          the target — not what the client ate, which this
                          screen does not read — and there is no arc and a dash
                          where there is no target: a ring drawn round a figure
                          this screen does not have is a figure invented to
                          fill a slot. */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {rings.map((ring) => (
                          <View key={ring.label} style={{ width: '50%', alignItems: 'center', paddingVertical: sp.md }}>
                            <Ring size={104} tone={MACRO_TONE[ring.label] ?? 'brand'} value={ring.arc} figure={ring.figure} sub={ring.label} spoken={ring.spoken} />
                          </View>
                        ))}
                      </View>
                      {built ? (
                        <>
                          {dayRecipes > 0 ? (
                            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                              {PLAN_WEEKDAYS[dayIdx]} has {num(dayRecipes)} real {dayRecipes === 1 ? 'recipe' : 'recipes'} in it, so there is no arc:
                              a recipe&rsquo;s figures are read from the library when it is opened and are not stored here.
                              The targets inside the rings are still theirs.
                            </Text>
                          ) : null}
                          <Expandable title="How These Are Worked Out">
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              Worked out from their weight, body fat, activity level and goal, then moved by the adjustment you set. Each arc is how much of that target the day below supplies.
                            </Text>
                          </Expandable>
                        </>
                      ) : (
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          A dash is a target this screen cannot work out yet; the notes above say which read is missing.
                        </Text>
                      )}
                    </Section>

                    {/* ── Meal Plan: the day's slots, one row each ──────────
                        The rows are the client's own builder's output for the
                        day being edited — what their phone draws — with the
                        week strip above them, because a plan is a week and
                        the board's rows are one day of it. Tapping a row opens
                        the catalogue sheet on that slot; Swap lives in the
                        sheet's head. */}
                    {input && draft && built ? (
                      <Section>
                        <SectionHead title="Meal Plan" note={`${PLAN_WEEKDAYS[dayIdx]} · ${built.plan.length} ${built.plan.length === 1 ? 'meal' : 'meals'}`} />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                          {PLAN_WEEKDAYS.map((d, i) => (
                            <Pressable key={d} onPress={() => setDayIdx(i)} accessibilityRole="button"
                              accessibilityState={{ selected: dayIdx === i }} accessibilityLabel={d}
                              style={chip(dayIdx === i)}>
                              <Text style={{ ...ty.micro, color: dayIdx === i ? t.brandInk : t.ink2 }}>
                                {d}{todayIdx === i ? ' ·' : ''}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          {todayIdx != null ? `Today is ${PLAN_WEEKDAYS[todayIdx]}, marked with a dot. ` : ''}
                          {/* The allergens are the index space (see the header),
                              so the line every row is drawn under names them. */}
                          Chosen from their {profile?.diet ? DIET_LABEL[profile.diet].toLowerCase() : ''} catalogue
                          {profile?.avoid.length ? ` without ${profile.avoid.map((a) => (ALLERGEN_LABEL.get(a) ?? a).toLowerCase()).join(', ')}` : ''}.
                          Tap a meal to choose another.
                        </Text>
                        {built.plan.map((m, i) => {
                          // What the coach pinned here, read back off the
                          // column. Four keys — a title and an image address
                          // — which is exactly enough to draw the row and is
                          // all the licence lets Repple keep. Nothing is
                          // fetched to paint this, so a week of recipes opens
                          // for nothing.
                          const ref = refAt(i);
                          return (
                          <View key={`${dayIdx}-${i}`}>
                            <Rule />
                            <Pressable onPress={() => choose(i, m.slot)} accessibilityRole="button"
                              // Assembled for the ear: a label on a Pressable
                              // REPLACES its children, and the macros are why a
                              // coach opens the row.
                              accessibilityLabel={ref
                                ? `${m.slot}: ${ref.title}, a recipe. Its figures are read from the recipe library on their phone. Choose a different meal`
                                : m.unfillable?.length
                                ? `${m.slot}: ${m.n}. Nothing is generated for this slot. Pin a recipe`
                                : `${m.slot}: ${m.n}. ${num(m.K)} kcal, ${num(m.P)} protein, ${num(m.C)} carbs, ${num(m.F)} fat at ${m.servings} servings. Choose a different meal`}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
                              {/* The dish's own glyph in a circle where the board
                                  puts a photograph. There is no photography of a
                                  generated meal, and none is invented — but a
                                  real recipe HAS one, drawn OVER the tile so the
                                  glyph shows while it loads and if it fails.
                                  `memory`, not `disk`: the terms let the image
                                  URL be kept and say nothing that lets the
                                  bytes be. */}
                              <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: t.data.orangeSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                <Text style={{ fontSize: 24 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{m.ico}</Text>
                                {ref?.image ? (
                                  <GuardedImage source={{ uri: ref.image }} contentFit="cover" cachePolicy="memory"
                                    style={{ position: 'absolute', width: 48, height: 48 }} />
                                ) : mealPhoto(m.pic) ? (
                                  <Image source={mealPhoto(m.pic)!} resizeMode="cover"
                                    style={{ position: 'absolute', width: 48, height: 48 }} />
                                ) : null}
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>{m.slot}</Text>
                                <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3 }}>{ref ? ref.title : mealTitle(m.n)}</Text>
                                {ref ? (
                                  // No macros on a recipe row. They are not
                                  // stored — the client's app reads them from
                                  // the library when they open the dish — and
                                  // the generated meal's figures drawn under a
                                  // recipe's name would be a number for a plate
                                  // nobody is serving.
                                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                                    Recipe · its own figures and ingredients are read on their phone
                                  </Text>
                                ) : m.unfillable?.length ? (
                                  // Empty: no figures to show, and the one
                                  // thing the coach can put here.
                                  <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>
                                    Nothing generated · tap to pin a recipe
                                  </Text>
                                ) : (
                                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                                    {num(m.K)} kcal · {macroWords(m.P, m.C, m.F)} · {m.servings}× serving
                                  </Text>
                                )}
                              </View>
                              <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                            </Pressable>
                          </View>
                          );
                        })}
                        {/* Wherever a recipe is drawn: the library's backlink
                            as a link (their terms ask for it on the free plan
                            and it is drawn on every plan — see
                            RECIPE_ATTRIBUTION), and the disclaimer their terms
                            make Repple's job, beside the figures and allergen
                            marks it is about. */}
                        {weekHasRecipes ? (
                          <View style={{ marginTop: sp.md }}>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>{RECIPE_DISCLAIMER}</Text>
                            <Pressable onPress={() => openLink('clientNutrition.recipeAttribution', RECIPE_ATTRIBUTION.url)}
                              accessibilityRole="link" accessibilityLabel={`${RECIPE_ATTRIBUTION.text}. Opens spoonacular.com`}
                              hitSlop={hitSlopFor(20)} style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                              <Text style={{ ...ty.caption, ...font('600'), color: t.brand }}>{RECIPE_ATTRIBUTION.text}</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </Section>
                    ) : null}

                    {input && draft && built ? (
                      <>
                        <Section>
                          <SectionHead title="Fill the Week" note="From This Day" />
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                            {PLAN_WEEKDAYS.map((d, i) => i === dayIdx ? null : (
                              <Pressable key={d} onPress={() => {
                                setDraft(copyPlanDay(draft, dayIdx, i));
                                // The recipes go with the meals. Copying only
                                // the meals would leave the target day showing
                                // the generated dish the coach had replaced.
                                setRefs((x) => copyCoachRecipeDay(x ?? {}, dayIdx, i));
                              }}
                                accessibilityRole="button" accessibilityLabel={`Copy ${PLAN_WEEKDAYS[dayIdx]} to ${d}`}
                                style={chip(false)}>
                                <Text style={{ ...ty.micro, color: t.ink2 }}>{FORWARD_ARROW} {d}</Text>
                              </Pressable>
                            ))}
                          </View>
                          <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                            Copies {PLAN_WEEKDAYS[dayIdx]}&rsquo;s meals onto another day. Nothing is sent
                            until you send it.
                          </Text>
                        </Section>

                        <Section>
                          {!guard.allowed && guard.reason ? (
                            <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{guard.reason}</Flag>
                          ) : null}
                          {emptyLine ? (
                            <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{emptyLine}</Flag>
                          ) : null}
                          <View style={{ opacity: guard.allowed && !sending ? 1 : 0.4 }}
                            pointerEvents={guard.allowed && !sending ? 'auto' : 'none'}>
                            <Cta wide label={sending ? 'Sending…' : (guard.label ?? `Send ${PLAN_DAYS} Days to ${client?.name ?? 'Client'}`)} onPress={send} />
                          </View>
                          <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                            Sending replaces the week they are following. They can still swap any meal on
                            their own phone. Their swap wins over yours for that slot, and yours comes
                            back when they clear it. What they log stays theirs; nothing here writes to
                            their food diary.
                          </Text>
                        </Section>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* ── Targets: where the four figures come from ───────── */}
                    {input && draft && built ? (
                      <>
                        <Section>
                          <SectionHead
                            title="Their Targets"
                            note={adjusted ? 'Your Adjustment Applied' : 'Unadjusted'}
                          />
                          <Text style={{ ...ty.body, ...numeric, color: t.ink }}>
                            {num(built.target.kcal)} kcal · {num(built.target.protein)} g protein ·{' '}
                            {num(built.target.carbs)} g carbs · {num(built.target.fat)} g fat
                          </Text>
                          <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xs }}>
                            Worked out from their weight, body fat, activity level and goal, then moved by
                            the adjustment you set. Change the adjustment on their client page; this
                            screen writes the meals.
                          </Text>
                        </Section>

                        <Section>
                          <SectionHead title="What Their App Will Do with This" note={PLAN_WEEKDAYS[dayIdx]} />
                          {/* Every plate's servings, not `plan[0]`'s. buildPlan
                              sizes each plate on its own now — it moves one by a
                              quarter serving at a time to close the day's last
                              hundred calories — so breakfast's multiplier is no
                              longer the day's. */}
                          <Text style={{ ...ty.body, color: t.ink2 }}>
                            {/* The plates actually served, against what they
                                are sized to: an empty slot has no plate, and
                                the rest aim at their share of the day. */}
                            {planServingNote(built.plan.filter((m) => !m.unfillable).map((m) => m.servings), planDayBaseKcal(draft, dayIdx), Math.round(built.aim))}
                          </Text>
                          <View style={{ marginTop: sp.md }}>
                            <Meter label="Protein" tone="blue" val={built.tot.P} target={built.target.protein} />
                            <Meter label="Carbs" tone="amber" val={built.tot.C} target={built.target.carbs} />
                            <Meter label="Fat" tone="purple" val={built.tot.F} target={built.target.fat} />
                          </View>
                          {/* The meters are drawn from `tot`, which is what the
                              meals contain, against a target worked out from the
                              client's body. Carbs and fat follow the calories
                              this screen does control; protein does not follow
                              anything a coach can reach from here, so when it
                              lands away from the target the screen says so in
                              words rather than leaving a blue bar to disagree
                              with the number printed two sections above it. */}
                          {/* Against the served meals' share on a day with an
                              empty slot: the missing protein is the missing
                              meal, not a meal to swap. */}
                          {planProteinNote(built.tot.P, built.target.protein, built.aim / built.target.kcal) ? (
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                              {planProteinNote(built.tot.P, built.target.protein, built.aim / built.target.kcal)}
                            </Text>
                          ) : null}
                        </Section>
                      </>
                    ) : null}

                    {/* ── what they will not eat ──────────────────────────────
                        This sat first, above everything, for the same reason
                        the program builder puts injuries above the exercises:
                        a plan that ignores a disclosed allergen is worse than no
                        plan. The board opens on the rings instead, so the full
                        list lives here under Targets and the Plan segment names
                        the same allergens in the line every meal row is drawn
                        under — the filter is still on the screen the meals are
                        on. It is also the filter every meal is drawn through. */}
                    {profile ? (
                      <Section>
                        <SectionHead
                          title="What They Avoid"
                          note={profile.avoid.length ? `${profile.avoid.length} Kept Out` : 'None Recorded'}
                        />
                        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Their Own List</Text>
                        {profile.ownAvoid.length ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                            {profile.ownAvoid.map((a) => (
                              <View key={a} style={{ paddingHorizontal: sp.md, paddingVertical: sp.xs, borderRadius: radius.pill, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.warn }}>
                                {/* The chip's warn border is the mark and clears 3:1;
                                    warn as micro ink did not clear 4.5:1 on the three
                                    light palettes. */}
                                <Text style={{ ...ty.micro, color: t.ink }}>{ALLERGEN_LABEL.get(a) ?? a}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={{ ...ty.body, color: t.ink2 }}>
                            {who} has declared nothing. The read came back and it was empty, so this is about
                            them rather than the connection. It is worth asking before you write a week around it.
                          </Text>
                        )}
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          Only {who} can change this list, from their own Meals tab. A coach cannot remove an
                          allergen a member declared, so a note taken in passing can never put it back on their plate.
                        </Text>

                        {/* The coach's own column. Tapping adds or removes THEIR
                            note; an allergen the member declared is shown as
                            theirs and is not a button, because removing the
                            coach's note would not remove it anyway. */}
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>What They Told You</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                          {[...ALLERGENS].sort((x, y) => x.label.localeCompare(y.label)).map((al) => {
                            const theirs = profile.ownAvoid.includes(al.id);
                            const on = theirs || profile.coachAvoid.includes(al.id);
                            return (
                              <Pressable key={al.id} disabled={theirs || noteBusy} onPress={() => toggleCoachAvoid(al.id)}
                                accessibilityRole="button" accessibilityState={{ selected: on, disabled: theirs || noteBusy }}
                                accessibilityLabel={theirs ? `${al.label}, on their own list` : al.label}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.surface3 : t.surface2, opacity: theirs ? 0.6 : 1 }}>
                                {on ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                                <Text style={{ ...ty.label, ...font(on ? '500' : '400'), color: on ? t.ink : t.ink2 }}>{al.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          Record an allergy {who} mentioned to you. It is kept out of every meal and recipe along
                          with their own list, and they see it on their Meals tab as noted by you. You can correct
                          your own notes; greyed ones are theirs.
                        </Text>

                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Dislikes</Text>
                        {profile.dislikes.length ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.sm }}>
                            {profile.dislikes.map((w) => (
                              <Pressable key={w} disabled={noteBusy} onPress={() => { void writeRow({ dislikes: profile.dislikes.filter((x) => x !== w) }, 'Their dislikes'); }}
                                accessibilityRole="button" accessibilityLabel={`Remove ${w}`}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                                <Text style={{ ...ty.label, color: t.ink }}>{w}</Text>
                                <Icon name="minus" size={12} color={t.ink3} />
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
                          <TextInput value={dislikeDraft} onChangeText={setDislikeDraft} placeholder="e.g. mushrooms" placeholderTextColor={t.ink3}
                            accessibilityLabel={`Add a food ${who} dislikes`} returnKeyType="done" autoCorrect={false} autoCapitalize="none"
                            onSubmitEditing={addDislike}
                            style={{ ...ty.body, flex: 1, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10 }} />
                          <Pressable onPress={addDislike} disabled={noteBusy || !normaliseDislike(dislikeDraft)}
                            accessibilityRole="button" accessibilityLabel="Add dislike"
                            style={{ paddingHorizontal: sp.lg, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: normaliseDislike(dislikeDraft) ? t.brand : t.surface2 }}>
                            <Text style={{ ...ty.label, ...font('600'), color: normaliseDislike(dislikeDraft) ? t.brandInk : t.ink3 }}>Add</Text>
                          </Pressable>
                        </View>
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          A preference, not an allergy. Left out where there is another option, and kept in when a
                          meal cannot be made without it.
                        </Text>
                        {noteError ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{noteError}</Flag> : null}
                        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
                          Diet: {profile.diet ? DIET_LABEL[profile.diet] : 'not set'} ·{' '}
                          {profile.mealsPerDay ? `${profile.mealsPerDay} meals a day` : 'meals a day not set'} ·{' '}
                          Goal: {profile.goal ? GOAL_LABEL[profile.goal] : 'not set'}
                        </Text>
                      </Section>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            {picked ? picker : null}
          </>
        )}

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Their targets, and a week of meals you write. Every figure on this screen is worked out
          from their own body and your adjustment by the same code their phone runs, so this is
          their screen rather than a picture of it. Calories and macros are a coaching decision,
          not a clinical one: this app does not assess anybody&rsquo;s health and nothing here says
          a figure is safe for them.
        </Text>
      </ScrollView>

      {/* One modal on this screen, deliberately. Two siblings whose `visible`
          expressions share an identifier is a dead button on iOS — see
          scripts/check-runtime-traps.mjs. */}
      <Modal visible={!!pick} animationType="slide" transparent
        onRequestClose={() => setPick(null)}>
        <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '85%', paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.xxl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.title, color: t.ink }}>{pick?.slot ?? 'Meal'}</Text>
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xs }}>
                  {profile?.diet ? DIET_LABEL[profile.diet] : ''}
                  {profile?.avoid.length ? ` · without ${profile.avoid.map((a) => (ALLERGEN_LABEL.get(a) ?? a).toLowerCase()).join(', ')}` : ''}
                </Text>
              </View>
              {/* Swap moved in here from the meal row, which the board draws
                  with a chevron and nothing else. It steps the slot to the next
                  dish in the client's filtered catalogue and closes the sheet
                  so the new row is what the coach is looking at. */}
              <Ghost label="Swap" icon="swap" onPress={() => {
                const cur = pick && built ? built.plan[pick.pos] : null;
                if (!draft || !pick || !cur || !profile?.diet) return;
                setDraft(setPlanMeal(draft, dayIdx, pick.pos, swapIndex(profile.diet, cur.slot, cur.idx, profile.avoid, profile.dislikes)));
                // Stepping to the next catalogue dish means this slot is a
                // catalogue dish again. Leaving the pin on would show the
                // recipe and send the swap, which is two different dinners.
                setRefs((x) => withoutCoachRecipeAt(x ?? {}, dayIdx, pick.pos));
                setPick(null);
              }} />
              <Ghost label="Close" onPress={() => setPick(null)} />
            </View>
            {/* keyboard-ok: this box sits at the top of a sheet capped at 85% of the
                screen, directly under its header, with the results list scrolling
                beneath it. The keyboard rises into the list, not over the field —
                which is the point of a search box on a sheet this tall. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: 46, paddingHorizontal: sp.lg, borderRadius: radius.pill, backgroundColor: t.surface2, marginTop: sp.lg }}>
              <Icon name="search" size={17} color={t.ink3} />
              <TextInput
                value={query} onChangeText={setQuery} placeholder={recipesOpen ? 'Search recipes' : 'Search this slot'} placeholderTextColor={t.ink3}
                autoCorrect={false} accessibilityLabel={recipesOpen ? 'Search recipes' : 'Search meals'} returnKeyType="search" clearButtonMode="while-editing"
                style={{ flex: 1, ...ty.label, color: t.ink, paddingVertical: 0 }}
              />
            </View>
            {/* ── Catalogue or Recipes ────────────────────────────────
                The third word on the board's bar, here rather than on the
                screen behind it: a recipe is chosen for ONE slot, and this is
                the sheet that slot opens. Recipes is an ACT — tapping it is
                what spends the first points, and every open of this sheet
                starts back on Catalogue (see `choose`) so a coach walking
                down a day is not billed for six searches nobody asked for. */}
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
              {([['Catalogue', false], ['Recipes', true]] as const).map(([label, on]) => (
                <Pressable key={label} onPress={() => setRecipesOpen(on)} accessibilityRole="button"
                  accessibilityState={{ selected: recipesOpen === on }}
                  accessibilityLabel={on ? 'Search real recipes' : 'Meals from their catalogue'}
                  style={chip(recipesOpen === on)}>
                  <Text style={{ ...ty.micro, color: recipesOpen === on ? t.brandInk : t.ink2 }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
              {recipesOpen
                ? 'Real recipes, filtered by their diet and what they avoid, and portioned to this slot. A search waits until you stop typing and needs three letters, because each one costs the gym a little.'
                : (pick && profile?.diet
                  ? `${num(catalogSize(profile.diet, pick.slot, profile.avoid))} meals in this slot for them. ${query.trim() ? `${num(results.length)} shown for “${query.trim()}”.` : `${num(results.length)} listed, spread across the whole catalogue.`}`
                  : '')}
            </Text>
            <ScrollView style={{ marginTop: sp.md }} showsVerticalScrollIndicator={false}>
              {recipesOpen ? (
                <>
                  {/* THE REFUSAL. `coachRecipeSearch` handed the hook null,
                      so nothing was asked and nothing was spent. Said in
                      words rather than drawn as an empty list, which would
                      read as "the library has nothing for them". */}
                  {!recipeParams ? (
                    <Notice tone={t.warn} kicker="Recipes" title="Nothing Has Been Searched"
                      note={`${who}'s diet and what they avoid have not been read, so there is nothing to filter a recipe search by. A list that could not be filtered is not a list of dishes that are safe for them.`} />
                  ) : null}
                  {recipeParams && recipes.loading ? (
                    <Text style={{ ...ty.body, color: t.ink3, paddingVertical: sp.lg }}>Searching the recipe library…</Text>
                  ) : null}
                  {found && (found.status === 'limited' || found.status === 'error') ? (
                    <View style={{ paddingVertical: sp.sm }}>
                      <Notice tone={t.warn} kicker="Recipes" title="Nothing Has Been Listed" note={found.message} />
                      {/* The ONLY thing that repeats a failed search. There
                          are no automatic retries: one against a spent quota
                          cannot succeed and one against a rate limit makes it
                          worse, and both are billed. */}
                      <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                        <Ghost label="Try Again" onPress={recipes.refresh} />
                      </View>
                    </View>
                  ) : null}
                  {found?.status === 'not-configured' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.lg }}>{found.message}</Text>
                  ) : null}
                  {recipeRows.map((m) => {
                    const pinnedHere = !!pick && refAt(pick.pos)?.sourceId === m.sourceId;
                    return (
                      <Pressable key={`r${m.sourceId}`} accessibilityRole="button"
                        accessibilityLabel={`${m.n}${pinnedHere ? ', in the plan' : ''}. ${num(m.K)} kcal, ${num(m.P)} protein, ${num(m.C)} carbs, ${num(m.F)} fat at ${m.servings} servings${m.flagged.length ? `. Contains ${m.flagged.map((a) => (ALLERGEN_LABEL.get(a) ?? a).toLowerCase()).join(' and ')}` : ''}. Put this recipe in their plan`}
                        onPress={() => {
                          if (!pick) return;
                          // The DISH goes in and the reference comes out:
                          // `withCoachRecipeAt` keeps the four keys the
                          // licence allows and drops the figures, the
                          // ingredients and the method on the floor. The
                          // generated meal stays in `draft` underneath, which
                          // is what the client's app shows if the recipe
                          // cannot be read. Nothing is sent until Send.
                          setRefs((x) => withCoachRecipeAt(x ?? {}, dayIdx, pick.pos, m));
                          setPick(null);
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          <Text style={{ fontSize: 24 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{m.ico}</Text>
                          {m.image ? (
                            <GuardedImage source={{ uri: m.image }} contentFit="cover" cachePolicy="memory"
                              style={{ position: 'absolute', width: 48, height: 48 }} />
                          ) : null}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          {(() => { const nm = mealTitleParts(m.n); return (<>
                            <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>{nm.main}</Text>
                            {nm.note ? <Text style={{ ...ty.caption, color: t.ink2 }}>({nm.note})</Text> : null}
                          </>); })()}
                          {pinnedHere ? <Text style={{ ...ty.caption, ...font('600'), color: t.brand, marginTop: 2 }}>In the Plan</Text> : null}
                          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                            {num(m.K)} kcal · {macroWords(m.P, m.C, m.F)} · at {m.servings}× serving
                          </Text>
                          {/* The library's own filter let this through and
                              Repple's re-check did not. On the ROW somebody
                              is about to pin, not only at the top of the
                              sheet: crit in the mark, the words in ink, so
                              colour is never the only channel. */}
                          {m.flagged.length ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                              <Text style={{ ...ty.caption, color: t.ink2 }}>
                                Contains {m.flagged.map((a) => (ALLERGEN_LABEL.get(a) ?? a).toLowerCase()).join(' and ')}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                      </Pressable>
                    );
                  })}
                  {found?.status === 'partial' ? (
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                      {num(found.dropped)} {found.dropped === 1 ? 'recipe' : 'recipes'} could not be read and {found.dropped === 1 ? 'is' : 'are'} not listed.
                    </Text>
                  ) : null}
                  {found?.status === 'ready' && !recipeRows.length ? (
                    <Text style={{ ...ty.body, color: t.ink3, paddingVertical: sp.lg }}>
                      No recipes matched that for their diet with their allergens taken out.
                    </Text>
                  ) : null}
                  {recipeRows.length ? (
                    <View style={{ marginTop: sp.md }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{RECIPE_DISCLAIMER}</Text>
                      <Pressable onPress={() => openLink('clientNutrition.recipeAttribution', RECIPE_ATTRIBUTION.url)}
                        accessibilityRole="link" accessibilityLabel={`${RECIPE_ATTRIBUTION.text}. Opens spoonacular.com`}
                        hitSlop={hitSlopFor(20)} style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                        <Text style={{ ...ty.caption, ...font('600'), color: t.brand }}>{RECIPE_ATTRIBUTION.text}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              ) : null}
              {!recipesOpen ? results.map((g) => {
                /** Whether this is the dish already in the slot — said in words
                 *  on the row, the way the client's list marks its plan. */
                const inPlan = !!(pick && built && built.plan[pick.pos]?.idx === g.idx);
                return (
                <Pressable key={`${g.slot}-${g.idx}`} accessibilityRole="button"
                  // The macros are the whole reason a coach picks one of these
                  // over another, and the label was replacing them.
                  accessibilityLabel={`${g.n}${inPlan ? ', in the plan' : ''}. ${num(g.k)} kcal, ${num(g.p)} protein, ${num(g.c)} carbs, ${num(g.f)} fat per serving, before their day is scaled to target`}
                  onPress={() => {
                    if (!draft || !pick) return;
                    setDraft(setPlanMeal(draft, dayIdx, pick.pos, g.idx));
                    // Choosing from the catalogue takes any pinned recipe off
                    // the slot — the same object back when there was none.
                    setRefs((x) => withoutCoachRecipeAt(x ?? {}, dayIdx, pick.pos));
                    setPick(null);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{g.ico}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>{g.n}</Text>
                    {inPlan ? <Text style={{ ...ty.caption, ...font('600'), color: t.brand, marginTop: 2 }}>In the Plan</Text> : null}
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                      {num(g.k)} kcal · {macroWords(g.p, g.c, g.f)} · per serving, before
                      their day is scaled to target
                    </Text>
                  </View>
                  <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                </Pressable>
                );
              }) : null}
              {!recipesOpen && !results.length ? (
                <Text style={{ ...ty.body, color: t.ink3, paddingVertical: sp.lg }}>
                  {picking?.unfillable?.length
                    ? `${picking.n} for ${who}. Every option has one of their allergens in it, so this slot is empty until you pin a recipe.`
                    : 'Nothing in this slot matches that. Clear the search to see what is available for their diet with their allergens taken out.'}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
