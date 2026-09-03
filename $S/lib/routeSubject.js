"use strict";
// Whose record a screen that never unmounts is showing.
//
// ── The bug ────────────────────────────────────────────────────────────────
//
// Every detail screen in `app/(trainer)` is registered inside `<Tabs>` with
// `href: null` (app/(trainer)/_layout.tsx). That keeps it out of the tab bar and
// reachable by navigation — and it also means the tab navigator MOUNTS IT ONCE
// and keeps it mounted for the life of the app. Backing out of it does not tear
// it down.
//
// Seven of those screens then did this:
//
//   const { clientId } = useLocalSearchParams<{ clientId?: string }>();
//   const [picked, setPicked] = useState<string | null>(clientId ?? null);
//
// A `useState` initialiser runs on the FIRST render of a component and never
// again. So the param seeds `picked` for the first client a coach opens the
// screen for, and every subsequent visit — with a different `clientId` in the
// route — renders the first one's record under the second one's intent.
//
// A coach opens Checklists for Amy, backs out, opens Checklists for Ben, and is
// looking at Amy's list. Nothing on the screen says whose it is at the moment
// they start typing, so the next line they add goes onto Amy's daily list. On
// the attendance screen it is a judgement about the wrong person. On
// client-report.tsx it is a document that gets sent.
//
// ── Why this is not `useEffect` ────────────────────────────────────────────
//
// An effect runs AFTER the render it belongs to has been committed, so the
// wrong person's record is painted for a frame before it corrects itself. On a
// report that is a real, if brief, misattribution, and it is avoidable: React's
// documented pattern for "adjust state when a prop changes" is to compare and
// set DURING render, which re-renders immediately without showing the stale
// value. `subjectChange` below is the comparison, so the screens hold two
// pieces of state (the subject, and the param it came from) and no effect.
//
// ── Why the param is not trusted to be a string ────────────────────────────
//
// `useLocalSearchParams<{ clientId?: string }>()` is a generic — the type
// argument is an assertion by the caller, not a check. expo-router hands back
// `string[]` for a repeated key (`?clientId=a&clientId=b`), and a route param
// is attacker-supplied by way of a deep link. A `string[]` flowing into
// `.eq('client_id', picked)` is a query built out of an array. `subjectOf`
// resolves the ambiguity in one place instead of at seven call sites: a
// repeated key names no ONE person, so it names nobody.
Object.defineProperty(exports, "__esModule", { value: true });
exports.subjectOf = subjectOf;
exports.subjectChange = subjectChange;
/**
 * The single subject a route param names, or null for "nobody named".
 *
 * Null, not undefined: `picked` is `string | null` on every screen that uses
 * this, and null is the value those screens already draw as their picker.
 */
function subjectOf(p) {
    if (typeof p !== 'string')
        return null; // absent, or a repeated key
    const s = p.trim();
    return s === '' ? null : s;
}
/**
 * What a stay-mounted screen should be showing, given the param it is being
 * rendered with and the param it was last rendered with.
 *
 * Returns null when nothing needs to change — which is the common case, and
 * lets a caller write `if (next) { ... }` during render without setting state
 * on every pass. A CHANGE is returned as `{ subject }` so that "change to
 * nobody" (opening the screen fresh from a menu, with no client in the route)
 * is expressible and distinct from "no change".
 *
 * The rule, stated once:
 *
 *   The route param wins whenever it MOVES. It does not win while it stands
 *   still, because between two renders with the same param the coach may have
 *   picked somebody else on the screen itself, and that pick is newer than the
 *   route.
 *
 * `seen` is the param of the previous render, so on the very first render the
 * caller seeds it from the same param and gets no change — the `useState`
 * initialiser has already done the seeding, correctly, that one time.
 */
function subjectChange(seen, now) {
    const before = subjectOf(seen);
    const after = subjectOf(now);
    return before === after ? null : { subject: after };
}
