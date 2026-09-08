'use client';

// Classes — are they working?
//
// The Timetable answers "what is on, and who is on the floor". It cannot answer
// the question an owner actually asks before they cut a slot or hire a coach:
// are these classes full, do the people who book turn up, and where exactly are
// the empty places. Those are three different numbers and the gym has been
// guessing at all three from a week grid.
//
// Two rates, kept apart on purpose, because collapsing them is how a class read
// 71% in one place and 80% in another:
//
//   · FILL is booked / capacity — how much of the room was sold;
//   · SHOW is attended / booked — how many of the sold places walked in.
//
// A class can be 100% full and 40% show, which is a booking problem, or 30%
// full and 100% show, which is a demand problem. One number cannot tell an
// owner which of those they have, and the fix for each is the opposite of the
// fix for the other.
//
// The arithmetic is `summariseClassRows` in src/lib/classRates.ts, unchanged and
// shared with the phone app so the two cannot disagree. It sums first and
// divides once, so a class of three cannot swing the headline the way an
// average-of-averages would, and it returns null rather than 0 when a
// denominator was never recorded. This screen prints that null as a dash and
// says which denominator was missing.
//
// Three things this page refuses to do:
//
//   · count classes that have not happened yet. The window ends at this moment.
//     An unsold seat in next Tuesday's class is not an empty place, it is a seat
//     that is still for sale, and folding it in makes a healthy timetable look
//     like a failing one. The count of upcoming classes is read separately and
//     said out loud rather than silently dropped;
//   · put a class with no recorded capacity into the fill rate. Its bookings
//     would land in the numerator and nothing in the denominator, which reads
//     as a fuller gym than the room was. Those classes are excluded from fill
//     and counted on screen, so the exclusion is visible rather than tidy;
//   · treat an unmarked register as an empty class. `attended` is only ever what
//     somebody ticked. A slot where nobody was marked present looks identical to
//     a slot nobody attended, so those classes get their own section and the
//     register can be marked from it, rather than being quietly averaged into a
//     show rate that then reports the gym's own paperwork back as churn.
//
// ── Where these figures were taken ─────────────────────────────────────────
//
// `summariseClassRows` sums whatever it is handed, so a gym running classes in
// two rooms in two streets got one fill rate over both and every tile printed
// it under the gym's name. `branchSpan` (src/lib/ownedSites.ts) has been able
// to SAY so since it was written; this screen could only apologise for it.
//
// It can now do something about it. The picker under the tiles narrows every
// figure and every table here to one place — or to the classes with no place
// recorded, which is its own bucket and not a wastebasket — and "By place" puts
// each one's fill and show side by side over the whole window. The warning is
// keyed on what is ON SCREEN rather than on the gym, so choosing a place makes
// it go away, which is the correct behaviour: the figure has stopped being
// blended.
//
// None of this renders for any gym today. `gym_classes.branch` is written by
// the trainer app and by nothing in this console, so every gym is 'none' and
// the picker, the banner and the table are all absent. That is deliberate and
// it is not the same as dead code: the screen is now correct for the gym that
// starts using the field, rather than correct only for the gyms that do not.
//
// NOTE on src/lib/classAttendance.ts: its `classSummary` / `classRoster` /
// `setAttendance` cannot be used from this console. That module builds a
// Supabase client at import time from EXPO_PUBLIC_* env vars and React Native's
// AsyncStorage; under Next those vars are undefined, so createClient throws on
// import, and even if it did not, the RN client carries no browser session and
// every RPC would come back refused by RLS. The equivalents in gymSchedule.ts
// take the client as an argument — the same tables, the same writes — so this
// page uses those and the shared rate maths from classRates.ts, which imports
// nothing and is what classAttendance itself re-exports.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
// `Unresolved` comes from here rather than being declared at the bottom of
// this file. Seven console screens held a byte-identical copy, every one of
// them a plain `<div>` — so the sentence saying THIS section's rows could not
// be read was never announced. One copy, with the live region on it.
import { ConsoleGate, Unresolved } from '@/components/Gate';
import { type Unread, failure } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useLiveFetched } from '@/components/Fetched';
import { settledLanded } from '@lib/readLanded';
import { Banner as SharedBanner } from '@/components/Banner';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchClasses, fetchRoster, setAttendance, pct,
  promoteFromWaitlist, splitRoster, placesLeft,
  type GymClass, type RosterEntry,
} from '@lib/gymSchedule';
import { searchRows, searchNote } from '@lib/consoleSearch';
import { gymLink, noGymNote } from '@lib/gymLink';
// The reader's locale, the gym's zone. `groupSlots` below already buckets on
// the gym's weekday and hour; the tables were still printing each class on the
// reader's clock, so the same 06:00 class read 02:00 in London and was grouped
// under Tuesday while its own row said Monday.
import { gymDateTimeText } from '@lib/gymWhen';
import { parseGymZone, gymWeekday, gymHour, NO_ZONE_NOTE } from '@lib/gymZone';
import { fetchTrainerOptions } from '@lib/gymPtSchedule';
import { summariseClassRows, type ClassSummaryRow, type ClassRates } from '@lib/classRates';
import { branchSpan, branchNote } from '@lib/ownedSites';
// Escape, focus and the tab trap these dialogs never had.
import { useDialog, dialogPanel } from '@/lib/dialog';
import { num } from '@/lib/num';

const DAY = 86400000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 28, label: '28 days' },
  { days: 90, label: '90 days' },
] as const;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No classes ran in this window" are both lies about a query that errored, and
 * an owner acts on both of them — one by waiting, the other by cutting a class
 * off the timetable because the console told them nobody came to it.
 */


interface Trainer { id: string; name: string | null }

/* ── the place filter ──────────────────────────────────────────────────────── */

/**
 * The two selections that are not a place.
 *
 * `''` is every class in the window, which is where the screen starts and what
 * it has always shown. The other has to be a string a gym cannot type, because
 * "the classes with no place recorded" is a real bucket a gym with two rooms and
 * some unlabelled Tuesdays needs to look at, and it must not collide with a
 * label somebody actually used. `branchSpan` only ever collects TRIMMED,
 * NON-EMPTY labels, so anything `String.prototype.trim` strips is unreachable
 * from the data — which is what the leading SPACE below is doing.
 *
 * ── it was U+0000, and that emptied the screen ────────────────────────────
 *
 * A NUL is unreachable from the data too, and it does not survive HTML. This
 * value goes out as an `<option value>` and comes back through
 * `e.target.value`, and the HTML tokenizer replaces U+0000 in an attribute
 * value with U+FFFD — a rule in the parsing spec, not a browser quirk. So the
 * string this file serialised and the string the parser handed back were not
 * equal, `atPlace` matched nothing, and picking "classes with no place
 * recorded" at a gym that has some emptied every table on the screen: no
 * error, nothing to reset but a reload. `load()` below calls a filter that
 * empties every table "the one sentence this page must never say by accident".
 *
 * A space is stripped by `trim` exactly as a NUL is, so the collision argument
 * is unchanged, and an attribute value inside quotes preserves it byte for
 * byte. Written as the escape so that no editor, formatter or reviewer can
 * quietly lose it.
 */
const ALL_PLACES = '';
const NO_PLACE = '\u0020unlabelled';

/** Whether a row belongs in the current selection. `ALL_PLACES` keeps
 *  everything; `NO_PLACE` keeps exactly the rows `branchSpan` counts as
 *  unlabelled, which is the same trim it uses. */
function atPlace(row: { branch?: string | null }, place: string): boolean {
  if (place === ALL_PLACES) return true;
  const b = (row.branch ?? '').trim();
  return place === NO_PLACE ? b === '' : b === place;
}

/** What a place is called on screen. The unlabelled bucket is described rather
 *  than named — there is no name, and inventing one ("Main", "Unknown") would
 *  read as a place the gym had recorded. */
function placeLabel(place: string): string {
  return place === NO_PLACE ? 'classes with no place recorded' : place;
}

export default function Classes() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  // Whether the gym's NAME could not be READ, as distinct from there being no
  // gym. The read below still drops the error into a `no-error-ok:` — no figure
  // on this page depends on the name — but the rail printed "No gym linked" for
  // either, and that is a sentence about the owner's ACCOUNT produced by a
  // query that failed. Carrying this one bit is what lets the rail say which.
  const [gymNameUnread, setGymNameUnread] = useState(false);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [trainers, setTrainers] = useState<Trainer[] | null>(null);
  const [upcoming, setUpcoming] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number>(28);
  const [open, setOpen] = useState<GymClass | null>(null);
  // One search box over the two long tables on this page. The console had none
  // anywhere: at 90 days a busy gym runs several hundred classes, and finding
  // "the Thursday Spin" meant sorting a column and scrolling.
  const [q, setQ] = useState('');
  /** Which place the figures below cover. See ALL_PLACES / NO_PLACE above. */
  const [place, setPlace] = useState<string>(ALL_PLACES);

  const load = useCallback(async (tenantId: string, window: number): Promise<boolean> => {
    setClasses(null); setTrainers(null); setUpcoming(null); setErr(null);
    // The place filter is reset by the WINDOW BUTTONS, not from in here.
    //
    // `setPlace(ALL_PLACES)` used to sit on this line, and the argument for it
    // was about the window: "a 7-day window and a 90-day one do not have to
    // contain the same places, and a filter left pointing at a place the new
    // window has no classes at empties every table on the screen". That is
    // still true and the reset still happens — at `setDays`, which is the only
    // thing that changes the window.
    //
    // It cannot live here any more. `load` is no longer called only on mount
    // and on a window press: it is the reader handed to `useLiveFetched`, so it
    // now runs on every socket bump, on every return to the tab and on the
    // fallback poll. An owner who narrowed the screen to Studio 2 watched the
    // picker snap back to "Every place" — and every tile and all five tables
    // silently re-widen to the whole gym — the moment anybody anywhere in the
    // gym booked a class. The realtime change did not touch this line, which is
    // exactly why nothing noticed.
    const now = Date.now();
    // The window ends now, not at midnight and not at the end of the week: a
    // class that has not started cannot have a show rate, and its unsold seats
    // are still on sale.
    const from = new Date(now - window * DAY).toISOString();
    const to = new Date(now).toISOString();

    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused `trainers` read — which costs nothing but a
    // coach's name — would have emptied the classes as well, and the page would
    // have reported a gym that ran no classes at all for the month.
    const [cRes, tRes, uRes] = await Promise.allSettled([
      fetchClasses(supabase, tenantId, from, to),
      fetchTrainerOptions(supabase, tenantId),
      fetchClasses(supabase, tenantId, to, new Date(now + 28 * DAY).toISOString()),
    ]);

    // A read that failed is null, never []. [] is the gym saying it ran none;
    // null is nobody knowing. An owner acts differently on the two.
    setClasses(cRes.status === 'fulfilled' ? cRes.value : null);
    setTrainers(tRes.status === 'fulfilled' ? tRes.value : null);
    setUpcoming(uRes.status === 'fulfilled' ? uRes.value.length : null);

    const trouble = [
      failure(cRes, 'the classes in this window'),
      failure(tRes, 'the coach names'),
      failure(uRes, 'the classes still to run'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));

    // Whole means all three came back. `useFetched` stamps only on a whole
    // read, so a window whose classes would not load leaves the stamp where it
    // was rather than dating a fill rate computed from nothing.
    return settledLanded([cRes, tRes, uRes]);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      // `[]` here is the exact substitution the `load` above spends a paragraph
      // refusing to make: "A read that failed is null, never []. [] is the gym
      // saying it ran none; null is nobody knowing." A read nobody SENT is the
      // second of those too. This branch made the gym say it ran no classes at
      // all, gave it a fill rate of nothing and put `0` — not null — on "still
      // to run", while the `<Fetched>` line above said the window had never
      // been read. Nothing was asked. See src/lib/gymLink.ts.
      const link = gymLink(who?.tenantId, 'classes');
      if (!link.linked) return;
      // The error is now read off the result. Not because the name matters — it is
      // a label — but because "we could not ask" and "there is no gym" must not
      // arrive at the rail as the same null. See the Shell's gymNameUnread prop.
      const { data: t, error: tErr } = await supabase.from('tenants').select('name, timezone').eq('id', link.tenantId).single();
      if (live) {
        setGymName(tErr ? null : t?.name ?? null); setGymNameUnread(!!tErr);
        // The gym's own wall clock. A timetable repeats by weekday and hour, and
        // those are facts about the gym's week, not about whoever opened the tab.
        const z = tErr ? { kind: 'clear' as const } : parseGymZone((t as any)?.timezone);
        setZone(z.kind === 'zone' ? z.zone : null);
      }
    })();
    return () => { live = false; };
    // Identity and the gym record only. The classes are read by the effect
    // below, through `refresh` — which is also what stopped changing the window
    // from re-reading the gym's name and timezone on every press.
  }, []);

  /**
   * The chosen window's classes, kept current and dated.
   *
   * Fill and show are both cut at the moment of the read — the window ends
   * "now" — and this page never said which now. A tab open since the morning
   * reported a fill rate over a window that stopped in the morning, on the
   * screen an owner uses to decide whether to cancel a class this evening.
   *
   * ── Why THIS screen gets a socket ─────────────────────────────────────
   *
   * The number on it is a decision somebody makes at a counter. "3 places left"
   * is what the desk sells against while members are booking the same room from
   * their phones, and it is what the register is taken from while the class is
   * running. Both of those are minutes-old-matters, and both were a snapshot
   * from whenever the tab happened to be opened.
   *
   * `gym_classes` is filtered on the gym. `class_bookings` is NOT, and cannot
   * be: the table has no `tenant_id` column — it is scoped through its class,
   * in the policies at `supabase/parts/30` — so there is no column to filter on
   * and inventing a client-side one would be a filter that scopes nothing.
   * Realtime applies row-level security to what it forwards, so the events that
   * arrive are already the ones this account may read; and the count itself
   * comes from `fetchClasses(supabase, tenantId, …)`, whose
   * `.eq('tenant_id', tenantId)` is the only thing here that decides which
   * gym's classes appear. The payload is a doorbell, never a figure.
   */
  const { at: readAt, busy: reading, refresh, live: liveStatus } = useLiveFetched(
    () => (me?.tenantId ? load(me.tenantId, days) : Promise.resolve(false)),
    {
      channel: `console-classes-${me?.tenantId ?? 'none'}`,
      subs: me?.tenantId
        ? [
            { table: 'gym_classes', filter: `tenant_id=eq.${me.tenantId}` },
            // Unfiltered, because a filter cannot carry a DELETE — see
            // `LiveSub.filter` in lib/live.ts. A class removed from /timetable
            // at the other desk would otherwise stay on this page's tables and
            // in its fill figures. `class_bookings` needs no such pair: it is
            // already unfiltered, so its deletions arrive.
            { table: 'gym_classes', event: 'DELETE' },
            { table: 'class_bookings', filter: null },
          ]
        : [],
      enabled: !!me?.tenantId,
    },
  );

  useEffect(() => {
    if (me?.tenantId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId, days]);

  const nameOf = useCallback((c: GymClass): string => {
    const written = c.instructor?.trim();
    if (written) return written;
    const t = (trainers ?? []).find((x) => x.id === c.trainerId);
    return t?.name?.trim() ?? '';
  }, [trainers]);

  /**
   * Whether an empty `nameOf` is a fact about the gym or about the read.
   *
   * `nameOf` falls back through `trainers ?? []`, which is null when
   * `fetchTrainerOptions` failed — the whole point of the allSettled above. A
   * class that HAS a trainerId then came out nameless and the cell said "no
   * coach recorded", which is a positive claim about the record, made in the
   * one case where the record was never seen. The banner named the failed read;
   * the cell underneath contradicted it.
   */
  const nameUnread = useCallback(
    (c: GymClass): boolean => !c.instructor?.trim() && !!c.trainerId && trainers === null,
    [trainers],
  );

  // The shared row shape, so the shared rate maths can be used unchanged.
  //
  // `kind` is left empty rather than invented: it is not read by this screen and
  // nothing below renders it.
  //
  // `branch` is NOT. It was `''` here, and that emptied the one field that says
  // whether these rows come from one place or several — so every figure on this
  // screen was labelled as the gym's whether or not the classes behind it
  // happened at two. `summariseClassRows` sums whatever it is handed and cannot
  // know; `branchSpan` below is what asks.
  const allRows: ClassSummaryRow[] = useMemo(
    () => (classes ?? []).map((c) => ({
      classId: c.id,
      title: c.title,
      kind: '',
      branch: c.branch ?? '',
      trainerId: c.trainerId ?? '',
      trainerName: nameOf(c),
      startsAt: c.startsAt,
      capacity: c.capacity || 0,
      booked: c.booked,
      attended: c.attended,
    })),
    [classes, nameOf],
  );

  // What is actually on screen. Everything below — tiles, banners, all five
  // tables — reads these rather than `allRows`, so one control narrows the whole
  // screen and there is one thing to clear.
  const rows = useMemo(() => allRows.filter((r) => atPlace(r, place)), [allRows, place]);
  const shownClasses = useMemo(
    () => (classes ?? []).filter((c) => atPlace(c, place)),
    [classes, place],
  );

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/classes">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/classes">
        <h1>Not your console</h1>
        {/* This sentence was true about this screen and false about the other
            one: /timetable was owner-only too, so a coach sent here was sent
            from one shut door to another and had no register in this console at
            all. The board admits staff now, so the link goes with the sentence
            — a refusal that names where to go should be clickable, or the
            reader has to guess at the URL. */}
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          Class performance across every coach is an owner&rsquo;s screen. Your own classes and their
          registers are on the <a href="/timetable" style={{ color: 'var(--brand)' }}>Timetable</a>,
          which is in your menu.
        </p>
      </Shell>
    );
  }

  // Before the fill rates — and it is what lets the line below read
  // `me.tenantId` instead of asserting `me.tenantId!`. Every figure on this
  // screen is a rate — filled, shown, no-showed — and a rate computed over no
  // classes is a judgement on coaches who ran a full week, printed because the
  // reader's account lost its gym.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/classes">
        <h1>Classes</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('classes')}
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId;
  // `refresh` is the hook's, not a second reader — see /money for the same note.

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread: Unread = classes !== null ? null : err ? 'failed' : 'loading';

  // Two summaries over two different sets, and the difference is on screen
  // rather than buried. `all` is every class that ran; `rated` is only those
  // that recorded a capacity, because a class with none puts its bookings into
  // fill's numerator and nothing into its denominator — which reads as a fuller
  // room than the gym actually sold.
  const all: ClassRates | null = classes ? summariseClassRows(rows) : null;
  const capacityless = rows.filter((r) => r.capacity <= 0);
  const rated: ClassRates | null = classes ? summariseClassRows(rows.filter((r) => r.capacity > 0)) : null;

  const emptyPlaces = rated && rated.capacity > 0 ? Math.max(0, rated.capacity - rated.booked) : null;
  const overbooked = rows.filter((r) => r.capacity > 0 && r.booked > r.capacity);
  // Counted off `shownClasses` rather than `rows`, because ClassSummaryRow is
  // the shared rate shape and a waiting list is not part of a rate. Filtered by
  // place like everything else: eleven people queueing at the other site is not
  // a fact about the site being read.
  const waiting = shownClasses.reduce((a, c) => a + c.waitlisted, 0);
  const waitingClasses = shownClasses.filter((c) => c.waitlisted > 0).length;
  const waitingAttended = shownClasses.reduce((a, c) => a + c.waitlistAttended, 0);
  const unmarked = shownClasses.filter((c) => c.booked > 0 && c.attended === 0);

  const status: 'ready' | 'error' | 'loading' =
    classes ? 'ready' : unread === 'failed' ? 'error' : 'loading';

  /**
   * How many places this gym's window covers, and how many the figures do.
   *
   * `gym_classes.branch` is a label for a place within one gym (see the column
   * comment, and supabase/parts/290 for why it is not the multi-site key). A
   * gym that uses it for two rooms in two streets gets ONE fill rate over both
   * out of `summariseClassRows`, and every tile below would print it under one
   * gym's name. The number is real; the label on it is not.
   *
   * TWO spans, because they answer two different questions:
   *
   *   · `span` is over the whole window and is what the picker is built from —
   *     the places this gym has, which do not change when somebody chooses one
   *     of them;
   *   · `shownSpan` is over what is actually on screen, and is what the warning
   *     is keyed on. Choose a place and the figures stop being blended, so the
   *     warning goes: it was never a statement about the gym, it was a statement
   *     about the number beside it.
   *
   * 'unknown' while the read has not settled, so neither can certify a window
   * nobody has seen. Every gym in the live database is 'none' today — nothing in
   * this console writes a branch, and the trainer app is the only thing that has
   * ever offered the field — so the picker and the By place table below render
   * nothing at all until a gym starts using it. That is the honest state: this
   * screen can now split a blended figure the moment there is one to split, and
   * it does not pretend to a division the data has not made.
   */
  const span = branchSpan(allRows, status);
  const shownSpan = branchSpan(rows, status);

  /** The picker's options, in the order they are offered. Empty when there is
   *  nothing to choose between — one place, or none, is not a choice. */
  const placeOptions: string[] = span.kind === 'mixed'
    ? [...span.branches, ...(span.unlabelled ? [NO_PLACE] : [])]
    : [];

  // How much of the window the current selection leaves out, so a narrowed
  // screen never reads as a smaller gym.
  const hidden = allRows.length - rows.length;

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/classes">
      <h1>Classes</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Fill is how much of the room sold. Show is how much of what sold turned up. They are
        different problems with opposite fixes, so they are never added together here.
      </p>

      <Fetched at={readAt} busy={reading} onRefresh={refresh} live={liveStatus}
               what="these classes" style={{ margin: '2px 0 14px' }} />

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div style={{ display: 'flex', gap: 7, margin: '18px 0 0', flexWrap: 'wrap' }}>
        {WINDOWS.map((w) => (
            // `aria-pressed`, because which one is chosen was carried by a
            // background colour and nothing else — so a screen reader read
            // three identical buttons and no way to tell which window the
            // figures below belong to. The hour strip on /timetable was
            // already doing this ten lines from the day strip that was not.
          <button
            key={w.days}
            type="button"
            aria-pressed={w.days === days}
            onClick={() => { setDays(w.days); setPlace(ALL_PLACES); }}
            style={{
              ...field, cursor: 'pointer',
              background: w.days === days ? 'var(--surface3)' : 'var(--surface2)',
              color: w.days === days ? 'var(--ink)' : 'var(--ink2)',
            }}
          >
            {w.label}
          </button>
        ))}
        <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--ink3)' }}>
          ending now — nothing below counts a class that has not started
        </span>
      </div>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '18px 0 26px',
        }}
      >
        <Kpi
          label="Classes run"
          text={all ? String(all.classes) : null}
          note={
            upcoming == null
              ? (classes ? 'the classes still to run could not be read' : undefined)
              : upcoming === 0 ? 'none on the timetable for the next 4 weeks'
              : `${upcoming} still to run, not counted here`
          }
        />
        <Kpi
          label="Places offered"
          text={rated && rated.capacity > 0 ? String(rated.capacity) : null}
          note={
            rated == null ? undefined
              : rated.capacity > 0
                ? (capacityless.length > 0 ? `${capacityless.length} class${capacityless.length === 1 ? '' : 'es'} record no capacity` : undefined)
                : whyNoCapacity(all)
          }
        />
        <Kpi label="Places booked" text={all ? String(all.booked) : null} />
        <Kpi
          label="Fill"
          text={rated ? pct(rated.fill) : null}
          note={
            rated == null ? undefined
              : rated.fill == null ? whyNoCapacity(all)
              : `${rated.booked} of ${rated.capacity} places over ${rated.classes} class${rated.classes === 1 ? '' : 'es'}`
          }
        />
        <Kpi
          label="Empty places"
          text={emptyPlaces == null ? null : String(emptyPlaces)}
          note={emptyPlaces == null ? whyNoCapacity(all) : 'places that went unsold'}
        />
        <Kpi
          label="Show"
          text={all ? pct(all.show) : null}
          note={
            all == null ? undefined
              : all.show == null ? whyNoShow(all)
              : all.attended === 0 ? 'nobody marked present anywhere — see below'
              : `${all.attended} of ${all.booked} booked places`
          }
        />
      </div>

      {/* THE ONE BANNER ON THIS SCREEN THAT IS ABOUT THE LABEL RATHER THAN THE
          NUMBER. Every tile above is a total over the window, and a total over
          classes held at two places is not either place's — so if this gym uses
          `branch`, the tiles say so out loud rather than being read as one
          room's performance.

          It used to end by admitting there was nothing to be done about it. There
          is now: the picker below narrows every figure and every table on this
          screen to one place, and By place puts them side by side. Still null for
          every gym today, because nothing in this console writes a branch — but
          when one arrives from the trainer app the warning comes with its own
          remedy rather than with an apology. */}
      {branchNote(shownSpan) ? (
        <Banner>
          {branchNote(shownSpan)} Pick one below and every figure on this screen becomes that
          place&rsquo;s alone; By place has them side by side.
        </Banner>
      ) : null}

      {/* Only when there is something to choose between. A gym with one place,
          or with none recorded, is offered no control — a picker with a single
          option is a suggestion that a division exists. */}
      {placeOptions.length > 0 ? (
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', margin: '0 0 4px', flexWrap: 'wrap' }}>
          <label htmlFor="place" className="micro">Place</label>
          <select
            id="place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            style={{ ...field, minWidth: 220 }}
          >
            <option value={ALL_PLACES}>Every place — a total across all of them</option>
            {placeOptions.map((p) => (
              <option key={p} value={p}>{placeLabel(p)}</option>
            ))}
          </select>
          {place !== ALL_PLACES ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
              {hidden === 0
                ? 'every class in this window is at this place'
                : `${hidden} class${hidden === 1 ? '' : 'es'} elsewhere in this window ${hidden === 1 ? 'is' : 'are'} out of every figure above`}
            </span>
          ) : null}
        </div>
      ) : null}

      {rated && capacityless.length > 0 ? (
        <Banner>
          {capacityless.length === 1 ? '1 class records' : `${capacityless.length} classes record`} no
          capacity, so {capacityless.length === 1 ? 'it is' : 'they are'} left out of Fill and Empty
          places entirely — counting {capacityless.length === 1 ? 'its' : 'their'}{' '}
          {capacityless.reduce((a, r) => a + r.booked, 0)} booking
          {capacityless.reduce((a, r) => a + r.booked, 0) === 1 ? '' : 's'} without a room size would
          make the gym read fuller than it sold. Set a capacity on the Timetable and they join the rate.
        </Banner>
      ) : null}

      {overbooked.length > 0 ? (
        <Banner>
          {overbooked.length === 1 ? '1 class took' : `${overbooked.length} classes took`} more
          bookings than {overbooked.length === 1 ? 'its' : 'their'} capacity. Fill can therefore read
          above 100% — it is a real over-sell, not a rounding artefact.
        </Banner>
      ) : null}

      {/* Demand the gym did not sell, said separately from what it did.
          `fetchClasses` used to count a waitlister as a booking — the status
          filter tested for a value the constraint forbids — so these people
          were already inside Fill, pushing it over 100% on the classes that
          were working and taking the banner above with them. They are out of
          the rate now, which means they are invisible unless something says so,
          and "eleven people wanted a place we did not have" is the single most
          actionable number on this screen. */}
      {waiting > 0 ? (
        <Banner>
          {waiting === 1 ? '1 person was' : `${waiting} people were`} on a waiting list across{' '}
          {waitingClasses === 1 ? 'one class' : `${waitingClasses} classes`}. They are deliberately
          not in Fill — a place the gym could not sell is not a place it sold — so a full class with
          a queue behind it reads 100%, and this is the queue. Another occurrence of{' '}
          {waitingClasses === 1 ? 'that class' : 'those classes'} is the fix a bigger room is not.
          {waitingAttended > 0 ? ` ${waitingAttended} of them were let in and marked present.` : ''}
        </Banner>
      ) : null}

      {/* Placed above the tables it filters rather than inside one of them, so
          the same query narrows both and there is one control to clear. */}
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', margin: '0 0 18px', flexWrap: 'wrap' }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search a class, a slot or a coach"
          aria-label="Search the classes below"
          style={{ ...field, flex: 1, minWidth: 220 }}
        />
        {q ? <button onClick={() => setQ('')} style={linkBtn}>clear</button> : null}
      </div>

      <Waiting classes={classes === null ? null : shownClasses} unread={unread} nameOf={nameOf} zone={zone} onOpen={setOpen} />
      <Empties rows={rows} unread={unread} query={q} zone={zone} />
      <Unmarked classes={unmarked} unread={unread} nameOf={nameOf} nameUnread={nameUnread} zone={zone} onOpen={setOpen} />
      {/* Over `allRows`, not `rows`: the point of this table is the comparison,
          and a table that narrowed with the picker would show one row of the
          thing the picker was chosen to compare against. */}
      <ByPlace rows={allRows} unread={unread} show={span.kind === 'mixed'} />
      <ByCoach rows={rows} unread={unread} namesRead={trainers !== null} />
      <EveryClass
        classes={shownClasses} rows={rows} unread={unread} query={q} zone={zone}
        nameOf={nameOf} nameUnread={nameUnread} onOpen={setOpen}
      />

      {open ? <Roster gymClass={open} zone={zone} onClose={() => { setOpen(null); refresh(); }} /> : null}
    </Shell>
  );
}

/* ── reasons a rate has no value ───────────────────────────────────────────── */

/** Why Fill / Places / Empty places is a dash. Never "0" — a rate with no
 *  denominator is a question nobody answered, not a bad answer. */
function whyNoCapacity(all: ClassRates | null): string {
  if (all == null) return 'not read';
  if (all.classes === 0) return 'no classes ran in this window';
  return 'no class in this window records a capacity';
}

/** Why Show is a dash. A class nobody booked has no show rate; that is not the
 *  same as everybody failing to turn up. */
function whyNoShow(all: ClassRates | null): string {
  if (all == null) return 'not read';
  if (all.classes === 0) return 'no classes ran in this window';
  return 'nothing was booked, so there is nothing to have shown up';
}

/* ── where the empty places are ────────────────────────────────────────────── */

interface Slot {
  key: string;
  title: string;
  when: string;
  rates: ClassRates;
  empty: number | null;
}

/**
 * The recurring slot, not the single class.
 *
 * "Tuesday 06:00 Spin is half empty" is something an owner can move, merge or
 * cut. "The Spin on the 4th was half empty" is weather. So classes are grouped
 * by title and by the weekday-and-hour they run at, which is the thing that
 * actually repeats on a timetable, and the rate is taken over the group.
 */
/*
 * Grouped on the GYM's weekday and hour, not the browser's.
 *
 * This was `${r.title}|${t.getDay()}|${t.getHours()}`, and the label under it
 * was drawn the same way. The reasoning above is right and the key was not the
 * gym's: an owner opening this console from abroad, or a bookkeeper in another
 * country, saw a timetable whose slots were named after their own morning — and
 * worse, a 06:00 class either split into two buckets side by side or merged
 * with the 07:00, so the fill rate this whole section exists to compute was
 * taken over the wrong set of classes.
 *
 * A gym with no zone set gets ONE bucket per title with no weekday or hour in
 * the key at all, and the label says so. That is deliberate: the alternative is
 * the reader's own week, silently, which is exactly what was wrong. A slot list
 * that says "we cannot say which morning this is" is usable; one that says
 * Tuesday when the gym means Wednesday is not.
 */
function groupSlots(rows: ClassSummaryRow[], zone: string | null): Slot[] {
  const buckets = new Map<string, ClassSummaryRow[]>();
  for (const r of rows) {
    const t = new Date(r.startsAt);
    if (Number.isNaN(t.getTime())) continue;
    const wd = gymWeekday(r.startsAt, zone);
    const hr = gymHour(r.startsAt, zone);
    const key = wd == null || hr == null ? `${r.title}|?` : `${r.title}|${wd}|${hr}`;
    const b = buckets.get(key);
    if (b) b.push(r); else buckets.set(key, [r]);
  }
  const out: Slot[] = [];
  buckets.forEach((group, key) => {
    const rates = summariseClassRows(group);
    const wd = gymWeekday(group[0].startsAt, zone);
    const hr = gymHour(group[0].startsAt, zone);
    out.push({
      key,
      title: group[0].title,
      when: wd == null || hr == null
        ? `all ${group.length} — ${NO_ZONE_NOTE}, so they cannot be split into slots`
        : `${DAY_NAMES[wd]} ${String(hr).padStart(2, '0')}:00`,
      rates,
      // Null, not zero: a slot whose classes never recorded a capacity has an
      // unknown number of empty places, and unknown sorts to the bottom rather
      // than reading as a slot that sells out.
      empty: rates.capacity > 0 ? Math.max(0, rates.capacity - rates.booked) : null,
    });
  });
  return out.sort((a, b) => {
    if (a.empty == null && b.empty == null) return 0;
    if (a.empty == null) return 1;
    if (b.empty == null) return -1;
    return b.empty - a.empty;
  });
}

function Empties({ rows, unread, query, zone }: {
  rows: ClassSummaryRow[]; unread: Unread; query: string; zone: string | null;
}) {
  const all = useMemo(() => groupSlots(rows, zone), [rows, zone]);
  const slots = useMemo(() => searchRows(all, query, (s) => [s.title, s.when]), [all, query]);
  const note = searchNote(query, slots.length, all.length);

  const cols: Column<Slot>[] = [
    { key: 'slot', header: 'Slot', value: (s) => `${s.when} ${s.title}`,
      render: (s) => (
        <span>
          <span className="mono" style={{ color: 'var(--ink3)', marginRight: 8 }}>{s.when}</span>
          {s.title}
        </span>
      ) },
    { key: 'ran', header: 'Ran', value: (s) => s.rates.classes, numeric: true },
    { key: 'empty', header: 'Empty places', value: (s) => s.empty, numeric: true,
      render: (s) => s.empty == null
        ? <span className="dash" title="no class in this slot records a capacity">— no capacity</span>
        : String(s.empty) },
    { key: 'fill', header: 'Fill', value: (s) => s.rates.fill, numeric: true,
      render: (s) => pct(s.rates.fill) ?? <span className="dash">— no capacity</span> },
    { key: 'show', header: 'Show', value: (s) => s.rates.show, numeric: true,
      render: (s) => pct(s.rates.show) ?? <span className="dash">— nothing booked</span> },
  ];

  return (
    <Section
      title="Where the empty places are"
      sub="Grouped by the slot that repeats, worst first. A single quiet Tuesday is weather; the same Tuesday quiet for a month is a decision waiting to be made."
    >
      {/* Rendered above the table, because the failure it guards against is a
          filtered table read as an empty gym — and the reader has to see the
          sentence before they read the blank. */}
      {note ? <p style={{ margin: 0, padding: '0 14px 10px', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p> : null}
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable noun="class slots"
          rows={slots} columns={cols} rowKey={(s) => s.key}
          empty="No classes ran in this window, so there are no empty places to report — which is not the same as a full gym."
        />
      )}
    </Section>
  );
}

/* ── the queue the gym could not see ───────────────────────────────────────── */

/**
 * Classes people wanted a place in and did not get one.
 *
 * The banner above already counts them. This is the actionable half: WHICH
 * classes, so the owner can put another occurrence on — which is the fix a
 * bigger room is not — and a way into each register, where the place that just
 * came free can actually be given to somebody.
 *
 * Waitlisters are out of the fill rate on purpose (`tallyBookings`), which means
 * that without a section like this they are invisible: a class at 100% with
 * eleven people behind it looks exactly like a class at 100% with nobody.
 */
function Waiting({ classes, unread, nameOf, zone, onOpen }: {
  classes: GymClass[] | null; unread: Unread;
  nameOf: (c: GymClass) => string; onOpen: (c: GymClass) => void;
  /** `tenants.timezone` — the clock the class actually runs on. */
  zone: string | null;
}) {
  const queued = (classes ?? []).filter((c) => c.waitlisted > 0);
  if (unread || queued.length === 0) return null;

  const cols: Column<GymClass>[] = [
    { key: 'when', header: 'When', value: (c) => c.startsAt,
      render: (c) => gymDateTimeText(c.startsAt, zone, {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    { key: 'title', header: 'Class', value: (c) => c.title },
    { key: 'coach', header: 'Coach', value: (c) => nameOf(c) || null,
      render: (c) => nameOf(c) || <span className="dash">—</span> },
    { key: 'booked', header: 'Sold', value: (c) => c.booked, numeric: true,
      render: (c) => c.capacity > 0 ? `${c.booked} / ${c.capacity}` : String(c.booked) },
    { key: 'waiting', header: 'Waiting', value: (c) => c.waitlisted, numeric: true,
      render: (c) => <span style={{ color: 'var(--brand)' }}>{c.waitlisted}</span> },
    { key: 'left', header: 'Free now', value: (c) => placesLeft(c), numeric: true,
      // A free place beside a waiting list is somebody who should be rung. Null
      // is a class nobody sized, and 0 there would read as "full" — which is
      // exactly the wrong answer to give the desk.
      render: (c) => {
        const left = placesLeft(c);
        if (left == null) return <span className="dash">no capacity set</span>;
        return left > 0
          ? <span style={{ color: 'var(--good)' }}>{left}</span>
          : <span className="dash">none</span>;
      } },
    { key: 'in', header: 'Let in', value: (c) => c.waitlistAttended, numeric: true,
      render: (c) => c.waitlistAttended > 0 ? String(c.waitlistAttended) : <span className="dash">—</span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (c) => <button style={linkBtn} onClick={() => onOpen(c)}>Open the list</button> },
  ];

  const total = queued.reduce((a, c) => a + c.waitlisted, 0);

  return (
    <Section
      title="Waiting lists"
      sub={`${num(total)} ${total === 1 ? 'person' : 'people'} across ${num(queued.length)} ${queued.length === 1 ? 'class' : 'classes'}. Demand the gym did not sell — deliberately out of the fill rate, and therefore invisible without this. A place freed at the desk is given away from the register; the app only promotes somebody when a member cancels on their own phone.`}
    >
      <DataTable noun="classes with a waiting list" rows={queued} columns={cols} rowKey={(c) => c.id} empty="Nobody is waiting for a place." />
    </Section>
  );
}

/* ── registers nobody marked ───────────────────────────────────────────────── */

/**
 * The classes that make the show rate a lie.
 *
 * `attended` is only ever what somebody ticked. A class with eight bookings and
 * nobody marked present is indistinguishable from a class eight people skipped,
 * and the second reading is the one that ends up in a coach's review. So they
 * are pulled out and named as paperwork rather than averaged in as churn — and
 * the register can be marked from here, because the owner reading this is the
 * person who noticed.
 */
function Unmarked({ classes, unread, nameOf, nameUnread, zone, onOpen }: {
  classes: GymClass[]; unread: Unread; nameOf: (c: GymClass) => string;
  nameUnread: (c: GymClass) => boolean;
  onOpen: (c: GymClass) => void;
  /** `tenants.timezone` — the clock the class actually runs on. */
  zone: string | null;
}) {
  const cols: Column<GymClass>[] = [
    { key: 'when', header: 'When', value: (c) => c.startsAt,
      render: (c) => gymDateTimeText(c.startsAt, zone, {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    { key: 'title', header: 'Class', value: (c) => c.title },
    { key: 'coach', header: 'Coach', value: (c) => nameOf(c) || null,
      render: (c) => nameOf(c)
        || <span className="dash">
             {nameUnread(c) ? '— coach name not read' : '— no coach recorded'}
           </span> },
    { key: 'booked', header: 'Booked', value: (c) => c.booked, numeric: true },
    { key: 'mark', header: '', value: () => 0, align: 'right',
      render: (c) => <button style={linkBtn} onClick={() => onOpen(c)}>Mark the register</button> },
  ];

  if (unread) {
    return (
      <Section title="Registers nobody marked" sub="Bookings with nobody ticked present.">
        <Unresolved state={unread} what="the classes" />
      </Section>
    );
  }
  if (classes.length === 0) return null;

  return (
    <Section
      title="Registers nobody marked"
      sub="These classes had bookings and nobody marked present. They are counted as 0 attended in the show rate above, which reads the same whether nobody came or nobody ticked."
    >
      <DataTable noun="unmarked registers" rows={classes} columns={cols} rowKey={(c) => c.id} empty="Every register in this window has been marked." />
    </Section>
  );
}

/* ── by place ──────────────────────────────────────────────────────────────── */

interface PlaceRow { key: string; label: string; named: boolean; rates: ClassRates; empty: number | null }

/**
 * The blended figure, un-blended.
 *
 * This is the half the branch warning was missing. `branchNote` could say that
 * a fill rate covered two places and the screen had no way to show either of
 * them on its own, so the only thing an owner could do with the sentence was
 * distrust every tile above it. Two rooms with the same fill rate and opposite
 * show rates is a real gym and a real decision, and it was invisible.
 *
 * Bucketed on the same trim `branchSpan` uses, so the rows here and the places
 * in the picker cannot disagree about what counts as unlabelled.
 *
 * Rendered only when there is more than one place. A single-row table under a
 * heading that promises a comparison is a screen implying the gym has a
 * division it does not have — which is the same error as the blended figure, in
 * the other direction.
 */
function ByPlace({ rows, unread, show }: {
  rows: ClassSummaryRow[]; unread: Unread; show: boolean;
}) {
  const places = useMemo<PlaceRow[]>(() => {
    const buckets = new Map<string, ClassSummaryRow[]>();
    for (const r of rows) {
      const key = (r.branch ?? '').trim();
      const b = buckets.get(key);
      if (b) b.push(r); else buckets.set(key, [r]);
    }
    const out: PlaceRow[] = [];
    buckets.forEach((group, key) => {
      const rates = summariseClassRows(group);
      out.push({
        key: key || NO_PLACE,
        label: key || placeLabel(NO_PLACE),
        named: key !== '',
        rates,
        empty: rates.capacity > 0 ? Math.max(0, rates.capacity - rates.booked) : null,
      });
    });
    // Named places first and alphabetically, the way the picker offers them;
    // the unlabelled bucket last, because it is a gap in the record rather than
    // a place and should not sort into the middle of a list of rooms.
    return out.sort((a, b) => {
      if (a.named !== b.named) return a.named ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [rows]);

  if (!show) return null;

  const cols: Column<PlaceRow>[] = [
    { key: 'place', header: 'Place', value: (p) => p.label,
      render: (p) => p.named ? p.label : <span className="dash">— {p.label}</span> },
    { key: 'ran', header: 'Ran', value: (p) => p.rates.classes, numeric: true },
    { key: 'booked', header: 'Booked', value: (p) => p.rates.booked, numeric: true },
    { key: 'empty', header: 'Empty places', value: (p) => p.empty, numeric: true,
      render: (p) => p.empty == null ? <span className="dash">— no capacity</span> : String(p.empty) },
    { key: 'fill', header: 'Fill', value: (p) => p.rates.fill, numeric: true,
      render: (p) => pct(p.rates.fill) ?? <span className="dash">— no capacity</span> },
    { key: 'show', header: 'Show', value: (p) => p.rates.show, numeric: true,
      render: (p) => pct(p.rates.show) ?? <span className="dash">— nothing booked</span> },
  ];

  return (
    <Section
      title="By place"
      sub="Each place's own fill and show, over the same window as the tiles above — which are a total across all of them. Always the whole window, whatever the picker is set to, because this table is the comparison the picker narrows away from."
    >
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable noun="places"
          rows={places} columns={cols} rowKey={(p) => p.key}
          empty="No classes ran in this window."
        />
      )}
    </Section>
  );
}

/* ── by coach ──────────────────────────────────────────────────────────────── */

interface CoachRow { key: string; name: string | null; rates: ClassRates; empty: number | null }

function ByCoach({ rows, unread, namesRead }: {
  rows: ClassSummaryRow[]; unread: Unread; namesRead: boolean;
}) {
  const coaches = useMemo<CoachRow[]>(() => {
    const buckets = new Map<string, ClassSummaryRow[]>();
    for (const r of rows) {
      // Bucketed by trainer id where there is one, so two coaches who share a
      // first name are not silently added together; only classes with neither
      // an id nor a written instructor fall into the unattributed bucket.
      const key = r.trainerId || (r.trainerName ? `name:${r.trainerName}` : '');
      const b = buckets.get(key);
      if (b) b.push(r); else buckets.set(key, [r]);
    }
    const out: CoachRow[] = [];
    buckets.forEach((group, key) => {
      const rates = summariseClassRows(group);
      out.push({
        key: key || 'unattributed',
        // An unnamed coach is a dash, not "Trainer": a made-up label on a
        // performance table gets read as a person.
        name: group.find((g) => g.trainerName)?.trainerName ?? null,
        rates,
        empty: rates.capacity > 0 ? Math.max(0, rates.capacity - rates.booked) : null,
      });
    });
    return out.sort((a, b) => b.rates.classes - a.rates.classes);
  }, [rows]);

  const cols: Column<CoachRow>[] = [
    { key: 'coach', header: 'Coach', value: (c) => c.name,
      // Bucketed by trainerId, so these rows stay distinct — but with the coach
      // names unread they are all labelled the same way, and "not recorded" is
      // the wrong label for it. `unattributed` is the bucket of classes with no
      // trainerId at all, and only that one is genuinely nothing the gym wrote
      // down.
      render: (c) => c.name
        ?? <span className="dash">
             {!namesRead && c.key !== 'unattributed' ? '— name not read' : '— not recorded'}
           </span> },
    { key: 'ran', header: 'Ran', value: (c) => c.rates.classes, numeric: true },
    { key: 'booked', header: 'Booked', value: (c) => c.rates.booked, numeric: true },
    { key: 'empty', header: 'Empty places', value: (c) => c.empty, numeric: true,
      render: (c) => c.empty == null ? <span className="dash">— no capacity</span> : String(c.empty) },
    { key: 'fill', header: 'Fill', value: (c) => c.rates.fill, numeric: true,
      render: (c) => pct(c.rates.fill) ?? <span className="dash">— no capacity</span> },
    { key: 'show', header: 'Show', value: (c) => c.rates.show, numeric: true,
      render: (c) => pct(c.rates.show) ?? <span className="dash">— nothing booked</span> },
  ];

  return (
    <Section
      title="By coach"
      sub="Whose room fills, and whose bookings turn up. Read it beside the number of classes each ran — one class is not a record."
    >
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable noun="coaches"
          rows={coaches} columns={cols} rowKey={(c) => c.key}
          empty="No classes ran in this window."
        />
      )}
    </Section>
  );
}

/* ── every class ───────────────────────────────────────────────────────────── */

function EveryClass({ classes, rows, unread, query, zone, nameOf, nameUnread, onOpen }: {
  classes: GymClass[]; rows: ClassSummaryRow[]; unread: Unread; query: string;
  nameOf: (c: GymClass) => string; nameUnread: (c: GymClass) => boolean;
  onOpen: (c: GymClass) => void;
  /** `tenants.timezone` — the clock the class actually runs on. */
  zone: string | null;
}) {
  const rateOf = useMemo(() => {
    const m = new Map<string, ClassRates>();
    for (const r of rows) m.set(r.classId, summariseClassRows([r]));
    return m;
  }, [rows]);

  // Searchable on the coach as well as the class, because "how did Sam's
  // classes go" is the question this table is opened for as often as "how did
  // Spin go", and there is no per-coach filter anywhere else.
  const shown = useMemo(
    () => searchRows(classes, query, (c) => [c.title, c.room, nameOf(c)]),
    [classes, query, nameOf],
  );
  const shownNote = searchNote(query, shown.length, classes.length);

  const cols: Column<GymClass>[] = [
    { key: 'when', header: 'When', value: (c) => c.startsAt,
      render: (c) => gymDateTimeText(c.startsAt, zone, {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    { key: 'title', header: 'Class', value: (c) => c.title },
    { key: 'coach', header: 'Coach', value: (c) => nameOf(c) || null,
      render: (c) => nameOf(c)
        || <span className="dash">{nameUnread(c) ? 'name not read' : '—'}</span> },
    { key: 'cap', header: 'Capacity', value: (c) => (c.capacity > 0 ? c.capacity : null), numeric: true,
      // Zero capacity is a class nobody sized, not a class with no room in it.
      render: (c) => c.capacity > 0 ? String(c.capacity) : <span className="dash">— not set</span> },
    { key: 'booked', header: 'Booked', value: (c) => c.booked, numeric: true },
    { key: 'empty', header: 'Empty', value: (c) => (c.capacity > 0 ? Math.max(0, c.capacity - c.booked) : null), numeric: true,
      render: (c) => c.capacity > 0
        ? String(Math.max(0, c.capacity - c.booked))
        : <span className="dash">—</span> },
    { key: 'fill', header: 'Fill', value: (c) => rateOf.get(c.id)?.fill ?? null, numeric: true,
      render: (c) => pct(rateOf.get(c.id)?.fill ?? null) ?? <span className="dash">—</span> },
    { key: 'attended', header: 'Attended', value: (c) => c.attended, numeric: true },
    { key: 'show', header: 'Show', value: (c) => rateOf.get(c.id)?.show ?? null, numeric: true,
      render: (c) => pct(rateOf.get(c.id)?.show ?? null) ?? <span className="dash">—</span> },
    { key: 'roster', header: '', value: () => 0, align: 'right',
      render: (c) => <button style={linkBtn} onClick={() => onOpen(c)}>Roster</button> },
  ];

  return (
    <Section
      title="Every class in the window"
      sub="One row per class that has already started. A dash in Fill or Show is a denominator that was never recorded, not a rate of nil."
    >
      {shownNote ? <p style={{ margin: 0, padding: '0 14px 10px', fontSize: 12.5, color: 'var(--ink3)' }}>{shownNote}</p> : null}
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable noun="classes"
          rows={shown} columns={cols} rowKey={(c) => c.id}
          empty="No classes ran in this window."
        />
      )}
    </Section>
  );
}

/* ── the roster ────────────────────────────────────────────────────────────── */

function Roster({ gymClass, zone, onClose }: { gymClass: GymClass; zone: string | null; onClose: () => void }) {
  const [rows, setRows] = useState<RosterEntry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchRoster(supabase, gymClass.id)); setFailed(null); }
    catch (e: any) {
      // Left as null, not set to []: an empty roster under "Nobody booked" is a
      // confident statement about a class made by code that never read it.
      setRows(null);
      setFailed(e?.message ?? 'Could not read the roster.');
    }
  }, [gymClass.id]);

  useEffect(() => { load(); }, [load]);

  // setAttendance throws on a refused update. Unreported, the tick simply does
  // not move and the owner ticks again — so a member who attended stays
  // recorded absent, and the show rate on the screen behind this one keeps the
  // wrong number.
  const toggle = async (r: RosterEntry) => {
    setMsg(null);
    try {
      await setAttendance(supabase, r.bookingId, !r.attendedAt);
      await load();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not save that check-in.');
    }
  };

  /**
   * Give a waiting member the place that just came free.
   *
   * The same write the board's register makes, and here for the same reason:
   * `cancel_class` only promotes when the MEMBER cancels from their own phone,
   * so every case the gym handles — the phone call, the no-show, the coach who
   * says one more can squeeze in — had no path at all. See
   * `promoteFromWaitlist` in gymSchedule.ts.
   */
  const promote = async (r: RosterEntry) => {
    setMsg(null);
    try {
      await promoteFromWaitlist(supabase, r.bookingId);
      await load();
    } catch (e: any) {
      setMsg(writeFailedText(e, {
        what: 'That place',
        unchanged: 'they are still waiting',
        howToCheck: 'Reload this roster before giving it again — a place given twice puts the class over its cap.',
      }));
    }
  };

  // Escape, initial focus, a tab trap, and focus back to the row that opened
  // this. See lib/dialog.ts — this dialog had none of the four.
  const panel = useDialog<HTMLDivElement>(onClose);

  const split = rows ? splitRoster(rows) : null;
  const present = rows ? rows.filter((r) => r.attendedAt).length : null;
  // Off the roster in hand rather than the window's snapshot: a place freed
  // while this dialog has been open is a place the desk can give away now.
  const left = split ? placesLeft({ capacity: gymClass.capacity, booked: split.booked.length }) : null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center', padding: 24, zIndex: 10,
      }}
      onClick={onClose}
    >
      {/* `role="dialog"` and the label live on the PANEL now, with Escape, an
          initial focus, a tab trap and focus return — see lib/dialog.ts. The
          scrim keeps its click; it is no longer the only way out. */}
      <div
        {...dialogPanel(panel, `Register for ${gymClass.title}`)}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100%', maxHeight: '80vh', overflow: 'auto',
          background: 'var(--surface)', border: '1px solid var(--ring)', borderRadius: 0,
        }}
      >
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--ring)',
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <h2>{gymClass.title}</h2>
            <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
              {gymDateTimeText(gymClass.startsAt, zone) ?? 'a start time that could not be read'} · {split ? split.booked.length : gymClass.booked} booked
              {gymClass.capacity > 0 ? ` of ${gymClass.capacity}` : ' · capacity not set'}
              {present == null ? '' : ` · ${present} marked present`}
              {split && split.waiting.length > 0 ? ` · ${split.waiting.length} waiting` : ''}
            </p>
          </div>
          <button onClick={onClose} style={ghostBtn}>Done</button>
        </div>

        {failed ? <Banner tone="crit">{failed}</Banner> : null}
        {/* Announced. `failed` — the roster READ — was already bannered; `msg`
            is the WRITE result ("Could not save that check-in", "that place
            was not given") and was not. */}
        {msg ? <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: '12px 16px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}

        {rows === null ? (
          // Announced. This sits inside a dialog somebody opened to mark a
          // register; a reader who hears nothing after opening it has no way to
          // tell a slow read from a refused one.
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            {failed ? 'The roster did not come back, so nobody can be marked from here.' : 'Loading…'}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            Nobody booked this class. That is a fill problem, not a register one.
          </div>
        ) : (
          <div>
            {/* Booked first, waiting after, with a heading between them. One
                flat list showed `r.status` as a grey micro-label under each
                name, which is not a distinction anybody reads at a desk — and
                the queue is the half the gym could not see at all. */}
            {(split?.booked ?? []).map((r) => (
              <Line key={r.bookingId} r={r} waiting={false} onToggle={toggle} onPromote={promote} full={false} />
            ))}
            {split && split.waiting.length > 0 ? (
              <>
                <div style={{ padding: '10px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--ring)' }}>
                  <h3 style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Waiting — {split.waiting.length}</h3>
                  <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                    {left == null
                      ? 'This class records no capacity, so nothing can say whether a place is free.'
                      : left > 0
                        ? `${left} ${left === 1 ? 'place is' : 'places are'} free — give one away here.`
                        : 'Full. Letting somebody in from here is a deliberate over-sell, which Fill will report as real.'}
                  </p>
                </div>
                {split.waiting.map((r) => (
                  <Line key={r.bookingId} r={r} waiting onToggle={toggle} onPromote={promote} full={left != null && left <= 0} />
                ))}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** One person on a register. Pulled out because the booked half and the waiting
 *  half render identically apart from one button, and two near-copies of a
 *  fifteen-line row is how the two lists drift apart. */
function Line({ r, waiting, full, onToggle, onPromote }: {
  r: RosterEntry; waiting: boolean; full: boolean;
  onToggle: (r: RosterEntry) => void; onPromote: (r: RosterEntry) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--ring)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
          {r.name ?? <span className="dash">name not readable</span>}
        </div>
        {/* Said only where it changes what the reader should do. A waitlister
            somebody already let in and ticked is counted apart from `attended`
            so a show rate cannot exceed its own denominator — and that is worth
            seeing on the row rather than only in the arithmetic. */}
        {waiting && r.attendedAt ? (
          <div className="micro" style={{ marginTop: 2, color: 'var(--warn)' }}>let in and marked present</div>
        ) : null}
      </div>
      <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
        {waiting ? (
          <button onClick={() => onPromote(r)} style={linkBtn}>
            {full ? 'Squeeze them in' : 'Give them the place'}
          </button>
        ) : null}
        <button
          onClick={() => onToggle(r)}
          /* The same control on /timetable already carries this. Without it a
             screen reader hears "Mark present, button" whether or not the
             person is already marked. */
          aria-pressed={!!r.attendedAt}
          style={{
            ...field, cursor: 'pointer', flex: 'none',
            background: r.attendedAt ? 'var(--surface3)' : 'var(--surface2)',
            color: r.attendedAt ? 'var(--good)' : 'var(--ink2)',
          }}
        >
          {r.attendedAt ? 'Present' : 'Mark present'}
        </button>
      </span>
    </div>
  );
}

/* ── shared bits (same shapes as the Door screen) ──────────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const ghostBtn = {
  ...field, background: 'var(--surface2)', color: 'var(--ink2)',
  cursor: 'pointer', flex: 'none',
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ── the seventh Banner, and why nobody found it ──────────────────────────
//
// A sweep migrated six console pages off their own local `function Banner` and
// onto the shared one, which carries role="alert"/aria-live so "the write was
// refused and nothing was saved" is not a silence for a screen reader. It
// listed six because it found six: this file contained a RAW NUL BYTE in
// NO_PLACE, so `file(1)` called it `data` and grep printed nothing from any of
// its 1,277 lines. The sweep's own grep for `function Banner` did not see this.
//
// The byte is now the escape `\u0000` — same value, same sentinel, and the
// file is text again. DataTable.tsx records this exact bug being found and
// fixed once before, in those words, which is why it is worth saying twice:
// a source file that greps as binary is invisible to every review, every
// sweep and every gate that reads source, and nothing about it looks wrong.
function Banner({ children, tone, live }: { children: React.ReactNode; tone?: 'crit'; live?: boolean }) {
  return <SharedBanner tone={tone} live={live}>{children}</SharedBanner>;
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym ran no classes" were the same sentence — and the
 * second one gets a class cut off the timetable.
 */

