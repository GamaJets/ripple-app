// Trainer · My Nutrition — the coach's OWN food log, calories and macros.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// Coaches eat. app/(trainer)/my-training.tsx gave a coach somewhere to log
// their own session; there was still nowhere to log their own lunch, so a coach
// who tracks their intake had to keep a second account in the client app to do
// it. This is the same self-tracking, in the app they already have open,
// reading and writing the SIGNED-IN USER'S rows through the same
// `useFoodLog` provider the client's Meals and Food Log screens use.
//
// ── Whose day this is ──────────────────────────────────────────────────────
//
// `useFoodLog` reads `food_logs` for the signed-in account, always. In the
// coach app the signed-in account is the coach, so every figure here is the
// coach's own intake and never a client's. That is said in the tab title, the
// kicker, the sentence under the heading and the empty state, for the reason
// spelled out at length in my-training.tsx: a coach glancing at this screen
// mid-day must be able to tell in one look that they are not reading a client.
//
// ── Where a coach's meal is stored, and why that was once nowhere ──────────
//
// This is the one thing here that is not simply "the client screen, for the
// coach", and it is worth reading before changing anything.
//
// `food_logs.client_id` USED TO BE `references clients(id)`. RLS was never the
// obstacle — `food_owner` is `for all using (client_id = auth.uid())`, so a
// coach passes it — but the FOREIGN KEY was: `provision_profile()` gives a
// role='trainer' signup a `trainers` row and no `clients` row, so the insert
// was refused with a constraint violation no matter what the policy said. So
// the form was closed rather than left to fail on every submission forever.
//
// supabase/parts/95-own-food-and-scans.sql repointed both `food_logs` and
// `scans` at `profiles(id)`, which is the table every account does have, and
// that part is APPLIED to the live database — checked against pg_constraint
// rather than taken from the file:
//
//     food_logs_client_id_fkey  FOREIGN KEY (client_id)
//                               REFERENCES profiles(id) ON DELETE CASCADE
//
// and an insert run as a real role='trainer' account, under RLS, is accepted
// and reads back. So a coach can log a meal, and this screen opens the form.
//
// The probe below is KEPT rather than deleted, and now asks the question the
// foreign key actually asks: is there a `profiles` row to hang a meal on. That
// is true of every provisioned account, so in practice it answers 'stores' —
// but a signup whose `handle_new_user()` never ran is a real state, and being
// told why beats a form that silently refuses. Nothing is faked either way.
//
// ── What this screen is not ────────────────────────────────────────────────
//
// It logs and totals. It does not generate a meal plan, a grocery list or a
// restaurant lookup — the client app has all three and duplicating them here
// would fork them. And it never invents a calorie target: `macrosFor` needs a
// measured weight and body fat, and a target built on figures nobody measured
// is the placeholder body this codebase has spent a long time removing.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, Notice, PartialRead, KpiRow, Flag, Field, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { useAuthRevision } from '../../src/ui/authRevision';
import { useFoodLog, type FoodEntry } from '../../src/ui/foodLog';
import { useClientData } from '../../src/ui/clientData';
import { useWearables } from '../../src/ui/wearables';
import { isWhole } from '../../src/ui/loadStatus';
import { notifySuccess } from '../../src/ui/haptics';
import { caloriesLeft, caloriesNote, dayBurn, macrosFor } from '../../src/lib/nutrition';
import { readFoodEdit } from '../../src/lib/entryEdit';
import { searchCommonFoods, type CommonFood } from '../../src/lib/foods';
import { num } from '../../src/lib/format';

/**
 * Whether this account has anywhere to PUT a meal.
 *
 * 'checking'  — the question is still in flight.
 * 'stores'    — there is a `profiles` row, so an insert will be accepted.
 * 'no-record' — the account has no profile row at all, so `food_logs` will
 *               refuse the write on its foreign key however well-formed it is.
 * 'unknown'   — we could not find out. Distinct from 'no-record' on purpose:
 *               a failed read is not permission to tell a coach their logging
 *               is broken, and it is not permission to promise them it works.
 *
 * `profiles`, not `clients`. The table named here has to be the one the
 * FOREIGN KEY names, and since part 95 that is `profiles` — asking `clients`
 * answers a question the database stopped caring about, and answered it 'no'
 * for every coach, which is what closed this form for all of them. Every
 * account has a `profiles` row from `handle_new_user()`, coaches included.
 *
 * A read, not a data layer: it fetches no meal and computes nothing. It exists
 * because the alternative is a form that silently fails. `maybeSingle` because
 * a missing row is an answer rather than a fault — `single()` would report
 * PGRST116 as an error and land the coach in 'unknown' on the one path this
 * exists to describe.
 */
type FoodLogHome = 'checking' | 'stores' | 'no-record' | 'unknown';

function useFoodLogHome(): FoodLogHome {
  const rev = useAuthRevision();
  const [home, setHome] = useState<FoodLogHome>(USE_SUPABASE ? 'checking' : 'stores');

  useEffect(() => {
    // Backend off: the provider's in-memory store IS the record, and it takes
    // everything. There is no absent row to be refused by.
    if (!USE_SUPABASE) { setHome('stores'); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        // Signed out. Nothing is readable and nothing is writable, and saying
        // "your account has no profile" to nobody in particular would be
        // a claim about an account we have not identified.
        if (!sess?.session) { setHome('unknown'); return; }
        const uid = sess.session.user.id;
        const { data, error } = await supabase.from('profiles').select('id').eq('id', uid).maybeSingle();
        if (cancelled) return;
        if (error) { reportError('myNutrition.foodLogHome', error); setHome('unknown'); return; }
        setHome(data ? 'stores' : 'no-record');
      } catch (e) {
        reportError('myNutrition.foodLogHome', e);
        if (!cancelled) setHome('unknown');
      }
    })();
    return () => { cancelled = true; };
  }, [rev]);

  return home;
}

/** How many search hits fit above the fold without pushing the form off it. */
const SEARCH_LIMIT = 6;

export default function MyNutrition() {
  const t = useTheme();
  const router = useRouter();
  const fl = useFoodLog();
  const cd = useClientData();
  const wToday = useWearables().today;
  const home = useFoodLogHome();

  // An empty log under 'error' means "we could not read it", which is a
  // different sentence from "you have not eaten". Under 'partial' the rows are
  // real but they are not all of them, so `consumed` is a floor rather than a
  // total — and a "remaining" figure computed from a floor is an overestimate
  // that a coach would eat against. Both cases render a dash.
  const known = fl.status !== 'error';
  const whole = isWhole(fl.status);

  // No target unless there is a measured body to build one from AND the
  // profile it would be built from was actually read. A coach with no member
  // record has neither: `clients` is where weight, body fat, goal and diet
  // live, so `useClientData` hands back nulls and constructed defaults and
  // reports 'error' for the read that never found a row. Feeding those to
  // macrosFor would produce a day's calories belonging to nobody.
  const target = useMemo(() => {
    if (cd.profileStatus !== 'ready') return null;
    if (cd.weightKg == null || cd.bodyFatPct == null) return null;
    // No coach adjustment layered on: `coach_nutrition` is a coach's note to a
    // CLIENT, and nobody is coaching the coach.
    return macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });
  }, [cd.profileStatus, cd.weightKg, cd.bodyFatPct, cd.activity, cd.goal, cd.diet]);

  const burn = target ? dayBurn(target, wToday) : null;
  // The same function the client's two nutrition screens call, so a coach and
  // a client cannot be shown two different answers to "how many left".
  const left = target && whole
    ? caloriesLeft(target.kcal, fl.consumed.kcal, burn?.burned ?? 0, burn?.budgeted ?? 0, burn?.kind)
    : null;

  /* ── adding a meal ───────────────────────────────────────────────────── */

  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [kcalIn, setKcalIn] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [via, setVia] = useState<'manual' | 'search'>('manual');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The offline table, not the packaged-goods index: no network, no key, and
  // it is the same list the client's Food Log searches first.
  const hits = useMemo(
    () => (query.trim().length < 2 ? ([] as CommonFood[]) : searchCommonFoods(query, SEARCH_LIMIT)),
    [query],
  );

  const takeHit = (f: CommonFood) => {
    setName(f.n);
    setKcalIn(String(f.k));
    setProtein(String(f.p));
    setCarbs(String(f.c));
    setFat(String(f.f));
    setVia('search');
    setQuery('');
    setProblem(null);
  };

  const clearForm = () => {
    setName(''); setKcalIn(''); setProtein(''); setCarbs(''); setFat('');
    setVia('manual'); setProblem(null);
  };

  /**
   * Log the meal.
   *
   * `readFoodEdit` is the shared validator — the same one the client's Food Log
   * corrects a meal with. It refuses a typo instead of rounding it to zero,
   * which matters here for the same reason it matters there: a "0" that was
   * really a mistyped letter is a meal that silently stops counting.
   *
   * Awaited, and believed only when the row is on the server. `addFood` puts
   * the entry into today's totals optimistically, so a refused insert leaves a
   * meal on screen that is counting toward a day it is not part of — the coach
   * is told exactly that rather than being shown "Logged".
   */
  const logMeal = async () => {
    setProblem(null);
    const read = readFoodEdit({ name, kcal: kcalIn, protein, carbs, fat });
    if (!read.ok) { setProblem(read.reason); return; }
    setBusy(true);
    const saved = await fl.addFood({ ...read.value, via });
    setBusy(false);
    if (saved) {
      notifySuccess();
      clearForm();
      Alert.alert('Logged', `${read.value.name} — ${num(read.value.kcal)} kcal — is on your own food log for today.`);
      return;
    }
    // The boxes are deliberately NOT cleared. What was typed is the only copy
    // of it, and emptying the form would take that away on the one path where
    // the coach may want to try again.
    setProblem(home === 'no-record'
      ? 'Not saved. We could not find a profile for this account, so there is nowhere on the server to store a meal against it — see the note at the top of this screen.'
      : 'Not saved — we could not reach your food log. This meal is counting toward today on this phone only and will be gone when you next open the app.');
  };

  /**
   * Take a meal back off the day.
   *
   * `removeFood` resolves false on a refused delete and leaves the entry — and
   * its calories — exactly where they were, which is honest, and is why this
   * says so rather than letting a row vanish and reappear at the next launch
   * with the day's total quietly different again.
   */
  const remove = (e: FoodEntry) => {
    Alert.alert('Remove this meal?', `${e.name} — ${num(e.kcal)} kcal — comes off your own log for today, and today's totals go back down by it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        if (!(await fl.removeFood(e.id))) {
          Alert.alert('Not removed', `${e.name} is still on your log — we could not reach the server to take it out, so it is still counting toward today.`);
        }
      } },
    ]);
  };

  /* ── presentation ────────────────────────────────────────────────────── */

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 };
  const numInp = { ...inp, ...numeric, textAlign: 'center' as const };
  const G = layout.gutter;

  // The hero. With a target it counts down, without one it counts up, and
  // under an unread or truncated log it is a dash — never a zero, which on
  // this screen would read as "you have eaten nothing today".
  const heroLabel = !whole ? 'Eaten Today' : left ? (left.net >= 0 ? 'Calories Remaining' : 'Calories Over') : 'Eaten Today';
  const heroFigure = !whole ? num(null) : left ? num(Math.abs(left.net)) : num(fl.consumed.kcal);
  const heroNote = !whole
    ? (fl.status === 'loading'
      ? 'Reading your food log…'
      : fl.status === 'partial'
        ? 'Your log came back short, so today cannot be totalled from it.'
        : 'Your food log could not be read, so today is unknown rather than empty.')
    : left
      ? caloriesNote(left)
      : `${num(fl.consumed.kcal)} kcal logged today · no target, because nothing here has measured you`;

  const macroRow = (label: string, eaten: number, tg: number | null) => {
    const pct = tg ? Math.max(0, Math.min(100, Math.round((eaten / tg) * 100))) : 0;
    const rem = tg == null ? null : tg - eaten;
    return (
      <View key={label} style={{ marginTop: sp.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ ...ty.caption, color: t.ink2 }}>{label}</Text>
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
            {whole ? num(eaten) : num(null)}{tg == null ? ' g' : ` / ${num(tg)} g`}
            {rem != null && whole ? (rem >= 0 ? ` · ${num(rem)} g left` : ` · ${num(-rem)} g over`) : ''}
          </Text>
        </View>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
          <View style={{ height: 3, borderRadius: 2, width: `${whole && tg ? pct : 0}%`, backgroundColor: rem != null && rem < 0 ? t.crit : t.brand }} />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

          {/* ── header. Whose day this is, said before anything else ──────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
            <Ghost icon="back" onPress={() => router.back()} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Your own meals, not a client&rsquo;s</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>My Nutrition</Text>
            </View>
          </View>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
            Everything on this screen is food you logged for yourself, under your own account. No
            client&rsquo;s meals appear here, and nothing you log here reaches a client&rsquo;s record.
          </Text>

          {/* ── can what follows be trusted? ─────────────────────────────── */}
          {fl.status === 'error' ? (
            <Section>
              <Notice tone={t.warn} kicker="Your food log" title="We couldn’t read your food log"
                note="Your own meals are safe — this screen cannot see them right now. Nothing has been reset, and an empty list below means unknown rather than none." />
            </Section>
          ) : fl.status === 'partial' ? (
            <Section>
              <PartialRead what="meals on today’s log" shown={fl.entries.length} />
            </Section>
          ) : null}

          {/* ── can anything typed below actually be stored? ──────────────── */}
          {home === 'no-record' ? (
            <Section>
              <Notice tone={t.crit} kicker="Nowhere to store it" title="This account cannot keep a food log yet"
                note="Meals are stored against your profile, and we could not find one for this account. Anything you type below would be refused by the server, so the form is closed rather than throwing what you enter away. Signing out and back in usually rebuilds it; if it does not, your account needs looking at.">
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Log My Training Instead" icon="dumbbell" onPress={() => router.push('/(trainer)/my-training')} />
                </View>
              </Notice>
            </Section>
          ) : home === 'unknown' ? (
            <Section>
              <Notice tone={t.warn} kicker="Not checked" title="We couldn’t check whether meals will save"
                note="You can still try. If the meal does not reach the server you will be told so, and it will not be counted as logged." />
            </Section>
          ) : null}

          <Rule />

          {/* ── the day ──────────────────────────────────────────────────── */}
          <Hero
            label={heroLabel}
            figure={heroFigure}
            unit="kcal"
            note={heroNote}
            arc={whole && target && target.kcal ? fl.consumed.kcal / target.kcal : undefined}
            arcLabel="of today’s calories eaten"
            tone={left && left.net < 0 ? t.crit : undefined}
          />

          <Rule />

          {/* ── macros ───────────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Today’s Macros" note={target ? 'against your target' : undefined} />
            {macroRow('Protein', fl.consumed.protein, target ? target.protein : null)}
            {macroRow('Carbs', fl.consumed.carbs, target ? target.carbs : null)}
            {macroRow('Fat', fl.consumed.fat, target ? target.fat : null)}
            {!target ? (
              // Not a target of zero, and not a target guessed from a default
              // body. The reason is named, because "no target" with no reason
              // reads as a bug rather than as a missing measurement.
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.caption, color: t.ink3 }}>
                  {cd.profileStatus === 'loading'
                    ? 'Reading your profile…'
                    : cd.scansStatus === 'loading'
                      ? 'Reading your body composition…'
                      : cd.scansStatus === 'error'
                        // Not "nothing has measured you" — a failed read gives
                        // nobody the standing to say that about somebody's own
                        // record.
                        ? 'Your body composition could not be read, so there is no target to build from it. That is not the same as never having been measured. What is logged above is still your real intake.'
                        : 'There is no daily target here because nothing has measured you. A target is built from a weight and a body-fat percentage, and those come from a body scan. Add one on My Progress and this fills in. What is logged above is still your real intake.'}
                </Text>
                {cd.scansStatus !== 'loading' && cd.scansStatus !== 'error' ? (
                  <View style={{ marginTop: sp.md }}>
                    <Ghost label="Add My Body Scan" icon="scale" onPress={() => router.push('/(trainer)/my-progress')} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Section>

          <Rule />

          {/* ── what the target itself is, when there is one ─────────────── */}
          <Section>
            <SectionHead title="Your Daily Target" />
            <KpiRow items={[
              { label: 'Calories', value: target ? num(target.kcal) : fig(null), unit: target ? 'kcal' : undefined },
              { label: 'Protein', value: target ? num(target.protein) : fig(null), unit: target ? 'g' : undefined },
              { label: 'Maintenance', value: target ? num(target.tdee) : fig(null), unit: target ? 'kcal' : undefined },
            ]} />
            {target ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Built from your own weight and body fat with Katch–McArdle, the same way the client app
                builds one. Burn from a watch is shown beside the day, never added to the allowance.
                {/* Said, not hidden. `macrosFor` shifts calories by GOAL_ADJ and
                    the fat split by diet, and a coach account carries neither —
                    a goal and a diet live on a member record. What it uses are
                    the app's starting values, so the figure is a maintenance-led
                    muscle-gain target rather than one built on answers this
                    coach gave. A number whose assumptions are unstated is a
                    number nobody can check. */}
                {' '}It assumes a muscle-gain goal and no dietary restriction — a coach account holds
                neither, so those are the app&rsquo;s starting values rather than answers you gave.
              </Text>
            ) : null}
          </Section>

          <Rule />

          {/* ── log a meal ───────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Log a Meal" note={home === 'no-record' ? 'closed' : undefined} />
            {home === 'no-record' ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Closed until this account has somewhere to store a meal — see the note above. Nothing
                you typed here would be kept, so there is nothing to type.
              </Text>
            ) : (<>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                Search the common-foods table for the figures, or fill them in yourself. Goes onto your
                own log, dated today.
              </Text>
              <TextInput value={query} onChangeText={setQuery} placeholder="Search foods — “chicken breast”"
                placeholderTextColor={t.ink3} accessibilityLabel="Search common foods"
                style={[inp, { marginBottom: sp.sm }]} />
              {hits.length ? (
                <View style={{ marginBottom: sp.md, backgroundColor: t.surface, borderRadius: radius.sm, overflow: 'hidden' }}>
                  {hits.map((f, i) => (
                    <Pressable key={f.n} onPress={() => takeHit(f)}
                      accessibilityRole="button" accessibilityLabel={`Use ${f.n}`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                      <Text style={{ ...ty.body, color: t.ink }} numberOfLines={1}>{f.n}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                        {num(f.k)} kcal · {num(f.p)}p {num(f.c)}c {num(f.f)}f
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <TextInput value={name} onChangeText={(v) => { setName(v); setVia('manual'); }} placeholder="Meal name"
                placeholderTextColor={t.ink3} accessibilityLabel="Meal name" style={[inp, { marginBottom: sp.sm }]} />
              {/* Tapping a recent meal above fills all four of these, and so
                  does the food search — so the ordinary path puts numbers in
                  the boxes and takes every placeholder with it. Four bare
                  numerals in a row, three of them grams and one kilocalories,
                  and "P" "C" "F" were single letters even while they showed. */}
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <Field label="Calories" hint="kcal" style={{ flex: 1.2 }}>
                  <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" style={numInp} />
                </Field>
                <Field label="Protein" hint="g" a11y="Protein in grams">
                  <TextInput value={protein} onChangeText={setProtein} keyboardType="numeric" style={numInp} />
                </Field>
                <Field label="Carbs" hint="g" a11y="Carbohydrate in grams">
                  <TextInput value={carbs} onChangeText={setCarbs} keyboardType="numeric" style={numInp} />
                </Field>
                <Field label="Fat" hint="g" a11y="Fat in grams">
                  <TextInput value={fat} onChangeText={setFat} keyboardType="numeric" style={numInp} />
                </Field>
              </View>
              {problem ? <Flag style={{ marginTop: sp.md }}>{problem}</Flag> : null}
              <View style={{ marginTop: sp.md }}>
                <Cta wide label={busy ? 'Saving…' : 'Add to My Log'} onPress={logMeal} disabled={busy} />
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Leave a macro empty for none. A box that is not a number is refused rather than read as
                a zero — a mistyped figure that quietly becomes nothing is a meal that stops counting.
              </Text>
            </>)}
          </Section>

          <Rule />

          {/* ── today's entries ──────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Logged Today" note={known && whole && fl.entries.length ? `${fl.entries.length}` : undefined} />
            {fl.entries.length ? (
              fl.entries.map((e) => (
                <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.name}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
                      {num(e.kcal)} kcal · {num(e.protein)}p {num(e.carbs)}c {num(e.fat)}f
                    </Text>
                  </View>
                  <Pressable onPress={() => remove(e)} hitSlop={8} accessibilityRole="button"
                    accessibilityLabel={`Remove ${e.name} from your own food log`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>Remove</Text>
                  </Pressable>
                </View>
              ))
            ) : fl.status === 'loading' ? (
              <Text style={{ ...ty.body, color: t.ink3 }}>Reading your food log…</Text>
            ) : !known ? (
              // Not "you have eaten nothing today" — that is a claim about the
              // coach's own day that a failed read gives nobody the standing to
              // make.
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Whether you logged anything today is not known — your food log could not be read.
              </Text>
            ) : (
              // The empty state names whose log is empty, for the same reason
              // my-training.tsx does: "no meals yet" on a coach's screen is
              // exactly the sentence that could be misread as being about
              // whoever they were last looking at.
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Nothing of your own logged today yet. Anything you add above appears here, and only you
                ever see it.
              </Text>
            )}
          </Section>

          <Rule />

          {/* ── where a CLIENT's nutrition goes instead ──────────────────── */}
          <Section>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              Adjusting a client&rsquo;s calories or macros? That goes on their record, from their card
              on the Clients tab — not here.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md }}>
              <Icon name="people" size={14} color={t.ink3} />
              <Pressable onPress={() => router.push('/(trainer)/dashboard')} hitSlop={8} accessibilityRole="button">
                <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Go to Clients</Text>
              </Pressable>
            </View>
          </Section>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
