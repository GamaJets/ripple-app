// Client · My bookings. One place for everything the member has booked — group
// classes and personal-training sessions — in chronological order, with cancel.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a list has no single number), one hairline-
// separated section instead of a stack of bordered cards, and a coloured dot
// beside ink text where "Waitlist" used to be status-coloured type. Every
// provider, conditional and route is unchanged.
//
// ── TF-32: "PT with <the reader's own name>" ───────────────────────────────
//
// The personal-training rows were titled from `useCoachProfile().name`. That
// provider is the COACH-side one — it calls `supabase.auth.getUser()` and loads
// THAT user's own `profiles.full_name` — so on the client app it resolves to the
// reader, and every PT booking in this list was headed "PT with <your own name>"
// and located "with <your own name>". The title feeds the ICS export below as
// well, so it was also being written into the client's real calendar.
//
// The name now comes from `useThreadPeerName`, which resolves `clients.
// trainer_id` and then reads `profiles.full_name` for that id alone. A client
// usually cannot read their coach's row at all — no policy on `profiles` runs
// client → coach, and src/lib/threadPeer.ts sets out why — so where there is no
// name the row is titled "PT session" and carries no location. A booking that
// reads "PT with —" in the app, and worse in the calendar it is exported to, is
// not more honest than one that simply says what it is.
import { useMemo, useCallback, useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
// What pays for each of these, read once for the whole list. See
// supabase/parts/370 and src/lib/sessionCredits.ts: the choice of entitlement
// is made in one place, so this screen and the ledger cannot describe the same
// credit two ways.
import { sessionPacks, myPtPasses, mySessionCredits, type PtPassRow } from '../../src/lib/connect';
import { coachPackLines, gymPtLines, chooseRoute, creditsLeft, payingLines, ledgerStateOf,
  clientLedgerLine, bookingCreditNote, type CreditSession } from '../../src/lib/sessionCredits';
import type { PackBalance } from '../../src/lib/packDraw';
import { bookingsGap, emptyBookingsLine } from '../../src/lib/bookingsRead';
// One definition of "today, locally", shared with the membership screen and
// with the pass code itself — see the note on `todayISO` below.
import { useToday } from '../../src/ui/today';
import { sp, layout, radius, hairline, elevation, type as ty, numeric } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
// A class the gym called off. This screen listed one under Upcoming as a
// confirmed booking and wrote it into the member's own phone calendar, where
// nothing in this app can ever take it out again.
import { isCancelled } from '../../src/lib/gymSchedule';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';
import { useSessions, cancelBookedSession, ptCancelLines, useCancellationPolicy, useSlotWaitlist, cancelWarningFor, waitlistLine } from '../../src/ui/sessions';
// Moving a session rather than cancelling it and hoping. See src/lib/reschedule
// for why a move never charges and why one made inside the coach's notice
// window is refused rather than priced.
import { canOfferMove, moveConfirm, noSlotsLine, rescheduleLines, rescheduleRefusalLine } from '../../src/lib/reschedule';
import { useBrand } from '../../src/ui/brand';
import { useClientData } from '../../src/ui/clientData';
import type { TrainingSession } from '../../src/lib/types';
import { buildIcs, shareIcs, type IcsEvent } from '../../src/lib/exportShare';
import { peerHeading } from '../../src/lib/threadPeer';
import { useThreadPeerName } from '../../src/ui/messaging';
import { fmtRelativeDay, fmtTime } from '../../src/lib/format';

// NOTE: this screen used to filter and book against a hardcoded `CLIENT_ID = 'c1'`,
// a leftover from the mock-data era. The real client id is the Supabase user id.
// Because every client shared the literal 'c1', sessions booked by one client
// matched every other client's filter — so two people would see each other's
// bookings, and the trainer side (which stores real user ids) never matched at all.
// The weekday name and the date order were this file's own. `DOW` was a
// hardcoded English array and the fallback read `${d.getDate()}/${d.getMonth() + 1}`,
// which a member in the United States reads as month-first: "Wed 9/12" is 9
// December here and 12 September there, and that string went into every cancel
// confirmation on this screen. Both are the reader's now — see
// `fmtRelativeDay` and `fmtClock` in src/lib/format.ts.
const timeLabel = (iso: string) => fmtTime(iso);
const dayLabel = (iso: string) => fmtRelativeDay(iso);

// `onCancel` resolves TRUE only when the server actually took the cancellation.
//
// It used to be `() => void`, wrapping two calls that both return
// `Promise<boolean>` — `useClasses().cancel` and `useSessions().releaseSession`
// — and throwing the answer away at the call site. Both of those booleans exist
// for one reason: a cancellation the server refuses still empties the row off
// this screen for a moment, because both providers paint optimistically and
// then put the booking back when the write does not land. So the member watched
// their booking vanish, saw no message of any kind, and left believing they had
// cancelled. Class no-shows are charged by the gym and a missed PT session is
// charged off the member's pack, so the cost of that silence lands on them.
//
// app/(client)/calendar.tsx has done this correctly since the re-offer bug:
// await the release, and say plainly that nothing changed when it comes back
// false. This screen now does the same.
//
// ── The divergence that made the same tap cost different money ─────────────
//
// `onCancel` was the whole of a cancellation on this screen, and for a class it
// still is. For a PT session it was not enough, and the note that used to sit
// beside the PT row said so: cancelling here freed the slot and stopped, while
// app/(client)/calendar.tsx also returned the pack credit when the cancellation
// was more than 24h out, offered the freed slot to the coach's other clients,
// and told the coach. So the member lost a paid session by cancelling from the
// list instead of from the calendar, and nothing on either screen suggested the
// two buttons were different.
//
// `pt` is what carries that. It is not a second copy of those writes — the fix
// the note asked for was a shared helper, and `cancelBookedSession` in
// src/ui/sessions.tsx is it, called by both screens with the same arguments in
// the same order. This screen keeps only the wording of its own alerts.
type Item = { id: string; kind: 'class' | 'pt'; title: string; sub: string; startsAt: string; durationMin: number; location?: string; waitlist?: boolean; /** The gym called this class off. The row stays — the member booked it and
 *  has to be told — and it is neither counted as a booking nor exported. */
  cancelled?: boolean; onCancel: () => Promise<boolean>; pt?: TrainingSession };

export default function Bookings() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, status: classStatus, cancel: cancelClass, cachedNote: classCachedNote, refresh: refreshClasses } = useClasses();
  const { sessions, status: sessionStatus, releaseSession, cancelMyBooking, rescheduleMyBooking, cachedNote: sessionCachedNote, refresh: refreshSessions } = useSessions();
  // Whether this phone can reach us. It decides the second half of every
  // failure sentence on this screen.
  const reach = useReachability();
  // The coach's own policy, so the warning on this screen and the warning on
  // the Book screen are the same sentence about the same money. They came apart
  // once already — see the long note above `Item` — and a hardcoded 24 hours in
  // one of them was how a coach's 48-hour policy would have gone unmentioned
  // here and mentioned there.
  const { policy: cancelPolicy, reload: reloadPolicy } = useCancellationPolicy();
  // What this member is waiting for. `session_waitlist_client_r` shows them
  // their own row and nobody else's, so a position can only come from the
  // server: read from the app the queue is a set of one and everybody is first.
  const { mine: myQueue, status: waitStatus, leave: leaveWait, reload: reloadWait } = useSlotWaitlist();
  // A failed read used to strand this screen for the whole session: the only
  // way to ask again was the Try Again button inside the failure notice, and
  // there is no such button on a screen that merely went stale. Pull to refresh
  // is the gesture people already try — see src/ui/pullToRefresh.tsx.
  //
  // It asked for the WAITLIST and nothing else. Everything this screen is
  // actually about — the classes booked, the PT sessions, the cancellation
  // policy printed beside each one, and the packs and passes paying for them —
  // was left at whatever the first read returned, so a member who cancelled on
  // another device pulled this screen down and watched the booking stay. Six
  // reads make this screen and the gesture now asks for all six.
  const pull = usePullToRefresh(useCallback(() => {
    reloadWait();
    void refreshClasses();
    void refreshSessions();
    reloadPolicy();
    setEntitlementTick((n) => n + 1);
  }, [reloadWait, refreshClasses, refreshSessions, reloadPolicy]));
  // Either read failing makes this list a fragment, and a fragment must not be
  // announced as "you have nothing booked" — the member then turns up to
  // nothing, or fails to turn up to something.
  const bookingsWhole = classStatus === 'ready' && sessionStatus === 'ready';
  // The banner for the case these two flags had no answer for: a list with rows
  // in it that is nonetheless SHORT. `bookingsWhole` and `bookingsFailed` were
  // consulted only where `items.length === 0`, so a member whose classes read
  // failed and whose sessions read succeeded got "Upcoming" listing their PT
  // session alone — a complete-looking list, with the spin class they are
  // booked into and the reason for its absence both missing. Null when both
  // reads are whole. See src/lib/bookingsRead.ts, where the wording is tested.
  const gap = bookingsGap(classStatus, sessionStatus);
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  // A name, or null when there is none we may show. This screen has nowhere to
  // put the reason for a dash — a list row's title and an exported location are
  // both too small to explain themselves — so it does not draw one, and the
  // phrasing changes instead. The Book screen states the reason, on the card
  // headed "Your coach" where there is room for a whole sentence.
  const coachName = head.isName ? head.text : null;
  const cd = useClientData();
  const { appName } = useBrand();

  // ── what is going to pay for these ────────────────────────────────────
  //
  // Three-state throughout: `undefined` still reading, `null` a read that did
  // not land, a value an answer. A booking whose credit could not be read says
  // so rather than being shown as free or as already paid.
  const [packs, setPacks] = useState<PackBalance | null | undefined>(undefined);
  const [ptPasses, setPtPasses] = useState<PtPassRow[] | null | undefined>(undefined);
  const [credits, setCredits] = useState<CreditSession[] | null | undefined>(undefined);
  /** Bumped by the pull. These three were read once at mount and never again —
   *  on a TAB, which stays mounted for the life of the app, so a pack drawn
   *  down this morning was still shown at its old balance tonight. */
  const [entitlementTick, setEntitlementTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      const [p, g, c] = await Promise.all([sessionPacks(), myPtPasses(), mySessionCredits()]);
      if (!live) return;
      setPacks(p); setPtPasses(g); setCredits(c);
    })();
    return () => { live = false; };
  }, [entitlementTick]);

  // The day a gym pass has to be live on, taken locally: a pass expires on a
  // date at the gym, not at an instant in UTC.
  //
  // Recomputed on every render rather than memoised on an empty dependency
  // array. `useMemo(..., [])` froze "today" at the moment this screen mounted,
  // and this screen is a TAB — it stays mounted for the life of the app. So a
  // phone left open overnight, which is most phones, went on filtering passes
  // against yesterday: a pass that expired at midnight stayed listed as paying
  // for a session the gym would refuse at the door.
  // app/(client)/membership.tsx argues the identical point about the identical
  // value — "the screen can be open across midnight, and a membership that
  // expired at 00:00 should not still read Active because the component has not
  // re-rendered for a new day" — and the two are the same question about the
  // same member at the same desk.
  //
  // ── and the half of that argument the fix was missing ──────────────────
  //
  // Moving the call out of the `useMemo` and into the render body was only half
  // of it, and the comment above says which half by accident: "because the
  // component has not re-rendered for a new day". Nothing here made it. A value
  // recomputed per render is right at the moment something else happens to
  // redraw, and a screen sitting untouched at 23:59 — or a phone pocketed on
  // Friday and opened on Monday, which is the ordinary case — redraws for
  // nothing. The frozen `useMemo` was a value stuck at MOUNT; this was a value
  // stuck at the LAST RENDER, which on a screen nobody is touching is the same
  // pass listed as live on the same expired day.
  //
  // `useToday` (src/ui/today.ts) is what closes it: state, re-read on the next
  // local midnight and again whenever the app comes back to the foreground, so
  // a day that has actually changed causes the render that this line was
  // already written to be correct in.
  const todayISO = useToday();
  const coachLines = useMemo(() => (packs === undefined ? null : coachPackLines(packs?.lines ?? null)), [packs]);
  const gymLines = useMemo(() => (ptPasses === undefined ? null : gymPtLines(ptPasses, todayISO)), [ptPasses, todayISO]);
  const creditRoute = useMemo(
    () => chooseRoute(coachLines == null ? null : coachLines.length > 0,
                      gymLines == null ? null : gymLines.length > 0),
    [coachLines, gymLines]);
  const creditsRemaining = useMemo(
    () => creditsLeft(payingLines(creditRoute, coachLines, gymLines)), [creditRoute, coachLines, gymLines]);
  const creditNote = useMemo(() => bookingCreditNote(creditRoute, creditsRemaining), [creditRoute, creditsRemaining]);
  const creditById = useMemo(() => {
    const m = new Map<string, CreditSession>();
    for (const c of credits ?? []) m.set(c.id, c);
    return m;
  }, [credits]);
  /**
   * The one sentence under a PT row saying what pays for it.
   *
   * Null for a class (the gym's own timetable spends a different thing), null
   * for a member who holds nothing, and null while the read is still in flight
   * — a caption that appears and then changes its mind is worse than one that
   * waits. A row whose own credit record could not be read is described as
   * unknown rather than left blank, because blank reads as "nothing to pay".
   */
  const creditLineFor = (sessionId: string | null): string | null => {
    if (!sessionId) return null;
    if (credits === undefined || packs === undefined || ptPasses === undefined) return null;
    if (creditRoute === 'none') return null;
    const c = creditById.get(sessionId);
    if (!c) {
      return credits === null
        ? 'We could not read what pays for this session.'
        : null;
    }
    return clientLedgerLine({
      sessionId: c.id, startsAt: c.startsAt, state: ledgerStateOf(c, creditRoute),
      kind: c.packDrawnKind, drawnAt: c.packDrawnAt, entitlementId: null,
    });
  };

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const c of classes) {
      const st = myStatus[c.id];
      if (st && Date.parse(c.startsAt) > Date.now() - 3600_000) {
        out.push({ id: 'c' + c.id, kind: 'class', title: c.title, sub: `${c.kind} · ${c.branch}${c.room ? ' · ' + c.room : ''}`, startsAt: c.startsAt, durationMin: c.durationMin ?? 45, location: [c.branch, c.room].filter(Boolean).join(' · ') || undefined, waitlist: st === 'waitlist', cancelled: isCancelled(c), onCancel: () => cancelClass(c.id) });
      }
    }
    for (const s of sessions) {
      if (s.clientId === cd.id && s.status === 'booked' && Date.parse(s.startsAt) > Date.now() - 3600_000) {
        // "PT session" rather than "PT with —". The title is the row's whole
        // identity and it is what the ICS export writes into the calendar, and
        // a booking named after a piece of punctuation is worse in both places
        // than one named after what it is. The location is simply omitted for
        // the same reason: `IcsEvent.location` is optional, and an absent line
        // in a calendar entry says nothing, where a dash says something wrong.
        // The divergence the note above this type described is closed: `pt`
        // routes this row's cancellation through the same helper the Book
        // screen calls, so the credit, the re-offer and the coach's push happen
        // whichever screen the member cancelled from. `onCancel` stays as the
        // release the helper itself performs, so a class row and a PT row still
        // share one shape.
        out.push({ id: 'p' + s.id, kind: 'pt', title: coachName ? `PT with ${coachName}` : 'PT session', sub: `${s.durationMin} min session`, startsAt: s.startsAt, durationMin: s.durationMin, location: coachName ? `with ${coachName}` : undefined, onCancel: () => releaseSession(s.id), pt: s });
      }
    }
    return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    // `cd.id` is IN the dependency list, and its absence was the whole defect.
    // src/ui/clientData.tsx settles it to the literal 'unknown' until the auth
    // read lands, so every `s.clientId === cd.id` above compared against a
    // string no session carries — and if `sessions` had already settled, the
    // memo had no reason to run again when the real id arrived. The member
    // opened My Bookings, saw their classes and none of their personal
    // training, and it stayed that way until an unrelated class change
    // retriggered it. There is no sentence for that state because the code did
    // not know it was in it: the list is not short, it is confidently complete
    // and wrong.
  }, [classes, myStatus, sessions, coachName, cd.id]);

  // The session being moved, or null. Held whole because the picker below has
  // to know whose coach's slots to offer and what the old time was.
  const [moveFor, setMoveFor] = useState<TrainingSession | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  /**
   * The other times this member could take instead.
   *
   * Straight off the provider — no new read. `sessions_client_read` already
   * shows a client their coach's OPEN slots (part 22), which is exactly the set
   * a move may go to, so the picker cannot offer a slot the server would then
   * refuse. Filtered to the same coach, because a session cannot move between
   * coaches, and to the future, because a slot that has started cannot be moved
   * into.
   */
  const openSlots = useMemo(() => {
    const from = moveFor;
    if (!from) return [] as TrainingSession[];
    const now = Date.now();
    return sessions
      .filter((s) => s.status === 'available' && s.trainerId === from.trainerId && s.id !== from.id && Date.parse(s.startsAt) > now)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }, [sessions, moveFor]);

  /**
   * Move one session into one slot.
   *
   * The confirm says what it costs before the tap; the report says what
   * happened after it. Neither sentence is written here — both come from
   * src/lib/reschedule, so this screen and its tests cannot come to describe the
   * same move differently, which is exactly how this screen and the Book screen
   * once came to price the same cancellation two ways.
   */
  const doMove = (from: TrainingSession, to: TrainingSession) => {
    const fromLabel = `${dayLabel(from.startsAt)} ${timeLabel(from.startsAt)}`;
    const toLabel = `${dayLabel(to.startsAt)} ${timeLabel(to.startsAt)}`;
    const cf = moveConfirm(fromLabel, toLabel);
    Alert.alert(cf.title, cf.body, [
      { text: 'Keep It', style: 'cancel' },
      { text: 'Move It', onPress: async () => {
        if (moveBusy) return;
        setMoveBusy(true);
        const r = await rescheduleMyBooking(from.id, to.id);
        setMoveBusy(false);
        if (!r.moved) {
          // Every refusal names the state of the world afterwards, because a
          // refusal is indistinguishable from a loss unless somebody says so.
          Alert.alert('Not moved', rescheduleRefusalLine(r, timeLabel(from.startsAt)), [{ text: 'OK' }]);
          return;
        }
        setMoveFor(null);
        // The freed slot may already belong to whoever was first in line for
        // it, and this member's own queues may have moved with it.
        reloadWait();
        Alert.alert('Moved', rescheduleLines(r, fromLabel, toLabel).join('\n\n'), [{ text: 'OK' }]);
      } },
    ]);
  };

  const confirmCancel = (it: Item) => {
    // Captured before either alert, so the 24-hour rule the member is warned
    // about is the same one that decides whether their credit comes back.
    const asked = Date.now();
    // The booking is named in the failure sentence as well as the question. By
    // the time this alert appears the row has already blinked out and back, and
    // "that didn't save" over an unnamed booking leaves the member checking the
    // list to work out which one it meant.
    // The second half used to be "Check your connection and try again" whatever
    // had happened, and half the time the server had read the cancellation and
    // declined it. `retryLine` says which — src/lib/reachability.ts.
    //
    // A cancellation is deliberately NOT queued for later. What it costs is
    // computed against the policy at the moment it is made — whether a pack
    // credit comes back, whether a late fee applies, whether the slot is
    // re-offered, whether the coach is paged — so one replayed two hours later
    // is a different cancellation, and by then the member has been marked
    // absent for the class they thought they had come out of. Failing loudly is
    // what sends them to ring the gym, which is the thing that actually saves
    // them the no-show fee. See src/lib/outbox.ts.
    const failed = () => Alert.alert(
      it.waitlist ? 'Still on the waitlist' : 'Not cancelled',
      it.waitlist
        ? `You are still on the waitlist for ${it.title} — that did not save, so nothing has changed. ${retryLine(reach)}`
        : `${it.title} on ${dayLabel(it.startsAt)} at ${timeLabel(it.startsAt)} is still booked — that did not save, so nothing has changed and you are still expected. ${retryLine(reach)}`,
      [{ text: 'OK' }],
    );
    const doCancel = async () => {
      // A PT session is not just a row coming off a list: there is a pack credit
      // to return, a slot to re-offer, and a coach expecting somebody. All of it
      // is in `cancelBookedSession` so that this screen and the Book screen
      // cannot drift into settling the same cancellation differently — and the
      // sentences about the member's money come back from `ptCancelLines`, for
      // the same reason.
      if (it.pt) {
        const out = await cancelBookedSession(it.pt, cancelMyBooking, asked, cancelPolicy);
        if (!out.freed) { failed(); return; }
        // The slot may have gone straight to somebody's queue, and this member's
        // own queues may have moved with it.
        reloadWait();
        Alert.alert('Cancelled', ptCancelLines(out, timeLabel(it.startsAt)).join('\n\n'), [{ text: 'OK' }]);
        return;
      }
      const ok = await it.onCancel();
      if (ok) return;
      failed();
    };
    // The notice warning is part of the cancellation, not part of the calendar
    // screen. Asked without it, a member cancelling from this list agreed to
    // something they were not told the price of — and the price is a session off
    // a pack they paid for, plus whatever their coach charges. Same rule, same
    // wording, from the same helper, and only for PT: a class is the gym's own
    // no-show policy and this app does not know it.
    const warn = it.pt ? cancelWarningFor(it.startsAt, cancelPolicy, asked) : null;
    if (warn?.late) {
      Alert.alert(
        'Cancelling late',
        `${warn.line}\n\n${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}. Continue?`,
        [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel anyway', style: 'destructive', onPress: () => { void doCancel(); } }],
      );
      return;
    }
    if (warn) {
      Alert.alert('Cancel this booking?', `${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}\n\n${warn.line}`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel', style: 'destructive', onPress: () => { void doCancel(); } },
      ]);
      return;
    }
    Alert.alert('Cancel this booking?', `${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => { void doCancel(); } },
    ]);
  };

  const confirmLeave = (q: { sessionId: string; startsAt: string }) => {
    Alert.alert(
      'Leave this waitlist?',
      `You’ll lose your place in line for ${dayLabel(q.startsAt)} ${timeLabel(q.startsAt)}. If it frees up after that, it goes to whoever is in the queue instead of you.`,
      [
        { text: 'Stay in line', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const res = await leaveWait(q.sessionId);
            // A delete that matched nothing is not an error in PostgREST, so
            // the RPC counts its rows and this screen believes the count. Told
            // otherwise, a member walks away still in a queue that can book
            // them into a session they no longer want.
            if (!res.ok) {
              Alert.alert('Still on the waitlist', `${res.error || 'That did not save.'} You are still in line for ${timeLabel(q.startsAt)}, so it could still be booked for you.`, [{ text: 'OK' }]);
              return;
            }
            Alert.alert('Left the waitlist', `You’re no longer in line for ${dayLabel(q.startsAt)} ${timeLabel(q.startsAt)}.`, [{ text: 'OK' }]);
          },
        },
      ],
    );
  };

  /**
   * Everything the member has actually BOOKED, as calendar events.
   *
   * ── What this used to export ─────────────────────────────────────────────
   *
   * `items` includes the classes this member is on the WAITLIST for — that is
   * what `waitlist: st === 'waitlist'` is for, and the row draws a dot and
   * offers "Leave" rather than "Cancel" because of it. This function mapped the
   * whole list. So a place in a queue was written into the member's real
   * calendar, on their phone, as an event at a time, indistinguishable from the
   * spin class they hold a seat for — and calendar entries outlive the app:
   * once it is in there nothing here ever corrects it, and a member who is
   * never offered the place turns up for a class they were never in.
   *
   * The heading two hundred lines down states the rule this broke, about the
   * other kind of queue: "A PT waitlist is not a booking and is never listed as
   * one." A class waitlist is not a different kind of thing.
   *
   * So the export is confirmed bookings only, and it SAYS how many places were
   * left out rather than dropping them silently — a member who exports four
   * rows and finds three in their calendar is owed the reason.
   */
  const addToCalendar = async () => {
    // A class the gym called off is not exported either, and for the harder
    // version of the same reason: a waitlist place might still become a
    // booking, and a cancelled class never will. Once it is in the member's
    // real diary nothing here can remove it.
    const booked = items.filter((it) => !it.waitlist && !it.cancelled);
    const queued = items.filter((it) => it.waitlist && !it.cancelled).length;
    const calledOff = items.filter((it) => it.cancelled).length;
    if (booked.length === 0) {
      Alert.alert(
        'Nothing to add',
        queued > 0
          ? `You are in the queue for ${queued} ${queued === 1 ? 'class' : 'classes'} and have nothing booked. A place in a queue is not a booking, so it is not written into your calendar — if one comes to you, it appears here as a booking and you can add it then.`
          : calledOff > 0
          ? `${calledOff === 1 ? 'The class you had booked has' : `The ${calledOff} classes you had booked have`} been called off by the gym, so there is nothing to add to your calendar.`
          : 'You have nothing booked yet, so there is nothing to add to your calendar.',
        [{ text: 'OK' }],
      );
      return;
    }
    const evts: IcsEvent[] = booked.map((it) => ({
      start: it.startsAt,
      durationMin: it.durationMin || 60,
      title: `${appName} · ${it.title}`,
      location: it.location,
      notes: it.sub,
    }));
    await shareIcs(buildIcs(evts, `${appName} — My bookings`), 'my-bookings.ics', 'Add to calendar');
    if (queued > 0 || calledOff > 0) {
      const left: string[] = [];
      if (queued > 0) left.push(`the ${queued} ${queued === 1 ? 'place' : 'places'} you are waiting for — a queue is not a booking, and a calendar entry saying otherwise would still be there long after the class had run`);
      if (calledOff > 0) left.push(`${calledOff === 1 ? 'the class the gym called off' : `the ${calledOff} classes the gym called off`} — ${calledOff === 1 ? 'it is' : 'they are'} not running`);
      Alert.alert(
        'What went into the file',
        `${booked.length} booked ${booked.length === 1 ? 'session is' : 'sessions are'} in it. Left out: ${left.join('; and ')}.`,
        [{ text: 'OK' }],
      );
    }
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>My Bookings</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your upcoming classes and personal-training sessions, all in one place.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {/* ── book something ─────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <View style={{ flex: 1 }}><Cta label="Book a Class" wide onPress={() => router.push('/(client)/classes')} /></View>
            <View style={{ flex: 1 }}><Ghost label="Book PT" onPress={() => router.push('/(client)/calendar')} /></View>
          </View>
          {items.length > 0 ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost icon="calendar" label="Add to Calendar" onPress={addToCalendar} />
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── what you have booked ───────────────────────────────────────── */}
        <Section>
          {/* The count was gated only on non-emptiness, so under 'partial' it
              printed a subtotal as a total. It stays on `bookingsWhole` — a
              figure is only a figure when both reads answered in full. */}
          {/* Cancelled classes are listed and are not counted as bookings —
              the figure says "booked", and a class the gym called off is not
              one. */}
          <SectionHead title="Upcoming" note={bookingsWhole && items.length > 0 ? `${items.filter((it) => !it.cancelled).length} booked` : undefined} />
          {/* Above the rows, not below them: the rows are what makes the list
              look finished, and the reader has to be told before they scroll
              past the one booking that did come back. */}
          {gap ? <Notice tone={t.warn} kicker="Bookings" title={gap.title} note={gap.note} /> : null}
          {/* The balance, above the list, because it is what somebody is
              deciding against when they look at this screen. `bookingCreditNote`
              is the same function the ledger and the booking screen use, so the
              promise is worded once. Null for a member who holds nothing, who
              needs no sentence about packs at all. */}
          {creditNote ? <Flag tone={t.brand} style={{ marginBottom: sp.md }}>{creditNote}</Flag> : null}
          {/* One of the two lists came off this phone rather than off the
              server. Said above the rows for the same reason the gap notice is:
              a member who reads a cached booking as a confirmed one turns up to
              a session that was moved. The class list and the PT list can be in
              that state independently, so whichever is stale says so — and if
              both are, the older sentence is the one that matters. */}
          {classCachedNote || sessionCachedNote
            ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{classCachedNote ?? sessionCachedNote}</Flag>
            : null}
          {items.map((it, i) => (
            <View key={it.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>{it.kind === 'pt' ? 'Personal training' : 'Class'}</Text>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{it.title}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{dayLabel(it.startsAt)} · {timeLabel(it.startsAt)} · {it.sub}</Text>
                  {/* The gym called it off. Said on the row, in the list the
                      member opens to decide where to be this evening — this
                      screen used to show it under Upcoming as confirmed. */}
                  {it.cancelled ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>Cancelled by the gym — this class is not running</Text>
                    </View>
                  ) : it.waitlist ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
                      <Text style={{ ...ty.caption, color: t.ink2 }}>On the waitlist</Text>
                    </View>
                  ) : null}
                  {/* What pays for this hour, said on the row rather than left
                      to be inferred from a balance on another screen. Worded
                      as an expectation where it is one: nothing comes off a
                      pack in advance, so a booking eight weeks out has not
                      spent anything yet and this line does not say it has. */}
                  {it.kind === 'pt' && creditLineFor(it.pt?.id ?? null) ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{creditLineFor(it.pt?.id ?? null)}</Text>
                  ) : null}
                </View>
                {/* "Cancel, button" told a screen reader nothing about WHICH
                    booking, on a screen that is a list of them. The visible
                    label can lean on the row above it; the spoken one is read
                    on its own. */}
                {/* Move before Cancel, and that order is the point of the
                    whole item: cancelling was the only way to change a time,
                    and it is the expensive one. Offered only for PT — a class
                    is the gym's own timetable and there is nothing to move it
                    into — and only outside the coach's notice window, which is
                    where the move is free. `canOfferMove` is permissive on an
                    unread policy: the server decides, and being told "no, and
                    here is the notice period" beats a button that was never
                    there. */}
                {it.pt && canOfferMove(it.startsAt, cancelPolicy) ? (
                  <Ghost label="Move"
                    a11yLabel={`Move ${it.title}, ${dayLabel(it.startsAt)} at ${timeLabel(it.startsAt)}, to another time`}
                    onPress={() => setMoveFor(it.pt!)} />
                ) : null}
                <Ghost label={it.waitlist ? 'Leave' : 'Cancel'}
                  a11yLabel={`${it.waitlist ? 'Leave the waitlist for' : 'Cancel'} ${it.title}, ${dayLabel(it.startsAt)} at ${timeLabel(it.startsAt)}`}
                  onPress={() => confirmCancel(it)} />
              </View>
            </View>
          ))}
          {items.length === 0 ? (
            // 'partial' used to land on the literal string "Loading." — which
            // never stopped being displayed and was never true: both reads had
            // finished, and one of them had come back short.
            <Text style={{ ...ty.label, color: t.ink3 }}>{emptyBookingsLine(classStatus, sessionStatus)}</Text>
          ) : null}
        </Section>

        {/* ── the queues this member is in ────────────────────────────────
            A PT waitlist is not a booking and is never listed as one: it lives
            under its own heading, below Upcoming, and every line of it says
            where in the queue they actually are. The one promise made here is
            the one the database keeps — the slot goes to whoever is first,
            inside the transaction that frees it, so nobody has to be quick and
            nobody can be beaten to it by a faster phone. */}
        {waitStatus === 'error' || myQueue.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Waiting For" note={waitStatus === 'error' ? 'Not read' : waitStatus === 'ready' && myQueue.length > 0 ? `${myQueue.length} slot${myQueue.length === 1 ? '' : 's'}` : undefined} />
              {waitStatus === 'error' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  We couldn’t read your waitlists. This is not a statement that you are on none — any place you hold still stands, and a slot that frees can still be booked for you.
                </Text>
              ) : (
                myQueue.map((q, i) => (
                  <View key={q.sessionId}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Personal training</Text>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{dayLabel(q.startsAt)} · {timeLabel(q.startsAt)}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {/* A slot that is no longer taken and did not come to
                              this member is worth saying plainly: the queue
                              moved past them, or the coach opened the hour up
                              rather than it being cancelled into the list. */}
                          {q.stillTaken ? waitlistLine(q.position, q.waiting) : 'This slot is open again and did not come to you — book it from the Book screen if you still want it.'}
                        </Text>
                      </View>
                      <Ghost label="Leave" onPress={() => confirmLeave(q)} />
                    </View>
                  </View>
                ))
              )}
            </Section>
          </>
        ) : null}
      </ScrollView>

      {/* ── move this session ───────────────────────────────────────────────
          The coach's own open slots, off the provider rather than a new read:
          `sessions_client_read` already shows a client their coach's available
          slots, which is exactly the set the server will accept a move into, so
          this picker cannot offer something that is then refused for being
          somebody else's.

          The empty state is gated on the read that produced it. "Your coach has
          no other open times" is a claim about their calendar, and a failed
          read may not make it. */}
      <Modal visible={!!moveFor} transparent animationType="slide" onRequestClose={() => setMoveFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setMoveFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: sp.xxl, maxHeight: '86%', ...elevation.e2 }}>
          {moveFor ? (<>
            <Text style={{ ...ty.title, color: t.ink }}>Move to another time</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
              {dayLabel(moveFor.startsAt)} at {timeLabel(moveFor.startsAt)} becomes whichever of these you pick. Nothing is charged and no session comes off your pack.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {openSlots.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>{noSlotsLine(sessionStatus)}</Text>
              ) : (
                <>
                  {sessionStatus === 'partial' ? (
                    <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{noSlotsLine('partial')}</Flag>
                  ) : null}
                  {openSlots.map((sl, i) => (
                    <View key={sl.id}>
                      {i > 0 ? <Rule /> : null}
                      <Pressable onPress={() => doMove(moveFor, sl)} disabled={moveBusy}
                        accessibilityRole="button"
                        accessibilityLabel={`Move to ${dayLabel(sl.startsAt)} at ${timeLabel(sl.startsAt)}`}
                        accessibilityState={{ disabled: moveBusy }}
                        style={{ paddingVertical: sp.md, opacity: moveBusy ? 0.5 : 1 }}>
                        <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>
                          {dayLabel(sl.startsAt)} at {timeLabel(sl.startsAt)}
                        </Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{sl.durationMin} min</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
              <Pressable onPress={() => setMoveFor(null)} accessibilityRole="button"
                accessibilityLabel="Close without moving anything"
                style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </>) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
