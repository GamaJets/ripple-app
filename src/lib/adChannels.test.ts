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
import {
  AD_CHANNELS, NO_TOTAL_NOTE, channelLabel, channelList, channelPlaces,
  channelSetupNote, channelStateNote, combineChannelSpend, combineRefusalNote, coverageNote,
  isAdChannel, majorFromMicros,
  type AdChannel, type ChannelRun, type Combined,
} from './adChannels';
import { centsFromAmount } from './adMatch';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const run = (over: Partial<ChannelRun> & { channel: AdChannel }): ChannelRun => ({
  chosen: true, state: 'ok', currency: 'GBP', codes: [], ...over,
});

const refusal = (c: Combined): string => (c.ok ? 'ok' : c.reason);
const centsFor = (c: Combined, code: string): number | null =>
  (c.ok ? c.codes.find((x) => x.code === code)?.cents : undefined) ?? null;

/* ── the unit each provider reports in ─────────────────────────────────── */

// Google. Micros are millionths of the base currency unit: $12.50 arrives as
// 12500000, and it is turned into the same major-unit decimal Meta and TikTok
// already send, so that one rule decides what a hundredth is.
eq(majorFromMicros(12500000), '12.5', 'micros to a major-unit decimal, by moving the point');
eq(majorFromMicros(12345678), '12.345678', 'and every place is kept, rather than rounded by a float');
eq(majorFromMicros(999999), '0.999999', 'under one whole unit keeps its leading nought');
eq(majorFromMicros(1000000), '1', 'one whole unit is one');
eq(majorFromMicros(0), '0', 'nothing spent is nothing, not "0.000000"');
eq(majorFromMicros(null), null, 'a missing cost is unknown');
eq(majorFromMicros(''), null, 'so is an empty one');
eq(majorFromMicros('unknown'), null, 'so is a word');
eq(majorFromMicros('-1000000'), null, 'a negative cost is not something an ad account reports');
eq(majorFromMicros('12.5'), null, 'and micros are whole; a decimal one is not a figure we understand');

// The whole point, as one line: Google's micros and Meta's decimal reach the
// same stored figure. Reading 12500000 as if it were already hundredths would
// tell a coach they had spent £125,000 on one ad.
const viaMicros = (m: number) => centsFromAmount(majorFromMicros(m));
eq(viaMicros(12500000), 1250, 'twelve dollars fifty in micros is 1250 hundredths');
eq(viaMicros(12500000), centsFromAmount('12.50'), 'the two channels agree on the figure');
eq(viaMicros(0), 0, 'a real zero is a real figure — an ad that ran and cost nothing');
eq(viaMicros(1000000), 100, 'one whole unit is a hundred hundredths');
eq(viaMicros(5000), 1, 'half a penny of spend rounds to the nearest hundredth');
eq(viaMicros(4999), 0, 'and just under half rounds down, rather than being dropped');
ok(viaMicros(12500000) !== 12500000, 'micros are not hundredths, and are never read as them');
eq(centsFromAmount(majorFromMicros('999999999990000')), 99999999999,
  'the largest figure part 98 holds is still an amount');
eq(centsFromAmount(majorFromMicros('1000000000000000')), null,
  'and one past it is refused rather than stored wrong');

// TikTok reports account currency, like Meta, so it takes the SAME reader. The
// assertion is here so that a later change to one of them cannot be made
// without a test disagreeing.
eq(centsFromAmount('1265.87'), 126587, 'TikTok’s decimal string is read as major units, exactly as Meta’s is');

/* ── naming the channels ───────────────────────────────────────────────── */

eq(AD_CHANNELS.length, 3, 'three channels');
eq(channelLabel('meta'), 'Meta', 'Meta is called Meta');
eq(channelLabel('google'), 'Google Ads', 'and Google Ads is not called Google');
eq(channelLabel('tiktok'), 'TikTok', 'and TikTok keeps its capital');
ok(isAdChannel('google') && !isAdChannel('snapchat') && !isAdChannel(null),
  'a provider from a newer build than the one reading it is not silently accepted');
for (const c of AD_CHANNELS) {
  ok(channelPlaces(c).length > 4, `${c} says where the money actually went`);
  ok(/set|owner/i.test(channelSetupNote(c)), `${c}'s setup note names what the owner has to obtain`);
  for (const s of ['never', 'ok', 'failed'] as const) {
    ok(channelStateNote(c, s).includes(channelLabel(c)), `${c} in state ${s} is named in its own sentence`);
  }
}
ok(/unknown rather than nothing/i.test(channelStateNote('tiktok', 'never')),
  'a channel never checked is unknown, and the word "nothing" is refused for it');
ok(/unknown/i.test(channelStateNote('google', 'failed')), 'and so is one whose check failed');
eq(channelList(['meta']), 'Meta', 'one channel is named on its own');
eq(channelList(['meta', 'google']), 'Meta and Google Ads', 'two are joined by "and"');
eq(channelList(['meta', 'google', 'tiktok']), 'Meta, Google Ads and TikTok', 'three read as a list');

/* ── the total, when every channel answered ────────────────────────────── */

const all = combineChannelSpend([
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
const quiet = combineChannelSpend([
  run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
  run({ channel: 'google', currency: null, codes: [] }),
]);
eq(refusal(quiet), 'ok', 'a channel that answered and had no ads does not block the total');
eq(centsFor(quiet, 'K7M2QX'), 40000, 'and contributes nothing to it, which is what it reported');

/* ── the refusal this module exists for ────────────────────────────────── */

const withFailed = combineChannelSpend([
  run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
  run({ channel: 'google', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 2 }] }),
  run({ channel: 'tiktok', state: 'failed', currency: null, codes: [] }),
]);
eq(refusal(withFailed), 'channel-unread', 'one channel that could not be read makes the TOTAL unknown');
eq(withFailed.ok, false, 'and there is no £650 to print');
eq(!withFailed.ok ? withFailed.missing.join(',') : '', 'tiktok', 'the channel responsible is named, not just "an error"');
ok(!withFailed.ok && /TikTok/.test(combineRefusalNote(withFailed)), 'and the sentence names it too');
ok(!withFailed.ok && /cheaper/.test(combineRefusalNote(withFailed)),
  'and says what the missing figure would have done to the coach’s decision');

const neverSynced = combineChannelSpend([
  run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
  run({ channel: 'google', state: 'never', currency: null, codes: [] }),
]);
eq(refusal(neverSynced), 'channel-unread', 'a connected channel never once checked is unknown, not zero');
eq(!neverSynced.ok ? neverSynced.missing[0] : '', 'google', 'and it is named');

const bothOut = combineChannelSpend([
  run({ channel: 'meta', state: 'failed', currency: null }),
  run({ channel: 'google', state: 'never', currency: null }),
  run({ channel: 'tiktok', codes: [{ codeId: 'b', code: 'P4RSTV', cents: 18000, ads: 1 }] }),
]);
eq(!bothOut.ok ? bothOut.missing.length : 0, 2, 'two unread channels are both named');
ok(!bothOut.ok && /Meta and Google Ads/.test(combineRefusalNote(bothOut)), 'and both are read out in the sentence');

/* ── a channel the coach never connected is not a hole ─────────────────── */

const onlyMeta = combineChannelSpend([
  run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
  run({ channel: 'google', chosen: false, state: 'never', currency: null }),
  run({ channel: 'tiktok', chosen: false, state: 'never', currency: null }),
]);
eq(refusal(onlyMeta), 'ok', 'a coach who runs no Google or TikTok ads still gets a figure');
eq(centsFor(onlyMeta, 'K7M2QX'), 40000, 'made of the one channel they did connect');
eq(onlyMeta.ok ? onlyMeta.channels.join(',') : '', 'meta', 'which the figure says it covers');
ok(/Meta/.test(coverageNote(['meta'])) && /unknown rather than nought/.test(coverageNote(['meta'])),
  'and the coverage note refuses to read an absent channel as a nought');

// Connected, and no ad account chosen yet. Half a connection reads nothing and
// never will until the coach picks one, so it is not counted as unknown either.
const halfMade = combineChannelSpend([
  run({ channel: 'meta', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
  run({ channel: 'tiktok', chosen: false, state: 'never', currency: null }),
]);
eq(refusal(halfMade), 'ok', 'a connection with no ad account chosen does not withhold the total');

/* ── currencies, which do not add ──────────────────────────────────────── */

const mixed = combineChannelSpend([
  run({ channel: 'meta', currency: 'GBP', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 3 }] }),
  run({ channel: 'google', currency: 'AED', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 2 }] }),
]);
eq(refusal(mixed), 'currency-clash', 'sterling and dirhams are not added');
eq(!mixed.ok ? mixed.currencies.join(',') : '', 'AED,GBP', 'and both are named, so the coach can fix the accounts');
ok(!mixed.ok && /not be an amount of any money/.test(combineRefusalNote(mixed)), 'said in those words');
ok(!mixed.ok && /rate/.test(combineRefusalNote(mixed)), 'and the reason nothing is converted is given');

// Case and spacing are not a second currency.
const sameMoney = combineChannelSpend([
  run({ channel: 'meta', currency: 'gbp', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 1 }] }),
  run({ channel: 'google', currency: ' GBP ', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 10000, ads: 1 }] }),
]);
eq(refusal(sameMoney), 'ok', 'the same currency written two ways is one currency');
eq(centsFor(sameMoney, 'K7M2QX'), 50000, 'and the two figures add');
eq(sameMoney.ok && sameMoney.currency, 'GBP', 'stated in upper case, once');

// An unread channel outranks a currency disagreement: the missing figure is the
// bigger fact, and fixing the currency would not produce a total anyway.
const both = combineChannelSpend([
  run({ channel: 'meta', currency: 'GBP', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 40000, ads: 1 }] }),
  run({ channel: 'google', currency: 'AED', codes: [{ codeId: 'a', code: 'K7M2QX', cents: 25000, ads: 1 }] }),
  run({ channel: 'tiktok', state: 'failed', currency: null }),
]);
eq(refusal(both), 'channel-unread', 'an unread channel is reported before a currency disagreement');

/* ── nothing connected, and nothing to say ─────────────────────────────── */

eq(refusal(combineChannelSpend([])), 'no-channels', 'no connected channel is not a total of zero');
eq(refusal(combineChannelSpend(null)), 'no-channels', 'and neither is a read that brought back nothing');
ok(/typed in yourself/.test(combineRefusalNote(combineChannelSpend([]))),
  'and the coach is reminded their own figures are untouched');

const silent = combineChannelSpend([
  run({ channel: 'meta', currency: null, codes: [] }),
  run({ channel: 'google', currency: null, codes: [] }),
]);
eq(refusal(silent), 'no-currency', 'every channel read, none with any ads, is not a figure of nought');
ok(/no ad spend is unknown, not free/.test(combineRefusalNote(silent)),
  'and says the sentence the rest of this feature turns on');

ok(/smaller number/.test(NO_TOTAL_NOTE), 'the note above the split figures says why there is no total');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`adChannels: ok (${AD_CHANNELS.length} channels, and a total refused wherever one of them is unknown)`);
