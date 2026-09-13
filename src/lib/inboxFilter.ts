// Narrowing the notification inbox — and saying what the narrowing hid.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// src/ui/notifications.tsx draws every row a person has, newest first, and
// offers no way to ask a narrower question. That is fine at eleven rows and it
// is not what these inboxes hold: `unreadBadge` in src/lib/notifyInbox.ts
// already argues its own formatting on the grounds that "a gym pushing an offer
// a day to a member who never opens the inbox reaches four digits in three
// years", and src/lib/rowCap.ts caps the read at a thousand. The inbox is a
// list that only grows, with a Mark All Read at the bottom of it, and the one
// question everybody actually arrives with — what have I not seen — could only
// be answered by scrolling and looking for a dot.
//
// ── WHY THE KINDS ARE THE ONES THEY ARE, AND WHY THERE ARE ONLY TWO ────────
//
// The temptation is a chip per icon. `ICON_BY_ROUTE` in src/lib/notifyInbox.ts
// maps fifty-odd routes onto eleven icons, so eleven chips are sitting there
// looking like a taxonomy. They are not one, and that file says so itself in
// the comments beside the entries:
//
//   · 'info' is '/(client)/invoices' AND '/(client)/notices', and the comment
//     defending that admits it: "it shares that reading with /(client)/notices,
//     which is a real cost". A chip built on 'info' files a bill under
//     announcements.
//   · 'trophy' is '/(client)/achievements', '/(trainer)/credentials',
//     '/(trainer)/client-goals' AND '/(client)/packages' — the last of which is
//     where a member is sent when their CARD IS DECLINED. Any name for that
//     group is a lie about one of its members, and the expensive one is filing
//     a failed payment under a word that sounds like a prize.
//   · 'heart' is an injury and a progress photo. 'pencil' is an intake form
//     asked for and the same form come back.
//
// Every one of those collisions was chosen deliberately, by borrowing the icon
// the nav already gives the screen, and every one of them is defensible AS AN
// ICON: a shape beside a row that the reader also reads. None of them survives
// being promoted to a CATEGORY, which is a claim that the rows inside it are
// the same kind of thing and that the rows outside it are not.
//
// Two survive that promotion, and they are the two this file offers:
//
//   'session'  — icon 'calendar'. Seven routes map to it and all seven are an
//                appointment or a class in somebody's diary: both calendars,
//                bookings, pt-sessions, classes, request-session and the
//                coach's sessions screen. notifyInbox.ts's own note on
//                '/(trainer)/sessions' is the argument — "the two halves of one
//                conversation about one hour must not be two different shapes
//                in two inboxes". Complete in all three builds, with nothing
//                about a time living outside it.
//   'message'  — icon 'message'. Both chat threads, the coach's lead enquiry,
//                and the legacy rows `notify-message` wrote before there was a
//                route column — src/ui/notifications.tsx forces those to
//                'message' in `rowToItem` before this ever sees them. The
//                enquiry belongs: notifyInbox.ts defends that icon with "an
//                enquiry IS somebody writing to the coach, and the only
//                difference from a chat row is that this person has no account
//                yet."
//
// Everything else is 'other' and gets NO chip, because there is no true
// sentence naming what it is. A residual category called "Everything else" is
// the invented taxonomy wearing a hat.
//
// ── WHY THIS IS RIGHT FOR A COACH AND AN OWNER, NOT JUST A MEMBER ──────────
//
// `NotificationInbox` is one component behind three route files, so a filter
// added to it is added to all three at once. That is only acceptable because
// nothing here is keyed on the build:
//
//   · Unread is a column. It means the same thing to everybody.
//   · 'session' and 'message' are computed from the icon, which is computed
//     from the route, and both are group-agnostic — `inboxIcon` takes a route
//     and knows nothing about who is reading it.
//   · A chip is only drawn for a kind that is actually IN the rows in hand
//     (see `inboxChips`). An owner inbox — which the owner route file itself
//     describes as the quiet one, with nothing in the product addressed to a
//     gym owner today — shows no kind chips at all rather than two dead
//     controls that filter to nothing. A coach with no enquiries and no legacy
//     chat rows gets Sessions and not Messages. Nobody is shown a control that
//     cannot do anything.
//
// So this is NOT opt-in through `InboxFraming`. A per-caller flag would be
// three copies of one decision, drifting the way the header of
// src/ui/notifications.tsx says three copies of the list would have drifted —
// and the thing a flag would be protecting against, an empty chip, is already
// impossible.
//
// ── THE RULE THE WHOLE FILE IS BUILT AROUND ───────────────────────────────
//
// A filter may hide what it knows does not match, and must never hide it
// SILENTLY. An inbox is where somebody learns their session moved; a chip left
// on from yesterday that quietly swallows tonight's cancellation is worse than
// no filter at all, and the realtime INSERT subscription in
// src/ui/notifications.tsx means exactly that row can arrive while the person
// is looking at a narrowed list. `hiddenUnread` is the answer: every narrowed
// list states, in words, how many unread rows it is holding back. That sentence
// is the safety property, not the chips.
//
// ── AND THE ONE LoadStatus MAKES SHARPER ──────────────────────────────────
//
// "No notifications match this filter" and "your notifications could not be
// read" are different sentences and only one of them may be said by this file.
// `inboxFilterLine` states an ABSENCE under 'ready' and under nothing else; the
// screen's own 'error' Notice keeps its job. A figure on a chip is a claim
// about a whole set, so figures appear only under `isWhole` — under 'partial'
// the rows in hand are a prefix (src/lib/rowCap.ts) and a chip reading
// "Unread · 4" over a truncated read is a floor printed as a total.
//
// Pure and framework-free; asserted under plain node in inboxFilter.test.ts.
import { num } from './format';
import type { InboxIcon } from './notifyInbox';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/** What a row is about, as far as anything in this codebase can honestly say.
 *  See the header for why there are two named kinds and not eleven. */
export type InboxKind = 'session' | 'message' | 'other';

/** The question being asked of the list. Single-select: these are not
 *  composable predicates, they are four different lists, and a screen where
 *  "Unread" and "Sessions" can both be lit has a fifth state nobody named. */
export type InboxMode = 'all' | 'unread' | 'session' | 'message';

/** What the screen opens on, and what pressing All returns it to. */
export const NO_INBOX_FILTER: InboxMode = 'all';

/**
 * What kind of thing a row is, from the icon the inbox already draws it with.
 *
 * Takes the ICON rather than the route, because the route is not the last word:
 * `rowToItem` in src/ui/notifications.tsx overrides it for the legacy rows
 * `notify-message` wrote with no route at all, and those are message rows. The
 * icon is the value that survives that override, so it is the value this reads.
 */
export function inboxKind(icon: InboxIcon): InboxKind {
  if (icon === 'calendar') return 'session';
  if (icon === 'message') return 'message';
  return 'other';
}

/** The two facts a row is filtered on. A structural shape rather than
 *  `InboxItem`, which lives in a .tsx file that pulls in react-native-svg and
 *  compiles under neither tsconfig.test.json nor plain node. */
export interface FilterableRow {
  read: boolean;
  kind: InboxKind;
}

/** Whether the list on screen is not the list the person has. A chip nobody has
 *  pressed is not a filter, and an untouched list owes no explanation. */
export function inboxFilterActive(mode: InboxMode): boolean {
  return mode !== 'all';
}

/** Does this row survive the chip? Exported and named because it is the one
 *  decision every other function here is built on, and a test that can state it
 *  directly is worth more than four that reach it through `filterInbox`. */
export function keptBy(mode: InboxMode, row: FilterableRow): boolean {
  switch (mode) {
    case 'all': return true;
    case 'unread': return !row.read;
    default: return row.kind === mode;
  }
}

/**
 * The rows to draw.
 *
 * Generic, so the screen gets its own row type back and does not have to widen
 * `InboxItem` to a shape with two fields on it.
 *
 * The ORDER is the caller's and is never re-ranked. The read is
 * `order('created_at', { ascending: false })` and newest-first is the only
 * ordering this inbox has ever had; a filter that also sorted would move a row
 * under somebody's thumb between one render and the next.
 */
export function filterInbox<T extends FilterableRow>(rows: readonly T[], mode: InboxMode): T[] {
  return rows.filter((r) => keptBy(mode, r));
}

/**
 * How many unread rows the current mode is holding back.
 *
 * The number the safety sentence is built on. Counted over the rows in hand,
 * which is exactly what it claims to be about: what THIS filter is doing to
 * THIS list. It says nothing about rows past the cap, and `inboxFilterLine`
 * hedges the figure under anything but a whole read rather than dropping it —
 * "at least" is a true thing to say about a prefix, and silence is not.
 */
export function hiddenUnread(rows: readonly FilterableRow[], mode: InboxMode): number {
  if (!inboxFilterActive(mode)) return 0;
  return rows.reduce((n, r) => n + (!r.read && !keptBy(mode, r) ? 1 : 0), 0);
}

/** One control on the chip row. `label` is a button and is Title Case; `a11y`
 *  is the sentence a screen reader gets and is not the label read twice. */
export interface InboxChip {
  mode: InboxMode;
  label: string;
  a11y: string;
}

/**
 * The chips to draw, in a fixed order, or none at all.
 *
 * ── What decides a chip exists ────────────────────────────────────────────
 *
 * A kind chip is drawn when the rows in hand contain that kind, OR when it is
 * the mode currently selected. The second half is not symmetry for its own
 * sake: without it, marking the last unread row read while standing in Unread
 * would take the lit chip out from under the reader's thumb, leaving a narrowed
 * list with no visible control that narrowed it.
 *
 * ── What decides a chip carries a figure ──────────────────────────────────
 *
 * `isWhole`, and nothing else. Under 'partial' the rows are a PREFIX — the ones
 * past src/lib/rowCap.ts's limit are the oldest, and an unread one among them
 * is precisely the notification somebody has not got to — so a count taken here
 * is a floor. Under 'error' the rows are a cached copy of unknown age. Neither
 * may be printed as a total beside a control, so the chip says what it does and
 * the a11y label says why there is no number. This is the same rule
 * `unreadBadge` in src/lib/notifyInbox.ts applies to the bell, for the same
 * reason, and the two must not disagree.
 *
 * A count is never printed as zero either. A chip is only offered for a kind
 * that is present, so zero only arises for the selected-but-now-empty case
 * above, and "Unread · 0" beside a list is a confident claim made at the exact
 * moment the screen has least right to make one.
 */
export function inboxChips(
  rows: readonly FilterableRow[],
  mode: InboxMode,
  status: LoadStatus,
): InboxChip[] {
  if (!rows.length && !inboxFilterActive(mode)) return [];
  // A count of rows in a table with no ceiling — see `unreadBadge`. Four digits
  // is three years of one offer a day, and `1204` unseparated is the defect
  // scripts/check-numbers.mjs exists for.
  const figure = (n: number): string => (isWhole(status) && n > 0 ? ` · ${num(n)}` : '');
  const unsure = isWhole(status)
    ? ''
    : ' This is not your whole inbox yet, so the number is not shown.';
  const count = (m: InboxMode): number => rows.reduce((n, r) => n + (keptBy(m, r) ? 1 : 0), 0);

  const chips: InboxChip[] = [
    { mode: 'all', label: 'All', a11y: 'Show every notification' },
  ];
  const unread = count('unread');
  if (unread > 0 || mode === 'unread') {
    chips.push({
      mode: 'unread',
      label: `Unread${figure(unread)}`,
      a11y: `Show only notifications you have not opened.${unsure}`,
    });
  }
  const sessions = count('session');
  if (sessions > 0 || mode === 'session') {
    chips.push({
      mode: 'session',
      label: `Sessions${figure(sessions)}`,
      a11y: `Show only notifications about a session or a class.${unsure}`,
    });
  }
  const messages = count('message');
  if (messages > 0 || mode === 'message') {
    chips.push({
      mode: 'message',
      label: `Messages${figure(messages)}`,
      a11y: `Show only notifications that are somebody writing to you.${unsure}`,
    });
  }
  // One control is not a choice. With nothing but All there is nothing to pick
  // between, and a lone lit chip over an unfiltered list is furniture.
  return chips.length > 1 ? chips : [];
}

/**
 * The sentence a narrowed list owes its reader, or null when it owes none.
 *
 * `matched` is what is on screen. `searched` is how many rows the filter
 * actually ran over — what LOADED, which under anything but 'ready' is not the
 * person's inbox. `hidden` is `hiddenUnread` above.
 *
 * The branches are in the order of the harm. A read that failed is said first,
 * because every clause after it is a detail about a list that is not the
 * answer — and an ABSENCE is stated under 'ready' alone. "Nothing matches this
 * filter" over a read that never landed is the screen answering a question
 * nobody could answer, in the one place a person decides whether to stop
 * looking.
 */
export function inboxFilterLine(o: {
  status: LoadStatus;
  mode: InboxMode;
  matched: number;
  searched: number;
  hidden: number;
}): string | null {
  if (!inboxFilterActive(o.mode)) return null;
  const parts: string[] = [];

  switch (o.status) {
    case 'error':
      // Said first, and NOT alone — unlike `threadFilterLine`, which returns at
      // this point. The rows on screen under 'error' are real rows from a cache,
      // and a chip holding one of them back is a fact about this screen whatever
      // the server did. That is the sentence this whole file exists for, so it
      // survives the failure that would otherwise swallow it.
      parts.push('These notifications could not be confirmed, so this filter ran over the last copy on this phone rather than over your inbox.');
      break;
    case 'loading':
      parts.push('Still reading your notifications, so this covers only the ones that have arrived so far.');
      break;
    case 'partial':
      // Said whether or not anything matched: somebody who finds two sessions in
      // an inbox that came back short has no way of knowing there is a third
      // past the cap.
      parts.push(o.searched === 1
        ? 'Your inbox came back short, so this looked at the one notification that arrived and not at the rest of it.'
        : `Your inbox came back short, so this looked at the ${num(o.searched)} notifications that arrived and not at the rest of it.`);
      break;
    case 'ready':
      if (o.matched === 0) parts.push(emptySentence(o.mode));
      break;
  }

  if (o.hidden > 0) {
    // The figure is hedged rather than withheld under an incomplete read. "At
    // least" is a true statement about a prefix or a cache; saying nothing about
    // rows being held back is not.
    const exact = isWhole(o.status);
    parts.push(o.hidden === 1
      ? (exact
        ? 'One unread notification is hidden by this filter.'
        : 'At least one unread notification is hidden by this filter.')
      : (exact
        ? `${num(o.hidden)} unread notifications are hidden by this filter.`
        : `At least ${num(o.hidden)} unread notifications are hidden by this filter.`));
  }

  return parts.length ? parts.join(' ') : null;
}

/**
 * What an empty filtered list says, under 'ready' and under nothing else.
 *
 * Three sentences rather than one, because each is a claim about a different
 * thing and a reader acts on them differently. None of them is the screen's own
 * empty state: `emptyTitle` and `emptyNote` in `InboxFraming` describe an inbox
 * with nothing in it, which is not what any of these describe.
 */
function emptySentence(mode: InboxMode): string {
  if (mode === 'unread') return 'Nothing is unread. Everything in your inbox has been opened.';
  if (mode === 'session') return 'Nothing in your inbox is about a session or a class.';
  return 'Nothing in your inbox is somebody writing to you.';
}

/**
 * Why the bulk controls are not on screen, or null when they are.
 *
 * Mark All Read and Clear Read are scoped by PREDICATE, not by what is drawn —
 * `mark_notifications_read()` takes everything unread and the clear takes
 * everything read, both of them across the whole inbox. Offering either under a
 * live filter puts a button that acts on forty rows beneath a list showing six,
 * and `clearReadPrompt` would name a figure the reader cannot see the rows for.
 * Both are withheld instead.
 *
 * It returns a SENTENCE rather than a boolean because src/ui/notifications.tsx
 * has already had this argument once and written the answer down beside
 * `controls.withheld`: a control that silently disappears reads as a bug. The
 * way back is one tap on All, and it says so.
 */
export function bulkOffWhileFiltered(mode: InboxMode, offered: boolean): string | null {
  if (!offered || !inboxFilterActive(mode)) return null;
  return 'Mark All Read and Clear Read act on your whole inbox rather than on what is filtered here. Press All to get them back.';
}
