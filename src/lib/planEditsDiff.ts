// The member's rewrite of their programme, as a DIFF against what the coach
// assigned — which is the one thing the member's own copy of this could not be.
//
// ── The half that shipped, and the half this is ───────────────────────────
//
// `client_plan_edits` holds every swap, removal, addition and corrected set a
// member makes to the programme they were given. src/lib/planEditsReadBack.ts
// reads it back TO THE MEMBER, and it deliberately does not name the movement:
// `swaps`, `exEdits` and `removed` are keyed `dayIdx:exerciseKey` where the key
// is a slug ('bench', 'ohp', 'rdl'), the member's screen does not hold the
// programme those slugs belong to, and printing a slug at somebody as though it
// were the name of an exercise is worse than saying nothing. So that module
// says the day and the kind of change, and stops.
//
// The COACH's screen is the one place in the product where that constraint does
// not apply. app/(trainer)/client-training.tsx already reads the assignment —
// it needs it for `planVsActual` — so every slug on it resolves to the movement
// the coach themselves wrote. The same three keys that could only be a day and
// a kind on the member's phone become a sentence here: you wrote Bench Press,
// they do Dumbbell Press instead.
//
// That is the whole reason this file exists rather than the coach's screen
// calling `planEditItems` and printing what the member sees. A coach reading
// "Day 1: they swapped a movement for another one" learns nothing they can act
// on. A coach reading "Mon · Push — you wrote Bench Press, they do Machine
// Chest Press" has next week's programme in front of them.
//
// ── One enumeration of the blob, not two ──────────────────────────────────
//
// Every row below comes out of `planEditItems`. Nothing here re-walks `swaps`,
// `exEdits`, `removed` or `custom`, and nothing here re-parses the stored bytes:
// `readPlanEdits` in src/lib/planEdits.ts is the only shape parser and
// src/ui/planEditsShared.ts is the only reader of the row, coach side and member
// side alike. Two enumerations of one jsonb blob is how the two copies would
// come to disagree about how many changes there are — the member told four and
// the coach shown three — and that disagreement would be invisible to both of
// them.
//
// What this adds is resolution: the stored key out of the item's id, the day and
// the movement out of the programme, and the coach's own figures beside the
// member's. `storedKeyOf` is the join, and `planEditsDiff.test.ts` asserts it
// round-trips for all four kinds so that a change to that id format fails here
// loudly rather than silently resolving nothing.
//
// ── What it refuses to say ────────────────────────────────────────────────
//
// 1. IT WILL NOT SAY WHICH WEEK. The stored key is `dayIdx:exerciseKey` and
//    `dayIdx` is an index into the days of whatever week the member's Train tab
//    was showing them (`uid()` in app/(client)/workouts.tsx). No week number is
//    stored. On a one-week block that is unambiguous; on a twelve-week block a
//    swap made in week six is indistinguishable from one made in week one, and
//    `KEY_HAS_NO_WEEK` is the sentence that says so rather than letting a coach
//    read a resolved movement name as a resolved week. This is the same class of
//    refusal src/lib/planVsActual.ts makes about named weekdays.
//
// 2. IT WILL NOT TREAT AN UNRESOLVED KEY AS A CHANGE TO NOTHING. A key naming a
//    movement the current assignment does not contain is the ordinary
//    consequence of the coach having rewritten the block since: the member's
//    correction is about the programme they were on. `resolved: false` says
//    which rows those are, and they are still listed, because "they have been
//    correcting the load on something for a month" is worth a coach's attention
//    even when the something has since been replaced.
//
// 3. IT WILL NOT CALL A FAILED READ AN UNCHANGED PROGRAMME. `state` carries
//    'unreadable' for exactly that, and `planEditsCoachNote` writes a different
//    sentence for it. See src/ui/loadStatus.ts: an empty list under anything but
//    'ready' is a silence, and the obvious thing a coach takes from "they have
//    changed nothing" is that the block is being followed as written.
//
// Kilograms stay kilograms. Every load below is the figure the programme and the
// blob hold, and the screen converts through `liftLabel` — the convention
// src/lib/planVsActual.ts states at `LoadCheck.plannedKg` and the reason a
// pounds coach's 225 has never been stored as 225 kg.
//
// Pure — no React, no Supabase, no clock. `nowMs` is passed in.
import type { ProgramDay, ProgramExercise } from './programs';
import type { PlanEdits } from './planEdits';
import { planEditItems, type PlanEditItem } from './planEditsReadBack';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/**
 * THE SENTENCE about the week, written once.
 *
 * Shown only where the block has more than one week, because on a single-week
 * block there is nothing to hedge and a caveat that is always on screen is
 * furniture rather than information. When this schema grows a week number on
 * the edit key there is one string to delete and one grep that finds every
 * screen that hedged.
 */
export const KEY_HAS_NO_WEEK =
  'A change is stored against a day of the block and not against a week of it, so on a multi-week '
  + 'block these are matched to the week their Train tab is showing them now. A change made in an '
  + 'earlier week lands on the same day of this one.';

/** Two figures for one thing: what the coach wrote, and what the member set. */
export interface NumberPair<T> {
  /**
   * The coach's own figure, out of the assignment. Null where the programme
   * names none, and null for every row the current assignment cannot resolve —
   * which is not the same as the coach having written nothing, and is why
   * `resolved` is on the row.
   */
  wrote: T | null;
  /** What the member set. Never null: a pair exists only where they set one. */
  theirs: T;
}

/** One change the member made, against the programme the coach assigned. */
export interface PlanEditDiffRow {
  /** `planEditItems`' own id, carried through unchanged so a list key here and
   *  a list key on the member's screen are the same string. */
  id: string;
  kind: PlanEditItem['kind'];
  /**
   * The day index the key carries, counted from ZERO — an index into the
   * programme week's `days`, which is what it was written as.
   *
   * `PlanEditItem.day` counts from one because it is printed. This does not,
   * because it is subscripted. The two are deliberately different types of
   * thing and keeping them the same number is how an off-by-one would name the
   * wrong movement in a coach's face.
   */
  dayIdx: number | null;
  /** 'Mon · Push', out of the programme. Null where there is no day to name —
   *  an added movement, or a day index the assignment does not have. Never a
   *  dash: a caller with no label gets a sentence written without one. */
  dayLabel: string | null;
  /** The exercise slug out of the stored key. Null for an added movement, which
   *  is held in a flat list with no key at all. Never shown. */
  slug: string | null;
  /** The movement AS THE COACH WROTE IT, resolved through the assignment. Null
   *  when the key resolves to nothing — see refusal 2. */
  assigned: string | null;
  /** The movement the member does instead, or the one they added. Null where the
   *  record holds no name for it: a removal names nothing, and neither does a
   *  corrected set. */
  theirs: string | null;
  /** Whether the assignment now on screen still contains this key. False is a
   *  fact about the programme, never about the member. */
  resolved: boolean;
  /** Sets, where the member set their own. Absent where they did not — which is
   *  the distinction `readPlanEdits` keeps and the reason these are null rather
   *  than zero. */
  sets: NumberPair<number> | null;
  /** Reps, as both sides wrote them: a range, '12', '45 sec'. */
  reps: NumberPair<string> | null;
  /** Load in KILOGRAMS. The screen converts. */
  loadKg: NumberPair<number> | null;
  /**
   * How many rows are in the member's own set-by-set table, or null where they
   * wrote none.
   *
   * A count and not the table. The coach's programme has no per-set equivalent
   * to compare it against — `ProgramExercise` carries one `sets` and one `reps`
   * for the whole movement — so printing the rows side by side would put a
   * column of dashes against a column of numbers and call it a comparison.
   * The count is the part that is a fact about both: a movement the coach wrote
   * as four sets that the member logs as six rows is a disagreement a coach can
   * act on.
   */
  tableRows: number | null;
}

export interface PlanEditsDiff {
  /**
   * 'ready'      both the edits and the assignment were read.
   * 'unmatched'  the edits were read; the assignment was not, or there is none.
   *              Rows are still listed and every one of them is `resolved:
   *              false`, because the day and the kind are real and only the
   *              names are missing.
   * 'unreadable' the edits could not be read, or were stored and would not
   *              parse. Rows are empty and MUST NOT be drawn as no changes.
   */
  state: 'ready' | 'unmatched' | 'unreadable';
  rows: PlanEditDiffRow[];
  /** Rows the current assignment accounts for. */
  resolvedCount: number;
  /** Rows it does not. Zero under 'unreadable', where it is not a count of
   *  anything. */
  strayCount: number;
}

/**
 * The stored key out of a `PlanEditItem`, or null for an added movement.
 *
 * This is the join between the member's enumeration of the blob and the coach's
 * programme, and it is derived rather than re-walked so that there is exactly
 * one place the blob is turned into a list. The ids are built in
 * `planEditItems` as `swap:<key>`, `numbers:<key>`, `removed:<key>` and
 * `custom:<index>`; none of the four prefixes contains a colon, so the key is
 * everything after the first one.
 *
 * `planEditsDiff.test.ts` asserts this against `planEditItems`' real output for
 * all four kinds. If that id format ever changes, the assertion fails — which
 * is the point. A silent failure here would resolve no names at all and the
 * screen would look like a client who had changed nothing recognisable.
 */
export function storedKeyOf(it: PlanEditItem): string | null {
  if (it.kind === 'custom') return null;
  const c = it.id.indexOf(':');
  if (c < 0) return null;
  const key = it.id.slice(c + 1);
  return key || null;
}

/**
 * The exercise slug out of a stored `dayIdx:exerciseKey`, or null.
 *
 * Everything after the FIRST colon of the key, so a slug that somehow contains
 * one survives intact rather than being truncated to its first segment — the
 * failure mode being a key that matches the wrong exercise rather than no
 * exercise, which is worse.
 */
export function slugOfKey(key: string | null): string | null {
  if (!key) return null;
  const c = key.indexOf(':');
  if (c < 0) return null;
  const slug = key.slice(c + 1);
  return slug || null;
}

/** The added movement behind a `custom:<index>` id, or null. Indexed rather
 *  than searched by name, because two movements added under the same name is a
 *  state the plan screen permits. */
function customOf(it: PlanEditItem, edits: PlanEdits): ProgramExercise | null {
  const c = it.id.indexOf(':');
  if (c < 0) return null;
  const tail = it.id.slice(c + 1);
  if (!/^\d+$/.test(tail)) return null;
  return edits.custom[Number(tail)] ?? null;
}

/** How a day of the programme reads: 'Mon · Push', or just 'Mon'. Null when
 *  the day names neither, so no caller prints a separator with nothing either
 *  side of it. */
function labelOfDay(d: ProgramDay | null | undefined): string | null {
  if (!d) return null;
  const day = (d.day || '').trim();
  const focus = (d.focus || '').trim();
  if (day && focus) return `${day} · ${focus}`;
  return day || focus || null;
}

/** A finite positive load, or null. A programme naming 0 kg has not prescribed
 *  a load, which is the same judgement `loadCheck` makes in planVsActual.ts. */
function loadOf(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The diff.
 *
 * `days` is the week of the block the client's own Train tab is showing them,
 * which app/(trainer)/client-training.tsx already resolves through
 * `clientWeek` for `planVsActual`. Null is "no programme to compare against"
 * and covers all three of its causes — none assigned, the read failed, and one
 * assigned by another coach that this coach's policy will not show — none of
 * which is a statement about the member.
 *
 * `editStatus` is the read of `client_plan_edits`, and `readable` is
 * `SharedPlanEdits.readable` — stored bytes that would not parse. Both fold
 * into 'unreadable', because neither is a member who changed nothing and the
 * screen says so in words either way.
 */
export function planEditsDiff(args: {
  edits: PlanEdits | null;
  editStatus: LoadStatus;
  readable: boolean;
  days: readonly ProgramDay[] | null;
}): PlanEditsDiff {
  const { edits, editStatus, readable, days } = args;
  // 'partial' is here with 'loading' and 'error' on purpose. It cannot arise on
  // a single-row read, and src/ui/loadStatus.ts forbids counting over a set
  // known to be a prefix — `resolvedCount` and `strayCount` are counts.
  if (!isWhole(editStatus) || !edits || !readable) {
    return { state: 'unreadable', rows: [], resolvedCount: 0, strayCount: 0 };
  }
  const items = planEditItems(edits);
  const rows: PlanEditDiffRow[] = items.map((it) => {
    const key = storedKeyOf(it);
    const slug = slugOfKey(key);
    // Zero-based, because it subscripts `days`. `it.day` is the printed number
    // and counts from one.
    const dayIdx = it.day == null ? null : it.day - 1;
    const day = days && dayIdx != null ? days[dayIdx] ?? null : null;
    const assignedEx = day && slug
      ? day.exercises.find((e) => e.key === slug) ?? null
      : null;
    const custom = it.kind === 'custom' ? customOf(it, edits) : null;
    const ed = key ? edits.exEdits[key] : undefined;
    const table = ed && Array.isArray(ed.setRows) && ed.setRows.length ? ed.setRows.length : null;
    // The three figure pairs, built once. An ADDED movement carries its own
    // sets, reps and load and has no coach's figure to sit beside them, so its
    // `wrote` is null throughout; a corrected movement takes only the fields
    // the member actually set, because an absent key in `exEdits` is the member
    // not having said and is not the same as them having said the coach's own
    // number back. The two sources are exclusive — a custom row has no key and
    // therefore no `exEdits` entry — and are written as one branch rather than
    // as a spread over the other, so neither can silently overwrite the other.
    let sets: NumberPair<number> | null = null;
    let reps: NumberPair<string> | null = null;
    let loadKg: NumberPair<number> | null = null;
    if (custom) {
      sets = { wrote: null, theirs: custom.sets };
      reps = { wrote: null, theirs: custom.reps };
      const cl = loadOf(custom.loadKg);
      loadKg = cl == null ? null : { wrote: null, theirs: cl };
    } else if (ed) {
      if (typeof ed.sets === 'number') sets = { wrote: assignedEx ? assignedEx.sets : null, theirs: ed.sets };
      if (typeof ed.reps === 'string') reps = { wrote: assignedEx ? assignedEx.reps : null, theirs: ed.reps };
      // `'loadKg' in ed` rather than a truth test: `loadKg: null` is the member
      // saying there is nothing on it, which is a change, and `loadKg` absent is
      // the member not having said. `readPlanEdits` keeps those apart and
      // collapsing them here would throw the distinction away one level up. A
      // member's explicit null becomes 0 — nothing on the bar — which is what
      // they said, and is why this pair's `theirs` is not itself nullable.
      if ('loadKg' in ed) {
        loadKg = { wrote: assignedEx ? loadOf(assignedEx.loadKg) : null, theirs: loadOf(ed.loadKg) ?? 0 };
      }
    }
    return {
      id: it.id,
      kind: it.kind,
      dayIdx,
      dayLabel: labelOfDay(day),
      slug,
      assigned: assignedEx ? assignedEx.name : null,
      // The swap and the addition are the two kinds whose STORED VALUE is a
      // name, which is what `planEditItems` already worked out; it is taken
      // from there rather than re-derived so the two screens name the same
      // movement. A removal and a corrected set name nothing and get null.
      theirs: it.kind === 'swap' || it.kind === 'custom' ? it.name : null,
      // A custom movement resolves against nothing by construction — it is the
      // member adding what the programme does not contain — so it is not
      // counted as a stray. Only a keyed change the assignment cannot find is.
      resolved: it.kind === 'custom' ? true : assignedEx != null,
      sets,
      reps,
      loadKg,
      tableRows: table,
    };
  });
  return {
    state: days ? 'ready' : 'unmatched',
    rows,
    // Under 'unmatched' nothing resolves and every keyed row is a stray, which
    // is true and is why the sentence for that state does not mention strays.
    resolvedCount: rows.filter((r) => r.resolved).length,
    strayCount: rows.filter((r) => !r.resolved).length,
  };
}

/**
 * One change, as a sentence in the COACH's voice.
 *
 * The member's own version of this line (`planEditItemLine`) is written in the
 * second person about their own plan. This one is written about somebody else's
 * and it names the movement, which is the entire difference between the two
 * screens. `who` is a first name and never a dash — the caller withholds the
 * section rather than passing a hole, for the reason scripts/check-prose.mjs
 * exists.
 *
 * `loadLabel` converts kilograms for printing and is required rather than
 * defaulted: a load printed in the wrong unit is a coach reading 220 to
 * somebody whose app said 100, and there is no safe fallback to pick here. It
 * may return null — `liftLabel` does, for a load it cannot render — and a
 * clause that would be built around a null is dropped rather than printed with
 * a hole in it.
 */
export function planEditDiffLine(
  r: PlanEditDiffRow,
  who: string,
  loadLabel: (kg: number | null) => string | null,
): string {
  const where = r.dayLabel ? `${r.dayLabel} — ` : '';
  if (r.kind === 'custom') {
    // No day and nothing of the coach's to compare it against: the member added
    // a movement the programme does not contain, which is the one kind whose
    // sentence is complete without resolving anything.
    return r.theirs
      ? `${who} added ${r.theirs}, which this programme does not contain.`
      : `${who} added a movement this programme does not contain.`;
  }
  if (r.kind === 'swap') {
    if (r.assigned && r.theirs) return `${where}you wrote ${r.assigned}; ${who} does ${r.theirs} instead.`;
    if (r.theirs) return `${where}${who} does ${r.theirs} instead of what this programme names here.`;
    if (r.assigned) return `${where}${who} swapped ${r.assigned} for something else.`;
    return `${where}${who} swapped a movement for another one.`;
  }
  if (r.kind === 'removed') {
    return r.assigned
      ? `${where}${who} has taken ${r.assigned} off.`
      : `${where}${who} has taken a movement off.`;
  }
  // 'numbers'. The clauses are built only from the fields the member actually
  // set, so a member who changed the load alone gets a sentence about the load
  // rather than one padded with the sets and reps they left alone.
  const parts: string[] = [];
  if (r.sets) {
    parts.push(r.sets.wrote != null
      ? `${r.sets.theirs} sets where you wrote ${r.sets.wrote}`
      : `${r.sets.theirs} sets of their own`);
  }
  if (r.reps) {
    parts.push(r.reps.wrote
      ? `${r.reps.theirs} reps where you wrote ${r.reps.wrote}`
      : `${r.reps.theirs} reps of their own`);
  }
  if (r.loadKg) {
    const theirs = loadLabel(r.loadKg.theirs);
    const wrote = r.loadKg.wrote == null ? null : loadLabel(r.loadKg.wrote);
    // Both labels read before either is used. A clause reading "where you
    // wrote" with nothing after it is the shape check-prose.mjs was written
    // for, so the clause degrades to the half that renders.
    if (theirs && wrote) parts.push(`${theirs} where you wrote ${wrote}`);
    else if (theirs) parts.push(`${theirs} of their own`);
  }
  const what = r.assigned ? `on ${r.assigned}` : 'on a movement';
  if (!parts.length) {
    // The member set something the shape does not describe — a set table alone,
    // or a field a future version writes. Saying that they changed the numbers
    // is true and is better than saying nothing, which would drop a row the
    // count above has already promised.
    return `${where}${who} set their own numbers ${what}.`;
  }
  return `${where}${who} does ${parts.join(', ')} ${what}.`;
}

/** How old the member's last change is, and whether that is old enough to say
 *  so out loud. */
export interface EditAge {
  /** Milliseconds since `updated_at`, or null where there is no readable stamp.
   *  Never negative: a clock that moved backwards between the write and the
   *  read is reported as no age rather than as a change from the future. */
  ageMs: number | null;
  /** True past `EDIT_STALE_MS`. False on a null age — "we do not know when" is
   *  not "it is old". */
  stale: boolean;
}

/**
 * Past this, the changes are old enough that their age matters more than their
 * content.
 *
 * Twenty-eight days, and the number is argued rather than picked: it is
 * `WINDOW_DAYS` in src/lib/planVsActual.ts and the longest block most coaches
 * on this platform write. A set of corrections last touched longer ago than the
 * block they were made against is very likely about a programme that has since
 * been rewritten, and a coach acting on it would be rewriting next week around
 * a complaint the member stopped making.
 */
export const EDIT_STALE_MS = 28 * 86_400_000;

/**
 * The age of the stored row.
 *
 * `updated_at` is a timestamptz — a full instant — so `Date.parse` is right
 * here and the house rule about bare `YYYY-MM-DD` strings does not apply: there
 * is no date to compare as a string and no midnight to guess a zone for.
 */
export function editAge(updatedAt: string | null | undefined, nowMs: number): EditAge {
  if (!updatedAt) return { ageMs: null, stale: false };
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return { ageMs: null, stale: false };
  const age = nowMs - ms;
  if (age < 0) return { ageMs: null, stale: false };
  return { ageMs: age, stale: age > EDIT_STALE_MS };
}

/**
 * The sentence above the rows.
 *
 * Six situations, and the two that must not collapse into each other are the
 * failed read and the member who changed nothing. A coach shown "they have
 * followed the programme as written" over a refused read reads it as a fact
 * about their client and writes next week's block on it.
 *
 * `whenWords` is `updated_at` in the READER's locale, already formatted,
 * because a locale belongs to the reader; `ageWords` is `agePhrase` in
 * src/lib/freshness.ts, which is elapsed time and needs no zone. Either may be
 * null and the sentence is written without it rather than around a hole.
 */
export function planEditsCoachNote(args: {
  diff: PlanEditsDiff;
  who: string;
  whenWords: string | null;
  ageWords: string | null;
  stale: boolean;
}): string {
  const { diff, who, whenWords, ageWords, stale } = args;
  if (diff.state === 'unreadable') {
    return `What ${who} has changed about this programme could not be read, so nothing here says they have `
      + 'followed it as written. Pull to refresh when you have signal.';
  }
  const n = diff.rows.length;
  if (n === 0) {
    return `${who} has not changed anything about the programme you assigned them.`;
  }
  const head = `${who} has changed ${n} thing${n === 1 ? '' : 's'} about the programme you assigned them`;
  if (diff.state === 'unmatched') {
    return `${head}. Their programme could not be read on this screen, so these say which day and what kind `
      + 'of change and cannot name the movement.';
  }
  const when = whenWords && ageWords
    ? `, last changed on ${whenWords} (${ageWords})`
    : whenWords ? `, last changed on ${whenWords}`
    : ageWords ? `, last changed ${ageWords}` : '';
  const stray = diff.strayCount
    ? ` ${diff.strayCount} of them ${diff.strayCount === 1 ? 'names a movement' : 'name movements'} this programme no longer `
      + 'contains, which is what happens when you rewrite a block they had already corrected.'
    : '';
  const old = stale
    ? ' That is longer ago than the block it was made against, so some of it may be about a programme you have since replaced.'
    : '';
  return `${head}${when}.${stray}${old}`;
}
