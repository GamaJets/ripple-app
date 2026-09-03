'use client';

// The console's first paint, on every route.
//
// ── What was here ─────────────────────────────────────────────────────────
//
// Twenty-nine routes opened with this, byte for byte:
//
//     if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
//     if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;
//
// That div is the entire page. No rail, no gym name, no heading, no landmark,
// nothing announced and nothing to press. A screen-reader user who navigates to
// /payroll hears the document title and then silence — and if the page never
// resolves, no announcement of that either.
//
// And it could not resolve. `loadMe` opens with `supabase.auth.getUser()`, a
// network call, and thirty of the thirty-one callers awaited it outside any
// `try`: one rejection and `me` stayed `undefined` for ever. Nine characters,
// permanently, with no way to tell whether the gym was down, you were signed
// out, or the tab was broken.
//
// ── Four states, and they are four different sentences ────────────────────
//
//   still reading   we are asking who you are. Say so, and announce it.
//   nobody          you are not signed in. A link to sign in.
//   unreadable      we could not ask. NOT the same as being signed out — see
//                   ME_UNREADABLE in lib/supabase.ts — and the one that needs a
//                   retry, because the answer may well be different in a
//                   second and re-entering a password would not help.
//   a person        no gate; the screen renders.
//
// Loading, failed and signed-out are three different sentences, which is the
// rule this console states on forty screens and did not follow on its own first
// paint.
//
// ── Why `failed` is a separate prop and not a fourth value of `me` ───────
//
// `loadMe` answers ME_UNREADABLE, and widening every screen's `me` state to
// carry it would push that string through `me?.tenantId` at some seventy sites
// that are perfectly correct as they are. The screens keep `Me | null |
// undefined`, the unreadable answer leaves `me` UNDEFINED — which is honest,
// nobody said who this is — and a boolean beside it says which of the two
// undefineds this is. `if (!me) return <ConsoleGate …/>` then narrows `me` to
// `Me` for the rest of the component, which is what the two lines it replaced
// were doing.
import type { Me } from '@/lib/supabase';
import type { Unread } from '@/lib/read';
import { signInHref } from '@lib/consoleNext';

/**
 * Where the reader is, as a thing sign-in can be asked to come back to.
 *
 * Read off `location` at render rather than through `useSearchParams`, which
 * under Next 15 forces the whole page into a Suspense boundary for one string —
 * the same trade /members already makes for `?member=`. Guarded because Next
 * also renders this component on the server, where `location` does not exist:
 * there it answers null, `signInHref` gives the bare `/` this link has always
 * been, and the first client render replaces it. A destination is a
 * convenience, and nothing here may throw to protect one.
 */
function hereNow(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return `${window.location.pathname}${window.location.search}`;
  } catch {
    return null;
  }
}

/**
 * The page to show instead of this screen.
 *
 * `failed` is the difference between "still asking" and "could not ask". It is
 * only ever true while `me` is undefined: once a person is known, the screen
 * renders and this component is not reached.
 *
 * `onRetry` is what the unreadable state offers. Optional — a screen with none
 * gets a page reload, which throws nothing away here because the screen has
 * never rendered a form to throw away.
 */
export function ConsoleGate({ me, failed = false, onRetry }: {
  me: Me | null | undefined;
  failed?: boolean;
  onRetry?: () => void;
}): React.ReactElement {
  if (me === undefined && !failed) {
    return (
      <main id="main" style={page}>
        {/* Polite: it is the first thing on the page and it is not a failure. */}
        <p role="status" aria-live="polite" aria-atomic="true" style={{ margin: 0, color: 'var(--ink3)' }}>
          Reading your account…
        </p>
      </main>
    );
  }

  if (me === null) {
    return (
      <main id="main" style={page}>
        <h1 style={heading}>You are not signed in</h1>
        <p style={body}>
          This console is your gym&rsquo;s. Sign in and it will open on the screen you asked for.
        </p>
        {/* And now it does. This was `<a href="/">`, carrying nothing, under
            that exact sentence — so every deep link into the console became the
            Overview after a session lapsed, on all thirty gated routes. The one
            that made it a dead end rather than an annoyance is /retention's
            `/members?member=<uuid>`: a person cannot retype a uuid, so the
            member they were sent to look at was simply unreachable.

            `signInHref` refuses anything that is not a path on this origin, so
            a `?next=` written into a link by somebody else cannot make this
            console a hop to a login form that is not ours. */}
        <p style={{ marginTop: 14 }}><a href={signInHref(hereNow())}>Sign in</a></p>
      </main>
    );
  }

  // `failed` — the auth call did not come back.
  return (
    <main id="main" style={page}>
      {/* Assertive: nothing on this page is going to appear, and the reader has
          to know that rather than wait. */}
      <div role="alert" aria-live="assertive" aria-atomic="true">
        <h1 style={heading}>We could not reach your gym</h1>
        <p style={body}>
          Asking who you are needs a connection and that request did not come back. This is not
          you being signed out and it is not your gym being empty &mdash; it is a question this
          console could not ask. Nothing has changed and nothing has been lost.
        </p>
      </div>
      <p style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={() => { if (onRetry) onRetry(); else window.location.reload(); }}
          style={{
            background: 'none', border: '1px solid var(--ring)', padding: '7px 13px',
            font: 'inherit', color: 'var(--ink)', cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </p>
    </main>
  );
}

const page: React.CSSProperties = { padding: 40, maxWidth: '62ch' };
const heading: React.CSSProperties = { margin: 0, fontSize: 20, color: 'var(--ink)' };
const body: React.CSSProperties = { marginTop: 10, color: 'var(--ink2)', fontSize: 13.5, lineHeight: 1.55 };

/**
 * A section of a screen that has not come back yet.
 *
 * Thirteen page files declared this, byte for byte, as a plain `<div>`:
 *
 *     function Loading() {
 *       return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
 *     }
 *
 * A sighted reader sees a panel with a word in it where a table will be. A
 * screen-reader user gets nothing: the text is inserted after the announcement
 * of the page, in no live region, so there is no event to announce — and when
 * the table finally arrives, no event either. Silence, then silence.
 *
 * `role="status"` on a node that is mounted for the whole of the wait is the
 * whole fix. Polite, never assertive: a section still loading is not a failure
 * and must not interrupt somebody reading the section above it.
 */
export function Loading({ what }: { what?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: '26px 20px', color: 'var(--ink3)' }}
    >
      {what ? `Reading ${what}…` : 'Loading…'}
    </div>
  );
}

/**
 * What stands in for a table whose rows are not known — loading, or refused.
 *
 * ── Why this is here and not seven times over ─────────────────────────────
 *
 * `function Unresolved({ state, what })` was declared, byte for byte, at the
 * bottom of /coach, /coach/earnings, /coach/roster, /classes, /equipment,
 * /door and /payroll, and every one of them was a plain `<div>`. That is the
 * same shape the thirteen copies of `Loading` above had, with the same
 * consequence and one more: this node also carries the sentence saying a read
 * was REFUSED, and a screen-reader user got the section's silence for the wait
 * and then silence again when the wait ended in a failure. The banner at the
 * top of the page says why, assertively — but nothing said that THIS section is
 * the one that has no rows, which is the only thing the sentence is for.
 *
 * `role="status"` and polite, exactly as `Loading` above: the node is mounted
 * from first paint and stays for the whole of the wait, so the change from
 * "Loading…" to "Could not read the roster" is a change to an existing region,
 * which is the one shape every reader announces. Polite rather than assertive
 * because the crit `Banner` carrying the database's own sentence has already
 * interrupted; a second assertive region saying the same failure twice is how
 * people turn a screen reader off.
 *
 * The two sentences are never merged and never share a wording. Loading, failed
 * and empty are three facts, and the third one belongs to the table's own
 * `empty` prop rather than here — this component is only ever rendered when the
 * rows are NOT known.
 */
export function Unresolved({ state, what, style }: {
  state: Exclude<Unread, null>;
  what: string;
  /** Merged over the base, for the one screen that draws this at 13px. */
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{ padding: '26px 20px', color: 'var(--ink3)', ...style }}
    >
      {state === 'loading' ? 'Loading…' : `Could not read ${what}. The banner above says why.`}
    </div>
  );
}
