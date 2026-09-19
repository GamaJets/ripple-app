import { View, Text } from 'react-native';
import { useTheme } from '../components';
import { Icon } from '../Icon';
import { sp, radius, hairline, type as ty } from '../../theme/scale';

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
