// A CSV reader that survives real exports.
//
// Written rather than reached for because the failure mode of a naive
// `split(',')` is silent: a member called "Smith, Jr." shifts every column
// after it by one, and the import lands their phone number in the plan field
// without complaining. The gym finds out months later.
//
// Follows RFC 4180 where it is sensible and real-world exports where it is
// not: BOM-prefixed files from Excel, CRLF line endings, and the semicolon
// delimiter that any spreadsheet in a comma-decimal locale produces.

/** A parsed sheet: the header row, and the data rows beneath it. */
export interface Sheet {
  header: string[];
  rows: string[][];
  /** What the delimiter turned out to be — worth showing back to the user. */
  delimiter: string;
}

const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Work out the delimiter from the first line.
 *
 * Counts candidates outside quotes only, so a comma inside "Smith, Jr." does
 * not vote for the comma. Ties go to the earlier entry in DELIMITERS, which
 * puts the comma first — the safest default when a file gives no other signal.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') {
        // A doubled quote inside a quoted field is an escaped quote, not a close.
        if (inQuotes && firstLine[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
      } else if (c === d && !inQuotes) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/**
 * Parse CSV text into rows of raw strings.
 *
 * Nothing is coerced here — no numbers, no dates, no trimming of meaningful
 * whitespace. Interpretation belongs to the importer, which knows what each
 * column is supposed to be and can refuse it properly.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  // Excel writes a UTF-8 BOM. Left in place it becomes part of the first
  // header name, so "Name" never matches and the whole mapping fails.
  let src = text.replace(/^﻿/, '');
  if (src === '') return [];

  const d = delimiter ?? sniffDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => { row.push(field); field = ''; fieldWasQuoted = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"' && field === '') { inQuotes = true; fieldWasQuoted = true; continue; }
    if (c === d) { endField(); continue; }
    if (c === '\r') { if (src[i + 1] === '\n') i++; endRow(); continue; }
    if (c === '\n') { endRow(); continue; }
    field += c;
  }

  // A trailing newline must not produce a phantom empty row, but a genuine
  // final row without one must not be dropped.
  if (field !== '' || fieldWasQuoted || row.length > 0) endRow();

  return rows;
}

/**
 * Parse into a header plus rows, discarding blank lines.
 *
 * Short rows are padded and long rows are kept whole: a row with more columns
 * than the header is a signal something is wrong, and the importer reports it
 * rather than this silently truncating the evidence.
 */
export function parseSheet(text: string, delimiter?: string): Sheet {
  const d = delimiter ?? sniffDelimiter(text.replace(/^﻿/, ''));
  const all = parseCsv(text, d).filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (all.length === 0) return { header: [], rows: [], delimiter: d };
  const [header, ...rows] = all;
  const width = header.length;
  return {
    header: header.map((h) => h.trim()),
    rows: rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r)),
    delimiter: d,
  };
}

/** Header text reduced to something comparable: lowercase, alphanumeric only. */
export function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map a sheet's headers onto known fields using a table of aliases.
 *
 * Returns the column index per field, and the headers it could not place —
 * unrecognised columns are reported rather than ignored, because a column the
 * gym expected to import and which silently did nothing is the worst outcome.
 */
export function mapColumns(
  header: string[],
  aliases: Record<string, string[]>,
): { index: Record<string, number>; unmatched: string[] } {
  const index: Record<string, number> = {};
  const used = new Set<number>();

  for (const [field, names] of Object.entries(aliases)) {
    const wanted = names.map(normaliseHeader);
    const at = header.findIndex((h, i) => !used.has(i) && wanted.includes(normaliseHeader(h)));
    if (at >= 0) { index[field] = at; used.add(at); }
  }

  const unmatched = header.filter((h, i) => !used.has(i) && h.trim() !== '');
  return { index, unmatched };
}
