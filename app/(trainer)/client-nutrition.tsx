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
// programme builder.
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
import { View, Text, ScrollView, Pressable, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Notice, Flag, Meter } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { type LoadStatus } from '../../src/ui/loadStatus';
import { isQueryableId } from '../../src/lib/clientDrift';
import { isoToday } from '../../src/lib/dayPlan';
import { num } from '../../src/lib/format';
import { readGoals, seriesFrom, type GoalRow, type ScanRow, type WeighInRow } from '../../src/lib/clientGoals';
import { energyPlanFor } from '../../src/lib/goalEnergy';
import { maintenanceFor, DIET_LABEL } from '../../src/lib/nutrition';
import { buildPlan, catalogSize, searchMeals, swapIndex, ALLERGENS, type Allergen, type PlanInput, type Slot } from '../../src/lib/meals';
import {
  PLAN_DAYS, PLAN_WEEKDAYS, copyPlanDay, guardPlan, planDayBaseKcal, planDayIndex,
  planDayOverride, planServingNote, planStale, planStaleLine, seedPlan, setPlanMeal,
  type CoachMealPlan,
} from '../../src/lib/mealPlan';
import type { Diet, Goal } from '../../src/lib/types';

const CLIENT_COLS = 'diet, meals_per_day, avoid, goal, activity, manual_weight_kg, manual_body_fat_pct';
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg';
const CHECKIN_COLS = 'at, weight_kg';
const GOAL_COLS = 'id, kind, target_value, title, target_date, achieved_at, created_at';

const DIETS: readonly Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const GOALS: readonly Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };
const ALLERGEN_LABEL = new Map(ALLERGENS.map((a) => [a.id, a.label]));

/** The client's row, as much of it as this screen can use. Every field is
 *  nullable because every one of them is nullable in the table, and a missing
 *  one is a fact about the profile rather than a value to substitute. */
interface Profile {
  diet: Diet | null;
  mealsPerDay: 3 | 4 | 5 | null;
  avoid: Allergen[];
  goal: Goal | null;
  activity: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
}

const asNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export default function ClientNutrition() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const cn = useCoachNutrition();
  // Arrives from app/(trainer)/client.tsx so a coach already looking at
  // somebody lands on them. The picker stays for the same reason the other
  // per-client screens keep theirs: the screen is reachable without a param.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const [picked, setPicked] = useState<string | null>(clientId ?? null);

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
  const [series, setSeries] = useState<{ weight: { t: string; v: number }[] } | null>(null);
  const [goals, setGoals] = useState<ReturnType<typeof readGoals>['goals']>([]);
  const [goalStatus, setGoalStatus] = useState<LoadStatus>('ready');
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));

  const [draft, setDraft] = useState<CoachMealPlan | null>(null);
  const [dayIdx, setDayIdx] = useState<number>(() => planDayIndex(isoToday(new Date())) ?? 0);
  const [pick, setPick] = useState<{ pos: number; slot: Slot } | null>(null);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);

  // Tapping through a book of clients starts a read per tap and they do not
  // come back in order. Without this a slow answer for the person tapped first
  // lands under the name of the person tapped second — one client's allergens
  // attributed to another, which is the worst thing this screen could do.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setProfileStatus('loading'); setGoalStatus('loading');
    setProfile(null); setSeries(null); setGoals([]); setDraft(null);
    const today = isoToday(new Date());

    // A client the coach typed in by hand has a `coach_clients` note and no
    // account, so their id is not a uuid and Postgres refuses the whole
    // statement rather than skipping the value.
    if (!isQueryableId(id)) {
      setProfileStatus('error'); setGoalStatus('error');
      return;
    }

    // RLS is what limits every one of these to a client this coach actually
    // coaches; the filters are about which client is on screen rather than
    // about who may be seen.
    const [cliRes, scanRes, ciRes, goalRes] = await Promise.all([
      supabase.from('clients').select(CLIENT_COLS).eq('id', id).limit(1),
      supabase.from('scans').select(SCAN_COLS).eq('client_id', id)
        .order('taken_at', { ascending: true }).limit(capLimit()),
      supabase.from('check_ins').select(CHECKIN_COLS).eq('user_id', id)
        .order('at', { ascending: true }).limit(capLimit()),
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
      scans = page.rows; scanTruncated = page.truncated;
    }

    let weighIns: WeighInRow[] = [];
    if (ciRes.error) reportError('clientNutrition.checkIns', ciRes.error, { clientId: id });
    else weighIns = capped((ciRes.data ?? []) as unknown as WeighInRow[]).rows;

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
    setProfile({
      diet: DIETS.includes(row.diet as Diet) ? (row.diet as Diet) : null,
      mealsPerDay: mpd === 3 || mpd === 4 || mpd === 5 ? mpd : null,
      avoid: Array.isArray(row.avoid)
        ? (row.avoid as unknown[]).filter((a): a is Allergen => typeof a === 'string' && ALLERGEN_LABEL.has(a as Allergen))
        : [],
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
    setProfileStatus(scanFailed || scanTruncated ? 'partial' : 'ready');
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      wanted.current = null;
      setProfile(null); setSeries(null); setGoals([]); setDraft(null);
      setProfileStatus('ready'); setGoalStatus('ready');
      return;
    }
    void load(picked);
  }, [picked, load]);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';
  const adjust = picked ? cn.get(picked) : null;

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
      nowMs: Date.now(),
    });
    return {
      id: picked, weightKg, bodyFatPct, activity, goal, diet, mealsPerDay,
      // Seeded FROM the pin the coach may already have set, so the week this
      // screen composes contains it and clearing `meal_override` on send loses
      // nothing. See setPlan in src/ui/coachNutrition.tsx.
      mealOverride: adjust?.mealOverride ?? {},
      coachAdjust: adjust ?? undefined,
      avoid: profile.avoid,
      energyPlan,
    };
  }, [picked, profile, goals, series, adjust]);

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
  useEffect(() => {
    if (!input || cn.status !== 'ready') return;
    setDraft((d) => d ?? stored ?? seedPlan(input, new Date().toISOString()));
  }, [input, stored, cn.status]);

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

  // The day being edited, run through the client's own builder. This is the
  // whole point of the screen: what is drawn below is what their phone draws.
  const built = useMemo(() => {
    if (!input || !draft) return null;
    return buildPlan({ ...input, mealOverride: planDayOverride(draft, dayIdx) });
  }, [input, draft, dayIdx]);

  const results = useMemo(() => {
    if (!pick || !profile?.diet) return [];
    return searchMeals(profile.diet, pick.slot, query, 30, profile.avoid);
  }, [pick, query, profile]);

  const send = async () => {
    if (!picked || !draft || !guard.allowed || sending) return;
    setSending(true);
    const ok = await cn.setPlan(picked, { ...draft, writtenAt: new Date().toISOString() });
    setSending(false);
    if (ok) Alert.alert('Sent', `${who} has the week on their Meals tab.`);
    else Alert.alert('Not sent', 'The plan did not reach the server, so nothing has changed on their phone. Check your connection and try again.');
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });
  const G = layout.gutter;
  const todayIdx = planDayIndex(todayISO);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Nutrition</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Their targets, and a week of meals you write. Every figure below is worked out from their
          own body and your adjustment by the same code their phone runs, so this is their screen
          rather than a picture of it.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="A client's diet, allergens and body live on the server, so there is no local copy of somebody else's to compose against. Nothing below is a claim about what they have disclosed." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            <Section>
              <SectionHead title="Client" />
              {r.roster.length === 0 && r.status !== 'error' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  Nobody is on your book yet, so there is nobody to write a plan for.
                </Text>
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

            {picked ? (
              <View>
                <Rule />

                {/* ── what they will not eat ──────────────────────────────
                    First, above everything, and for the same reason the
                    programme builder puts injuries above the exercises: a plan
                    that ignores a disclosed allergen is worse than no plan.
                    It is also the filter every meal below is drawn through. */}
                {profileStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their diet and allergens…</Text></Section>
                ) : profileStatus === 'error' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their profile could not be read"
                      note={`What ${who} avoids is unknown rather than nothing, so no meal can be picked for them from here. If they were added to your book by hand they have no account to carry a diet or an allergen list, which reads the same way from this screen.`} />
                  </Section>
                ) : profile ? (
                  <Section>
                    <SectionHead
                      title="What They Avoid"
                      note={profile.avoid.length ? `${profile.avoid.length} recorded` : 'none recorded'}
                    />
                    {profile.avoid.length ? (
                      <>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.xs }}>
                          {profile.avoid.map((a) => (
                            <View key={a} style={{ paddingHorizontal: sp.md, paddingVertical: sp.xs, borderRadius: radius.pill, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.warn }}>
                              {/* The chip's warn border is the mark and clears 3:1;
                                  warn as micro ink did not clear 4.5:1 on the three
                                  light palettes, which made the allergen name the
                                  hardest word in the chip to read. */}
                              <Text style={{ ...ty.micro, color: t.ink }}>{ALLERGEN_LABEL.get(a) ?? a}</Text>
                            </View>
                          ))}
                        </View>
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          Every meal offered below is drawn from a catalogue with these already taken
                          out. They are what they told their own app, not a medical record.
                        </Text>
                      </>
                    ) : (
                      <Text style={{ ...ty.body, color: t.ink2 }}>
                        {who} has recorded nothing they avoid. The read came back and it was empty,
                        so this is about them rather than about the connection — worth asking anyway
                        before you write a week around it.
                      </Text>
                    )}
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
                      Diet: {profile.diet ? DIET_LABEL[profile.diet] : 'not set'} ·{' '}
                      {profile.mealsPerDay ? `${profile.mealsPerDay} meals a day` : 'meals a day not set'} ·{' '}
                      Goal: {profile.goal ? GOAL_LABEL[profile.goal] : 'not set'}
                    </Text>
                  </Section>
                ) : null}

                {profileStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {scansUnread
                        ? `Their scans could not be read, so this screen does not know what ${who} weighs. Any weight shown below is one they typed themselves, and their own Meals tab scales to their newest scan — so the two can be different bodies. The week can be read; it should not be sent on this, and an empty scan record here is not a claim that they have never been scanned.`
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
                    <Notice tone={t.warn} kicker="Out of date" title="The plan they are following no longer matches their profile"
                      note={planStaleLine(stale, who) ?? ''} />
                  </Section>
                ) : null}

                {profileStatus === 'ready' && !input ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Not enough profile" title="There is nothing to scale a plan to"
                      note={`A day's meals are scaled to lean body mass, which needs a weight and a body-fat figure, plus a diet, an activity level, a goal and a number of meals a day. ${who} is missing at least one of those, and this screen will not stand a placeholder body in for it. They set every one of them in their own app.`} />
                  </Section>
                ) : null}

                {/* ── the week ───────────────────────────────────────────── */}
                {input && draft && built ? (
                  <>
                    <Rule />
                    <Section>
                      <SectionHead
                        title="Their Targets"
                        note={adjust && (adjust.kcalDelta || adjust.proteinDelta || adjust.carbDelta || adjust.fatDelta) ? 'your adjustment applied' : 'unadjusted'}
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

                    <Rule />
                    <Section>
                      <SectionHead title="The Week" note={PLAN_WEEKDAYS[dayIdx]} />
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
                      {todayIdx != null ? (
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                          Today is {PLAN_WEEKDAYS[todayIdx]}, marked with a dot. Their Meals tab shows
                          whichever day it actually is.
                        </Text>
                      ) : null}
                    </Section>

                    {built.plan.map((m, i) => (
                      <View key={`${dayIdx}-${i}`}>
                        <Rule />
                        <Section>
                          <SectionHead title={m.slot} note={`${m.servings}× serving`} />
                          <Text style={{ ...ty.body, color: t.ink }}>{m.ico} {m.n}</Text>
                          <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: sp.xs }}>
                            {num(m.K)} kcal · {num(m.P)} P · {num(m.C)} C · {num(m.F)} F
                          </Text>
                          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                            <Ghost label="Swap" icon="swap" onPress={() => {
                              if (!profile?.diet) return;
                              setDraft(setPlanMeal(draft, dayIdx, i, swapIndex(profile.diet, m.slot, m.idx, profile.avoid)));
                            }} />
                            <Ghost label="Choose" icon="search" onPress={() => { setQuery(''); setPick({ pos: i, slot: m.slot }); }} />
                          </View>
                        </Section>
                      </View>
                    ))}

                    <Rule />
                    <Section>
                      <SectionHead title="What Their App Will Do With This" />
                      <Text style={{ ...ty.body, color: t.ink2 }}>
                        {planServingNote(built.plan[0]?.servings ?? 1, planDayBaseKcal(draft, dayIdx), built.target.kcal)}
                      </Text>
                      <View style={{ marginTop: sp.md }}>
                        <Meter label="Protein" val={built.tot.P} target={built.target.protein} />
                        <Meter label="Carbs" val={built.tot.C} target={built.target.carbs} />
                        <Meter label="Fat" val={built.tot.F} target={built.target.fat} />
                      </View>
                    </Section>

                    <Rule />
                    <Section>
                      <SectionHead title="Fill the Week" note="from this day" />
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                        {PLAN_WEEKDAYS.map((d, i) => i === dayIdx ? null : (
                          <Pressable key={d} onPress={() => setDraft(copyPlanDay(draft, dayIdx, i))}
                            accessibilityRole="button" accessibilityLabel={`Copy ${PLAN_WEEKDAYS[dayIdx]} to ${d}`}
                            style={chip(false)}>
                            <Text style={{ ...ty.micro, color: t.ink2 }}>→ {d}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                        Copies {PLAN_WEEKDAYS[dayIdx]}&rsquo;s meals onto another day. Nothing is sent
                        until you send it.
                      </Text>
                    </Section>

                    <Rule />
                    <Section>
                      {!guard.allowed && guard.reason ? (
                        <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{guard.reason}</Flag>
                      ) : null}
                      <View style={{ opacity: guard.allowed && !sending ? 1 : 0.4 }}
                        pointerEvents={guard.allowed && !sending ? 'auto' : 'none'}>
                        <Cta wide label={sending ? 'Sending…' : (guard.label ?? `Send ${PLAN_DAYS} Days to ${client?.name ?? 'Client'}`)} onPress={send} />
                      </View>
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                        Sending replaces the week they are following. They can still swap any meal on
                        their own phone — their swap wins over yours for that slot, and yours comes
                        back when they clear it. What they log stays theirs; nothing here writes to
                        their food diary.
                      </Text>
                    </Section>
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        <Rule />
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Calories and macros here are worked back from this client&rsquo;s own measurements and the
          goal they set, moved by the adjustment you chose. They are a coaching decision, not a
          clinical one: this app does not assess anybody&rsquo;s health and nothing on this screen
          says a figure is safe for them.
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
              <Ghost label="Close" onPress={() => setPick(null)} />
            </View>
            <TextInput
              value={query} onChangeText={setQuery} placeholder="Search this slot" placeholderTextColor={t.ink3}
              autoCorrect={false} accessibilityLabel="Search meals"
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginTop: sp.lg }}
            />
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
              {pick && profile?.diet
                ? `${num(catalogSize(profile.diet, pick.slot, profile.avoid))} meals in this slot for them. The first ${num(results.length)} matching are listed.`
                : ''}
            </Text>
            <ScrollView style={{ marginTop: sp.md }} showsVerticalScrollIndicator={false}>
              {results.map((g) => (
                <Pressable key={`${g.slot}-${g.idx}`} accessibilityRole="button" accessibilityLabel={g.n}
                  onPress={() => {
                    if (!draft || !pick) return;
                    setDraft(setPlanMeal(draft, dayIdx, pick.pos, g.idx));
                    setPick(null);
                  }}
                  style={{ paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                  <Text style={{ ...ty.body, color: t.ink }}>{g.ico} {g.n}</Text>
                  <Text style={{ ...ty.micro, ...numeric, color: t.ink3, marginTop: sp.xs }}>
                    {num(g.k)} kcal · {num(g.p)} P · {num(g.c)} C · {num(g.f)} F — per serving, before
                    their day is scaled to target
                  </Text>
                </Pressable>
              ))}
              {!results.length ? (
                <Text style={{ ...ty.body, color: t.ink3, paddingVertical: sp.lg }}>
                  Nothing in this slot matches that. Clear the search to see what is available for
                  their diet with their allergens taken out.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
