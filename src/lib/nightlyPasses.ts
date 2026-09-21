// What the overnight passes did, and the much larger thing this app cannot say
// about them.
//
// ── What runs while the coach is asleep ────────────────────────────────────
//
// Five pg_cron jobs run once a night against a coach's own book and write into
// their inbox. None of them is a message to a client — nothing is sent to
// anybody on the coach's behalf, which is worth stating because the passes read
// like automation and are not:
//
//   overdue-client-notices      run_overdue_client_notices      part 202
//   credential-expiry-notices   run_credential_expiry_notices   part 202
//   block-ended-notices         run_block_ended_notices         part 471
//   pack-expiry                 run_pack_expiry                 part 612
//   invoice-ageing-notices      run_invoice_ageing_notices      part 613
//
// `pack-expiry` is the one that is not only a notice: it closes packs whose
// validity has run out, trims `sessions_total` to `sessions_used` and stamps
// `expired_at`. A night on which it does not run leaves credits bookable that
// the client has no right to, and the coach has no way of knowing.
//
// ── Why this exists, which is not a hypothetical ──────────────────────────
//
// From 2026-09-05 04:12 UTC to 2026-09-06 03:40 UTC every one of those five
// passes failed on EVERY run — 120 failed runs, 0 successful — on a bigint that
// would not cast to an integer at plan time. The header of supabase/parts/2560
// has the whole account. For a day and a night no coach was told a client had
// gone quiet, that their insurance had expired, that a block had ended or that
// an invoice had aged, and no expired pack was closed.
//
// The failure was loud in exactly one place — `cron.job_run_details` — and
// nothing read it. To every coach in the product it looked like a quiet week.
// Part 2560 added an alarm for the operator; this is the other half, for the
// person whose book it is.
//
// ── WHAT THIS CAN AND CANNOT KNOW ─────────────────────────────────────────
//
// CAN: the `notifications` rows the passes wrote, because they are the coach's
// own rows and `notif_self` lets them read them. The row is the durable half by
// design — part 900 chose to leave a row unpushed rather than pushed twice.
//
// CANNOT: whether a pass RAN. That is `notice_pass_runs` (part 1890), which has
// RLS on with no policy and, since part 820's doctrine, no grant either. It is
// the scheduler's own bookkeeping and opening it to a signed-in user is not a
// change this file is entitled to make on its own. So an empty line here means
// "nothing was written to your inbox", which is what a quiet week and a total
// outage both look like, and `SILENCE_IS_NOT_PROOF` says so on the screen
// rather than leaving the coach to infer the happier of the two.
//
// CANNOT: whether anything reached a phone. `pushed_at` is the moment
// `notifications_dispatch_push` POSTED the row to send-push and is the last
// event this product observes. Worse for the word "delivered": several notices
// in one night are deliberately folded into ONE banner
// (`run_notices_with_digest`), so four rows with a `pushed_at` are four rows
// that went out as one line saying "…and 3 more".
//
// Pure — no react, no supabase, no clock beyond the `now` passed in.
import { num } from './format';

/** The five passes, as this file names them. */
export type PassKey = 'overdue-clients' | 'credentials' | 'blocks' | 'packs' | 'invoices';

export interface PassDef {
  key: PassKey;
  /** The heading. Sentence case: this is a row in a list, not a control. */
  title: string;
  /** What it looks for, in the coach's terms. */
  what: string;
  /**
   * The exact `notifications.title` strings this pass writes.
   *
   * Matching on the title is brittle and is chosen with that understood: the
   * alternative signals are worse. `route` is shared — two passes both send a
   * coach to /(trainer)/invoices — and there is no column saying which job
   * wrote a row. The brittleness falls the safe way: a reworded title stops
   * being counted, so the screen under-reports and says "nothing was written",
   * which is the sentence this whole file exists to make un-reassuring.
   */
  titles: readonly string[];
  /**
   * What the pass does BESIDES writing a notice, or null.
   *
   * Only `pack-expiry` has one, and it is the reason this list is not merely
   * about notifications: a missed run there leaves sessions bookable that were
   * paid for on a pack that has expired.
   */
  alsoDoes: string | null;
}

export const NIGHTLY_PASSES: readonly PassDef[] = [
  {
    key: 'overdue-clients',
    title: 'Clients past their usual gap',
    what: 'Looks for clients who have not been in for noticeably longer than their own usual gap between visits.',
    titles: ['A client is past their usual gap'],
    alsoDoes: null,
  },
  {
    key: 'credentials',
    title: 'Your insurance and qualifications',
    what: 'Checks the expiry dates you have recorded against your own credentials.',
    titles: [
      'Your insurance has expired', 'A qualification has expired',
      'Your insurance runs out soon', 'A qualification runs out soon',
    ],
    alsoDoes: null,
  },
  {
    key: 'blocks',
    title: 'Training blocks that ended',
    what: 'Looks for a client whose training block has reached its last week.',
    titles: ['A block has run out'],
    alsoDoes: null,
  },
  {
    key: 'packs',
    title: 'Session packs out of time',
    what: 'Looks for paid session packs whose validity has run out.',
    titles: ['A session pack has run out of time'],
    alsoDoes: 'This one also CLOSES those packs: the unused sessions on an expired pack stop being '
      + 'bookable. On a night it does not run, they stay bookable.',
  },
  {
    key: 'invoices',
    title: 'Invoices going unpaid',
    what: 'Watches invoices crossing the ageing bands after their due date.',
    titles: ['An invoice has gone past its date', 'An invoice is still unpaid'],
    alsoDoes: null,
  },
];

/** How far back the screen looks. A week, because these run nightly and a coach
 *  reading this is asking about last night and the few before it — not keeping
 *  a ledger. */
export const PASSES_WINDOW_DAYS = 7;

/** One `notifications` row, reduced to what this file asks of it. */
export interface PassNotice {
  id: string;
  title: string;
  /** `created_at`. When the row was WRITTEN, which is the one timestamp here
   *  that means what it looks like it means. */
  at: string;
  /**
   * `pushed_at` — when the dispatcher posted this row to send-push. Null means
   * "not eligible" or "not yet" and deliberately does not distinguish the two,
   * which is part 900's own note on the column.
   */
  pushedAt: string | null;
}

/** Which pass wrote this row, or null when nothing here wrote it — every chat
 *  notification, every booking, everything a handset wrote for itself. */
export function passOf(title: string | null | undefined): PassKey | null {
  const t = String(title ?? '').trim();
  if (!t) return null;
  for (const p of NIGHTLY_PASSES) if (p.titles.includes(t)) return p.key;
  return null;
}

export interface PassTally {
  key: PassKey;
  /**
   * Rows for this pass that came back inside the window.
   *
   * Named `seen` and not `count` because under a truncated read it is a FLOOR.
   * `passCountLine` takes the read's wholeness and is the only thing allowed to
   * turn it into a sentence.
   */
  seen: number;
  /** The newest `created_at` among them. Null when none came back. Formatted by
   *  the caller, in the reader's own locale. */
  latestAt: string | null;
  /** How many of those the dispatcher had posted to the push sender. Never a
   *  count of phones; see the header. */
  handed: number;
}

/**
 * One tally per pass, in catalogue order, INCLUDING the passes with nothing.
 *
 * A pass that wrote nothing is the most important row on this screen — it is
 * the shape both "a quiet week" and "this job has raised on every run since
 * Tuesday" take — so it cannot be one that simply does not appear.
 */
export function tallyPasses(rows: readonly PassNotice[]): PassTally[] {
  const tallies = new Map<PassKey, PassTally>();
  for (const p of NIGHTLY_PASSES) tallies.set(p.key, { key: p.key, seen: 0, latestAt: null, handed: 0 });
  for (const r of rows) {
    const key = passOf(r.title);
    if (!key) continue;
    const t = tallies.get(key);
    if (!t) continue;
    t.seen += 1;
    if (r.pushedAt) t.handed += 1;
    // String comparison on an ISO timestamp, which is ordered as text as long
    // as both are ISO — and a row whose `at` is not is not allowed to win by
    // being longer, so anything unparseable simply never becomes the latest.
    if (!t.latestAt || (r.at > t.latestAt && !Number.isNaN(Date.parse(r.at)))) t.latestAt = r.at;
  }
  return NIGHTLY_PASSES.map((p) => tallies.get(p.key) as PassTally);
}

/**
 * What may be said about one pass's tally.
 *
 * `whole` is `isWhole(status)` and nothing else. Under a truncated read `seen`
 * is a count of what came back rather than of what the pass wrote, and the
 * sentence says "at least" rather than printing a subtotal in the shape of a
 * total — which is the single most repeated defect in this codebase and has its
 * own gate.
 */
export function passCountLine(t: PassTally, whole: boolean): string {
  if (!whole) {
    return t.seen === 0
      ? 'Nothing came back for this one, and the read was not whole, which is not the same as nothing.'
      : `At least ${num(t.seen)} in the last week. The read stopped short, so there may be more.`;
  }
  if (t.seen === 0) return 'Nothing written to your inbox in the last week.';
  return t.seen === 1
    ? 'One notice written to your inbox in the last week.'
    : `${num(t.seen)} notices written to your inbox in the last week.`;
}

/**
 * The sentence this whole module exists to put on a screen.
 *
 * It is deliberately the opposite of reassuring. A coach reading five quiet
 * lines will conclude their book is in good order, and for a day and a night in
 * September that conclusion would have been exactly wrong for every coach in
 * the product at once.
 */
export const SILENCE_IS_NOT_PROOF =
  'An empty line above means nothing was written to your inbox, not that the check ran and found '
  + 'nothing. Repple cannot show you that these ran: that is kept on the server, in a place the app '
  + 'is not allowed to read. They have failed on every run for a whole day before now, and this '
  + 'screen looked exactly like a quiet week while it happened.';

/** What a `pushed_at` is, and the three things it is not. */
export const HANDED_NOT_ARRIVED =
  'Where a notice was handed to the push sender, that is the last thing Repple sees of it. Whether '
  + 'your phone was on, whether the banner appeared and whether you read it are not things it is '
  + 'told, and several notices in one night are folded into a single banner on purpose, so one '
  + 'banner is not one notice.';

/** How many of a pass's notices went out to the sender, or null when there is
 *  nothing to say — no notices, or none of them dispatched, both of which the
 *  line above has already covered. */
export function handedLine(t: PassTally): string | null {
  if (t.seen === 0 || t.handed === 0) return null;
  return t.handed === t.seen
    ? `All of ${t.seen === 1 ? 'it' : 'them'} went to the push sender.`
    : `${num(t.handed)} of those went to the push sender.`;
}
