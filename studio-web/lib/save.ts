// Handing a file to the person looking at the screen.
//
// Six lines, in one place, because the interesting part is the last one and it
// is the part every reimplementation leaves out.
//
// This was a private helper inside studio-web/app/export/page.tsx while /export
// was the only screen in the console that produced a file. It no longer is:
// /accounting and /close are the two screens written for month-end, and until
// this wave neither had an export, a print, a PDF or an email — every figure on
// the pages an accountant is meant to work from lived only in the owner's
// browser. Two copies of a download helper is how one of them ends up without
// the revoke below.

/**
 * Save a blob under a filename.
 *
 * The `setTimeout` is the whole reason this is a function. Revoking the object
 * URL in the same tick as the click has been observed to cancel the download in
 * Safari — the anchor is gone, the URL is dead, and the browser silently drops
 * the transfer. Thirty seconds is far longer than any of these files need and
 * costs one dead object URL if the tab is closed first.
 */
export function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Save text as a file.
 *
 * `text/csv` rather than `text/plain`, and the charset is named. Excel on
 * Windows reads a CSV with no stated encoding in the system codepage, which
 * turns every accented member name into mojibake in a document somebody files.
 * `toCsv` in src/lib/gymExport.ts writes a UTF-8 BOM for the same reason; the
 * two together are what make a name with an apostrophe or an umlaut survive the
 * trip into a spreadsheet.
 */
export function saveText(text: string, name: string, mime = 'text/csv;charset=utf-8'): void {
  save(new Blob([text], { type: mime }), name);
}
