// Matching an ad to the code it points at, and — the half that matters — the
// money it refuses to pretend it matched. Compile with tsc, run with node.
//
// The bug this guards is not a parsing one. It is a coach whose £600 Instagram
// campaign pointed at a link with no `?c=` on it, being shown £0 against
// Instagram and £180 against a flyer, and moving next month's budget to the
// flyer. Everything below pins down that the unattributable money is carried
// out of here as a figure with a name on it, not dropped from a total.
import {
  CURRENCY_CONFLICT_NOTE, NO_CURRENCY_NOTE, UNMATCHED_NOTE,
  centsFromAmount, codeFromUrl, matchAds, unmatchedReasonNote, urlsFromCreative,
  type AdInsight, type KnownCode, type MatchResult, type UnmatchReason,
} from './adMatch';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CODES: KnownCode[] = [
  { id: 'code-ig', code: 'K7M2QX', label: 'Instagram bio' },
  { id: 'code-tt', code: 'P4RSTV', label: 'TikTok' },
  { id: null, code: 'DEF123', label: 'Your main code' },
];

const ad = (over: Partial<AdInsight> = {}): AdInsight => ({
  adId: 'ad-1', adName: 'Summer challenge', spend: '120.00', currency: 'GBP',
  urls: ['https://www.repplefitness.com/join?c=K7M2QX'], ...over,
});

/** Readers, so an assertion about one unmatched ad is not a nest of finds. */
const reasonsOf = (r: MatchResult): string => r.unmatched.map((u) => u.reason).join(',');
const centsFor = (r: MatchResult, code: string): number | null =>
  r.matched.find((m) => m.code === code)?.cents ?? null;

/* ── reading the code out of a destination ─────────────────────────────── */

eq(codeFromUrl('https://www.repplefitness.com/join?c=K7M2QX'), 'K7M2QX', 'the link a coach pastes into their ad carries the code');
eq(codeFromUrl('https://www.repplefitness.com/join?c=k7m2qx'), 'K7M2QX', 'and case is not a second code');
eq(codeFromUrl('https://www.repplefitness.com/join?c=K7M2QX&utm_source=ig&utm_medium=paid'), 'K7M2QX',
  'tracking parameters after the code do not hide it');
eq(codeFromUrl('https://www.repplefitness.com/join?utm_source=ig&c=K7M2QX'), 'K7M2QX', 'nor before it');
eq(codeFromUrl('https://www.repplefitness.com/join?C=K7M2QX'), 'K7M2QX',
  'a coach retyping the link by hand capitalises the parameter about as often as not');
eq(codeFromUrl('https://www.repplefitness.com/join?c=K7M2QX#top'), 'K7M2QX', 'a fragment on the end is not part of the code');

// Meta rewrites a page post's destination through its own shim. Without
// following it, every ad on a boosted post reads as having no code at all.
eq(codeFromUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.repplefitness.com%2Fjoin%3Fc%3DP4RSTV&h=AT1'),
  'P4RSTV', 'the code inside Meta’s link shim is found');
eq(codeFromUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fx.com%2Fno-code&h=AT1'), null,
  'and a shim around a link with no code is still no code');
// The outer link is the more direct statement of intent.
eq(codeFromUrl('https://l.facebook.com/l.php?c=K7M2QX&u=https%3A%2F%2Fx.com%2Fjoin%3Fc%3DP4RSTV'), 'K7M2QX',
  'a code on the outer link wins over one inside a shim');

eq(codeFromUrl('https://www.repplefitness.com/join'), null, 'a link with no query carries no code');
eq(codeFromUrl('https://www.repplefitness.com/join?c='), null, 'and an empty c= is not a code');
eq(codeFromUrl(''), null, 'nor is nothing');
eq(codeFromUrl(null), null, 'nor is null');
eq(codeFromUrl('not a url at all ?c=K7M2QX'), 'K7M2QX', 'a malformed link is parsed rather than thrown on');
eq(codeFromUrl('https://x.com/j?c=%4B7M2QX'), 'K7M2QX', 'a half-encoded value still decodes');

// The value is NOT truncated to six characters. normaliseCode() would turn this
// into "HELLOW", which could be a real code belonging to somebody else — and
// the coach would be shown their money against a stranger's channel.
eq(codeFromUrl('https://www.repplefitness.com/join?c=hello-world'), 'HELLO-WORLD',
  'a wrong value is returned whole, never trimmed into a code that might be real');

/* ── the amount ────────────────────────────────────────────────────────── */

eq(centsFromAmount('120.00'), 12000, 'a provider decimal becomes minor units');
eq(centsFromAmount('0'), 0, 'a real zero is a real figure');
eq(centsFromAmount('1234'), 123400, 'a whole-number amount is major units too — money() divides by 100 for every currency');
eq(centsFromAmount('1,250.50'), 125050, 'a grouped figure is still an amount');
eq(centsFromAmount(''), null, 'an empty spend is unknown');
eq(centsFromAmount(null), null, 'and so is a missing one');
eq(centsFromAmount('unknown'), null, 'and so is a word');
eq(centsFromAmount('-5'), null, 'a negative spend is not an amount an ad account reports');
eq(centsFromAmount('999999999.99'), 99999999999, 'the largest figure part 98 will hold is still an amount');
eq(centsFromAmount('1000000000'), null, 'and one past it is refused rather than stored wrong — the same ceiling a typed figure gets');

/* ── pulling destinations off whatever shape the creative arrived in ───── */

const carousel = {
  object_story_spec: {
    link_data: {
      link: 'https://www.repplefitness.com/join?c=K7M2QX',
      child_attachments: [
        { link: 'https://www.repplefitness.com/join?c=P4RSTV' },
        { link: 'https://example.com/nothing' },
      ],
    },
  },
  image_url: 'https://scontent.example.com/pic.jpg',
};
const found = urlsFromCreative(carousel);
ok(found.includes('https://www.repplefitness.com/join?c=K7M2QX'), 'the link on a page-post creative is found');
ok(found.includes('https://www.repplefitness.com/join?c=P4RSTV'), 'and so is one nested in a carousel card');
ok(codeFromUrl(found[0]) != null, 'a URL that names a code is offered before an image URL, so the ad is matched on it');
eq(urlsFromCreative(null).length, 0, 'nothing in, nothing out');
eq(urlsFromCreative({ a: { b: { c: 'https://x.com/1' } } })[0], 'https://x.com/1', 'a link nested in a shape nobody predicted is still found');

/* ── unmatched spend is money, and is carried out with a name on it ────── */

const mixed = matchAds([
  ad({ adId: 'a1', spend: '120.00', urls: ['https://www.repplefitness.com/join?c=K7M2QX'] }),
  ad({ adId: 'a2', adName: 'Retargeting', spend: '600.00', urls: ['https://www.repplefitness.com/'] }),
  ad({ adId: 'a3', adName: 'Story ad', spend: '45.50', urls: [] }),
  ad({ adId: 'a4', adName: 'Typo ad', spend: '30.00', urls: ['https://www.repplefitness.com/join?c=ZZZZZZ'] }),
], CODES);

eq(centsFor(mixed, 'K7M2QX'), 12000, 'the ad that pointed at a code is credited to it');
eq(mixed.unmatched.length, 3, 'and the three that could not be placed are all carried out');
eq(mixed.unmatchedCents, 67550, 'their spend is totalled — £675.50 the app could not attribute');
ok(mixed.unmatchedCents! > mixed.matchedCents, 'which here is more than everything it could, and the coach is shown that');
eq(reasonsOf(mixed), 'no-code,no-link,unknown-code', 'each says which of the four it is, biggest spend first');
eq(mixed.unmatched[0].adName, 'Retargeting', 'and names the ad, so the coach can go and fix that one');
eq(mixed.unmatched[0].url, 'https://www.repplefitness.com/', 'with the destination it does have');
eq(mixed.unmatched[2].url, 'https://www.repplefitness.com/join?c=ZZZZZZ', 'and the one carrying a code nobody owns is shown whole');
eq(mixed.adsSeen, 4, 'the ad count is what came in, not what could be placed');

// The whole point, stated as an assertion: an ad with no code is NOT zero, and
// it is NOT quietly dropped. Both would produce a smaller, tidier, wrong total.
const silent = matchAds([ad({ adId: 'a2', spend: '600.00', urls: ['https://www.repplefitness.com/'] })], CODES);
eq(silent.matched.length, 0, 'a campaign with no code on it credits nothing to any code');
eq(silent.matchedCents, 0, 'so nothing is attributed');
eq(silent.unmatchedCents, 60000, 'and every penny of it is still reported as spent');
eq(silent.unmatched[0].reason, 'no-code', 'as unattributable, not as absent');

/* ── an unreadable amount makes the total unknown, not short ───────────── */

const unreadable = matchAds([
  ad({ adId: 'a1', spend: '120.00', urls: ['https://x.com/none'] }),
  ad({ adId: 'a2', spend: null, urls: ['https://x.com/none'] }),
], CODES);
eq(unreadable.unmatchedCents, null, 'one unreadable amount makes the unattributed total unknown');
ok(unreadable.unmatched.some((u) => u.reason === 'no-amount' && u.cents === null),
  'and that ad carries a null, not a zero — we do not know what it cost');
ok(!unreadable.unmatched.some((u) => u.reason === 'no-amount' && u.cents === 0),
  'a zero there would say the coach got it free');

// An ad whose amount is unreadable is never folded into a code's figure, even
// when it points at one — that would report a code's spend as lower than it is.
const unreadableMatched = matchAds([ad({ spend: 'n/a' })], CODES);
eq(unreadableMatched.matched.length, 0, 'an ad with no readable amount is not credited to the code it names');
eq(unreadableMatched.unmatched[0].reason, 'no-amount', 'it is reported as an amount nobody could read');

/* ── several ads on one code, and the default code ─────────────────────── */

const stacked = matchAds([
  ad({ adId: 'a1', spend: '120.00' }),
  ad({ adId: 'a2', spend: '80.50' }),
  ad({ adId: 'a3', spend: '10.00', urls: ['https://www.repplefitness.com/join?c=DEF123'] }),
], CODES);
eq(centsFor(stacked, 'K7M2QX'), 20050, 'two ads on one code add up');
eq(stacked.matched.find((m) => m.code === 'K7M2QX')?.ads, 2, 'and it says how many ads were behind the figure');
eq(stacked.matched.find((m) => m.code === 'DEF123')?.codeId, null,
  'the default code has no id of its own and is carried as null, exactly as coach_code_spend keys it');
eq(stacked.matched[0].code, 'K7M2QX', 'the biggest spend is first — it is the figure worth checking');
eq(stacked.unmatched.length, 0, 'and nothing is unmatched when every ad named a real code');

/* ── currency is never assumed and never added across ──────────────────── */

eq(matchAds([ad()], CODES).currency, 'GBP', 'the ad account’s own currency is carried out');
const crossed = matchAds([ad({ adId: 'a1', currency: 'GBP' }), ad({ adId: 'a2', currency: 'USD' })], CODES);
eq(crossed.currencyConflict, true, 'two currencies in one account is a conflict');
eq(crossed.currency, null, 'and there is no single currency to label a total with');
const silentCcy = matchAds([ad({ currency: null })], CODES);
eq(silentCcy.currency, null, 'an account that did not say its currency is not given one');
eq(silentCcy.currencyConflict, false, 'which is a different problem from disagreeing, and says so');

/* ── nothing in ────────────────────────────────────────────────────────── */

const none = matchAds([], CODES);
eq(none.adsSeen, 0, 'an account with no ads in the window saw no ads');
eq(none.matchedCents, 0, 'and attributed nothing');
eq(none.unmatchedCents, 0, 'and left nothing unattributed');
eq(matchAds(null, null).adsSeen, 0, 'nothing at all is handled without a coach list either');
// A coach with no codes yet: every ad's code is unknown to them, which is not
// the same as the ad having no code.
const noCodes = matchAds([ad()], []);
eq(noCodes.unmatched[0].reason, 'unknown-code', 'with no codes of their own, a real code on an ad is one we do not know');

/* ── the sentences the screen shows ────────────────────────────────────── */

for (const r of ['no-link', 'no-code', 'unknown-code', 'no-amount'] as UnmatchReason[]) {
  ok(unmatchedReasonNote(r).length > 20, `${r} has a sentence a coach can act on`);
}
ok(/destination/i.test(unmatchedReasonNote('no-code')), 'the fixable one names what to change');
ok(/unknown rather than nothing/i.test(unmatchedReasonNote('no-amount')), 'and the unknown one says it is not nothing');
ok(/not missing/i.test(UNMATCHED_NOTE) && /not nothing/i.test(UNMATCHED_NOTE),
  'the note above the list says unattributed money is money');
ok(/not an amount of money/i.test(CURRENCY_CONFLICT_NOTE), 'a mixed-currency account is refused, and told why');
ok(/Nothing was recorded/i.test(NO_CURRENCY_NOTE), 'and so is one with no currency at all');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`adMatch: ok (${mixed.unmatched.length} unattributable ads carried out rather than dropped)`);
