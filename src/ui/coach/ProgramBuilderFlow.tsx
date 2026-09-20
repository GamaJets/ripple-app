// The Program Builder's two pieces of workflow chrome: the Build / Review /
// Assign card that sits in the page, and the footer that stays on screen under
// it. Both are told everything they say — neither reads anything, so neither
// can disagree with the sections of app/(trainer)/builder.tsx that act on the
// same figures.
import { View, Text, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../components';
import type { Theme } from '../../theme/tokens';
import { Icon } from '../Icon';
import { Cta, Ghost, type Tone } from '../kit';
import { sp, layout, radius, hairline, elevation, fontScale, type as ty, font } from '../../theme/scale';

/* ── what colour a day and a muscle group are ──────────────────────────────
   The approved look fills a training day in the colour of its TYPE and draws a
   group's volume bar in the group's colour, on the builder, the template
   library, the exercise library and the exercise page. Four screens with four
   private opinions about which colour Legs is would be four legends, so the
   two answers live here, beside the builder chrome that was already shared.

   A program stores no "type" on a day. It stores the coach's focus line and
   the exercises, so the type is READ from those — the focus first, because it
   is what the coach said the day is, and the exercises' groups only when the
   focus says nothing this can recognise. 'Other' is an answer, not a failure:
   a day called "Rehab" with no grouped movement is not upper, lower or full. */
export type DayType = 'Upper' | 'Lower' | 'Full Body' | 'Conditioning' | 'Other';

export const DAY_TYPE_TONE: Record<DayType, Tone> = {
  Upper: 'blue', Lower: 'purple', 'Full Body': 'orange', Conditioning: 'teal', Other: 'brand',
};

const UPPER = /upper|push|pull|chest|\bback|shoulder|\barms?\b|bicep|tricep|\blats?\b|delt/i;
const LOWER = /lower|\blegs?\b|glute|hamstring|quad|calf|calves|\bhips?\b/i;
const FULL = /full|total|whole/i;
const CONDITIONING = /condition|cardio|hiit|metcon|interval|\brun|sprint|endurance/i;

export function dayTypeOf(day: { focus?: string | null; cardio?: string | null; exercises: readonly { group?: string | null }[] }): DayType {
  const focus = (day.focus ?? '').trim();
  if (FULL.test(focus)) return 'Full Body';
  // "Upper / Lower" in one focus line is both, which is a full-body day.
  if (UPPER.test(focus) && LOWER.test(focus)) return 'Full Body';
  if (UPPER.test(focus)) return 'Upper';
  if (LOWER.test(focus)) return 'Lower';
  if (CONDITIONING.test(focus)) return 'Conditioning';
  let up = 0, low = 0, full = 0, cond = 0;
  for (const e of day.exercises) {
    const g = (e.group ?? '').trim();
    if (!g) continue;
    if (FULL.test(g)) full += 1;
    else if (CONDITIONING.test(g)) cond += 1;
    else if (LOWER.test(g)) low += 1;
    else if (UPPER.test(g)) up += 1;
  }
  if (full || (up && low)) return 'Full Body';
  if (up) return 'Upper';
  if (low) return 'Lower';
  // Conditioning only when it is ALL the day is: a lifting day with a walk
  // after it is still a lifting day.
  if (cond || (day.cardio ?? '').trim()) return 'Conditioning';
  return 'Other';
}

export { groupTone } from '../groupTone';

/** A tone as a FILL with something written on it, and what is written.
 *
 *  The fill is the hue's INK step, not its mark. The ink step is the one
 *  measured to 4.5:1 against the card (src/theme/tokens.ts), so the card's own
 *  colour on top of it is the same pair the other way round; white on the
 *  mockup's orange MARK is 3.5:1, and a day's letter is text. On a dark
 *  palette mark and ink are one value and the card is dark, so it holds there
 *  too. */
export const toneFill = (t: Theme, tone: Tone): string =>
  (tone === 'brand' ? t.brand : tone === 'neutral' ? t.ink3 : t.data[`${tone}Ink`]);
/** A tone's soft plate and the ink that is written on it — what `TonedChip`
 *  draws with, for a chip that is also a BUTTON (the library's group filter),
 *  which the kit's chip is not. The kit keeps its own `toneOf` private. */
export const tonePlate = (t: Theme, tone: Tone): { mark: string; soft: string; ink: string } =>
  (tone === 'brand' ? { mark: t.brand, soft: t.brandSoft, ink: t.brandText }
    : tone === 'neutral' ? { mark: t.ink3, soft: t.surface3, ink: t.ink2 }
      : { mark: t.data[tone], soft: t.data[`${tone}Soft`], ink: t.data[`${tone}Ink`] });
export const toneOnFill = (t: Theme, tone: Tone): string => (tone === 'brand' ? t.brandInk : t.surface);

/**
 * A program's week as pips: seven, one per weekday in the order the app
 * draws a week, each training day filled in its type's colour. A library row's
 * answer to "what shape is this" without opening it.
 *
 * A program whose days are not weekdays ("Day 1", "Day 2") has no place in a
 * seven-slot week, so it is drawn as one pip per day instead — still true, and
 * no day is dropped for having an unexpected name.
 */
export function DayPips({ days, weekDays }: {
  days: readonly { day: string; focus?: string | null; cardio?: string | null; exercises: readonly { group?: string | null }[] }[];
  weekDays: readonly string[];
}) {
  const t = useTheme();
  if (!days.length) return null;
  const onWeek = days.every((d) => weekDays.includes(d.day));
  const slots = onWeek ? weekDays.map((w) => days.find((d) => d.day === w) ?? null) : [...days];
  const said = days.map((d) => `${d.day} ${dayTypeOf(d)}`).join(', ');
  return (
    <View accessible accessibilityRole="image"
      accessibilityLabel={`${days.length} training day${days.length === 1 ? '' : 's'}: ${said}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {slots.map((d, i) => (
        <View key={i} style={{ width: 14, height: 8, borderRadius: 4, backgroundColor: d ? toneFill(t, DAY_TYPE_TONE[dayTypeOf(d)]) : t.surface3 }} />
      ))}
    </View>
  );
}

type Step = {
  label: string;
  detail: string;
  state: 'complete' | 'current' | 'upcoming';
};

export function ProgramBuilderFlow({
  subject,
  dayCount,
  exerciseCount,
  findingCount,
  recipientCount,
  readyToAssign,
}: {
  subject: string | null;
  dayCount: number;
  exerciseCount: number;
  findingCount: number;
  recipientCount: number;
  readyToAssign: boolean;
}) {
  const t = useTheme();
  const steps: Step[] = [
    {
      label: 'Build',
      detail: exerciseCount
        ? `${dayCount} day${dayCount === 1 ? '' : 's'} · ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`
        : subject
          ? `Add ${subject}'s training days`
          : 'Choose a client or start a draft',
      state: exerciseCount > 0 ? 'complete' : 'current',
    },
    {
      label: 'Review',
      detail: exerciseCount === 0
        ? 'Checks run as you build'
        : findingCount
          ? `${findingCount} finding${findingCount === 1 ? '' : 's'} to read`
          : 'No listed findings',
      state: exerciseCount === 0
        ? 'upcoming'
        : findingCount === 0
          ? 'complete'
          : 'current',
    },
    {
      label: 'Assign',
      detail: recipientCount
        ? `${recipientCount} recipient${recipientCount === 1 ? '' : 's'} selected`
        : 'Choose who receives it',
      // `readyToAssign` means the prerequisites are satisfied, not that the
      // assignment has already happened. A check here made an untouched draft
      // look delivered before the coach pressed the real Assign action.
      state: readyToAssign ? 'current' : 'upcoming',
    },
  ];

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Program workflow. ${steps.map((step) => `${step.label}, ${step.state}: ${step.detail}`).join('. ')}`}
      style={{
        marginTop: sp.lg,
        // A card the way `Section` is one now: no edge, the card shadow.
        borderRadius: radius.lg,
        backgroundColor: t.surface,
        ...elevation.card,
        paddingHorizontal: sp.lg,
      }}>
      {steps.map((step, index) => (
        <View
          key={step.label}
          style={{
            minHeight: 64,
            flexDirection: 'row',
            alignItems: 'center',
            gap: sp.md,
            borderTopWidth: index === 0 ? 0 : hairline,
            borderTopColor: t.ring,
          }}>
          <View style={{
            // The mockups' plate: a rounded square, filled when the step is
            // done, the accent's soft plate on the step the coach is at.
            width: 36,
            height: 36,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: step.state === 'complete' ? t.brand : step.state === 'current' ? t.brandSoft : t.surface2,
          }}>
            {step.state === 'complete'
              ? <Icon name="check" size={16} color={t.brandInk} />
              : <Text style={{ ...ty.label, ...font('700', 'display'), color: step.state === 'current' ? t.brandText : t.ink3 }}>{index + 1}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.label, ...font('600'), color: t.ink }}>{step.label}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{step.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The builder's sticky workflow footer — the data-layout review's shared
 * component 10, "only where a long editor needs a persistent, unambiguous
 * save/assign action". This is that editor: a twelve-week block is forty
 * screens tall and the two writes that matter were at the far end of it.
 *
 * It answers the review's acceptance test without scrolling: WHO the program
 * is for, WHERE in it the coach is editing, WHAT is still outstanding, and what
 * each button WRITES. The two writes are two controls with two names — a
 * template goes to the coach's own library and reaches nobody; an assignment
 * replaces what a client trains — and they are drawn as different kinds of
 * button so that neither can be taken for the other. The draft is a third
 * write the coach never presses, so it is a sentence and not a control.
 *
 * The primary is dimmed rather than handed `disabled`, the way the builder has
 * always drawn it: its LABEL is the reason it is held ("Pick Who Gets This"),
 * and `Cta`'s disabled treatment greys the words a coach most needs to read.
 *
 * Stacks at large type. Two buttons on one line is ~150pt each on a phone, and
 * "Assign to Priya · 12 exercises" at 1.35× does not fit in that.
 */
export function ProgramWorkflowFooter({
  who,
  where,
  outstanding,
  draftNote,
  primaryLabel,
  onPrimary,
  primaryEnabled,
  secondaryLabel,
  onSecondary,
  onHeight,
}: {
  /** Who receives it, or that nobody has been chosen. Always said. */
  who: string;
  /** The week, day and exercise being edited, or null when none is open. */
  where: string | null;
  /** What still stands between this and an assignment, or null. */
  outstanding: string | null;
  /** That the work is kept on the phone, or null when it is not. */
  draftNote: string | null;
  primaryLabel: string;
  onPrimary: () => void;
  primaryEnabled: boolean;
  secondaryLabel: string;
  onSecondary: () => void;
  /** The bar's measured height, so the page can pad its scroll by exactly it. */
  onHeight?: (h: number) => void;
}) {
  const t = useTheme();
  const stacked = fontScale >= 1.35;
  const second = [outstanding, draftNote].filter(Boolean).join(' · ');
  return (
    <View pointerEvents="box-none"
      onLayout={(ev: LayoutChangeEvent) => onHeight?.(ev.nativeEvent.layout.height)}
      style={{
        position: 'absolute', start: 0, end: 0, bottom: 0,
        paddingHorizontal: layout.gutter, paddingTop: sp.sm, paddingBottom: sp.md,
        // White over the grey ground, as the mockup draws it: the bar is a
        // surface the page scrolls under, not more of the page.
        backgroundColor: t.surface, borderTopWidth: hairline, borderTopColor: t.ring,
      }}>
      <View accessible accessibilityRole="summary"
        accessibilityLabel={[who, where, outstanding, draftNote].filter(Boolean).join('. ')}
        style={{ marginBottom: sp.sm }}>
        <Text style={{ ...ty.caption, color: t.ink, ...font('600') }}>
          {who}{where ? <Text style={{ color: t.ink2, ...font('400') }}>{` · ${where}`}</Text> : null}
        </Text>
        {second ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{second}</Text> : null}
      </View>
      <View style={{ flexDirection: stacked ? 'column-reverse' : 'row', alignItems: stacked ? 'stretch' : 'center', gap: sp.sm }}>
        <Ghost label={secondaryLabel} onPress={onSecondary} />
        <View style={{ flex: stacked ? undefined : 1, opacity: primaryEnabled ? 1 : 0.55, ...elevation.e1 }}
          pointerEvents={primaryEnabled ? 'auto' : 'none'}>
          <Cta wide label={primaryLabel} onPress={onPrimary} />
        </View>
      </View>
    </View>
  );
}
