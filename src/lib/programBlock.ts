/**
 * A PROGRAMME THAT LASTS MORE THAN A WEEK.
 *
 * ── What could not be written down ────────────────────────────────────────
 *
 * `Program` is `{ title, focus, note, days }` and `days` is seven entries at
 * most. Every coach on this platform sells a six-, eight- or twelve-week block
 * and the data model held one week of it. What they did instead was write week
 * one, assign it, and then — every Sunday night, on their phone — open the
 * builder and retype next week's loads over the top of it. That is not a
 * missing feature, it is a coach doing the app's job by hand fifty-two times a
 * year, and it destroys the record every time: `assigned_programs` is one row
 * per client and the overwrite is the whole of what happens to what came
 * before. (Which is the other half of this: see src/lib/programHistory.ts.)
 *
 * ── Why `days` is still week one and always will be ───────────────────────
 *
 * The interface is documented at length on `ProgramWeek` in src/lib/programs.ts
 * and the short version is that there are FOUR readers and this repo controls
 * three of them. `program_templates.program`, `assigned_programs.program` and
 * the coach's AsyncStorage draft are all jsonb-or-JSON blobs with no migration
 * that reaches all three — and the fourth reader is the CLIENT APP ALREADY ON
 * A PHONE, which draws `program.days` and has never heard of a week index. Move
 * the days and every un-updated handset shows an empty Train tab. That fourth
 * reader does not go away when the client app is updated: it is whatever build
 * somebody has not installed yet, and it renders `days`. So `days` is week one
 * for ever, and the current client app reads the block THROUGH this file — see
 * src/lib/clientBlock.ts and src/ui/clientWeek.ts.
 *
 * So: `days` is week one, `weeks` is the whole block including week one, and
 * this file is the ONE place that resolves the two or writes them together.
 * The invariant — `weeks[0].days` is `days` — is not expressible in TypeScript,
 * so it is held here and asserted in src/lib/programBlock.test.ts rather than
 * hoped for at forty call sites.
 *
 * ── What this file refuses to do ──────────────────────────────────────────
 *
 * It does not decide which week a client is standing in. That needs a start
 * date and a calendar and it is src/lib/programStart.ts's job, which is a
 * separate file precisely because it can only answer honestly some of the time
 * and this one always can.
 *
 * It does not progress loads from week to week. A "+2.5 kg each week" button is
 * the obvious next thing and it is not here: progression in this app is decided
 * against a client's OWN logged history — src/lib/progression.ts and
 * src/lib/builderProgression.ts — and a linear ramp written into weeks four
 * through eight in advance is a prescription made before the evidence for it
 * exists. `addWeek` copies the previous week unchanged and the coach edits it,
 * which is what a coach does.
 *
 * Pure and framework-free.
 */
import type { Program, ProgramDay, ProgramWeek } from './programs';

/**
 * The most weeks one programme may hold.
 *
 * Twelve, and it is a real limit rather than a shrug. Every one of these weeks
 * is stored in full — days, exercises, set rows — inside a single jsonb value
 * that is also written into every member of a group and into an AsyncStorage
 * draft that is serialised on every keystroke in the builder. A fifty-two week
 * block of five training days is around a megabyte of JSON being re-encoded as
 * a coach types a rep range, and the screen would stop responding long before
 * the database complained.
 *
 * Twelve covers the blocks coaches actually sell — a six week and a twelve week
 * are the two common shapes — and a coach running a longer plan writes it as
 * consecutive blocks, which is how they are periodised anyway.
 */
export const MAX_WEEKS = 12;

/**
 * Every week of a programme, week one first, for a programme of any age.
 *
 * This is THE reader. Nothing else in the app looks at `Program.weeks`.
 *
 * A programme with no `weeks` is a one-week programme — which is every
 * programme currently in `program_templates`, in `assigned_programs` and in
 * every coach's draft — and it comes back as a single week built from `days`.
 * That is not a compatibility shim, it is the truth: those programmes ARE one
 * week long and always were.
 *
 * A programme whose `weeks` is present but whose first week disagrees with
 * `days` is answered by `days`, and the disagreement is reported by
 * `weeksDisagree` rather than silently preferred. A jsonb column can hold
 * anything any build ever wrote, and the shipped client app renders `days` — so
 * where the two differ, `days` is what the client is actually training and a
 * coach's screen that showed them something else would be describing a week
 * nobody is doing.
 */
export function programWeeks(p: Program | null | undefined): ProgramWeek[] {
  if (!p) return [];
  const days = Array.isArray(p.days) ? p.days : [];
  const weeks = Array.isArray(p.weeks) ? p.weeks : null;
  if (!weeks || !weeks.length) return [{ days }];
  // Week one is `days`, whatever `weeks[0]` says its days are. The label, note
  // and deload flag on `weeks[0]` are kept — they are facts about week one that
  // `days` has nowhere to store, and they cannot contradict it.
  const first = weeks[0];
  const rest = weeks.slice(1).map((w) => ({ ...w, days: Array.isArray(w.days) ? w.days : [] }));
  return [{ ...first, days }, ...rest];
}

/**
 * Whether the stored `weeks[0].days` and `days` are the same week.
 *
 * Only ever false where something wrote one without the other, which nothing in
 * this app does — `withWeeks` is the only writer and writes both. It exists so
 * that a screen CAN say so if it ever happens, rather than the app quietly
 * choosing. Compared on the JSON rather than field by field: the question is
 * "is this the same week", and any difference at all in a day, an exercise or a
 * set row means the coach's screen and the client's phone would draw different
 * sessions.
 */
export function weeksDisagree(p: Program | null | undefined): boolean {
  if (!p || !Array.isArray(p.weeks) || !p.weeks.length) return false;
  try {
    return JSON.stringify(p.weeks[0]?.days ?? []) !== JSON.stringify(p.days ?? []);
  } catch {
    // A cyclic or unserialisable value cannot have come out of jsonb or
    // AsyncStorage, so this is unreachable from a stored programme. Answered as
    // "no disagreement to report" rather than thrown: a comparison that cannot
    // be made is not evidence of a mismatch, and throwing here would take down
    // a screen over a diagnostic.
    return false;
  }
}

/** How many weeks this programme is. One for every programme written before
 *  `weeks` existed, which is the honest answer for them. */
export function weekCount(p: Program | null | undefined): number {
  return programWeeks(p).length;
}

/** True when this programme is more than one week — the single test a screen
 *  uses to decide whether to draw a week strip at all. A one-week programme
 *  must look exactly as it did before, with no week number anywhere. */
export function isBlock(p: Program | null | undefined): boolean {
  return weekCount(p) > 1;
}

/**
 * What a week is called on screen.
 *
 * The coach's own label when they wrote one, and otherwise the position, which
 * is always true. `n` is 1-based because it is the number a person reads.
 *
 * A deload week is marked in the label rather than by a colour alone: colour is
 * never the only channel carrying meaning in this app, and a coach scanning
 * twelve chips needs to find the light week without decoding a tint.
 *
 * Takes the two fields it reads rather than a whole `ProgramWeek`, so the
 * builder's own week — which carries the draft keys and the unit the coach
 * typed in, and is not a stored programme — can be labelled without being
 * converted first. The same structural-parameter reasoning `SetSpec` in
 * src/lib/setRows.ts gives for exactly the same caller.
 */
export function weekLabel(w: { label?: string; deload?: boolean } | null | undefined, n: number): string {
  const own = (w?.label ?? '').trim();
  const base = own || `Week ${n}`;
  return w?.deload && !/deload/i.test(base) ? `${base} · Deload` : base;
}

/**
 * The one-line description of a block, in sentence case, for a note under a
 * programme's title.
 *
 * Deliberately says "week" for a one-week programme rather than staying silent,
 * where the caller asks for it — a coach who has just deleted week two should
 * see the count go to one rather than see the line vanish.
 */
export function blockLine(p: Program | null | undefined): string {
  const weeks = programWeeks(p);
  const n = weeks.length;
  const deloads = weeks.filter((w) => w.deload).length;
  if (n <= 1) return 'One week.';
  const d = deloads === 0 ? '' : deloads === 1 ? ', one of them a deload' : `, ${deloads} of them deloads`;
  return `${n} weeks${d}.`;
}

/**
 * Write a whole block back onto a programme, keeping `days` in step.
 *
 * THE ONLY WRITER. Every caller that changes the shape of a block goes through
 * here, and the reason is the invariant: `days` is what the shipped client app
 * renders, so a block written without updating it puts a coach's week four on
 * their own screen and week one on their client's phone, with nothing anywhere
 * saying which is which.
 *
 * An empty list is refused — it would produce a programme with no days at all,
 * which is not a lighter programme, it is a Train tab with nothing on it. The
 * programme is returned unchanged, which is the same shape `removeSetRow` uses
 * for its last row and for the same reason.
 *
 * A list longer than `MAX_WEEKS` is TRUNCATED rather than refused, and this is
 * the one place in this file that silently changes what it was given. It is
 * reachable only from `addWeek`, which checks the ceiling itself and does not
 * call with more; this is the belt behind that brace, and a programme that
 * arrived from a future build with thirty weeks in it is better rendered as
 * twelve than as a screen that will not open.
 *
 * `weeks` is dropped entirely when the block is one week long, so a coach who
 * deletes their second week leaves behind a programme byte-identical to one
 * that never had a second week. Otherwise every one-week programme edited after
 * today would carry a `weeks: [...]` that means nothing, and `programSignature`
 * in src/lib/groupProgram.ts would have to know the difference.
 */
export function withWeeks(p: Program, weeks: ProgramWeek[]): Program {
  if (!Array.isArray(weeks) || !weeks.length) return p;
  const kept = weeks.slice(0, MAX_WEEKS);
  const firstDays = Array.isArray(kept[0].days) ? kept[0].days : [];
  if (kept.length === 1) {
    // A one-week programme carries no `weeks` at all. `label`, `note` and
    // `deload` on that single week are dropped with it, and that is deliberate:
    // "Week 1 · Deload" is a statement about a block, and a programme that is
    // one week is not a block. Anything the coach wanted to say about it goes
    // in `Program.note`, which every reader already shows.
    const { weeks: _dropped, ...rest } = p;
    return { ...rest, days: firstDays };
  }
  return {
    ...p,
    days: firstDays,
    weeks: kept.map((w, i) => (i === 0 ? { ...w, days: firstDays } : w)),
  };
}

/**
 * Replace the days of one week.
 *
 * The builder edits one week at a time — that is what the week strip is for —
 * and this is how the edit lands. Week one's edit also moves `days`, which
 * `withWeeks` does; an edit to week four does not touch `days` at all, which is
 * correct and is the whole point. `days` is the copy every un-updated handset
 * renders, so it must go on being week one; a client on a current build is
 * shown week four by src/lib/clientBlock.ts, which reads the block rather than
 * `days`.
 *
 * An index outside the block changes nothing and returns the programme it was
 * given. No bounds guard of its own — `map` simply matches no week — for the
 * reason `removeSetRow` gives: a check that cannot be wrong is code a mutation
 * run can delete without an assertion noticing.
 */
export function setWeekDays(p: Program, at: number, days: ProgramDay[]): Program {
  const weeks = programWeeks(p);
  return withWeeks(p, weeks.map((w, i) => (i === at ? { ...w, days } : w)));
}

/** Change a week's label, note or deload flag without touching its days. */
export function patchWeek(p: Program, at: number, patch: Partial<Omit<ProgramWeek, 'days'>>): Program {
  const weeks = programWeeks(p);
  return withWeeks(p, weeks.map((w, i) => (i === at ? { ...w, ...patch } : w)));
}

/**
 * Add a week, at the end, COPYING the last one.
 *
 * A copy rather than a blank week, for the reason `addSetRow` gives about a
 * blank set: nobody adds week five in order to leave it empty. A coach writing
 * an eight week block writes week one and then changes eight things across
 * seven weeks, and an empty week five would make them retype the whole session
 * — at which point they would go on doing what they do today and retype it into
 * the assignment on a Sunday night instead.
 *
 * The copy is DEEP, through JSON, because a shallow one would share the day and
 * exercise objects with the week it came from and editing week five's bench
 * press would silently edit week four's. That is the single most damaging bug
 * this feature can have and it is invisible until a client reports that their
 * whole block changed.
 *
 * The label and note are NOT copied. "Accumulation" copied onto the deload is a
 * wrong label the coach never typed, and `weekLabel` falls back to the position,
 * which is right. The `deload` flag is not copied either, for the same reason:
 * a coach adding a week after a deload is not adding another deload.
 *
 * At the ceiling it returns the programme unchanged. The caller checks
 * `canAddWeek` and hides the control; this is what makes a stray second tap
 * harmless rather than a silent no-op the coach reads as a broken button.
 */
export function addWeek(p: Program): Program {
  const weeks = programWeeks(p);
  if (weeks.length >= MAX_WEEKS) return p;
  const last = weeks[weeks.length - 1];
  const copied: ProgramWeek = { days: deepCopyDays(last?.days ?? []) };
  return withWeeks(p, [...weeks, copied]);
}

/** Whether another week may be added. Read by the control, so the coach never
 *  taps a button that does nothing. */
export function canAddWeek(p: Program | null | undefined): boolean {
  return weekCount(p) < MAX_WEEKS;
}

/**
 * Remove a week.
 *
 * The LAST REMAINING week is not removable, exactly as the last set row is not:
 * a programme of no weeks is a Train tab with nothing on it, and the coach who
 * means that means "delete the programme", which is a different control with a
 * different confirmation.
 *
 * Removing WEEK ONE is allowed and it moves what the client trains — week two
 * becomes week one and `days` becomes its days. That is a real and immediate
 * change to somebody's next session, so the caller confirms it; this function
 * performs it faithfully rather than quietly refusing, because a coach who
 * scrapped their first week and cannot delete it has a worse problem.
 */
export function removeWeek(p: Program, at: number): Program {
  const weeks = programWeeks(p);
  if (weeks.length <= 1) return p;
  const next = weeks.filter((_, i) => i !== at);
  // `filter` matching nothing hands back the same length, and `withWeeks` then
  // rewrites the identical block — a no-op, which is the right answer for an
  // index off the end.
  return withWeeks(p, next);
}

/**
 * A structural copy of a week's days.
 *
 * Through JSON rather than a hand-written walk. The shape is `ProgramDay[]`
 * containing `ProgramExercise[]` containing `SetRow[]` and a hand-written clone
 * would have to be updated every time a field is added to any of the three —
 * and the failure mode of forgetting is a shared reference, which is invisible
 * until a coach edits week five and week four changes. Every value in this tree
 * came out of jsonb or JSON.parse, so it is JSON by construction and there is
 * nothing for a structured clone to preserve that this loses.
 *
 * `undefined` does not survive, which is exactly right: absence is what
 * round-trips through this app's three stores, and `setRows.ts` says so at
 * length. A key that was absent stays absent.
 */
function deepCopyDays(days: ProgramDay[]): ProgramDay[] {
  try {
    return JSON.parse(JSON.stringify(days ?? []));
  } catch {
    // Unreachable from stored data. A copy that cannot be made returns an empty
    // week rather than a shared reference: an empty week is visible and the
    // coach fills it in, and a shared reference silently rewrites the week they
    // copied from.
    return [];
  }
}

/**
 * A block's weeks folded into the signature line `programSignature` needs.
 *
 * Returns null — meaning "add nothing to the signature" — for a one-week
 * programme, so a programme with no `weeks` fingerprints EXACTLY as it did
 * before this file existed. That is load-bearing: `programSignature` decides
 * which members of a group are on the group's programme, and a signature that
 * changed shape for everybody would have reported every member of every group
 * as diverged on the morning this shipped.
 *
 * Week one is deliberately NOT included here — it is already the whole of what
 * the old signature covered, via `days` — so this is weeks two onward only.
 */
export function weeksSignaturePart(
  p: Program | null | undefined,
  weekSig: (days: ProgramDay[]) => string,
): string | null {
  const weeks = programWeeks(p);
  if (weeks.length <= 1) return null;
  return weeks.slice(1).map((w, i) => `${i + 2}:${w.deload ? 'd' : ''}${weekSig(w.days)}`).join('||');
}
