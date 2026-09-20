// Client · Food Log — search the food database, describe a meal in words, or
// photograph a plate; everything lands against today's targets.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every hook (same order), conditional branch, alert and
// route from the previous version is preserved — the four bordered boxes became
// hairline-separated sections and "calories remaining" became the screen's one
// hero figure instead of a 40px number fighting a 10px bar.
//
// Removed as fabricated data: a `BARCODE` constant —
//   const BARCODE = { n: 'Protein Bar (barcode)', k: 210, p: 20, c: 21, f: 7 };
// — which the "Barcode" button logged straight into the client's diary while
// alerting "Barcode Scanned". No barcode was ever read and no product was ever
// looked up: every scan produced the same invented protein bar. The button now
// says nothing was logged and points at the real Open Food Facts lookup.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { num, fmtTime } from '../../src/lib/format';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, Image, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../src/ui/components';
import { caloriesLeft, dayBurn } from '../../src/lib/nutrition';
// ONE target, shared with the Meals tab. This screen used to build its own out
// of `macrosFor` plus the coach's adjust and nothing else, while the Meals tab
// one tap away passed the goal-date energy plan and the day type into the same
// function — so a member with a target weight and a date read two different
// "calories remaining" figures for the same day, and neither said which. See
// the header of src/lib/dayTarget.ts.
import { dayTarget } from '../../src/lib/dayTarget';
import { useGoalTracker } from '../../src/ui/goalTracker';
import { useClientData } from '../../src/ui/clientData';
import { Icon } from '../../src/ui/Icon';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
// The camera permission this screen already asked for is about the hardware.
// These are about where the frame goes, which is a different question with a
// different answer, and for a long time only the first one was ever put.
import {
  mayAnalyzePhoto, PHOTO_ASK_KICKER, PHOTO_ASK_TITLE, PHOTO_DESTINATION_BY_SUBJECT,
  PHOTO_SENT_BY_SUBJECT, PHOTO_NOT_SENT_BY_SUBJECT, PHOTO_IF_YOU_DECLINE,
  PHOTO_SEND_LABEL, PHOTO_DECLINE_LABEL, PHOTO_SEND_A11Y, PHOTO_DECLINE_A11Y,
  PHOTO_REFUSED_NOTE, PHOTO_UNREAD_NOTE, PHOTO_OFF_NOTE,
} from '../../src/lib/photoAI';
import { usePhotoAI } from '../../src/ui/photoAI';
import { readFoodText, foodAIAvailable, type ParsedFood } from '../../src/lib/foodAI';
import { foodReadSay, namedGaps } from '../../src/lib/readerAnswer';
import { searchProducts, type OffProduct } from '../../src/lib/openfoodfacts';
import { searchCommonFoods } from '../../src/lib/foods';
import { searchDishes } from '../../src/lib/restaurant';
import { mergeFoodResults } from '../../src/lib/foodSearch';
// The member's own exclusions, on the search they open four times a day. The
// setting governed the meal planner and nothing else — this list offered every
// result unmarked, with a plus button beside it.
import { dishAllergens, dishAllergenMark, dishMarkNotice, SEARCH_MARK_CAVEAT } from '../../src/lib/foodAllergens';
import { BarcodeSheet } from '../../src/ui/BarcodeSheet';
// One sheet asks how much of it you ate, for every way in. Until now a search
// row logged straight through and the barcode sheet logged whatever basis Open
// Food Facts returned, so half a packet and two packets were both recorded as
// one. See src/ui/LogFoodSheet.tsx.
import { LogFoodSheet } from '../../src/ui/LogFoodSheet';
import type { FoodFacts } from '../../src/lib/foodPortion';
// The yogurt somebody eats every morning. Recents come from the log itself;
// favourites are pinned on purpose and kept on this phone. See
// src/lib/foodMemory.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recentFoods, frequentFoods, favouritesKey, readFavourites, writeFavourites,
  toggleFavourite, isFavourite, MAX_FAVOURITES,
  type LoggedFoodLike, type RememberedFood,
} from '../../src/lib/foodMemory';
import { useAuthRevision } from '../../src/ui/authRevision';
// Storage-first, and it keeps a dropped connection apart from a sign-out. See
// src/lib/authReadFate.ts; the note at the pinned-list read below says what
// that separation is worth on this particular screen.
import { sessionUid } from '../../src/lib/sessionUid';

import { supabase } from '../../src/lib/supabase';
import { notifySuccess } from '../../src/ui/haptics';
import { useToast } from '../../src/ui/toast';
import { useFoodLog, useFoodHistory, type FoodEntry } from '../../src/ui/foodLog';
import { isWhole } from '../../src/ui/loadStatus';
import { todayKey } from '../../src/lib/offlineQueue';
import { unsentNote, type WriteOutcome } from '../../src/lib/offlineQueue';
// The meal you forgot to log. Everything this screen wrote was stamped with the
// instant of the tap, so a member who forgot dinner could not add it in the
// morning — and the correction sheet below says so in as many words. The day is
// chosen here; src/lib/foodLogging.ts turns it into the instant to write, and
// its header holds the decision a back-dated row turns on (it never lapses).
import {
  MAX_BACKDATE_DAYS, backdateDays, dayLabel, dayLongLabel, readLogDay,
  backdateNote, backdatedStoredNote, backdatedUnsentNote,
} from '../../src/lib/foodLogging';
// `useToday()`, never `useMemo(() => todayKey(), [])`. This screen is registered
// with `href: null` and is mounted once for the life of the app, so a day read
// at mount is a day that stops moving — see src/ui/today.ts and
// scripts/check-frozen-day.mjs. It matters more here than almost anywhere: a
// frozen "today" would silently turn every log into a back-date.
import { useToday } from '../../src/ui/today';
import { readFoodEdit, foodChanged } from '../../src/lib/entryEdit';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useWearables } from '../../src/ui/wearables';
import { Rule, Section, SectionHead, PageHead, Cta, Ghost, ListRow, Flag, Field, KpiRow, fig, Ring, Meter, Segmented, IconPlate, TonedChip, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric, font } from '../../src/theme/scale';

/** How a logged meal came in, as a word for its row. 'manual' is everything
 *  typed or taken from the plan — described meals are logged under it too, see
 *  the note on `via` in logNL — so it says no more than that. */
const VIA_LABEL: Record<FoodEntry['via'], string> = { photo: 'Photo', barcode: 'Barcode', search: 'Search', manual: 'Entered' };
// The plate on a logged row, by how the meal came in. The tone is a second
// channel for the word beside it (VIA_LABEL), never the only one: a figure read
// off a photograph and one read off a packet are not equally sure.
const VIA_PLATE: Record<FoodEntry['via'], { icon: 'camera' | 'grid' | 'pencil' | 'search'; tone: Tone }> = {
  photo: { icon: 'camera', tone: 'purple' }, barcode: { icon: 'grid', tone: 'blue' },
  manual: { icon: 'pencil', tone: 'amber' }, search: { icon: 'search', tone: 'teal' },
};

/**
 * The four ways in, as the board's segmented bar lists them. One is open at a
 * time: the panel under the bar is that method's controls and nothing else's,
 * so the screen a member opens four times a day is one bar and one panel
 * rather than four stacked cards to scroll through. Every method's code path
 * is unchanged — the bar only decides which of them is on screen.
 */
const WAYS_IN = [
  { key: 'photo', label: 'Photo' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'search', label: 'Search' },
  { key: 'describe', label: 'Describe' },
] as const;
type WayIn = (typeof WAYS_IN)[number]['key'];

// Gone with `add` below: a local `Food` shape (`{ n, k, p, c, f }`) and a
// `Logged = Food & { via: string }` that nothing referred to. Every food on
// this screen is a `FoodFacts` now — the shape src/ui/LogFoodSheet.tsx and
// src/lib/foodPortion.ts agree on, which is the one that carries `basis` and
// admits a macro nobody has supplied. A second local spelling of "a food",
// with `kcal` called `k` and no room for a missing figure, is how the two come
// to disagree.
// The twelve-row FOOD_DB that used to sit here is gone, into `src/lib/foods.ts`
// as ~90 COMMON_FOODS. It held chicken breast, oats and a banana, and it was
// the ONLY answer this screen had for a food without a barcode — so "rice",
// "lentils" and "toast" all fell through it into a packaged-goods index and
// came back with somebody's brand of microwave rice or nothing at all.
// No baseline estimate. This used to be
//   const PHOTO_GUESS: Food = { n: 'Meal (photo estimate)', k: 520, p: 40, c: 50, f: 16 };
// filled in after a simulated 900ms "Reading Your Meal…" delay whenever the vision
// backend was unavailable — so photographing any plate produced the same invented
// 520 kcal, shown to the client as an AI reading of their own food. When there is no
// real read, the fields stay empty and the UI says so.

export default function FoodLog() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const coachNutrition = useCoachNutrition();
 const _adj = coachNutrition.get(cd.id);
 const soloEater = cd.coachingMode === 'solo';
 // A null adjustment under 'error' means UNKNOWN, which is the distinction
 // src/ui/coachNutrition.tsx exists to make and the one this screen was not
 // making: `get()` returns null identically for "your coach has not adjusted
 // you" and "we could not find out whether they have". The second one, fed to
 // `dayTarget`, produces the uncorrected generic figure — and this is the
 // screen a member eats against all day, meal by meal, so a coach's 400 kcal
 // cut goes missing without a word. src/ui/habits.tsx has guarded this with
 // `adjustUnknown` since the checklist was written.
 //
 // Only for a coached member. Nobody adjusts a solo member's macros, so the
 // read failing tells us nothing we needed.
 const adjustUnknown = !soloEater && coachNutrition.status === 'error' && _adj == null;
 /* ── the two answers the target is SHAPED by, and whether they were read ──
  *
  * `cd.goal` starts at 'muscle' and `cd.diet` at 'meat'. Both come from exactly
  * one place, the `clients` row, and under USE_SUPABASE src/ui/clientData.tsx
  * deletes the local profile cache at launch — so there is no second source and
  * a failed profile read leaves this screen holding "building muscle, eats
  * meat": a perfectly ordinary member, indistinguishable from a real one.
  *
  * Those two are not decoration on the figure, they ARE the figure.
  * `macrosFor` reads the goal straight into GOAL_ADJ (fatloss −20%, muscle
  * +12%) and the diet straight into the fat split (keto 65%, paleo 40%,
  * everything else 27%). A member cutting on keto whose profile read failed was
  * shown a bulking target with a third of the fat allowance under the words
  * "Calories Remaining", on the screen they eat against meal by meal, all day.
  *
  * Nothing above catches it. `dayTarget` returns null only for a missing weight
  * or body fat, and both of those fall back to the LATEST SCAN — a different
  * read, on a different table, which is usually fine when the profile read is
  * not. `adjustUnknown` is the coach's half of the same sum and says nothing
  * about the member's own answers.
  *
  * app/(client)/nutrition.tsx closed this for the Meals tab (`foodRulesUnknown`
  * there) and argues it at length. This is the same door on the other screen.
  * 'partial' counts as unread with 'error', for the reason that file gives:
  * half a profile is not a basis for computing the other half.
  */
 const foodRulesUnknown = !isWhole(cd.profileStatus);
 // Which of the two it is. `isWhole` is false while the read is still in
 // flight, and "we couldn't read your profile" printed over a read that is
 // proceeding perfectly well is the mistake `dayReading` below already exists
 // to avoid on the food log itself.
 const foodRulesReading = cd.profileStatus === 'loading';
 // null until there is a body to scale to — the 70 kg / 20% placeholder that
 // used to stand in produced a target belonging to nobody.
 const goalTracker = useGoalTracker();
 const goals = goalTracker.goals;
 // The day type is not offered here. Zero is the Off day the Meals tab's picker
 // starts on, so the two screens agree for every member who has not moved it —
 // and a member who has is reading a what-if on the tab that offers it.
 const dayPlan = (adjustUnknown || foodRulesUnknown) ? null : dayTarget({
  weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity,
  goal: cd.goal, diet: cd.diet,
  coachAdjust: soloEater ? null : (_adj ?? null),
  weightGoal: goals.find((g) => g.kind === 'weight' && !g.achievedAtISO) ?? null,
  weightSeries: cd.weightSeries,
  nowMs: Date.now(),
 });
 const target = dayPlan?.macros ?? null;
 // Where that target came from, in the words the Meals tab uses under its
 // ring, so the two screens name one source. Null with the target: a basis
 // for a figure that is not on screen is a sentence about nothing.
 const targetSource = !dayPlan ? null
  : `${!soloEater && _adj ? 'Coach-adjusted · ' : ''}${dayPlan.energyPlan.kind === 'derived'
   ? 'Target built from your weight goal and date'
   : 'Target from your measurements and general goal'}`;

 const fl = useFoodLog();
 const toast = useToast();
 // Meals whose removal is staged: off the screen, not yet written, still
 // takeable back. Pruned as soon as the write lands and the provider drops
 // them, so a stale id cannot hide a meal somebody logs again later with the
 // same key.
 const [pendingRemoval, setPendingRemoval] = useState<string[]>([]);
 useEffect(() => {
  setPendingRemoval((ids) => {
   const live = ids.filter((id) => fl.entries.some((e) => e.id === id));
   return live.length === ids.length ? ids : live;
  });
 }, [fl.entries]);

 // ── which day a meal is being logged to ─────────────────────────────────
 //
 // NULL means "today, whatever today is", and that is the whole reason it is
 // nullable rather than seeded with a date string. This screen stays mounted
 // across midnight. A member who left it open last night with the day seeded to
 // yesterday's string would, this morning, be silently back-dating every meal
 // they logged — the exact failure scripts/check-frozen-day.mjs exists for,
 // arriving through the state rather than through a memo. Null tracks the
 // clock; only a day the member deliberately picked is held.
 const today = useToday();
 const [pickedDay, setPickedDay] = useState<string | null>(null);
 const dayChoices = backdateDays(today, MAX_BACKDATE_DAYS);
 // A choice that has fallen out of the window — the app was open across
 // midnight with the oldest day selected — returns to today, and the selected
 // chip visibly moves back to Today so nothing about it is silent. `readLogDay`
 // is still the gate at the moment of the tap either way.
 const logDay = pickedDay && dayChoices.includes(pickedDay) ? pickedDay : today;
 const backdating = logDay !== today;
 const dayWarning = backdateNote(logDay, today);

 /**
  * The instant to stamp, read at the moment of the tap.
  *
  * Not computed with the day and held: a member can pick "Today" at 23:58 and
  * tap Log at 00:01, and `readLogDay` takes `new Date()` afresh so that meal is
  * stamped this morning rather than filed under a day that has ended. Returns
  * null having already said why, so every caller can bail on one falsy check.
  */
 const stampFor = (): { at: string; backdated: boolean } | null => {
  const r = readLogDay(logDay);
  if (!r.ok) { Alert.alert('Check the day', r.reason); return null; }
  return { at: r.at, backdated: r.backdated };
 };

 const [q, setQ] = useState('');
 const [nl, setNl] = useState(''); const [nlBusy, setNlBusy] = useState(false);
 // ── Search foods ────────────────────────────────────────────────────────
 //
 // One search, three sources, every row labelled with which one answered.
 //
 // This used to be `FOOD_DB.filter(...)` plus Open Food Facts: twelve generic
 // staples and a BRANDED index. Neither could answer "chicken breast" — the
 // twelve-row table because it was twelve rows, the branded index because a
 // chicken breast has no barcode. Meanwhile 41 restaurant dishes sat behind the
 // "Eating Out?" row above and were unreachable from this box, so somebody
 // logging last night's pad thai had to know a second screen existed.
 //
 // The two local tables are instant and offline. Open Food Facts is debounced
 // behind them and is allowed to fail. `mergeFoodResults` ranks and labels the
 // three; the ranking rule is written down in src/lib/foodSearch.ts.
 const [remote, setRemote] = useState<OffProduct[]>([]);
 const [searching, setSearching] = useState(false);
 // Distinct from "no matches": the lookup is free and rate-limited, and it
 // answers 503 when busy. Saying "nothing found" to that would tell somebody
 // their food does not exist because a server was throttling us.
 const [searchDown, setSearchDown] = useState(false);

 // Both local searches are pure and cheap, so they run on every keystroke —
 // they are the reason the list is never empty while the remote one is in
 // flight, and the reason it is never empty when the remote one never lands.
 const localCommon = useMemo(() => searchCommonFoods(q.trim(), 12), [q]);
 // Capped shorter than the other two on purpose: one common word matches a
 // third of the 41 dishes — "rice" alone hits six — and a search list is not a
 // menu. Left uncapped, an evening's worth of restaurant food buries the
 // branded product somebody may actually be holding.
 const localDishes = useMemo(() => (q.trim() ? searchDishes(q.trim(), 8) : []), [q]);

 useEffect(() => {
   const term = q.trim();
   // Under three characters matches half the database and is never what was meant.
   if (term.length < 3) { setRemote([]); setSearching(false); setSearchDown(false); return; }
   const ctrl = new AbortController();
   setSearching(true);
   // Debounced: this fires under a field somebody is still typing into, and a
   // request per keystroke would both rate-limit us and land out of order.
   const timer = setTimeout(() => {
     searchProducts(term, { signal: ctrl.signal }).then((res) => {
       if (ctrl.signal.aborted) return;
       setSearching(false);
       if (!res.ok) { setSearchDown(true); setRemote([]); return; }
       setSearchDown(false);
       // Stored as they came back. Naming a product after the basis its macros
       // are for is the merge's job now, so the screen and the test cannot
       // disagree about what a branded row is called.
       setRemote(res.products);
     });
   }, 350);
   return () => { ctrl.abort(); clearTimeout(timer); };
 }, [q]);

 // A failed remote search arrives here as an empty `remote` and removes nothing:
 // the local rows are still the answer, and `searchDown` says the branded half
 // is missing rather than letting a shorter list pass for the whole one.
 const results = useMemo(
   () => mergeFoodResults(q, { common: localCommon, restaurant: localDishes, branded: remote }),
   [q, localCommon, localDishes, remote],
 );

 /**
  * Whether this screen knows the member's exclusions, and what it must say
  * when it does not.
  *
  * It asked `cd.avoid.length` and nothing else. That list starts `[]` under a
  * read still in flight and STAYS `[]` when the read fails — clientData deletes
  * the local cache at launch under USE_SUPABASE, so the server row is the only
  * source — which made "excludes nothing" and "we were never told what this
  * member excludes" the same value, drawn the same way.
  *
  * Both safeguards came off together, exactly as they did on Eating Out: the
  * caveat above the rows is rendered on that length, so it vanished, and every
  * row rendered unmarked because `dishAllergens` returns `[]` for an empty
  * `avoid`. A member who excluded nuts, searching on a fresh install or on bad
  * signal, saw peanut butter and satay unmarked with no sentence above them —
  * a picture identical to a search checked against their exclusions and come
  * back clear, on the screen they open four times a day.
  *
  * `app/(client)/restaurant.tsx` was fixed for this and `dishMarkNotice` is the
  * shared answer; it is tested for 'error' and 'partial' in
  * src/lib/foodAllergens.test.ts. The one thing not taken from it is the wording
  * of the 'marks' arm: these rows come off labels and off other members' own
  * entries rather than off a menu, which is what SEARCH_MARK_CAVEAT says and
  * DISH_MARK_CAVEAT — with its sentence about restaurant kitchens — does not.
  */
 const marks = dishMarkNotice(cd.profileStatus, cd.avoid.length);
 const marksText = marks.state === 'marks' ? SEARCH_MARK_CAVEAT : marks.text;

 // ── the one review sheet ────────────────────────────────────────────────
 //
 // Everything that is about to become a row in the food log goes through it:
 // a searched food, a scanned product, a photo the reader answered, a photo it
 // did not, and a described food that came back missing a macro. Five paths,
 // one sheet, one place that asks how much — and one place that refuses to
 // invent a figure nobody measured. See src/ui/LogFoodSheet.tsx.
 const [pending, setPending] = useState<FoodFacts | null>(null);
 const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
 const [pendingNote, setPendingNote] = useState<string | null>(null);
 const [pendingTitle, setPendingTitle] = useState<string | undefined>(undefined);
 // Which way in this food arrived, so `food_logs.via` is what actually
 // happened. The column carries a CHECK constraint listing search / barcode /
 // photo / manual, and a row sent under anything else is refused outright.
 const [pendingVia, setPendingVia] = useState<'search' | 'barcode' | 'photo' | 'manual'>('search');
 // More described foods waiting their turn behind the one on screen. A
 // description can be four foods and the sheet holds one; they queue rather
 // than being logged behind the member's back or dropped.
 const [queue, setQueue] = useState<FoodFacts[]>([]);
 // The photo is being read. Its own flag, because the sheet does not open until
 // there is something to put in it and two seconds of nothing happening after
 // the shutter reads as a button that did not work.
 const [reading, setReading] = useState(false);
 const [photoUri, setPhotoUri] = useState<string | null>(null);
 // The member's answer about sending a photograph of their food to a language
 // model. Its own subject and its own stored key: agreeing to photograph a gym
 // machine is not agreeing to photograph the table you are sitting at. See
 // src/lib/photoAI.ts.
 const photoAI = usePhotoAI('meal');
 // Holds ONLY which button was pressed, while the question is on screen.
 // Nothing has been photographed and nothing has been sent at this point, so
 // every way out of the sheet is a real answer and dismissing it is a cancel
 // rather than a quiet yes.
 const [askPhoto, setAskPhoto] = useState<{ fromCamera: boolean } | null>(null);

 // Every write in this provider resolves true only once the row is on the
 // server, and this screen used to throw all of them away. A refused insert and
 // a stored one looked identical: the food appeared in "Logged today", ate into
 // the calories remaining, and was gone at the next launch with the day's
 // figures silently different. So a write that did not land is now said out
 // loud, in the one place that can say it.
 // Two different things used to share one sentence, and the sentence was
 // wrong about both of them once the provider started keeping the meal.
 //
 // 'unsent' — nobody answered. The meal is on this phone, it counts toward
 //   today, and it goes up on its own. Nothing is lost and the client does not
 //   need to do anything, which is the opposite of what "it will be gone when
 //   you next open the app" told them.
 // 'refused' — the food log read it and declined. It is NOT kept, because the
 //   same row offered again gets the same answer, and a meal sitting in the
 //   list that nothing will ever store is the silent version of this bug.
 const warnUnsaved = (what: string, out: 'unsent' | 'refused') =>
  out === 'unsent'
   ? Alert.alert('Saved on this phone',
     `No connection, so ${what} is not in your food log on the server yet. It is counting toward today and goes up on its own next time you have signal.`)
   : Alert.alert('Not logged',
     `${what} was rejected by your food log, so it is not saved and it is not counting toward today. Adding it again as it is will be rejected again.`);

 /**
  * The same three outcomes, said about a meal that went to ANOTHER day.
  *
  * A separate function rather than a flag on `warnUnsaved`, because two of the
  * three sentences above are wrong about a back-dated row and the third is
  * missing entirely:
  *
  *  · 'stored' is normally silent, because the member watches the meal appear
  *    in the list and the day's calories drop. A back-dated one changes NOTHING
  *    on the screen they are looking at, so a successful log and a dead button
  *    are indistinguishable. It gets a sentence saying where the meal went.
  *  · 'unsent' normally says "it is counting toward today". A back-dated one is
  *    not counting toward today and must not claim to be. What it does promise
  *    is the queue decision: it keeps its own day whenever it goes up, and it
  *    is never dropped for having waited — src/lib/foodLogging.ts sets out why
  *    that is the opposite of what happens to a planned day in the same
  *    situation.
  *  · 'refused' says "not counting toward today", which is true but useless
  *    here; the member needs to know which day now has nothing in it.
  */
 const sayBackdated = (what: string, out: WriteOutcome, day: string) => {
  if (out === 'stored') { toast.say(`${what} — ${backdatedStoredNote(day, today)}`); return; }
  if (out === 'unsent') { Alert.alert('Saved on this phone', `${what}: ${backdatedUnsentNote(day, today)}`); return; }
  Alert.alert('Not logged',
   `${what} was rejected by your food log, so it is not saved and nothing was added to ${dayLongLabel(day, today)}. Adding it again as it is will be rejected again.`);
 };

 /** One place that reports a write, whichever day it went to. */
 const sayLogged = (what: string, out: WriteOutcome, backdated: boolean, day: string) => {
  if (backdated) { sayBackdated(what, out, day); return; }
  if (out === 'stored') { notifySuccess(); return; }
  warnUnsaved(what, out);
 };
 // Gone: an `add(f: Food, via: string)` helper with no caller anywhere below
 // the line it was written on. Every way food reaches the log on this screen
 // goes through `LogFoodSheet.onLog` or `logNL` now, and both call
 // `fl.logFood` directly. What made it worth deleting rather than leaving is
 // the `via: via as any` in it: `food_logs.via` carries a CHECK constraint
 // listing search / barcode / photo / manual, and a cast that silences the
 // compiler on exactly that column is the shape of the defect this file
 // already records twice — a described meal inserted as 'ai', refused by the
 // database, and shown to the member as logged.
 const logNL = async () => {
   const text = nl.trim(); if (!text) return;
   setNlBusy(true);
   const read = await readFoodText(text);
   // ── four answers, four sentences ──────────────────────────────────────
   //
   // This was `const parsed = await parseFoodText(text)` and, at the bottom,
   // one Alert reading "Could not read that" for every way it could come back
   // empty. `nutrition-parse` has told the four apart on the wire since Lane
   // 129 and src/lib/readerAnswer.ts reads them; the four sentences a member
   // gets live in FOOD_READ_SAY beside the reading, so no screen can word one
   // of them as another.
   //
   // The third is the one that matters. A member who types "a bowl of soup"
   // and is shown an error learns the app is broken; one told the reader read
   // their description and named no food in it learns to type differently.
   // That branch is a READ THAT WORKED — `read.ok` with an empty list — and it
   // is deliberately not styled or worded as a failure.
   if (!read) {
    // The fifth thing, which is not one of the four: no reader was asked. The
    // feature is off, or the box was empty.
    setNlBusy(false);
    Alert.alert('Nothing was read', foodAIAvailable()
     ? 'Try describing it differently, e.g. \"2 eggs, toast and a coffee\".'
     : 'AI food logging turns on with the AI backend.');
    return;
   }
   if (!read.ok || !read.items.length) {
    setNlBusy(false);
    const say = foodReadSay(read);
    Alert.alert(say.title, say.body);
    return;
   }
   const parsed = read.items;
   // A read that came back missing a macro is NOT logged with a zero in the
   // gap. The reader used to coerce an absent protein to 0 and this loop wrote
   // it, so a described meal the model only knew the calories of counted as a
   // zero-protein meal against the day's remaining macros. Those go to the
   // sheet instead, one at a time, where a person fills the gap in.
   // Calories are on the same footing as the macros now. They used to be
   // coerced to zero and the food then FILTERED OUT for being worth nothing —
   // so a described item the model could not price simply never appeared, and
   // a member who typed three things and got two back was never told the third
   // had been read at all. It goes to the sheet with the others, where the
   // calories box seeds empty and refuses to log until somebody types one.
   // `NaN` is what a FoodFacts carries for a calorie figure nobody has
   // supplied yet; the sheet has always read it that way (LogFoodSheet.tsx).
   const whole = (it: ParsedFood): it is ParsedFood & { kcal: number; protein: number; carbs: number; fat: number } =>
     it.kcal != null && it.protein != null && it.carbs != null && it.fat != null;
   const items = parsed.filter(whole);
   const short = parsed.filter((it) => !whole(it));
   const gaps: FoodFacts[] = short
     .map((it) => ({ name: it.name, kcal: it.kcal ?? NaN, protein: it.protein, carbs: it.carbs, fat: it.fat, basis: null }));
   // Awaited in sequence and counted, rather than fired off in a forEach: a
   // description can be four foods, and four separate "not saved" alerts
   // stacked on top of each other tells somebody nothing they can act on.
   //
   // `via: 'manual'`, not the 'ai' this used to send. `food_logs.via` carries a
   // CHECK constraint listing search / barcode / photo / manual, so every
   // insert from this box was refused by the database — and because the result
   // was discarded, the described meal appeared in the list, counted against
   // the day, and existed nowhere. A person typing here logged it by hand, so
   // manual is what it is; the reader in rowToEntry already coerces to that.
   let queued = 0;
   let refused = 0;
   // ONE instant for the whole description, read once before the loop. Four
   // foods typed in one box were eaten at one sitting, and stamping each with
   // its own `new Date()` would spread them across a second or two for no
   // reason — and, at four seconds to midnight, across two different days.
   const stamp = stampFor();
   if (!stamp) { setNlBusy(false); return; }
   for (const it of items) {
    const out = await fl.logFood({ name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, via: 'manual' }, stamp.at);
    if (out === 'unsent') queued++;
    else if (out === 'refused') refused++;
   }
   setNlBusy(false);
   setNl('');
   // The incomplete ones go to the sheet rather than into the log. The first
   // is on screen and the rest wait behind it — a description can be four
   // foods, and the sheet holds one.
   if (gaps.length) {
    setPendingTitle('Check This One');
    setPendingVia('manual');
    // WHICH figures did not come back, named. The reader sends the list and
    // nothing on this side read it, so the note said only "some of the
    // figures" and left the member hunting for the blank boxes.
    const missing = namedGaps(short[0].notGiven);
    setPendingNote(`Read from what you typed, and the figures are the reader’s estimate rather than anything measured. ${missing
      ? `It did not give ${missing} for this one, so ${short[0].notGiven.length === 1 ? 'that box is' : 'those boxes are'} blank rather than nought`
      : 'Some of the figures did not come back, so they are blank rather than nought'} — fill them in and this can be logged.${gaps.length > 1 ? ` ${gaps.length - 1} more to check after it.` : ''}`);
    setPendingPhoto(null);
    setPending(gaps[0]);
    setQueue(gaps.slice(1));
   }
   // Entries that were in the reader's list and could not be read as food at
   // all are COUNTED on the payload rather than dropped, and carried into the
   // sentence rather than dropped again here: a member handed back less than
   // they typed has to be told that is what happened.
   const lost = read.unreadableItems;
   const alsoLost = lost
    ? ` (${lost === 1 ? 'one more thing' : `${lost} more things`} you typed could not be read as food and ${lost === 1 ? 'is' : 'are'} not logged)`
    : '';
   // Refusal is reported ahead of the queue, because it is the one the client
   // has to do something about: those foods are not logged anywhere.
   const n = items.length;
   if (refused) sayLogged((refused === n ? 'What you described' : `${refused} of the ${n} foods`) + alsoLost, 'refused', stamp.backdated, logDay);
   else if (queued) sayLogged((queued === n ? 'What you described' : `${queued} of the ${n} foods`) + alsoLost, 'unsent', stamp.backdated, logDay);
   else if (n) {
    sayLogged((n === 1 ? 'What you described' : `All ${n} foods`) + alsoLost, 'stored', stamp.backdated, logDay);
    // …AND WHERE THE FIGURES CAME FROM. Every other route into this log says
    // so: the photo sheet says "Read from your photo", the gap sheet above
    // says "Read from what you typed", and app/(client)/scans.tsx says "Read
    // from your scan". A food the reader priced in FULL was the one route
    // where a model's estimate went onto the record with nothing said at all
    // — `sayLogged` on a same-day write is a haptic and no words.
    //
    // Not said on a backdated write, where the toast is already carrying
    // which day the food went to. That is the more urgent fact and a second
    // `say()` would replace it rather than queue behind it (src/ui/toast.tsx).
    if (!stamp.backdated) toast.say('Logged from what you typed. The figures are the reader’s estimate rather than anything measured — tap a meal to correct one.');
   }
   // Nothing landed in the log at all — every food the reader named went to
   // the sheet with a gap in it — and some of what was typed could not be read
   // as food either. The sheet says nothing about that, so this does.
   else if (lost) toast.say(`${lost === 1 ? 'One more thing' : `${lost} more things`} you typed could not be read as food and ${lost === 1 ? 'is' : 'are'} not logged.`);
 };

 // ── correcting a meal already logged (TF-02) ────────────────────────────
 //
 // There was no way to fix one. A meal typed as 1200 kcal instead of 120 could
 // only be deleted and entered again, and until somebody did that it went on
 // eating the day's remaining calories — the one number this screen exists to
 // show. RLS was never in the way: `food_owner` on food_logs is an ALL policy.
 const [editing, setEditing] = useState<FoodEntry | null>(null);
 const [edN, setEdN] = useState(''); const [edK, setEdK] = useState('');
 const [edP, setEdP] = useState(''); const [edC, setEdC] = useState(''); const [edF, setEdF] = useState('');
 const [edBusy, setEdBusy] = useState(false);
 const openEdit = (fe: FoodEntry) => {
  setEditing(fe);
  setEdN(fe.name); setEdK(String(fe.kcal)); setEdP(String(fe.protein)); setEdC(String(fe.carbs)); setEdF(String(fe.fat));
 };
 const saveEdit = async () => {
  if (!editing || edBusy) return;
  const read = readFoodEdit({ name: edN, kcal: edK, protein: edP, carbs: edC, fat: edF });
  // A typo is refused rather than rounded to zero — see src/lib/entryEdit.ts.
  if (!read.ok) { Alert.alert('Check that', read.reason); return; }
  const before = { name: editing.name, kcal: editing.kcal, protein: editing.protein, carbs: editing.carbs, fat: editing.fat };
  if (!foodChanged(before, read.value)) { setEditing(null); return; }
  setEdBusy(true);
  const saved = await fl.updateFood(editing.id, read.value);
  setEdBusy(false);
  // On false the store has not moved either, so the figures behind this sheet
  // are still the ones of record. The sheet stays open with what was typed:
  // closing it would throw the correction away AND imply it had been taken.
  if (!saved) {
   Alert.alert('Not saved', 'Your correction did not reach the server, so the meal still reads as it did. Nothing has been changed on this phone either — check your connection and try again.');
   return;
  }
  setEditing(null);
  notifySuccess();
 };
 // Removing a meal, without a dialog in front of it.
 //
 // This was a modal asking "Remove this meal?" with Cancel and Remove. The tap
 // that removes is the same tap on the same side of the same dialog every
 // time, so people learn it and stop reading it — and the moment it went
 // through, the meal was gone. The row now disappears immediately, the bar at
 // the bottom says what happened, and the WRITE is held for six seconds behind
 // an Undo. See src/lib/undoable.ts for why it is the write that is held
 // rather than the deletion that is reversed.
 //
 // The row and today's totals are hidden together. Hiding one without the
 // other would leave the meal off the list and still inside the calories for
 // six seconds, which is the one number this screen exists to state.
 const removeMeal = (fe: FoodEntry) => {
  setPendingRemoval((ids) => (ids.includes(fe.id) ? ids : [...ids, fe.id]));
  const putBack = () => setPendingRemoval((ids) => ids.filter((x) => x !== fe.id));
  toast.remove({
   id: fe.id,
   text: `${fe.name} removed, and ${num(fe.kcal)} kcal with it.`,
   onUndo: putBack,
   onCommit: async () => {
    const gone = await fl.removeFood(fe.id);
    // Still an interruption, and deliberately. Everything else on this screen
    // is a statement and belongs in the bar; this one says the figures the
    // member is eating the rest of their day against are not what the screen
    // just told them, and it has to be read. The row comes back at the same
    // moment, which is the truth: it is still in the log.
    if (!gone) {
     putBack();
     Alert.alert('Not removed', `${fe.name} is still in your log — we could not reach the server to remove it. It is still counting toward today.`);
    }
   },
  });
 };

 // Meals whose delete is staged and can still be taken back. They are off the
 // list and out of the totals; nothing has been written yet.
 const staged = fl.entries.filter((e) => pendingRemoval.includes(e.id));
 const entries = fl.entries.filter((e) => !pendingRemoval.includes(e.id));
 const off = staged.reduce((a, e) => ({
  k: a.k + (e.kcal || 0), p: a.p + (e.protein || 0), c: a.c + (e.carbs || 0), f: a.f + (e.fat || 0),
 }), { k: 0, p: 0, c: 0, f: 0 });
 const tot = {
  k: fl.consumed.kcal - off.k, p: fl.consumed.protein - off.p,
  c: fl.consumed.carbs - off.c, f: fl.consumed.fat - off.f,
 };
 // Whether that is a TOTAL or a floor. Under 'error' there may be meals we
 // could not read, and under 'partial' there certainly are — so "calories
 // remaining" is an overestimate, and it is the number a person eats the rest
 // of their day against. The provider has said this in its own doc comment
 // since `status` was added; this screen was not listening.
 const dayWhole = isWhole(fl.status);
 // `isWhole` is false for 'loading' as well as for 'partial' and 'error', which
 // is right for WITHHOLDING a figure and wrong for explaining one. Three
 // sentences below were written for the failure and printed on the wait too, so
 // for the first second of every visit this screen said "We couldn't read
 // today's log" about a read that was proceeding perfectly well — and a member
 // who read that and re-logged their breakfast has now eaten it twice on paper.
 // app/(client)/nutrition.tsx splits the same three states; this is that split.
 const dayReading = fl.status === 'loading';
 // The fortnight behind today. A separate read with a separate status, so a
 // failed history cannot touch the day's macros or the calories remaining —
 // see the note above `useFoodHistory`. Before this the app had no yesterday
 // at all: the food log was a thing you could write into and never read.
 const hist = useFoodHistory(14);
 // Five reads make this screen: today's entries, the fourteen days behind it,
 // the profile the target is scaled to, the coach's adjustment to that target,
 // and the goals it is weighted by. `adjustUnknown` above withholds the whole
 // target when the coach's half failed — this is the way back from that.
 // Read here rather than at the burn below, so the pull can reach it. See
 // `burnStale`: this screen tells a member their device could not be reached
 // and to pull down, and a gesture that retries five reads and not the sixth
 // makes that a dead instruction.
 const wear = useWearables();
 const syncDevices = wear.syncAll;
 const pull = usePullToRefresh(useCallback(() => {
   fl.reload(); hist.reload(); cd.reload(); void coachNutrition.reload(); goalTracker.reload(); syncDevices();
 }, [fl.reload, hist.reload, cd.reload, coachNutrition, goalTracker.reload, syncDevices]));
 const [openDay, setOpenDay] = useState<string | null>(null);
 const histWhole = isWhole(hist.status);
 // Today is drawn by everything above and does not need a row of its own down
 // here repeating it.
 //
 // ── and why the oldest day goes with it under 'partial' ──────────────────
 //
 // Each row below prints that day's macros and a count of meals, which are
 // sums over `FoodDay.entries`. The doc on `FoodDay` in src/ui/foodLog.tsx
 // states the contract those sums need — "a day that could not be read whole
 // has no day object at all rather than a short one" — and the read does not
 // keep it. It is `.order('logged_at', descending).limit(capLimit())`, so what
 // falls off a truncated read is the OLDEST rows, and the oldest day that did
 // come back is cut somewhere in the middle of itself. Its macros are a floor
 // and its "3 meals" is a floor, and neither reads as one: a day showing two
 // meals and 900 kcal is a light day, which is a specific and checkable claim
 // about somebody's eating that this screen is in no position to make.
 //
 // So it is dropped rather than shown short — the same answer the average
 // above gives, and the one the library's own doc asks for. `hist.days` is
 // newest-first, so the last element is that day.
 //
 // Gated on 'partial' alone: 'ready' must not lose anybody a real day, and
 // under 'loading' and 'error' there is nothing here to drop. `hist.status` is
 // the worse of the two reads, so a 'partial' TODAY would drop the oldest day
 // as well — that needs a thousand meals logged inside one day, and erring
 // towards the honest side of a case nobody can reach is the cheap half of the
 // trade.
 const dayCut = hist.status === 'partial' && hist.days.length > 0;
 const pastDays = (dayCut ? hist.days.slice(0, -1) : hist.days).filter((d) => d.day !== todayKey());

 // ── the yogurt somebody eats every morning ──────────────────────────────
 //
 // `recentFoods`, `frequentFoods` and the whole pinned list were written,
 // covered by tests and IMPORTED into this file — and not one of the eight
 // symbols appeared anywhere below the import line. The module that would stop
 // a member re-searching the same breakfast three hundred times a year had no
 // control anywhere in the app. This is that control.
 //
 // Recents are derived from the log itself and need no storage; favourites are
 // pinned on purpose and live on this phone, under a key that carries the
 // account so a shared gym phone cannot show one member another's food. See
 // src/lib/foodMemory.ts.
 const authRev = useAuthRevision();
 const [uid, setUid] = useState<string | null>(null);
 const [favs, setFavs] = useState<RememberedFood[]>([]);
 // Whether the pinned list is what is actually on this phone. Bytes that will
 // not parse are NOT an empty list, and writing an empty list over them is how
 // somebody loses the lot — `readFavourites` returns the pair for that reason,
 // and the star is withheld rather than offered over a read that failed.
 const [favsRead, setFavsRead] = useState(false);
 // Whether the pinned list could not even be LOOKED for, because who this is
 // could not be established. Its own flag rather than folded into `favsRead`:
 // that one is about the bytes under the key, this one is about not having a
 // key. Both withhold the star; only this one owes the member a sentence,
 // because the difference between "you have pinned nothing" and "we could not
 // find your pinned list" is invisible when the section simply stops drawing.
 const [favsUnknown, setFavsUnknown] = useState(false);

 useEffect(() => {
  let cancelled = false;
  (async () => {
   try {
    // getSession, not getUser, and that choice is right — this screen is opened
    // in gyms with no signal and `getSession()` answers from device storage.
    // The REASON written here was not: it said "getUser REJECTS when nobody is
    // signed in". It does not. It resolves with `{ user: null, error:
    // AuthSessionMissingError }`, and so does `getSession()` with
    // `session: null` — which is the defect this line had, not the one it was
    // guarding against.
    //
    // ── the branch that threw away the only copy ─────────────────────────
    //
    // `const id = sess?.session?.user?.id ?? null; if (!id) { setFavs([]) }`.
    // A member's pinned foods are on THIS PHONE, under `favouritesKey(uid)` —
    // the key names the account — so the one condition where the offline copy
    // is the only copy was the condition that walked past it. `getSession()`
    // goes to the network to refresh an access token that has expired, and a
    // refresh that cannot reach the server resolves with `session: null` and a
    // retryable error this line discarded. The yogurt they eat every morning
    // disappeared off the top of the screen, the heart disappeared with it, and
    // nothing said why: the Pinned group renders `null` when it is empty, so
    // the loss is silent rather than wrong.
    //
    // The uid still cannot be recovered — no uid, no key — so the list still
    // cannot be opened. What changes is that this stops being told as
    // "nothing pinned". Narrowed on `fate`, never on `!who.uid`: `string`
    // includes ''.
    const who = await sessionUid('foodLog.favourites');
    if (cancelled) return;
    setUid(who.uid);
    if (who.fate !== null) {
     // Neither fate may write: `favsRead` false is what stops `pinFood`
     // storing an empty list over bytes nobody read. Only the outage is
     // explained, because only the outage is a thing the member did not do.
     setFavs([]); setFavsRead(false); setFavsUnknown(who.fate === 'unreadable');
     return;
    }
    const raw = await AsyncStorage.getItem(favouritesKey(who.uid));
    if (cancelled) return;
    const r = readFavourites(raw);
    setFavs(r.foods); setFavsRead(r.read); setFavsUnknown(false);
   } catch { if (!cancelled) { setFavs([]); setFavsRead(false); setFavsUnknown(false); } }

  })();
  return () => { cancelled = true; };
 }, [authRev]);
 // Today plus the fortnight behind it. Both reads, because "the same again" is
 // most often this morning and sometimes last Tuesday.
 const remembered = useMemo(() => {
  const rows: LoggedFoodLike[] = [...entries, ...pastDays.flatMap((d) => d.entries)];
  return { recent: recentFoods(rows, 8), frequent: frequentFoods(rows, 8) };
 }, [entries, pastDays]);
 // What the two derived lists are drawn from, said out loud when it is not
 // everything. An absence here is silence, never "you have never eaten this".
 const rememberedShort = !dayWhole || !histWhole;
 const pinFood = async (f: RememberedFood) => {
  if (!uid || !favsRead) return;
  const before = favs;
  const next = toggleFavourite(favs, f);
  setFavs(next);
  try { await AsyncStorage.setItem(favouritesKey(uid), writeFavourites(next)); notifySuccess(); }
  catch {
   // Put back. A star that stays lit over a write that did not land is the
   // screen reading its own guess back to the member.
   setFavs(before);
   Alert.alert('Not pinned', 'That could not be saved on this phone, so your pinned list has not changed.');
  }
 };
 // The three groups, in the order somebody reads them: what they pinned, what
 // they logged last, what they log most. A food already pinned is not repeated
 // underneath itself.
 const favRows = useMemo(() => {
  const pinnedKeys = new Set(favs.map((f) => f.key));
  const recent = remembered.recent.filter((f) => !pinnedKeys.has(f.key));
  const recentKeys = new Set(recent.map((f) => f.key));
  return [
   { title: 'Pinned', rows: favs },
   { title: 'Recent', rows: recent.slice(0, 5) },
   { title: 'Often', rows: remembered.frequent.filter((f) => !pinnedKeys.has(f.key) && !recentKeys.has(f.key)).slice(0, 5) },
  ];
 }, [favs, remembered]);
 /** Open the one review sheet on a remembered food. Re-logging is a new row of
  *  its own, with the figures exactly as they were logged the first time. */
 const openRemembered = (f: RememberedFood) => {
  setPendingTitle(undefined); setPendingNote(null); setPendingPhoto(null); setPendingVia('manual');
  setPending({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, basis: null });
 };
 /**
  * The same again, off a day in the fortnight behind today.
  *
  * `Recent` and `Often` are derived and capped at five rows each, so a meal
  * eaten once last Tuesday was in this screen's own history with no way to act
  * on it — while every app a member is likely to have used before this one
  * (MyFitnessPal, Lose It, Cronometer, Yazio) copies a meal off an earlier day
  * as a matter of course.
  *
  * A NEW row against today, with the figures as they were logged, and the
  * sheet still asks how much. It does not touch the day it came from: copying
  * a meal forward and back-dating one are different acts, and only the first
  * is something this screen can honestly do — see the note under `saveEdit`
  * about the log always being today's.
  */
 const relogEntry = (fe: FoodEntry) => {
  setPendingTitle(undefined); setPendingPhoto(null); setPendingVia('manual');
  setPendingNote('Logged against today, as a new meal. The day you took it from is unchanged.');
  setPending({ name: fe.name, kcal: fe.kcal, protein: fe.protein, carbs: fe.carbs, fat: fe.fat, basis: null });
 };
 const wToday = wear.today;
 const burn = target ? dayBurn(target, wToday) : null;
 const burned = burn?.burned ?? 0;
 // ── and whether that burn is a CURRENT reading ──────────────────────────
 //
 // src/ui/wearables.tsx says it on `todayStatus` in its own words: "A screen
 // printing a figure off `today` should say so when this is not 'ready'." This
 // screen prints it in the hero's note — "1,900 kcal eaten · 610 kcal burned" —
 // and asked nothing. Under 'error' that is not today's movement: it is what
 // the last successful read left behind, which after a night of failed syncs is
 // yesterday's.
 //
 // Not arithmetic: `caloriesLeft` is `target − eaten` and has never added the
 // burn, so no allowance moves. It is a claim about a measurement, and the fix
 // is to say which of the two it is rather than to withhold it — the provider
 // keeps the figure on purpose, because a watch that could not be reached at
 // three o'clock did not un-burn the morning. Same words as
 // app/(client)/devices.tsx and the Meals tab.
 //
 // `isWhole`, not `!== 'error'`: that admits 'loading' as well, and a first read
 // still in flight is not a stale figure — `burn` is null under it anyway.
 // Only where a burn is actually PRINTED: the hero's note drops the clause
 // when the figure is nought and withholds the whole sentence while today's log
 // is not whole. A banner about a sentence that is not on screen is its own
 // small lie.
 const burnStale = dayWhole && (burn?.burned ?? 0) > 0
  && !isWhole(wear.todayStatus) && wear.todayStatus !== 'loading';
 // Same function the Meals tab calls, so the two cannot drift apart again.
 // null, not 0, when there is no target to subtract from. `dayWhole` is true
 // for a member with no weight on record — the log read perfectly well — so the
 // hero rendered "Calories Remaining · 0 kcal" over its own note saying "add
 // your weight for a target", and `fig(0)` is the string "0" rather than a
 // dash. The screen contradicted itself: a fabricated figure above an honest
 // caption.
 const remK = target ? caloriesLeft(target.kcal, tot.k, burned, burn?.budgeted ?? 0, burn?.kind).net : null;

 /**
  * The question, put BEFORE the camera opens.
  *
  * A meal photograph went to api.anthropic.com — through `analyzeMeal`, the
  * `vision-analyze` edge function, and nothing else — on the strength of a
  * camera permission reading "log a meal by photo". That describes the
  * hardware. It says nothing about the destination, and a plate is
  * photographed at a table: whoever is sitting round it and whatever room it
  * is goes with the food. See src/lib/photoAI.ts.
  *
  * Asked before the shutter, not after it, for the reason
  * app/(client)/scan-machine.tsx gives: a member who has already taken the
  * photo has already taken it, and putting the question afterwards makes
  * agreeing the way to stop having wasted the gesture. That is a nudge, not a
  * question.
  */
 const takeMealPhoto = async (fromCamera: boolean) => {
  const gate = mayAnalyzePhoto(photoAI.consent, visionAvailable());
  if (gate.block === 'unknown') {
   // Still reading the stored answer. Not a refusal and not a yes, and the
   // one honest thing to do with it is wait.
   Alert.alert('One moment', 'Still checking your answer about photos. Try that again in a moment.');
   return;
  }
  // 'unasked' and 'refused' both put the question, so somebody who said no
  // can change their mind in the same place they said it.
  if (gate.block === 'unasked' || gate.block === 'refused') { setAskPhoto({ fromCamera }); return; }
  // 'off' is not a refusal and gets no question: there is no reader on this
  // build, so there is nothing to agree to. The photo is still taken and the
  // meal is still logged, by hand, which is what this screen did before any
  // reader existed.
  await runMealPhoto(fromCamera, gate.allowed ? 'send' : 'off');
 };

 /**
  * Take the photograph, and send it only on 'send'.
  *
  * The outcome is passed in rather than re-derived, and it has three members
  * rather than a boolean because the sheet has to say WHY nothing was read.
  * "You said no", "this build has no reader" and "the reader gave nothing
  * back" are three different facts and the member's next move differs for
  * each; collapsing them into one sentence is the thing this screen is
  * otherwise careful about everywhere else.
  */
 const runMealPhoto = async (fromCamera: boolean, outcome: 'send' | 'refused' | 'off') => {
 if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'log a meal by photo'))) return;
 const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
 if (res.canceled || !res.assets?.[0]) return;
 const asset = res.assets[0];
 setPhotoUri(asset.uri);
 // Only while something is actually being read. On the two branches that send
 // nothing there is nothing to wait for, and a "Reading your meal…" overlay
 // over a photo that is going nowhere would be the screen describing a send
 // that is not happening.
 if (outcome === 'send') setReading(true);
 // Real vision read when the backend is live AND the member has agreed;
 // otherwise an empty sheet the member fills in. Nothing is estimated by this
 // screen either way.
 let read: { name: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null } | null = null;
 if (outcome === 'send' && visionAvailable() && asset.base64) {
  let mb = asset.base64;
  // The resize is an optimisation, not the read. `mb` already holds the picker's
  // own base64, so a manipulator that throws costs a larger upload and nothing
  // else — the same photo is sent and the same meal comes back. Nothing here is
  // worth a sentence to the member, who asked to log a meal and not to hear
  // about a compression step.
  try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) mb = mm.base64; } catch { /* see above: the original base64 is still in `mb` */ }
  read = await analyzeMeal(mb, 'image/jpeg');
 }
 setReading(false);
 setPendingPhoto(asset.uri);
 setPendingVia('photo');
 setPendingTitle(read ? 'Check And Log' : 'Enter This Meal');
 // The copy no longer promises to keep the picture. `food_logs` has no image
 // column and `logFood` has never been handed one, so "they'll be logged
 // against this photo" described something the app has never done: the photo
 // is read from, shown while the figures are typed, and gone when the sheet
 // closes. Saying so is the fix — the alternative is a promise the product
 // does not keep about the one thing a member cannot re-take.
 //
 // The refusal branch is deliberately NOT worded or styled as a failure. It is
 // the feature doing what the member asked: the photo is on screen, it went
 // nowhere, and the meal logs the same. See PHOTO_REFUSED_NOTE.
 setPendingNote(read
  ? 'Read from your photo — check every figure before logging it. The picture itself is not kept: it is here to read the meal from and to check against, and the numbers are what go into your log.'
  : outcome === 'refused' ? PHOTO_REFUSED_NOTE.meal
  : outcome === 'off' ? PHOTO_OFF_NOTE.meal
  : PHOTO_UNREAD_NOTE.meal);
 // A blank sheet rather than a zeroed one. Every box the reader did not fill
 // is empty, and src/ui/LogFoodSheet.tsx will not log until a person has.
 setPending(read
  ? { name: read.name, kcal: read.kcal, protein: read.protein, carbs: read.carbs, fat: read.fat, basis: null }
  : { name: '', kcal: NaN, protein: null, carbs: null, fat: null, basis: null });
 };

 // Nothing is scanned and nothing is logged — say so instead of inventing a hit.
 // Was `barcodeNote`: an alert that said nothing had been scanned and pointed
 // at the Meals screen. A button whose only function was to name another button.
 const [bcOpen, setBcOpen] = useState(false);
 // Which way in is open under the bar. Search first: it is the one that needs
 // no permission, no hardware and no model, so it is the one that always works.
 const [way, setWay] = useState<WayIn>('search');

 /* The kit's <Meter> in the macro's own hue — protein blue, carbs orange, fat
  * purple, as on Meals. Over target the bar turns red AND the note says
  * "over": the colour is never the only channel. */
 const macroRow = (label: string, cur: number, tg: number, tone: Tone) => {
 const rem = tg - cur;
 return <Meter key={label} label={label} tone={rem < 0 ? 'red' : tone} val={cur} target={tg}
  note={`${num(cur)} / ${num(tg)} g · ${rem >= 0 ? `${num(rem)} g left` : `${num(-rem)} g over`}`} />;
 };

 const G = layout.gutter;
 const field = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

 /* The sentence under the figure. Three reasons there is no target, and only
  * one of them is the member's to fix: sending somebody to add a weight they
  * already have, because their coach's adjustment or their own profile could
  * not be read, is the app blaming them for its own failed request. And under
  * a short read of the day, what is left cannot be worked out — the meals
  * listed are real, the subtraction is not. */
 const dayNote = !dayWhole
  ? (dayReading
   ? 'Reading today’s food log…'
   : fl.status === 'partial'
   ? 'More is logged today than can be read in one go, so what is left is unknown. What is listed below is real.'
   : 'Today’s log could not be read in full, so what is left is unknown. What is listed below is real.')
  : (target ? `${num(tot.k)} of ${num(target.kcal)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''}`
   : adjustUnknown ? `${num(tot.k)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''} · we couldn’t read your coach’s adjustment, so there is no target to show`
   : foodRulesUnknown ? `${num(tot.k)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''} · ${foodRulesReading ? 'reading what you are training for and how you eat' : 'we couldn’t read what you are training for or how you eat, and the target is worked out from both'}`
   : `${num(tot.k)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''} · add your weight for a target`);
 /* How far through the day's calories, as a whole percentage clamped to the
  * bar — 103% of a target is a full bar, and the figure above already says
  * how far over. Null wherever the figure is a dash. */
 const pctEaten = dayWhole && target && target.kcal
  ? Math.round(Math.max(0, Math.min(1, tot.k / target.kcal)) * 100)
  : null;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

 {/* The sentences that explain the screen rather than qualify a figure live
     behind this — a native alert, because they are three short lines and a
     fourth sheet on this screen would be a fourth modal to keep right. */}
 <PageHead title="Food Log" trailing={<Ghost icon="info" a11yLabel="How the food log works" onPress={() => Alert.alert('How The Food Log Works',
  'Tap a logged meal to correct what it was worth.\n\nUnder Log It Again, tap a food to log the same again — the sheet still asks how much — and tap the heart to keep one at the top.\n\nCommon and restaurant figures are typical portions, not a measurement of yours. A branded row is the product’s own label.')} />} />

 {/* ── the figure: what is left in the day ────────────────────────────
     The board's figure card where the old Hero block was: the label as the
     card's head, one big number with its unit, a thin bar for how far
     through the day's calories the member is, and the sentence that says
     what the number was worked out from. Everything the Hero withheld this
     card withholds — no figure and no bar until today's log is a whole
     read — and the bar is said as a percentage to a screen reader, as the
     ring was. */}
 <Section>
 <SectionHead title={remK == null ? 'Calories Eaten' : remK >= 0 ? 'Calories Remaining' : 'Calories Over'} />
 {/* Label, figure, unit and sentence are one fact, and one stop. */}
 <View accessible accessibilityLabel={[
   remK == null ? 'Calories eaten' : remK >= 0 ? 'Calories remaining' : 'Calories over',
   `${!dayWhole ? fig(null) : remK == null ? fig(tot.k) : fig(Math.abs(remK))} kcal`,
   // Not said twice: over a whole day with a target the row of named
   // figures under this speaks eaten, target and burned one at a time.
   ...(dayWhole && target ? [] : [dayNote]),
   // The ring is inside this one stop, so its percentage is said here.
   ...(pctEaten != null ? [`${pctEaten}% of today's calories eaten`] : []),
 ].join(', ')}>
 {/* The ring IS the figure now: what is left (or over, or — with no target —
     what was eaten) in the hole, the arc how far through the day's calories.
     `null` for both under anything but a whole read, and no arc without a
     target: the kit draws a dash on a bare track, never an empty circle round
     a full allowance. Red once the day is over, beside the word "over". */}
 <View style={{ alignItems: 'center', marginTop: sp.xs }}>
 <Ring size={156} tone={remK != null && remK < 0 ? 'red' : 'brand'}
  value={pctEaten != null ? pctEaten / 100 : null}
  figure={!dayWhole ? null : remK == null ? num(tot.k) : num(Math.abs(remK))}
  sub={remK == null ? 'kcal eaten' : remK >= 0 ? 'kcal left' : 'kcal over'}
  spoken={pctEaten != null ? `${pctEaten}% of today's calories eaten` : 'Today’s calories against target, not drawn'} />
 </View>
 {dayWhole && target ? null : <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md, textAlign: 'center' }}>{dayNote}</Text>}
 </View>
 {dayWhole && target && targetSource ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>{targetSource}</Text> : null}

 {/* The burn named in the note above is the last thing the device told us
     rather than a current reading. Same sentence as the Meals tab and the two
     Devices screens, so a member who reads more than one of them is told one
     thing. */}
 {burnStale ? (
 <Flag tone={t.warn} style={{ marginTop: sp.md }}>
 Calories burned is the last figure we had — your device could not be reached. Pull down to try again.
 </Flag>
 ) : null}
 </Section>

 {/* Target, eaten and burned as three named figures under the one that is
     left, because they are three different facts and the sentence above runs
     them together. Same gate as the figure: a whole read of a day that has a
     target. Burned only where a device reported one — no tile for a zero
     nobody measured — and it is shown, not subtracted: `caloriesLeft` never
     adds it back. Tiles, on the ground between the cards, each in its hue
     beside its word. */}
 {dayWhole && target ? (
 <KpiRow tiles items={[
  { label: 'Eaten', value: num(tot.k), unit: 'kcal', tone: 'orange' },
  { label: 'Target', value: num(target.kcal), unit: 'kcal', tone: 'blue' },
  ...(burned ? [{ label: 'Burned', value: num(burned), unit: 'kcal', tone: 'teal' as const }] : []),
 ]} />
 ) : null}

 {/* ── log a meal ─────────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Log a Meal" note={backdating ? dayLabel(logDay, today) : undefined} />

 {/* ── the day it goes to ───────────────────────────────────────────
     Everything this screen logged was stamped with the instant of the tap
     and there was no way to say otherwise, so a member who forgot to log
     dinner had no way to add it in the morning. The day chosen here governs
     every route below it — photo, upload, barcode, quick add, describe and
     search all go through the same two calls.

     A row of days rather than a calendar: the choice is almost always
     today or yesterday, and a date picker for that is three taps to answer
     a one-tap question. It scrolls to a fortnight, which is as far back as
     Recent Days can show — a member can only file a meal into a day they
     can still open and check. */}
 <ScrollView horizontal showsHorizontalScrollIndicator={false}
  accessibilityLabel="Which day to log to"
  contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.sm, paddingEnd: sp.md }}>
 {dayChoices.map((d) => {
  const on = d === logDay;
  return (
  <Pressable key={d}
   // Tapping Today clears the choice rather than pinning today's date, so
   // the screen goes on tracking the clock across midnight. See `pickedDay`.
   onPress={() => setPickedDay(d === today ? null : d)}
   accessibilityRole="button"
   accessibilityState={{ selected: on }}
   accessibilityLabel={`Log to ${dayLongLabel(d, today)}`}
   accessibilityHint={d === today ? undefined : 'Meals logged go into that day, not today'}
   style={{
    backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.sm,
    paddingHorizontal: sp.md, paddingVertical: sp.sm, minHeight: 44, justifyContent: 'center',
   }}>
  <Text style={{ ...ty.caption, ...font(on ? '600' : '500'), color: on ? t.brandInk : t.ink }}>
   {dayLabel(d, today)}
  </Text>
  </Pressable>
  );
 })}
 </ScrollView>
 {/* Nothing at all on the ordinary case. On a back-date it is the one thing
     the member cannot see for themselves: the hero figure above this section
     will not move, and a successful log that changes no number on screen
     reads as a button that did not work. */}
 {dayWarning ? <Flag tone={t.warn} style={{ marginBottom: sp.sm }}>{dayWarning}</Flag> : null}

 {/* ── the four ways in, one open at a time ───────────────────────────
     The board's segmented bar over one panel, where three buttons and two
     more cards used to be. Photo needs the camera and the member's consent,
     Barcode the camera, Describe the text model — Search needs nothing,
     which is why the bar opens on it. Every route below is the same code
     it was; the bar only chooses which one is on screen. */}
 <Segmented style={{ marginBottom: sp.md }} value={way} onChange={setWay} options={WAYS_IN} />

 {way === 'photo' ? (<>
 {/* Two ways to get a frame, the camera first. The question about where the
     frame goes is still asked before either opens — see `askPhoto`. */}
 <Cta label="Take a Photo" a11yLabel="Take a meal photo" wide onPress={() => takeMealPhoto(true)} />
 <View style={{ height: sp.sm }} />
 <Ghost label="Choose From Library" a11yLabel="Add meal photo from library" onPress={() => takeMealPhoto(false)} />
 </>) : way === 'barcode' ? (<>
 <Cta label="Scan a Barcode" a11yLabel="Scan barcode" wide onPress={() => setBcOpen(true)} />
 </>) : way === 'search' ? (<>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
 <Icon name="search" size={16} color={t.ink3} />
 <TextInput value={q} onChangeText={setQ} placeholder="Chicken, pad thai, a brand…" placeholderTextColor={t.ink3}
 accessibilityLabel="Search foods"
 style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: 11 }} />
 </View>
 {/* Why every row carries a source. A Common or Restaurant figure is a typical
     value for the portion named, not a measurement of the food in front of
     this person; a Branded figure is the product's own label. Rendering the
     two identically is how a generic average comes to be read as somebody's
     own packet, so the difference is said once here and shown on each row. */}
 <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>
 Common and restaurant figures are typical portions; a branded row is the product’s own label.
 </Text>
 {q.trim().length > 0 && q.trim().length < 3 ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>Keep typing — three letters or more.</Text>
 ) : null}
 {/* Said whether or not local rows came back. The old version showed this only
     when the list was empty, so a throttled branded search with a couple of
     common foods behind it looked like the whole answer. A shorter list is not
     allowed to pass for a complete one. */}
 {q.trim().length >= 3 && !searching && searchDown ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>
 {results.length
   ? "Branded products could not be reached just now, so these are the common foods and restaurant dishes only. Scan the barcode for a packet's own figures."
   : 'Food search could not be reached just now — this says nothing about whether the food is in there. Scan the barcode or describe it in the meantime.'}
 </Text>
 ) : null}
 {q.trim().length >= 3 && !searching && !searchDown && results.length === 0 ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>
 Nothing found. Try the brand name, scan the barcode, or describe it in words.
 </Text>
 ) : null}
 {/* Above the rows. A mark with no caveat reads the wrong way round: an
     unmarked result is one nothing has checked, not one that has been
     cleared — and under an unread exclusion list NOTHING has been checked,
     which is the loudest of the four sentences rather than the absence of
     one. Tone follows the state, as on Eating Out. */}
 {marksText && results.length ? (
 <Flag tone={marks.state === 'unknown' ? t.crit : marks.state === 'checking' ? t.ink3 : t.warn}
   style={{ paddingTop: sp.sm }}>{marksText}</Flag>
 ) : null}
 {results.map((r, i) => {
 // Only when the exclusions were actually read. Marking against a list that
 // is empty because nothing came back puts a mark on nothing and leaves
 // every other row looking cleared.
 const mark = marks.marked ? dishAllergenMark(dishAllergens(r.name, cd.avoid)) : null;
 return (
 <View key={r.key}>
 {i > 0 ? <Rule /> : null}
 {/* The sheet, not a straight write. A row logged on one tap recorded one
     portion of whatever basis the source used, so half a packet and two
     packets were the same entry — see src/ui/LogFoodSheet.tsx. */}
 <Pressable onPress={() => { setPendingTitle(undefined); setPendingNote(null); setPendingPhoto(null); setPendingVia('search'); setPending({ name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, basis: r.basis }); }}
 accessibilityRole="button" accessibilityLabel={mark ? `Log ${r.name} — ${r.label}. ${mark}` : `Log ${r.name} — ${r.label}`} accessibilityHint="Opens a sheet to say how much of it you had"
 style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, ...font('600'), color: t.ink }} numberOfLines={2}>{r.name}</Text>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.label}</Text>
 {mark ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
 <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
 <Text style={{ ...ty.caption, color: t.ink2 }}>{mark}</Text>
 </View>
 ) : null}
 </View>
 <TonedChip tone="orange" label={`${num(r.kcal)} kcal`} />
 <Icon name="plus" size={16} color={t.brand} />
 </Pressable>
 </View>
 );
 })}
 {/* What the head of the old Search Foods card said beside its title: how
     many came back, or that the branded index is down. Under the results
     now, where the count is about the rows it sits with. */}
 {q.trim() ? (
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
 {searching ? 'Searching…'
   : searchDown ? (results.length ? `${results.length} local · branded search down` : 'Branded search down')
   : `${results.length} match${results.length === 1 ? '' : 'es'}`}
 </Text>
 ) : null}
 </>) : (<>

 <View style={{ flexDirection: 'row', gap: sp.sm }}>
 <TextInput value={nl} onChangeText={setNl} placeholder='"chicken burrito & a coke"' placeholderTextColor={t.ink3} onSubmitEditing={logNL} returnKeyType="done"
 accessibilityLabel="Describe what you ate"
 style={{ ...field, flex: 1 }} />
 <Pressable onPress={logNL} disabled={nlBusy || !nl.trim()}
 accessibilityRole="button"
 accessibilityLabel={nlBusy ? 'Reading what you typed' : 'Log what you typed'}
 accessibilityState={{ disabled: nlBusy || !nl.trim(), busy: nlBusy }}
 style={{ backgroundColor: nl.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
 {nlBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, ...font('600'), color: nl.trim() ? t.brandInk : t.ink3 }}>Log</Text>}
 </Pressable>
 </View>
 </>)}

 <ListRow icon="meals" title="Eating Out?" note="Estimate a restaurant meal" onPress={() => router.push('/(client)/restaurant')} />
 </Section>

 {/* ── today's entries, or an honest empty state ──────────────────── */}
 <Section>
 {/* `num()`, not the raw figure: a day's calories passes a thousand routinely
     and "3500 kcal" is a reader's own separator missing from the one place on
     this screen that states the day's total. Every other figure here already
     goes through it. */}
 <SectionHead title="Logged Today" note={dayWhole ? `${num(tot.k)} kcal` : undefined} />
 {/* Meals on this phone that the server has not taken. They count toward
     today here and they are not lost — but they are not in the log a coach
     or another device reads, and only one of those two things is obvious
     from looking at the list. */}
 {unsentNote(fl.unsent, 'meal') ? (
 <Flag tone={t.warn} style={{ marginBottom: sp.sm }}>{unsentNote(fl.unsent, 'meal')}</Flag>
 ) : null}
 {entries.length === 0 ? (
 // An empty list under 'error' means we could not ask, never that nobody
 // ate anything — and "Nothing logged yet today" is exactly the sentence
 // that sends somebody to log their breakfast a second time.
 <Text style={{ ...ty.label, color: t.ink3 }}>
 {dayWhole ? 'Nothing logged yet today.'
  : dayReading ? 'Reading today’s log…'
  : 'We couldn’t read today’s log just now, so we don’t know what is in it. Anything you add here is kept and goes up when you have signal.'}
 </Text>
 ) : (<>
 {entries.map((fe, i) => (
 <View key={fe.id}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <Pressable onPress={() => openEdit(fe)} accessibilityRole="button"
  accessibilityLabel={`Edit ${fe.name}, ${num(fe.kcal)} calories, ${fmtTime(fe.at)}, ${VIA_LABEL[fe.via]}`}
  accessibilityHint="Opens the sheet to correct what it was worth"
  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
 {/* A round thumbnail where the board puts a photograph of the dish. The
     log keeps no picture of a meal — the photo route reads the frame and
     does not store it — so the circle carries the way the meal came in,
     and no photography is invented. */}
 <IconPlate size={48} icon={VIA_PLATE[fe.via].icon} tone={VIA_PLATE[fe.via].tone} />
 <View style={{ flex: 1, minWidth: 0 }}>
 <Text style={{ ...ty.body, ...font('600'), color: t.ink }} numberOfLines={2}>{fe.name}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 3 }}>P{fe.protein} · C{fe.carbs} · F{fe.fat}</Text>
 {/* When, and how it came in — the icon says the second in a picture and
     this says it in a word, because a figure read off a photograph and one
     read off a packet are not equally sure and the row should say which it
     is. `at` is when it was eaten, which for a queued meal is not when it
     reached the server. */}
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{fmtTime(fe.at)} · {VIA_LABEL[fe.via]}</Text>
 </View>
 {/* Calories are orange across the app, and the chip took the chevron's
     place: the row is a button by role and by hint, and five things across
     390pt left the dish's name a column. */}
 <TonedChip tone="orange" label={`${num(fe.kcal)} kcal`} />
 </Pressable>
 <Pressable onPress={() => removeMeal(fe)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + fe.name}
  style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
 <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
 </Pressable>
 </View>
 </View>
 ))}
 </>)}
 </Section>

 {/* ── macros against target ──────────────────────────────────────── */}
 <Section>
 <SectionHead title="Macros" />
 {/* Same rule as the hero: these bars are "how much of your protein have you
     had", and a sum over a day we could not read whole answers a question
     nobody asked. The meals themselves are still listed further down. */}
 {target && dayWhole ? macroRow('Protein', tot.p, target.protein, 'blue') : null}
 {target && dayWhole ? macroRow('Carbs', tot.c, target.carbs, 'orange') : null}
 {target && dayWhole ? macroRow('Fat', tot.f, target.fat, 'purple') : null}
 {/* The other half of the same rule, for the other missing side of the sum.
     A member whose coach's adjustment could not be read had three bars simply
     not drawn, under a heading, with nothing said. */}
 {!target && adjustUnknown ? (
  <Text style={{ ...ty.label, color: t.ink3 }}>
   Your coach’s adjustment to your macros could not be read, so these bars are left out rather than drawn against generic figures.
  </Text>
 ) : null}
 {/* And the member's own half of the same sum. Their goal and their diet are
     what split the calories into protein, carbs and fat — a bar drawn from the
     defaults would be measuring somebody who is cutting on keto against a
     meat-eating bulk. */}
 {!target && !adjustUnknown && foodRulesUnknown ? (
  <Text style={{ ...ty.label, color: t.ink3 }}>
   {foodRulesReading
    ? 'Reading what you are training for and how you eat — your protein, carb and fat targets are worked out from both.'
    : 'Your goal and diet could not be read, and your macro targets are worked out from both, so the bars are left out. Pull down to try again.'}
  </Text>
 ) : null}
 {target && !dayWhole ? (
  <Text style={{ ...ty.label, color: t.ink3 }}>
   {dayReading
    ? 'Today’s log is still loading, so we can’t yet say how much of your protein, carbs and fat you have had.'
    : 'Today’s log didn’t load in full, so we can’t say how much of your protein, carbs and fat you have had.'}
  </Text>
 ) : null}
 </Section>

 {/* ── again, please ──────────────────────────────────────────────── */}
 {/* Nothing at all until there is something to offer. An empty "Quick Add"
     heading over three empty lists is a control that looks broken on the one
     screen somebody opens four times a day. */}
 {favs.length || remembered.recent.length || remembered.frequent.length ? (<>
 <Section>
 <SectionHead title="Log It Again"
   note={favs.length ? `${favs.length} pinned` : undefined} />
 {/* Said when the lists are drawn from less than the whole log. A food
     missing from a short read has not been "never eaten"; it is a food we
     could not see. */}
 {rememberedShort ? (
 <Flag tone={t.warn}>
 These are drawn from the part of your log we could read. Something you eat often may be missing from them.
 </Flag>
 ) : null}
 {/* The pinned list is kept on this phone under a key that names the
     account, so when the account could not be read it cannot be opened at
     all. Said out loud: an absent Pinned group is otherwise
     indistinguishable from having pinned nothing, and a member who pinned
     their breakfast would reasonably conclude it had been lost. */}
 {favsUnknown ? (
 <Flag tone={t.warn}>
 We couldn’t check your account just now, so we can’t show your pinned foods or let you pin one. Nothing has been unpinned — this is our end rather than your sign-in.
 </Flag>
 ) : null}

 {favRows.map((g) => (g.rows.length ? (
 <View key={g.title} style={{ marginTop: sp.md }}>
 <Text accessibilityRole="header" style={{ ...ty.caption, ...font('700'), color: t.ink }}>{g.title}</Text>
 {g.rows.map((f, i) => (
 <View key={f.key}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
 <Pressable onPress={() => openRemembered(f)} accessibilityRole="button"
   accessibilityLabel={`Log ${f.name} again, ${num(f.kcal)} calories`}
   accessibilityHint="Opens a sheet to say how much of it you had"
   style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, ...font('600'), color: t.ink }} numberOfLines={2}>{f.name}</Text>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
 {`P ${num(f.protein)} · C ${num(f.carbs)} · F ${num(f.fat)}`}{f.count > 1 ? ` · logged ${num(f.count)} times` : ''}
 </Text>
 </View>
 <TonedChip tone="orange" label={`${num(f.kcal)} kcal`} />
 <Icon name="plus" size={16} color={t.brand} />
 </Pressable>
 {/* Withheld rather than disabled when there is nobody to pin for, or
     when the stored list could not be read — a control that silently does
     nothing is worse than no control. */}
 {uid && favsRead ? (
 <Pressable onPress={() => { void pinFood(f); }} hitSlop={8} accessibilityRole="button"
   accessibilityState={{ selected: isFavourite(favs, f.name) }}
   accessibilityLabel={isFavourite(favs, f.name) ? `Unpin ${f.name}` : `Pin ${f.name} to the top`}
   style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
 <Icon name="heart" size={16} filled={isFavourite(favs, f.name)} color={isFavourite(favs, f.name) ? t.brand : t.ink3} />
 </Pressable>
 ) : null}
 </View>
 </View>
 ))}
 </View>
 ) : null))}
 {favs.length >= MAX_FAVOURITES ? (
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
 Your pinned list is full at {num(MAX_FAVOURITES)}. Unpin one to pin another.
 </Text>
 ) : null}
 </Section>
 </>) : null}

 {/* ── the days behind today ──────────────────────────────────────── */}
 {/* This screen read exactly one day and offered no way to see any other.
     A member could log meals for a fortnight and had no picker, no week and
     no average — so "how much do I actually eat" was a question the app
     collected the answer to and never showed anybody. */}
 <Section>
 <SectionHead title="Recent Days" note={histWhole && hist.average ? `${hist.average.overDays} day${hist.average.overDays === 1 ? '' : 's'} logged` : undefined} />
 {/* A mean over a fortnight is a figure, and src/ui/loadStatus.ts is
     explicit that a figure may not be computed over a read that failed or
     stopped at its row limit. `overDays` goes with it wherever it is
     printed: "1,900 kcal a day" over two logged days out of fourteen is a
     different sentence from the same number over fourteen. */}
 {histWhole && hist.average ? (<>
  <KpiRow items={[
   { label: 'Average', value: fig(num(hist.average.kcal)), unit: 'kcal/day' },
   { label: 'Protein', value: fig(hist.average.protein), unit: 'g' },
   { label: 'Carbs', value: fig(hist.average.carbs), unit: 'g' },
   { label: 'Fat', value: fig(hist.average.fat), unit: 'g' },
  ]} />
  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
   Over the {hist.average.overDays} day{hist.average.overDays === 1 ? '' : 's'} you logged in the last fortnight — empty days are left out, not counted as nothing eaten.
  </Text>
 </>) : (
  <Text style={{ ...ty.label, color: t.ink3 }}>
   {hist.status === 'loading' ? 'Reading the last fortnight…'
    : hist.status === 'partial' ? 'More is logged in the last fortnight than can be read in one go, so no average is taken. The days below are real; the earliest is left out rather than half-counted.'
    : hist.status === 'error' ? 'We couldn’t read the last fortnight, so we can’t say what you have been eating. Nothing has been lost.'
    : 'Nothing logged in the last fortnight yet — a few days of meals and your average shows up here.'}
  </Text>
 )}

 {pastDays.length ? (
  <View style={{ marginTop: sp.md }}>
   {pastDays.map((d) => {
    const open = openDay === d.day;
    const [y, m, dd] = d.day.split('-').map(Number);
    const pretty = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    return (
     <View key={d.day}>
      <Pressable
       onPress={() => setOpenDay(open ? null : d.day)}
       accessibilityRole="button"
       accessibilityState={{ expanded: open }}
       accessibilityLabel={`${pretty}, ${num(d.kcal)} kilocalories over ${d.entries.length} meal${d.entries.length === 1 ? '' : 's'}`}
       accessibilityHint={open ? 'Hides the meals for this day' : 'Shows the meals for this day'}
       style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{pretty}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>P{d.protein} C{d.carbs} F{d.fat} · {d.entries.length} meal{d.entries.length === 1 ? '' : 's'}</Text>
       </View>
       <TonedChip tone="orange" label={`${num(d.kcal)} kcal`} />
      </Pressable>
      {open ? (
       <View style={{ paddingBottom: sp.md }}>
        {/* Tappable, and that is the gap this closes. MyFitnessPal, Lose It,
            Cronometer and Yazio all let somebody copy a meal off an earlier
            day — it is how people who eat the same Tuesday dinner every week
            log it — and this list was the one place in the app holding those
            meals with no way to act on them. Recents and Often above are
            derived and capped at five each, so anything eaten more than a few
            days ago and not often was unreachable from anywhere.

            Through the same review sheet as everything else: a re-log is a NEW
            row with the figures exactly as they were the first time, and the
            sheet still asks how much of it you had. Nothing here edits or
            moves the original — that day's record is untouched, which is the
            difference between copying a meal and back-dating one. */}
        {d.entries.map((fe) => (
         <Pressable key={fe.id}
          onPress={() => relogEntry(fe)}
          accessibilityRole="button"
          accessibilityLabel={`Log ${fe.name} again, ${num(fe.kcal)} calories`}
          accessibilityHint="Opens a sheet to say how much of it you had, and logs it against today"
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 6 }}>
          <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={1}>{fe.name}</Text>
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(fe.kcal)} kcal · P{fe.protein} C{fe.carbs} F{fe.fat}</Text>
          <Icon name="plus" size={14} color={t.brand} />
         </Pressable>
        ))}
       </View>
      ) : null}
     </View>
    );
   })}
  </View>
 ) : null}
 </Section>

 </ScrollView>

 {/* ── the question, asked before the camera opens ───────────────────
     Nothing has been photographed and nothing has been sent at the moment
     this is on screen. `askPhoto` holds which button was pressed and no
     more, so every way out of the sheet is a real answer:

       Send the Photo to Be Read   take it, send it, read the meal from it
       No — I'll Type It Myself    take it, send nothing, type the figures
       Cancel / back               nothing at all happens

     Dismissing it — the Android back button, a tap on the backdrop — is
     Cancel and not a quiet yes, which is the whole difference between a
     consent question and a notification. The two answers are RECORDED
     (photoAI.answer) rather than merely acted on: a dismissal asks again on
     the next tap, and that is how a question becomes a nag.

     A sheet rather than an Alert, for the reason app/(client)/injury-doc.tsx
     gives: Alert.alert cannot show four paragraphs, truncates its buttons on
     Android and orders them however the platform likes, and "Send" must not
     be the button a thumb is already resting on.

     Every sentence is rendered from src/lib/photoAI.ts rather than typed
     here, so what somebody agrees to cannot drift from what is sent. */}
 <Modal visible={askPhoto != null} transparent animationType="slide"
   onRequestClose={() => setAskPhoto(null)}>
  <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
    accessibilityRole="button" accessibilityLabel="Do not take a meal photo at all"
    onPress={() => setAskPhoto(null)} />
  <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: G, paddingBottom: 30, maxHeight: '88%', ...elevation.e2 }}>
   <ScrollView showsVerticalScrollIndicator={false}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>{PHOTO_ASK_KICKER.meal}</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>{PHOTO_ASK_TITLE.meal}</Text>
    <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>{PHOTO_DESTINATION_BY_SUBJECT.meal}</Text>

    <View style={{ marginTop: sp.lg, gap: sp.xs }}>
     <Text style={{ ...ty.micro, color: t.ink3 }}>What is sent</Text>
     {PHOTO_SENT_BY_SUBJECT.meal.map((line) => (
      <Text key={line} style={{ ...ty.caption, color: t.ink2 }}>&bull; {line}</Text>
     ))}
     <View style={{ height: sp.sm }} />
     <Text style={{ ...ty.micro, color: t.ink3 }}>What is not</Text>
     {PHOTO_NOT_SENT_BY_SUBJECT.meal.map((line) => (
      <Text key={line} style={{ ...ty.caption, color: t.ink2 }}>&bull; {line}</Text>
     ))}
    </View>

    {/* Not a consolation at the bottom — it is the half of the question that
        makes "no" an answer somebody can afford to give. */}
    <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>{PHOTO_IF_YOU_DECLINE.meal}</Text>

    <View style={{ marginTop: sp.xl, gap: sp.sm }}>
     <Cta label={PHOTO_SEND_LABEL.meal} a11yLabel={PHOTO_SEND_A11Y.meal} wide
       onPress={() => { const a = askPhoto; if (!a) return; photoAI.answer('yes'); setAskPhoto(null); void runMealPhoto(a.fromCamera, 'send'); }} />
     <Ghost label={PHOTO_DECLINE_LABEL.meal} a11yLabel={PHOTO_DECLINE_A11Y.meal}
       onPress={() => { const a = askPhoto; if (!a) return; photoAI.answer('no'); setAskPhoto(null); void runMealPhoto(a.fromCamera, 'refused'); }} />
     <Ghost label="Cancel" a11yLabel="Do not take a meal photo at all"
       onPress={() => setAskPhoto(null)} />
    </View>
   </ScrollView>
  </View>
 </Modal>

 {/* ── the meal is being read ──────────────────────────────────────── */}
 {/* Its own small modal rather than a state inside the sheet: the sheet does
     not open until there is something to put in it, and two seconds of
     nothing happening after the shutter reads as a button that did not work. */}
 <Modal visible={reading} transparent animationType="fade" onRequestClose={() => setReading(false)}>
  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: G }}>
   <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, padding: 20, alignItems: 'center', gap: sp.md, ...elevation.e2 }}>
    {photoUri ? <Image source={{ uri: photoUri }} accessible accessibilityLabel="The meal you photographed" style={{ width: 180, height: 120, borderRadius: radius.sm, backgroundColor: t.surface2 }} resizeMode="cover" /> : null}
    <ActivityIndicator color={t.brand} />
    <Text style={{ ...ty.label, color: t.ink3 }}>Reading your meal&hellip;</Text>
   </View>
  </View>
 </Modal>

 {/* ── correct a logged meal ────────────────────────────────────────── */}
 <Modal visible={editing != null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
   <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
 <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEditing(null)} accessibilityRole="button" accessibilityLabel="Close" />
 <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
 <Text style={{ ...ty.title, color: t.ink }}>Correct This Meal</Text>
 <Pressable onPress={() => setEditing(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
 <Text style={{ ...ty.label, ...font('500'), color: t.ink3 }}>Cancel</Text>
 </Pressable>
 </View>
 <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
 Today's totals and the calories you have left follow this straight away. It stays on today — correcting a meal does not move it to another day.
 </Text>
 <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Meal name</Text>
 <TextInput value={edN} onChangeText={setEdN} placeholder="What was it?" placeholderTextColor={t.ink3} style={{ ...field, marginBottom: sp.md }} />
 {/* The correction sheet, and the one that opens with numbers ALREADY in the
     boxes — so this is where a bare "P" over a filled field is worst: the
     reader is about to change a figure without being told what it measures. */}
 <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
 {[['Calories', 'kcal', edK, setEdK], ['Protein', 'g', edP, setEdP], ['Carbs', 'g', edC, setEdC], ['Fat', 'g', edF, setEdF]].map(([lbl, hint, val, set]: any) => (
 <Field key={lbl} label={lbl} hint={hint} a11y={`${lbl} in ${hint === 'g' ? 'grams' : 'calories'}`}>
 <TextInput value={val} onChangeText={set} keyboardType="numeric" style={{ ...field, ...numeric, paddingHorizontal: 10 }} />
 </Field>
 ))}
 </View>
 <Pressable onPress={saveEdit} disabled={edBusy} accessibilityState={{ disabled: edBusy, busy: edBusy }} accessibilityRole="button"
 accessibilityLabel={edBusy ? 'Saving the correction' : 'Save the correction'}
 style={{ backgroundColor: edBusy ? t.surface2 : t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
 {edBusy ? <ActivityIndicator color={t.ink2} /> : <Text style={{ ...ty.body, ...font('600'), color: t.brandInk }}>Save the correction</Text>}
 </Pressable>
 {/* Deleting is here as well as in the list, because "this was not a meal at
     all" is the correction somebody arrives at while they have the sheet
     open, and the confirm is the same one either way. */}
 <Pressable onPress={() => { const fe = editing; setEditing(null); if (fe) removeMeal(fe); }} accessibilityRole="button"
 style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: sp.xs }}>
 {/* The kit's ListRow idiom: crit in the icon, which only has to clear the
     3:1 of a mark, and the label in ink. crit as text is 3.03–4.05:1 on all
     ten palettes, so this was the least readable button in the sheet — and it
     is the one that destroys a record. The word "Remove" carries the meaning
     without the colour. */}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
 <Icon name="minus" size={14} color={t.crit} />
 <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>Remove this meal</Text>
 </View>
 </Pressable>
 </View>
   </KeyboardAvoidingView>
 </Modal>
 {/* A scanned product carries the basis its figures are for — "100 g", "1
     serving" — and that is exactly the question this sheet asks. It used to
     log one of whatever that was, so a member who ate a whole 500 g pot
     recorded 100 g of it. */}
 <BarcodeSheet visible={bcOpen} onClose={() => setBcOpen(false)}
   onLogged={(f) => {
     setPendingTitle(undefined); setPendingNote(null); setPendingPhoto(null); setPendingVia('barcode');
     setPending({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, basis: f.basis });
   }} />

 {/* ── the one review sheet ─────────────────────────────────────────── */}
 <LogFoodSheet
   food={pending}
   photoUri={pendingPhoto}
   title={pendingTitle}
   note={pendingNote}
   onClose={() => {
     // The next described food that could not be read whole, if there is
     // one. Closing the sheet on a queue would silently drop the rest of
     // what somebody typed.
     const [next, ...rest] = queue;
     setPending(next ?? null);
     setQueue(rest);
     if (!next) { setPendingPhoto(null); setPendingNote(null); setPendingTitle(undefined); }
   }}
   onLog={async (f) => {
     // Read here rather than when the sheet opened. A member can sit on this
     // sheet for a while — it is where they type a portion — and the day is
     // whatever it is when they press Log.
     const stamp = stampFor();
     if (!stamp) return false;
     const out = await fl.logFood({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, via: pendingVia }, stamp.at);
     // Refusal keeps the sheet open, because the figures in it are the member's
     // work and closing it would throw them away along with the meal.
     if (out === 'refused') { sayLogged(f.name, out, stamp.backdated, logDay); return false; }
     sayLogged(f.name, out, stamp.backdated, logDay);
     return true;
   }} />
 </SafeAreaView>
 );
}
