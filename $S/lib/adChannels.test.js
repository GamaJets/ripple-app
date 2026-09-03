"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Three ad channels added up, and — the half that matters — refused.
//
// The bug this guards is one number. A coach spends £400 on Meta, £250 on
// Google and £180 on TikTok; TikTok's check fails; the screen prints £650. That
// figure is not wrong-looking, it is not flagged, and it is the number that goes
// into next month's budget. Every assertion below is about that £650 never
// being produced — and about the £400 and the £250 still being shown, because
// withholding the total is not the same as withholding the facts.
//
// Compile with tsc, run with node. No node:assert.
const adChannels_1 = require("./adChannels");
const adMatch_1 = require("./adMatch");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const run = (over) => ({
    chosen: true, state: 'ok', currency: 'GBP', codes: [], ...over,
});
const refusal = (c) => (c.ok ? 'ok' : c.reason);
const centsFor = (c, code) => (c.ok ? c.codes.find((x) => x.code === code)?.cents : undefined) ?? null;
/* ── the unit each provider reports in ─────────────────────────────────── */
// Google. Micros are millionths of the base currency unit: $12.50 arrives as
// 12500000, and it is turned into the same major-unit decimal Meta and TikTok
// already send, so that one rule decides what a hundredth is.
eq((0, adChannels_1.majorFromMicros)(12500000), '12.5', 'micros to a major-unit decimal, by moving the point');
eq((0, adChannels_1.majorFromMicros)(12345678), '12.345678', 'and every place is kept, rather than rounded by a float');
eq((0, adChannels_1.majorFromMicros)(999999), '0.999999', 'under one whole unit keeps its leading nought');
eq((0, adChannels_1.majorFromMicros)(1000000), '1', 'one whole unit is one');
eq((0, adChannels_1.majorFromMicros)(0), '0', 'nothing spent is nothing, not "0.000000"');
eq((0, adChannels_1.majorFromMicros)(null), null, 'a missing cost is unknown');
eq((0, adChannels_1.majorFromMicros)(''), null, 'so is an empty one');
eq((0, adChannels_1.majorFromMicros)('unknown'), null, 'so is a word');
eq((0, adChannels_1.majorFromMicros)('-1000000'), null, 'a negative cost is not something an ad account reports');
eq((0, adChannels_1.majorFromMicros)('12.5'), null, 'and micros are whole; a decimal one is not a figure we understand');
// The whole point, as one line: Google's micros and Meta's decimal reach the
// same stored figure. Reading 12500000 as if it were already hundredths would
// tell a coach they had spent £125,000 on one ad.
const viaMicros = (m) => (0, adMatch_1.centsFromAmount)((0, adChannels_1.majorFromMicros)(m), 'GBP');
eq(viaMicros(12500000), 1250, 'twelve dollars fifty in micros is 1250 hundredths');
eq(viaMicros(12500000), (0, adMatch_1.centsFromAmount)('12.50', 'GBP'), 'the two channels agree on the figure');
eq(viaMicros(0), 0, 'a real zero is a real figure — an ad that ran and cost nothing');
eq(viaMicros(1000000), 100, 'one whole unit is a hundred hundredths');
eq(viaMicros(5000), 1, 'half a penny of spend rounds to the nearest hundredth');
eq(viaMicros(4999), 0, 'and just under half rounds down, rather than being dropped');
ok(viaMicros(12500000) !== 12500000, 'micros are not hundredths, and are never read as them');
eq((0, adMatch_1.centsFromAmount)((0, adChannels_1.majorFromMicros)('999999999990000'), 'GBP'), 99999999999, 'the largest figure part 98 holds is still an amount');
eq((0, adMatch_1.centsFromAmount)((0, adChannels_1.majorFromMicros)('1000000000000000'), 'GBP'), null, 'and one past it is refused rather than stored wrong');
// TikTok reports account currency, like Meta, so it takes the SAME reader. The
// assertion is here so that a later change to one of them cannot be made
// without a test disagreeing.
eq((0, adMatch_1.centsFromAmount)('1265.87', 'GBP'), 126587, 'TikTok’s decimal string is read as major units, exactly as Meta’s is');
// And the currency is asked, not assumed, whichever channel the figure came
// from. Google reports micros of the account's base unit; a yen account's
// 1,234,000,000 micros is ¥1,234 and 1234 minor units, not 123,400.
eq((0, adMatch_1.centsFromAmount)((0, adChannels_1.majorFromMicros)(1234000000), 'JPY'), 1234, 'Google’s micros in a currency with no minor unit are not multiplied by a hundred');
eq((0, adMatch_1.centsFromAmount)((0, adChannels_1.majorFromMicros)(12345000), 'KWD'), 12345, 'nor divided by ten in one with three places');
/* ── naming the channels ───────────────────────────────────────────────── */
eq(adChannels_1.AD_CHANNELS.length, 3, 'three channels');
eq((0, adChannels_1.channelLabel)('meta'), 'Meta', 'Meta is called Meta');
eq((0, adChannels_1.channelLabel)('google'), 'Google Ads', 'and Google Ads is not called Google');
eq((0, adChannels_1.channelLabel)('tiktok'), 'TikTok', 'and TikTok keeps its capital');
ok((0, adChannels_1.isAdChannel)('google') && !(0, adChannels_1.isAdChannel)('snapchat') && !(0, adChannels_1.isAdChannel)(null), 'a provider from a newer build than the one reading it is not silently accepted');
for (const c of adChannels_1.AD_CHANNELS) {
    ok((0, adChannels_1.channelPlaces)(c).length > 4, `${c} says where the money actually went`);
    ok(/set|owner/i.test((0, adChannels_1.channelSetupNote)(c)), `${c}'s setup note names what the owner has to obtain`);
    for (const s of ['never', 'ok', 'failed']) {
        ok((0, adChannels_1.channelStateNote)(c, s).includes((0, adChannels_1.channelLabel)(c)), `${c} in state ${s} is named in its own sentence`);
    }
}
ok(/unknown rather than nothing/i.test((0, adChannels_1.channelStateNote)('tiktok', 'never')), 'a channel never checked is unknown, and the word "nothing" is refused for it');
ok(/unknown/i.test((0, adChannels_1.channelStateNote)('google', 'failed')), 'and so is one whose check failed');
eq((0, adChannels_1.channelList)(['meta']), 'Meta', 'one channel is named on its own');
eq((0, adChannels_1.channelList)(['meta', 'google']), 'Meta and Google Ads', 'two are joined by "and"');
eq((0, adChannels_1.channelList)(['meta', 'google', 'tiktok']), 'Meta, Google Ads and TikTok', 'three read as a list');
/* ── the total, when every channel answered ────────────────────────────── */
const all = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'google', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 2 }] }),
    run({ channel: 'tiktok', codes: [{ codeId: 'b', code: 'P4RSTV', cents: 18000, ads: 1 }] }),
]);
eq(refusal(all), 'ok', 'three channels that all answered produce a figure');
eq(centsFor(all, 'K7M2QX'), 65000, 'a code advertised on two channels is the sum of both');
eq(centsFor(all, 'P4RSTV'), 18000, 'and a code on one channel is that channel');
eq(all.ok && all.currency, 'GBP', 'in the currency all three accounts bill in');
eq(all.ok ? all.codes[0].code : null, 'K7M2QX', 'biggest spend first — the figure an error in is worth the most');
eq(all.ok ? all.codes[0].ads : null, 5, 'and the ads behind it are added across channels too');
eq(all.ok ? all.codes[0].parts.length : null, 2, 'the breakdown says which channels it is made of');
eq(all.ok ? all.codes[0].parts[0].channel : null, 'meta', 'in a stable order, whatever order the reads landed in');
eq(all.ok ? all.codes[0].parts[1].cents : null, 25000, 'with each channel’s own contribution beside it');
ok(all.ok && all.channels.length === 3, 'and the total says which channels it covers');
// A channel that ran and attributed nothing to a code is a FACT about that
// code, and zero is the honest contribution. This is the one case where a
// missing figure legitimately behaves as nought.
const quiet = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'google', currency: null, codes: [] }),
]);
eq(refusal(quiet), 'ok', 'a channel that answered and had no ads does not block the total');
eq(centsFor(quiet, 'K7M2QX'), 40000, 'and contributes nothing to it, which is what it reported');
/* ── the refusal this module exists for ────────────────────────────────── */
const withFailed = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'google', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 2 }] }),
    run({ channel: 'tiktok', state: 'failed', currency: null, codes: [] }),
]);
eq(refusal(withFailed), 'channel-unread', 'one channel that could not be read makes the TOTAL unknown');
eq(withFailed.ok, false, 'and there is no £650 to print');
eq(!withFailed.ok ? withFailed.missing.join(',') : '', 'tiktok', 'the channel responsible is named, not just "an error"');
ok(!withFailed.ok && /TikTok/.test((0, adChannels_1.combineRefusalNote)(withFailed)), 'and the sentence names it too');
ok(!withFailed.ok && /cheaper/.test((0, adChannels_1.combineRefusalNote)(withFailed)), 'and says what the missing figure would have done to the coach’s decision');
const neverSynced = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'google', state: 'never', currency: null, codes: [] }),
]);
eq(refusal(neverSynced), 'channel-unread', 'a connected channel never once checked is unknown, not zero');
eq(!neverSynced.ok ? neverSynced.missing[0] : '', 'google', 'and it is named');
const bothOut = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', state: 'failed', currency: null }),
    run({ channel: 'google', state: 'never', currency: null }),
    run({ channel: 'tiktok', codes: [{ codeId: 'b', code: 'P4RSTV', cents: 18000, ads: 1 }] }),
]);
eq(!bothOut.ok ? bothOut.missing.length : 0, 2, 'two unread channels are both named');
ok(!bothOut.ok && /Meta and Google Ads/.test((0, adChannels_1.combineRefusalNote)(bothOut)), 'and both are read out in the sentence');
/* ── a channel the coach never connected is not a hole ─────────────────── */
const onlyMeta = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'google', chosen: false, state: 'never', currency: null }),
    run({ channel: 'tiktok', chosen: false, state: 'never', currency: null }),
]);
eq(refusal(onlyMeta), 'ok', 'a coach who runs no Google or TikTok ads still gets a figure');
eq(centsFor(onlyMeta, 'K7M2QX'), 40000, 'made of the one channel they did connect');
eq(onlyMeta.ok ? onlyMeta.channels.join(',') : '', 'meta', 'which the figure says it covers');
ok(/Meta/.test((0, adChannels_1.coverageNote)(['meta'])) && /unknown rather than nought/.test((0, adChannels_1.coverageNote)(['meta'])), 'and the coverage note refuses to read an absent channel as a nought');
// Connected, and no ad account chosen yet. Half a connection reads nothing and
// never will until the coach picks one, so it is not counted as unknown either.
const halfMade = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'tiktok', chosen: false, state: 'never', currency: null }),
]);
eq(refusal(halfMade), 'ok', 'a connection with no ad account chosen does not withhold the total');
/* ── currencies, which do not add ──────────────────────────────────────── */
const mixed = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', currency: 'GBP', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
    run({ channel: 'google', currency: 'AED', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 2 }] }),
]);
eq(refusal(mixed), 'currency-clash', 'sterling and dirhams are not added');
eq(!mixed.ok ? mixed.currencies.join(',') : '', 'AED,GBP', 'and both are named, so the coach can fix the accounts');
ok(!mixed.ok && /not be an amount of any money/.test((0, adChannels_1.combineRefusalNote)(mixed)), 'said in those words');
ok(!mixed.ok && /rate/.test((0, adChannels_1.combineRefusalNote)(mixed)), 'and the reason nothing is converted is given');
// Case and spacing are not a second currency.
const sameMoney = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', currency: 'gbp', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 1 }] }),
    run({ channel: 'google', currency: ' GBP ', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 10000, ads: 1 }] }),
]);
eq(refusal(sameMoney), 'ok', 'the same currency written two ways is one currency');
eq(centsFor(sameMoney, 'K7M2QX'), 50000, 'and the two figures add');
eq(sameMoney.ok && sameMoney.currency, 'GBP', 'stated in upper case, once');
// An unread channel outranks a currency disagreement: the missing figure is the
// bigger fact, and fixing the currency would not produce a total anyway.
const both = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', currency: 'GBP', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 1 }] }),
    run({ channel: 'google', currency: 'AED', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 1 }] }),
    run({ channel: 'tiktok', state: 'failed', currency: null }),
]);
eq(refusal(both), 'channel-unread', 'an unread channel is reported before a currency disagreement');
/* ── nothing connected, and nothing to say ─────────────────────────────── */
eq(refusal((0, adChannels_1.combineChannelSpend)([])), 'no-channels', 'no connected channel is not a total of zero');
eq(refusal((0, adChannels_1.combineChannelSpend)(null)), 'no-channels', 'and neither is a read that brought back nothing');
ok(/typed in yourself/.test((0, adChannels_1.combineRefusalNote)((0, adChannels_1.combineChannelSpend)([]))), 'and the coach is reminded their own figures are untouched');
const silent = (0, adChannels_1.combineChannelSpend)([
    run({ channel: 'meta', currency: null, codes: [] }),
    run({ channel: 'google', currency: null, codes: [] }),
]);
eq(refusal(silent), 'no-currency', 'every channel read, none with any ads, is not a figure of nought');
ok(/no ad spend is unknown, not free/.test((0, adChannels_1.combineRefusalNote)(silent)), 'and says the sentence the rest of this feature turns on');
ok(/smaller number/.test(adChannels_1.NO_TOTAL_NOTE), 'the note above the split figures says why there is no total');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`adChannels: ok (${adChannels_1.AD_CHANNELS.length} channels, and a total refused wherever one of them is unknown)`);
