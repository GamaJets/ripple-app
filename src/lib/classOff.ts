// Telling the room a class is off — once, from wherever it was called off.
//
// ── why this moved out of app/(trainer)/classes.tsx ───────────────────────
//
// Two surfaces call a class off and only one of them told anybody. The coach
// app read the roster, bucketed it by how many of THEIR OWN bookings went, and
// sent one aggregated push per bucket. studio-web called `cancelClass` and sent
// nothing, relying on the database to push for it.
//
// That reliance is what this file exists to end, because it meant BOTH pushes
// happened for the coach app. `class_cancelled_notify` writes the inbox row
// with `push_by` defaulting to 'server', and `notifications_dispatch_push`
// claims every such row and posts it to send-push — so a member booked on one
// cancelled class got two notifications seconds apart, and a member booked on
// all nine weeks of a cancelled series got TEN: one well-worded aggregate from
// the handset, plus one per class from the dispatcher, because the row trigger
// fires per class and each firing is its own statement.
//
// src/lib/notifyCopy.ts calls that the failure that gets notifications turned
// off, and it is right. Part 2392 sets `push_by = 'caller'` on those rows, so
// the database now writes the inbox row and pushes nothing — and this function
// is the caller, shared, so studio-web pushes the same aggregated notification
// the coach app has always sent instead of losing its notification entirely.
//
// Nothing here is new logic. It is the coach app's `tellTheRoom` verbatim, with
// the one RN-specific line — `sendPushChecked`, which reaches expo-notifications
// and cannot be imported by Next.js — lifted into a parameter.
import { readByIds } from './idLookup';
import { classOffBuckets, classOffNotification, CLASS_OFF_ROUTE } from './notifyCopy';
import { notificationChannel } from './notifyDispatch';

type Queryable = { from: (table: string) => any };

/**
 * How a surface sends one push. The coach app passes `sendPushChecked`;
 * studio-web passes a wrapper over `supabase.functions.invoke('send-push')`.
 *
 * `ok` is "the send was accepted", never "it was delivered" — Expo's receipt is
 * a separate fetch minutes later and nothing polls for it. `partial` is
 * send-push saying its own read of `push_tokens` ran short, which makes any
 * count built from it a floor.
 */
export interface ClassOffSend {
  (userIds: string[], title: string, body: string, data: { route: string }, channel: string):
    Promise<{ ok: boolean; partial?: boolean }>;
}

export interface ClassOffTold {
  /** null is a roster that could not be READ, which is not nobody. */
  people: number | null;
  pushed: number;
  partial: boolean;
}

/**
 * Tell everybody booked or waiting on `classIds` that those classes are off.
 *
 * `people` null is a roster that could not be READ, which is not nobody: it is
 * the case where whoever called it off has to go and tell them, and reporting
 * it as zero is how twelve people arrive at a locked room believing the app
 * told them.
 *
 * `me` is dropped from the recipients — the same exclusion part 493's trigger
 * makes with `auth.uid()`, because somebody booked into their own class is
 * watching it happen. Pass null when it could not be read: that costs the
 * canceller one notification about their own cancellation and nothing else.
 */
export async function tellTheCancelledRoom(
  sb: Queryable,
  classIds: readonly string[],
  classTitle: string,
  why: string,
  me: string | null,
  send: ClassOffSend,
): Promise<ClassOffTold> {
  if (!classIds.length) return { people: 0, pushed: 0, partial: false };

  // ── Why this is `readByIds` and not one capped `.in()` ───────────────────
  //
  // The id list is a whole SERIES. `cancelSeriesFrom` hands back every
  // remaining occurrence, and a weekly class booked out three years ahead is
  // 156 of them — past `ID_CHUNK`, where a single `.in()` truncates the filter
  // or 414s, both in silence. The row list is every booking across all of them:
  // forty people a week for a year is two thousand rows, and 1,001 of them come
  // back. Neither failure says anything, and both make `people` smaller AND
  // send fewer notifications — so the canceller reads a reassuring figure about
  // a room that is partly still expecting a class.
  let rows: { userId: string; classId: string }[];
  try {
    const read = await readByIds<{ id: string; user_id: unknown; class_id: unknown }>(
      classIds as string[],
      (chunk, from, to) => sb
        .from('class_bookings')
        .select('id, user_id, class_id')
        .in('class_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
      'who had booked these classes',
    );
    rows = read
      .map((r) => ({
        userId: String(r?.user_id ?? '').trim(),
        classId: String(r?.class_id ?? '').trim(),
      }))
      .filter((r) => r.userId && r.classId && r.userId !== me);
  } catch {
    // Including a set too big to read honestly. `people: null` is already the
    // "we could not read who had booked" sentence, and it is the right one: the
    // classes ARE off, and the room has to be told by a person.
    return { people: null, pushed: 0, partial: false };
  }

  // Grouped by how many of THEIR OWN bookings went, so nine weeks of a series
  // is one notification per person rather than nine, and nobody is told a
  // figure about somebody else's diary. See src/lib/notifyCopy.ts.
  const buckets = classOffBuckets(rows);
  // Derived from the route rather than written out, so it cannot drift from
  // what notifications_set_channel stamps on the row the trigger writes.
  const channel = notificationChannel(CLASS_OFF_ROUTE, null) ?? '';
  let people = 0;
  let pushed = 0;
  // ANY bucket reporting `partial` makes the whole sentence's claim a floor:
  // the buckets are one cancellation seen from several diaries, not several
  // events, and the canceller acts on the sentence as a whole.
  let partial = false;
  for (const b of buckets) {
    people += b.userIds.length;
    const n = classOffNotification(classTitle, b.classes, why);
    // The channel is passed, and it was not before. It did not matter while
    // the dispatcher was also pushing this row — the dispatcher filtered on
    // 'bookings' and the handset did not, so a member who had muted bookings
    // was buzzed anyway by the handset's copy. Now that the caller is the only
    // pusher, dropping it would make muting that switch do nothing at all for
    // the one notification most worth muting.
    const res = await send(b.userIds, n.title, n.body, { route: n.route }, channel);
    if (res.ok) pushed += b.userIds.length;
    if (res.partial) partial = true;
  }
  return { people, pushed, partial };
}
