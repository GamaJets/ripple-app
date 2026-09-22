// Whether a coach may be told somebody has not signed a liability release.
// Compile with tsc, run with node.
//
// The assertions that matter most here are the ones about a read that did not
// finish. "They have NOT signed" is an instruction to a coach standing in front
// of a real person, and an empty array is what a refused read, a truncated read
// and a genuinely unsigned record all look like. Every one of the three is
// asserted separately below, because the day they stop being three different
// sentences is the day somebody is turned away over a dropped connection.
import {
  releaseVerdict, releaseLine, releaseOutstanding, latestSigned,
  RELEASE_PRIVACY_NOTE, type ReleaseSignature,
} from './clientRelease';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CURRENT = '2026-08-31';
const sig = (...v: string[]): ReleaseSignature[] => v.map((version) => ({ version }));

// ── the three empties, which are not the same empty ────────────────────────

eq(releaseVerdict('loading', [], CURRENT), 'loading', 'a read in flight says so');
eq(releaseVerdict('error', [], CURRENT), 'unreadable', 'a refused read is not an unsigned release');
eq(releaseVerdict('partial', [], CURRENT), 'truncated', 'a truncated read is not an unsigned release');
eq(releaseVerdict('ready', [], CURRENT), 'none', 'a whole, empty read is a real "they have not signed"');

// And they are four different sentences, none of which is a prefix of another.
{
  const who = 'Sara';
  const lines = (['loading', 'error', 'partial', 'ready'] as const)
    .map((s) => releaseLine(s, [], CURRENT, who));
  eq(new Set(lines).size, 4, 'each state of the read gets its own sentence');
  ok(/NOT signed/.test(lines[3]), 'only the whole read says they have not signed');
  for (const l of lines.slice(0, 3)) {
    ok(!/NOT signed/.test(l), `an unfinished read must not accuse anybody: ${l}`);
  }
  ok(/could not be read/.test(lines[1]), 'a failed read says the read failed');
  ok(/not the same as them not having signed/.test(lines[2]), 'a truncated read says what it is not');
}

// ── rows that came back are real, even when the read was short ─────────────
//
// The asymmetry src/ui/loadStatus.ts states: under 'partial' the rows are real
// and the ABSENCE of a row is what cannot be trusted. A signature that arrived
// therefore still proves a signature.
eq(releaseVerdict('partial', sig(CURRENT), CURRENT), 'current',
  'a truncated read can still prove a signature, it just cannot disprove one');
eq(releaseVerdict('partial', sig('2025-01-01'), CURRENT), 'truncated',
  'older wording inside a truncated read does not rule the current one out');

// An error outranks rows entirely: rows returned alongside a failure are not a
// state anybody should reason about.
eq(releaseVerdict('error', sig(CURRENT), CURRENT), 'unreadable',
  'rows arriving beside an error are not an answer');

// ── signed, and signed what ────────────────────────────────────────────────

eq(releaseVerdict('ready', sig(CURRENT), CURRENT), 'current', 'the current wording, agreed');
eq(releaseVerdict('ready', sig('2025-01-01'), CURRENT), 'superseded',
  'agreeing to older wording is not agreeing to this wording');
eq(releaseVerdict('ready', sig('2025-01-01', CURRENT), CURRENT), 'current',
  'an older acceptance alongside the current one still counts');

// The sentence about superseded wording names both versions, so a coach can
// see it is a re-wording and not a refusal.
{
  const line = releaseLine('ready', sig('2025-01-01'), CURRENT, 'Sara');
  ok(line.includes('2025-01-01'), 'the superseded line names what they did sign');
  ok(line.includes(CURRENT), 'the superseded line names what is now in force');
  ok(!/NOT signed/.test(line), 'somebody who signed earlier wording is not accused of signing nothing');
}

// The signed line names the version, which is the half of the widening that is
// not a yes/no.
ok(releaseLine('ready', sig(CURRENT), CURRENT, 'Sara').includes(CURRENT),
  'the signed line says which version');

// ── the version is text, and is never parsed ───────────────────────────────
//
// A white-label brand suffixes it (src/lib/waiver.ts), so `2026-08-31+acme` is
// a legal version string and Date.parse() would return NaN for it. Nothing here
// may be sensitive to that.
{
  const branded = '2026-08-31+acme';
  eq(releaseVerdict('ready', sig(branded), branded), 'current', 'a branded version matches itself');
  eq(releaseVerdict('ready', sig('2026-08-31'), branded), 'superseded',
    'one brand\'s release is not another\'s, even on the same day');
}

// Ordering is a string comparison. For YYYY-MM-DD that is the same order a date
// comparison gives, and it cannot slide by a timezone.
eq(latestSigned(sig('2024-12-31', '2025-01-01')), '2025-01-01', 'the newest wording wins');
eq(latestSigned(sig('2025-01-01', '2024-12-31')), '2025-01-01', 'and the order it arrived in does not matter');
eq(latestSigned([]), null, 'nothing signed is null, not an empty string');
eq(latestSigned(sig('   ')), null, 'a blank version is not a version');
eq(latestSigned(sig('', '2025-01-01')), '2025-01-01', 'a blank one does not hide a real one');

// ── what is worth a warning ────────────────────────────────────────────────
//
// Only a whole read with genuinely nothing on it. A red flag over an unknown is
// the same lie as a green one.
eq(releaseOutstanding('none'), true, 'an unsigned release is worth flagging');
for (const v of ['loading', 'unreadable', 'truncated', 'current', 'superseded'] as const) {
  eq(releaseOutstanding(v), false, `${v} is not a warning about the client`);
}

// ── the line about what the coach cannot see ───────────────────────────────
//
// It is what stops a coach going looking for a document they are not entitled
// to, and it must not itself promise the document.
ok(RELEASE_PRIVACY_NOTE.length > 0, 'the privacy note exists');
ok(/stays theirs/.test(RELEASE_PRIVACY_NOTE), 'it says whose the record is');
ok(!/Repple/.test(RELEASE_PRIVACY_NOTE), 'and it names no brand — the release is white-labelled');

// No sentence anywhere here may name the brand, for the same reason.
for (const s of (['loading', 'error', 'partial', 'ready'] as const)) {
  ok(!/Repple/.test(releaseLine(s, sig(CURRENT), CURRENT, 'Sara')), `${s} names no brand`);
}

if (errors.length) {
  console.error(`clientRelease: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('clientRelease: ok');
