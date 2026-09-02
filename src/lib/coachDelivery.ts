// How this coach coaches, and what the app is allowed to put away because of it.
//
// ── The thing that was never asked ─────────────────────────────────────────
//
// `CoachingMode` (src/lib/types.ts) is set PER CLIENT, by the coach, on the
// add-client and invite sheets. It is branched on in src/ui/clientData.tsx and
// all through app/(client). It is branched on NOWHERE in app/(trainer), and
// nothing in src/lib/features.ts consults it. So the coach app assumed
// in-person for everybody: a coach whose entire roster is online still opened
// onto a calendar, an availability generator, session blocking, classes, a
// rota, a gym-floor queue, walk-ins, and a revenue figure computed as sessions
// times a session fee — which for a coach who sells packages and subscriptions
// is not an inflated number, it is a number about a business they do not run.
//
// ── Two sources, and the rule that stops them fighting ─────────────────────
//
// One fact can be DERIVED — does this coach have any in-person or hybrid
// clients — and one can be ASKED. Neither is sufficient on its own:
//
//   · The roster cannot answer at signup. A brand-new coach has nobody on it,
//     and "no in-person clients" and "no clients at all" are different facts.
//     Deriving remote from an empty book would greet every new coach by taking
//     their calendar away before they had used it once.
//   · The declaration cannot answer for ever. A coach who said "online" in
//     March and takes their first in-person client in September must not have
//     to remember a setting to get a calendar; and a coach who never answers
//     must not be treated as having answered.
//
// So neither has priority, and they are made to agree by construction:
//
//     THE DECLARED ANSWER SETS THE FLOOR. THE ROSTER MAY ONLY EVER WIDEN IT.
//
// Every unknown resolves in the WIDENING direction, and that is the single most
// important line in this file:
//
//   · a roster that did not come back WHOLE widens. `LoadStatus` is
//     loading | ready | partial | error and only 'ready' is a whole read, so a
//     coach whose roster read was refused, truncated or still in flight is
//     shown everything. A screen that hid a coach's calendar because a read
//     failed for thirty seconds is the exact defect class this codebase fights.
//   · a declaration that has not been made, or has not been read, widens.
//     Skipping the question is its own state and it is not a fourth answer.
//
// ── Hybrid is not a third layout ───────────────────────────────────────────
//
// There are two shapes, not three. A coach with ONE in-person client needs the
// calendar as much as a coach with forty, so 'hybrid' and 'inperson' produce
// the same app. Only an entirely remote book, declared remote, is remote.
//
// ── THE TAB BAR IS DELIBERATELY NOT TOUCHED ───────────────────────────────
//
// Schedule is one of the six tabs, and narrowing the bar for a remote coach is
// the obvious next move. It is not made here, for two reasons written down so
// nobody has to rediscover them:
//
//   1. src/lib/guide.ts DERIVES the first-run tour from the tab list, one card
//      per tab, and its header is an account of what happened last time those
//      two came apart: "it came to tell coaches they had five tabs while the bar
//      had six." A bar narrowed by this fact and a tour still derived from the
//      full list would put that bug straight back, on a brand-new coach's very
//      first run, walking them through a calendar they had just been told they
//      do not have. GUIDE_INTRO and TOUR_INTRO in guideContent.ts spell "Six
//      tabs" out in words as well.
//   2. The fact settles ASYNCHRONOUSLY. Both halves of it are reads, so the
//      first paint is always the widest answer and the narrow one arrives a
//      moment later — which in a tab bar is six items becoming five under a
//      coach's thumb.
//
// Either could be handled. Neither is worth handling for one tab, when the
// screens BEHIND the bar can respond honestly and reversibly instead: the
// analytics hero leads with the figure that describes the coach's actual
// business, the dashboard's in-person tools drop below the rest with the reason
// on them, and the setup checklist stops asking for published hours nobody can
// book. A coach who takes their first in-person client gets all of that back
// with no bar having flickered at anybody.
//
// ── And what "put away" is allowed to mean ─────────────────────────────────
//
// De-emphasised. Never deleted, never unsearchable, never unreachable.
// `TRAINER_NAV` in src/lib/features.ts powers a keyword search over every
// trainer screen and nothing here removes a row from it; a coach who takes
// their first in-person client tomorrow finds the calendar by typing "calendar"
// today. `HIDDEN_NOT_GONE` is the sentence that says so on screen.
//
// Pure — no react, no supabase. The read and the write live in
// src/ui/coachDelivery.ts.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';
import { booksInPerson, COACHED_MODES, type CoachedMode } from './types';

/* ── what the coach was asked ─────────────────────────────────────────────── */

/**
 * The coach's own answer, or null.
 *
 * Null is "not asked yet", and it covers three situations that behave
 * identically and must not be collapsed into an answer: the coach has never
 * been asked, the coach skipped the question, and the read did not come back.
 * `DeliveryFact.reason` tells the last of those apart from the first two for
 * the sentence on screen; none of the three is ever rendered as one of the
 * three answers.
 */
export type DeliveryDeclaration = CoachedMode | null;

/** The three, in the order they are offered. Same list and same order as
 *  `COACHED_MODES`, which is what the coach already picks from when they
 *  classify a client — so the two questions cannot come to offer different
 *  answers. */
export const DELIVERY_OPTIONS: readonly CoachedMode[] = COACHED_MODES;

/** Title Case: these render as the title of a row the coach taps. */
export const DELIVERY_LABEL: Record<CoachedMode, string> = {
  online: 'Online Only',
  inperson: 'In Person',
  hybrid: 'Both',
};

/**
 * One line per option, in the coach's own voice, saying what picking it
 * changes.
 *
 * The `COACHING_MODE_NOTE` pattern from src/lib/types.ts, and it travels with
 * the option everywhere it is offered for the reason stated there: "Hybrid" on
 * its own is a word, not a choice anybody can make. Sentence case, because
 * these are prose.
 */
export const DELIVERY_NOTE: Record<CoachedMode, string> = {
  online: 'You program and check in remotely. Your money is packages and subscriptions rather than sessions, and the booking calendar, classes and session marking move out of the way until somebody trains with you in person.',
  inperson: 'You train people in the room. You keep the booking calendar, your published hours, classes and the queue of sessions waiting to be marked.',
  hybrid: 'Both, and nothing is put away. You keep everything an in-person coach has, and your takings still count packages and subscriptions alongside the sessions you deliver.',
};

/**
 * What picking it actually set up, said after the fact.
 *
 * Separate from `DELIVERY_NOTE` because the tense matters: one is an offer and
 * one is a receipt. A coach who is shown what their answer DID is a coach who
 * can tell whether they answered wrongly, and this is the whole of the
 * "say what changes when they pick" requirement — one line, on the control
 * itself, rather than a fourth screen explaining the app.
 */
export const DELIVERY_EFFECT: Record<CoachedMode, string> = {
  online: 'Set up for remote coaching. Your takings are read from packages, subscriptions and the payments you record yourself, and the in-person tools are tucked away rather than removed. Search finds every one of them, and the first in-person client you take brings them back on their own.',
  inperson: 'Set up for in-person coaching. Nothing is hidden, and what you have delivered is counted from the outcomes you mark rather than from the clock.',
  hybrid: 'Set up for both. Nothing is hidden, and your money is read from packages and subscriptions as well as from the sessions you mark as delivered.',
};

/** Said wherever something has been put away, because a coach has to be able
 *  to believe it. */
export const HIDDEN_NOT_GONE =
  'Nothing has been removed. Every one of these screens is still in the app and still turns up in search, and taking on one client in person brings them all back to where they were.';

/* ── the fact ─────────────────────────────────────────────────────────────── */

/** Two shapes, not three. See the header on why hybrid is not a third. */
export type DeliveryShape = 'inperson' | 'remote';

/**
 * Why the shape is what it is.
 *
 * Every one of these is a different sentence to a coach, which is the reason
 * they are not collapsed into a boolean. Four of the six produce 'inperson' and
 * they produce it for four genuinely different reasons — one of them being that
 * we could not read the roster, which the coach is entitled to be told rather
 * than left to infer from a calendar they thought they had turned off.
 */
export type DeliveryReason =
  /** They said in person. */
  | 'declared-inperson'
  /** They said both. */
  | 'declared-hybrid'
  /** They said online, and somebody on the book trains with them in the room. */
  | 'roster-widened'
  /** They have not been asked, or they skipped. The widest answer stands. */
  | 'not-declared'
  /** The declaration could not be read. The widest answer stands. */
  | 'declaration-unread'
  /** The roster did not come back whole, so it cannot be asked whether it
   *  widens. The widest answer stands. */
  | 'roster-unread'
  /** They said online, the book was read in full, and nobody on it is
   *  in person. The only route to 'remote'. */
  | 'declared-online';

/** The minimum a roster row needs for this module to reason about it. */
export interface DeliveryRosterRow { mode: CoachedMode }

export interface DeliveryInput {
  declared: DeliveryDeclaration;
  /** Whether the declaration was actually read. Under anything but a whole
   *  read a null `declared` means unknown, not unanswered. */
  declaredStatus: LoadStatus;
  roster: readonly DeliveryRosterRow[];
  rosterStatus: LoadStatus;
}

export interface DeliveryFact {
  shape: DeliveryShape;
  reason: DeliveryReason;
  /** How many clients train in the room, or null when the roster is not a
   *  whole read. Null and 0 are never the same sentence. */
  inPersonClients: number | null;
  /** How many clients there are at all, or null on anything but a whole read. */
  clients: number | null;
  /**
   * The coach has a book and we KNOW it is empty. False under a short read and
   * false when there is anybody on it, so it can be printed against.
   *
   * Load-bearing: zero in-person clients and zero clients are different facts,
   * and only one of them says anything about how somebody coaches.
   */
  emptyBook: boolean;
  /** Whether the coach has answered the question. False while unread — a
   *  screen prompting for an answer must not prompt over a failed read. */
  declaredKnown: boolean;
}

/**
 * The one fact, from the two sources.
 *
 * Reads top to bottom in order of how WIDE the answer is, so that the first
 * clause that matches is the widest one that applies. Every early return is an
 * 'inperson' — which is another way of saying that this function can only reach
 * 'remote' by having established all three of: the coach said online, the
 * roster was read in full, and nobody on it trains in the room.
 */
export function deliveryFact(input: DeliveryInput): DeliveryFact {
  const rosterKnown = isWhole(input.rosterStatus);
  const clients = rosterKnown ? input.roster.length : null;
  const inPersonClients = rosterKnown
    ? input.roster.filter((c) => booksInPerson(c.mode)).length
    : null;
  const declaredKnown = isWhole(input.declaredStatus);
  const base = {
    inPersonClients,
    clients,
    emptyBook: rosterKnown && input.roster.length === 0,
    declaredKnown,
  };
  const wide = (reason: DeliveryReason): DeliveryFact =>
    ({ shape: 'inperson', reason, ...base });

  // The declaration could not be read. It is not null-meaning-unanswered, it is
  // unknown, and an unknown floor is the widest floor.
  if (!declaredKnown) return wide('declaration-unread');
  // Two of the three answers are the widest answer outright, and the roster has
  // nothing to add to either: it may only widen, and there is nothing wider.
  if (input.declared === 'inperson') return wide('declared-inperson');
  if (input.declared === 'hybrid') return wide('declared-hybrid');
  // Not asked, or skipped. Behaves as the widest option rather than the
  // narrowest: hiding a calendar from somebody who has not answered a question
  // is the one direction that costs a coach something they said nothing about.
  if (input.declared == null) return wide('not-declared');
  // From here the coach has said 'online'. Only a WHOLE roster may be asked
  // whether it widens that; a short, refused or in-flight one widens it by
  // default, because an unread book is not an empty one.
  if (!rosterKnown) return wide('roster-unread');
  if ((inPersonClients ?? 0) > 0) return wide('roster-widened');
  return { shape: 'remote', reason: 'declared-online', ...base };
}

/** True when the app may put the in-person tools away. The one question every
 *  screen actually asks, written once so no screen compares to a literal. */
export const showsInPerson = (f: DeliveryFact): boolean => f.shape === 'inperson';

/**
 * Why the app looks the way it does, in one sentence for the coach.
 *
 * Sentence case, and never a bare dash: every branch here is a whole sentence
 * whatever came back null, which is the rule scripts/check-prose.mjs enforces.
 */
export function deliveryNote(f: DeliveryFact): string {
  switch (f.reason) {
    case 'declared-inperson':
      return 'You train people in the room, so everything is here.';
    case 'declared-hybrid':
      return 'You coach both in the room and remotely, so everything is here.';
    case 'roster-widened':
      return f.inPersonClients === 1
        ? 'You coach online, and one client on your book trains with you in person, so the in-person tools are here.'
        : `You coach online, and ${f.inPersonClients} of your clients train with you in person, so the in-person tools are here.`;
    case 'not-declared':
      return 'You have not said how you coach yet, so nothing has been put away.';
    case 'declaration-unread':
      return 'How you coach could not be read just now, so nothing has been put away.';
    case 'roster-unread':
      return 'Your roster did not come back in full, so nothing has been put away. An unread book is not an empty one.';
    case 'declared-online':
      return f.emptyBook
        ? 'You coach online and have nobody on your book yet, so the in-person tools are out of the way.'
        : 'You coach online and nobody on your book trains with you in person, so the in-person tools are out of the way.';
  }
}

/**
 * The line offering the question, or null once it has been answered.
 *
 * Null while the read is still unknown as well as once it is answered: a
 * prompt to answer, shown because a read failed, would invite a coach to
 * re-answer a question they had already answered, and the widest-answer rule
 * means nothing is lost by staying quiet until we know.
 */
export function deliveryAskLine(f: DeliveryFact): string | null {
  if (!f.declaredKnown) return null;
  if (f.reason !== 'not-declared') return null;
  return 'Say whether you coach in person, online or both, and the app sets itself up around it. Everything is shown until you do.';
}

/**
 * What a declared answer reads as on the profile, or the honest alternative.
 *
 * Three outcomes and they are not interchangeable. A coach whose read failed is
 * not a coach who has not answered, and telling them they have not is how
 * somebody comes to answer twice.
 */
export function deliveryStatusLine(declared: DeliveryDeclaration, status: LoadStatus): string {
  if (status === 'loading') return 'Reading how you coach…';
  if (!isWhole(status)) return 'How you coach could not be read just now, so nothing has been put away. This is this screen not knowing, not you not having answered.';
  if (declared == null) return 'Not answered yet. Everything in the app is shown until you say, which is the safe way round.';
  return DELIVERY_EFFECT[declared];
}
