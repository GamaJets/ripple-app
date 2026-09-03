// Tests for rosterSearch — finding one person on a book of eighty.
//
// The defect these exist for: the Clients screen's only search affordance
// opened Explore, which searches the list of SCREENS. A coach typing a client's
// name into the one magnifying glass on the page got "nothing matches" about a
// person who was sitting on their roster.
//
// Two things are pinned here beyond "does it filter":
//
//   · the ORDER is never touched. The roster is sorted by who needs a call
//     first, and a search that re-ranked by match quality would bury the client
//     with nothing recorded for three weeks under whoever's surname happened to
//     start with the letters typed.
//   · an empty result is not one sentence. Under 'error' the roster was never
//     read, so "nobody matches" is a statement about somebody's book that this
//     app has no basis for. Only 'ready' may say a person is not there.
//
// Compile with tsc then run with node, like assignPicker.test.ts.
import { matchesRosterQuery, searchRoster, rosterSearchLine, rosterPickerLine } from './rosterSearch';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL: LoadStatus[] = ['loading', 'ready', 'partial', 'error'];

/* ── matching a name ──────────────────────────────────────────────────────── */

ok(matchesRosterQuery('Sarah Jones', 'sarah'), 'the first name finds her');
ok(matchesRosterQuery('Sarah Jones', 'JONES'), 'and so does the surname, whatever the case');
ok(matchesRosterQuery('Sarah Jones', 'sar'),
  'a partial first name finds her — a coach types three letters, not a full name');
ok(matchesRosterQuery('Sarah Bell', 'ell'),
  'and the MIDDLE of a name matches: somebody who half-remembers a surname is who a search field is for');
ok(matchesRosterQuery('Sarah Jones', 'sarah jones'), 'both terms, in order');
ok(matchesRosterQuery('Sarah Jones', 'jones sarah'),
  'and out of order — a half-remembered name is typed in whichever half came back first');
ok(matchesRosterQuery('Sarah Jones', '  sarah   '), 'surrounding space is not a term');
ok(!matchesRosterQuery('Sarah Jones', 'sarah smith'),
  'every term has to land: one wrong surname is not a match on the first name alone');
ok(!matchesRosterQuery('Sarah Jones', 'priya'), 'and somebody else does not match her at all');

// An untyped field is not a filter.
ok(matchesRosterQuery('Sarah Jones', ''), 'an empty query matches everybody');
ok(matchesRosterQuery('Sarah Jones', '   '), 'and so does a field holding only space');
ok(matchesRosterQuery('Sarah Jones', '·—'),
  'and one holding only punctuation, which is a field somebody has not typed a term into yet');

// Accents fold both ways. The second is the one that matters: the coach's
// keyboard is not always the one the name was entered on.
ok(matchesRosterQuery('José Núñez', 'jose'), 'an unaccented query finds an accented name');
ok(matchesRosterQuery('Jose Nunez', 'josé'), 'and an accented query finds an unaccented name');
ok(matchesRosterQuery('Ana-María O’Neill', 'maria'),
  'hyphens and apostrophes are separators, not part of the name a coach types');
ok(matchesRosterQuery('Ana-María O’Neill', 'oneill'),
  "and O’Neill is found typed as one word, which is how it is typed in a hurry");

/* ── searching a list ─────────────────────────────────────────────────────── */

const book = [
  { id: 'c1', name: 'Zoe Adams' },
  { id: 'c2', name: 'Sarah Jones' },
  { id: 'c3', name: 'Sarah Bell' },
  { id: 'c4', name: 'Priya Sharma' },
];

eq(searchRoster(book, 'sarah').map((c) => c.id).join(','), 'c2,c3', 'both Sarahs, and only them');
eq(searchRoster(book, 'sarah b').map((c) => c.id).join(','), 'c3', 'a second term picks one of them out');
eq(searchRoster(book, '').length, 4, 'an empty field is not a filter');
eq(searchRoster(book, 'nobody').length, 0, 'and a name nobody has matches nobody');

// THE ORDER RULE. The roster arrives sorted by drift; Zoe is first because she
// needs a call, not because of her name.
eq(searchRoster(book, 'a').map((c) => c.id).join(','), 'c1,c2,c3,c4',
  'THE CALLER’S ORDER SURVIVES — a search that re-ranked by match quality, or by name, would reorder a list sorted by who needs attention');

// Non-destructive: the screen holds the roster the provider gave it.
{
  const before = book.map((c) => c.id).join(',');
  searchRoster(book, 'sarah');
  eq(book.map((c) => c.id).join(','), before, 'the list handed in is not mutated');
}

/* ── the sentence under the field ─────────────────────────────────────────── */

// Nothing typed, nothing to say, under every status. A caveat about a search
// nobody has run is a warning with no question behind it.
for (const status of ALL) {
  eq(rosterSearchLine({ status, query: '', matched: 0, searched: 0 }), null,
    `no query, no line (${status})`);
  eq(rosterSearchLine({ status, query: '   ', matched: 0, searched: 0 }), null,
    `and space alone is not a query either (${status})`);
}

// A hit under a whole read needs no explaining.
eq(rosterSearchLine({ status: 'ready', query: 'sarah', matched: 2, searched: 40 }), null,
  'matches under a whole read say nothing');

// THE ONE STATEMENT OF ABSENCE THIS FILE ALLOWS.
{
  const line = rosterSearchLine({ status: 'ready', query: 'sarah', matched: 0, searched: 40 });
  ok(!!line, 'under a whole read, no match is stated');
  ok((line ?? '').includes('sarah'), 'and the sentence quotes what was typed');
}

// UNKNOWN, NEVER NONE. Under 'error' the roster on screen is not the roster.
{
  const line = rosterSearchLine({ status: 'error', query: 'sarah', matched: 0, searched: 0 });
  ok(!!line, 'a failed read gets a sentence');
  ok(!/matches|match\b/.test((line ?? '').toLowerCase().replace('matched', '')),
    'AND IT NEVER SAYS NOBODY MATCHES — the read failed, so this app does not know who is on the book');
  ok((line ?? '').toLowerCase().includes('not mean'),
    'it says what the absence does not mean, which is the whole point of the branch');
}

// Still reading. The names that have arrived are real and the rest are coming.
{
  const line = rosterSearchLine({ status: 'loading', query: 'sarah', matched: 0, searched: 12 });
  ok(!!line, 'a read in flight gets a sentence too');
  ok((line ?? '').toLowerCase().includes('still'), 'and it says the read is not finished');
}

// Truncated. Said whether or not something was found — one Sarah found in a
// book that came back short does not mean there is only one.
{
  const hit = rosterSearchLine({ status: 'partial', query: 'sarah', matched: 1, searched: 1000 });
  const miss = rosterSearchLine({ status: 'partial', query: 'sarah', matched: 0, searched: 1000 });
  ok(!!hit, 'a truncated read is caveated EVEN WHEN THE SEARCH FOUND SOMEBODY');
  ok(!!miss, 'and when it found nobody');
  ok((hit ?? '').includes('1000') && (miss ?? '').includes('1000'),
    'both name how many rows were actually searched, because that is not the size of the book');
}

/* ── the line that tells a coach where the rest of the book is ──────────── */
//
// It printed "Showing 20 of your 20 clients — type a name to find the rest."
// over a roster that came back short, so the coach typed the name, got nothing,
// and concluded the client was not on their book.

eq(rosterPickerLine({ status: 'ready', shown: 20, known: 84 }),
  'Showing 20 of your 84 clients — type a name to find the rest.',
  'a whole read may state the size of the book');

{
  const part = rosterPickerLine({ status: 'partial', shown: 20, known: 20 });
  ok(/came back short/i.test(part), 'a truncated read says so');
  ok(!/your 20 clients/i.test(part), 'and never states the page size as the size of the book');
  ok(/may still be on your book/i.test(part), 'and says what that means for a name they cannot find');

  const load = rosterPickerLine({ status: 'loading', shown: 8, known: 8 });
  ok(/still arriving/i.test(load), 'a read in flight says so');
  ok(!/your 8 clients/i.test(load), 'and claims no total');

  const bad = rosterPickerLine({ status: 'error', shown: 3, known: 3 });
  ok(/could not be read/i.test(bad), 'a failed read says so');
  ok(/not a count of your book/i.test(bad), 'and refuses the count outright');
}

for (const st of ['loading', 'ready', 'partial', 'error'] as LoadStatus[]) {
  const line = rosterPickerLine({ status: st, shown: 5, known: 9 });
  ok(line.length > 0 && !line.includes('undefined') && !line.includes('null'),
    `${st} produces a real sentence`);
}

if (errors.length) {
  console.error(`rosterSearch.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('rosterSearch.test: all good');
