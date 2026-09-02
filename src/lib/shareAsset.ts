// The shareable asset a coach can actually make tonight: a card built from
// figures that are true, and a caption to go with it.
//
// ── What this replaced, and why the replacement is smaller ──────────────────
//
// This module exists because the thing above it used to be `publishToSocials`,
// which named four networks, showed a "connected" dot beside each of them and
// uploaded nothing to any of them, ever. There was no OAuth session, no token,
// no upload endpoint and no Integrations screen to reach one from — the check
// behind the green dot was `!!process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID`, a
// build-time string that says nothing about whether an account is linked.
//
// The OS share sheet, by contrast, is real, is already in the binary, and
// reaches every network the coach has installed plus the ones that have not
// been invented yet. So the honest version of "help me market my coaching" is
// not a publish button. It is: compose something worth posting, hand it to the
// share sheet, and let the coach post it themselves in two taps. That is what
// this builds — the composing half, kept pure so it can be tested.
//
// Nothing here touches react-native, expo, or the network. It takes figures and
// returns text and layout. `src/lib/social.ts` does the file write and the
// hand-off; `app/(trainer)/share-kit.tsx` draws the card.
//
// ── The three rules this module enforces, none of them cosmetic ─────────────
//
// 1. A FIGURE THAT WAS NOT READ IS NEVER PUBLISHED AS ZERO.
//    This is the repo's oldest bug class (scripts/check-reads.mjs is the whole
//    essay) and it gets worse the moment the output leaves the phone. A
//    dashboard that says "0 sessions" because the read failed is wrong for as
//    long as the coach is looking at it. A post that says "0 sessions this
//    week" is wrong on Instagram for ever, under the coach's own name, to the
//    audience they are trying to win. So `null` drops the line entirely, and a
//    card with nothing true left on it refuses to build — with a reason that
//    distinguishes "we could not read this" from "this genuinely has not
//    happened yet", because those two need different sentences and only one of
//    them is the coach's fault.
//
// 2. NOTHING IDENTIFYING A CLIENT LEAVES WITHOUT AN IN-THE-MOMENT CHOICE.
//    A coach is not entitled to consent on their client's behalf. So a result
//    card carries no name unless the coach affirms, at the moment of sharing,
//    that this particular client agreed — and `scrubName` below takes the name
//    back out of the coach's own typed caption AND out of their typed headline
//    when they have not, because free text is where it actually slips through.
//
//    This module used to say a second thing here: that `ShareCard` had no image
//    field at all, and that there was "deliberately no shape here that could
//    carry one". That was the right answer while the only consent this app held
//    was a tick a COACH put in a box, because a coach ticking a box about their
//    client's body is not that client agreeing to anything. It is no longer the
//    only consent there is. supabase/parts/331 gives the client a per-photo
//    permission to PUBLISH, written by them, unwritable by the coach, and dying
//    with the photo and with the coaching relationship — so the card can now
//    carry an image on a permission that came from the person in it.
//
//    The shape below therefore admits an image, and admits it only through
//    `PublishConsent`. Read `src/lib/photoPublish.ts` before touching it: a
//    coach being able to SEE a progress photo is not permission to post it, the
//    two grants are separate rows for that reason, and 'unknown' — a consent
//    read that failed — is not consent. A card with no photo on it looks exactly
//    like a card that was never going to have one; there is deliberately no
//    placeholder, because a gap captioned "a photo was withheld" is itself a
//    statement about a client made without asking them.
//
//    The COACH'S OWN LOGO is the easy case and is handled beside it. It is
//    theirs, it identifies nobody else, and it needs no permission from anyone.
//
// 3. TEXT THAT WILL NOT FIT IS WRAPPED HERE, NOT DISCOVERED ON THE CARD.
//    SVG has no line box. `<Text>` in react-native-svg draws one line and lets
//    it run off the edge of the image — silently, in the exported PNG, which is
//    the one artefact nobody looks at again before it is posted. `wrapLines`
//    is therefore not a nicety; it is the only thing standing between a long
//    gym name and a graphic with half a word hanging off it.

import { mayPublishPhoto, type PublishConsent } from './photoPublish';

/* ── canvas sizes ──────────────────────────────────────────────────────────── */

/**
 * The two shapes worth offering, and no more.
 *
 * 4:5 is the tallest a feed post may be on Instagram and Facebook without being
 * cropped, so it is the most pixels a coach gets for free. 9:16 is a story or a
 * Reel/TikTok cover. A square is strictly worse than the 4:5 everywhere it is
 * accepted, so it is not here — a third option that is never the right answer
 * is a decision handed to the coach for nothing.
 *
 * These are the pixel dimensions of the exported PNG, not of the preview.
 */
export interface CardSize { key: CardShape; label: string; note: string; w: number; h: number }
export type CardShape = 'post' | 'story';
export const CARD_SIZES: CardSize[] = [
  { key: 'post', label: 'Post', note: '4:5 — feed', w: 1080, h: 1350 },
  { key: 'story', label: 'Story', note: '9:16 — stories, Reels, TikTok', w: 1080, h: 1920 },
];

export const cardSize = (shape: CardShape): CardSize =>
  CARD_SIZES.find((s) => s.key === shape) ?? CARD_SIZES[0];

/* ── the card ──────────────────────────────────────────────────────────────── */

export type CardKind = 'week' | 'result';

/** One figure on the card. `value` is already formatted — this module never
 *  guesses a locale, a currency or a unit that the caller did not supply. */
export interface Stat { label: string; value: string }

/**
 * Something for the renderer to draw, and whose it is.
 *
 * `source` is not decoration. It is the difference between a mark a coach owns
 * outright and a picture of somebody else's body, and it travels with the uri
 * so that a renderer, a test or a reader can tell which is which without
 * knowing which field it came out of.
 */
export type CardImageSource = 'coach-logo' | 'client-photo';

export interface CardImage {
  /** A data: URI or a local file URI. Never a remote one: the export has to
   *  succeed offline and a network fetch mid-render is a blank rectangle in the
   *  PNG that nobody looks at again before posting. */
  uri: string;
  source: CardImageSource;
}

/**
 * Everything the renderer needs.
 *
 * Note what is still absent: no client id, no path, no storage key. The two
 * image fields carry pixels that have already been resolved and permitted, and
 * they are separate fields rather than one polymorphic slot because the rules
 * about them have nothing in common — see the header, rule 2.
 */
export interface ShareCard {
  kind: CardKind;
  /** The small line above the headline — a period, a span, a context. */
  kicker: string;
  headline: string;
  /** At most three. A fourth figure makes none of them the point. */
  stats: Stat[];
  /** The coach's name or the gym's, bottom of the card. */
  footer: string;
  /** What goes in the share sheet's text field alongside the image. */
  caption: string;
  /** Filename for the PNG. Safe on every filesystem the share sheet touches. */
  filename: string;
  /**
   * The coach's own mark, beside the footer. Absent when they have set none or
   * when it could not be read — and those two are the same to this module,
   * because the card that comes out is the card that came out yesterday either
   * way. src/lib/coachLogo.ts holds the difference and the sentence for it.
   */
  logo?: CardImage | null;
  /**
   * A client's progress photo. Present ONLY when that client's own published-use
   * permission was read and granted; see `resultCard`. Never on a week card,
   * which is about the coach and has nobody else's anything on it.
   */
  photo?: CardImage | null;
}

/**
 * A card, or the reason there isn't one.
 *
 * Deliberately not `ShareCard | null`. The screen has to say something specific
 * to the coach, and the two failures below want opposite sentences: one is
 * "your connection dropped, try again", the other is "you have not coached
 * anybody this week". A null cannot tell them apart and the screen would have
 * to guess, which is how "no data" becomes "0 sessions" all over again.
 */
export type CardBuild =
  | { ok: true; card: ShareCard }
  | { ok: false; reason: BlockReason; why: string };

export type BlockReason = 'unread' | 'empty' | 'consent' | 'nothing-picked';

/* ── word wrap ─────────────────────────────────────────────────────────────── */

/**
 * Roughly how many characters of `fontPx` fit across `widthPx`.
 *
 * An approximation and openly so: the exact answer needs the font's metrics,
 * which are not available to a pure module and differ between iOS and Android
 * anyway. 0.55 em is a conservative average advance for a sans-serif at these
 * weights — it under-fills a line slightly rather than over-filling it, which
 * is the right way to be wrong when the failure mode is text running off the
 * side of an image somebody is about to post.
 */
export function charsPerLine(widthPx: number, fontPx: number): number {
  if (!(widthPx > 0) || !(fontPx > 0)) return 0;
  return Math.max(1, Math.floor(widthPx / (fontPx * 0.55)));
}

/**
 * Greedy word wrap into at most `maxLines` lines of at most `perLine`
 * characters, with an ellipsis when the text does not fit.
 *
 * SVG draws one <Text> per line and does not wrap, so this is the layout. Three
 * cases it has to get right and one it deliberately does not try to:
 *
 *   · a word longer than the line (a URL, a hashtag, a German compound) is hard
 *     broken rather than allowed to overhang;
 *   · overflow truncates the LAST line and marks it, so the reader can see that
 *     something was cut instead of reading a sentence that just stops;
 *   · an empty or whitespace-only string is no lines at all, not one empty one,
 *     because an empty <Text> still reserves its line height and the card's
 *     spacing is computed from the count.
 *
 * It does not hyphenate. A wrong hyphen is worse than a hard break.
 */
export function wrapLines(text: string, perLine: number, maxLines: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length || perLine < 1 || maxLines < 1) return [];

  const lines: string[] = [];
  let line = '';
  const push = () => { if (line) { lines.push(line); line = ''; } };

  for (const word of words) {
    let w = word;
    // A word wider than the whole line. Fill the current line, then keep
    // breaking. Without this the greedy loop below would put it on a line of
    // its own and it would still be too long — the overhang just moves.
    while (w.length > perLine) {
      const room = perLine - (line ? line.length + 1 : 0);
      if (room > 1) { line = line ? `${line} ${w.slice(0, room)}` : w.slice(0, room); w = w.slice(room); }
      push();
      if (lines.length >= maxLines) return truncateLast(lines, perLine, maxLines);
      if (w.length > perLine) { lines.push(w.slice(0, perLine)); w = w.slice(perLine); }
      if (lines.length >= maxLines) return truncateLast(lines, perLine, maxLines);
    }
    if (!line) { line = w; continue; }
    if (line.length + 1 + w.length <= perLine) { line = `${line} ${w}`; continue; }
    push();
    if (lines.length >= maxLines) { line = w; break; }
    line = w;
  }
  push();
  return truncateLast(lines, perLine, maxLines);
}

/**
 * Cut to `maxLines` and mark the cut.
 *
 * The ellipsis replaces a character rather than being appended, because
 * appending it to a line that was already at the limit is how the overhang gets
 * back in through the door it was just thrown out of.
 */
function truncateLast(lines: string[], perLine: number, maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.length >= perLine ? `${last.slice(0, Math.max(1, perLine - 1))}…` : `${last}…`;
  return kept;
}

/* ── the privacy gate ──────────────────────────────────────────────────────── */

/**
 * Take a client's name back out of text the coach typed.
 *
 * This is the leak that would actually happen. The card itself is built from
 * fields this module controls, so keeping a name off it is easy — but the
 * caption is free text, and a coach writing about a client's twelve weeks will
 * write their name in it without thinking, because they are writing about
 * somebody they know. If they have not said the client agreed to be named, the
 * name must not go out, and the place it goes out from is here.
 *
 * What it handles:
 *   · the full name first, so "Sarah Jones" does not become "my client Jones";
 *   · then each part, so "Sarah" alone is caught too;
 *   · case-insensitively, on word boundaries, so "Sam" does not maul "Same"
 *     and the possessive "Sarah's" becomes "my client's" rather than surviving;
 *   · capitalisation by position, so a sentence still starts with a capital.
 *
 * What it does not claim: this is not anonymisation. A coach who writes "my
 * client, the one who owns the bakery on Al Wasl Road" has identified somebody
 * and no string function can help. It removes the name, which is the specific
 * thing it says it removes, and the screen above still asks the coach to look
 * at what they wrote.
 */
export function scrubName(text: string, name: string | null | undefined, replacement = 'my client'): string {
  const src = String(text ?? '');
  const full = String(name ?? '').trim();
  if (!src || !full) return src;

  // Longest first: the full name before its parts, and a two-part surname
  // before a one-part first name. Otherwise the shorter match eats the front of
  // the longer one and leaves the rest stranded.
  const parts = full.split(/\s+/).filter((p) => p.length >= 2);
  const targets = [full, ...parts].filter((t, i, a) => t.length >= 2 && a.indexOf(t) === i)
    .sort((a, b) => b.length - a.length);

  let out = src;
  for (const target of targets) {
    out = out.replace(nameRegex(target), (_m, offset: number) => (startsSentence(out, offset) ? capitalise(replacement) : replacement));
  }
  // "Sarah Jones" matched as a whole and then "Sarah" and "Jones" matched
  // nothing — but a caption naming the same person twice in a row ("Sarah,
  // Sarah!") collapses to a stutter. One replacement is the honest rendering.
  return out.replace(new RegExp(`\\b(${escapeRe(replacement)})(\\s+${escapeRe(replacement)})+\\b`, 'gi'), (m) => m.slice(0, replacement.length));
}

/**
 * The name as a pattern, with a word boundary on each end that is only applied
 * where a word boundary can exist.
 *
 * `\bJ.\b` never matches "J. was great". `\b` sits between a word character and
 * a non-word one, and the full stop and the space that follows it are both
 * non-word — so the trailing boundary fails and a client initialled "J. R."
 * keeps their name in every caption. The name is not always a word: it can end
 * in a full stop, start with an apostrophe, be hyphenated. So the boundary is
 * attached per end, based on the character that is actually there.
 *
 * Escaping is not optional either, and for the same client: an unescaped "J."
 * compiles the full stop to "any character", which silently redacts "Jo",
 * "Jim" and the first two letters of every word beginning with a J.
 */
function nameRegex(target: string): RegExp {
  const lead = /^\w/.test(target) ? '\\b' : '';
  const tail = /\w$/.test(target) ? '\\b' : '';
  return new RegExp(`${lead}${escapeRe(target)}${tail}`, 'gi');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Whether offset `i` is the first thing in the string or the first thing after
 *  a full stop, question mark, exclamation mark or newline. */
function startsSentence(text: string, i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    const c = text[k];
    if (c === ' ' || c === '\t' || c === '"' || c === "'") continue;
    return c === '.' || c === '!' || c === '?' || c === '\n';
  }
  return true;
}

/* ── figures ───────────────────────────────────────────────────────────────── */

/** A whole number with thousands separators, in the reader's locale. */
export const num = (n: number): string => Math.round(n).toLocaleString();

/**
 * Minutes as the hours a coach would say out loud.
 *
 * Whole hours have no decimal — "24 hours", not "24.0 hours" — and anything
 * under an hour keeps its minutes rather than rounding to "0 hours", which is
 * the same lie as the zero this module exists to avoid.
 */
export function hoursLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} hrs` : `${rounded.toFixed(1)} hrs`;
}

/* ── the week card ─────────────────────────────────────────────────────────── */

export interface WeekInput {
  /** The gym's name or the coach's — whatever the footer should read. */
  brand: string;
  /** "Last 7 days", "August" — the caller owns the wording and the maths. */
  spanLabel: string;
  /** Sessions actually delivered. NULL means the read did not land. */
  sessions: number | null;
  /** Minutes coached, from the same rows. NULL means the read did not land. */
  minutes: number | null;
  /** Distinct clients seen. NULL means the read did not land. */
  clients: number | null;
  /**
   * The coach's own logo as a data URI, or null.
   *
   * No consent question and no gate: it is theirs. Null is both "they have set
   * none" and "it could not be read", because the card is identical in both
   * cases — which is the fallback rule stated as a type rather than as care.
   */
  logo?: string | null;
}

/**
 * A logo string turned into something the card can carry, or null.
 *
 * One place, so a blank string, a whitespace string and a null cannot each
 * produce a different-shaped card.
 */
function logoImage(uri: string | null | undefined): CardImage | null {
  const s = String(uri ?? '').trim();
  return s ? { uri: s, source: 'coach-logo' } : null;
}

/**
 * A card about the coach's own week, from their own delivered sessions.
 *
 * The safest thing a coach can post: it is about them, it names nobody, and
 * every figure on it came from a session whose outcome they recorded
 * themselves. No consent question arises because there is nothing here that
 * belongs to anybody else.
 *
 * Every `null` drops its line. If all three are null the read failed and the
 * card refuses; if all three are zero the week genuinely was empty and it also
 * refuses, with the other sentence — a coach posting "0 sessions this week" is
 * not the marketing they came here for, and there is no version of that graphic
 * worth making.
 */
export function weekCard(input: WeekInput): CardBuild {
  const { sessions, minutes, clients } = input;
  if (sessions == null && minutes == null && clients == null) {
    return {
      ok: false, reason: 'unread',
      why: 'Repple could not read your sessions just now, so there are no figures it can honestly put on a card. Try again in a moment — nothing has been posted.',
    };
  }

  // A zero is dropped as well as a null, and for a different reason. All three
  // figures come from the same set of rows, so a genuine zero can only mean the
  // week was empty — but "0 clients" printed beside "5 sessions" would be a
  // contradiction on a graphic that has already left the phone. Dropping it
  // costs nothing true and makes that shape impossible.
  const stats: Stat[] = [];
  if (sessions != null && sessions > 0) stats.push({ label: 'Sessions', value: num(sessions) });
  if (minutes != null && minutes > 0) stats.push({ label: 'Coached', value: hoursLabel(minutes) });
  if (clients != null && clients > 0) stats.push({ label: 'Clients', value: num(clients) });

  if (!stats.length) {
    return {
      ok: false, reason: 'empty',
      why: `You have no sessions marked as delivered in ${lower(input.spanLabel)}. Mark a session’s outcome and it will appear here — Repple will not make a card out of a week that has not happened.`,
    };
  }

  const headline = sessions != null && sessions > 0
    ? `${num(sessions)} ${sessions === 1 ? 'session' : 'sessions'} coached`
    : minutes != null && minutes > 0
      ? `${hoursLabel(minutes)} coached`
      : `${num(clients ?? 0)} ${clients === 1 ? 'client' : 'clients'} trained`;

  const brand = String(input.brand ?? '').trim() || 'Repple';
  // The headline is always built from the first surviving stat, so the caption
  // lists the rest. Repeating it — "18 sessions coached. 18 sessions · 24 hrs"
  // — reads as a template that was filled in rather than as something a coach
  // wrote, which is the whole difference between a post and an ad.
  const caption = [
    `${headline} — ${lower(input.spanLabel)}.`,
    // `lower()` is for the coach's span label, where "August" has to survive.
    // Stat labels are common nouns this module wrote itself, so they are simply
    // lower-cased — running them through the proper-noun heuristic produced
    // "18 hrs Coached · 11 Clients", which reads like a spreadsheet header.
    stats.slice(1).map((s) => `${s.value} ${s.label.toLowerCase()}`).join(' · '),
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    card: {
      kind: 'week',
      kicker: input.spanLabel,
      headline,
      stats: stats.slice(0, 3),
      footer: brand,
      caption,
      filename: assetFilename('week'),
      logo: logoImage(input.logo),
      // Stated rather than left undefined. A week card is about the coach's own
      // delivered sessions and there is nobody else on it; a field that could
      // be filled in later by a caller who did not read rule 2 is closed here.
      photo: null,
    },
  };
}

/* ── the client-result card ────────────────────────────────────────────────── */

/**
 * What the coach ticked, in the moment, on this screen, for this client.
 *
 * Two separate answers on purpose. "You may post my numbers" and "you may use
 * my name" are different permissions and a client can plausibly give the first
 * and refuse the second — which is the common case, and the one a single
 * checkbox would quietly collapse into whichever answer was more convenient.
 *
 * Neither defaults to true anywhere, and neither is remembered between shares:
 * consent to post one result in March is not consent to post another in August,
 * and a stored tick would turn into exactly that.
 */
export interface ResultConsent {
  /** The client agreed that these figures may be posted publicly. */
  figures: boolean;
  /** …and, separately, that they may be named. */
  name: boolean;
}

/**
 * The one photo the coach has picked, and what the CLIENT said about it.
 *
 * `consent` is not a boolean and is not something the coach can set. It is
 * `PublishConsent` from src/lib/photoPublish.ts, which is resolved from a row
 * the client wrote and the coach cannot write (supabase/parts/331) — so the two
 * ticks above and this field are answers from two different people, and the
 * type is what keeps them from being confused for one another.
 *
 * A coach ticking "they agreed" about somebody's numbers is the honest limit of
 * what a tick can do: this app cannot verify it, and the screen says so. A body
 * is a different order of thing, and here the app CAN verify it, so it does.
 */
export interface ClientPhotoPick {
  /** A data: or file: URI the renderer can draw. */
  uri: string;
  /** Which photo, so the caller cannot resolve consent for one and pass another. */
  photoId: string;
  /** What the client's own permission row says. 'unknown' is a read that did
   *  not land and behaves exactly like 'absent'. */
  consent: PublishConsent;
}

export interface ResultInput {
  brand: string;
  /** The client's name as the app holds it. Used to REMOVE it as often as to
   *  print it — see `scrubName`. */
  clientName: string | null;
  /** "12 weeks in", "Since March" — the coach's own words for the period. */
  spanLabel: string;
  /** The figures the coach picked, already formatted by the caller. */
  figures: Stat[];
  /** The coach's own sentence. Free text, and therefore the leak. */
  note: string;
  /** The coach's own logo. Theirs, so no gate. */
  logo?: string | null;
  /** The client's photo and the client's own permission for it, or nothing. */
  photo?: ClientPhotoPick | null;
}

/**
 * A card about a client's result — the one a coach most wants to post and the
 * one with somebody else's data on it.
 *
 * It refuses to build at all without `consent.figures`. That is not a warning
 * or a dimmed button that can be tapped anyway: there is no card, so there is
 * nothing to hand to the share sheet. And without `consent.name` the client is
 * "a client I coach" on the card AND their name is scrubbed out of the coach's
 * caption, because the caption is where it would otherwise go out.
 *
 * With `consent.name` it prints the FIRST name only. A surname adds nothing to
 * the post and a great deal to how findable the person is, and a coach ticking
 * a box about a name is not thinking about that. If a client genuinely wants
 * their full name on it, the coach can type it in the note themselves — a
 * deliberate act, which is the standard this module holds everything else to.
 */
export function resultCard(input: ResultInput, consent: ResultConsent): CardBuild {
  if (!consent?.figures) {
    return {
      ok: false, reason: 'consent',
      why: 'These are your client’s numbers, not yours to publish. Confirm they have agreed to this being posted and the card will build.',
    };
  }
  const figures = (input.figures ?? []).filter((f) => f && f.value && String(f.value).trim());
  if (!figures.length) {
    return {
      ok: false, reason: 'nothing-picked',
      why: 'Pick at least one figure to put on the card. Repple will not invent one.',
    };
  }

  const named = !!consent?.name;
  const first = firstName(input.clientName);
  // Without name consent the client's name is removed from the coach's own
  // sentence. With it, the note is left exactly as typed — the coach may name
  // them, and second-guessing that would be the app overriding a permission it
  // just asked for.
  const note = named ? String(input.note ?? '').trim() : scrubName(input.note, input.clientName);

  // The SPAN LABEL is free text too, and it was not being scrubbed.
  //
  // It is the biggest type on the card and the first clause of the caption, and
  // a coach typing "Sarah's twelve weeks" into a box labelled "the period, in
  // your words" is not doing anything strange. Every argument `scrubName` makes
  // about the note applies to it more strongly, and the arrival of a photograph
  // beside it is what makes the omission unarguable: a picture of somebody with
  // a first name over it is an identification whatever the box was called.
  const span = named ? String(input.spanLabel ?? '').trim() : scrubName(input.spanLabel, input.clientName);

  // The name — when there is one to print — is the kicker, and the coach's own
  // words for the period are the headline. The other way round ("Sarah's 12
  // weeks in") reads as a caption rather than a card, and it puts the name in
  // the largest type on the graphic, which is the last place it belongs even
  // when it is allowed to be there at all.
  const who = named && first ? first : 'a client I coach';
  const headline = span.trim() || 'Client result';
  const brand = String(input.brand ?? '').trim() || 'Repple';

  const caption = [
    `${capitalise(who)} — ${lower(span)}.`,
    figures.map((f) => `${f.label}: ${f.value}`).join(' · '),
    note,
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    card: {
      kind: 'result',
      kicker: named && first ? first : 'A client I coach',
      headline,
      stats: figures.slice(0, 3),
      footer: brand,
      caption,
      filename: assetFilename('result'),
      logo: logoImage(input.logo),
      // THE gate, and it is one expression on purpose. `mayPublishPhoto` is the
      // only thing in this app that decides whether somebody's body goes on a
      // public card, it takes a value the coach cannot author, and everything
      // else about this card — the two ticks, the figures, the name — has no
      // vote in it.
      //
      // When it says no the field is null and the card is drawn exactly as a
      // card with no photo. There is no placeholder and no marker: a labelled
      // gap would publish the fact that a client was asked, which is a
      // statement about them made without asking them.
      photo: input.photo && mayPublishPhoto(input.photo.consent) && String(input.photo.uri ?? '').trim()
        ? { uri: input.photo.uri.trim(), source: 'client-photo' }
        : null,
    },
  };
}

/** The first name, or null. Never the surname — see `resultCard`. */
export function firstName(name: string | null | undefined): string | null {
  const n = String(name ?? '').trim();
  if (!n) return null;
  const first = n.split(/\s+/)[0];
  return first || null;
}

/* ── odds and ends ─────────────────────────────────────────────────────────── */

/**
 * A filename for the exported PNG.
 *
 * Dated so a coach's camera roll and downloads folder do not fill with
 * `image.png`, and stripped to characters every filesystem the share sheet
 * hands this to will accept — a gym name with a slash in it once produced a
 * path, not a file.
 */
export function assetFilename(kind: CardKind, at: Date = new Date()): string {
  const d = Number.isFinite(at.getTime()) ? at : new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `repple-${kind}-${stamp}.png`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Lower-case a fragment that is being dropped into the middle of a sentence —
 * unless it starts with something that is a name rather than a word.
 *
 * "Last 7 days" reads badly as "…coached Last 7 days", and lower-casing it
 * fixes that; "August" and "Ramadan" must survive. The test is whether the rest
 * of the first word is already lower case, which is what tells an ordinary
 * capitalised sentence apart from a proper noun about as well as anything can
 * without a dictionary.
 */
export function lower(s: string): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const first = t.split(/\s+/)[0];
  if (/^[A-Z][a-z]+$/.test(first) && !/^(Last|This|The|Since|Over|Past|Next)$/.test(first)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}
