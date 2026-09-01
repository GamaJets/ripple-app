// Tests for rosterExport — an export that cannot claim to be a book it only
// saw part of.
//
// The defect these exist for is the one the console's `/export` learned: a
// completeness claim over a read that can truncate is a lie. PostgREST stops at
// a thousand rows and says nothing (src/lib/rowCap.ts), so a file called
// `roster.csv` holding a thousand of twelve hundred clients looks exactly like
// a coach with a thousand clients. The coach opens it, counts the rows, and has
// no reason to think there were more.
//
// The other half is the one gymExport.ts states as its single rule: a null
// survives as EMPTY. Not 0, not "null", not a dash. A client with no scans must
// not export as having held their weight, and a client whose activity read was
// capped must not export as inactive — both of those are claims about a person
// that somebody acts on.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
import {
  buildRosterExport, rosterExportBlocker, rosterIncompleteWarning, rosterHeader,
  type RosterExportRow,
} from './rosterExport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (over: Partial<RosterExportRow> = {}): RosterExportRow => ({
  name: 'Ana Ruiz',
  goal: 'Fat loss',
  mode: 'online',
  joinedAt: '2026-01-14T09:30:00.000Z',
  lastActive: '3d ago',
  adherence: 82,
  weightDeltaKg: -4.2,
  unread: 1,
  injuryAreas: [],
  handAdded: false,
  ...over,
});

/** The data rows of a CSV, with the BOM and the trailing blank dropped. */
const lines = (csv: string): string[] => csv.replace(/^﻿/, '').split('\r\n').filter((l) => l !== '');

/* ── when there is no file to make ────────────────────────────────────────── */

{
  const why = rosterExportBlocker('error', 0);
  ok(why !== null,
    'AN UNREAD ROSTER PRODUCES NO FILE — a CSV with a header row and nothing under it is the most convincing possible statement that a coach has no clients');
  ok(/read failed|could not be read/i.test(why as string),
    'and the refusal says the read failed rather than that the book is empty');
}
ok(rosterExportBlocker('loading', 0) !== null,
  'nothing is exported mid-read either: it would write out whoever had loaded and call it the book');
ok(rosterExportBlocker('ready', 0) !== null,
  'a genuinely empty book is refused too, but for a different reason — there is nothing to put in the file');
eq(rosterExportBlocker('ready', 3), null, 'a whole read of three clients exports');
eq(rosterExportBlocker('partial', 1000), null,
  'A TRUNCATED READ IS NOT A BLOCKER — a thousand real clients is a useful file, and refusing it would take a working export away to protect a claim that is simply removed instead');

/* ── the completeness claim ───────────────────────────────────────────────── */

eq(rosterIncompleteWarning('ready', 12), null, 'a whole read has nothing to caveat');
{
  const w = rosterIncompleteWarning('partial', 1000) ?? '';
  ok(w.includes('INCOMPLETE'), 'the warning says the word, in a form nobody has to interpret');
  ok(w.includes('1,000'),
    'and carries the count it DOES hold, separated by a thousands mark like every other figure in this app');
  ok(/more|never read/i.test(w), 'and says there are more that were never read');
  ok(/not.*whole roster|do not treat/i.test(w),
    'and tells the reader what not to do with it, because the file will outlive the screen that made it');
}

/* ── the file itself ──────────────────────────────────────────────────────── */

{
  const x = buildRosterExport([row()], 'ready', 'kg', '2026-09-01');
  eq(x.complete, true, 'a whole read is complete');
  eq(x.warning, null, 'with no warning to show the coach');
  ok(!x.filename.includes('INCOMPLETE'), 'and an ordinary filename');
  const l = lines(x.csv);
  eq(l[0], rosterHeader('kg').join(','),
    'A COMPLETE EXPORT IS AN ORDINARY CSV — the header is row 1, because the banner only exists when there is something to warn about');
  ok(l[1].startsWith('Ana Ruiz'), 'and the client is row 2');
}

{
  const x = buildRosterExport([row(), row({ name: 'Ben Ng' })], 'partial', 'kg', '2026-09-01');
  eq(x.complete, false, 'a truncated read is not complete');
  ok(x.filename.includes('INCOMPLETE'),
    'THE FILENAME CARRIES IT — that is the only one of the three signals still attached after the file has been mailed on');
  ok(x.warning !== null, 'and the coach is given the sentence before they share it');
  const l = lines(x.csv);
  ok(l[0].includes('INCOMPLETE'),
    'AND IT IS THE FIRST LINE OF THE FILE, above the header, so it cannot be scrolled past');
  eq(l[1], rosterHeader('kg').join(','), 'the header follows it, so the sheet is still readable');
  ok(l[2].startsWith('Ana Ruiz'), 'and the rows follow that');
  ok(x.text.includes('INCOMPLETE'),
    'the text fallback says it too — on a build that cannot attach a file the rows go as a message, and that message must carry the same caveat');
}

/* ── a null survives as empty ─────────────────────────────────────────────── */

{
  const x = buildRosterExport([row({
    adherence: null, weightDeltaKg: null, unread: null, joinedAt: null, lastActive: '—',
  })], 'ready', 'kg', '2026-09-01');
  const cells = lines(x.csv)[1].split(',');
  eq(cells[3], '', 'an unknown join date is an empty cell, never today’s date and never a dash');
  eq(cells[4], '',
    'THE ROSTER’S DASH BECOMES EMPTY — "—" is what a capped stats read leaves behind, and in a spreadsheet a dash is a value somebody sorts and filters on');
  eq(cells[5], '', 'a client who has never checked in exports blank, NOT 0 — 0% adherence is a statement about a person');
  eq(cells[6], '', 'and no scans is blank, not a weight change of nothing they were never measured for');
  eq(cells[7], '', 'an unreadable unread count is blank rather than "nobody is waiting on you"');
}

{
  // 'no activity yet' is a real answer off a whole read and must survive.
  const x = buildRosterExport([row({ lastActive: 'no activity yet' })], 'ready', 'kg', '2026-09-01');
  ok(x.csv.includes('no activity yet'),
    'a client who genuinely has no activity keeps that cell — only the unknown dash is blanked, and the two are different facts');
}

/* ── the CSV has to survive real names ────────────────────────────────────── */

{
  const x = buildRosterExport([
    row({ name: "Ana O'Brien, Jr.", goal: 'Tone; maintain', injuryAreas: ['Left knee', 'Lower back'] }),
  ], 'ready', 'kg', '2026-09-01');
  const l = lines(x.csv);
  ok(l[1].startsWith('"Ana O\'Brien, Jr."'),
    'a comma inside a name is quoted, or every column after it shifts silently and forever');
  ok(l[1].includes('"Tone; maintain"'),
    'and so is a semicolon — src/lib/csv.ts will sniff one as a delimiter, and a spreadsheet in a comma-decimal locale does the same');
  ok(l[1].includes('"Left knee, Lower back"'),
    'two injury areas are one quoted cell rather than two columns');
}

/* ── the unit is named, and the SPAN is what gets converted ───────────────── */

{
  ok(rosterHeader('lb')[6].includes('lb'),
    'THE WEIGHT COLUMN NAMES ITS UNIT — "Weight change" alone is two different numbers depending on who exported it');
  const kg = buildRosterExport([row({ weightDeltaKg: -4.2 })], 'ready', 'kg', '2026-09-01');
  const lb = buildRosterExport([row({ weightDeltaKg: -4.2 })], 'ready', 'lb', '2026-09-01');
  eq(lines(kg.csv)[1].split(',')[6], '-4.2', 'kilograms go out as stored, to one decimal');
  eq(lines(lb.csv)[1].split(',')[6], '-9',
    'and pounds are converted from the SPAN — rounding the two ends separately is how a steady 2.5 kg loss alternates between 5 and 6 with nothing having changed');
}

/* ── a hand-added client is marked, because their blanks mean something else ─ */

{
  const x = buildRosterExport([row({ handAdded: true, adherence: null })], 'ready', 'kg', '2026-09-01');
  const cells = lines(x.csv)[1].split(',');
  eq(cells[9], 'yes',
    'a coach_clients note is flagged: every blank figure on that row is blank because they have no account, not because they are inactive');
  eq(lines(buildRosterExport([row()], 'ready', 'kg', '2026-09-01').csv)[1].split(',')[9], 'no',
    'and a real client says no rather than leaving the cell empty — this column answers a question about every row, so a blank would read as unknown');
}

if (errors.length) {
  console.error(`rosterExport.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('rosterExport.test.ts — ok');
