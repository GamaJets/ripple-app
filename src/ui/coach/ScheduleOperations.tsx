import { View, Text } from 'react-native';
import { Cta, ListRow, Section, SectionHead } from '../kit';
import { useTheme } from '../components';
import { sp, type as ty } from '../../theme/scale';

export function ScheduleOperations({
  selectedDay,
  availabilityNote,
  deviceCalendarNote,
  googleCalendarNote,
  canExport,
  onAddSession,
  onAvailability,
  onBlockTime,
  onDeviceCalendar,
  onGoogleCalendar,
  onSessionOutcomes,
  onClasses,
  onExport,
}: {
  selectedDay: string;
  availabilityNote: string;
  deviceCalendarNote: string;
  googleCalendarNote: string;
  canExport: boolean;
  onAddSession: () => void;
  onAvailability: () => void;
  onBlockTime: () => void;
  onDeviceCalendar: () => void;
  onGoogleCalendar: () => void;
  onSessionOutcomes: () => void;
  onClasses: () => void;
  onExport: () => void;
}) {
  const t = useTheme();

  return (
    <Section>
      <SectionHead title="Run Your Schedule" />
      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
        Book the selected day first. Availability, time off, calendars and classes stay underneath as schedule-wide tools.
      </Text>
      <Cta wide label={`Add Session · ${selectedDay}`} onPress={onAddSession} />
      <View style={{ height: sp.md }} />
      <ListRow icon="clock" title="Weekly Availability" note={availabilityNote} onPress={onAvailability} />
      <ListRow icon="clock" title="Block Out Time" note={`Mark ${selectedDay} as unavailable so nobody can book it`} onPress={onBlockTime} />
      <ListRow icon="calendar" title="Block Time From Your Calendar" note={deviceCalendarNote} onPress={onDeviceCalendar} />
      <ListRow icon="calendar" title="Google Calendar" note={googleCalendarNote} onPress={onGoogleCalendar} />
      <ListRow icon="check" title="Session Outcomes" note="Mark completed, missed and cancelled sessions in one queue" onPress={onSessionOutcomes} />
      <ListRow icon="people" title="Group Classes" note="Schedule and fill classes across branches" onPress={onClasses} />
      {canExport ? (
        <ListRow icon="share" title="Export Schedule" note="Send your booked sessions to your calendar app" onPress={onExport} />
      ) : null}
    </Section>
  );
}
