// Doing one thing to many clients at once, and being able to say afterwards
// exactly what happened to each of them.
//
// A coach with three clients does everything one at a time and never needs
// this. A coach with thirty cannot, and the moment the app gives them a control
// that acts on thirty rows it acquires three failure modes it did not have
// before. This module is the arithmetic for all three; it performs no writes
// and reads nothing, so a screen can ask it what would happen before anything
// does.
//
// ── 1 · A COUNT IS NOT CONSENT ─────────────────────────────────────────────
//
// "Assign to 12" is a number. It is not a description of what the tap does,
// because the expensive half of it is invisible: nine of those twelve are
// already training something a human wrote for them, assigning replaces it,
// there is no undo, no history row and nothing that tells the client their next
// session changed. src/lib/overwriteGuard.ts is the rule for whether the
// control may exist at all — it withholds rather than annotates, because a
// banner does not stop a thumb. This is the rule for what the control has to
// SAY once it is allowed to exist: how many of them are on something, and who
// they are. `overwriteBrief` writes that sentence.
//
// Naming them is the part that matters and the part that is easy to drop. A
// coach reading "9 of these 12 are on a programme now" still has to go and work
// out which nine; a coach reading "including Ana, Ben and Cara" recognises the
// name of the person they spent an hour writing a programme for on Tuesday, and
// stops. The count is the alarm; the names are what makes it actionable.
//
// ── 2 · PARTIAL FAILURE IS THE NORMAL CASE ─────────────────────────────────
//
// Twelve writes are twelve chances to be refused, and they are refused for
// ordinary reasons: a client added by hand has no `clients` row, so
// `is_my_client` is false and `assigned_programs_coach_rw` matches nothing; a
// relationship ended this morning; the phone lost signal after the fourth. The
// old reports said "8 of 12 saved" and stopped, which tells a coach that
// something is wrong and nothing about what to do — they cannot see which four,
// so the only recovery is to do all twelve again and hope.
//
// `bulkReport` therefore names both halves and hands back the ids of the ones
// that failed, so the caller can LEAVE THEM SELECTED. Retrying is then the same
// gesture as the first attempt, over exactly the set that still needs it.
//
// A single "Done" is never produced by this module, not even when everything
// landed: the successful report names the count and what the clients will see,
// because "Done" is the word that made the old fire-and-forget writes look
// identical to the working ones.
//
// ── 3 · "ALL" IS A CLAIM ABOUT ROWS NOBODY READ ────────────────────────────
//
// PostgREST stops at a thousand rows and says nothing (src/lib/rowCap.ts), so
// the providers carry 'partial': the people listed are real and there are more
// of them. A Select All over that list ticks a thousand people and calls it
// everybody. Nothing on the screen is false — the names are real, the count is
// the size of what is on screen — and the coach is nonetheless about to act on
// a set they cannot see, in the belief that they can.
//
// So under 'partial' the control does not become a warning and it does not go
// away. It stops claiming to be about everybody: `selectAllOffer` renames it to
// the number actually shown and says, in words, that there are more past it.
// Ticking a thousand named people is a true gesture; calling it "All" is not.
//
// Under 'loading' and 'error' there is no honest scoped version of the gesture,
// because there is no list — an empty roster under 'error' means the read
// failed, not that the coach has nobody — so the control is withheld and says
// which of the two it is.
//
// Individual ticks stay available under every status where a name is on screen.
// A tick is a claim about one person the coach can see and read; only the
// sweeping gesture claims anything about rows that never arrived.
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';
import { worstStatus } from '../ui/loadStatus';
import { listNames } from './groupProgram';

/* ── who is about to be written over ───────────────────────────────────────── */

/** One client a bulk assign is about to write to. */
export interface AssignTarget {
  clientId: string;
  /** As it will be read back to the coach — a first name is enough and is what
   *  the rest of the coach app uses in a sentence. */
  name: string;
  /**
   * True when this client is on a coach-assigned programme right now.
   *
   * A BOOLEAN and not a tri-state on purpose. There is no honest third value
   * here: "we could not tell" is not a property of one client, it is a property
   * of the read, and under anything but a whole read of `assigned_programs`
   * NOBODY's state is known — which is why `guardOverwrite` withholds the whole
   * control rather than letting a screen mark some rows and shrug at others.
   * A caller that has not passed that guard must not be building these at all.
   */
  onProgramme: boolean;
}

export interface OverwriteBrief {
  /** The dialog heading. */
  title: string;
  /** The body, in full sentences. */
  body: string;
  /** Title Case, and it carries the number, because a destructive button that
   *  says only "Assign" is the sentence the coach remembers afterwards. */
  confirmLabel: string;
  /** The clients whose current training this replaces. */
  replacing: AssignTarget[];
}

/**
 * How many names to write out before the sentence stops being readable.
 *
 * Six is a judgement, and it is written down rather than inlined because the
 * cost of getting it wrong is asymmetric: too few and the coach cannot tell
 * whether their Tuesday client is in the set, too many and they stop reading
 * the paragraph that was supposed to stop them. Past six the remainder is
 * COUNTED rather than elided — "and 4 more" — and the screen behind the dialog
 * marks every one of them individually, which is where a coach checks for a
 * specific person anyway.
 */
export const NAMES_IN_BRIEF = 6;

/**
 * Names for a sentence: all of them up to the limit, then an honest remainder.
 *
 * Never a bare truncation. "Ana, Ben, Cara" for a set of nine is a false
 * sentence, and it is false in the direction that makes the coach relax.
 */
export function namesWithRest(names: readonly string[], limit = NAMES_IN_BRIEF): string {
  if (names.length <= limit) return listNames(names);
  const rest = names.length - limit;
  return `${names.slice(0, limit).join(', ')} and ${num(rest)} more`;
}

/**
 * What the coach must read before a bulk assign writes anything.
 *
 * `templateName` is the programme going out, quoted back so the dialog is about
 * a specific thing rather than about the button that opened it.
 *
 * The two cases are genuinely different sentences and are not one sentence with
 * a number in it. When nothing is being replaced there is no alarm to raise and
 * raising one anyway teaches the coach to tap through this dialog — which is
 * the failure that ends with them tapping through the one that mattered.
 */
export function overwriteBrief(
  targets: readonly AssignTarget[],
  templateName: string,
): OverwriteBrief {
  const replacing = targets.filter((x) => x.onProgramme);
  const fresh = targets.filter((x) => !x.onProgramme);
  const n = targets.length;
  const r = replacing.length;

  if (r === 0) {
    return {
      title: n === 1 ? 'Assign This Programme?' : `Assign to ${num(n)} Clients?`,
      body:
        `${n === 1 ? 'This client is' : `None of these ${num(n)} are`} on a coach-assigned programme, so nothing is being replaced. `
        + `“${templateName}” will be waiting on ${n === 1 ? 'their Train tab' : 'each of their Train tabs'}.`,
      confirmLabel: n === 1 ? 'Assign' : `Assign to ${num(n)}`,
      replacing,
    };
  }

  const who = namesWithRest(replacing.map((x) => x.name));
  const heading = r === n
    ? (n === 1 ? 'Replace What They Are Training?' : `Replace What All ${num(n)} Are Training?`)
    : `Replace ${num(r)} Current Programmes?`;

  const lead = r === n
    ? (n === 1
      ? `${who} is on a programme now. Assigning “${templateName}” replaces it.`
      : `All ${num(n)} of these are on a programme now — ${who}. Assigning “${templateName}” replaces every one of them.`)
    : `${num(r)} of these ${num(n)} are on a programme now, including ${who}. Assigning “${templateName}” replaces what they are training.`;

  // Said every time, and not softened. This is the whole of why the dialog
  // exists: the write is silent from the client's side, so the coach is the
  // only person who will ever know it happened.
  const cost = 'There is no undo, no record of what was there before, and nothing tells them their next session changed.';

  const rest = fresh.length
    ? `\n\nThe other ${num(fresh.length)} — ${namesWithRest(fresh.map((x) => x.name))} — ${fresh.length === 1 ? 'is' : 'are'} on no coach-assigned programme, so for them this is new work rather than a replacement.`
    : '';

  return {
    title: heading,
    body: `${lead} ${cost}${rest}`,
    // Written in English at every size. Four counts on the builder once read
    // "1 exercises" for exactly this reason, and this one sits on the button
    // that replaces somebody's training.
    confirmLabel: r === n
      ? (n === 1 ? 'Replace Their Programme' : `Replace All ${num(n)}`)
      : `Replace ${num(r)} and Assign ${num(n)}`,
    replacing,
  };
}

/* ── what actually happened, per client ────────────────────────────────────── */

/** The outcome of ONE of the writes a bulk action fanned out into. */
export interface WriteOutcome {
  clientId: string;
  name: string;
  ok: boolean;
  /** Why not, in the coach's words. Null when it landed. Callers get this from
   *  src/lib/wroteRows.ts, which is the module that knows the difference
   *  between a refused write, a write that matched no rows, and a write nobody
   *  counted. */
  why: string | null;
}

/** What a bulk action was doing, which is the only thing the report's wording
 *  needs to differ on. */
export type BulkKind = 'assign' | 'message';

export interface BulkReport {
  title: string;
  body: string;
  /**
   * The clients to LEAVE SELECTED.
   *
   * Empty when everything landed. Otherwise exactly the ones that did not, so
   * that trying again is the same gesture over the set that still needs it —
   * rather than the coach re-ticking twelve names to reach the four they
   * cannot identify.
   */
  retry: string[];
}

/**
 * Up to this many failures are given their own line with their own reason.
 *
 * Past it the names are still all listed — a coach must be able to see who —
 * but the reasons collapse to the distinct ones, because forty identical
 * sentences is a wall nobody reads and the names are the part that is acted on.
 */
const REASONS_IN_REPORT = 6;

/**
 * What to tell the coach when the writes come back.
 *
 * Three outcomes, three different sentences, and none of them is "Done":
 *
 *   everything landed  — say what the clients will see, and how many.
 *   nothing landed     — say that nothing changed, which is the useful half:
 *                        a coach who thinks a failed bulk assign half-landed
 *                        has to go and check twelve people by hand.
 *   some landed        — name both halves. The successes so the coach knows
 *                        not to redo them, the failures so they know who.
 */
export function bulkReport(kind: BulkKind, results: readonly WriteOutcome[]): BulkReport {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const n = results.length;
  const retry = bad.map((r) => r.clientId);

  const landed = kind === 'assign'
    ? (c: number) => `${c === 1 ? 'It is' : 'They are'} on ${c === 1 ? 'their' : `${num(c)} clients’`} Train tab${c === 1 ? '' : 's'} now.`
    : (c: number) => `Your message is in ${c === 1 ? 'their thread' : `${num(c)} threads`} now.`;

  if (n === 0) {
    // Not reachable from a guarded caller, and written anyway: a report that
    // said "0 of 0 saved" would be the app claiming to have done something.
    return { title: 'Nobody Selected', body: 'Nothing was written, because nobody was ticked.', retry: [] };
  }

  if (!bad.length) {
    return {
      title: kind === 'assign' ? 'Assigned' : 'Sent',
      body: `${kind === 'assign' ? 'Assigned to' : 'Sent to'} ${num(n)} ${n === 1 ? 'client' : 'clients'} — ${namesWithRest(ok.map((r) => r.name))}. ${landed(n)}`,
      retry: [],
    };
  }

  const failureLines = bad.length <= REASONS_IN_REPORT
    ? bad.map((r) => `· ${r.name} — ${r.why ?? 'the server did not say why.'}`).join('\n')
    : `${listNames(bad.map((r) => r.name))}.\n\n${distinctReasons(bad)}`;

  if (!ok.length) {
    return {
      title: kind === 'assign' ? 'Not Assigned' : 'Not Sent',
      body:
        `${n === 1 ? 'The write' : `None of the ${num(n)} writes`} landed, so nothing has changed for ${n === 1 ? 'them' : 'any of them'}. `
        + `${n === 1 ? 'They are' : 'They are all'} still selected, so you can try again without finding ${n === 1 ? 'them' : 'them all'} again.\n\n`
        + failureLines,
      retry,
    };
  }

  return {
    title: kind === 'assign' ? 'Partly Assigned' : 'Partly Sent',
    body:
      `${num(ok.length)} of ${num(n)} landed — ${namesWithRest(ok.map((r) => r.name))}. ${landed(ok.length)}\n\n`
      + `${num(bad.length)} did not, and ${bad.length === 1 ? 'is' : 'are'} still selected so you can try again:\n\n`
      + failureLines,
    retry,
  };
}

/** The distinct reasons behind a long list of failures, so a wall of forty
 *  identical sentences becomes the one sentence it actually was. */
function distinctReasons(bad: readonly WriteOutcome[]): string {
  const seen: string[] = [];
  for (const r of bad) {
    const why = r.why ?? 'The server did not say why.';
    if (!seen.includes(why)) seen.push(why);
  }
  return seen.map((w) => `· ${w}`).join('\n');
}

/* ── selecting everybody, over a list that may be part of one ──────────────── */

export interface SelectAllOffer {
  /** Whether the gesture may be offered at all. */
  allowed: boolean;
  /** What goes on the control. Title Case, like every other button. */
  label: string;
  /** The sentence under it, or null when the plain gesture is honest. */
  note: string | null;
  /**
   * What ticking it would mean:
   *   'all'   — every client on the coach's book.
   *   'shown' — every client on this screen, and there are more past them.
   *   null    — nothing; the control is withheld.
   *
   * The caller does the same thing for 'all' and 'shown' (tick what is loaded)
   * — the difference is entirely in what the coach is told they just did, which
   * is the point.
   */
  scope: 'all' | 'shown' | null;
}

/**
 * The Select All control, given how the read of the list went.
 *
 * `shown` is how many rows are actually on screen, and is used in the label
 * under 'partial' so the gesture names its own size instead of borrowing the
 * word "all" from a set nobody read.
 */
export function selectAllOffer(status: LoadStatus, shown: number): SelectAllOffer {
  switch (status) {
    case 'ready':
      return { allowed: true, label: 'Select All', note: null, scope: 'all' };
    case 'partial':
      return {
        allowed: true,
        label: `Select the ${num(shown)} Shown`,
        note:
          `Your roster came back at its row limit, so this ticks the ${num(shown)} clients on this screen and not the ones past them. `
          + '“All” would be a claim about people this screen has never seen.',
        scope: 'shown',
      };
    case 'loading':
      return {
        allowed: false,
        label: 'Reading Your Roster…',
        note: 'Still reading who is on your book. Selecting now would tick whoever happens to have loaded.',
        scope: null,
      };
    case 'error':
      return {
        allowed: false,
        label: 'Roster Could Not Be Read',
        note: 'Your roster did not come back, so there is nothing here to select. An empty list under a failed read means the read failed, not that you have no clients.',
        scope: null,
      };
  }
}

/* ── who a message is about to go to ───────────────────────────────────────── */

export interface RecipientGuard {
  /** True only when the recipient list is the whole of what it claims to be. */
  allowed: boolean;
  /** What to put on the withheld control. Null when allowed. */
  label: string | null;
  /** Why it is withheld, addressed to the coach. Null when allowed. */
  reason: string | null;
}

const RECIPIENTS_OK: RecipientGuard = { allowed: true, label: null, reason: null };

/**
 * May this screen send to "everybody in `segment`"?
 *
 * The sibling of `guardOverwrite`, and it exists for the mirror-image reason. A
 * bulk message writes a real row into each client's thread from the coach's own
 * account — it is a send, not a draft — and the count in front of the coach is
 * the only thing standing between them and a message that went to two thirds of
 * the people they meant.
 *
 * A SEGMENT is a claim about a category: "all of my clients", "everyone tagged
 * bootcamp". Under 'partial' that claim is false in the direction that hides
 * the problem — the count on the button is the size of the page, not the size
 * of the segment, and the message reads as complete. Under 'error' there is no
 * list at all. Neither is a smaller version of what the coach asked for, so
 * both refuse rather than warn.
 *
 * `segmentStatus` is how the read that DEFINES the segment went, which is a
 * different read from the roster: with tags unread every `tagsFor()` comes back
 * empty and a chosen tag matches nobody, which renders identically to a tag
 * that genuinely has nobody in it. Callers with no such read — a hand-ticked
 * list of names — pass 'ready', because there is no read of the coach's own
 * thumb to have failed.
 */
export function guardRecipients(
  listStatus: LoadStatus,
  segmentStatus: LoadStatus,
  segment: string,
): RecipientGuard {
  switch (worstStatus(listStatus, segmentStatus)) {
    case 'ready':
      return RECIPIENTS_OK;
    case 'loading':
      return {
        allowed: false,
        label: 'Reading Who That Is…',
        reason: `Still reading who is in ${segment}. Sending now would reach whoever has loaded so far — this takes a moment.`,
      };
    case 'partial':
      return {
        allowed: false,
        label: 'Cannot send to part of a segment',
        reason:
          `Only part of ${segment} came back, so the number on this screen is the size of what loaded rather than the size of the segment. `
          + 'A message sent now would reach the people who happened to arrive and miss the rest, and nothing afterwards would say which was which.',
      };
    case 'error':
      return {
        allowed: false,
        label: 'Cannot send to an unread list',
        reason:
          `Who is in ${segment} could not be read. An empty list here means the read failed rather than that the segment is empty, `
          + 'so the send is held until it loads.',
      };
  }
}

/**
 * What the composer says above a message going to more than one person.
 *
 * ── The decision, and why it went this way ─────────────────────────────────
 *
 * The question is whether the same words sent to twenty people should SAY SO in
 * the thread — a "sent to 20 clients" line in the body, or a badge on the row.
 * Neither is done here, and the reason is the rule this codebase holds
 * absolutely: a message must never be composed under somebody else's name. It
 * is written out at length in src/lib/nudge.ts and in supabase/parts/140,
 * where the Quiet Clients feature drafts and refuses to send, and it was earned
 * — `messages.sender` once came from the caller's own request, so a client
 * could post into their own thread as 'coach'.
 *
 * Appending a sentence to the body puts words the coach did not write into a
 * message signed by the coach, and the client cannot tell which sentence came
 * from which of them. That is the same falsehood with better manners, and the
 * fact that the added sentence would be TRUE does not fix it — the client is
 * still reading their coach saying something their coach never said.
 *
 * A badge outside the body avoids that and fails differently: it needs a column
 * on `messages` that says "this was a bulk send", and the app cannot keep that
 * column honest. A coach who pastes the same words into twelve threads by hand
 * produces twelve identical unbadged messages, so an absent badge would come to
 * mean "written for you" — a claim nothing in the system can support, and one
 * the client would reasonably rely on. A broadcast object is refused for the
 * same reason and one further one: these are N real messages in N real threads
 * that the client can reply to and the coach can see in context, which is what
 * makes it a conversation rather than an announcement.
 *
 * So nothing is added to what goes out, and the honesty is moved to where it
 * can be acted on — in front of the coach, before they send. They are the only
 * person who can decide whether these words should say they went to everyone,
 * and they can type that themselves in the box below this sentence.
 */
export function bulkThreadNote(count: number): string | null {
  if (count < 2) return null;
  return `Each of these ${num(count)} people gets this as an ordinary message from you, in their own thread. `
    + 'Nothing marks it as having gone to anybody else, so it will read as though you wrote it to them — if you want it to say it went to everyone, say so in the message.';
}
