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
// Who the news is actually for, once a cancellation stops erasing itself. See
// that file's header and supabase/parts/3180 §8: this function read every row
// on the class and messaged all of them, which was the same set as "everybody
// still coming" only for as long as cancelling was a DELETE.
import {
  classOffAudience, classOffWaitingNotification, type ClassOffRow,
} from './classOffAudience';

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
  /**
   * How many DISTINCT people were told, or null for a roster that could not be
   * READ, which is not nobody.
   *
   * It is no longer "how many rows came back". A member who cancelled has a row
   * and is not told, and a member who holds a seat on one class of a series and
   * a waiting-list place on another is one person and not two. Counting rows
   * was the same number as counting people only while a cancellation deleted
   * itself; after supabase/parts/3180 it is the number that tells a coach
   * twelve people are expecting a class when four of them pulled out weeks ago.
   */
  people: number | null;
  /** Distinct people for whom at least one send was accepted. Accepted, never
   *  delivered: Expo's receipt is a separate fetch minutes later and nothing
   *  polls for it. */
  pushed: number;
  partial: boolean;
  /**
   * How many of `people` are in the list because their `class_bookings.status`
   * is a word this build cannot read, rather than because they hold a place.
   *
   * Zero on every database this build knows about — it takes a part that adds a
   * fifth value to the status CHECK to make it non-zero. It is surfaced rather
   * than swallowed because it is the one part of `people` that is a guess, and
   * a caller that later wants to say so has the number. See the header of
   * src/lib/classOffAudience.ts for why those rows are told rather than
   * silently dropped.
   */
  unreadable: number;
}

/**
 * Tell everybody booked or waiting on `classIds` that those classes are off.
 *
 * Booked or waiting, and NOT everybody with a row — which is what this said for
 * as long as a cancellation deleted itself and what it wrongly kept saying
 * after supabase/parts/3180 made the row survive. Somebody who cancelled this
 * class is told nothing about it and counted in nothing: they withdrew, and a
 * notification about a commitment they gave up weeks ago is the app failing to
 * remember what they did. `classOffAudience` is the whole of that decision and
 * the header of src/lib/classOffAudience.ts is its argument, including the one
 * case that comes out the other way from `holdsPlace`.
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
  if (!classIds.length) return { people: 0, pushed: 0, partial: false, unreadable: 0 };

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
  let rows: ClassOffRow[];
  try {
    // `status` is in the select and it was not before. Without it every row is
    // indistinguishable from every other, and after supabase/parts/3180 the
    // rows include the people who cancelled — see §8 of that part and the
    // header of src/lib/classOffAudience.ts. It is read as `unknown` and
    // interpreted by `seatStanding`, never compared as a bare string here:
    // there are four words the column may hold and a fifth is a part away.
    const read = await readByIds<{ id: string; user_id: unknown; class_id: unknown; status: unknown }>(
      classIds as string[],
      (chunk, from, to) => sb
        .from('class_bookings')
        .select('id, user_id, class_id, status')
        .in('class_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
      'who had booked these classes',
    );
    rows = read
      .map((r) => ({
        userId: String(r?.user_id ?? '').trim(),
        classId: String(r?.class_id ?? '').trim(),
        status: r?.status,
      }))
      .filter((r) => r.userId && r.classId && r.userId !== me);
  } catch {
    // Including a set too big to read honestly. `people: null` is already the
    // "we could not read who had booked" sentence, and it is the right one: the
    // classes ARE off, and the room has to be told by a person.
    return { people: null, pushed: 0, partial: false, unreadable: 0 };
  }

  // Who the news is for, and in whose words. A cancellation is dropped here and
  // nowhere else, so there is one place to read the decision and one place a
  // test can aim at.
  const audience = classOffAudience(rows);

  // Derived from the route rather than written out, so it cannot drift from
  // what notifications_set_channel stamps on the row the trigger writes.
  const channel = notificationChannel(CLASS_OFF_ROUTE, null) ?? '';
  // Sets and not running totals, because a person can now appear in BOTH
  // groups: a member holding a seat on week three of a series and waiting on
  // week seven is one person who gets two sentences, and adding the bucket
  // sizes would report them to the coach as two people. `people` is a count of
  // people and it has to stay one.
  const told = new Set<string>();
  const reached = new Set<string>();
  // ANY bucket reporting `partial` makes the whole sentence's claim a floor:
  // the buckets are one cancellation seen from several diaries, not several
  // events, and the canceller acts on the sentence as a whole.
  let partial = false;

  // Two passes over the same shape, one per relationship to the news. Within
  // each, grouped by how many of THEIR OWN places went, so nine weeks of a
  // series is one notification per person rather than nine and nobody is told a
  // figure about somebody else's diary. See src/lib/notifyCopy.ts.
  //
  // The most notifications anybody can now receive from one cancellation is
  // two, and only for somebody who held a seat on part of a series and a queue
  // place on the rest. That is the price of not telling a waitlister their
  // booking is kept, and it is the right way round: two accurate sentences beat
  // one that is wrong about half its readers.
  const passes: { rows: ClassOffRow[]; copy: typeof classOffNotification }[] = [
    { rows: audience.seated, copy: classOffNotification },
    { rows: audience.queued, copy: classOffWaitingNotification },
  ];
  for (const pass of passes) {
    for (const b of classOffBuckets(pass.rows)) {
      for (const u of b.userIds) told.add(u);
      const n = pass.copy(classTitle, b.classes, why);
      // The channel is passed, and it was not before. It did not matter while
      // the dispatcher was also pushing this row — the dispatcher filtered on
      // 'bookings' and the handset did not, so a member who had muted bookings
      // was buzzed anyway by the handset's copy. Now that the caller is the only
      // pusher, dropping it would make muting that switch do nothing at all for
      // the one notification most worth muting.
      const res = await send(b.userIds, n.title, n.body, { route: n.route }, channel);
      // `ok` is the send being ACCEPTED. Never claim success from the absence
      // of an error: a resolved send is not proof a message reached anybody,
      // which is why the coach's sentence says "queued" and not "told".
      if (res.ok) for (const u of b.userIds) reached.add(u);
      if (res.partial) partial = true;
    }
  }
  return {
    people: told.size,
    pushed: reached.size,
    partial,
    unreadable: audience.unreadable,
  };
}
