'use client';

// The sentence the console says back to you.
//
// ── Why this is a component and not nineteen copies ───────────────────────
//
// `function Banner({ children, tone })` was declared, byte for byte, at the
// bottom of nineteen page files. That is not a style problem. This console's
// whole design argument is that it SAYS what happened rather than letting a
// silence be read as success — "saved", "the sweep released 4 passes", "the
// write was refused and nothing was saved" — and every one of those sentences
// landed in a plain `<div>`. `grep -rn 'aria-live\|role="alert"\|role="status"'
// over studio-web returned nothing at all.
//
// For a member of staff using a screen reader that made every one of those
// sentences a silence, including the ones saying a write did NOT happen. They
// press Save, hear nothing, and have no way to tell "saved" from "refused"
// apart from re-reading the form.
//
// ── Why the region is always mounted ──────────────────────────────────────
//
// A banner appears when there is something to say and is gone otherwise, so
// the node carrying `role="status"` would be inserted at the same instant as
// its text. Screen readers announce that inconsistently — the region has to
// exist before the text changes for the change to be a change. So `Announce`
// below is a permanently-mounted, visually-hidden region a page keeps at the
// top of its markup, and `Banner` carries the role as well for the readers
// that do handle insertion. Both, because the cost of the belt is one div and
// the cost of the braces is a member of staff not being told a write failed.
//
// ── assertive vs polite ───────────────────────────────────────────────────
//
// `crit` is `role="alert"` / assertive: it interrupts, and it is reserved for
// "this did not happen" — a refused write, a failed read, money not moved.
// Everything else is `role="status"` / polite and waits its turn. A console
// that shouted every "Saved" would be a console people turn the screen reader
// off to use.

/** The tones the console's banners come in. `crit` interrupts; the rest wait. */
export type BannerTone = 'crit' | 'warn';

export function Banner({
  children,
  tone,
  /** Set false for a banner whose text is ALREADY being announced by an
   *  `Announce` region on the same page, so it is not read twice. */
  live = true,
  /** Merged over the base, for the one thing the nineteen copies did not agree
   *  on: /platform capped its banners at 72ch and nothing else did. */
  style,
}: {
  children: React.ReactNode;
  tone?: BannerTone;
  live?: boolean;
  style?: React.CSSProperties;
}) {
  const edge = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : 'var(--brand)';
  return (
    <div
      role={live ? (tone === 'crit' ? 'alert' : 'status') : undefined}
      aria-live={live ? (tone === 'crit' ? 'assertive' : 'polite') : undefined}
      aria-atomic={live ? 'true' : undefined}
      style={{
        margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
        border: '1px solid var(--ring)', borderLeft: `3px solid ${edge}`,
        color: 'var(--ink2)', fontSize: 13,
        ...style,
      }}
    >{children}</div>
  );
}

/**
 * A permanently-mounted live region.
 *
 * Put one near the top of a page and feed it whatever the page most recently
 * said — `<Announce say={saved ?? err} tone={err ? 'crit' : undefined} />`.
 * It draws nothing. Because the element is there from the first render, a
 * screen reader treats a later `say` as a change to an existing region, which
 * is the case every implementation handles.
 *
 * `clip`, not `display: none` and not `visibility: hidden`. Both of those
 * remove the node from the accessibility tree entirely, which is the one thing
 * a live region must not be.
 */
export function Announce({ say, tone }: { say?: string | null; tone?: BannerTone }) {
  return (
    <div
      role={tone === 'crit' ? 'alert' : 'status'}
      aria-live={tone === 'crit' ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        position: 'absolute', width: 1, height: 1, margin: -1, padding: 0,
        overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)',
        whiteSpace: 'nowrap', border: 0,
      }}
    >{say ?? ''}</div>
  );
}
