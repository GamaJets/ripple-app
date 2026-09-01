// An independent coach's branding: what they may set, and whose brand wins.
//
// The gym's equivalent is `tenants.name` + `tenants.brand_color`, parsed by
// src/lib/gymSettings.ts. This is the same job for a coach, and it is a
// separate file rather than four more exports there because the two differ in
// the one place that matters: an owner picks from ten curated swatches, and a
// coach types a hex. Everything below exists because of that difference.
//
// supabase/parts/153 is the schema and the measurements behind it. The short
// version: a solo coach already has a tenant, cannot write it, and no client is
// ever in it — so a coach's brand hangs off `trainers`, and reaches their
// clients through `my_coach_brand()` over the active-coaching gate.
//
// Pure. No react, no supabase, no theme. src/ui/coachBrand.ts does the talking.

import {
  AA_TEXT, INK_ON_DARK, INK_ON_LIGHT, contrastRatio, readableInkOn,
} from './a11y';
import { BRAND } from './brands';

/* ── the colour ───────────────────────────────────────────────────────────── */

/**
 * A hex, widened to the six-digit form the measuring code can actually read.
 *
 * `rgb()` in a11y.ts accepts SIX digits only, and its test says so on purpose
 * ("three-digit shorthand is not accepted") — a half-parsed colour returning a
 * confident wrong number is worse than one that refuses. The consequence lands
 * here: `brandInkFor('#0f0')` cannot measure it, falls back to white, and
 * writes a 1.37:1 label onto a bright green button. `tenants.brand_color`
 * already permits the three-digit form; nothing reaches it today only because
 * an owner picks from swatches, and a coach typing "#0f0" would walk straight
 * into it.
 *
 * So shorthand is expanded HERE, at the boundary, and the six-digit form is
 * what gets stored and what gets drawn. a11y.ts is left alone: it is the thing
 * every other check measures against, and loosening its parser to fix a caller
 * is the wrong direction.
 */
export function expandHex(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return null;
  const d = m[1];
  return '#' + (d.length === 3 ? d[0] + d[0] + d[1] + d[1] + d[2] + d[2] : d);
}

/**
 * The contrast the app would actually achieve on this colour, having chosen the
 * better of black and white for the label — or null when it cannot be measured.
 *
 * This is `brandInkFor()`'s own decision, measured. It is the number a coach is
 * shown when their colour is refused, because "that colour is not accessible"
 * teaches nobody anything and "black on it reaches 3.4:1, and a button label
 * needs 4.5:1" tells them to go darker.
 */
export function bestInkRatio(hex: string | null | undefined): number | null {
  const six = expandHex(hex);
  if (!six) return null;
  return contrastRatio(readableInkOn(six), six);
}

/**
 * Whether a colour can carry a readable button label.
 *
 * 4.5:1, AA_TEXT, and not the 3:1 large-text allowance: the Cta label is 13pt
 * at weight 600, `isLargeText` says that is not large, and scale.ts caps weight
 * at 600 so it never will be.
 *
 * About 4% of all colours fail this and no ink saves them — a11y.ts says so and
 * the exhaustive grid in a11y.test.ts measures it. For those the brand colour
 * itself is the problem, which is why this refuses rather than compensates.
 */
export function isReadableBrandColor(hex: string | null | undefined): boolean {
  const r = bestInkRatio(hex);
  return r != null && r >= AA_TEXT;
}

/**
 * A colour read back from `trainers.brand_color` that may be handed to the
 * theme, or null.
 *
 * The RENDER-side half of the gate, and it is not redundant with the parse-side
 * half below. The database checks the SHAPE of that column and deliberately not
 * its legibility (part 153 explains why a second WCAG implementation in SQL was
 * refused), so a value that arrived by some route other than the coach's own
 * screen — curl with the anon key, a future importer, a column widened later —
 * still cannot reach a button. It simply does not apply and the app keeps its
 * own colour, which is the same thing that happens for a coach who chose none.
 */
export function coachBrandColorOf(v: string | null | undefined): string | null {
  const six = expandHex(v);
  return six && isReadableBrandColor(six) ? six : null;
}

export type BrandColorInput =
  | { kind: 'clear' }
  | { kind: 'color'; color: string }
  | { kind: 'bad'; reason: string };

/**
 * What the coach typed → what to write to `trainers.brand_color`.
 *
 * An empty field CLEARS rather than storing anything. Part 150's rule applied
 * to a colour: a coach who has not chosen one has not chosen one, and there is
 * no colour that honestly stands in for that.
 */
export function parseCoachBrandColor(input: string | null | undefined): BrandColorInput {
  const raw = String(input ?? '').trim();
  if (!raw) return { kind: 'clear' };
  const six = expandHex(raw);
  if (!six) {
    return { kind: 'bad', reason: 'Enter a colour as a hex code, like #1f6feb or #1f6.' };
  }
  if (!isReadableBrandColor(six)) {
    // Both numbers, not just the loser. A coach who is told only that their
    // colour failed will try a neighbouring shade; one who can see that black
    // reaches 3.4 and white reaches 4.1 can see which direction to move in.
    const onBlack = contrastRatio(INK_ON_LIGHT, six);
    const onWhite = contrastRatio(INK_ON_DARK, six);
    const fmt = (n: number | null) => (n == null ? 'nothing measurable' : `${n.toFixed(1)}:1`);
    return {
      kind: 'bad',
      reason: `Your clients could not read a button label on that colour. Dark text on it reaches ${fmt(onBlack)} and light text reaches ${fmt(onWhite)}, and a label needs ${AA_TEXT}:1. Try a darker or a lighter shade of it.`,
    };
  }
  return { kind: 'color', color: six };
}

/* ── the trading name ─────────────────────────────────────────────────────── */

/** Longer than this is a sentence, not a name a client reads in a header. */
export const MAX_BRAND_NAME = 60;

/**
 * Names a coach may not trade under: this build's own.
 *
 * The boundary the roadmap draws, made enforceable. A coach brands their
 * COACHING; the app is Repple's, and a coach whose clients see "Repple" as
 * their coach's trading name has been handed the publisher's identity. The
 * store listing, the icon and the bundle id are the brand axis in
 * src/lib/brands.ts and none of them are a coach's to move.
 *
 * Taken from the running build rather than hardcoded, so a white-label brand's
 * own coaches cannot claim that brand's name either.
 */
export const RESERVED_BRAND_NAMES: string[] = [
  BRAND.label,
  ...Object.values(BRAND.apps).map((a) => a.name),
];

/** Case, spacing and punctuation removed, so "Rep-ple" cannot slip past. */
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type BrandNameInput =
  | { kind: 'clear' }
  | { kind: 'name'; name: string }
  | { kind: 'bad'; reason: string };

/**
 * What the coach typed → what to write to `trainers.brand_name`.
 *
 * Blank CLEARS, and clearing is not the same as being nameless: a coach with no
 * trading name coaches under their own name, which their clients already see.
 * That is why nothing here substitutes the coach's name for a blank — the
 * absence is the answer, and `resolveClientBrand` reads it as one.
 */
export function parseCoachBrandName(
  input: string | null | undefined,
  reserved: string[] = RESERVED_BRAND_NAMES,
): BrandNameInput {
  const name = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { kind: 'clear' };
  if (name.length > MAX_BRAND_NAME) {
    return { kind: 'bad', reason: `That is longer than a name — ${MAX_BRAND_NAME} characters at most.` };
  }
  if (reserved.some((r) => fold(r) === fold(name))) {
    return {
      kind: 'bad',
      reason: `${name} is the name of this app, not of a coaching business. Your clients need to be able to tell the two apart.`,
    };
  }
  return { kind: 'name', name };
}

/** A trading name read back from the database, or null when there is none. */
export function coachBrandNameOf(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s : null;
}

/* ── whose brand wins ─────────────────────────────────────────────────────── */

export type BrandSource = 'gym' | 'coach' | 'app';

export interface ClientBrand {
  /** Who speaks for this client's app. */
  source: BrandSource;
  /** The name to show, or null when whoever speaks has not set one. */
  name: string | null;
  /** The accent to apply, or null. Already measured — never needs checking again. */
  color: string | null;
}

export interface ClientBrandInput {
  /**
   * Whether this client shares their tenant with anybody else, from
   * `my_coach_brand()`. That IS gym membership: a personal workspace has one
   * occupant for ever, and only a gym's member invite moves a profile into a
   * tenant that has staff in it. See part 153.
   */
  inGym: boolean;
  /** The gym's own branding where it is readable. Null when it is not. */
  gym?: { name?: string | null; color?: string | null } | null;
  /** The coach's, from `my_coach_brand()`. Null when there is no active coach. */
  coach?: { name?: string | null; brandName?: string | null; color?: string | null } | null;
}

/**
 * THE GYM WINS.
 *
 * A client who belongs to a gym AND has a coach is the case this whole item
 * turns on, and the gym takes it. Four reasons, in the order they convinced:
 *
 *   1. Membership is the fact the database actually holds about that person.
 *      `profiles.tenant_id` is single-valued and it points at the gym; the
 *      coach is a link beside it. Branding the app from the link would mean the
 *      app disagreeing with the row.
 *
 *   2. A coach at a gym rebranding that gym's members' apps is a coach
 *      advertising over their employer, inside the employer's own product. The
 *      header of src/ui/trainers.tsx already fixes the boundary in the other
 *      direction — what a coach pays Repple is not the gym owner's business —
 *      and this is the same line seen from the other side.
 *
 *   3. Members change coach. Membership is the stable identity of the two, and
 *      an app that reskins itself when a gym reassigns a trainer looks broken
 *      rather than personal.
 *
 *   4. It puts coach branding exactly where the roadmap says the market is: the
 *      independent coach, whose client has no gym to speak for them.
 *
 * Note what "the gym wins" does NOT mean. It is not conditional on the gym
 * having chosen a colour — a gym that has chosen nothing still speaks, and the
 * app then wears its own colours rather than the coach's. Making it conditional
 * would hand every un-branded gym's members to whichever coach they were
 * assigned, which is the outcome reason 2 is about.
 *
 * A coach with neither a trading name nor a usable colour has not branded
 * anything, and is reported as 'app' rather than as a 'coach' with two nulls —
 * so a caller cannot draw a header for a brand that does not exist.
 */
export function resolveClientBrand(input: ClientBrandInput): ClientBrand {
  if (input.inGym) {
    return {
      source: 'gym',
      name: coachBrandNameOf(input.gym?.name),
      // Measured on the way out even though it came from the gym: the column
      // has no legibility check either, and an unreadable accent is unreadable
      // whoever picked it.
      color: coachBrandColorOf(input.gym?.color),
    };
  }
  const brandName = coachBrandNameOf(input.coach?.brandName);
  const color = coachBrandColorOf(input.coach?.color);
  if (!brandName && !color) return { source: 'app', name: null, color: null };
  // The coach's own name where they have not claimed a trading one. Not a
  // substitute for a missing value — it is the name their clients already see
  // through my_coach(), and "no trading name" means "I coach under my own".
  return { source: 'coach', name: brandName ?? coachBrandNameOf(input.coach?.name), color };
}

/**
 * The one sentence a client is owed about why their app looks the way it does,
 * or null when there is nothing worth saying.
 *
 * Only two situations are worth a sentence. A client whose coach has branding
 * that is being overridden by their gym would otherwise see their coach's
 * colours nowhere and have no idea a choice was made. And a client wearing a
 * coach's colours should be able to tell that they are the coach's rather than
 * the app's — the app is Repple's either way, and this is the line that keeps
 * that from blurring.
 */
export function clientBrandNote(input: ClientBrandInput): string | null {
  const coachHasBranding =
    !!coachBrandNameOf(input.coach?.brandName) || !!coachBrandColorOf(input.coach?.color);
  if (input.inGym) {
    return coachHasBranding
      ? 'You train at a gym, so this app wears your gym’s branding rather than your coach’s.'
      : null;
  }
  const b = resolveClientBrand(input);
  if (b.source !== 'coach') return null;
  return b.name
    ? `These are ${b.name}’s colours. Repple makes the app; your coaching is theirs.`
    : 'These are your coach’s colours. Repple makes the app; your coaching is theirs.';
}
