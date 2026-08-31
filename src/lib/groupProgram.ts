// One programme, several clients — and the refusals that go with sending it.
//
// ── Why a group owns the list and not the plan ─────────────────────────────
//
// The full argument is in supabase/parts/134-a-programme-written-once.sql,
// where the tables are. The short of it: `assigned_programs` stays the one
// place that says what any client is training, an assign to a group is a
// FAN-OUT of that same row per member, and this file is the arithmetic that
// makes the fan-out honest — which of them is on it, which is on something
// else, and which of them must not be written to at all.
//
// Everything here is pure. It takes statuses and rows and returns sentences;
// it performs no writes, so a screen can ask it what would happen before
// anything does.
//
// ── The rule this file exists to enforce ───────────────────────────────────
//
// A bulk assign is the place where a per-client check gets skipped, because
// asking eleven times is awkward and asking once is not. The injury gate is
// exactly such a check — a coach may not build a programme around disclosures
// they have not read — and it is per client by construction: it is about what
// ONE person's shoulder cannot do. So the fan-out consults it once per member
// and SPLITS the list. The ten who are clear are assigned; the one who is not
// is named, with their own reason, and the button says "Assign to 10 of 11"
// rather than "Assigned". Nobody is silently skipped and nobody is silently
// included.
import type { Program } from './programs';
import type { Injury } from './injuries';
import type { LoadStatus } from '../ui/loadStatus';
import { guardOverwrite } from './overwriteGuard';
import { guardInjuries } from './injuryGate';

/** Where one member stands against the group's programme.
 *
 *   'unknown'  — what they are on could not be read. NOT 'none': that is the
 *                confusion this whole codebase keeps paying for.
 *   'none'     — they are on no coach-assigned programme at all.
 *   'on'       — they are training the group's programme.
 *   'diverged' — they are on a coach-assigned programme that is not it. The
 *                client with the shoulder, two days later, is this.
 */
export type MemberState = 'unknown' | 'none' | 'on' | 'diverged';

/**
 * A stable fingerprint of what a programme actually asks somebody to DO.
 *
 * Days, their focus and cardio, and each exercise's name, sets and reps —
 * deliberately not `note`, `focus[]`, `alternatives` or the exercise `key`.
 * Those are rewritten in transit: the builder stamps its own `focus` and
 * blanks `alternatives` on every assign, and keys are regenerated as
 * `${day}-${index}`. Comparing them would report a client as being on
 * something different from the group when the sessions in front of them are
 * identical, which is a false alarm on the one screen whose job is to tell the
 * coach who is off-plan.
 *
 * The corollary is worth stating: two programmes with the same sessions and
 * different prose read as the same programme here. That is the intended
 * reading of "is Priya on the bootcamp programme".
 *
 * Null in, null out — a group that has not been given a programme has no
 * fingerprint, rather than the fingerprint of an empty one.
 */
export function programSignature(p: Program | null | undefined): string | null {
  if (!p) return null;
  const days = (p.days ?? []).map((d) => [
    d.day,
    (d.focus ?? '').trim().toLowerCase(),
    (d.cardio ?? '').trim().toLowerCase(),
    (d.exercises ?? []).map((e) =>
      `${(e.name ?? '').trim().toLowerCase()}|${e.sets}|${(e.reps ?? '').trim().toLowerCase()}`,
    ).join(','),
  ].join('~')).join('//');
  return `${(p.title ?? '').trim().toLowerCase()}::${days}`;
}

/**
 * Where one member stands, given how the read of `assigned_programs` went.
 *
 * `programStatus` is asked FIRST and answers for everything. Under anything
 * but a whole read, a null programme means "we did not find out" — so a member
 * is 'unknown', never 'none'. Rendering them as "not assigned yet" is how a
 * coach comes to assign over a programme they never saw.
 *
 * When the group itself has no programme (`groupSig` null) there is nothing to
 * be on, so a member with a programme is 'diverged' — on something that is not
 * the group's — and a member without one is 'none'. Both are true sentences.
 */
export function memberState(
  programStatus: LoadStatus,
  groupSig: string | null,
  assigned: Program | null | undefined,
): MemberState {
  if (programStatus !== 'ready') return 'unknown';
  const sig = programSignature(assigned);
  if (sig === null) return 'none';
  if (groupSig !== null && sig === groupSig) return 'on';
  return 'diverged';
}

export interface GroupCoverage {
  on: number; diverged: number; none: number; unknown: number; total: number;
  /** Whether these numbers may be shown to the coach as the size of anything.
   *  False unless BOTH reads behind them were whole: a count over a membership
   *  list that came back short is not how many people are in the group, and a
   *  count over an unread `assigned_programs` is not how many of them have it.
   */
  countable: boolean;
}

/** The at-a-glance line: who has it and who does not. */
export function groupCoverage(
  states: readonly MemberState[],
  membershipStatus: LoadStatus,
  programStatus: LoadStatus,
): GroupCoverage {
  const c: GroupCoverage = {
    on: 0, diverged: 0, none: 0, unknown: 0, total: states.length,
    countable: membershipStatus === 'ready' && programStatus === 'ready',
  };
  for (const s of states) c[s] += 1;
  return c;
}

/** One member as the fan-out needs to see them. */
export interface FanOutMember {
  clientId: string;
  /** As it will be read back to the coach in a refusal. */
  name: string;
  /** How the read of THIS client's own disclosures went. A member the roster
   *  never produced is 'error' here, not an empty injury list. */
  disclosures: LoadStatus;
  /** How the read of the acknowledgements went. */
  ackStatus: LoadStatus;
  injuries: Injury[];
  acknowledged: string[] | null;
}

/** A member this assign will NOT write to, and the sentence that says why. */
export interface FanOutBlock {
  clientId: string; name: string; label: string; reason: string;
}

export interface FanOutPlan {
  /** True only when at least one client may be written to right now. */
  allowed: boolean;
  /** What to put on the control. Null when it may carry its usual label —
   *  which is only when every member is going to be assigned. */
  label: string | null;
  /** Why NOTHING may be sent. Null whenever `allowed` is true. */
  reason: string | null;
  /** Said when the assign may go ahead but not to everybody. Null otherwise.
   *  Separate from `reason` so a caller never renders a refusal over an assign
   *  that is about to happen. */
  heldNote: string | null;
  /** The clients this assign may write to, in the order they were given. */
  send: string[];
  /** Every member not in `send`, each with their own reason. Together with
   *  `send` this covers the membership exactly — a member cannot fall out of
   *  both, which is the silent skip this function exists to prevent. */
  blocked: FanOutBlock[];
}

const NOTHING = (label: string, reason: string): FanOutPlan =>
  ({ allowed: false, label, reason, heldNote: null, send: [], blocked: [] });

/**
 * What would happen if the coach tapped Assign right now.
 *
 * `listStatus` is how the read of the LIST OF PEOPLE went. For a group that is
 * the membership read, and it is load-bearing: a group whose membership came
 * back short is not a smaller group, and assigning to the four names that
 * arrived out of eight leaves four people on last month's programme with
 * nothing anywhere saying so. For a hand-made tick-list — the bulk assign in
 * the template library — the coach chose the names themselves and there is no
 * read of the list to have failed, so the caller passes 'ready'.
 *
 * `programStatus` is how the read of `assigned_programs` went, and goes to the
 * overwrite guard: this writes over whatever each of them is currently on.
 */
export function planFanOut(
  listStatus: LoadStatus,
  programStatus: LoadStatus,
  members: readonly FanOutMember[],
  hasProgram: boolean,
  subject: string,
): FanOutPlan {
  // Asked before anything else, because every question below is asked ABOUT
  // this list. A short or unread list makes the per-client checks below
  // meaningless: they would all pass, for the people who happened to arrive.
  if (listStatus === 'loading') {
    return NOTHING('Checking Who Is In This Group…', 'Still reading who is in this group. Assigning now could reach only the people who have loaded so far.');
  }
  if (listStatus === 'partial') {
    return NOTHING('Cannot assign to part of a group', 'Only part of this group came back, so this screen cannot tell you who is in it. Assigning would send the programme to the people who happened to load and leave the rest on what they are on, with nothing saying which was which.');
  }
  if (listStatus === 'error') {
    return NOTHING('Cannot assign to an unread group', 'Who is in this group could not be read. An empty list here means the read failed, not that the group is empty, so the assign is held until it loads.');
  }

  // Writing over somebody's training without having read it is the thing the
  // overwrite guard exists for, and one tap here is as many overwrites as
  // there are members.
  const over = guardOverwrite(programStatus, subject);
  if (!over.allowed) return NOTHING(over.label as string, over.reason as string);

  if (!hasProgram) {
    return NOTHING('Pick a Programme First', 'This group has no programme yet. Choose one from your library and it can go out to everybody in the group at once.');
  }
  if (!members.length) {
    return NOTHING('Nobody In This Group Yet', 'Add the clients who should be on this programme, then assign it to all of them at once.');
  }

  const send: string[] = [];
  const blocked: FanOutBlock[] = [];
  for (const m of members) {
    // Per client, every time. The whole hazard of a bulk assign is that this
    // is the check somebody moves outside the loop.
    const gate = guardInjuries(m.disclosures, m.ackStatus, m.injuries, m.acknowledged, m.name);
    if (gate.allowed) send.push(m.clientId);
    else blocked.push({ clientId: m.clientId, name: m.name, label: gate.label as string, reason: gate.reason as string });
  }

  if (!send.length) {
    return {
      allowed: false,
      label: blocked.length === 1 ? (blocked[0].label) : 'Read Their Injuries First',
      reason: blocked.length === 1
        ? blocked[0].reason
        : `Every client in this group is held: ${listNames(blocked.map((b) => b.name))}. Open each of them and read what they have disclosed, then this can go out.`,
      heldNote: null,
      send: [],
      blocked,
    };
  }

  return {
    allowed: true,
    label: blocked.length ? `Assign to ${send.length} of ${members.length}` : null,
    reason: null,
    heldNote: blocked.length
      ? `${listNames(blocked.map((b) => b.name))} ${blocked.length === 1 ? 'is' : 'are'} held and will NOT be assigned — they have disclosed injuries this screen cannot confirm you have read. Everyone else gets it now; open them individually when you have.`
      : null,
    send,
    blocked,
  };
}

/** "Priya", "Priya and Sam", "Priya, Sam and Alex" — never a bare join, because
 *  the coach is being told who is about to be left out. */
export function listNames(names: readonly string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The noun phrase the overwrite guard puts in its sentence. Written here so
 *  the group screen and the template library say the same thing. */
export function fanOutSubject(count: number): string {
  return count === 1
    ? 'the programme this client is currently on'
    : 'the programmes these clients are currently on';
}
