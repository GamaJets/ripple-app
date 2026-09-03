"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The unit preference, and the difference between an answer and a guess.
//
// ── What these assertions are guarding ────────────────────────────────────
//
// The defect was not that kilograms were chosen as a default. It was that the
// default was INDISTINGUISHABLE from a choice by the time it reached a screen:
// `useSettings()` resolved a NULL column to 'kg' and handed every screen a bare
// WeightUnit, so nothing downstream could tell a member who picked kilograms
// from a member nobody had ever asked.
//
// So the assertion that matters most in this file is not about kilograms or
// pounds at all — it is that `weightChosen` stays null and `weightSource` says
// 'device' whenever nobody has chosen, whatever unit is being rendered. That is
// what Settings tints its pills from, what decides whether onboarding asks, and
// what src/ui/settings.tsx is forbidden to write back to the account.
const unitPreference_1 = require("./unitPreference");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(a === b, `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// ── reading a region out of a locale tag ──────────────────────────────────
{
    eq((0, unitPreference_1.regionFromLocale)('en-US'), 'US', 'the ordinary case');
    eq((0, unitPreference_1.regionFromLocale)('en_US'), 'US', 'an underscore tag, which is what Android hands back');
    eq((0, unitPreference_1.regionFromLocale)('en-us'), 'US', 'case is normalised, so a lowercase tag is not silently metric');
    // The script subtag is the trap: 'Arab' is four letters and is NOT a country,
    // and a parser that took the second part regardless would read 'AR' out of
    // it and answer for Argentina.
    eq((0, unitPreference_1.regionFromLocale)('ar-Arab-AE'), 'AE', 'a script subtag is skipped, not read as a country');
    eq((0, unitPreference_1.regionFromLocale)('zh-Hans-CN'), 'CN', 'and again with a Chinese tag');
    eq((0, unitPreference_1.regionFromLocale)('es-419'), '419', 'a UN M.49 area is a region too');
    // No region at all. This must be null rather than a wrong country: null gets
    // metric AND gets reported as a guess, whereas a fabricated region would get
    // metric and look derived.
    eq((0, unitPreference_1.regionFromLocale)('en'), null, 'a bare language has no region');
    eq((0, unitPreference_1.regionFromLocale)(''), null, 'nor does an empty string');
    eq((0, unitPreference_1.regionFromLocale)(null), null, 'nor does nothing at all');
    eq((0, unitPreference_1.regionFromLocale)(undefined), null, 'nor undefined');
}
// ── which unit a region reads in ──────────────────────────────────────────
{
    eq((0, unitPreference_1.unitsForRegion)('US').weight, 'lb', 'the United States weighs people in pounds');
    eq((0, unitPreference_1.unitsForRegion)('US').length, 'in', 'and gives a height in feet and inches');
    eq((0, unitPreference_1.unitsForRegion)('LR').weight, 'lb', 'Liberia never adopted the metric system');
    eq((0, unitPreference_1.unitsForRegion)('MM').weight, 'lb', 'nor did Myanmar');
    eq((0, unitPreference_1.unitsForRegion)('AE').weight, 'kg', 'the UAE, this product’s home market, is metric');
    eq((0, unitPreference_1.unitsForRegion)('AE').length, 'cm', 'in both dimensions');
    // The split that is the whole reason there are two lists. If somebody
    // collapses them into one "imperial?" flag, this is the assertion that fails.
    eq((0, unitPreference_1.unitsForRegion)('GB').weight, 'kg', 'Britain is not given pounds — its body weight is stones, which this app does not offer');
    eq((0, unitPreference_1.unitsForRegion)('GB').length, 'in', 'but a British height is feet and inches');
    // An unknown or absent region still has to answer with something, and metric
    // is the side to be wrong on — the country a wrong answer would hurt is the
    // one whose region CAN be read.
    eq((0, unitPreference_1.unitsForRegion)(null).weight, 'kg', 'no region falls to metric');
    eq((0, unitPreference_1.unitsForRegion)('ZZ').weight, 'kg', 'and so does a region nobody has a rule for');
    eq((0, unitPreference_1.unitsForRegion)('us').weight, 'lb', 'a lowercase region is still the United States');
}
// ── an answer and a guess are never the same value ────────────────────────
{
    // A member who has never been asked, on an American handset.
    const never = (0, unitPreference_1.resolveUnits)(null, null, 'US');
    eq(never.weightUnit, 'lb', 'an unasked American member reads pounds, not kilograms');
    eq(never.weightChosen, null, 'and nothing is recorded as chosen');
    eq(never.weightSource, 'device', 'the source says where it came from');
    eq(never.lengthSource, 'device', 'for length as well');
    // The bug in one assertion: an unasked member on a metric handset renders
    // kilograms, exactly as before — and is now distinguishable from one who
    // picked them. If somebody reinstates a 'kg' default upstream, `weightChosen`
    // goes non-null here and this fails.
    const unaskedMetric = (0, unitPreference_1.resolveUnits)(null, null, 'AE');
    eq(unaskedMetric.weightUnit, 'kg', 'an unasked member in Dubai still reads kilograms');
    eq(unaskedMetric.weightChosen, null, 'but has still chosen nothing');
    eq(unaskedMetric.weightSource, 'device', 'and the app knows it guessed');
    // The member who actually tapped it.
    const chose = (0, unitPreference_1.resolveUnits)('kg', 'cm', 'US');
    eq(chose.weightUnit, 'kg', 'a chosen unit beats the handset’s region');
    eq(chose.weightChosen, 'kg', 'and is reported as chosen');
    eq(chose.weightSource, 'chosen', 'with the source to match');
    eq(chose.lengthUnit, 'cm', 'length likewise');
}
// ── the two are resolved independently ────────────────────────────────────
{
    // Setting one is not consent to the other. Somebody who picks pounds in
    // Settings and never touches the height row has chosen a weight unit and
    // nothing else, and their height must still be marked a guess so the row
    // still asks.
    const half = (0, unitPreference_1.resolveUnits)('lb', null, 'AE');
    eq(half.weightSource, 'chosen', 'the weight was chosen');
    eq(half.weightUnit, 'lb', 'and is honoured over the region');
    eq(half.lengthSource, 'device', 'the height was not');
    eq(half.lengthChosen, null, 'and is still recorded as unchosen');
    eq(half.lengthUnit, 'cm', 'falling to the region rather than to the weight unit');
}
// ── the sentence the member is shown ──────────────────────────────────────
{
    eq((0, unitPreference_1.deviceUnitNote)('kg', 'chosen'), null, 'a chosen unit is never apologised for');
    eq((0, unitPreference_1.deviceUnitNote)('in', 'chosen'), null, 'in either dimension');
    const note = (0, unitPreference_1.deviceUnitNote)('kg', 'device');
    ok(note != null, 'a guessed unit says so');
    ok(!!note && note.includes('kilograms'), `and names the unit in words — got "${note}"`);
    ok(!!note && /phone/.test(note), `and where it came from — got "${note}"`);
    ok(!!(0, unitPreference_1.deviceUnitNote)('lb', 'device')?.includes('pounds'), 'pounds are named too');
    ok(!!(0, unitPreference_1.deviceUnitNote)('cm', 'device')?.includes('centimetres'), 'centimetres are named too');
    ok(!!(0, unitPreference_1.deviceUnitNote)('in', 'device')?.includes('feet and inches'), 'and inches are named the way a person says them');
}
if (errors.length) {
    console.error(`unitPreference.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('unitPreference.test.ts — ok');
