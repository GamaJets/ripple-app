// The Program Builder's two pieces of workflow chrome: the Build / Review /
// Assign card that sits in the page, and the footer that stays on screen under
// it. Both are told everything they say — neither reads anything, so neither
// can disagree with the sections of app/(trainer)/builder.tsx that act on the
// same figures.
import { View, Text, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../components';
import { Icon } from '../Icon';
import { Cta, Ghost } from '../kit';
import { sp, layout, radius, hairline, elevation, fontScale, type as ty } from '../../theme/scale';

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
        borderRadius: radius.md,
        backgroundColor: t.surface,
        borderWidth: hairline,
        borderColor: t.ring,
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
            width: 28,
            height: 28,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: step.state === 'complete' ? t.brand : t.surface2,
            borderWidth: step.state === 'current' ? hairline : 0,
            borderColor: step.state === 'current' ? t.brand : 'transparent',
          }}>
            {step.state === 'complete'
              ? <Icon name="check" size={14} color={t.brandInk} />
              : <Text style={{ ...ty.caption, color: step.state === 'current' ? t.ink : t.ink3 }}>{index + 1}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>{step.label}</Text>
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
 * It answers the review's acceptance test without scrolling: WHO the programme
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
        backgroundColor: t.bg, borderTopWidth: hairline, borderTopColor: t.ring,
      }}>
      <View accessible accessibilityRole="summary"
        accessibilityLabel={[who, where, outstanding, draftNote].filter(Boolean).join('. ')}
        style={{ marginBottom: sp.sm }}>
        <Text style={{ ...ty.caption, color: t.ink, fontWeight: '600' }}>
          {who}{where ? <Text style={{ color: t.ink2, fontWeight: '400' }}>{` · ${where}`}</Text> : null}
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
