// Which rows of a list are on screen, and the sentence that says so.
//
// The arithmetic behind `studio-web/components/DataTable.tsx`'s paging, pulled
// out here because it is a rule and not a rendering, and because the two ways
// it goes wrong are both silent:
//
//   · A page number that outlives its list. Somebody is on page 4 of the
//     roster, types into the filter, and the list is now 30 rows long. Slicing
//     at `4 * 200` returns an empty array, and the table renders as though the
//     filter matched nothing — a false statement about the gym's members,
//     produced by a control the reader was not touching.
//
//   · An off-by-one in the count line. "1–200 of 3,000" is a fact somebody
//     checks a spreadsheet against. "0–200", "1–201" and a last page that
//     claims a full 200 when it holds 14 are each a wrong fact, and none of
//     them looks wrong.
//
// The counts here are ONE-BASED and inclusive, because they are read by a
// person. The offsets are zero-based and `to` is inclusive, because they are
// fed to `Array.prototype.slice`'s neighbourhood and to PostgREST's `.range()`,
// which is also inclusive. Both conventions are in one file on purpose: this is
// the boundary where they meet, and the bugs live in the translation.

/** Where one page of a list starts and stops. */
export interface TableWindow {
  /** How many pages the list makes. Always at least 1 — an empty list is one
   *  empty page, not zero pages, and "Page 1 of 0" is not a sentence. */
  pages: number;
  /** The page actually being shown, zero-based, after clamping. */
  at: number;
  /** First row index of the window, zero-based, inclusive. */
  from: number;
  /** Last row index of the window, zero-based, INCLUSIVE. On an empty list
   *  this is `from - 1`, i.e. -1: an empty window, not a window of one. */
  to: number;
  /** First row number as a person counts, one-based. 0 when there are none. */
  first: number;
  /** Last row number as a person counts, one-based. 0 when there are none. */
  last: number;
  /** Whether the requested page had to be pulled back into range. The caller
   *  uses this to reset its own state, because clamping what is DRAWN while
   *  leaving `page` holding 4 makes the Previous button count from a page
   *  nobody is on. */
  clamped: boolean;
}

/**
 * The window for `page` of a `total`-row list at `size` rows a page.
 *
 * `size` is floored at 1. A caller passing 0 would otherwise divide by zero and
 * produce Infinity pages, and there is no reading of "zero rows per page" worth
 * honouring over showing them something.
 *
 * A negative `page` clamps to 0 rather than counting from the end. Nothing in
 * this console counts pages backwards, and silently reinterpreting a negative
 * as "from the end" is how an arithmetic slip becomes a plausible screen.
 */
export function tableWindow(total: number, size: number, page: number): TableWindow {
  const n = Math.max(0, Math.floor(total));
  const per = Math.max(1, Math.floor(size));
  const pages = Math.max(1, Math.ceil(n / per));
  const want = Number.isFinite(page) ? Math.floor(page) : 0;
  const at = Math.min(Math.max(0, want), pages - 1);
  const from = at * per;
  const count = Math.max(0, Math.min(per, n - from));
  return {
    pages,
    at,
    from,
    to: from + count - 1,
    first: count ? from + 1 : 0,
    last: count ? from + count : 0,
    clamped: at !== want,
  };
}

/**
 * What the table says underneath itself.
 *
 * Always stated, even on a single page, because the number of rows IS one of
 * the facts on most of these screens — "12 members" under a list somebody
 * expected 400 of is how the short read gets noticed. That is the same argument
 * `assertWhole` makes one layer down, made where a person can see it.
 *
 * `fmt` is injected rather than calling `num()` here so this file stays free of
 * the app's locale resolution and its test can assert exact strings; the
 * console passes its own formatter.
 */
export function rowCountLine(
  w: TableWindow,
  total: number,
  noun: string,
  fmt: (n: number) => string = (n) => String(n),
): string {
  const n = Math.max(0, Math.floor(total));
  if (n === 0) return `no ${noun}`;
  if (w.pages <= 1) return `${fmt(n)} ${noun}`;
  return `${fmt(w.first)}–${fmt(w.last)} of ${fmt(n)} ${noun}`;
}
