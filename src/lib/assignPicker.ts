// Who a built programme is about to go to, and what the builder is allowed to
// throw away on the way there.
//
// Everything here is pure. It takes statuses and ids and returns decisions and
// sentences; it performs no writes and reads nothing, so the builder can ask it
// what would happen before anything does. The fan-out itself is NOT here —
// src/lib/groupProgram.ts plans it and src/lib/bulkActions.ts writes the
// sentences around it, and a second copy of either is how the two screens that
// assign programmes would start disagreeing about what a bulk write means.
//
// ── 1 · THE BUILDER WAS DESTROYING THE COACH'S OWN WORK ────────────────────
//
// app/(trainer)/builder.tsx loaded the selected client's current programme into
// the builder whenever the selected client changed, unconditionally:
//
//     useEffect(() => {
//       if (programStatus !== 'ready') { setTitle(''); setNote(''); setDays([]); return; }
//       const existing = getProgram(clientId);
//       if (existing) { loadFrom(existing); return; }
//       …
//     }, [clientId, programStatus, autoGoal]);
//
// The builder opens with NO client selected — `roster[0]?.id` is evaluated in a
// `useState` initialiser on the first render, when the roster read has not come
// back, so it is always `''`. So the coach's actual sequence is: open Programs,
// lay out a week, then pick the person it is for. That last tap ran the effect
// above and replaced everything they had typed with the client's existing
// programme, or with nothing at all. Twenty minutes of work, gone at the exact
// gesture that was supposed to send it — which is, in the user's words, being
// unable to assign a programme they had built.
//
// This is the same defect as the ones the guards in that file already stop,
// pointed at the coach instead of the client: a silent, unrecoverable
// replacement of something a human wrote. So it gets the same treatment. The
// builder never replaces its own contents on its own; when the contents and the
// selected client disagree it SAYS SO and offers the replacement as a control
// the coach taps.
//
// The honesty requirement cuts the other way too, and is why this is not simply
// "stop loading". A builder showing one client's programme while another
// client's name is selected is the trap the file's own header describes — the
// coach adjusts what is on screen and assigns it, believing it to be theirs. So
// when the two disagree the screen must not stay silent about it either.
// `seedDecision` returns the sentence for that case, and it is the reason
// 'hold' is a decision rather than the absence of one.
//
// ── 2 · A TICK IS NOT A CLAIM ABOUT SOMEBODY WHO LEFT ──────────────────────
//
// `stillListed` and `pruneSelection` exist for a state the user photographed:
// the screen read "No clients yet — add a client from your dashboard" AND the
// primary button read "Injuries Could Not Be Read". Both came from a selected
// `clientId` that was no longer in the roster. `roster.find()` returned
// undefined, the builder's `disclosureStatus` mapped a missing client onto
// 'error', and the injury gate reported the disclosures of somebody who is not
// on the book as unreadable. The sentence was wrong about which thing had
// failed, and the coach was told to read injuries belonging to nobody.
//
// A selection is only pruned under a WHOLE read. Under 'loading', 'partial' or
// 'error' a name that is not on screen has not left the book — the read did not
// finish, or stopped at the row cap — and dropping the tick would silently
// remove somebody the coach chose. That is the same unknown-versus-none
// confusion as everywhere else in this codebase, and it is refused here in the
// same direction: keep what the coach said, and let the screen's own banner say
// the list is incomplete.
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/* ── what the builder may replace ──────────────────────────────────────────── */

/**
 * What to do with the builder's contents now that a client is selected.
 *
 *   'seed'  — fill it from what that client is currently on. Only ever when
 *             there is nothing in it to lose.
 *   'clear' — leave it empty. The client's programme could not be read, and an
 *             empty builder is the honest state for "we do not know".
 *   'hold'  — change nothing. The coach has work in progress and it is theirs.
 */
export type SeedAction = 'seed' | 'clear' | 'hold';

export interface SeedDecision {
  action: SeedAction;
  /** Sentence case prose for the coach, or null when nothing needs saying. */
  note: string | null;
  /** Title Case label for the control that discards the draft and loads what
   *  the client is really on, or null when there is nothing to offer — either
   *  because there is no disagreement or because their programme could not be
   *  read and so cannot be loaded. */
  replaceLabel: string | null;
}

const NOTHING_TO_SAY = (action: SeedAction): SeedDecision =>
  ({ action, note: null, replaceLabel: null });

/**
 * May the builder fill itself from `clientId`'s current programme?
 *
 * `hasDraft` is whether there is anything in the builder at all — a day, a
 * title, a note. `seededFor` is the client whose programme the contents were
 * last loaded FROM, or null when the contents are the coach's own composition
 * (typed from blank, or loaded from a template). It is compared rather than
 * trusted as "unedited": once contents are on screen this function will not
 * replace them either way, and `seededFor` only decides whether there is a
 * disagreement worth telling the coach about.
 */
export function seedDecision(o: {
  programStatus: LoadStatus;
  hasDraft: boolean;
  seededFor: string | null;
  clientId: string;
  /** As it is read back to the coach mid-sentence. */
  firstName: string;
}): SeedDecision {
  // No client picked. The builder is the coach's own scratch space and nothing
  // is being claimed about anybody, so there is nothing to say and nothing to
  // replace.
  if (!o.clientId) return NOTHING_TO_SAY('hold');

  if (o.hasDraft) {
    // Contents that were loaded from this same client. No disagreement, so no
    // sentence — and still no automatic replacement, because the coach may have
    // spent the last ten minutes editing them.
    if (o.seededFor === o.clientId) return NOTHING_TO_SAY('hold');

    if (o.programStatus === 'ready') {
      return {
        action: 'hold',
        note:
          `What is in the builder is your own work, so picking ${o.firstName} has not replaced it. `
          + `It is not what ${o.firstName} is currently training — load their programme if you would rather start from that.`,
        replaceLabel: `Load What ${o.firstName} Is On`,
      };
    }
    return {
      action: 'hold',
      note:
        `What is in the builder is your own work, and it has not been replaced. `
        + `What ${o.firstName} is currently training could not be read, so it cannot be loaded over the top of it either.`,
      replaceLabel: null,
    };
  }

  // Nothing to lose. Fill it, unless what they are on is unknown — in which
  // case an empty builder is the honest state and the screen's own guard notice
  // says why.
  return NOTHING_TO_SAY(o.programStatus === 'ready' ? 'seed' : 'clear');
}

/* ── who is still on the book ──────────────────────────────────────────────── */

/**
 * Is `id` a client this screen may still say things about?
 *
 * False ONLY under a whole read that does not contain them, which is the one
 * condition under which "they are not on your roster" is a fact. Under every
 * other status an absent id means the read did not finish or stopped at the row
 * cap, and treating that as a departure would drop a client the coach chose.
 *
 * An empty id is nobody, which is false rather than an error: callers use this
 * to decide whether to keep a selection, and "keep nobody selected" is not a
 * selection.
 */
export function stillListed(status: LoadStatus, available: readonly string[], id: string): boolean {
  if (!id) return false;
  if (status !== 'ready') return true;
  return available.includes(id);
}

/**
 * The ticks that still name somebody on the book, in the order they were given.
 *
 * Under anything but a whole read this returns the selection unchanged. See
 * `stillListed`.
 */
export function pruneSelection(
  status: LoadStatus,
  available: readonly string[],
  selected: readonly string[],
): string[] {
  if (status !== 'ready') return [...selected];
  const on = new Set(available);
  return selected.filter((id) => on.has(id));
}

/* ── what the assign button says ───────────────────────────────────────────── */

/** 's' unless there is exactly one of them. Four counts on the builder once
 *  read "1 exercises", and this string sits on the button that replaces
 *  somebody's training. */
const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The label on the control that fans a built programme out to the ticked
 * clients.
 *
 * The order of the branches is the order the coach hits them, and it matters:
 * a programme with no exercises in it cannot be assigned to anybody, so that is
 * said before "pick who gets this" rather than after it.
 *
 * `planLabel` is `planFanOut`'s refusal or partial label, and it is asked AFTER
 * the empty-selection case for the reason app/(trainer)/templates.tsx records
 * against the same call: with nobody ticked that function answers in the Groups
 * screen's vocabulary — "Nobody In This Group Yet" — and the builder has no
 * groups in it.
 */
export function assignCtaLabel(o: {
  busy: boolean;
  /** How many clients are ticked. */
  picked: number;
  /** What is in the programme. */
  exercises: number;
  /** `planFanOut`'s label, or null when it is happy for the button to carry its
   *  usual one. */
  planLabel: string | null;
  /** The one recipient's name, when there is exactly one. Null falls back to
   *  the count, which is never wrong, only less useful. */
  soleName: string | null;
}): string {
  if (o.busy) return 'Assigning…';
  if (o.exercises === 0) return 'Add an Exercise First';
  if (o.picked === 0) return 'Pick Who Gets This';
  if (o.planLabel) return o.planLabel;
  const size = ` · ${num(o.exercises)} exercise${s(o.exercises)}`;
  if (o.picked === 1 && o.soleName) return `Assign to ${o.soleName}${size}`;
  return `Assign to ${num(o.picked)} Clients${size}`;
}
