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
//
// ── 4 · AND ONE ACTION WHERE ALL THREE ARE AT THEIR WORST ──────────────────
//
// `endCoachingBrief` is at the bottom of this file, and it is the reason the
// three rules above are rules rather than habits. Ending the coaching for forty
// dormant rows is forty irreversible acts behind one tap: a hand-added client's
// row is DELETED, a linked client's shared progress photos are un-shared for
// good (part 47 deletes the grants), and every one of the forty is a separate
// server call that can be refused on its own. So the count is on the button,
// the two costs are described separately because they fall on two different
// populations, and the report is the same `bulkReport` — which cannot say
// "Done" over a partial failure because it does not have that sentence.
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

/**
 * What the coach must read before taking clients OFF their programmes.
 *
 * ── Why this is not `overwriteBrief` with a different verb ────────────────
 *
 * Asked for as "assign and un-assign templates meanwhile keeping the data for
 * the history of the workouts done in those templates so you can add it back in
 * at a later stage" — and the second half of that sentence is a FEAR, not a
 * feature request. A coach who believes un-assigning might take their client's
 * training record with it will never press the button, which is its own kind of
 * broken; and one who half-believes it will press it and then spend an evening
 * checking. Either way the sentence they need is the one that settles it.
 *
 * It is settled, and checked rather than assumed: NO foreign key anywhere in
 * this database points at `assigned_programs` or `program_templates`, and
 * `workouts` is keyed by `user_id` and `performed_at` with no reference to a
 * plan at all. Verified live against phgfwzpkkwdysftlgkoq by reading
 * `pg_constraint` for every FK whose target is either table: there are none, so
 * nothing can cascade from either. Re-assigning the template later therefore
 * needs nothing special to "add it back" — the history was never gone.
 *
 * The clients passed here are only the ones ON a programme. Somebody who is
 * already on their auto plan has nothing to be taken off, and including them
 * would make the count wrong in the direction that raises a false alarm.
 */
export function unassignBrief(targets: readonly AssignTarget[]): OverwriteBrief {
  const on = targets.filter((x) => x.onProgramme);
  const n = on.length;
  const who = namesWithRest(on.map((x) => x.name));

  if (n === 0) {
    return {
      title: 'Nobody To Take Off',
      body: 'None of the clients you have ticked is on a coach-assigned programme, so there is nothing to remove. They are already on an auto-generated plan.',
      confirmLabel: 'OK',
      replacing: [],
    };
  }

  return {
    title: n === 1 ? 'Take Them Off This Programme?' : `Take ${num(n)} Clients Off Their Programmes?`,
    body:
      `${who} ${n === 1 ? 'goes' : 'go'} back to an auto-generated plan built from ${n === 1 ? 'their' : 'their own'} goal. `
      + `Every session ${n === 1 ? 'they have' : 'they have'} already logged stays exactly where it is — a programme is a plan, and the sets somebody did are their record, not the plan's. `
      + `Put the same programme back later and that history is still underneath it.`,
    confirmLabel: n === 1 ? 'Take Them Off' : `Take ${num(n)} Off`,
    replacing: on,
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

/**
 * What a bulk action was doing, which is the only thing the report's wording
 * needs to differ on.
 *
 * 'checklist' is copying a coach's daily lines onto other clients' lists —
 * src/lib/checklistCopy.ts does the planning and the guard, this file reports
 * the fan-out. It is here rather than as its own reporter because the three
 * failure modes in this file's header are identical for it: N writes, refused
 * one at a time for ordinary reasons, and a coach who is told "8 of 12" and
 * nothing else has to work out which four by opening twelve clients.
 */
export type BulkKind = 'assign' | 'unassign' | 'message' | 'end' | 'checklist';

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
    // Said every time, because it is the fact a coach is most likely to be
    // wrong about and the one that decides whether they ever use the control.
    // Nothing in this database points at `assigned_programs`, so a client's
    // logged sets cannot be reached by removing a plan — see the header of
    // `clearProgramFrom` in src/ui/assignedPrograms.tsx.
    : kind === 'unassign'
    ? (c: number) => `${c === 1 ? 'They are' : `All ${num(c)} are`} back on an auto-generated plan. Every session ${c === 1 ? 'they have' : 'they have'} logged is untouched.`
    // Said in the past tense and about the OTHER person, because that is the
    // half a coach cannot see afterwards: the roster on their screen is already
    // shorter, and what they have no way of checking is that the client's own
    // account is intact and that the client has been told.
    : kind === 'end'
    ? (c: number) => `${c === 1 ? 'They are' : `All ${num(c)} are`} off your roster, and anyone with an account has been told the coaching ended. They keep everything they logged; anyone you had added by hand is deleted along with the name and goal you typed.`
    // Says WHEN, because nothing is sent and nobody is told: a coach who
    // expects a notification to have gone out will follow up on a conversation
    // that never happened. The lines simply appear on the list tomorrow.
    : kind === 'checklist'
    ? (c: number) => `The lines are on ${c === 1 ? 'their' : `${num(c)} clients’`} daily list from tomorrow morning, marked as set by you. Nobody was notified, and only you can take them off again.`
    : (c: number) => `Your message is in ${c === 1 ? 'their thread' : `${num(c)} threads`} now.`;

  if (n === 0) {
    // Not reachable from a guarded caller, and written anyway: a report that
    // said "0 of 0 saved" would be the app claiming to have done something.
    return { title: 'Nobody Selected', body: 'Nothing was written, because nobody was ticked.', retry: [] };
  }

  const verbTitle = kind === 'assign' ? 'Assigned' : kind === 'unassign' ? 'Taken Off' : kind === 'end' ? 'Removed' : kind === 'checklist' ? 'Copied' : 'Sent';
  const verbBody = kind === 'assign' ? 'Assigned to' : kind === 'unassign' ? 'Took the programme off' : kind === 'end' ? 'Removed' : kind === 'checklist' ? 'Copied to' : 'Sent to';

  if (!bad.length) {
    return {
      title: verbTitle,
      body: `${verbBody} ${num(n)} ${n === 1 ? 'client' : 'clients'} — ${namesWithRest(ok.map((r) => r.name))}. ${landed(n)}`,
      retry: [],
    };
  }

  const failureLines = bad.length <= REASONS_IN_REPORT
    ? bad.map((r) => `· ${r.name} — ${r.why ?? 'the server did not say why.'}`).join('\n')
    : `${listNames(bad.map((r) => r.name))}.\n\n${distinctReasons(bad)}`;

  if (!ok.length) {
    return {
      title: kind === 'assign' ? 'Not Assigned' : kind === 'unassign' ? 'Not Taken Off' : kind === 'end' ? 'Nobody Was Removed' : kind === 'checklist' ? 'Nothing Was Copied' : 'Not Sent',
      body:
        `${n === 1 ? 'The write' : `None of the ${num(n)} writes`} landed, so nothing has changed for ${n === 1 ? 'them' : 'any of them'}. `
        + `${n === 1 ? 'They are' : 'They are all'} still selected, so you can try again without finding ${n === 1 ? 'them' : 'them all'} again.\n\n`
        + failureLines,
      retry,
    };
  }

  return {
    title: kind === 'assign' ? 'Partly Assigned' : kind === 'unassign' ? 'Partly Taken Off' : kind === 'end' ? 'Partly Removed' : kind === 'checklist' ? 'Partly Copied' : 'Partly Sent',
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

/* ── ending the coaching for many people at once ───────────────────────────── */

/**
 * One client a bulk end-coaching is about to act on.
 *
 * `handAdded` is the only field beyond a name, and it is not decoration: the
 * two kinds of client are removed by two different writes with two different
 * costs, and a dialog that describes one of them describes the wrong thing for
 * half the set.
 *
 *   handAdded  a `coach_clients` row — a name and a goal the coach typed, with
 *              no account behind it. Removing it DELETES that row. Nothing is
 *              recoverable and nobody is notified, because there is nobody to
 *              notify.
 *   linked     a real person with an account. `end_coaching()` ends the
 *              relationship and leaves everything of theirs where it is; they
 *              are notified (part 159) and can re-join with the coach's code.
 *              One thing does not come back: every progress photo they shared
 *              is un-shared for good — part 47 deletes the grants rather than
 *              flagging them, and re-joining does not hand them back.
 */
export interface EndTarget {
  clientId: string;
  name: string;
  handAdded: boolean;
}

/**
 * What the coach must read before ending the coaching for a set of people.
 *
 * ── Why this is not `unassignBrief` with a different verb ─────────────────
 *
 * Un-assigning a programme is recoverable in every respect and the brief spends
 * its words saying so. This is the opposite: it is many irreversible acts
 * behind one tap, and the brief's whole job is to make the SIZE of that visible
 * before it happens. So the count is in the heading, in the body and on the
 * button, and the two costs are named separately because they fall on two
 * different populations.
 *
 * Names are written out, capped by `namesWithRest`, for the reason
 * `overwriteBrief` gives: a coach reading "40 clients" cannot tell whether the
 * one person they did not mean to include is in there, and a coach reading
 * "including Ana, Ben and Cara" recognises the name and stops.
 *
 * There is deliberately no reason picker here. `end_coaching_with_reason` takes
 * ONE reason for ONE relationship (part 200), and a reason applied to forty
 * endings at once would be a belief recorded as forty separate pieces of
 * evidence — `end_reason_by` would attribute every one of them to the coach,
 * which is honest, but the churn report would then read as forty people who
 * left for the same stated cause. So a bulk ending records no reason, which is
 * exactly what the one-argument `end_coaching()` has always done, and the
 * Unexplained Departures card goes on asking about each of them individually.
 */
export function endCoachingBrief(targets: readonly EndTarget[]): OverwriteBrief {
  const n = targets.length;
  if (n === 0) {
    return {
      title: 'Nobody Selected',
      body: 'Nothing has been ticked, so there is nobody to remove.',
      confirmLabel: 'OK',
      replacing: [],
    };
  }

  const hand = targets.filter((x) => x.handAdded);
  const linked = targets.filter((x) => !x.handAdded);
  const who = namesWithRest(targets.map((x) => x.name));

  const lead = n === 1
    ? `${who} comes off your roster.`
    : `All ${num(n)} of these come off your roster — ${who}.`;

  // Said for the linked half only, because it is the only half it is true of,
  // and said in full: the photo grant is the one part of this that re-joining
  // does not undo, and it is the reason the single-client version of this
  // dialog exists at all.
  const linkedCost = linked.length
    ? `${linked.length === n ? (n === 1 ? 'They keep' : 'They all keep') : `${num(linked.length)} of them keep`} their account and everything logged in it, and ${linked.length === 1 ? 'they are' : 'they are each'} told the coaching has ended. `
      + `You stop seeing ${linked.length === 1 ? 'their' : 'their'} workouts, measurements, check-ins and food logs, and your thread ${linked.length === 1 ? 'with them closes' : 'with each of them closes'}. `
      + `Every progress photo ${linked.length === 1 ? 'they' : 'they'} shared is un-shared straight away and that part cannot be undone — joining you again later does not hand the photos back.`
    : '';

  // And for the hand-added half, which is a delete rather than an ending.
  const handCost = hand.length
    ? `${hand.length === n ? (n === 1 ? 'This one is' : `All ${num(n)} are`) : `${num(hand.length)} of them — ${namesWithRest(hand.map((x) => x.name))} — are`} clients you added by hand, with no account behind them. `
      + `Removing ${hand.length === 1 ? 'that row deletes it' : 'those rows deletes them'}, along with the name and goal you typed. There is no undo and nothing to re-join.`
    : '';

  const parts = [lead, linkedCost, handCost].filter(Boolean);

  return {
    title: n === 1 ? 'Remove This Client?' : `Remove ${num(n)} Clients?`,
    body: parts.join('\n\n'),
    // The number is on the button. A destructive button reading only "Remove"
    // is the sentence the coach remembers afterwards, and this one can be
    // forty people.
    confirmLabel: n === 1 ? 'Remove Them' : `Remove All ${num(n)}`,
    // Everybody, because every one of them loses something. `replacing` is what
    // the caller styles the button destructive on.
    replacing: targets.map((x) => ({ clientId: x.clientId, name: x.name, onProgramme: false })),
  };
}
