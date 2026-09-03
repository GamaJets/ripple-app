// Who is in an hour on the coach's calendar — and the one answer that must
// never be guessed.
//
// ── What was there ────────────────────────────────────────────────────────
//
// app/(trainer)/calendar.tsx named every session on the screen with a single
// expression:
//
//     roster.find((c) => c.id === id)?.name ?? 'Open slot'
//
// Two entirely different facts came out of that as the same three words.
//
//   · `clientId` null — the slot IS open. Nobody has taken it, and "Open slot"
//     is the whole truth.
//   · `clientId` set, and the roster read did not return that person — the slot
//     is BOOKED. Somebody arranged to be there and the only thing missing is
//     their name.
//
// The second was drawn as the first in the day sheet, in the cancel
// confirmation, in the move sheet and in the late-fee list: the four places a
// coach decides whether an hour is theirs to give away. A coach reading "Open
// slot" over a booked hour hands it to somebody else, and two people turn up.
//
// The roster comes back short for four ordinary reasons and none of them mean
// the hour is free: the read failed, the read stopped at its row cap, the first
// read is still in flight, or the client has since left this coach's book and
// still has an hour on the calendar. That is the empty-list-as-fact rule
// src/ui/loadStatus.ts states, broken on the screen where it costs the most.
//
// Pure — no react, no supabase, no clock. `status` is passed in.
import type { LoadStatus } from '../ui/loadStatus';

/** A roster entry, as this module needs to see it. A structural subset, so the
 *  calendar passes its own rows straight in. */
export interface NamedClient {
  id: string;
  name: string;
}

/** What the roster could tell us about the person in a slot.
 *   · 'open'    — nobody is in it. The only reading that may say "open".
 *   · 'named'   — they were found and they have a name.
 *   · 'unnamed' — they were found and the row carries no name.
 *   · 'unread'  — booked, and the roster this screen holds cannot name them. */
export type SlotWho = 'open' | 'named' | 'unnamed' | 'unread';

/** Whether the roster in hand is the coach's whole book. Only under 'ready' may
 *  a missing id be read as "not on your book"; under anything else the list is
 *  short for a reason that has nothing to do with the client. */
const whole = (status: LoadStatus): boolean => status === 'ready';

/**
 * What is actually known about who is in this slot.
 *
 * Separated from the words so both of the sentences below are built from one
 * decision rather than two that can drift apart, and so a screen can branch on
 * the fact — a booked hour nobody can name is still a booked hour, and may need
 * to be drawn as one.
 */
export function slotWho(
  clientId: string | null | undefined,
  roster: readonly NamedClient[],
): SlotWho {
  if (!clientId) return 'open';
  const found = roster.find((c) => c.id === clientId);
  if (!found) return 'unread';
  return found.name && found.name.trim() ? 'named' : 'unnamed';
}

/**
 * The label on a row or in a list.
 *
 * Sentence-shaped fragments rather than a name, because there is no name: what
 * a coach needs from this line is whether the hour is spoken for, and every arm
 * but the first says that it is.
 */
export function slotLabel(
  clientId: string | null | undefined,
  roster: readonly NamedClient[],
  status: LoadStatus,
): string {
  const who = slotWho(clientId, roster);
  if (who === 'open') return 'Open slot';
  if (who === 'named') return roster.find((c) => c.id === clientId)!.name.trim();
  if (who === 'unnamed') return 'Booked · no name on their record';
  return whole(status)
    ? 'Booked · not on your book any more'
    : 'Booked · your roster could not be read, so they cannot be named';
}

/**
 * The same person inside running prose — "cancel the 6pm with …".
 *
 * A separate function and not the label, because "6pm with Booked · not on your
 * book any more was cancelled" is a sentence that has come apart. Every arm
 * here is a noun phrase that can stand where a name would.
 */
export function slotWhoName(
  clientId: string | null | undefined,
  roster: readonly NamedClient[],
  status: LoadStatus,
): string {
  const who = slotWho(clientId, roster);
  if (who === 'open') return 'nobody';
  if (who === 'named') return roster.find((c) => c.id === clientId)!.name.trim();
  if (who === 'unnamed') return 'the client in this slot, who has no name on their record';
  return whole(status)
    ? 'a client who is no longer on your book'
    : 'a client this screen could not name';
}

/**
 * The sentence to put under a booked hour whose client could not be named, or
 * null when there is nothing to add.
 *
 * Said out loud rather than left to be inferred from an odd-looking label,
 * because the coach's next decision is whether to give the hour away.
 */
export function unnamedSlotNote(
  clientId: string | null | undefined,
  roster: readonly NamedClient[],
  status: LoadStatus,
): string | null {
  const who = slotWho(clientId, roster);
  if (who === 'open' || who === 'named') return null;
  if (who === 'unnamed') {
    return 'This hour is booked. The client record behind it carries no name, so there is nobody to print here — it is not an open slot.';
  }
  return whole(status)
    ? 'This hour is booked by somebody who is not on your book any more, so their name cannot be shown. It is not an open slot — cancelling it frees a session somebody arranged.'
    : 'This hour is booked. Your roster did not come back, so their name is unknown — this is not an open slot, and it must not be given to anybody else until the list loads.';
}
