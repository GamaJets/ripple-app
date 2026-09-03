"use strict";
// What a console form last said, and whether it is saying something failed.
//
// ── Why a type and not a string ────────────────────────────────────────────
//
// studio-web/components/Banner.tsx makes one distinction and rests everything
// on it: `crit` interrupts a screen reader mid-sentence and is reserved for
// "this did not happen" — a refused write, a failed read, money not moved.
// Everything else waits its turn, because a console that shouted every "Saved"
// is a console people turn the screen reader off to use.
//
// Half the console's forms cannot make that distinction. They hold a single
// `const [msg, setMsg] = useState<string | null>(null)` and put both outcomes
// in it:
//
//   setMsg('Saved.');
//   setMsg(x?.message ?? 'That grant was refused, so nothing changed.');
//
// A live region fed from that string has no way to choose a tone, and the two
// wrong answers are both bad in the same direction: mark it all polite and the
// refusal waits behind whatever else the page is saying, mark it all assertive
// and every save interrupts. Neither is recoverable at the render site, because
// by then the only thing left is the words — and matching on the words is how
// you end up announcing "That was not saved" politely because it happens to
// start with a capital T.
//
// So the fact travels with the sentence. `wrote()` and `refused()` are the two
// constructors, they are named after what they assert rather than after a
// colour, and the setter's call site is the one place that knows which is true.
//
// ── Where the line falls ───────────────────────────────────────────────────
//
// `refused` is not only for a thrown write. A blocker that stops the form
// before it reaches the database — "Pick a pass.", "Say who the pass is for" —
// is also "this did not happen", and it is the case a member of staff is most
// likely to hit and least likely to see, because they have already looked away
// from the form and towards the person in front of them.
//
// The awkward case is the door's offline queue: the arrival is genuinely kept,
// on that machine, and goes up on its own. It is `refused` here anyway. The
// gym's record does not have it yet, the desk needs to know that before it
// walks away from the browser, and the sentence itself is a departure from the
// normal path rather than a confirmation of it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrote = wrote;
exports.refused = refused;
exports.sayText = sayText;
exports.sayTone = sayTone;
/** Something happened and this says what. Announced politely. */
function wrote(text) {
    return { text, bad: false };
}
/**
 * Something did NOT happen and this says so. Announced assertively.
 *
 * Takes `string | null | undefined` because almost every call site is
 * `refused(e?.message ?? 'the fallback')` and the fallback belongs here rather
 * than repeated at each one.
 */
function refused(text, fallback) {
    const t = (text ?? '').trim() || (fallback ?? '').trim();
    return t ? { text: t, bad: true } : null;
}
/** The words, for a live region. Null when the form has not said anything. */
function sayText(s) {
    return s ? s.text : null;
}
/**
 * The tone for `Announce`/`Banner`. `undefined` rather than `'ok'` because that
 * is what those components take for the polite case, and inventing a third tone
 * here would mean a mapping step at every call site that could get it wrong.
 */
function sayTone(s) {
    return s && s.bad ? 'crit' : undefined;
}
