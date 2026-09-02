// What a coach charges for a session — and the three different ways that can
// be nothing.
//
// ── The defect this exists to end ─────────────────────────────────────────
//
// `app/(client)/trainers.tsx` read the column as
//
//     sessionFee: r.session_fee != null && !Number.isNaN(Number(r.session_fee))
//       ? Number(r.session_fee) : 0
//
// and then rendered on `sessionFee > 0`. So "this coach charges nothing",
// "this coach has not stated a rate" and "we could not read this coach's rate"
// were one blank space on the row. The rest of that same file keeps `null` and
// `[]` carefully apart for credentials, ratings and the fee currency, with a
// sentence per cause; the fee — the one figure a member opens a directory to
// find — was the field that could not say it was unknown.
//
// ── Why a union rather than `number | null` ───────────────────────────────
//
// Because zero is a real answer. A coach running an introductory month, a
// gym-employed trainer whose sessions are inside the membership, and a coach
// who simply has not filled the field in are three different facts, and the
// member's next action differs: book, book, or ask. Collapsing them onto one
// blank makes the ask invisible.
//
// `unreadable` is kept separate from `unstated` for the reason stated all over
// this codebase: an empty read is UNKNOWN, never "there are none". A row whose
// `session_fee` holds something that will not parse is a data problem the
// member must not be told is a price of zero.
//
// Pure: no react-native, no supabase. The reading is arithmetic on one value
// and is tested as such.

/** A coach's per-session rate as read off one row. */
export type SessionFee =
  /** A rate is stated, and it is more than nothing. `amount` is in major units. */
  | { kind: 'priced'; amount: number }
  /** A rate is stated and it is zero. The coach charges nothing per session. */
  | { kind: 'free' }
  /** The column is empty. The coach has not said what they charge. */
  | { kind: 'unstated' }
  /** The column held something that is not a rate. UNKNOWN, never zero. */
  | { kind: 'unreadable' };

/**
 * Read one `trainers.session_fee` value.
 *
 * Accepts the string form as well as the number form because a Postgres
 * `numeric` arrives over PostgREST as a string, and `Number('')` is 0 — which
 * is exactly the coercion that turned a blank cell into "charges nothing".
 * An empty or whitespace-only string is therefore `unstated`, not `free`.
 */
export function readSessionFee(raw: unknown): SessionFee {
  if (raw == null) return { kind: 'unstated' };
  if (typeof raw === 'string' && raw.trim() === '') return { kind: 'unstated' };
  if (typeof raw === 'boolean') return { kind: 'unreadable' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { kind: 'unreadable' };
  // A negative rate is not a discount, it is a bad row. Nothing in the product
  // pays a member to attend, so this is never quietly rendered as a figure.
  if (n < 0) return { kind: 'unreadable' };
  return n > 0 ? { kind: 'priced', amount: n } : { kind: 'free' };
}

/** The figure, or null when there is no figure to print. Callers pass this to
 *  `wholeMoney`, which withholds the currency symbol on its own terms. */
export function sessionFeeAmount(f: SessionFee): number | null {
  return f.kind === 'priced' ? f.amount : null;
}

/**
 * The short line that goes where the figure would have gone on a directory row.
 *
 * Null for a priced coach, because the row prints the money instead. Kept to
 * two or three words: twenty of these stack down one screen and a sentence per
 * row is unreadable — the same reason `feeGap` lives in the profile sheet and
 * not on the row.
 */
export function sessionFeeShort(f: SessionFee): string | null {
  switch (f.kind) {
    case 'priced': return null;
    case 'free': return 'No session fee';
    case 'unstated': return 'Rate not stated';
    case 'unreadable': return 'Rate unavailable';
  }
}

/**
 * The sentence for the sheet, where somebody actually decides.
 *
 * Null for a priced coach. Each of the other three names what the member can
 * do about it, because "no fee shown" with no next step is the state this file
 * exists to remove.
 */
export function sessionFeeNote(f: SessionFee, coachName?: string | null): string | null {
  const who = (coachName || '').trim() || 'This coach';
  switch (f.kind) {
    case 'priced':
      return null;
    case 'free':
      return `${who} has set their session fee to nothing, so there is no per-session charge to pay them.`;
    case 'unstated':
      return `${who} hasn’t stated a session fee. Ask them what they charge before you book — it is a normal thing to ask.`;
    case 'unreadable':
      return `We couldn’t read ${who === 'This coach' ? 'this coach’s' : who + '’s'} session fee. This is not a statement that they charge nothing — ask them what they charge.`;
  }
}
