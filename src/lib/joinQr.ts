// The coach's join link, as something a phone camera can read.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// app/(trainer)/join-code.tsx is the screen a coach opens with a person
// standing in front of them. It could already read six characters out loud,
// copy a link, and open the system share sheet. What it could not do is the
// thing that actually happens on a gym floor: the other person lifts their
// phone and points it.
//
// The header of that screen used to say there was no encoder in package.json
// and that adding one would mean a native bundle change. Half of that was
// right. There was no encoder. But `qrcode-generator` is pure JavaScript with
// no dependencies and no native code, and react-native-svg — which draws the
// result — has been a dependency since long before this, so the drawing half
// costs nothing and the computing half ships over the air like any other JS.
// That note is now corrected on the screen itself.
//
// ── The one rule this file exists to hold ──────────────────────────────────
//
// A QR IS A CLAIM THAT SCANNING IT GOES SOMEWHERE.
//
// src/lib/handOutCode.ts holds the sibling rule about the typed code: an unread
// code is not a missing one, and the screen must never print a sentence that
// sends a coach to rotate a code that was merely slow to arrive. This is the
// same danger pointed the other way. The typed code has a recovery — a person
// reads it, mistypes it, and is told the code does not exist. A QR has none. It
// is scanned in one movement by somebody who never sees the string, so a QR
// drawn over a stale, unread or withdrawn code sends a real person to a real
// wrong place and nobody involved learns that anything went wrong.
//
// So this module does not take a code. It takes the decision `codeToGive`
// already made, which is the same value the screen draws its words from. There
// is no path by which the picture and the sentence beside it can disagree,
// because there is only one decision and both read it.
//
// ── What it encodes, and why not a string of its own ───────────────────────
//
// `handOut(code).link` — which is `joinLink()` in src/lib/joinCode.ts, the same
// URL the Copy Link button puts on the clipboard, the same one inside the share
// message, and the same one a coach pastes into an Instagram bio. A QR that
// encoded anything else would be a second way into the product with its own
// attribution behaviour, and the first time the two drifted nobody would notice
// because a QR is not readable by the person maintaining it.
//
// Nothing here imports react-native or expo. The React half is the screen.
import qrcode from 'qrcode-generator';
import type { CodeToGive, HandOut } from './handOutCode';

/**
 * Error-correction level.
 *
 * 'M' recovers about 15% of a damaged symbol, which is the level every
 * general-purpose QR uses, and it is a deliberate middle. 'L' is denser to no
 * benefit on a screen that is already sharp; 'H' inflates the module count by
 * roughly a version and a half for damage tolerance a phone screen and a
 * business card do not need. Denser is not free — see MAX_MODULES.
 */
export const QR_EC_LEVEL = 'M' as const;

/**
 * The widest symbol worth drawing, in modules per side — version 10.
 *
 * Not a limit of the encoder, which goes to version 40 and 177 modules. It is a
 * limit of the thing at the other end. A QR is read here off a phone screen
 * held at arm's length, or off a card printed at a couple of centimetres, and
 * past this density the modules stop surviving either. Refusing is the honest
 * outcome: a symbol too fine to resolve does not fail visibly, it just sits
 * there while somebody waves a phone at it.
 *
 * A join link would have to be about 250 characters to reach this, which no
 * brand origin in src/lib/brands.ts comes close to. It is here so that if one
 * ever does, the screen says so rather than drawing something unreadable.
 */
export const MAX_MODULES = 57;

/**
 * The light margin around the symbol, in modules.
 *
 * Four is what the specification requires, and it is not decoration: a scanner
 * finds the symbol by locating three finder patterns against a quiet
 * background, so a QR butted up against a coloured card or a dark screen edge
 * is one a camera hunts for and often never locks onto. It is the commonest
 * reason a QR that "looks fine" does not scan.
 *
 * Expressed in modules rather than pixels so it is exact at every rendered
 * size: the caller puts it in the viewBox, not in the padding.
 */
export const QR_QUIET_ZONE = 4;

/** A finished symbol, in the only form a renderer needs. */
export type QrMatrix = {
  /** Modules per side, excluding the quiet zone. */
  count: number;
  /** Row-major; true is a dark module. */
  dark: readonly (readonly boolean[])[];
  /** Exactly the string that was encoded, for anything that has to prove it. */
  encoded: string;
};

/**
 * What the screen draws where the QR goes.
 *
 * The three non-scannable cases are three different facts and each says so in
 * its own words, for the same reason `codeToGive` splits its own: a coach told
 * "could not be read" while a read is still in flight retries something that
 * was going to arrive, and a coach told "still loading" about a failure waits
 * forever. 'unencodable' is the third — the code is real and was read, and the
 * picture is the only part that could not be made — and it must not cast doubt
 * on the six characters printed beside it.
 */
export type JoinQr =
  | { show: true; matrix: QrMatrix; hand: HandOut; a11yLabel: string }
  | { show: false; why: 'reading' | 'unread' | 'unencodable'; note: string };

/**
 * A string → the bytes a QR byte-mode segment should carry.
 *
 * `qrcode-generator`'s own default converter is `charCodeAt(i) & 0xff`, one
 * byte per UTF-16 code unit. For ASCII that is correct and for anything else it
 * is silently wrong: 'é' (U+00E9) encodes as one byte 0xE9 rather than the two
 * bytes UTF-8 requires, and '日' (U+65E5) encodes as 0xE5, which is not even a
 * truncation of the right answer — it is a different character. The symbol is
 * perfectly valid and scans to the wrong string, which is the exact failure
 * this module is here to prevent.
 *
 * So the bytes are made here and handed over as a string of code units 0–255,
 * which is the one input that converter maps through unchanged. Today's join
 * origins are ASCII and this changes nothing for them; the day a white-label
 * gym has a non-ASCII origin it is already right, rather than producing a QR
 * that works on the test bench and sends that gym's members nowhere.
 *
 * Iterating with for…of walks code POINTS, so a surrogate pair is one 4-byte
 * sequence rather than two broken 3-byte ones.
 */
export function utf8Units(text: string): string {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/**
 * One string → one symbol, or null if it could not be made.
 *
 * Null rather than a thrown error because the caller's job is to draw something
 * else, not to crash a screen a coach is standing in front of. Every way this
 * can fail — an empty string, data past the encoder's capacity, a symbol too
 * dense to scan — arrives at the same place: no picture, and a sentence saying
 * the typed code is unaffected.
 *
 * The encoder throws rather than returning on overflow, which is why the whole
 * of it is inside the try. `typeNumber: 0` asks it to choose the smallest
 * version that fits, so a short link gets a coarse symbol that scans from
 * further away.
 */
export function encodeToMatrix(text: string): QrMatrix | null {
  if (!text) return null;
  try {
    const qr = qrcode(0, QR_EC_LEVEL);
    qr.addData(utf8Units(text), 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    if (!count || count > MAX_MODULES) return null;
    const dark: boolean[][] = [];
    for (let r = 0; r < count; r += 1) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c += 1) row.push(qr.isDark(r, c));
      dark.push(row);
    }
    return { count, dark, encoded: text };
  } catch {
    // Deliberately swallowed. The encoder's own messages are about versions and
    // capacities and say nothing a coach could act on; the caller's sentence
    // does. Nothing here is a claim about the code itself.
    return null;
  }
}

/**
 * What a screen reader says about a picture with no text in it.
 *
 * A QR is the one element on this screen with no readable content at all, and
 * the label has two jobs. It must say what the thing IS, because "image" is
 * what VoiceOver otherwise offers, and it must say what scanning it DOES,
 * because a coach who cannot see it is the person most likely to be asked "what
 * do I point my phone at?" by somebody standing in front of them.
 *
 * It does not read the six characters out. They are announced by the element
 * directly above this one, one character at a time, and repeating them here
 * would make a reader hear the code twice on every pass through the screen
 * while adding nothing they did not just hear.
 */
export const QR_A11Y_LABEL =
  'QR code for your coaching code. Somebody pointing a phone camera at it opens your invite link and starts them joining you. '
  + 'The same code is written above in characters, and Share the Invite sends the link without anybody needing to scan anything.';

/**
 * The symbol as one SVG path, rather than one rectangle per dark module.
 *
 * A version 4 symbol is 33×33 and about half its modules are dark, so the naive
 * drawing is five hundred-odd <Rect> elements — five hundred native views on a
 * screen that also scrolls. One path is one view. Runs of adjacent dark modules
 * in a row are merged into a single rectangle, which typically halves the
 * subpath count again.
 *
 * Coordinates are module units; the caller sets a viewBox of `0 0 count count`
 * and scales. Integers throughout, so nothing lands on a half-pixel and blurs
 * the edge between two modules, which is the thing a scanner is measuring.
 */
export function qrPath(matrix: QrMatrix): string {
  let d = '';
  for (let r = 0; r < matrix.count; r += 1) {
    const row = matrix.dark[r];
    let c = 0;
    while (c < matrix.count) {
      if (!row[c]) { c += 1; continue; }
      let end = c;
      while (end + 1 < matrix.count && row[end + 1]) end += 1;
      const w = end - c + 1;
      d += `M${c} ${r}h${w}v1h-${w}z`;
      c = end + 1;
    }
  }
  return d;
}

/**
 * The decision, taken once, for both the picture and the words beside it.
 *
 * Takes `CodeToGive` rather than a `CodeRead` or a string, and that is the
 * whole design. The screen computes `codeToGive(read)` to decide what sentence
 * to print; this reads THAT SAME VALUE to decide whether there is a QR. A QR
 * over a code the screen is calling unread is not a bug that has to be avoided
 * here — there is no expression that produces it.
 *
 * 'reading' and 'unread' carry no note of their own: the screen is already
 * printing `give.head` and `give.note` for those two cases, and a second
 * sentence under the space where a picture would be would be the screen
 * apologising twice for one fact. 'unencodable' is the only case that needs its
 * own words, because it is the only one where the code IS good and only the
 * picture is missing.
 */
export function joinQr(give: CodeToGive): JoinQr {
  if (!give.give) {
    return {
      show: false,
      why: give.why,
      note: give.note,
    };
  }
  const matrix = encodeToMatrix(give.hand.link);
  if (!matrix) {
    return {
      show: false,
      why: 'unencodable',
      note: 'A scannable version of this link could not be drawn on this device. Your code is fine and so is the link. Read the characters out, or use Share the Invite.',
    };
  }
  return { show: true, matrix, hand: give.hand, a11yLabel: QR_A11Y_LABEL };
}
