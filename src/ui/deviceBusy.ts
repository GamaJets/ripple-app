// The one place this app looks at somebody's calendar.
//
// ── Why this is not an import ─────────────────────────────────────────────
//
// There is no `import … from 'expo-calendar'` in this file and there must
// never be one anywhere. expo-calendar's entry point reaches
// `requireNativeModule('CalendarNext')` at MODULE SCOPE, so on a binary built
// before the dependency landed that import throws while the importing file is
// being loaded — the coach's schedule tab would not render at all, which is
// exactly what expo-clipboard did to the coach's home tab in August. The
// module comes from `deviceCalendar()` in src/ui/nativeModules.ts, which
// requires it inside a try/catch and answers null, and every path here branches
// on HAS_NATIVE_CALENDAR first. `npm run check:native` fails the build if that
// slips.
//
// The version was deliberately not bumped when expo-calendar was added, so
// every install already in a coach's pocket receives this JavaScript and
// answers `false` to HAS_NATIVE_CALENDAR. That is the designed path and not an
// edge case: it returns 'unavailable', the sheet says so in the app's own
// words, and blocking time by hand is untouched.
//
// ── READ ONLY, AND TIMES ONLY ─────────────────────────────────────────────
//
// Nothing in this file creates, updates or deletes an event. There is no call
// here that could: `listEvents` and `getCalendars` are reads, and the
// permission is requested with `writeOnly` false, which is read access.
//
// Every entry the calendar hands back goes straight into `toBusySpan`, which
// reads a start and an end and returns two numbers. Nothing else is copied out
// of the object, so nothing else exists to be stored, logged or rendered — see
// the header of src/lib/deviceBusy.ts. Calendar IDs are held for the length of
// one call because `listEvents` takes them, and calendar titles, sources,
// colours and owners are never read at all.
//
// `reportError` is called with a fixed string and no payload for the same
// reason: a failure carrying an event in it is a diary entry in a log.
import { HAS_NATIVE_CALENDAR, deviceCalendar } from './nativeModules';
import type { LoadStatus } from './loadStatus';
import { reportError } from '../lib/reportError';
import {
  busyCandidates, busyWindow, toBusySpan,
  type BusyCandidate, type BusyPermission, type BusySpan,
} from '../lib/deviceBusy';

export interface DeviceBusyRead {
  /** 'ready' when the phone answered — including when it refused, which is an
   *  answer. 'error' means the read did not happen and an empty list below
   *  means UNKNOWN rather than free. */
  status: LoadStatus;
  permission: BusyPermission;
  candidates: BusyCandidate[];
  /**
   * The periods behind `candidates`, before they were cut to days.
   *
   * Added for S3, which puts a SECOND calendar beside this one. Two lists of
   * candidates cannot be merged after the fact — a dentist appointment that is
   * on the phone AND on a synced Google account would be two rows, two
   * `block_time` calls and an 'already-blocked' refusal on the second, which a
   * coach reads as a failure. Merging happens on the spans, through the same
   * `busyCandidates` both sources already go through, so the screen holds ONE
   * list and neither source knows there was another.
   *
   * Still two numbers each. Nothing was widened to make this possible.
   */
  spans: BusySpan[];
}

/** Whether asking is even possible on this binary. Exported so a screen can say
 *  so before it opens anything. */
export const canReadDeviceBusy = (): boolean => HAS_NATIVE_CALENDAR && deviceCalendar() != null;

const REFUSED: DeviceBusyRead = { status: 'ready', permission: 'denied', candidates: [], spans: [] };

/** Whether a permission response means we may read. Both shapes are accepted
 *  because the module is untyped here by design and `granted` is the field the
 *  current API sets. */
function isGranted(res: unknown): boolean {
  if (!res || typeof res !== 'object') return false;
  const r = res as { granted?: unknown; status?: unknown };
  return r.granted === true || r.status === 'granted';
}

/**
 * When the coach is busy, between local midnight on `fromDay` and `days` later.
 *
 * Never throws. Every failure is a status the caller can put into words, because
 * an empty list that cannot say why it is empty is the defect this whole
 * feature would otherwise introduce: "you are free all fortnight", said to
 * somebody the operating system simply refused us access to.
 */
export async function readDeviceBusy(fromDay: string, days: number): Promise<DeviceBusyRead> {
  if (!HAS_NATIVE_CALENDAR) return { status: 'ready', permission: 'unavailable', candidates: [], spans: [] };
  const Cal = deviceCalendar();
  if (!Cal) return { status: 'ready', permission: 'unavailable', candidates: [], spans: [] };

  const win = busyWindow(fromDay, days);
  if (!win) return { status: 'error', permission: 'unknown', candidates: [], spans: [] };

  let permission: BusyPermission = 'unknown';
  try {
    // `false` is writeOnly — that is, ASK FOR READ. This app never writes to
    // anybody's calendar and requesting write-only access would be asking for
    // a power it has no code to use.
    const res = typeof Cal.requestCalendarPermissions === 'function'
      ? await Cal.requestCalendarPermissions(false)
      : await Cal.requestCalendarPermissionsAsync?.();
    if (!isGranted(res)) return REFUSED;
    permission = 'granted';

    // Ids only. A calendar's title ("Therapy", "Dad's chemo") is as private as
    // an event's and is never read.
    const cals = typeof Cal.getCalendars === 'function'
      ? await Cal.getCalendars(Cal.EntityTypes?.EVENT)
      : await Cal.getCalendarsAsync?.(Cal.EntityTypes?.EVENT);
    const ids: string[] = Array.isArray(cals)
      ? cals.map((c: { id?: unknown }) => (c && typeof c.id === 'string' ? c.id : '')).filter(Boolean)
      : [];
    // No calendars is a real, readable answer: nothing is subscribed on this
    // phone. It is 'ready' and empty, and the sheet says the window is clear
    // rather than that something went wrong.
    if (ids.length === 0) return { status: 'ready', permission, candidates: [], spans: [] };

    const from = new Date(win.fromMs);
    const to = new Date(win.toMs);
    const events = typeof Cal.listEvents === 'function'
      ? await Cal.listEvents(ids, from, to)
      : await Cal.getEventsAsync?.(ids, from, to);
    if (!Array.isArray(events)) return { status: 'error', permission, candidates: [], spans: [] };

    // The narrowing. Everything downstream of this line is numbers.
    const spans: BusySpan[] = [];
    for (const raw of events) {
      const span = toBusySpan(raw);
      if (span) spans.push(span);
    }
    return { status: 'ready', permission, candidates: busyCandidates(spans, fromDay, days), spans };
  } catch (e) {
    // The KIND of failure and nothing else. Not the caught value: `reportError`
    // stringifies whatever it is given and attaches the stack, and the thing
    // that went wrong here is holding somebody's private appointments — a
    // library message quoting the entry it choked on would put a diary entry
    // in a table the gym owner can read.
    reportError('readDeviceBusy', e instanceof Error ? e.name : 'calendar read failed');
    return { status: 'error', permission, candidates: [], spans: [] };
  }
}
