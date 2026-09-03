// Did every read this screen is showing actually come back?
//
// ── Why one screen needs one answer ───────────────────────────────────────
//
// `useFetched` (studio-web/components/Fetched.tsx) takes a reader that returns
// a boolean, and its header says exactly what the boolean means: "the screen is
// the only thing that knows whether what came back was everything it is
// showing", and "a refresh that failed leaves the stamp where it was, because
// the figures still on screen are the ones from the earlier read and moving the
// stamp would be the same lie one layer up."
//
// A console screen makes between two and eight reads at once. Six of them
// settle a `Promise.allSettled`; three of them hold `Slice<T>` from
// src/lib/memberView.ts; two hold both. So the boolean is assembled, by hand,
// at the bottom of every `load` — and hand-assembled booleans across seventeen
// screens is how the seventeenth ends up written `!== 'error'`, which is the
// single most repeated defect in this codebase (scripts/check-whole.mjs counts
// fourteen hand-fixes of it).
//
// This is that boolean, once.
//
// ── 'partial' lands. It does not make the figure whole ─────────────────────
//
// src/lib/readStamp.ts already settled this for the phone and the argument is
// quoted rather than reinvented:
//
//     'partial' counts as a landing. The server answered; the rows are real;
//     there are simply more of them. src/ui/loadStatus.ts already stops the
//     screen computing a total off it, and the age of what IS there is a true
//     and useful thing to say.
//
// The two questions are genuinely different and a stamp answers only the first:
//
//   · WHEN was this read?   — a landing, ready or partial.
//   · Is this ALL of it?    — `isWhole`, ready alone, and the section's own
//                             truncation banner is what says otherwise.
//
// Collapsing them the other way — refusing to stamp a partial read — sounds
// stricter and is worse in the one case it changes anything. A gym past the
// row cap is partial on every read it will ever make, so its stamp would read
// "this screen has not been read yet" for ever, over figures that were read
// four seconds ago. That is not caution, it is a false sentence, and it is the
// one direction src/lib/freshness.ts says a stamp must never err in.
//
// A read that FAILED is not a landing under any reading, and that is the whole
// of what these functions withhold the stamp for.

/**
 * The shape of a `Slice<T>` that this module needs, and nothing more.
 *
 * Structurally typed rather than imported so that a caller holding a
 * `Slice<Membership>`, a `Slice<GymPayment>` and a `Slice<GymVisit>` can put
 * all three in one array without the element type widening to something with
 * no `state` on it. `Slice<T>`'s four arms all carry `state`, and this is the
 * only field a landing is decided on.
 */
export interface StatedRead {
  state: 'loading' | 'ready' | 'partial' | 'failed';
}

/**
 * One slice: did the server answer it?
 *
 * 'loading' is not a landing either — it is a read still in flight, and a
 * screen that stamped on one would be dating figures that have not arrived.
 */
export const sliceLanded = (s: StatedRead): boolean =>
  s.state === 'ready' || s.state === 'partial';

/**
 * Every slice on the screen landed.
 *
 * True of an empty list, deliberately: a screen with nothing to read has
 * nothing outstanding, and the alternative — an empty array reading as a
 * failure — would freeze the stamp on exactly the screens that are quickest to
 * answer.
 */
export const slicesLanded = (slices: readonly StatedRead[]): boolean =>
  slices.every(sliceLanded);

/**
 * Every `Promise.allSettled` read on the screen came back.
 *
 * `allSettled` is what these screens use so that one failing read does not take
 * the others down with it — the page is allowed to be partial, but only if it
 * says which part. This is the sentence that says whether it WAS partial, in
 * the one place the stamp needs it.
 */
export const settledLanded = (results: readonly PromiseSettledResult<unknown>[]): boolean =>
  results.every((r) => r.status === 'fulfilled');
