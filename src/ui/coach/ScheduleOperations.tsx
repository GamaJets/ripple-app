// The schedule-wide tools on the coach's Schedule tab: availability, time off,
// the two calendars, the outcomes queue, classes and export.
//
// Lifted out of app/(trainer)/calendar.tsx so the tab reads as one operating
// surface rather than a calendar with a Manage list under it.
//
// It used to open with the "Add a Session" button. That is an act on the
// SELECTED DAY and now sits at the foot of the day's own card, under the agenda
// it adds to; what is left here is administration, and the screen draws it
// last — the data-layout review's order for this tab is day, agenda, add,
// exceptions, standing appointments, and only then availability and calendar
// integration. Every note is
// composed by the screen, which is the only thing that knows the read states
// behind them — this component draws what it is handed and decides nothing.
//
// Folded. The approved Calendar is a month, a day and its rows; seven settings
// rows a coach needs a few times a month were the longest block on a screen
// opened several times a day. They are one tap away behind the kit's
// `Expandable`, and the sentence that introduced them is now its one-line
// note. Nothing here is a warning — the "nobody can book you" Notice that does
// need to be seen is drawn by the screen, outside this fold, with its own
// button to the same sheet.
//
// The plates are toned by what a row touches, in the screen's own colours:
// teal is open time, amber is blocked time, purple is classes, blue is a
// calendar that is not Repple's.
import { Expandable, ListRow } from '../kit';
import { useTheme } from '../components';

export function ScheduleOperations({
  selectedDay,
  availabilityNote,
  deviceCalendarNote,
  deviceCalendarAvailable,
  googleCalendarNote,
  canExport,
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
  /** False on a build without the native half: the row stays tappable — the
   *  sheet says why in full — but its icon goes to the quiet ink, which is
   *  the difference between "here is a thing you can do" and "here is a thing
   *  you cannot do yet, and here is why". */
  deviceCalendarAvailable: boolean;
  /** Null WITHDRAWS the row. Google Calendar is only offered when a client id
   *  is configured, which today is nowhere; a row saying "not available in
   *  this version yet" tells a coach to wait for an update that no update can
   *  bring. See the note in calendar.tsx. */
  googleCalendarNote: string | null;
  canExport: boolean;
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
    <Expandable title="Schedule Tools" note="Availability, time off, calendars and classes">
      <ListRow icon="clock" tone="teal" title="Weekly Availability" note={availabilityNote} onPress={onAvailability} />
      <ListRow icon="lock" tone="amber" title="Block Out Time" note={`Mark ${selectedDay} as unavailable so nobody can book it`} onPress={onBlockTime} />
      <ListRow icon="calendar" title="Block Time from Your Calendar" tone={deviceCalendarAvailable ? 'blue' : t.ink3}
        note={deviceCalendarNote} onPress={onDeviceCalendar} />
      {googleCalendarNote != null ? (
        <ListRow icon="calendar" tone="blue" title="Google Calendar" note={googleCalendarNote} onPress={onGoogleCalendar} />
      ) : null}
      <ListRow icon="check" tone="orange" title="Session Outcomes" note="Mark completed, missed and cancelled sessions in one queue" onPress={onSessionOutcomes} />
      <ListRow icon="people" tone="purple" title="Group Classes" note="Schedule and fill classes across branches" onPress={onClasses} />
      {canExport ? (
        <ListRow icon="share" tone="brand" title="Export Schedule" note="Send your booked sessions to your calendar app" onPress={onExport} />
      ) : null}
    </Expandable>
  );
}
