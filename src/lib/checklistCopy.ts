// Giving the same five habits to more than one client.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(trainer)/checklists.tsx sets a client's daily lines one client at a
// time. It has a chip picker, an add box, and no other path: no bulk, no
// template, no copy-to. But the five habits a coach gives one client are
// usually the five they give everybody — ten minutes of mobility before bed,
// protein at breakfast, a glass of water on waking — and typing them out again
// for the twelfth person is how a coach stops setting them at all.
//
// `BulkKind` in src/lib/bulkActions.ts had four members and checklists were not
// one of them. This module is the arithmetic behind the fifth.
//
// ── WHAT MAKES THIS DIFFERENT FROM THE OTHER FOUR BULK ACTIONS ────────────
//
// A bulk assign REPLACES a programme and `overwriteGuard` withholds the control
// until it can say who is about to be written over. A bulk message writes one
// row per thread and cannot be taken back. This one is neither: it ADDS rows,
// and the failure it can produce is duplication.
//
// A client whose list already says "Ten minutes of hip mobility before bed" and
// receives it a second time now has it twice, every morning, for ever — the
// coach cannot see it from this screen without selecting that client, and the
// client cannot remove it because coach-set lines are not theirs to remove.
// There is no undo beyond the coach deleting each duplicate by hand, and
// deleting a line takes the client's ticks for it with it (see `remove` on the
// screen). So a duplicate is not a cosmetic mistake here.
//
// Which makes the READ of what each target already has the load-bearing part,
// and `guardChecklistCopy` refuses the whole action on anything but a whole
// read of it. An empty list of existing labels means one of two things — this
// client has none of these lines, or we could not find out — and the two lead
// to opposite actions. Under 'error' the second is true and nothing may be
// written.
//
// ── Matching, and why it is deliberately blunt ────────────────────────────
//
// Labels are compared case-folded with their whitespace collapsed. That catches
// the case that actually happens (the same line typed twice, or copied twice)
// and misses the ones that do not matter enough to guess at: "Water on waking"
// and "Drink water when you wake up" are two lines to a matcher and two lines
// to a client reading them, and an app that decided they were one would silently
// drop a line the coach meant to send.
//
// Pure — no react, no supabase, no clock.
import { num } from './format';
import { listNames } from './groupProgram';
import type { LoadStatus } from '../ui/loadStatus';
import { worstStatus } from '../ui/loadStatus';

/** One line as it sits on the source client's list. */
export interface CopyLine {
  label: string;
  /** The emoji beside it, or '' where the coach set none. Carried across, since
   *  a line arriving without the icon the coach chose is a different line on
   *  the client's screen. */
  icon: string;
}

/** One client the lines are about to be copied to, as READ from the server. */
export interface CopyTarget {
  clientId: string;
  name: string;
  /**
   * Every label already on this client's list FROM THIS COACH, exactly as
   * stored. Empty is only ever an answer when the read behind it was whole —
   * see `guardChecklistCopy`, which is what the caller must pass first.
   */
  existing: readonly string[];
  /**
   * The largest `sort` currently on their list, or 0 when they have none.
   *
   * Carried so copied lines APPEND. The screen's own `add` explains why: the
   * order is the coach's, and a new line taking the top reshuffles a list the
   * client has been reading in the same shape every morning.
   */
  maxSort: number;
}

/** One insert, ready for the caller to write. */
export interface PlannedLine {
  label: string;
  icon: string;
  sort: number;
}

export interface TargetPlan {
  clientId: string;
  name: string;
  /** What would be written, in the source list's own order. */
  add: PlannedLine[];
  /** Labels skipped because this client already has them, in source order. */
  alreadyThere: string[];
}

export interface CopyPlan {
  targets: TargetPlan[];
  /** Total rows that would be written across everybody. */
  writes: number;
  /** Clients who would receive nothing, because they have all of it already. */
  unchanged: TargetPlan[];
  /** Clients who would receive at least one line. */
  changed: TargetPlan[];
}

/**
 * The comparison key for "they already have this line".
 *
 * Case-folded and whitespace-collapsed, and nothing cleverer. See the header:
 * the mistakes worth catching are a line typed twice and a line copied twice,
 * and every attempt to catch more than that ends up dropping a line the coach
 * deliberately worded differently.
 */
export function normaliseLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * What would happen, per client, if this copy went ahead.
 *
 * Computed for ALL targets including the ones that would receive nothing —
 * a plan that quietly dropped them would make the count on the button disagree
 * with the number of people the coach ticked, and the difference is the thing
 * they most need told.
 *
 * Duplicates WITHIN the source list are collapsed too. A coach who has the same
 * line on their own client's list twice — which the screen permits, since
 * nothing stops the same words being added again — must not have it copied
 * twice onto everybody else.
 */
export function planChecklistCopy(
  lines: readonly CopyLine[],
  targets: readonly CopyTarget[],
): CopyPlan {
  const wanted: CopyLine[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const key = normaliseLabel(l.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    wanted.push(l);
  }

  const plans: TargetPlan[] = targets.map((tgt) => {
    const have = new Set(tgt.existing.map(normaliseLabel));
    const add: PlannedLine[] = [];
    const alreadyThere: string[] = [];
    let sort = Number.isFinite(tgt.maxSort) ? tgt.maxSort : 0;
    for (const l of wanted) {
      if (have.has(normaliseLabel(l.label))) { alreadyThere.push(l.label); continue; }
      sort += 1;
      add.push({ label: l.label, icon: l.icon, sort });
    }
    return { clientId: tgt.clientId, name: tgt.name, add, alreadyThere };
  });

  return {
    targets: plans,
    writes: plans.reduce((n, p) => n + p.add.length, 0),
    unchanged: plans.filter((p) => p.add.length === 0),
    changed: plans.filter((p) => p.add.length > 0),
  };
}

/* ── may this run at all ───────────────────────────────────────────────────── */

export interface CopyGuard {
  /** True only when both reads behind the plan are whole. */
  allowed: boolean;
  /** What to put on the withheld control. Null when allowed. */
  label: string | null;
  /** Why, addressed to the coach. Null when allowed. */
  reason: string | null;
}

const COPY_OK: CopyGuard = { allowed: true, label: null, reason: null };

/**
 * Whether the copy may be offered, given how the two reads went.
 *
 * `rosterStatus` decides whether the list of people to tick is the whole list.
 * `existingStatus` decides whether "they do not have this line" is a fact or a
 * read that did not answer — and that one is the reason this guard exists.
 * Under 'error' every target's `existing` is empty, every line looks new, and
 * the copy would write the coach's five habits a second time onto the lists of
 * everybody who already had them. There is no undo for that beyond deleting
 * each duplicate by hand, which also deletes the client's ticks.
 *
 * 'partial' refuses for the same reason and not a weaker one: a page of
 * somebody's existing lines is not their list, and the line that did not come
 * back is precisely the one about to be duplicated.
 */
export function guardChecklistCopy(rosterStatus: LoadStatus, existingStatus: LoadStatus): CopyGuard {
  switch (worstStatus(rosterStatus, existingStatus)) {
    case 'ready':
      return COPY_OK;
    case 'loading':
      return {
        allowed: false,
        label: 'Reading Their Lists…',
        reason: 'Still reading what these clients already have. Copying now could put a line on somebody twice.',
      };
    case 'partial':
      return {
        allowed: false,
        label: 'Cannot copy over a part-read list',
        reason:
          'What these clients already have came back at its row limit, so a line past the point it stopped would '
          + 'look new and be added a second time. A duplicate sits on their list every morning and only you can '
          + 'remove it — and removing it takes their ticks for it with it.',
      };
    case 'error':
      return {
        allowed: false,
        label: 'Cannot copy over an unread list',
        reason:
          'What these clients already have could not be read. An empty list here means the read failed rather '
          + 'than that they have nothing, so every line would look new and everybody who already had one would '
          + 'get it twice.',
      };
  }
}

/* ── what the coach reads before it happens ────────────────────────────────── */

export interface CopyBrief {
  title: string;
  body: string;
  /** Title Case, carrying the number, like every other destructive-ish button
   *  in this app: a button that says only "Copy" is the sentence the coach
   *  remembers afterwards. */
  confirmLabel: string;
  /** False when there is nothing to write and the dialog is an explanation
   *  rather than a question. */
  actionable: boolean;
}

/**
 * The confirmation.
 *
 * Says three things, and the second is the one that is easy to leave out:
 *
 *   · how many lines land on how many people, which is the size of the act;
 *   · who gets NOTHING because they already have all of it — a coach who ticks
 *     twelve and sees "Added to 12" over a copy that actually touched seven has
 *     been told something false about the five;
 *   · that the client cannot remove any of it, which is what makes putting a
 *     line on somebody's morning different from sending them a message.
 */
export function copyBrief(plan: CopyPlan, sourceName: string): CopyBrief {
  const people = plan.targets.length;
  if (people === 0) {
    return {
      title: 'Nobody Selected',
      body: 'Nothing has been ticked, so there is nobody to copy these lines to.',
      confirmLabel: 'OK',
      actionable: false,
    };
  }
  if (plan.writes === 0) {
    return {
      title: 'They Already Have These',
      body: people === 1
        ? `${plan.targets[0].name} already has every one of these lines, so there is nothing to add.`
        : `All ${num(people)} of them already have every one of these lines, so there is nothing to add.`,
      confirmLabel: 'OK',
      actionable: false,
    };
  }

  const lines = plan.writes;
  const to = plan.changed.length;
  const skipNote = plan.unchanged.length
    ? `\n\n${listNames(plan.unchanged.map((p) => p.name))} `
      + `${plan.unchanged.length === 1 ? 'already has' : 'already have'} all of them and ${plan.unchanged.length === 1 ? 'gets' : 'get'} nothing.`
    : '';
  // Said only where it is true. Where nobody is skipped this sentence would be
  // a paragraph about an empty set.
  const partialNote = plan.changed.some((p) => p.alreadyThere.length)
    ? '\n\nLines somebody already has are left alone rather than added again.'
    : '';

  return {
    title: to === 1 ? 'Copy To One Client?' : `Copy To ${num(to)} Clients?`,
    body:
      `${num(lines)} ${lines === 1 ? 'line' : 'lines'} from ${sourceName}’s list ${lines === 1 ? 'goes' : 'go'} onto `
      + `${to === 1 ? 'one client’s' : `${num(to)} clients’`} daily list, marked as set by you.`
      + partialNote
      + skipNote
      + '\n\nThey cannot tick them off your list or take them off it — that stays with you. Adding a line is not '
      + 'a message: nobody is told, it simply appears on their list tomorrow morning.',
    confirmLabel: to === 1 ? 'Copy To Them' : `Copy To ${num(to)}`,
    actionable: true,
  };
}

/**
 * The one-line summary under the picker, before anything is confirmed.
 *
 * Null when there is nothing to say — no lines, or nobody ticked. A running
 * sentence rather than a number on its own, because "12" beside a tick list
 * does not say whether it counts people or lines, and here there are both.
 */
export function copyPreview(plan: CopyPlan): string | null {
  if (!plan.targets.length) return null;
  if (plan.writes === 0) {
    return plan.targets.length === 1
      ? `${plan.targets[0].name} already has every one of these lines.`
      : `All ${num(plan.targets.length)} of them already have every one of these lines.`;
  }
  const to = plan.changed.length;
  const skipped = plan.unchanged.length;
  return `${num(plan.writes)} ${plan.writes === 1 ? 'line' : 'lines'} onto ${num(to)} ${to === 1 ? 'client' : 'clients'}`
    + (skipped ? `, and nothing onto ${num(skipped)} who already ${skipped === 1 ? 'has' : 'have'} them all.` : '.');
}
