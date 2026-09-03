'use client';

// The table primitive.
//
// Forty screens of this console are a list of rows someone scans, sorts and
// exports. Building that once means the sorting rule, the empty state and the
// treatment of a missing value are decided in one place — and "missing" renders
// as a dash rather than a zero, because a gym with no recorded sessions and a
// gym with zero sessions are different facts.
//
// ── Why this pages ────────────────────────────────────────────────────────
//
// It used to render every row it was handed. `/members` pages its reads
// properly with `readAll` and then passed the whole roster in, so a
// three-thousand-member gym asked the browser for three thousand `<tr>`
// elements — each one five or six `<td>`s with inline styles — on the screen
// the front desk uses most. The tab stops responding, and the fix nobody can
// apply is "have fewer members".
//
// A window, not virtualisation. Windowing on scroll means measuring row
// heights, a scroll container that has to own its own height, and a table whose
// rows the browser's own find-in-page can no longer see — three new ways to be
// wrong in the one component forty screens depend on. A page size and two
// buttons cost nothing, keep every rendered row real and findable, and are the
// thing a person at a desk already knows how to use.
//
// The count is always stated, even on one page, because the number of rows IS
// one of the facts on most of these screens. "12 rows" under a table is how
// somebody notices that the list they expected 400 of is short.
//
// ── Why the header is a button ────────────────────────────────────────────
//
// The header cell was a `<th onClick>` with `cursor: pointer` and no
// `tabIndex`, no key handler, no role and no `aria-sort`; which way it pointed
// was carried entirely by a ▾/▴ glyph. A keyboard user could not sort the
// payroll run by amount at all, and a screen-reader user was not told a column
// was sortable, let alone which one was sorted or in which direction.
import { useEffect, useMemo, useRef, useState } from 'react';
// The paging arithmetic and the count sentence live in src/lib, tested, because
// both of their failure modes are silent: a page number that outlives its list
// renders as "the filter matched nothing", and an off-by-one in the count line
// is a wrong fact that does not look wrong.
import { tableWindow, rowCountLine } from '@lib/tablePage';

export interface Column<T> {
  key: string;
  header: string;
  /** Value used for sorting and, unless `render` says otherwise, display. */
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  /** Right-aligned figures line up only with tabular numerals. */
  numeric?: boolean;
}

/**
 * How many rows one page holds.
 *
 * Two hundred is a deliberate compromise and not a round number picked for
 * looking like one. A month of a busy gym's door log, a payroll run, a class
 * timetable and a plan list all fit on one page at this size, so the screens
 * that are already comfortable are byte-identical to what they were. The
 * screens that are not — the roster, the payments ledger, the signature list —
 * are the ones that were breaking, and they now render 200 rows instead of
 * 3,000.
 */
export const PAGE_ROWS = 200;

export function DataTable<T>({
  rows,
  columns,
  empty,
  rowKey,
  pageSize = PAGE_ROWS,
  /** What one row IS, plural, lower case: "members", "payments". Used in the
   *  count line, in the table's own caption, and in what a screen reader is
   *  told when the page changes.
   *
   *  The default stays, and it is now the thing nothing reaches. It was written
   *  as "'rows' is honest where nothing better has been said" — and ninety-six
   *  of the ninety-nine call sites in this console said nothing, so the caption
   *  argued for two paragraphs above ("eight anonymous tables of eight columns
   *  each with nothing to tell them apart") shipped as eight tables all called
   *  Rows. A default that every caller takes is not a default, it is the
   *  behaviour. All ninety-nine now name their rows; the fallback is kept only
   *  so that a table added in a hurry renders rather than fails to compile, and
   *  a reviewer who sees "Rows" in a caption is looking at a call site that
   *  forgot. */
  noun = 'rows',
}: {
  rows: T[];
  columns: Column<T>[];
  empty: React.ReactNode;
  rowKey: (row: T) => string;
  pageSize?: number;
  noun?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(0);

  // The column list is rebuilt inline by nearly every caller, so it is a new
  // array on every render and a `useMemo` that depends on it never hits. The
  // identity that actually matters to a sort is which column is being sorted
  // on, and the `value` functions are pure — so the memo keys on the column
  // KEYS and reads the live functions through a ref.
  const colsRef = useRef(columns);
  colsRef.current = columns;
  // The separator is written as an ESCAPE and not as a raw byte. It was a
  // literal NUL in the source, which made this file `file(1)`-binary: grep,
  // the repo's own check scripts and every editor search skipped it silently,
  // so the aria work below was invisible to the greps that audit it.
  const colKeys = columns.map((c) => c.key).join('\u0000');

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = colsRef.current.find((c) => c.key === sortKey);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const av = col.value(a), bv = col.value(b);
      // Missing values sort last whichever way the column is pointing: an
      // unknown is not a small number.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colKeys, sortKey, desc]);

  // A filter that shortens the list while somebody is on page 4 would otherwise
  // leave them looking at an empty table and no explanation. Clamped on the way
  // out AND reset in an effect, because the clamp alone fixes what is DRAWN and
  // leaves `page` holding a number the buttons would then count from.
  const w = tableWindow(sorted.length, pageSize, page);
  useEffect(() => { if (w.clamped) setPage(0); }, [w.clamped]);
  // Sorting re-orders the whole set, so page 4 of the old order is not page 4
  // of the new one — it is a different set of rows under the same heading.
  useEffect(() => { setPage(0); }, [sortKey, desc]);

  const window_ = w.pages > 1 ? sorted.slice(w.from, w.to + 1) : sorted;

  if (!rows.length) {
    return <div style={{ padding: '22px 12px', color: 'var(--ink3)', fontSize: 12.5 }}>{empty}</div>;
  }

  const toggle = (key: string) => {
    if (sortKey === key) setDesc((d) => !d);
    else { setSortKey(key); setDesc(true); }
  };

  // Bare `toLocaleString`, which is the reader's own locale — see
  // scripts/check-locale.mjs. A gym in Dubai, one in London and one in Tokyo
  // run this same binary and there is no house separator that is not simply
  // wrong for two of them.
  //
  // The same argument applies to every DATE on the same page and was not made
  // there: this console drew its counts in the reader's locale, its payment
  // dates in the reader's ZONE, and its order stamps in raw UTC — three
  // conventions, one of them on the line below this one. The dates have since
  // moved to src/lib/gymWhen.ts (the reader's locale, the GYM's zone) and
  // scripts/check-console-when.mjs is what stops a fourth appearing. This line
  // is deliberately not part of that move: a ROW COUNT is a number, it has no
  // clock, and the reader's locale is the whole of the right answer for it.
  const countLine = rowCountLine(w, sorted.length, noun, (n) => n.toLocaleString());

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          {/*
           * Which table this is.
           *
           * The component got everything else right — `aria-sort` on the header
           * cell, a real `<button>` for the sort, a live count line — and
           * rendered a bare `<table>`. /accounting draws eight of these on one
           * page, so a person browsing that screen by table heard eight
           * anonymous tables of eight columns each with nothing to tell them
           * apart. The noun is already in this component for the count line;
           * putting it on the table is the whole of it.
           *
           * Visually hidden rather than drawn: every one of these tables
           * already sits under a `Section` heading that says the same thing to
           * a sighted reader, and a second visible title would be noise.
           */}
          <caption style={{
            position: 'absolute', width: 1, height: 1, overflow: 'hidden',
            clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
          }}>
            {noun[0].toUpperCase()}{noun.slice(1)}
          </caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    // `aria-sort` belongs on the header CELL, not on the button
                    // inside it — it is a property of the column, and a screen
                    // reader reads it when the user lands on any cell in that
                    // column, not only on the control that changed it.
                    aria-sort={on ? (desc ? 'descending' : 'ascending') : 'none'}
                    style={{
                      textAlign: c.align ?? (c.numeric ? 'right' : 'left'),
                      padding: 0,
                      borderBottom: '1px solid var(--ring)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      // Said in full rather than left to the glyph. "Sort by
                      // Amount" is what the control DOES; the current state is
                      // on the cell above as aria-sort, which is where a
                      // screen reader expects to find it.
                      title={`Sort by ${c.header}`}
                      style={{
                        // A real button, drawn as the header it replaced: the
                        // whole cell is the hit area, the background and border
                        // are the table's, and the focus ring is the browser's
                        // own rather than something removed for looking untidy.
                        display: 'block',
                        width: '100%',
                        appearance: 'none',
                        background: 'none',
                        border: 'none',
                        borderRadius: 0,
                        margin: 0,
                        textAlign: 'inherit',
                        padding: '5px 12px',
                        color: on ? 'var(--ink)' : 'var(--ink3)',
                        fontFamily: 'var(--mono)',
                        fontSize: 8,
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                        fontWeight: 500,
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.header}
                      {/* Decoration now that the direction is stated properly
                          above it, so it is hidden rather than read out as a
                          punctuation character after every column name. */}
                      {on ? <span aria-hidden="true" style={{ marginLeft: 5 }}>{desc ? '▾' : '▴'}</span> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {window_.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => {
                  const v = c.value(row);
                  const missing = v == null || v === '';
                  return (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.align ?? (c.numeric ? 'right' : 'left'),
                        padding: '6px 12px',
                        borderBottom: '1px solid var(--ring2)',
                        color: missing ? 'var(--ink3)' : 'var(--ink2)',
                        fontFamily: c.numeric ? 'var(--mono)' : 'var(--sans)',
                        fontVariantNumeric: c.numeric ? 'tabular-nums' : undefined,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.render ? c.render(row) : missing ? '—' : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The count, and the paging when there is more than one page.

          The live region holds the count SENTENCE and nothing else. It is
          mounted from the first render and only its text ever changes, which is
          the only shape a screen reader reliably announces — a region that
          appears at the same moment as its message is frequently missed — and
          it contains no controls, because a live region wrapped around a
          button re-reads the button every time the count moves. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '7px 12px', flexWrap: 'wrap',
          fontSize: 11.5, color: 'var(--ink3)', fontFamily: 'var(--mono)',
        }}
      >
        <span role="status" aria-live="polite" aria-atomic="true">{countLine}</span>
        {w.pages > 1 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PageButton label="‹ Previous" disabled={w.at === 0} onClick={() => setPage(w.at - 1)} />
            <span>Page {w.at + 1} of {w.pages}</span>
            <PageButton label="Next ›" disabled={w.at >= w.pages - 1} onClick={() => setPage(w.at + 1)} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PageButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        background: 'var(--surface)',
        border: '1px solid var(--ring)',
        color: disabled ? 'var(--ink3)' : 'var(--ink2)',
        fontFamily: 'var(--mono)',
        fontSize: 11.5,
        padding: '3px 9px',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >{label}</button>
  );
}
