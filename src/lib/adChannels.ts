// Three ad channels, one figure — and the rule that stops the figure being a
// lie the moment one of the three cannot be read.
//
// ── What changed, and why it needed a module of its own ──────────────────
//
// Part 100 collected ad spend from Meta. One channel means one question: did
// the sync work. Three channels means the coach's ad spend is a SUM of three
// independent reads, each of which can fail on its own, and the arithmetic of
// that sum is where the money gets lost:
//
//   Meta £400 + Google £250 + TikTok (could not be read)
//
// There is no honest single number on that line. £650 is not the coach's ad
// spend, it is the part of it we happened to be able to read, and printed as a
// total it is a smaller number that looks exactly like a real one — the coach
// divides their revenue by it and every channel comes out cheaper than it is.
// Reporting £650 with an asterisk is barely better, because the asterisk is not
// what gets carried into next month's budget.
//
// So: a channel that could not be read makes the TOTAL unknown, and the screen
// names the channel instead of printing a number. That is the whole of
// `combineChannelSpend` below, and it is the same rule `unmatchedCents` in
// adMatch.ts already applies one level down — a partial sum of money reads
// exactly like the whole of it.
//
// ── UNKNOWN is not zero, said three ways ─────────────────────────────────
//
// The three states a connected channel can be in, and what each one means for
// the total:
//
//   'ok'      the channel answered. Whatever it reported is its contribution,
//             INCLUDING zero: a channel that ran and saw no ads pointing at a
//             code contributed nothing to that code, and that is a fact.
//   'failed'  the channel refused, or could not be reached. Its contribution is
//             UNKNOWN. Not zero. The total is withheld.
//   'never'   connected, an ad account chosen, and never once synced. Also
//             unknown, for the same reason and with a different remedy — the
//             coach presses Check Now rather than reconnecting.
//
// A channel the coach has NOT connected is none of these. It is not part of the
// sum at all, and it does not make the total unknown: Repple has never claimed
// to know what a coach spends outside the accounts they linked, and a coach who
// runs no TikTok ads must not be shown a permanent hole where TikTok would be.
// The screen says which channels the figure covers, so "everything you have
// connected" is never mistaken for "everything you spend".
//
// ── Currency, which does not convert here or anywhere ────────────────────
//
// Each ad account bills in its own currency and there is no default one in this
// product. A coach whose Meta account bills in GBP and whose TikTok account
// bills in AED has two figures and no total: adding them produces a number that
// is not an amount of any money, and converting them would put a rate nobody
// chose into a figure a coach makes decisions on. So a currency disagreement
// between channels refuses the sum the same way a failed read does, and says
// which currencies, because the fix is a real one — bill both accounts in the
// same money, or read the two figures apart.
//
// ── Units: read once, converted once, here ───────────────────────────────
//
// The three providers report money in three shapes, and this is the only place
// in the repo that knows it:
//
//   Meta    `spend`, a decimal string in MAJOR units of the ad account's
//           currency — "1265.87". adMatch.centsFromAmount takes it as-is.
//   TikTok  `spend`, likewise a decimal string in MAJOR units of the
//           advertiser's currency ("Estimated total money spent in account
//           currency"), so it goes through the SAME centsFromAmount and needs
//           no conversion of its own. Note for whoever reads the roadmap entry
//           that asked for this: TikTok's spend is documented as account
//           currency, not as minor units, and it is treated as what the docs
//           say rather than as what the ticket said. If TikTok ever does hand
//           back minor units this is the line to change, and the test below
//           pins the current reading so the change cannot be silent.
//   Google  `metrics.cost_micros`, MILLIONTHS of the account's base currency
//           unit — $12.50 arrives as 12500000. `majorFromMicros` below moves
//           the decimal point six places, once, and hands on "12.5" — so
//           Google reaches centsFromAmount in exactly the shape the other two
//           already arrive in, and there is one rule about hundredths rather
//           than one per channel.
//
// ── Why "cents" is hundredths for a yen and a dinar too ──────────────────
//
// Everything downstream of here — coach_code_spend, coach_ad_code_spend, part
// 98's cost-per-client — stores ad spend in the same unit `client_purchases.
// amount_cents` uses, and renders it with `money()`, which is `minorMoney` in
// src/lib/coachMoney.ts. That function asks `currencyDecimals` how many places
// the money has, and ZERO_DECIMAL and THREE_DECIMAL are the two answers that
// are not two.
//
// adMatch.centsFromAmount multiplies a major-unit figure by 100 FLATLY anyway,
// for every currency, and this file follows it deliberately rather than being
// cleverer:
//
//   · A JPY account reporting ¥1,234 stores 123400 and renders as "JPY
//     1,234.00" — the right amount of money with a decimal place nobody in
//     Japan uses. Dividing by 1 instead of 100 for the sixteen ZERO_DECIMAL
//     currencies would store 1234, which `money()` would then render as "JPY
//     12.34". A hundredfold error on a coach's own spend, in the currencies
//     where nobody reviewing it would have caught it.
//   · A KWD account reporting 12.340 stores 1234 and renders as "KWD 12.340",
//     because minorMoney pads to the three places THREE_DECIMAL asks for and
//     1234 hundredths is 12.34 dinars. The third decimal place is where this
//     convention actually costs something: a figure of 12.345 rounds to 1234
//     and loses half a fils. That is bounded, it is per ad rather than
//     compounding, and it is the same rounding `client_purchases` already
//     makes on the revenue side — so spend and revenue agree, which is the
//     comparison part 98 exists to make. Changing it here alone would make
//     them disagree by a hundredfold and nothing on screen would say so.
//
// One conversion, one place, and the reasoning written down rather than
// rediscovered by whoever adds the fourth channel.

/** The channels a coach can connect. Order is the order they are shown in. */
export const AD_CHANNELS = ['meta', 'google', 'tiktok'] as const;

export type AdChannel = (typeof AD_CHANNELS)[number];

/** True for a value that names one of the three. Used on anything read back
 *  out of the database, where a fourth provider could arrive from a newer
 *  build than the one reading it. */
export function isAdChannel(v: unknown): v is AdChannel {
  return typeof v === 'string' && (AD_CHANNELS as readonly string[]).includes(v);
}

/** What the channel is called, in the coach's words rather than the API's. */
export function channelLabel(c: AdChannel): string {
  switch (c) {
    case 'meta': return 'Meta';
    case 'google': return 'Google Ads';
    case 'tiktok': return 'TikTok';
  }
}

/** Which apps a channel's money was actually spent on, because "Meta" is not
 *  the word a coach uses for the place their ad ran. */
export function channelPlaces(c: AdChannel): string {
  switch (c) {
    case 'meta': return 'Facebook and Instagram';
    case 'google': return 'Google Search, YouTube and the display network';
    case 'tiktok': return 'TikTok';
  }
}

/**
 * Google's micros → a MAJOR-unit decimal string, which is the one shape every
 * channel hands to the matcher.
 *
 * This is the only micros conversion in the repo, and it is deliberately the
 * only one. The tempting second function is a direct micros → hundredths, which
 * would be a division by 10,000 and would be right; having both is how the two
 * come to disagree by a factor of a hundred on the day somebody edits one of
 * them. So Google is converted here into exactly what Meta and TikTok already
 * report, and from that point on all three go through adMatch.centsFromAmount
 * and are subject to one rule about what a hundredth is.
 *
 * Done as string arithmetic on the digits rather than as `n / 1e6`, for the
 * reason readMinorAmount in coachMoney.ts gives at length: a float division is a
 * rounding nobody asked for, and 12345678 / 1e6 is 12.345678 only in decimal —
 * in binary it is a number very slightly beside it. Here the digits are moved
 * and nothing is computed.
 *
 * Null for anything that is not a whole number of micros, and null is never a
 * zero: an ad whose cost came back as a word, an empty field or a negative is
 * an ad whose cost we do not know, and a zero would say the coach got it free.
 */
export function majorFromMicros(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const raw = String(v).trim().replace(/,/g, '');
  if (!/^\d+$/.test(raw)) return null;
  const padded = raw.padStart(7, '0');
  const whole = padded.slice(0, padded.length - 6).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(padded.length - 6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/* ── What one channel's latest sync knows ───────────────────────────────── */

/** One code's spend as ONE channel reported it. */
export type ChannelCodeSpend = { codeId: string | null; code: string; cents: number; ads: number };

/**
 * 'never'  connected and never synced. Unknown.
 * 'failed' the last sync could not ask, or was refused. Unknown.
 * 'ok'     the last sync answered, and what it answered is below.
 */
export type ChannelRunState = 'never' | 'ok' | 'failed';

/** One connected channel, reduced to what a total depends on. */
export type ChannelRun = {
  channel: AdChannel;
  /**
   * A channel counts towards the total only when the coach has connected it AND
   * said which ad account it is about. A half-made connection has no account to
   * read and never will until the coach chooses one, so it is not treated as a
   * hole in the figures — it is treated as a connection that is not finished,
   * which the screen says separately.
   */
  chosen: boolean;
  state: ChannelRunState;
  /** The AD ACCOUNT's currency, as that channel reported it. Null on a channel
   *  that has not read one — including an 'ok' run that saw no ads at all. */
  currency: string | null;
  /** What the last OK run attributed. Empty on every other state, and empty is
   *  not a claim: `state` is what says whether it is a fact. */
  codes: ChannelCodeSpend[];
};

/** One code's spend across every channel that reported it. */
export type CombinedCode = {
  codeId: string | null;
  code: string;
  cents: number;
  currency: string;
  /** Ads behind the figure, added across channels. */
  ads: number;
  /** Which channels this is made of, and how much each contributed. A coach
   *  who can see that £600 of £650 is Meta can act on it; a single figure only
   *  tells them the total is high. */
  parts: { channel: AdChannel; cents: number; ads: number }[];
};

export type CombineRefusal = 'no-channels' | 'channel-unread' | 'currency-clash' | 'no-currency';

export type Combined =
  | { ok: true; currency: string; codes: CombinedCode[]; channels: AdChannel[] }
  | { ok: false; reason: CombineRefusal; missing: AdChannel[]; currencies: string[]; channels: AdChannel[] };

/**
 * Three channels' figures into one, or the reason there is no one figure.
 *
 * Nothing here is a best effort. Every branch that cannot produce an honest
 * total refuses to produce any, and carries out what the caller needs to say
 * which channel is responsible — because "your ad spend could not be totalled"
 * is not actionable and "TikTok's last check failed" is.
 *
 * The order of the refusals is the order in which a coach can act on them:
 * nothing connected is a thing to do, an unread channel is a button to press or
 * a connection to remake, and a currency disagreement is a decision about which
 * money the accounts bill in.
 */
export function combineChannelSpend(runs: readonly ChannelRun[] | null | undefined): Combined {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && r.chosen);
  const channels = list.map((r) => r.channel);

  if (!list.length) {
    return { ok: false, reason: 'no-channels', missing: [], currencies: [], channels };
  }

  // Unknown first, and unknown wins over everything below it. A currency
  // disagreement among the channels that DID answer is not the headline when a
  // third channel's figure is missing entirely.
  const missing = list.filter((r) => r.state !== 'ok').map((r) => r.channel);
  if (missing.length) {
    return { ok: false, reason: 'channel-unread', missing, currencies: [], channels };
  }

  const currencies = [...new Set(list.map((r) => (r.currency || '').trim().toUpperCase()).filter(Boolean))].sort();
  if (currencies.length > 1) {
    return { ok: false, reason: 'currency-clash', missing: [], currencies, channels };
  }
  if (currencies.length === 0) {
    // Every channel answered and not one of them named a currency, which
    // happens when every connected account has no ads in it. There is nothing
    // to add up and no unit to add it up in, and a bare "0" would be a figure
    // in a currency nobody stated.
    return { ok: false, reason: 'no-currency', missing: [], currencies: [], channels };
  }
  const currency = currencies[0];

  const totals = new Map<string, CombinedCode>();
  for (const r of list) {
    for (const c of r.codes || []) {
      const code = String(c?.code ?? '').trim().toUpperCase();
      const cents = Number(c?.cents);
      if (!code || !Number.isFinite(cents)) continue;
      const ads = Number.isFinite(Number(c?.ads)) ? Number(c.ads) : 0;
      const row: CombinedCode = totals.get(code) ?? {
        codeId: c.codeId ?? null, code, cents: 0, currency, ads: 0, parts: [],
      };
      row.cents += cents;
      row.ads += ads;
      row.parts.push({ channel: r.channel, cents, ads });
      totals.set(code, row);
    }
  }

  const codes = [...totals.values()]
    .map((c) => ({
      ...c,
      // Stable channel order, so the same code reads the same way every time
      // and two codes' breakdowns can be compared down the screen.
      parts: c.parts.sort((a, b) => AD_CHANNELS.indexOf(a.channel) - AD_CHANNELS.indexOf(b.channel)),
    }))
    .sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code));

  return { ok: true, currency, codes, channels };
}

/** The channels a refusal is about, named as a coach would say them. */
export function channelList(cs: readonly AdChannel[]): string {
  const names = cs.map(channelLabel);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Why there is no total, in a sentence that names the channel and the remedy.
 *
 * Written here rather than on the screen because the same sentence has to be
 * right in the two places a coach meets it — the ad-spend screen and the
 * per-code figures it feeds — and a second copy is the one that softens.
 */
export function combineRefusalNote(c: Combined): string {
  if (c.ok) return '';
  switch (c.reason) {
    case 'no-channels':
      return 'No ad account is connected, so nothing here has been collected automatically. What you have typed in yourself is unaffected and is still what your figures are worked out from.';
    case 'channel-unread':
      return `${channelList(c.missing)} could not be read, so there is no total: what the other channels reported is not all of your ad spend, and printing it as though it were would make every channel look cheaper than it is. Each channel's own figure is below. Check ${channelList(c.missing)} again, and the total comes back on its own.`;
    case 'currency-clash':
      return `Your ad accounts bill in ${c.currencies.join(' and ')}, and those do not add together — the result would not be an amount of any money. Each channel's own figure is below, in its own currency. Repple will not convert one into the other, because the rate would be one nobody chose.`;
    case 'no-currency':
      return 'Every connected channel was read and none of them has any ads in it, so there is nothing to total and no currency to total it in. A code you promote without paying for it will never appear here — no ad spend is unknown, not free.';
  }
}

/** What one channel's state means, said to the coach with what to do next. */
export function channelStateNote(c: AdChannel, state: ChannelRunState): string {
  const name = channelLabel(c);
  switch (state) {
    case 'never':
      return `${name} is connected and has never been checked, so what you have spent there is unknown rather than nothing. Press Check Now and it will be counted.`;
    case 'failed':
      return `The last ${name} check failed, so what you have spent there is unknown. Nothing was recorded from it — a failed check knows no figures, so it writes none.`;
    case 'ok':
      return `${name} answered, and what it reported is counted below.`;
  }
}

/**
 * Said above the per-channel list, whenever the figures are being shown apart.
 *
 * The distinction it protects is the one this whole feature turns on: a channel
 * missing from a total is not a channel that cost nothing.
 */
export const NO_TOTAL_NOTE =
  'There is no combined figure while a channel is unread, because a total that quietly leaves one out is a smaller number that looks exactly like a real one. The channels that did answer are listed with what each of them reported, and those figures are real.';

/**
 * Said wherever the combined figure IS shown, because "your ad spend" means
 * the accounts the coach linked and nothing else.
 */
export function coverageNote(channels: readonly AdChannel[]): string {
  if (!channels.length) return 'No ad account is connected, so this covers nothing that was spent on ads.';
  return `This covers ${channelList(channels)}. Money you spent anywhere else — a boosted post paid for on somebody else's card, a gym noticeboard, a flyer — is not in it and never will be, so a code with nothing against it here is a code whose cost is unknown rather than nought.`;
}

/**
 * What a human has to obtain before a channel can read anything at all.
 *
 * Kept in the source rather than only in a README because the screen shows it:
 * a coach who taps Connect on a channel the owner has not set up gets this
 * sentence instead of a browser that opens onto an error page, and the owner
 * gets a list of exactly what is missing rather than "not configured".
 */
export function channelSetupNote(c: AdChannel): string {
  switch (c) {
    case 'meta':
      return 'Connecting a Meta ad account is not set up in this build — the owner sets EXPO_PUBLIC_META_ADS_CLIENT_ID (the Meta app id) and the META_ADS_CLIENT_SECRET Supabase secret.';
    case 'google':
      return 'Connecting a Google Ads account is not set up in this build — the owner sets EXPO_PUBLIC_GOOGLE_ADS_CLIENT_ID (the Google Cloud OAuth client id) and, as Supabase secrets, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_DEVELOPER_TOKEN. The developer token is issued by Google against a Google Ads manager account and has to be approved before it reads a live account.';
    case 'tiktok':
      return 'Connecting a TikTok ad account is not set up in this build — the owner sets EXPO_PUBLIC_TIKTOK_ADS_APP_ID (the TikTok for Business app id) and the TIKTOK_ADS_APP_SECRET Supabase secret.';
  }
}
