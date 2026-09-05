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
import { num } from '../../src/lib/format';
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
import { parseFoodText, foodAIAvailable, type ParsedFood } from '../../src/lib/foodAI';
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
import { supabase } from '../../src/lib/supabase';
import { notifySuccess } from '../../src/ui/haptics';
import { useToast } from '../../src/ui/toast';
import { useFoodLog, useFoodHistory, type FoodEntry } from '../../src/ui/foodLog';
import { isWhole } from '../../src/ui/loadStatus';
import { todayKey } from '../../src/lib/offlineQueue';
import { unsentNote } from '../../src/lib/offlineQueue';
import { readFoodEdit, foodChanged } from '../../src/lib/entryEdit';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useWearables } from '../../src/ui/wearables';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, ListRow, Flag, Field, KpiRow, fig } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';

type Food = { n: string; k: number; p: number; c: number; f: number };
type Logged = Food & { via: string };
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
const round = (n: number) => Math.round(n);

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
 // null until there is a body to scale to — the 70 kg / 20% placeholder that
 // used to stand in produced a target belonging to nobody.
 const goalTracker = useGoalTracker();
 const goals = goalTracker.goals;
 // The day type is not offered here. Zero is the Off day the Meals tab's picker
 // starts on, so the two screens agree for every member who has not moved it —
 // and a member who has is reading a what-if on the tab that offers it.
 const target = adjustUnknown ? null : (dayTarget({
  weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity,
  goal: cd.goal, diet: cd.diet,
  coachAdjust: soloEater ? null : (_adj ?? null),
  weightGoal: goals.find((g) => g.kind === 'weight' && !g.achievedAtISO) ?? null,
  weightSeries: cd.weightSeries,
  nowMs: Date.now(),
 })?.macros ?? null);

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
 const add = async (f: Food, via: string) => {
  const out = await fl.logFood({ name: f.n, kcal: f.k, protein: f.p, carbs: f.c, fat: f.f, via: via as any });
  if (out !== 'stored') warnUnsaved(f.n, out);
  return out === 'stored';
 };
 const logNL = async () => {
   const text = nl.trim(); if (!text) return;
   setNlBusy(true);
   const parsed = await parseFoodText(text);
   // A read that came back missing a macro is NOT logged with a zero in the
   // gap. `parseFoodText` used to coerce an absent protein to 0 and this loop
   // wrote it, so a described meal the model only knew the calories of counted
   // as a zero-protein meal against the day's remaining macros. Those go to the
   // sheet instead, one at a time, where a person fills the gap in.
   // Calories are on the same footing as the macros now. `parseFoodText` used
   // to coerce an absent calorie figure to 0 and then FILTER THE FOOD OUT for
   // being zero — so a described item the model could not price simply never
   // appeared, and a member who typed three things and got two back was never
   // told the third had been read at all. It goes to the sheet with the others,
   // where the calories box seeds empty and refuses to log until somebody types
   // one. `NaN` is what a FoodFacts carries for a calorie figure nobody has
   // supplied yet; the sheet has always read it that way (LogFoodSheet.tsx).
   const whole = (it: ParsedFood): it is ParsedFood & { kcal: number; protein: number; carbs: number; fat: number } =>
     it.kcal != null && it.protein != null && it.carbs != null && it.fat != null;
   const items = parsed ? parsed.filter(whole) : null;
   const gaps: FoodFacts[] = parsed
     ? parsed.filter((it) => !whole(it))
       .map((it) => ({ name: it.name, kcal: it.kcal ?? NaN, protein: it.protein, carbs: it.carbs, fat: it.fat, basis: null }))
     : [];
   if (parsed && parsed.length) {
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
    for (const it of items ?? []) {
     const out = await fl.logFood({ name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, via: 'manual' });
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
     setPendingNote(`Read from what you typed. Some of the figures did not come back, so they are blank rather than nought — fill them in and this can be logged.${gaps.length > 1 ? ` ${gaps.length - 1} more to check after it.` : ''}`);
     setPendingPhoto(null);
     setPending(gaps[0]);
     setQueue(gaps.slice(1));
    }
    // Refusal is reported ahead of the queue, because it is the one the client
    // has to do something about: those foods are not logged anywhere.
    const n = (items ?? []).length;
    if (refused) warnUnsaved(refused === n ? 'What you described' : `${refused} of the ${n} foods`, 'refused');
    else if (queued) warnUnsaved(queued === n ? 'What you described' : `${queued} of the ${n} foods`, 'unsent');
    else if (n) notifySuccess();
    return;
   }
   setNlBusy(false);
   Alert.alert('Could not read that', foodAIAvailable() ? 'Try describing it differently, e.g. \"2 eggs, toast and a coffee\".' : 'AI food logging turns on with the AI backend.');
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
 const pull = usePullToRefresh(useCallback(() => {
   fl.reload(); hist.reload(); cd.reload(); void coachNutrition.reload(); goalTracker.reload();
 }, [fl.reload, hist.reload, cd.reload, coachNutrition, goalTracker.reload]));
 const [openDay, setOpenDay] = useState<string | null>(null);
 const histWhole = isWhole(hist.status);
 // Today is drawn by everything above and does not need a row of its own down
 // here repeating it.
 const pastDays = hist.days.filter((d) => d.day !== todayKey());

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
 useEffect(() => {
  let cancelled = false;
  (async () => {
   try {
    // getSession, not getUser: getUser REJECTS when nobody is signed in, and
    // signed out is a true answer here rather than a failed read.
    const { data: sess } = await supabase.auth.getSession();
    const id = sess?.session?.user?.id ?? null;
    if (cancelled) return;
    setUid(id);
    if (!id) { setFavs([]); setFavsRead(false); return; }
    const raw = await AsyncStorage.getItem(favouritesKey(id));
    if (cancelled) return;
    const r = readFavourites(raw);
    setFavs(r.foods); setFavsRead(r.read);
   } catch { if (!cancelled) { setFavs([]); setFavsRead(false); } }
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
 const wToday = useWearables().today;
 const burn = target ? dayBurn(target, wToday) : null;
 const burned = burn?.burned ?? 0;
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
  try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) mb = mm.base64; } catch {}
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

 const macroRow = (label: string, cur: number, tg: number, dim?: boolean) => {
 const rem = tg - cur;
 const pct = Math.max(0, Math.min(100, Math.round((cur / (tg || 1)) * 100)));
 return (
 <View key={label} style={{ marginTop: sp.md }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
 <Text style={{ ...ty.caption, color: t.ink2 }}>{label}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{cur} / {tg}g · {rem >= 0 ? `${rem}g left` : `${-rem}g over`}</Text>
 </View>
 <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
 <View style={{ height: 3, borderRadius: 2, width: `${pct}%`, backgroundColor: rem < 0 ? t.crit : t.brand, opacity: dim && rem >= 0 ? 0.45 : 1 }} />
 </View>
 </View>
 );
 };

 const G = layout.gutter;
 const field = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Food Log</Text>
 </View>
 </View>

 {/* ── the hero: what is left in the day ──────────────────────────── */}
 <Hero
 label={remK == null ? 'Calories Eaten' : remK >= 0 ? 'Calories Remaining' : 'Calories Over'}
 figure={!dayWhole ? fig(null) : remK == null ? fig(tot.k) : fig(Math.abs(remK))}
 unit="kcal"
 note={!dayWhole
  ? (dayReading
   ? 'Reading today’s food log…'
   : fl.status === 'partial'
   ? 'You have logged more today than this screen can read in one go, so what is left in the day cannot be worked out from it. What is listed below is real.'
   : "We couldn't read all of today's log, so anything already eaten may be missing from this. What is listed below is real; the number left in the day is not something we can work out yet.")
  : (target ? `${num(tot.k)} of ${num(target.kcal)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''}`
   // Two reasons there is no target, and only one of them is the member's to
   // fix. Sending somebody to add a weight they already have, because their
   // coach's adjustment could not be read, is the app blaming them for its own
   // failed request.
   : adjustUnknown ? `${num(tot.k)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''} · we couldn’t read your coach’s adjustment, so there is no target to show`
   : `${num(tot.k)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''} · add your weight for a target`)}
 arc={dayWhole && target && target.kcal ? tot.k / target.kcal : undefined}
 arcLabel="of today's calories eaten"
 tone={dayWhole && remK != null && remK < 0 ? t.crit : undefined}
 />

 <Rule />

 {/* ── macros against target ──────────────────────────────────────── */}
 <Section>
 <SectionHead title="Macros" />
 {/* Same rule as the hero: these bars are "how much of your protein have you
     had", and a sum over a day we could not read whole answers a question
     nobody asked. The meals themselves are still listed further down. */}
 {target && dayWhole ? macroRow('Protein', tot.p, target.protein) : null}
 {target && dayWhole ? macroRow('Carbs', tot.c, target.carbs, true) : null}
 {target && dayWhole ? macroRow('Fat', tot.f, target.fat, true) : null}
 {/* The other half of the same rule, for the other missing side of the sum.
     A member whose coach's adjustment could not be read had three bars simply
     not drawn, under a heading, with nothing said. */}
 {!target && adjustUnknown ? (
  <Text style={{ ...ty.label, color: t.ink3 }}>
   We couldn’t read your coach’s adjustment to your macros, so these bars would be measuring you against the generic figures rather than your plan. They are left out rather than shown as yours.
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

 <Rule />

 {/* ── log a meal ─────────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Log a Meal" />
 <View style={{ flexDirection: 'row', gap: sp.sm }}>
 <Pressable accessibilityLabel="Take a meal photo" accessibilityRole="button" onPress={() => takeMealPhoto(true)}
 style={{ flex: 1, backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="camera" size={18} color={t.brandInk} />
 <Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>Photo</Text>
 </Pressable>
 <Pressable accessibilityLabel="Add meal photo from library" accessibilityRole="button" onPress={() => takeMealPhoto(false)}
 style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="plus" size={18} color={t.ink2} />
 <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Upload</Text>
 </Pressable>
 <Pressable accessibilityLabel="Scan barcode" accessibilityRole="button" onPress={() => setBcOpen(true)}
 style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="search" size={18} color={t.ink2} />
 <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Barcode</Text>
 </Pressable>
 </View>
 <ListRow icon="meals" title="Eating Out?" note="Estimate a restaurant meal" onPress={() => router.push('/(client)/restaurant')} />
 </Section>

 {/* ── again, please ──────────────────────────────────────────────── */}
 {/* Nothing at all until there is something to offer. An empty "Quick Add"
     heading over three empty lists is a control that looks broken on the one
     screen somebody opens four times a day. */}
 {favs.length || remembered.recent.length || remembered.frequent.length ? (<>
 <Rule />
 <Section>
 <SectionHead title="Log It Again"
   note={favs.length ? `${favs.length} pinned` : undefined} />
 <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
 Tap to log the same again — the sheet still asks how much. Tap the heart to keep one at the top.
 </Text>
 {/* Said when the lists are drawn from less than the whole log. A food
     missing from a short read has not been "never eaten"; it is a food we
     could not see. */}
 {rememberedShort ? (
 <Flag tone={t.warn}>
 These are drawn from the part of your log we could read. Something you eat often may be missing from them.
 </Flag>
 ) : null}
 {favRows.map((g) => (g.rows.length ? (
 <View key={g.title} style={{ marginTop: sp.md }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>{g.title}</Text>
 {g.rows.map((f, i) => (
 <View key={f.key}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
 <Pressable onPress={() => openRemembered(f)} accessibilityRole="button"
   accessibilityLabel={`Log ${f.name} again, ${num(f.kcal)} calories`}
   accessibilityHint="Opens a sheet to say how much of it you had"
   style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, color: t.ink }} numberOfLines={1}>{f.name}</Text>
 <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }}>
 {`P ${num(f.protein)} · C ${num(f.carbs)} · F ${num(f.fat)}`}{f.count > 1 ? ` · logged ${num(f.count)} times` : ''}
 </Text>
 </View>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(f.kcal)} kcal</Text>
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

 <Rule />

 {/* ── describe it in words ───────────────────────────────────────── */}
 <Section>
 <SectionHead title="Describe It" />
 <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 6 }}>In your own words — the AI reads it into macros</Text>
 <View style={{ flexDirection: 'row', gap: sp.sm }}>
 <TextInput value={nl} onChangeText={setNl} placeholder='"chicken burrito & a coke"' placeholderTextColor={t.ink3} onSubmitEditing={logNL} returnKeyType="done"
 style={{ ...field, flex: 1 }} />
 <Pressable onPress={logNL} disabled={nlBusy || !nl.trim()}
 style={{ backgroundColor: nl.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
 {nlBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, fontWeight: '600', color: nl.trim() ? t.brandInk : t.ink3 }}>Log</Text>}
 </Pressable>
 </View>
 </Section>

 <Rule />

 {/* ── search the food table ──────────────────────────────────────── */}
 <Section>
 <SectionHead
 title="Search Foods"
 note={!q.trim() ? undefined
   : searching ? 'searching…'
   : searchDown ? (results.length ? `${results.length} local · branded search down` : 'branded search down')
   : `${results.length} match${results.length === 1 ? '' : 'es'}`} />
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
 <Icon name="search" size={16} color={t.ink3} />
 <TextInput value={q} onChangeText={setQ} placeholder="Chicken, pad thai, a brand…" placeholderTextColor={t.ink3}
 style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: 11 }} />
 </View>
 {/* Why every row carries a source. A Common or Restaurant figure is a typical
     value for the portion named, not a measurement of the food in front of
     this person; a Branded figure is the product's own label. Rendering the
     two identically is how a generic average comes to be read as somebody's
     own packet, so the difference is said once here and shown on each row. */}
 <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>
 Common and restaurant figures are typical portions, not a measurement of yours.
 A branded row is the product's own label — use it when there is one.
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
   : 'Food search could not be reached just now — this says nothing about whether the food is in there. Scan the barcode or describe it below in the meantime.'}
 </Text>
 ) : null}
 {q.trim().length >= 3 && !searching && !searchDown && results.length === 0 ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>
 Nothing found. Try the brand name, scan the barcode, or describe it below.
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
 <Text style={{ ...ty.body, color: t.ink }} numberOfLines={2}>{r.name}</Text>
 <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }}>{r.label}</Text>
 {mark ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
 <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
 <Text style={{ ...ty.caption, color: t.ink2 }}>{mark}</Text>
 </View>
 ) : null}
 </View>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(r.kcal)} kcal</Text>
 <Icon name="plus" size={16} color={t.brand} />
 </Pressable>
 </View>
 );
 })}
 </Section>

 <Rule />

 {/* ── today's entries, or an honest empty state ──────────────────── */}
 <Section>
 <SectionHead title="Logged Today" note={dayWhole ? `${tot.k} kcal` : undefined} />
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
 <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xs }}>Tap a meal to correct what it was worth.</Text>
 {entries.map((fe, i) => (
 <View key={fe.id}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <Pressable onPress={() => openEdit(fe)} accessibilityRole="button" accessibilityLabel={'Edit ' + fe.name} style={{ flex: 1 }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{fe.name}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{num(fe.kcal)} kcal · P{fe.protein} C{fe.carbs} F{fe.fat}</Text>
 </Pressable>
 <Pressable onPress={() => openEdit(fe)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Edit ' + fe.name}>
 <Icon name="pencil" size={15} color={t.ink3} />
 </Pressable>
 <Pressable onPress={() => removeMeal(fe)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + fe.name}>
 <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
 </Pressable>
 </View>
 </View>
 ))}
 </>)}
 </Section>

 <Rule />

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
   Averaged over the {hist.average.overDays} day{hist.average.overDays === 1 ? '' : 's'} in the last fortnight you logged
   something. Days with nothing logged are left out rather than counted as nothing eaten.
  </Text>
 </>) : (
  <Text style={{ ...ty.label, color: t.ink3 }}>
   {hist.status === 'loading' ? 'Reading the last fortnight…'
    : hist.status === 'partial' ? 'You have logged more in the last fortnight than this screen can read in one go, so there is no honest average to take over it. The days below are real.'
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
      <Rule />
      <Pressable
       onPress={() => setOpenDay(open ? null : d.day)}
       accessibilityRole="button"
       accessibilityState={{ expanded: open }}
       accessibilityLabel={`${pretty}, ${num(d.kcal)} kilocalories over ${d.entries.length} meal${d.entries.length === 1 ? '' : 's'}`}
       accessibilityHint={open ? 'Hides the meals for this day' : 'Shows the meals for this day'}
       style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{pretty}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>P{d.protein} C{d.carbs} F{d.fat} · {d.entries.length} meal{d.entries.length === 1 ? '' : 's'}</Text>
       </View>
       <Text style={{ ...ty.body, ...numeric, color: t.ink }}>{num(d.kcal)}</Text>
       <Text style={{ ...ty.caption, color: t.ink3 }}>kcal</Text>
      </Pressable>
      {open ? (
       <View style={{ paddingBottom: sp.md }}>
        {d.entries.map((fe) => (
         <View key={fe.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 6 }}>
          <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={1}>{fe.name}</Text>
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(fe.kcal)} kcal · P{fe.protein} C{fe.carbs} F{fe.fat}</Text>
         </View>
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
   <View style={{ backgroundColor: t.surface, borderRadius: radius.md, padding: 20, alignItems: 'center', gap: sp.md, ...elevation.e2 }}>
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
 <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
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
 <Pressable onPress={saveEdit} disabled={edBusy} accessibilityState={{ disabled: edBusy }} accessibilityRole="button"
 style={{ backgroundColor: edBusy ? t.surface2 : t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
 {edBusy ? <ActivityIndicator color={t.ink2} /> : <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>Save the correction</Text>}
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
 <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Remove this meal</Text>
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
     const out = await fl.logFood({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, via: pendingVia });
     if (out === 'refused') { warnUnsaved(f.name, out); return false; }
     if (out === 'unsent') warnUnsaved(f.name, out); else notifySuccess();
     return true;
   }} />
 </SafeAreaView>
 );
}
