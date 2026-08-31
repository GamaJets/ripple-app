// Matching an ad to the join code it points at — the whole reason ad spend can
// be collected without the coach mapping anything.
//
// ── The idea ─────────────────────────────────────────────────────────────
//
// src/lib/joinCode.ts already builds the link a coach puts in their Instagram
// bio: `https://…/join?c=K7M2QX`. The same link is what they set as the
// destination of the ad. So the ad ALREADY carries the code, and the sync only
// has to read it back out. Nothing is mapped by hand — which matters, because a
// mapping screen is a thing that is correct on the day it is filled in and
// quietly wrong every day after, and being quietly wrong here means telling a
// coach that the wrong channel is the one making them money.
//
// ── Why this is a pure module ────────────────────────────────────────────
//
// Everything below is a decision about somebody's money and none of it needs a
// network, a database or a device. Kept separate so the rules can be asserted
// (adMatch.test.ts) rather than discovered in production off a real ad account.
//
// ── The three ways this can be honestly wrong, all of them recorded ──────
//
// An ad may carry no destination we can read, a destination with no `?c=`, or a
// code that is not one of this coach's. All three are UNMATCHED, and unmatched
// is not zero: it is real money that left the coach's account and could not be
// placed. It is returned with the ad's name and destination so the screen can
// show it. A total that quietly dropped those ads would be a smaller, tidier,
// wrong number, and the coach would divide their revenue by it.
//
// A fourth: an ad whose spend figure cannot be read at all. That one carries a
// null amount, and a null amount poisons the unmatched TOTAL to null rather
// than being skipped — a partial sum of unattributed money reads exactly like
// the whole of it.
//
// ── Currency ─────────────────────────────────────────────────────────────
//
// The provider reports the ad account's own currency, which need not be what
// the coach charges in and is never assumed. Where the ads disagree about it,
// nothing is summed: `currencyConflict` is set and the caller records the run
// as unusable rather than adding dirhams to dollars.

/** One ad as the sync assembled it: its spend, and everywhere it points. */
export type AdInsight = {
  adId: string;
  adName: string;
  /** As the provider gives it — a decimal string in MAJOR units ("12.34"). */
  spend: string | number | null | undefined;
  /** The ad account's currency, as the provider reports it. */
  currency: string | null | undefined;
  /** Every destination found on the ad's creative, best first. */
  urls: string[];
};

/** One of the coach's codes. `id` null is their default code, which has no row. */
export type KnownCode = { id: string | null; code: string; label: string };

export type MatchedCode = {
  codeId: string | null;
  code: string;
  label: string;
  cents: number;
  /** How many ads were behind this figure — one ad set split five ways is five. */
  ads: number;
};

export type UnmatchReason = 'no-link' | 'no-code' | 'unknown-code' | 'no-amount';

export type UnmatchedAd = {
  adId: string;
  adName: string;
  /** The destination we did read, where there was one. Null for 'no-link'. */
  url: string | null;
  /** Null means the spend figure was unreadable. NOT zero. */
  cents: number | null;
  reason: UnmatchReason;
};

export type MatchResult = {
  /** The ad account's currency, or null where the ads did not agree on one. */
  currency: string | null;
  currencyConflict: boolean;
  matched: MatchedCode[];
  unmatched: UnmatchedAd[];
  matchedCents: number;
  /** Null when any unmatched ad's own amount could not be read. */
  unmatchedCents: number | null;
  adsSeen: number;
};

/**
 * A provider's decimal amount → the minor units the rest of Repple stores.
 *
 * Multiplied by 100 flatly, because that is what `money()` in gymRecord.ts
 * divides by for every currency including the ones with no minor unit. A yen
 * figure of "1234" therefore becomes 123400 and renders as "JPY 1,234.00",
 * which is the right amount with a decimal place nobody uses — the same
 * compromise `client_purchases.amount_cents` already makes. Changing it here
 * alone would make ad spend and revenue disagree by a hundredfold.
 *
 * Null for anything unreadable, and null is never a zero. An empty string, a
 * missing field and the word "unknown" all mean we do not know what this ad
 * cost, and a zero would say the coach got it for free.
 */
export function centsFromAmount(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const raw = String(v).trim().replace(/,/g, '');
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  // The same ceiling part 98 puts on a typed figure. An amount past it is a
  // provider fault or a units mix-up, not a campaign.
  if (cents < 0 || cents >= 100000000000) return null;
  return cents;
}

/** Percent-decode without throwing on a half-encoded string somebody pasted. */
function decode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

/**
 * The join code a destination URL points at, or null.
 *
 * Parsed by hand rather than through `URL`. React Native's URL is a partial
 * implementation whose `searchParams` has been missing or half-present
 * depending on the engine, and this module runs in the app, in a Deno edge
 * function and under plain node in the test. A regex over the query string
 * behaves the same in all three and does not throw on a malformed link, which
 * is exactly the kind of link a person pastes into an ad.
 *
 * Two things it deliberately handles:
 *
 *   · a link shim. Meta rewrites destinations through `l.facebook.com/l.php?u=
 *     <the real url, encoded>`, and the code is inside that inner URL. Without
 *     following it every ad on a page post would read as having no code.
 *   · tracking parameters after the code — `?c=K7M2QX&utm_source=ig` and
 *     `{{ad.id}}` macros appended by `url_tags` — which are ordinary query
 *     parameters and must not stop the code being found.
 *
 * The value is returned as it was written, uppercased and stripped of spacing
 * only. It is NOT normalised to six characters: `normaliseCode` truncates, and
 * truncating `?c=hello-world` to "HELLOW" would invent a code that might belong
 * to somebody. Whether the value is one of this coach's codes is decided by
 * matchAds against the real list, and a value that is not is reported as
 * 'unknown-code' rather than guessed at.
 */
export function codeFromUrl(url: string | null | undefined, depth = 0): string | null {
  const raw = String(url ?? '').trim();
  if (!raw || depth > 3) return null;

  // Everything after the first '?', minus any fragment. A code in the fragment
  // is not a thing the link builder produces and would not reach the server.
  const q = raw.split('#')[0].split('?').slice(1).join('?');
  if (!q) return null;

  let nested: string | null = null;
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = decode(pair.slice(0, eq)).trim().toLowerCase();
    const val = decode(pair.slice(eq + 1)).trim();
    if (!val) continue;
    // Case-insensitive on the key: the link builder writes `c`, and a coach
    // retyping the URL into an ad by hand writes `C` about as often.
    if (key === 'c') {
      const code = val.replace(/\s+/g, '').toUpperCase();
      if (code) return code;
    }
    // The shim's inner URL, kept for after the loop — a real `c` on the outer
    // link is the more direct statement of intent and wins.
    if (!nested && (key === 'u' || key === 'url' || key === 'q') && /^https?:\/\//i.test(val)) {
      nested = val;
    }
  }
  return nested ? codeFromUrl(nested, depth + 1) : null;
}

/**
 * Every URL on an ad creative, wherever the provider decided to put it.
 *
 * Meta's creative shape is a union of half a dozen historical formats — a plain
 * `link_url`, `object_story_spec.link_data.link`, a `child_attachments` array
 * for a carousel, `asset_feed_spec.link_urls` for a dynamic ad — and it gains a
 * new one whenever a new ad format ships. Naming the paths would mean a coach's
 * spend silently becoming unattributable the month Meta adds a format.
 *
 * So this walks the object and takes every string that is an http(s) URL. The
 * cost of being broad is picking up an image URL or a tracking pixel, and that
 * costs nothing: a URL with no `?c=` in it contributes no code, and the ad is
 * only ever matched to a code some URL on it actually names.
 */
export function urlsFromCreative(creative: unknown, limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 8 || v == null) return;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^https?:\/\//i.test(s) && !seen.has(s)) { seen.add(s); out.push(s); }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') { for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1); }
  };
  walk(creative, 0);
  // A destination that names a code is what we are here for; sorting those
  // first means an ad with a tracking pixel listed before its real link is
  // still matched, and the URL recorded against an UNMATCHED ad is the first
  // one seen rather than an arbitrary one.
  return out.sort((a, b) => Number(codeFromUrl(b) != null) - Number(codeFromUrl(a) != null));
}

/**
 * Ads in, per-code totals and the money that could not be placed out.
 *
 * The order of the checks is the order in which a coach can act on the answer:
 * an ad with no spend figure is a provider problem, an ad with no link is an
 * ad-format problem, an ad with a link and no code is a thing they can fix in
 * thirty seconds by editing the destination, and a code that is not theirs is
 * usually a typo in that destination.
 */
export function matchAds(ads: AdInsight[] | null | undefined, codes: KnownCode[] | null | undefined): MatchResult {
  const list = Array.isArray(ads) ? ads : [];
  // Code → the coach's own row. Uppercased on both sides so 'k7m2qx' in a
  // hand-typed destination is the same code as 'K7M2QX'.
  const byCode = new Map<string, KnownCode>();
  for (const c of codes || []) {
    const code = String(c?.code ?? '').trim().toUpperCase();
    if (code) byCode.set(code, { id: c.id ?? null, code, label: c.label || code });
  }

  const currencies = new Set<string>();
  for (const a of list) {
    const c = String(a?.currency ?? '').trim().toUpperCase();
    if (c) currencies.add(c);
  }
  const currencyConflict = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] : null;

  const totals = new Map<string, MatchedCode>();
  const unmatched: UnmatchedAd[] = [];
  let matchedCents = 0;
  let unmatchedCents: number | null = 0;

  const dropInUnmatched = (a: AdInsight, url: string | null, cents: number | null, reason: UnmatchReason) => {
    unmatched.push({ adId: String(a?.adId ?? ''), adName: String(a?.adName ?? '').trim(), url, cents, reason });
    if (cents == null) unmatchedCents = null;
    else if (unmatchedCents != null) unmatchedCents += cents;
  };

  for (const a of list) {
    const urls = (a?.urls || []).map((u) => String(u || '').trim()).filter(Boolean);
    const cents = centsFromAmount(a?.spend);
    // An unreadable amount first: we cannot attribute a number we do not have,
    // and pretending it is zero would let it disappear into a matched code.
    if (cents == null) { dropInUnmatched(a, urls[0] ?? null, null, 'no-amount'); continue; }
    if (!urls.length) { dropInUnmatched(a, null, cents, 'no-link'); continue; }

    let found: string | null = null;
    let foundOn: string | null = null;
    for (const u of urls) {
      const c = codeFromUrl(u);
      if (c) { found = c; foundOn = u; break; }
    }
    if (!found) { dropInUnmatched(a, urls[0], cents, 'no-code'); continue; }

    const known = byCode.get(found);
    if (!known) { dropInUnmatched(a, foundOn, cents, 'unknown-code'); continue; }

    const row = totals.get(known.code) ?? { codeId: known.id, code: known.code, label: known.label, cents: 0, ads: 0 };
    row.cents += cents;
    row.ads += 1;
    totals.set(known.code, row);
    matchedCents += cents;
  }

  return {
    currency,
    currencyConflict,
    // Biggest spend first: it is the figure a coach checks, and the one an
    // error in is worth the most.
    matched: [...totals.values()].sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code)),
    unmatched: unmatched.sort((a, b) => (b.cents ?? -1) - (a.cents ?? -1)),
    matchedCents,
    unmatchedCents,
    adsSeen: list.length,
  };
}

/**
 * What to tell a coach about one unmatched ad.
 *
 * Each one names the remedy, because "unmatched" on its own reads as a Repple
 * fault and three of the four are things only the coach can fix — in their ad,
 * in about a minute.
 */
export function unmatchedReasonNote(reason: UnmatchReason): string {
  switch (reason) {
    case 'no-link':
      return 'This ad has no destination link we could read, so there is nothing on it to match a code against.';
    case 'no-code':
      return 'This ad’s link does not carry a code. Set its destination to one of your join links and its spend will be counted from the next sync.';
    case 'unknown-code':
      return 'This ad’s link carries a code that is not one of yours — usually a typo in the destination, or a code that was deleted.';
    case 'no-amount':
      return 'What this ad cost came back in a form we could not read, so its spend is unknown rather than nothing.';
  }
}

/**
 * Said on the screen, above the figures, because a coach acting on these
 * numbers has to know what they do not include.
 */
export const UNMATCHED_NOTE =
  'Money spent on ads whose destination does not carry one of your join links cannot be credited to a code. It is listed below with what it cost, because it is money you spent — it is not missing, and it is not nothing.';

/** Why a sync that ran can still be unusable. Both are stated, never guessed. */
export const CURRENCY_CONFLICT_NOTE =
  'This ad account reported spend in more than one currency, and adding those together would produce a figure that is not an amount of money. Nothing was recorded from this sync.';

export const NO_CURRENCY_NOTE =
  'This ad account did not say which currency it bills in, and a figure with no currency cannot be compared with what your clients pay. Nothing was recorded from this sync.';
