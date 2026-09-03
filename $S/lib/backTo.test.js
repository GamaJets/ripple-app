"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Where Back goes from a detail screen. Compile with tsc, run with node.
//
// The bug this guards: every screen in these apps is a tab, so router.back()
// consults the tab navigator's history — a list of UNIQUE routes that reorders
// itself as you revisit screens. Back from an exercise landed on Train instead
// of the library it was opened from. The origin is now carried in a route
// param, and these assertions pin the two things that param must do: resolve
// the origins we send, and refuse everything else so the caller falls back to
// the navigator rather than following a deep link somewhere nobody chose.
const backTo_1 = require("./backTo");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the origins we actually send ──────────────────────────────────────── */
eq((0, backTo_1.backDestination)('clientLibrary'), '/(client)/library', 'the client library resolves to its route');
eq((0, backTo_1.backDestination)('clientWorkouts'), '/(client)/workouts', 'the workout program resolves to its route');
eq((0, backTo_1.backDestination)('ownerLibrary'), '/(owner)/library', 'the owner library resolves to its route');
eq((0, backTo_1.backDestination)('trainerBuilder'), '/(trainer)/builder', 'the trainer builder resolves to its route');
eq((0, backTo_1.backDestination)('trainerLibrary'), '/(trainer)/library', 'the coach library resolves to its route');
// Three apps ship a screen called "library" and all three open the same kind of
// detail row. They are separate files in separate groups, so the keys must not
// collapse onto one path — a coach sent to '/(client)/library' by a shared key
// would land in a portal their build does not even contain.
ok(new Set(Object.values(backTo_1.BACK_TO)).size === Object.keys(backTo_1.BACK_TO).length, 'no two origins name the same route');
ok((0, backTo_1.backDestination)('trainerLibrary') !== (0, backTo_1.backDestination)('clientLibrary')
    && (0, backTo_1.backDestination)('trainerLibrary') !== (0, backTo_1.backDestination)('ownerLibrary'), 'the three libraries are three different routes');
// Every key in the table resolves, and to a route in the group it names. A key
// added later with a typo'd or cross-app path fails here rather than sending a
// coach into the client portal.
for (const [key, route] of Object.entries(backTo_1.BACK_TO)) {
    eq((0, backTo_1.backDestination)(key), route, `${key} resolves`);
    const group = key.startsWith('client') ? '(client)' : key.startsWith('owner') ? '(owner)' : '(trainer)';
    ok(route.startsWith(`/${group}/`), `${key} points into ${group}, not ${route}`);
}
/* ── everything else falls back ────────────────────────────────────────── */
// No origin: a deep link or a notification opened the screen directly, and the
// navigator's own back is the only answer there is.
eq((0, backTo_1.backDestination)(undefined), null, 'a missing origin resolves to nothing');
eq((0, backTo_1.backDestination)(null), null, 'a null origin resolves to nothing');
eq((0, backTo_1.backDestination)(''), null, 'an empty origin resolves to nothing');
// A param is attacker-supplied. A path is not a key, and must not be followed
// just because it looks like one.
eq((0, backTo_1.backDestination)('/(client)/library'), null, 'a raw path is not a key');
eq((0, backTo_1.backDestination)('https://example.com'), null, 'a URL is not a key');
eq((0, backTo_1.backDestination)('clientlibrary'), null, 'keys are matched exactly, not case-insensitively');
// The reason the lookup is hasOwnProperty and not `key in BACK_TO`: `in` walks
// the prototype chain, so these would resolve to Object.prototype members and
// be handed to router.navigate.
eq((0, backTo_1.backDestination)('toString'), null, 'toString is not an origin');
eq((0, backTo_1.backDestination)('constructor'), null, 'constructor is not an origin');
eq((0, backTo_1.backDestination)('__proto__'), null, '__proto__ is not an origin');
/* ── reading the tab navigator's history ───────────────────────────────── */
// The shape React Navigation's TabRouter keeps under backBehavior: 'history'.
// Its LAST entry is the screen you are looking at, not the one behind you —
// reading it as the destination is off by one and sends Back nowhere.
const state = (...names) => ({
    routes: names.map((n) => ({ key: `${n}-key`, name: n })),
    history: names.map((n) => ({ type: 'route', key: `${n}-key` })),
});
eq((0, backTo_1.previousRouteName)(state('dashboard', 'workouts', 'library', 'exercise')), 'library', 'back from the exercise lands on the library that is behind it');
eq((0, backTo_1.previousRouteName)(state('dashboard', 'workouts', 'exercise')), 'workouts', 'the entry before the current one is the destination, not the current one');
// Nothing behind it, and nothing readable: both mean defer to the navigator.
eq((0, backTo_1.previousRouteName)(state('dashboard')), null, 'the first screen has nothing behind it');
eq((0, backTo_1.previousRouteName)(undefined), null, 'an unreadable state resolves to nothing');
eq((0, backTo_1.previousRouteName)({ routes: [], history: [] }), null, 'an empty state resolves to nothing');
// A drawer or filter can put a non-route entry in the history; counting one as
// a screen shifts every answer by one.
eq((0, backTo_1.previousRouteName)({
    routes: [{ key: 'a', name: 'workouts' }, { key: 'b', name: 'exercise' }],
    history: [{ type: 'route', key: 'a' }, { type: 'drawer' }, { type: 'route', key: 'b' }],
}), 'workouts', 'non-route history entries are not screens');
// A key with no matching route is a screen we cannot name.
eq((0, backTo_1.previousRouteName)({ routes: [{ key: 'b', name: 'exercise' }], history: [{ type: 'route', key: 'gone' }, { type: 'route', key: 'b' }] }), null, 'a history key with no route resolves to nothing');
/* ── a hub never goes back into its own detail ─────────────────────────── */
// The loop this exists to prevent: the exercise reached the library by
// navigating to it, so the exercise sits BEHIND the library. Plain back would
// return to the movement just read, and its Back would return to the library.
eq((0, backTo_1.previousNonDetailRouteName)(state('dashboard', 'workouts', 'exercise', 'library')), 'workouts', 'the library skips the exercise behind it and goes to Train');
// When the entry behind is already not a detail, both agree and the caller
// leaves the navigator alone.
const plain = state('dashboard', 'workouts', 'library');
eq((0, backTo_1.previousNonDetailRouteName)(plain), (0, backTo_1.previousRouteName)(plain), 'with no detail behind it, skipping changes nothing');
// Details all the way down: nothing to skip to.
// The oldest entry counts. Tabs reorder as you revisit them, so the only
// screen behind a hub that is not one of its details can end up first in the
// history — stopping the scan one short of it sends Back nowhere.
eq((0, backTo_1.previousNonDetailRouteName)(state('workouts', 'exercise', 'library')), 'workouts', 'the first entry in the history is still somewhere to go back to');
eq((0, backTo_1.previousNonDetailRouteName)(state('exercise', 'library')), null, 'a history of nothing but details resolves to nothing');
eq((0, backTo_1.previousNonDetailRouteName)(undefined), null, 'an unreadable state resolves to nothing');
/* ── a route name is the path's last segment ───────────────────────────── */
eq((0, backTo_1.routeNameOf)('/(client)/library'), 'library', 'the client library is the "library" route');
eq((0, backTo_1.routeNameOf)('/(trainer)/builder'), 'builder', 'the trainer builder is the "builder" route');
// The coach's library is the "library" route of the trainer navigator, which is
// a different navigator from the client's. useBackTo compares the destination's
// bare route name against the tab history of the group it is already in, so the
// shared name is only safe because the destination carries its group with it.
eq((0, backTo_1.routeNameOf)('/(trainer)/library'), 'library', 'the coach library is the "library" route');
// Every destination we send must name a route, or the comparison in useBackTo
// never matches and Back always navigates instead of going back.
for (const route of Object.values(backTo_1.BACK_TO)) {
    ok((0, backTo_1.routeNameOf)(route).length > 0 && !(0, backTo_1.routeNameOf)(route).includes('/'), `${route} yields a bare route name`);
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`backTo: ok (${Object.keys(backTo_1.BACK_TO).length} origins)`);
