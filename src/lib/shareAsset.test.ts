// The shareable asset: what may go on it, what may never, and what happens
// when the figures behind it were not read. Compile with tsc, run with node.
//
// What is defended here is a graphic that leaves the phone. Every other screen
// in this app can be wrong for as long as somebody is looking at it and then be
// fixed; a post is wrong on Instagram for ever, under the coach's own name, in
// front of the audience they are trying to win. So the assertions below are
// about three failures that would each survive a typecheck, a bundle and a
// visual once-over:
//
//   1. a figure that was never read publishing itself as 0 — the repo's oldest
//      bug (scripts/check-reads.mjs), and the version of it with the longest
//      half-life;
//   2. a client's name reaching a caption because the coach typed it there
//      themselves, having ticked only "you may post my numbers";
//   3. text running off the edge of a fixed-size SVG, silently, in the exported
//      PNG that nobody opens again before posting it.
import {
  wrapLines, charsPerLine, scrubName, weekCard, resultCard, hoursLabel,
  assetFilename, firstName, lower, cardSize, CARD_SIZES,
} from './shareAsset';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1. a figure that was not read is never published as zero ─────────────── */

// All three null: the read failed. This is the case that must NEVER become a
// card, because the card it would make says the coach did nothing this week.
const unread = weekCard({ brand: 'Warehouse', spanLabel: 'Last 7 days', sessions: null, minutes: null, clients: null });
eq(unread.ok, false, 'a week with nothing read does not build a card');
ok(!unread.ok && unread.reason === 'unread', 'and it says the read failed');
ok(!unread.ok && !/\b0\b/.test(unread.why), 'the reason given never shows the reader a zero');

// All three zero: the week genuinely was empty. Also refused — but this is the
// coach's own week, not a failure, and the sentence has to be the other one or
// they will sit there retrying a connection that is fine.
const empty = weekCard({ brand: 'Warehouse', spanLabel: 'Last 7 days', sessions: 0, minutes: 0, clients: 0 });
eq(empty.ok, false, 'an empty week does not build a card either');
ok(!empty.ok && empty.reason === 'empty', 'and it is told apart from a failed read');
ok(!empty.ok && unread.ok === false && empty.why !== unread.why,
  'the two refusals do not share a sentence — one is "try again", the other is "go and coach somebody"');

// A partial read is a real card with fewer lines on it, not a card with a zero.
const partial = weekCard({ brand: 'Warehouse', spanLabel: 'Last 7 days', sessions: 12, minutes: null, clients: null });
ok(partial.ok, 'one real figure is enough to build a card');
if (partial.ok) {
  eq(partial.card.stats.length, 1, 'the unread figures are dropped, not zeroed');
  ok(!partial.card.stats.some((s) => s.value === '0'), 'no stat reads 0');
  eq(partial.card.headline, '12 sessions coached', 'the headline is the figure that exists');
  ok(!/0 clients|0 hrs|0 min/.test(partial.card.caption), 'and the caption invents nothing either');
}

// A zero alongside a real figure is impossible from the same rows, and would be
// a self-contradiction on a graphic. It is dropped rather than printed.
const mixed = weekCard({ brand: 'Warehouse', spanLabel: 'Last 7 days', sessions: 9, minutes: 540, clients: 0 });
ok(mixed.ok, 'a week with two real figures builds');
if (mixed.ok) {
  eq(mixed.card.stats.length, 2, 'the zero is not one of the lines');
  ok(!mixed.card.stats.some((s) => s.label === 'Clients'), 'specifically, "0 clients" is absent');
}

// Singular and plural, because "1 sessions coached" on a graphic is the sort of
// thing that gets screenshotted back at you.
const one = weekCard({ brand: 'W', spanLabel: 'Last 7 days', sessions: 1, minutes: 60, clients: 1 });
ok(one.ok && one.card.headline === '1 session coached', 'one session is singular');

const many = weekCard({ brand: 'Warehouse Gym', spanLabel: 'Last 7 days', sessions: 1240, minutes: 74_400, clients: 86 });
ok(many.ok && many.card.stats[0].value === (1240).toLocaleString(),
  'a four-figure session count carries its thousands separator, as everywhere else in the app');
ok(many.ok && many.card.footer === 'Warehouse Gym', 'the footer is the tenant, never a hardcoded brand');

// The caption is a sentence somebody could have written, not a filled-in
// template: the headline figure is not repeated in the list below it, and the
// stat labels are not Title Case in the middle of a line.
const week = weekCard({ brand: 'Warehouse Gym', spanLabel: 'Last 7 days', sessions: 18, minutes: 1080, clients: 11 });
if (week.ok) {
  eq(week.card.caption, '18 sessions coached — last 7 days.\n18 hrs coached · 11 clients',
    'the caption reads as prose, with the headline figure not restated');
} else { errors.push('a full week should build a card'); }

// An unnamed brand falls back rather than rendering an empty footer — a card
// with a blank strip along the bottom looks broken, not minimal.
const noBrand = weekCard({ brand: '   ', spanLabel: 'Last 7 days', sessions: 3, minutes: null, clients: null });
ok(noBrand.ok && noBrand.card.footer === 'Repple', 'a blank brand falls back to Repple');

/* ── 2. nothing identifying a client leaves without an in-the-moment choice ── */

const figures = [{ label: 'Weight', value: '−8.4 kg' }, { label: 'Body fat', value: '−4.1%' }];

// No consent, no card. Not a warning, not a dimmed button — there is no object
// to hand to the share sheet.
const noConsent = resultCard(
  { brand: 'Warehouse', clientName: 'Sarah Jones', spanLabel: '12 weeks in', figures, note: 'Sarah smashed it.' },
  { figures: false, name: false },
);
eq(noConsent.ok, false, 'a client result without consent does not build');
ok(!noConsent.ok && noConsent.reason === 'consent', 'and it says why');

// Figures agreed, name NOT agreed. The card must carry no name — and neither
// must the caption, which is where the coach put it without thinking.
const anon = resultCard(
  { brand: 'Warehouse', clientName: 'Sarah Jones', spanLabel: '12 weeks in', figures, note: "Sarah's consistency did this. Sarah showed up every week." },
  { figures: true, name: false },
);
ok(anon.ok, 'figures-only consent builds a card');
if (anon.ok) {
  const everything = JSON.stringify(anon.card);
  ok(!/Sarah/i.test(everything), 'the client’s first name appears NOWHERE on the card or in the caption');
  ok(!/Jones/i.test(everything), 'nor their surname');
  eq(anon.card.kicker, 'A client I coach', 'the card says who it is about without saying who it is');
  ok(anon.card.caption.includes('−8.4 kg'), 'the figures they agreed to are still there');
}

// Figures AND name agreed. The first name prints; the surname still does not —
// a surname adds nothing to the post and a lot to how findable the person is.
const named = resultCard(
  { brand: 'Warehouse', clientName: 'Sarah Jones', spanLabel: '12 weeks in', figures, note: 'Sarah smashed it.' },
  { figures: true, name: true },
);
ok(named.ok, 'full consent builds a card');
if (named.ok) {
  eq(named.card.kicker, 'Sarah', 'the first name is on the card');
  ok(!JSON.stringify(named.card).includes('Jones'), 'the surname is not, even with consent');
  ok(named.card.caption.includes('Sarah smashed it.'), 'the coach’s own sentence is left exactly as typed');
}

// Consent is per-share and cannot be inferred: naming without agreeing to the
// figures is not a lesser permission that implies the greater one.
const nameOnly = resultCard(
  { brand: 'W', clientName: 'Sarah', spanLabel: '12 weeks', figures, note: '' },
  { figures: false, name: true },
);
eq(nameOnly.ok, false, 'agreeing to be named is not agreeing to have your numbers posted');

// No figures picked: refused, and distinctly from the consent refusal, because
// the coach fixes them in two different places.
const nothing = resultCard(
  { brand: 'W', clientName: 'Sarah', spanLabel: '12 weeks', figures: [], note: '' },
  { figures: true, name: true },
);
ok(!nothing.ok && nothing.reason === 'nothing-picked', 'no figures is its own refusal');

// A figure with an empty value is not a figure. This is how "—" gets onto a
// graphic: the caller passes the em-dash their screen renders for a missing
// reading, and the card prints it as if it meant something.
const blankFigure = resultCard(
  { brand: 'W', clientName: 'Sarah', spanLabel: '12 weeks', figures: [{ label: 'Weight', value: '  ' }], note: '' },
  { figures: true, name: true },
);
ok(!blankFigure.ok && blankFigure.reason === 'nothing-picked', 'a blank value is not a figure');

/* ── scrubName, the leak it is actually there to stop ─────────────────────── */

eq(scrubName('Sarah was brilliant', 'Sarah Jones'), 'My client was brilliant',
  'a name at the start of a sentence is replaced and the sentence still starts with a capital');
eq(scrubName('Huge week from Sarah', 'Sarah'), 'Huge week from my client',
  'a name mid-sentence stays lower case');
eq(scrubName("Sarah's consistency", 'Sarah'), "My client's consistency",
  'the possessive survives as a possessive');
eq(scrubName('Sarah Jones did it', 'Sarah Jones'), 'My client did it',
  'the full name goes as one replacement, not "my client Jones"');
eq(scrubName('Well done SARAH', 'Sarah'), 'Well done my client',
  'shouting the name does not evade it');

// The word-boundary cases. A scrubber that mauls ordinary words is a scrubber
// coaches will work around, which is worse than one that is slightly narrower.
eq(scrubName('Same session, same result', 'Sam'), 'Same session, same result',
  '"Sam" does not match inside "Same"');
eq(scrubName('Ali trains on Wednesdays', 'Al'), 'Ali trains on Wednesdays',
  'nor "Al" inside "Ali"');
eq(scrubName('Read the alignment notes', 'Ali'), 'Read the alignment notes',
  'nor "Ali" inside "alignment"');

// Regex metacharacters in a name. A client called "J. R." would otherwise
// compile "J." into "any character", which quietly redacts half the caption.
eq(scrubName('J. was great, and so was Kim', 'J.'), 'My client was great, and so was Kim',
  'a full stop in a name is a full stop, not a wildcard');

// Nothing to do is nothing done — no name, no client, no crash.
eq(scrubName('A great twelve weeks', null), 'A great twelve weeks', 'a null name leaves the text alone');
eq(scrubName('A great twelve weeks', '  '), 'A great twelve weeks', 'so does a blank one');
eq(scrubName('', 'Sarah'), '', 'and an empty caption stays empty');

// Two mentions in a row collapse rather than stuttering.
eq(scrubName('Sarah Sarah!', 'Sarah'), 'My client!', 'a doubled name does not become "my client my client"');

eq(firstName('Sarah Jones'), 'Sarah', 'the first name is the first word');
eq(firstName('  '), null, 'a blank name has no first name');
eq(firstName(null), null, 'nor does a missing one');

/* ── 3. text that will not fit is wrapped here, not on the card ───────────── */

eq(wrapLines('', 20, 3).length, 0, 'empty text is no lines at all, not one empty line');
eq(wrapLines('   ', 20, 3).length, 0, 'whitespace-only text likewise');
eq(JSON.stringify(wrapLines('Twelve weeks in', 20, 3)), JSON.stringify(['Twelve weeks in']),
  'text that fits is one line');
eq(JSON.stringify(wrapLines('Twelve weeks of very hard work', 12, 3)),
  JSON.stringify(['Twelve weeks', 'of very hard', 'work']),
  'a greedy wrap fills each line up to the limit');

const wrapped = wrapLines('one two three four five six seven eight nine ten eleven twelve', 10, 3);
eq(wrapped.length, 3, 'it never returns more lines than asked for');
ok(wrapped.every((l) => l.length <= 10), 'and no line is over the limit');
ok(wrapped[2].endsWith('…'), 'the cut is marked, so a reader can see something was dropped');

// The case that actually overflows an SVG: one token longer than the line. A
// gym's Instagram handle, a hashtag, a German compound.
const long = wrapLines('#TransformationTuesdayAtTheWarehouse', 12, 3);
ok(long.every((l) => l.length <= 12), 'a word longer than the line is hard broken, never allowed to overhang');
ok(long.length <= 3, 'and it still respects the line budget');

const mix = wrapLines('Come to #TransformationTuesdayAtTheWarehouse today', 12, 4);
ok(mix.every((l) => l.length <= 12), 'a long word mixed with short ones does not overhang either');

eq(wrapLines('anything', 0, 3).length, 0, 'a zero-width line yields nothing rather than looping');
eq(wrapLines('anything', 10, 0).length, 0, 'and a zero-line budget likewise');

// The estimate behind the wrap. Approximate by design — but it must be
// monotonic, or a bigger card would fit fewer characters than a smaller one.
ok(charsPerLine(920, 64) > 0, 'a real width and size give a real line length');
ok(charsPerLine(920, 64) > charsPerLine(920, 96), 'bigger type fits fewer characters');
ok(charsPerLine(1840, 64) > charsPerLine(920, 64), 'a wider card fits more');
eq(charsPerLine(0, 64), 0, 'a zero width fits nothing');
eq(charsPerLine(920, 0), 0, 'and a zero font size is not a division by zero');

/* ── figures and labels ───────────────────────────────────────────────────── */

eq(hoursLabel(60), '1 hrs', 'an hour is an hour');
eq(hoursLabel(1440), '24 hrs', 'a whole number of hours carries no decimal point');
eq(hoursLabel(90), '1.5 hrs', 'a half hour does');
eq(hoursLabel(45), '45 min', 'under an hour stays in minutes rather than rounding to "0 hrs"');
eq(hoursLabel(0), '0 min', 'zero is zero minutes — the caller decides whether to print it');
eq(hoursLabel(-5), '', 'a negative duration is not a duration');
eq(hoursLabel(Number.NaN), '', 'and NaN never reaches a graphic');

eq(lower('Last 7 days'), 'last 7 days', 'a capitalised span reads as a fragment mid-sentence');
eq(lower('August'), 'August', 'a month keeps its capital');
eq(lower('This month'), 'this month', 'so does an ordinary determiner get lowered');
eq(lower(''), '', 'and an empty span stays empty');

/* ── the exported file ────────────────────────────────────────────────────── */

const fn = assetFilename('week', new Date(2026, 7, 31, 9, 5));
eq(fn, 'repple-week-2026-08-31-0905.png', 'the filename is dated, so a camera roll does not fill with image.png');
ok(!/[/\\:?*"<>|]/.test(fn), 'and carries no character that would turn it into a path');
ok(assetFilename('result').endsWith('.png'), 'a result card is a PNG too');

eq(CARD_SIZES.length, 2, 'two shapes, because a square is never the right answer where 4:5 is accepted');
eq(cardSize('story').h, 1920, 'the story canvas is a full-height 9:16');
eq(cardSize('post').w, 1080, 'and the post is 1080 wide');
// A shape the caller invented must not produce a zero-sized canvas — that
// exports a 0×0 PNG, which every network accepts and nobody can see.
ok(cardSize('nonsense' as never).w > 0, 'an unknown shape falls back to a real canvas, never a 0×0 one');

/* ── report ───────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`shareAsset: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('shareAsset: ok');
