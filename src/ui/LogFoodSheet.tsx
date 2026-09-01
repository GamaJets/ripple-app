// How much of it did you eat — the one sheet that asks.
//
// ── Why it exists, and why it is one component ─────────────────────────────
//
// Four ways into the food log and only two of them ever asked a portion. A
// search row logged straight through on a single tap. The barcode sheet logged
// whatever basis Open Food Facts returned — "100 g", "1 serving", "330 ml" —
// with no multiplier anywhere. So a member who ate half a packet or two of them
// recorded exactly one, and the day's remaining calories, which is the one
// number this whole tab exists to show, were wrong by the amount nobody asked
// about.
//
// The Meals tab had the mirror of the same problem: its photo path COMMITTED,
// with an alert, while the Food Log tab offered an editable sheet for the same
// read of the same photo. One feature, two behaviours, and the tab that
// committed was the one where the read is least certain.
//
// And the third thing all of them share: an AI read can come back with calories
// and no macros. Those used to be coerced to zero (see src/lib/foodAI.ts), so a
// meal nobody measured the protein of counted as a zero-protein meal against
// the day. This sheet is where that gap is filled by the person, in a box,
// which makes it testimony instead of an assumption.
//
// One sheet for all of it, because this codebase has watched the alternative:
// the two calorie sums on these very screens once disagreed by a thousand
// kilocalories because the same modal had been copied.
//
// ── What it will not do ────────────────────────────────────────────────────
//
// Log a food with a blank macro. `food_logs` stores protein, carbs and fat as
// NOT NULL, so there is no row that can say "protein unknown" — the choice is a
// fabricated zero or a question, and this is the question.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Modal, Pressable, Image, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useTheme } from './components';
import { Field, Flag } from './kit';
import { sp, radius, elevation, type as ty, numeric } from '../theme/scale';
import { num } from '../lib/format';
import {
  QUANTITIES, readQuantity, scaleFood, missingMacroNote, basisLabel,
  type FoodFacts, type ScaledFood,
} from '../lib/foodPortion';

export function LogFoodSheet({ food, photoUri, title, note, onLog, onClose }: {
  /** The food being logged, or null when the sheet is closed. */
  food: FoodFacts | null;
  /** The picture it was read from, when there was one. Kept on screen while
   *  the figures are typed — it is the only reference the member has for what
   *  they are describing. */
  photoUri?: string | null;
  /** Overrides the heading. Title Case; defaults to "How Much Did You Have?". */
  title?: string;
  /** A sentence above the fields, for a caller with something particular to
   *  say — the photo paths use it to explain what was and was not read. */
  note?: string | null;
  /** Resolves true once the food is somewhere durable, which closes the sheet.
   *  False leaves it open with everything typed still in the boxes: the figures
   *  a member has just read off their own plate are the one thing they cannot
   *  get back by trying again. */
  onLog: (f: ScaledFood) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  // Reloaded whenever a different food arrives. A sheet reopened on the next
  // product must not open holding the last one's figures — which is what a
  // `useState` initialiser alone would do, since the component stays mounted.
  useEffect(() => {
    if (!food) return;
    setName(food.name ?? '');
    setKcal(Number.isFinite(food.kcal) ? String(Math.round(food.kcal)) : '');
    // Blank, not '0'. The whole point: a figure the reader did not give us is
    // an empty box somebody has to fill, and a zero we typed in for them is a
    // measurement they never made.
    setProtein(food.protein == null ? '' : String(Math.round(food.protein)));
    setCarbs(food.carbs == null ? '' : String(Math.round(food.carbs)));
    setFat(food.fat == null ? '' : String(Math.round(food.fat)));
    setQty('1');
    setWhy(null);
    setBusy(false);
  }, [food]);

  const readMacro = (v: string): number | null => {
    const s = v.trim().replace(',', '.');
    if (!s) return null;
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // What is in the boxes right now, as a food. Everything downstream — the
  // total on the button, whether the button works at all — is computed from
  // this one value, so the figure on the button is the figure that gets logged.
  const q = readQuantity(qty);
  const edited: FoodFacts | null = food
    ? {
      name: name.trim() || food.name,
      kcal: readMacro(kcal) ?? NaN,
      protein: readMacro(protein), carbs: readMacro(carbs), fat: readMacro(fat),
      basis: food.basis ?? null,
    }
    : null;
  const scaled = edited && q.ok && Number.isFinite(edited.kcal) ? scaleFood(edited, q.qty) : null;
  const gap = edited ? missingMacroNote(edited) : null;
  const per = basisLabel(food?.basis ?? null);

  const field = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  return (
    <Modal visible={food != null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
            <Text style={{ ...ty.title, color: t.ink }}>{title ?? 'How Much Did You Have?'}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </View>

          {photoUri ? (
            <Image source={{ uri: photoUri }} accessible accessibilityLabel="The meal you photographed"
              style={{ width: '100%', height: 140, borderRadius: radius.md, backgroundColor: t.surface2, marginBottom: sp.md }} resizeMode="cover" />
          ) : null}

          {note ? <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>{note}</Text> : null}

          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>What it was</Text>
          <TextInput value={name} onChangeText={setName} placeholder="What was it?" placeholderTextColor={t.ink3}
            accessibilityLabel="Food name" style={{ ...field, marginBottom: sp.md }} />

          {/* Named in full with the unit. "P C F" over three boxes taught the
              reader that the numbers here are whatever each column happens to
              mean, next to a calorie box that is not grams. */}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
            {([['Calories', 'kcal', kcal, setKcal], ['Protein', 'g', protein, setProtein], ['Carbs', 'g', carbs, setCarbs], ['Fat', 'g', fat, setFat]] as [string, string, string, (v: string) => void][]).map(([lbl, hint, val, set]) => (
              <Field key={lbl} label={lbl} hint={hint} a11y={`${lbl} in ${hint === 'g' ? 'grams' : 'calories'}${per ? `, ${per}` : ''}`}>
                <TextInput value={val} onChangeText={set} keyboardType="decimal-pad" style={{ ...field, ...numeric, paddingHorizontal: 10 }} />
              </Field>
            ))}
          </View>

          {/* What one portion IS, when the source said. When it did not, the
              control says "portions" and claims nothing about what one weighs —
              a "per 100 g" printed over a figure that is per serving is exactly
              the quiet wrongness this sheet exists to remove. */}
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>
            How many{per ? ` · the figures above are ${per}` : ' portions'}
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.sm }}>
            {QUANTITIES.map((s) => {
              const on = q.ok && q.qty === s;
              return (
                <Pressable key={s} onPress={() => setQty(String(s))} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${s} ${s === 1 ? 'portion' : 'portions'}`}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{s === 1 ? '1×' : `${s}×`}</Text>
                </Pressable>
              );
            })}
          </View>
          {/* The free box, because three and a bit packets of rice is a real
              thing to have eaten and a fixed ladder cannot hold every rung. */}
          <TextInput value={qty} onChangeText={setQty} keyboardType="decimal-pad"
            accessibilityLabel="How many portions" placeholder="1"  placeholderTextColor={t.ink3}
            style={{ ...field, ...numeric, marginBottom: sp.md }} />

          {gap ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{gap}</Text>
          ) : null}
          {/* A Flag, not crit text. The status colours are tuned to the 3:1 a
              MARK needs and crit as text is 3.03–4.05:1 across the palettes —
              and this is the sentence somebody reads when the button did not
              do what they expected, so it is the last one that may be hard to
              read. */}
          {why ? (
            <View style={{ marginBottom: sp.md }}><Flag tone={t.crit}>{why}</Flag></View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scaled ? `Log ${scaled.name}, ${num(scaled.kcal)} calories` : 'Log this food'}
            accessibilityState={{ disabled: !scaled || busy }}
            onPress={async () => {
              if (busy) return;
              // Said, not swallowed. A dead button with no reason is how
              // somebody concludes the app is broken and retypes everything.
              if (!q.ok) { setWhy(q.reason); return; }
              if (!edited || !Number.isFinite(edited.kcal)) { setWhy('Type the calories before logging this.'); return; }
              if (!scaled) { setWhy(missingMacroNote(edited) ?? 'Something here cannot be read.'); return; }
              setWhy(null);
              setBusy(true);
              try { if (await onLog(scaled)) onClose(); } finally { setBusy(false); }
            }}
            style={{ backgroundColor: scaled && !busy ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
            {busy
              ? <ActivityIndicator color={t.ink2} />
              : (
                <Text style={{ ...ty.body, fontWeight: '600', color: scaled ? t.brandInk : t.ink3 }}>
                  {scaled ? `Log ${num(scaled.kcal)} kcal` : 'Log This Food'}
                </Text>
              )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
