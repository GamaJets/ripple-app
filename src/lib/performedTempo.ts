// THE TEMPO A MEMBER ACTUALLY LIFTED AT — the other half of a prescription
// that has only ever had one.
//
// ── What was missing ──────────────────────────────────────────────────────
//
// src/lib/setIntensity.ts prescribes a tempo end to end: `readTempo` accepts
// every spelling a coach types, `tempoPhases` names the four numbers,
// `tempoMeaning` spells the whole thing out in words, and the builder, the
// plan rows, the set table and the guided runner all draw it. What no part of
// this app could do was RECORD one. A coach could ask for a four-second
// eccentric and the log could not say whether they got one, so the single
// number a tempo block exists to change was the number nobody wrote down.
//
// `workouts.tempos` (supabase/parts/3220) is where a performed tempo now
// lives: a parallel array, index-aligned to `sets`, exactly as `bw` and
// `timed` are, in the same order a prescribed tempo is stored in —
// eccentric · pause at the bottom · concentric · pause at the top.
//
// ── The two rules this file exists to hold ────────────────────────────────
//
// 1. ABSENCE IS NOT ZERO AND NOT A PRESCRIPTION MET. A set nobody recorded a
//    tempo for carries nothing. `recordedTempo` returns null for it, and
//    `tempoVerdict` reports 'unrecorded' — never 'met', never '0-0-0-0'. The
//    whole point of recording a tempo is that the prescription becomes
//    falsifiable, and a screen that renders silence as compliance un-falsifies
//    it more thoroughly than having no field at all.
//
// 2. A SHORT ARRAY MUST NOT MIS-ALIGN. `tempos` is jsonb and can hold whatever
//    a past or future build wrote — three entries against four sets, a number
//    where a string belongs, a string this build cannot parse. Every read goes
//    through `recordedTempo`, which answers null for all of those rather than
//    sliding set 4's tempo onto set 3.
//
// Nothing here invents a second notation. Both sides are canonicalised through
// `readTempo`, which is why "311" typed by a member and "3-1-1-0" written by
// their coach compare equal: they are the same instruction, and the canonical
// form is the one thing in this app allowed to decide that.
import type { WorkoutEntry } from './mockData';
import { readTempo, tempoMeaning } from './setIntensity';

/** The per-set list as it is stored: one entry per set, null where nobody
 *  recorded one. Holes are real — a member may confirm the tempo on their top
 *  set and say nothing about the warm-up. */
export type TempoLog = (string | null)[];

/**
 * The tempo recorded for set `i`, canonicalised, or null.
 *
 * Null covers every way this can be nothing: no column, a shorter array than
 * there are sets, an entry that is not a string, and a string this build
 * cannot read. All four mean the same thing to every caller — nobody recorded
 * a tempo for this set — and none of them may be rendered as a tempo of zero.
 */
export function recordedTempo(e: Pick<WorkoutEntry, 'tempos'>, i: number): string | null {
  const raw = e.tempos?.[i];
  if (typeof raw !== 'string') return null;
  const r = readTempo(raw);
  return r.ok ? r.tempo : null;
}

/**
 * The array to write, or undefined when nobody said anything.
 *
 * Undefined rather than a list of nulls, for the reason `bw` and `timed` give
 * on the entry itself: a session logged before this existed is not a session
 * of unrecorded tempos, it is a session nobody was asked about, and the two
 * must stay distinguishable. Unreadable entries are dropped to null rather
 * than stored, so nothing reaches the column that `recordedTempo` would refuse
 * to read back.
 */
export function packTempos(said: (string | null | undefined)[]): TempoLog | undefined {
  const out = said.map((s) => { const r = readTempo(s); return r.ok ? r.tempo : null; });
  return out.some((x) => x !== null) ? out : undefined;
}

export type TempoVerdict = {
  /**
   * 'none'       nothing asked for, nothing recorded — draw nothing.
   * 'unrecorded' asked for, no answer. NOT a failure and NOT compliance: it is
   *              silence, and it is the state every screen must be careful with.
   * 'met'        asked for and matched, once both are read in this app's order.
   * 'differed'   asked for, something else done. Both are named.
   * 'unasked'    recorded with nothing to compare it against.
   */
  state: 'none' | 'unrecorded' | 'met' | 'differed' | 'unasked';
  /** The sentence to draw. Null only under 'none'. */
  line: string | null;
};

/**
 * What a set's tempo says, given what was asked for and what came back.
 *
 * Every sentence names the notation AND spells it out, because `tempoMeaning`
 * is the whole defence against the minority convention that reads the four
 * digits concentric-first — a member shown only "3-1-1-0" cannot tell which
 * way round their coach meant it, and neither can the coach reading it back.
 */
export function tempoVerdict(prescribed: string | null | undefined, performed: string | null | undefined): TempoVerdict {
  const asked = readTempo(prescribed);
  const did = readTempo(performed);
  const askedT = asked.ok ? asked.tempo : null;
  const didT = did.ok ? did.tempo : null;
  if (!askedT && !didT) return { state: 'none', line: null };
  if (!askedT) return { state: 'unasked', line: `Tempo ${didT}: ${tempoMeaning(didT)}.` };
  if (!didT) return { state: 'unrecorded', line: `Tempo ${askedT} was asked for. No tempo was recorded for this set.` };
  if (askedT === didT) return { state: 'met', line: `Tempo ${askedT} as asked: ${tempoMeaning(askedT)}.` };
  return { state: 'differed', line: `Asked for ${askedT}, did ${didT}: ${tempoMeaning(didT)}.` };
}

/**
 * An entry's recorded tempos in one line, or null when it has none.
 *
 * Collapsed when every recorded set agrees, because "set 1 3-1-1-0 · set 2
 * 3-1-1-0 · set 3 3-1-1-0" is one fact said three times. It never claims the
 * sets it says nothing about: a line that reads "Tempo 3-1-1-0 on sets 2 and
 * 3" is the honest shape when sets 1 and 4 went unrecorded, and "every set" is
 * only said when every set really has one.
 */
export function tempoSummary(e: Pick<WorkoutEntry, 'sets' | 'tempos'>): string | null {
  const n = e.sets?.length ?? 0;
  const said: { set: number; tempo: string }[] = [];
  for (let i = 0; i < n; i++) {
    const tempo = recordedTempo(e, i);
    if (tempo) said.push({ set: i + 1, tempo });
  }
  if (!said.length) return null;
  const distinct = Array.from(new Set(said.map((s) => s.tempo)));
  if (distinct.length === 1) {
    const where = said.length === n ? 'every set' : setsPhrase(said.map((s) => s.set));
    return `Tempo ${distinct[0]} on ${where}: ${tempoMeaning(distinct[0])}.`;
  }
  return said.map((s) => `Set ${s.set} ${s.tempo}`).join(' · ');
}

/** "set 2", "sets 2 and 3", "sets 1, 3 and 4". */
function setsPhrase(nums: number[]): string {
  if (nums.length === 1) return `set ${nums[0]}`;
  const head = nums.slice(0, -1).join(', ');
  return `sets ${head} and ${nums[nums.length - 1]}`;
}
