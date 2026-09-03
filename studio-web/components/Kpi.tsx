'use client';

// The console's headline figure: a label, a number, and the sentence under it.
//
// ── Why this is one component and not twenty-five ─────────────────────────
//
// `grep -rn '^function Kpi' studio-web/app` returned twenty-five, and
// `studio-web/components/` held three files. The copies were not identical:
// /analytics took a `tone` the other twenty-four did not, /accounting typed
// `text` as `string | null | undefined` where /orders typed it `string | null`,
// /page.tsx took a `value` and formatted it itself, and /accounting added a
// whole second variant called `Figure`.
//
// That is the mechanism behind three separate findings across two waves. A
// sweep that fixes the shared `Banner` reaches every screen; a sweep that fixes
// a tile reached one of twenty-five, and the twenty-fourth was found by a grep
// somebody had to think of running.
//
// ── The accessibility gap that was one edit here and twenty-five out there ─
//
// Every copy rendered `<div className="micro">{label}</div>` above
// `<div className="mono">{text ?? '—'}</div>`: the label and the number were
// siblings with nothing joining them. Read linearly the KPI strip was
// "Waiting", "3", "Past thirty days", "0", "Soonest due", "3d" — six strings
// whose pairing was a matter of visual proximity only. And the dash is a real
// hyphen-minus in a 21px mono face, which several screen readers announce as
// "hyphen" or not at all, on the figure that means "we do not know".
//
// A `<dl>` per tile with one `<dt>`/`<dd>` pair is the fix, and it is the
// markup that means exactly this: a term and its value. The KPI strip is a grid
// of these, so each tile is its own list rather than one list striped across the
// row — a `<dl>` whose `<dt>`s and `<dd>`s are in different grid cells is not a
// thing a screen reader can pair either.
import type { CSSProperties } from 'react';

/** The colours a figure may be drawn in. Every one of them is a STATUS, and
 *  the note under the figure says the same thing in words — colour is never the
 *  only carrier of a fact in this console. */
export type KpiTone = 'good' | 'crit' | 'brand' | 'warn';

/**
 * One tile.
 *
 * `text` is an ALREADY-FORMATTED figure, and null means "not recorded" — a
 * dash, in the muted ink, with the `note` beside it saying which silence it is.
 * That is the console's rule everywhere and the tile does not get to break it:
 * there is no branch here that turns a missing figure into a zero.
 *
 * `value` is the one concession to /page.tsx, which passed a raw count and let
 * the tile format it. Kept rather than pushed back onto the caller because
 * `toLocaleString` on a count is the reader's own separator and that decision
 * belongs in one place. When both are given, `text` wins — it is the formatted
 * one.
 */
export function Kpi({ label, value, text, note, tone, big = false }: {
  label: string;
  value?: number | null;
  text?: string | null;
  note?: string;
  tone?: KpiTone;
  /** The overview's larger figure. One flag rather than a second component. */
  big?: boolean;
}) {
  const missing = text !== undefined ? text == null : value == null;
  const shown = missing ? '—' : (text ?? value!.toLocaleString());
  const colour = missing ? 'var(--ink3)' : tone ? `var(--${tone})` : 'var(--ink)';
  return (
    <dl style={{ background: 'var(--surface)', padding: '14px 16px', margin: 0 }}>
      <dt className="micro">{label}</dt>
      <dd
        className="mono"
        style={{
          fontSize: big ? 25 : 21, marginTop: 5, marginLeft: 0,
          letterSpacing: '-0.02em', color: colour,
        }}
      >
        {/* The dash is announced. "—" alone is silence or "hyphen" depending on
            the reader, and this is the figure that means we do not know. */}
        {missing ? <span aria-hidden="true">—</span> : shown}
        {missing ? <span style={hidden}>not recorded</span> : null}
      </dd>
      {note ? (
        <dd style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3, marginLeft: 0 }}>{note}</dd>
      ) : null}
    </dl>
  );
}

const hidden: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
};
