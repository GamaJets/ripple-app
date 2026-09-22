// Does the picture we draw actually say what we think it says?
//
// Every other assertion in this file is ordinary. This one is the reason the
// file exists:
//
//   A QR THAT ENCODES THE WRONG STRING LOOKS EXACTLY LIKE ONE THAT DOES NOT.
//
// There is no reviewing a QR code. Nobody reads a module matrix, nobody spots a
// truncated URL in it, and a symbol carrying a mangled string is as crisp and
// as confident as a correct one. The only check worth anything is to DECODE it
// and compare, so that is what `decode` below does — and it decodes the matrix
// this module hands the renderer, not the encoder's internal state, because the
// matrix is the thing that ends up on glass in front of a phone.
//
// `decode` is deliberately not the encoder run backwards. It re-reads the mask
// pattern out of the symbol's own format-information bits, rebuilds the
// function-pattern map from the version, walks the data region in the order the
// specification lays it out, un-interleaves the Reed-Solomon blocks and parses
// the byte-mode segment. It shares no code with `qrcode-generator`. If the
// library changed its placement, its masking or its block interleaving, this
// would stop agreeing with it, which is the entire point.
//
// It does no error correction. It does not need any: the data codewords in a
// freshly made symbol are intact, and a decoder that could repair damage would
// also be able to repair a genuine defect into looking correct.
import {
  QR_EC_LEVEL, MAX_MODULES, QR_QUIET_ZONE, QR_A11Y_LABEL,
  utf8Units, encodeToMatrix, qrPath, joinQr, type QrMatrix,
} from './joinQr';
import { codeToGive, handOut, type CodeRead } from './handOutCode';
import { joinLink } from './joinCode';

const errors: string[] = [];
const ok = (cond: boolean, what: string) => { if (!cond) errors.push(what); };
const eq = (a: unknown, b: unknown, what: string) => {
  if (a !== b) errors.push(`${what} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

// ── the independent decoder ────────────────────────────────────────────────

/**
 * Alignment-pattern centres per version, from the QR specification's table.
 * Versions 1–10 only, which is everything `MAX_MODULES` lets through.
 */
const ALIGN: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/**
 * Reed-Solomon block structure at error-correction level M, versions 1–10,
 * as `[blocks, totalCodewords, dataCodewords]` groups from the specification.
 *
 * This is why a naive decoder gets versions 1–3 right and then quietly breaks:
 * from version 4 up at this level the symbol holds more than one block, and the
 * data codewords are INTERLEAVED across them rather than written end to end. A
 * decoder that misses that reads a plausible-looking stream of the wrong bytes.
 * The first draft of this file did exactly that and passed on the two shortest
 * links before failing on the real one.
 */
const RS_M: number[][] = [
  [1, 26, 16], [1, 44, 28], [1, 70, 44], [2, 50, 32], [2, 67, 43],
  [4, 43, 27], [4, 49, 31], [2, 60, 38, 2, 61, 39], [3, 58, 36, 2, 59, 37], [4, 69, 43, 1, 70, 44],
];

/** The eight data masks, by pattern number, exactly as the specification states them. */
const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i, _j) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
  (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0,
];

type Decoded = { version: number; maskPattern: number; text: string };

function decode(m: QrMatrix): Decoded {
  const n = m.count;
  const isDark = (r: number, c: number) => m.dark[r][c];
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > RS_M.length) {
    throw new Error(`not a symbol this decoder covers: ${n} modules`);
  }

  // Format information, vertical copy: fifteen bits down column 8, XORed with
  // the specification's 0x5412 mask. The low three bits of the payload are the
  // data mask the encoder chose — read out of the symbol rather than assumed.
  let fbits = 0;
  for (let i = 0; i < 15; i += 1) {
    const r = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
    if (isDark(r, 8)) fbits |= 1 << i;
  }
  fbits ^= 0x5412;
  const maskPattern = (fbits >> 10) & 7;

  // Which modules are structure rather than payload.
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const block = (r0: number, c0: number, r1: number, c1: number) => {
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) fn[r][c] = true;
  };
  // Three finder patterns with their separators, plus the format-information
  // strips and the fixed dark module, which together fill these corners.
  block(0, 0, 8, 8);
  block(0, n - 8, 8, n - 1);
  block(n - 8, 0, n - 1, 8);
  for (let i = 0; i < n; i += 1) { fn[6][i] = true; fn[i][6] = true; }  // timing
  const pos = ALIGN[version - 1];
  for (const r of pos) for (const c of pos) {
    // Centres landing inside a finder corner are not drawn.
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 8) || (r >= n - 8 && c <= 8)) continue;
    block(r - 2, c - 2, r + 2, c + 2);
  }
  if (version >= 7) { block(n - 11, 0, n - 9, 5); block(0, n - 11, 5, n - 9); }

  // The data region, walked in the specification's order: column pairs right to
  // left, skipping the vertical timing column, alternating up and down.
  const bits: number[] = [];
  let inc = -1;
  let row = n - 1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const cc = col - c;
        if (!fn[row][cc]) {
          let dark = isDark(row, cc);
          if (MASKS[maskPattern](row, cc)) dark = !dark;
          bits.push(dark ? 1 : 0);
        }
      }
      row += inc;
      if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
    }
  }

  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k += 1) v = (v << 1) | bits[i + k];
    stream.push(v);
  }

  // Un-interleave the blocks back into one message.
  const spec = RS_M[version - 1];
  const counts: number[] = [];
  for (let s = 0; s < spec.length; s += 3) {
    for (let k = 0; k < spec[s]; k += 1) counts.push(spec[s + 2]);
  }
  const blocks: number[][] = counts.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...counts); i += 1) {
    for (let r = 0; r < blocks.length; r += 1) if (i < counts[r]) blocks[r].push(stream[p++]);
  }
  const msg: number[] = ([] as number[]).concat(...blocks);

  // Byte-mode segment: four bits of mode, then a length, then the bytes.
  const mb: number[] = [];
  for (const b of msg) for (let k = 7; k >= 0; k -= 1) mb.push((b >> k) & 1);
  let q = 0;
  const take = (k: number) => {
    let v = 0;
    for (let i = 0; i < k; i += 1) v = (v << 1) | (mb[q++] ?? 0);
    return v;
  };
  const mode = take(4);
  if (mode !== 4) throw new Error(`expected a byte-mode segment (4), read mode ${mode}`);
  const len = take(version <= 9 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < len; i += 1) bytes.push(take(8));

  // The bytes are UTF-8, because utf8Units put them there.
  return { version, maskPattern, text: fromUtf8(bytes) };
}

/**
 * UTF-8 bytes → the string they stand for.
 *
 * Written out rather than reached for through Buffer or TextDecoder, for two
 * reasons. The app's own tsconfig compiles this file without Node's types, so
 * Buffer is not in scope here; and a decoder that shared a byte-level helper
 * with `utf8Units` would agree with it by construction, which is the one thing
 * the round trip must not do. This is the inverse of that function, written
 * independently of it.
 */
function fromUtf8(bytes: readonly number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    let extra: number;
    if (b < 0x80) { cp = b; extra = 0; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; extra = 1; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; extra = 2; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; extra = 3; }
    else throw new Error(`not a UTF-8 lead byte at ${i}: 0x${b.toString(16)}`);
    for (let k = 1; k <= extra; k += 1) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) throw new Error(`truncated UTF-8 sequence at ${i}`);
      cp = (cp << 6) | (c & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

// ── THE ROUND TRIP ─────────────────────────────────────────────────────────
//
// Encode the string the link builder produces, decode the matrix back, and
// assert the two are the same string. Anything less than equality here — a
// truncation, an escape, a byte mangled by the encoder's default converter —
// is a symbol that scans to somewhere other than the coach's join page.

const ROUND_TRIP = [
  // The real one: Repple's own origin, a real six-character code.
  joinLink('K7M2QX'),
  // A second brand's origin, which is shorter and lands on a smaller version.
  'https://www.example.com/join?c=AB23CD',
  // Long enough to cross out of single-block territory into interleaved blocks,
  // which is where a decoder that assumed one block stops being right.
  'https://a-fairly-long-white-label-gym-domain.example.co.uk/join?c=Q9WERT',
  // Non-ASCII, which is the case the library's own converter gets wrong and
  // utf8Units exists to get right. A QR is not reviewable, so this is the only
  // way that defect is ever visible.
  'https://gym-café-münchen.example.de/join?c=Z4X8VN',
];

for (const want of ROUND_TRIP) {
  const matrix = encodeToMatrix(want);
  if (!matrix) { errors.push(`round trip: nothing encoded for ${want}`); continue; }
  try {
    const got = decode(matrix);
    eq(got.text, want, `round trip through a version ${got.version} symbol`);
    eq(matrix.encoded, want, 'the matrix reports the string it actually carries');
    ok(matrix.count === matrix.dark.length, 'the matrix is as tall as it claims');
    ok(matrix.dark.every((r) => r.length === matrix.count), 'the matrix is as wide as it claims');
  } catch (e) {
    errors.push(`round trip threw for ${want}: ${(e as Error).message}`);
  }
}

// The interleaved case is the one a naive decoder gets wrong, so assert that
// the corpus above actually reaches it rather than trusting that it does.
{
  const big = encodeToMatrix(ROUND_TRIP[2]);
  ok(!!big && (big.count - 17) / 4 >= 4,
    'the long-origin case reaches version 4 or above, where the blocks interleave — otherwise the hardest half of the decoder is never exercised');
}

// A code the link builder normalises must encode the normalised form, not the
// characters somebody typed. Two QRs for one code would attribute two ways.
{
  const spaced = encodeToMatrix(handOut('k7m-2qx').link);
  const plain = encodeToMatrix(joinLink('K7M2QX'));
  ok(!!spaced && !!plain, 'both forms encode');
  eq(spaced?.encoded, plain?.encoded, 'a code typed with separators and lower case encodes the same link as the canonical one');
  eq(spaced?.encoded, joinLink('K7M2QX'), 'and that link is the one src/lib/joinCode.ts builds — not a string this module invented');
}

// ── UTF-8, which is the failure the round trip above is there to catch ─────

eq(utf8Units('AB'), 'AB', 'ASCII passes through as itself');
eq(utf8Units('é').length, 2, 'a two-byte character becomes two code units, not one');
eq(utf8Units('日').length, 3, 'a three-byte character becomes three');
eq(utf8Units('😀').length, 4, 'an astral character becomes four, not two broken three-byte sequences');
ok([...utf8Units('日')].every((ch) => ch.charCodeAt(0) <= 0xff),
  'every unit is a byte, which is the only input the encoder maps through unchanged');

// ── what it refuses, and why that is not a claim about the code ────────────

eq(encodeToMatrix(''), null, 'an empty string is not a symbol');
{
  // Past the encoder's capacity at this level, and past MAX_MODULES well before
  // that. Either way the answer is no picture rather than an unreadable one.
  const huge = encodeToMatrix('https://example.com/join?c=' + 'A'.repeat(4000));
  eq(huge, null, 'a link too long to draw is refused rather than drawn too fine to scan');
}
{
  // Right at the edge: something that fits the encoder but would exceed the
  // density this screen can be scanned at.
  const dense = encodeToMatrix('https://example.com/join?c=' + 'A'.repeat(600));
  eq(dense, null, `anything past ${MAX_MODULES} modules a side is refused`);
}
{
  const fine = encodeToMatrix(joinLink('K7M2QX'));
  ok(!!fine && fine.count <= MAX_MODULES, 'a real join link is comfortably inside the limit');
}

// ── the three states that must never render a scannable symbol ─────────────
//
// This is the other half of the file's purpose. A QR over a code that has not
// arrived, could not be read, or has been withdrawn sends a real person
// somewhere wrong in one movement, with no typo and no error message.

eq(joinQr(codeToGive({ status: 'loading' })).show, false,
  'a code still in flight draws no QR');
eq(joinQr(codeToGive({ status: 'loading' })).show === false
  ? (joinQr(codeToGive({ status: 'loading' })) as { why: string }).why : '',
  'reading', 'and it says so as "reading", not as a failure');

eq(joinQr(codeToGive({ status: 'error', reason: 'network' })).show, false,
  'a code that could not be read draws no QR');
eq(joinQr(codeToGive({ status: 'error', reason: 'network' })).show === false
  ? (joinQr(codeToGive({ status: 'error', reason: 'network' })) as { why: string }).why : '',
  'unread', 'and it is a different fact from still-loading');

eq(joinQr(codeToGive({ status: 'ready', code: '' })).show, false,
  'a code that came back empty draws no QR either — an empty read is not a code');

// A withdrawn code never reaches this module, and that is worth asserting
// rather than assuming: `codesToHandOut` in src/lib/handOutCode.ts filters to
// live rows, and the screen only ever builds a QR from `codeToGive`, which
// describes the coach's own default code. The default code lives on `trainers`
// and has no revoked_at — rotating it replaces it rather than withdrawing it.
// So the shape that must hold is that there is no way to hand this module a
// string directly from the screen: it takes a decision, never a code.
{
  const good = joinQr(codeToGive({ status: 'ready', code: 'K7M2QX' }));
  ok(good.show, 'a code that was read draws a QR');
  if (good.show) {
    eq(good.matrix.encoded, joinLink('K7M2QX'),
      'and it encodes the canonical join link, byte for byte — the same string Copy Link puts on the clipboard');
    eq(good.hand.code, 'K7M2QX', 'the typed characters travel with it, so the screen cannot draw one without the other');
    eq(decode(good.matrix).text, good.hand.link,
      'and decoding what is drawn returns exactly the link the screen offers everywhere else');
  }
}

// Every non-showing case must carry words. A blank space where a picture was is
// a screen that looks broken rather than one that is being honest.
for (const read of [
  { status: 'loading' },
  { status: 'error', reason: null },
  { status: 'ready', code: '' },
] as CodeRead[]) {
  const q = joinQr(codeToGive(read));
  ok(!q.show && q.note.trim().length > 0, `the ${read.status} case says something rather than nothing`);
}

// The unread note must not contradict the code. This is handOutCode's rule and
// the QR inherits it: nothing here may suggest the coach should issue a new one.
{
  const q = joinQr(codeToGive({ status: 'error', reason: 'offline' }));
  ok(!q.show && /still have one|not about your code|unaffected|is fine/i.test(q.note),
    'the unread note keeps saying the code itself is unaffected');
}

// ── the path, which is what actually gets drawn ────────────────────────────

{
  const m = encodeToMatrix(joinLink('K7M2QX')) as QrMatrix;
  const d = qrPath(m);
  ok(d.length > 0, 'a symbol produces a path');
  ok(d.startsWith('M'), 'which begins with a move');
  ok(!/NaN|undefined/.test(d), 'and contains no NaN or undefined, which render as nothing at all');

  // Every dark module must be covered exactly once, and no light one. Rebuild
  // the matrix from the path and compare: a path that drew the right NUMBER of
  // rectangles in the wrong places would pass a count and fail this.
  const back: boolean[][] = Array.from({ length: m.count }, () => new Array<boolean>(m.count).fill(false));
  const re = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
  let match: RegExpExecArray | null;
  let drawn = 0;
  while ((match = re.exec(d)) !== null) {
    const c = Number(match[1]);
    const r = Number(match[2]);
    const w = Number(match[3]);
    for (let i = 0; i < w; i += 1) { back[r][c + i] = true; drawn += 1; }
  }
  const wanted = m.dark.reduce((n, row) => n + row.filter(Boolean).length, 0);
  eq(drawn, wanted, 'the path covers exactly as many modules as are dark');
  ok(back.every((row, r) => row.every((v, c) => v === m.dark[r][c])),
    'and covers exactly the RIGHT ones — a path drawn from the matrix reconstructs the matrix');

  // Runs are merged, so the subpath count is below the dark-module count.
  const subpaths = (d.match(/M/g) || []).length;
  ok(subpaths < wanted, 'adjacent modules in a row are merged into one rectangle rather than drawn one by one');
}

// ── the fixed choices, asserted so a silent change is a failing test ───────

eq(QR_EC_LEVEL, 'M', 'the error-correction level is M');
eq(MAX_MODULES, 57, 'the density ceiling is version 10');
eq(QR_QUIET_ZONE, 4, 'the quiet zone is the four modules the specification requires — the commonest cause of a QR that looks right and will not scan');
ok(/QR code/i.test(QR_A11Y_LABEL), 'the accessibility label says what the image IS');
ok(/scan|camera|point/i.test(QR_A11Y_LABEL), 'and what pointing a camera at it DOES');
ok(/above|Share the Invite/i.test(QR_A11Y_LABEL),
  'and names the way through for somebody who cannot scan it');

if (errors.length) {
  console.error(`joinQr.test.ts — ${errors.length} failures:`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('joinQr.test.ts — ok');
