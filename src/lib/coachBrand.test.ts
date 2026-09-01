// A coach's branding, and the two things it must never be able to do: make an
// unreadable app, and take the app's own name.
//
// The precedence rule is tested here as arithmetic rather than argued about in
// review, because "whose brand wins" is a question every future screen will ask
// and there must be exactly one answer to read.
import {
  MAX_BRAND_NAME, RESERVED_BRAND_NAMES, bestInkRatio, clientBrandNote, coachBrandColorOf,
  coachBrandNameOf, expandHex, isReadableBrandColor, parseCoachBrandColor, parseCoachBrandName,
  resolveClientBrand,
} from './coachBrand';
import { AA_TEXT, contrastRatio, readableInkOn } from './a11y';
import { brandInkFor } from '../theme/tokens';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── shorthand, which is where the unreadable button was hiding ───────────── */

eq(expandHex('#0f0'), '#00ff00', 'three-digit shorthand expands rather than being refused');
// Three DIFFERENT digits, in order. '#0f0' alone cannot catch an expansion
// that doubles the wrong nibble, because two of its three are the same —
// which is exactly the mutation that survived the first run of this file.
eq(expandHex('#1a7'), '#11aa77', 'each digit is doubled in place, not borrowed from its neighbour');
eq(expandHex('#abc'), '#aabbcc', 'and the order survives the expansion');
eq(expandHex('#1F6FEB'), '#1f6feb', 'and six-digit hex normalises to lower case');
eq(expandHex('1f6feb'), '#1f6feb', 'a missing hash is repaired here, unlike in the theme');
eq(expandHex('#1f6fe'), null, 'five digits is not a colour');
eq(expandHex('#1f6feba0'), null, 'eight digits is refused rather than truncated to a different colour');
eq(expandHex('green'), null, 'a colour name is not a hex');
eq(expandHex(''), null, 'and neither is nothing');
eq(expandHex(null), null, 'nor a column nobody has written');

// The reason expandHex exists at all. a11y.ts refuses shorthand on purpose, so
// brandInkFor falls back to WHITE on '#0f0' — which is the 1.37:1 button label
// this boundary is here to stop reaching a client.
eq(contrastRatio('#0f0', '#ffffff'), null, 'a11y.ts cannot measure shorthand, which is why it is expanded first');
ok((contrastRatio(brandInkFor('#0f0'), '#00ff00') as number) < AA_TEXT,
  'brandInkFor on unexpanded shorthand really does produce an unreadable label');
ok((contrastRatio(brandInkFor(expandHex('#0f0')!), '#00ff00') as number) >= AA_TEXT,
  'and expanding it first fixes exactly that');

/* ── the readability gate ─────────────────────────────────────────────────── */

// The case a11y.ts was rewritten for: a bright green an owner might plausibly
// type. Black clears it comfortably, so it is allowed.
ok(isReadableBrandColor('#00ee00'), 'bright green is usable, because black reads on it');
ok(isReadableBrandColor('#000000'), 'black is usable, because white reads on it');
ok(isReadableBrandColor('#ffffff'), 'white is usable, because black reads on it');
// The genuinely unachievable band: mid-toned colours where neither ink clears
// 4.5:1. a11y.ts puts these at about 4% of all colours, and they are not exotic
// ones. #0077ee is an ordinary brand blue and #008888 is a teal a
// stone's throw from the app's own, and neither black nor white reaches 4.5:1
// on either — 4.33 and 4.34. This is the 4% band, and it is full of the colours
// a coach would actually reach for.
ok(!isReadableBrandColor('#0077ee'), 'an ordinary brand blue is refused, because no label reads on it');
ok(!isReadableBrandColor('#008888'), 'and so is a teal that looks perfectly reasonable');
// The >= at the threshold is NOT observable over this domain, and saying so is
// better than a test that pretends otherwise: no 8-bit hex has a best-ink
// ratio of exactly 4.5. The nearest grey is #777777 at 4.478, and a full
// sweep finds no colour on the line at all — so nothing here can tell >= from
// >, and a mutation swapping them survives on purpose.
ok(Math.abs((bestInkRatio('#777777') as number) - AA_TEXT) < 0.03,
  'the closest colour to the threshold sits just under it, which is why the boundary itself is untestable');
eq(isReadableBrandColor('#zzz'), false, 'an unparseable colour is not readable, rather than throwing');
eq(isReadableBrandColor(null), false, 'and neither is nothing');

// The gate is exactly the number brandInkFor would achieve, never a guess.
for (const hex of ['#00ee00', '#1f6feb', '#0077ee', '#008888', '#0d9488']) {
  const six = expandHex(hex)!;
  eq(bestInkRatio(hex), contrastRatio(readableInkOn(six), six),
    `${hex}: the ratio reported is the one the app would actually draw`);
  eq(isReadableBrandColor(hex), (bestInkRatio(hex) as number) >= AA_TEXT,
    `${hex}: usable is exactly "reaches AA", with no rounding of its own`);
}

// Exhaustive, in the manner of a11y.test.ts's own grid: nothing this accepts
// can produce a sub-AA button label. This is the property the whole file exists
// for, and a sampled version of it would not be worth having.
let accepted = 0, unreadableAccepted = 0;
for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (let b = 0; b < 256; b += 5) {
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const parsed = parseCoachBrandColor(hex);
  if (parsed.kind !== 'color') continue;
  accepted++;
  if ((contrastRatio(brandInkFor(parsed.color), parsed.color) as number) < AA_TEXT) unreadableAccepted++;
}
ok(accepted > 100000, `the grid actually accepted a population worth checking (${accepted})`);
eq(unreadableAccepted, 0, `no colour this accepts yields a sub-AA button label (${unreadableAccepted} of ${accepted})`);

/* ── what the coach types ─────────────────────────────────────────────────── */

const colorOf = (s: string | null) => { const p = parseCoachBrandColor(s); return p.kind === 'color' ? p.color : p.kind; };
eq(colorOf('#1f6feb'), '#1f6feb', 'a good hex is taken');
eq(colorOf('  #1F6FEB  '), '#1f6feb', 'and normalised, so two devices agree it is the same colour');
eq(colorOf('#0f0'), '#00ff00', 'shorthand is stored expanded, not as typed');
eq(colorOf(''), 'clear', 'an empty field clears the colour rather than storing one');
eq(colorOf('   '), 'clear', 'and so does a field holding only spaces');
eq(colorOf(null), 'clear', 'and so does no field at all');
eq(colorOf('teal'), 'bad', 'a colour name is refused');
eq(colorOf('#0077ee'), 'bad', 'and so is a colour no label could be read on');

// The refusal has to be actionable. A coach told only "that failed" tries the
// shade next door; one shown both numbers can see which way to move.
const refused = parseCoachBrandColor('#0077ee');
ok(refused.kind === 'bad' && /4\.5:1/.test(refused.reason), 'the refusal names the target ratio');
ok(refused.kind === 'bad' && /[0-9]\.[0-9]:1/.test(refused.reason), 'and the ratios actually measured');
ok(refused.kind === 'bad' && !/#0077ee/.test(refused.reason), 'without echoing the hex back as though it were the problem word');

/* ── the trading name, and the line it may not cross ─────────────────────── */

const nameOf = (s: string | null) => { const p = parseCoachBrandName(s); return p.kind === 'name' ? p.name : p.kind; };
eq(nameOf('Hart Strength'), 'Hart Strength', 'a trading name is taken as typed');
eq(nameOf('  Hart   Strength '), 'Hart Strength', 'with interior runs of space collapsed, as gym names are');
eq(nameOf(''), 'clear', 'blank clears — a coach with no trading name coaches under their own');
eq(nameOf(null), 'clear', 'and so does nothing at all');
eq(nameOf('x'.repeat(MAX_BRAND_NAME)), 'x'.repeat(MAX_BRAND_NAME), 'the longest allowed name is allowed');
eq(nameOf('x'.repeat(MAX_BRAND_NAME + 1)), 'bad', 'one character more is not');

// The app's identity is not a coach's to take. This is the roadmap's own line —
// the app is Repple's, the coaching inside it is theirs — made enforceable.
ok(RESERVED_BRAND_NAMES.includes('Repple'), 'the running brand reserves its own family name');
ok(RESERVED_BRAND_NAMES.includes('Repple Coach'), 'and each of its three app names');
eq(nameOf('Repple'), 'bad', 'a coach may not trade as the app');
eq(nameOf('repple'), 'bad', 'in any case');
eq(nameOf('Rep-ple'), 'bad', 'or with punctuation between the letters');
eq(nameOf(' REPPLE '), 'bad', 'or with room around it');
eq(nameOf('Repple Studio'), 'bad', 'the owner app is reserved too');
eq(nameOf('Repple Strength'), 'Repple Strength', 'but a name that merely contains it is a name, not an impersonation');
// Passed explicitly, so a white-label brand's own reserved list is testable
// without building that brand.
eq(parseCoachBrandName('Example Fitness', ['Example Fitness']).kind, 'bad',
  'another brand reserves its own name in its own build');
eq(parseCoachBrandName('Repple', ['Example Fitness']).kind, 'name',
  'and reserves only its own — the list is the build talking, not a global block list');

eq(coachBrandNameOf('  Hart  Strength '), 'Hart Strength', 'a name read back is normalised the same way');
eq(coachBrandNameOf('   '), null, 'a whitespace-only name is no name');
eq(coachBrandNameOf(null), null, 'and neither is null');

/* ── the render-side guard ────────────────────────────────────────────────── */

eq(coachBrandColorOf('#00EE00'), '#00ee00', 'a stored colour comes back normalised');
eq(coachBrandColorOf('#0f0'), '#00ff00', 'and expanded');
eq(coachBrandColorOf('#0077ee'), null, 'a stored colour that cannot carry a label does not apply, however it got there');
eq(coachBrandColorOf('rgba(0,0,0,0.5)'), null, 'nor does anything the theme could not parse');
eq(coachBrandColorOf(null), null, 'a coach who chose no colour has no colour');

/* ── whose brand wins ─────────────────────────────────────────────────────── */

const coach = { name: 'Leanne Hart', brandName: 'Hart Strength', color: '#1f6feb' };

eq(resolveClientBrand({ inGym: false, coach }).source, 'coach',
  'an independent client wears their coach’s brand — the whole point of the item');
eq(resolveClientBrand({ inGym: false, coach }).name, 'Hart Strength', 'under the coach’s trading name');
eq(resolveClientBrand({ inGym: false, coach }).color, '#1f6feb', 'and the coach’s colour');

// The conflict this item turns on.
const both = { inGym: true, gym: { name: 'Iron Works', color: '#0d9488' }, coach };
eq(resolveClientBrand(both).source, 'gym', 'a gym member with a coach wears the GYM’s brand');
eq(resolveClientBrand(both).name, 'Iron Works', 'the gym’s name');
eq(resolveClientBrand(both).color, '#0d9488', 'and the gym’s colour');

// And it is not conditional on the gym having chosen anything. This is the case
// that would quietly hand every un-branded gym's members to their trainer.
const unbranded = { inGym: true, gym: null, coach };
eq(resolveClientBrand(unbranded).source, 'gym', 'a gym that has chosen nothing still speaks for its members');
eq(resolveClientBrand(unbranded).color, null, 'so the app keeps its own colour rather than taking the coach’s');
eq(resolveClientBrand({ inGym: true, coach }).color, null, 'and the same when the gym cannot be read at all');

// A coach who has branded nothing is not a brand.
eq(resolveClientBrand({ inGym: false, coach: { name: 'Leanne Hart' } }).source, 'app',
  'a coach with no trading name and no colour has not branded anything');
eq(resolveClientBrand({ inGym: false, coach: null }).source, 'app', 'and a client with no coach certainly has not');
eq(resolveClientBrand({ inGym: false }).source, 'app', 'nor one whose coach is simply absent from the answer');

// Half a brand is still a brand, and falls back to the person's own name only
// because that is the name their client already sees.
const colourOnly = resolveClientBrand({ inGym: false, coach: { name: 'Leanne Hart', color: '#1f6feb' } });
eq(colourOnly.source, 'coach', 'a colour alone is branding');
eq(colourOnly.name, 'Leanne Hart', 'shown under the coach’s own name, which is not an invented default');
const nameOnly = resolveClientBrand({ inGym: false, coach: { name: 'Leanne Hart', brandName: 'Hart Strength' } });
eq(nameOnly.source, 'coach', 'a trading name alone is branding too');
eq(nameOnly.color, null, 'with no colour invented to go with it');

// An unreadable colour never reaches a screen, whichever party set it.
eq(resolveClientBrand({ inGym: false, coach: { name: 'A', color: '#0077ee' } }).source, 'app',
  'an unreadable coach colour is no colour, so a coach with only that has no brand');
eq(resolveClientBrand({ inGym: true, gym: { name: 'Iron Works', color: '#0077ee' } }).color, null,
  'and an unreadable GYM colour is refused by the same measurement');

/* ── the sentence the client reads ────────────────────────────────────────── */

eq(clientBrandNote({ inGym: true, gym: { name: 'Iron Works' }, coach }),
  'You train at a gym, so this app wears your gym’s branding rather than your coach’s.',
  'a gym member whose coach has branding is told why they cannot see it');
eq(clientBrandNote({ inGym: true, gym: { name: 'Iron Works' }, coach: { name: 'Leanne Hart' } }), null,
  'and one whose coach has none is told nothing, because nothing was overridden');
// Half a brand is enough to have been overridden, and the client is owed the
// sentence either way. Both halves are checked because a coach who had set
// only a colour, or only a name, was silently told nothing on the first run.
eq(clientBrandNote({ inGym: true, coach: { name: 'Leanne Hart', color: '#1f6feb' } }),
  'You train at a gym, so this app wears your gym\u2019s branding rather than your coach\u2019s.',
  'a coach who had set only a colour is still a coach whose branding was overridden');
eq(clientBrandNote({ inGym: true, coach: { name: 'Leanne Hart', brandName: 'Hart Strength' } }),
  'You train at a gym, so this app wears your gym\u2019s branding rather than your coach\u2019s.',
  'and so is one who had set only a trading name');
ok((clientBrandNote({ inGym: false, coach }) ?? '').includes('Hart Strength'),
  'an independent client is told whose colours these are');
ok((clientBrandNote({ inGym: false, coach }) ?? '').includes('Repple makes the app'),
  'and that the app is still the publisher’s — the line the roadmap draws');
eq(clientBrandNote({ inGym: false, coach: null }), null, 'a client with no coach has nothing to be told');

// Never a sentence built around a value that is missing — check:prose exists
// because a dash as the subject of a sentence reads as a broken screen.
const anonymous = clientBrandNote({ inGym: false, coach: { name: null, color: '#1f6feb' } });
eq(anonymous, 'These are your coach’s colours. Repple makes the app; your coaching is theirs.',
  'a nameless coach gets a description rather than a hole where the name goes');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`coachBrand: ok (${accepted} colours accepted, none unreadable; the gym wins)`);
