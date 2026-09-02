// A page of a list, and the sentence that counts it.
// Compile with tsc, run with node.
//
// The defect this is written against is the console's table primitive rendering
// every row it was handed — three thousand `<tr>` elements on the screen the
// front desk uses most. Paging is the fix, and paging has two silent failures
// of its own: a page number that outlives the list it was a page of, and a
// count line that is off by one. Both produce a screen that looks right.
//
//   CLAMP        a filter shortens the list under somebody on page 4
//   EDGES        the last page, a list that fits exactly, an empty one
//   SENTENCE     what a person reads under the table
//   DEGENERATE   a page size of 0, a negative page, a fractional total
import { tableWindow, rowCountLine } from './tablePage';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── CLAMP ────────────────────────────────────────────────────────────────
 * Page 4 of 3,000 rows is real. Page 4 of 30 rows is not, and slicing it
 * returns an empty array that renders as "this filter matched nothing".
 */
{
  const wide = tableWindow(3000, 200, 4);
  eq(wide.at, 4, 'page 4 of 3000 rows at 200 a page is a real page');
  eq(wide.clamped, false, 'a page in range is not clamped');
  eq(wide.from, 800, 'page 4 starts at row index 800');
  eq(wide.to, 999, 'page 4 ends at row index 999, inclusive');

  const narrow = tableWindow(30, 200, 4);
  eq(narrow.pages, 1, '30 rows at 200 a page is one page');
  eq(narrow.at, 0, 'a page past the end is pulled back to the first');
  eq(narrow.clamped, true, 'and says it was, so the caller can reset its state');
  eq(narrow.from, 0, 'the clamped window starts at the top');
  eq(narrow.to, 29, 'and covers all thirty rows');
}

/* ── EDGES ────────────────────────────────────────────────────────────────
 * The last page holds what is left, not a full page. A list that divides
 * exactly does not get a trailing empty page. An empty list is one empty page.
 */
{
  const last = tableWindow(214, 200, 1);
  eq(last.pages, 2, '214 rows at 200 a page is two pages');
  eq(last.from, 200, 'the second page starts at index 200');
  eq(last.to, 213, 'and stops at the last real row, not at index 399');
  eq(last.first, 201, 'read by a person: row 201');
  eq(last.last, 214, 'to row 214');

  const exact = tableWindow(400, 200, 0);
  eq(exact.pages, 2, '400 rows at 200 a page is two pages, not three');
  eq(tableWindow(400, 200, 1).to, 399, 'and the second one ends on the last row');

  const one = tableWindow(200, 200, 0);
  eq(one.pages, 1, 'a list that exactly fills one page is one page');
  eq(one.to, 199, 'and the window is the whole of it');

  const none = tableWindow(0, 200, 0);
  eq(none.pages, 1, 'an empty list is one empty page — never "page 1 of 0"');
  eq(none.from, 0, 'an empty window starts at 0');
  eq(none.to, -1, 'and ends before it, so a slice returns nothing');
  eq(none.first, 0, 'there is no first row');
  eq(none.last, 0, 'and no last one');
}

/* ── SENTENCE ─────────────────────────────────────────────────────────────
 * What a person reads. The single-page form is a count and not a range,
 * because "1–12 of 12 members" is a range nobody asked for.
 */
{
  eq(rowCountLine(tableWindow(12, 200, 0), 12, 'members'), '12 members',
    'one page states the count');
  eq(rowCountLine(tableWindow(3000, 200, 0), 3000, 'members'), '1–200 of 3000 members',
    'the first page of many states where it is');
  eq(rowCountLine(tableWindow(3000, 200, 14), 3000, 'members'), '2801–3000 of 3000 members',
    'the last page ends on the last row');
  eq(rowCountLine(tableWindow(0, 200, 0), 0, 'payments'), 'no payments',
    'an empty list says so in words rather than printing a 0');
  eq(rowCountLine(tableWindow(1, 200, 0), 1, 'rows'), '1 rows',
    'the noun is the caller’s to get right — this does not invent a plural');
  eq(rowCountLine(tableWindow(3000, 200, 0), 3000, 'members', (n) => n.toLocaleString('en-GB')),
    '1–200 of 3,000 members',
    'the formatter is injected, so the separator is the reader’s locale and not this file’s');
}

/* ── DEGENERATE ───────────────────────────────────────────────────────────
 * Inputs no caller should pass and one eventually will. None of them may
 * produce Infinity, NaN, or a window that reads as a real one.
 */
{
  const zero = tableWindow(500, 0, 3);
  eq(Number.isFinite(zero.pages), true, 'a page size of 0 does not divide by zero');
  eq(zero.pages, 500, 'it is floored at one row a page');
  eq(zero.at, 3, 'and the requested page still resolves');

  const neg = tableWindow(500, 200, -2);
  eq(neg.at, 0, 'a negative page is the first page, never counted from the end');
  eq(neg.clamped, true, 'and is reported as clamped');

  const frac = tableWindow(250.7, 200, 1);
  eq(frac.pages, 2, 'a fractional total is floored before it is divided');
  eq(frac.to, 249, 'and the last index is a whole row');

  const nan = tableWindow(500, 200, Number.NaN);
  eq(nan.at, 0, 'a NaN page is the first page, not a NaN window');
  eq(Number.isFinite(nan.to), true, 'and its bounds are real numbers');
}

if (errors.length) {
  console.error(`tablePage: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('tablePage: all assertions passed');
