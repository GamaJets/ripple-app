// Session packs: what a client is holding, and what the database just said
// about spending one.
//
// The sibling of coachMoney.ts, from the client's side of the same sale. Pure
// arithmetic and pure interpretation — no supabase, no react-native — so it can
// be run under `npm test`. The reads and the RPC calls stay in connect.ts.
//
// ── The two things that go wrong with a pack, and are defended here ────────
//
// 1. A BALANCE THAT WAS NEVER READ IS NOT A BALANCE OF ZERO.
//
//    `client_purchases` is the table where "the read failed" and "you have
//    nothing" look identical at the type level: both arrive as an absence.
//    They are opposite sentences to say to somebody who has paid. So
//    `packBalance` returns `left: null` for an unread history and `left: 0`
//    only for one that was read and came back with nothing on it, and every
//    screen above it renders the two differently. This has been fixed by hand
//    in `fetchMyPurchases`, in `sessionsRemaining` and in `redeemSession`
//    already, one function at a time, each time after a wrong sentence reached
//    a screen. Doing the arithmetic in one place is what stops the fourth.
//
// 2. A WRITE THAT CHANGED NOTHING IS NOT A WRITE THAT SUCCEEDED.
//
//    PostgREST answers an UPDATE matching zero rows with `error: null` — proven
//    against the live database — so "no error" is not evidence that a credit
//    came off. `redeem_pack_session` (part 123) therefore answers with a ROW
//    saying what happened, and `readDraw` below refuses to call anything a
//    success that did not come back as exactly one row naming a known outcome.
//    An empty response, two responses, or an outcome word this build has never
//    heard of are all 'unknown' — which the caller reports as "we could not
//    tell", never as "drawn" and never as "you have none left".

/** A purchase row as the client's own screens read it. The shape `Purchase` in
 *  connect.ts has, narrowed to what a balance depends on. */
export interface PackPurchase {
  id: string;
  package_id: string | null;
  /** null for a membership — a thing with no credits, not a thing with none left. */
  sessions_total: number | null;
  sessions_used: number;
  status: string;
  created_at: string;
}

/** One pack, as a line on the client's screen. */
export interface PackLine {
  id: string;
  /** The package's name when it is readable, and a description of the pack when
   *  it is not. Never a name we invented for it. */
  label: string;
  /** True when `label` is the package's real name rather than a description.
   *  The screen says "10-session pack" plainly and a real name in quotes. */
  named: boolean;
  left: number;
  /** How big the pack is. Named for the column it comes from rather than
   *  `total`, so `check:numbers` recognises it as the figure it already knows
   *  cannot pass a thousand — a session pack is 5, 10 or 20, never 1,200. */
  sessions_total: number;
  /** Paid for, and nothing left on it. The one line the client has to act on. */
  exhausted: boolean;
  created_at: string;
}

/** What the client is holding, and how far it can be trusted. */
export interface PackBalance {
  /** Oldest first — the order credits are actually spent in, so the pack at the
   *  top is the one the next booking comes off. Matches the `order by
   *  created_at asc` in `redeem_pack_session`. */
  lines: PackLine[];
  /** Sessions left across every pack. **`null` means the history was not read**,
   *  and is not the same as 0. A screen may print 0; it may not print null as a
   *  figure. */
  left: number | null;
  /** Packs with something left on them. */
  live: number;
  /** Packs paid for and used up. */
  exhausted: number;
}

/**
 * The label for a pack whose package may or may not be readable.
 *
 * `pkg_read` is `active or trainer_id = auth.uid()`, so a client can only read
 * packages that are still ON SALE. A coach who withdraws a package makes it
 * invisible to the very people who bought it — which is also why an amount from
 * one of those rows has no currency (see `packageLabels` in connect.ts).
 *
 * A pack with no readable name is described by its size rather than given one:
 * "10-session pack" is a fact about the row, where "Coaching pack" would be a
 * name this code made up for a thing the coach named something else.
 */
export function packLabel(total: number | null, name: string | null | undefined): { label: string; named: boolean } {
  const n = (name || '').trim();
  if (n) return { label: n, named: true };
  if (total == null || !Number.isFinite(total)) return { label: 'Membership', named: false };
  return { label: `${total}-session pack`, named: false };
}

/** Is this row a session pack the client has paid for? A membership is not
 *  (no credits), and neither is a checkout that never completed. */
const isLivePack = (r: PackPurchase): boolean =>
  r.status === 'paid' && r.sessions_total != null && Number.isFinite(r.sessions_total);

/**
 * The client's pack balance.
 *
 * `rows === null` is a history that could not be read, and comes back with
 * `left: null` — no lines, no zero, nothing a screen can print as a figure.
 * `rows === []` is somebody who has bought nothing, and comes back with
 * `left: 0`, which a screen may state.
 *
 * `names` maps package id → package name, for the packages that are readable.
 * An id missing from it is a package we could not read, not a package with no
 * name; `packLabel` describes those rather than naming them.
 */
export function packBalance(
  rows: readonly PackPurchase[] | null | undefined,
  names?: ReadonlyMap<string, string | null> | null,
): PackBalance {
  if (rows == null) return { lines: [], left: null, live: 0, exhausted: 0 };

  const lines: PackLine[] = [];
  for (const r of rows) {
    if (!isLivePack(r)) continue;
    const total = r.sessions_total as number;
    const used = Number.isFinite(r.sessions_used) ? r.sessions_used : 0;
    // Clamped, because part 123's constraint is newer than the rows that may
    // already be in this table on somebody's project. A negative balance is not
    // a sentence to show a person about their own money.
    const left = Math.max(0, Math.min(total, total - used));
    const { label, named } = packLabel(total, r.package_id ? names?.get(r.package_id) : null);
    lines.push({ id: r.id, label, named, left, sessions_total: total, exhausted: left === 0, created_at: r.created_at });
  }

  // Oldest first. A row with an unparseable date sorts last rather than being
  // dropped: it is a pack somebody paid for, and its credits count.
  lines.sort((a, b) => {
    const ta = Date.parse(a.created_at); const tb = Date.parse(b.created_at);
    const va = Number.isFinite(ta); const vb = Number.isFinite(tb);
    if (va && vb) return ta - tb;
    if (va) return -1;
    if (vb) return 1;
    return 0;
  });

  return {
    lines,
    left: lines.reduce((a, l) => a + l.left, 0),
    live: lines.filter((l) => !l.exhausted).length,
    exhausted: lines.filter((l) => l.exhausted).length,
  };
}

/**
 * What `redeem_pack_session` / `refund_pack_session` said happened.
 *
 * 'unknown' is not one of the database's answers. It is what this build says
 * when the response was not one row naming an outcome it recognises — an empty
 * result, more than one, or a word from a newer schema. It is deliberately NOT
 * folded into 'no_pack': "we could not tell" and "you never had one" are
 * different sentences, and only one of them is safe to say to a paying client.
 */
export type DrawOutcome = 'drawn' | 'returned' | 'exhausted' | 'nothing_to_return' | 'no_pack' | 'unknown';

const KNOWN: ReadonlySet<string> = new Set<string>(['drawn', 'returned', 'exhausted', 'nothing_to_return', 'no_pack']);

/** One row of the RPC's answer, once it has been believed. */
export interface Draw {
  outcome: DrawOutcome;
  /** The balance the DATABASE holds after the write — never one computed here.
   *  null when the answer carried no figure, or when there is no figure to
   *  carry. */
  remaining: number | null;
  purchaseId: string | null;
  total: number | null;
}

const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;

/**
 * Read the RPC's response, counting rows.
 *
 * This is the row-count check the old client-side UPDATE could not do. supabase
 * hands back `data` for an RPC as an array (a set-returning function), and the
 * three shapes that are NOT a success look nothing alike in the database and
 * exactly alike to a caller that only checks `error`:
 *
 *   []                 the function returned no row. Nothing happened, and
 *                      nothing said so.
 *   [row, row]         more than one, which this contract does not produce and
 *                      which no caller should pick a winner from.
 *   [{outcome: '…'}]   a word this build does not know.
 *
 * All three are 'unknown'. Only a single row naming a known outcome is believed,
 * and `drew` below is the only thing any screen may treat as a credit moving.
 */
export function readDraw(data: unknown): Draw {
  const rows = Array.isArray(data) ? data : data == null ? [] : [data];
  if (rows.length !== 1) return { outcome: 'unknown', remaining: null, purchaseId: null, total: null };
  const r = rows[0] as Record<string, unknown> | null;
  const word = r && typeof r.outcome === 'string' ? r.outcome : '';
  if (!KNOWN.has(word)) return { outcome: 'unknown', remaining: null, purchaseId: null, total: null };
  return {
    outcome: word as DrawOutcome,
    remaining: intOrNull(r?.sessions_left),
    purchaseId: typeof r?.purchase_id === 'string' ? r.purchase_id : null,
    total: intOrNull(r?.pack_total),
  };
}

/** Did a credit actually move? The only outcomes that mean the balance changed.
 *  Everything else — including 'unknown' — did not move one, and a screen that
 *  says otherwise is telling somebody their pack went down when it did not. */
export function drew(d: Draw): boolean {
  return d.outcome === 'drawn' || d.outcome === 'returned';
}

/**
 * WHY a credit did not move, as a fragment the booking screen drops into
 * parentheses: app/(client)/calendar.tsx renders
 *
 *     This wasn't taken off your session pack (…) — check your package…
 *
 * so these are lower-case clauses, not sentences.
 *
 * `undefined` for the two outcomes that are not a problem to explain:
 *
 *   'drawn'/'returned'  nothing to explain, a credit moved.
 *   'no_pack'           they pay per session and never had a pack. Naming a
 *                       reason would put an explanation about session packs in
 *                       front of somebody who has never bought one — and the
 *                       booking screen already stays silent when it knows the
 *                       balance is zero.
 *
 * 'unknown' is the one that must always speak. It is the outcome that used to
 * be indistinguishable from success.
 */
export function drawReason(d: Draw): string | undefined {
  switch (d.outcome) {
    case 'drawn': return undefined;
    case 'returned': return undefined;
    case 'no_pack': return undefined;
    case 'exhausted': return 'every session on your pack is already used';
    case 'nothing_to_return': return 'nothing had been drawn off it to give back';
    case 'unknown': return 'we could not confirm the change with the server';
    default: return undefined;
  }
}
