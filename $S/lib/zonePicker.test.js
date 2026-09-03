"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The four this file exists to stop.
//
//   1. A GYM OFFERED A FIXED OFFSET. `Etc/GMT-4` and `UTC` are valid IANA ids
//      and `parseGymZone` accepts both. Neither moves when the clocks do, which
//      is the exact fault `parseGymZone`'s own message gives for refusing
//      "+04:00" — so a gym that picked one files six months of the year an hour
//      out and no screen says why.
//
//   2. TWO SPELLINGS OF ONE PLACE. `Japan` and `Asia/Tokyo` are the same zone
//      and different strings. Two gyms in Tokyo whose rows do not compare equal
//      is a bug that only shows up in an aggregate.
//
//   3. THE RIGHT ANSWER BURIED. A search for "lond" that returns
//      `America/North_Dakota/New_Salem` before `Europe/London` is a picker
//      nobody finishes on a phone. The bands are asserted, not just the
//      membership.
//
//   4. FOUR HUNDRED ROWS UNDER AN EMPTY FIELD. An empty query returns nothing
//      at all, so the screen shows its prompt instead of the whole world.
//
// Compile with tsc, run with node.
const zonePicker_1 = require("./zonePicker");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A list shaped like a runtime that hands back the aliases as well as the
 *  canonical names, which is the case this module is defensive about. */
const ALL = [
    'Europe/London', 'Europe/Lisbon', 'Europe/Amsterdam', 'Europe/Istanbul',
    'America/New_York', 'America/Los_Angeles', 'America/North_Dakota/New_Salem',
    'America/Argentina/Buenos_Aires',
    'Asia/Dubai', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Amman', 'Asia/Manila',
    'Australia/Sydney', 'Africa/Cairo', 'Pacific/Auckland',
    // The two families that must never reach a gym.
    'Etc/GMT+4', 'Etc/GMT-4', 'Etc/UTC',
    'UTC', 'GMT', 'Zulu', 'Japan', 'Israel', 'EST', 'Factory',
];
/* ── 1 & 2. what may not be offered ─────────────────────────────────────── */
{
    const list = (0, zonePicker_1.pickableZones)(ALL);
    ok(!list.some((z) => z.startsWith('Etc/')), 'no fixed-offset zone is offered — defect 1');
    ok(!list.includes('UTC') && !list.includes('GMT') && !list.includes('Zulu'), 'and neither is a bare offset spelled as a word');
    ok(!list.includes('Japan') && !list.includes('Israel') && !list.includes('EST'), 'nor a deprecated single-word alias — defect 2');
    ok(!list.includes('Factory'), 'nor the placeholder zone that is not a place');
    ok(list.includes('Asia/Tokyo') && list.includes('Europe/London'), 'the canonical names survive');
    eq(list.length, 16, 'sixteen of the twenty-five entries are places a gym can be in');
    // Stable and de-duplicated: two calls over a shuffled list agree.
    const again = (0, zonePicker_1.pickableZones)([...ALL].reverse());
    eq(again.join('|'), list.join('|'), 'the same set comes back in the same order');
    eq((0, zonePicker_1.pickableZones)(['Europe/London', 'Europe/London', ' Europe/London ']).length, 1, 'a duplicate — or one with whitespace round it — is one zone');
    eq((0, zonePicker_1.pickableZones)([]).length, 0, 'a runtime with no list produces no rows rather than throwing');
    eq((0, zonePicker_1.pickableZones)(['', '   ']).length, 0, 'and blanks are not zones');
}
/* ── how a zone reads ───────────────────────────────────────────────────── */
{
    const la = (0, zonePicker_1.zoneChoice)('America/Los_Angeles');
    eq(la.city, 'Los Angeles', 'the underscore is opened out for a person to read');
    eq(la.where, 'America', 'and the region is kept beside it');
    eq(la.zone, 'America/Los_Angeles', 'while the id stored is untouched');
    const ba = (0, zonePicker_1.zoneChoice)('America/Argentina/Buenos_Aires');
    eq(ba.city, 'Buenos Aires', 'a three-segment id still ends in a city');
    eq(ba.where, 'America · Argentina', 'and the whole trail is shown');
    // Called on a STORED value too, which may be an id this picker would not
    // have offered — a gym that set its zone before this screen existed.
    const bare = (0, zonePicker_1.zoneChoice)('UTC');
    eq(bare.city, 'UTC', 'a single-segment id reads as itself');
    eq(bare.where, '', 'with nothing before it, rather than throwing');
}
/* ── 3. ranking ─────────────────────────────────────────────────────────── */
{
    const lond = (0, zonePicker_1.searchZones)(ALL, 'lond');
    eq(lond[0]?.zone, 'Europe/London', 'the city that starts with what was typed comes first');
    const york = (0, zonePicker_1.searchZones)(ALL, 'york');
    eq(york[0]?.zone, 'America/New_York', 'a city that merely contains it is still found');
    const salem = (0, zonePicker_1.searchZones)(ALL, 'new');
    // Both cities start with "new", so alphabetical by id decides — and neither
    // is behind a match that is only in the region.
    eq(salem.map((c) => c.zone).slice(0, 2).join(','), 'America/New_York,America/North_Dakota/New_Salem', 'two equally good matches are ordered stably');
    const europe = (0, zonePicker_1.searchZones)(ALL, 'europe');
    eq(europe[0]?.zone, 'Europe/Amsterdam', 'a region match returns the region, alphabetically');
    eq(europe.length, 4, 'all four of them');
    // The band really is a band, and this is the pair that proves it: both are
    // real zones, both cities hold "man", and only Manila STARTS with it — while
    // Amman sorts first alphabetically. So a ranking that lost the band, or that
    // stopped telling "starts with" from "contains", would put Amman on top.
    const man = (0, zonePicker_1.searchZones)(ALL, 'man');
    eq(man[0]?.zone, 'Asia/Manila', 'a city beginning with the query beats one merely containing it — defect 3');
    ok(man.some((c) => c.zone === 'Asia/Amman'), 'and the other is still offered, below it');
    // A region-only match must not outrank a city either.
    const asia = (0, zonePicker_1.searchZones)(ALL, 'asia');
    eq(asia[0]?.city, 'Amman', 'the region band comes last, so Asia/… sorts by city');
    // The underscore is folded on the WHOLE id, not only on the city — so a
    // query that spans two segments finds the zone.
    eq((0, zonePicker_1.searchZones)(ALL, 'north dakota')[0]?.zone, 'America/North_Dakota/New_Salem', 'a query spanning an underscored segment still matches');
    // Typed with a space where the id has an underscore, and with the slash.
    eq((0, zonePicker_1.searchZones)(ALL, 'los angeles')[0]?.zone, 'America/Los_Angeles', 'a space finds an underscore');
    eq((0, zonePicker_1.searchZones)(ALL, 'LOS ANGELES')[0]?.zone, 'America/Los_Angeles', 'and case does not matter');
    eq((0, zonePicker_1.searchZones)(ALL, 'europe/lis')[0]?.zone, 'Europe/Lisbon', 'a typed slash works too');
    eq((0, zonePicker_1.searchZones)(ALL, '  dubai  ')[0]?.zone, 'Asia/Dubai', 'and so does a fat-thumbed space');
}
/* ── 4. an empty field shows nothing ────────────────────────────────────── */
{
    eq((0, zonePicker_1.searchZones)(ALL, '').length, 0, 'nothing typed, nothing listed — defect 4');
    eq((0, zonePicker_1.searchZones)(ALL, '   ').length, 0, 'and whitespace is nothing typed');
    eq((0, zonePicker_1.searchZones)(ALL, 'zzzz').length, 0, 'a query that matches nothing returns nothing');
    // Never more than fits, and the cap is the module's own so two screens
    // cannot disagree about how long the list is.
    ok(zonePicker_1.ZONE_RESULT_LIMIT > 0, 'there is a cap');
    eq((0, zonePicker_1.searchZones)(ALL, 'a').length <= zonePicker_1.ZONE_RESULT_LIMIT, true, 'and a broad query respects it');
    eq((0, zonePicker_1.searchZones)(ALL, 'europe', 2).length, 2, 'a caller may ask for fewer');
    eq((0, zonePicker_1.searchZones)(ALL, 'europe', 0).length, 0, 'and for none, without an off-by-one');
    ok(zonePicker_1.NO_ZONE_LIST_NOTE.includes('Europe/London'), 'the no-list fallback shows the shape of what to type, since there is nothing to pick from');
}
if (errors.length) {
    console.error(`zonePicker: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error(`  · ${e}`);
    process.exit(1);
}
console.log('zonePicker: ok');
