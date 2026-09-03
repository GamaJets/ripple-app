// Whose record a stay-mounted screen shows. Compile with tsc, run with node.
//
// The bug this guards: seven coach screens seeded `picked` from a route param
// in a `useState` initialiser, which runs once. Registered `href: null` inside
// <Tabs>, they never unmount, so the second client a coach opened one for was
// drawn as the first. These assertions pin the one rule that fixes it — the
// param wins when it MOVES and never while it stands still — and the two
// directions it has to hold in.
import { subjectOf, subjectChange, type RouteParam } from './routeSubject';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── what a param names ────────────────────────────────────────────────── */

eq(subjectOf('amy'), 'amy', 'an id names that person');
eq(subjectOf(undefined), null, 'no param names nobody');
eq(subjectOf(null), null, 'a null param names nobody');
eq(subjectOf(''), null, 'an empty param names nobody');
eq(subjectOf('   '), null, 'a whitespace param names nobody');
eq(subjectOf('  amy  '), 'amy', 'a padded id is the same id');

// expo-router hands back string[] for a repeated key, and the generic on
// useLocalSearchParams is an assertion rather than a check — so a deep link of
// ?clientId=amy&clientId=ben would otherwise put an array into
// .eq('client_id', picked). Two people is not one person.
eq(subjectOf(['amy', 'ben'] as RouteParam), null, 'a repeated key names nobody');
eq(subjectOf(['amy'] as RouteParam), null, 'even a one-element array is not a string');
eq(subjectOf([] as unknown as RouteParam), null, 'an empty array names nobody');

/* ── the param wins when it moves ──────────────────────────────────────── */

// The actual defect: Amy on screen, Ben in the route.
eq(subjectChange('amy', 'ben')?.subject, 'ben', 'a new client in the route takes the screen');

// Opening the screen from a menu with no client in it. This must be a CHANGE
// to nobody — the picker — and not "leave the last person up", or a coach who
// taps Checklists from the tools row lands on whoever they last looked at.
eq(subjectChange('amy', undefined)?.subject, null, 'dropping the param returns to the picker');
eq(subjectChange(undefined, 'amy')?.subject, 'amy', 'arriving with a param opens that person');

/* ── and never while it stands still ───────────────────────────────────── */

// Between two renders with the same param the coach may have chosen somebody
// else on the screen itself. That pick is newer than the route, and clobbering
// it would make the on-screen picker unusable.
eq(subjectChange('amy', 'amy'), null, 'an unchanged param changes nothing');
eq(subjectChange(undefined, undefined), null, 'no param, still no param, no change');
eq(subjectChange(undefined, null), null, 'absent and null are the same absence');
eq(subjectChange('amy', '  amy  '), null, 'whitespace is not a move');
eq(subjectChange('', undefined), null, 'empty and absent are the same absence');

// First render: the caller seeds `seen` from the same param, so the useState
// initialiser — which is correct exactly once — is not fought over.
eq(subjectChange('amy', 'amy'), null, 'the first render does not re-set what it just seeded');

/* ── a change is a change even when it lands on the same nobody ────────── */

// Both of these resolve to null, so there is nothing to move to. The screen is
// already on the picker.
eq(subjectChange(['amy', 'ben'] as RouteParam, ''), null, 'nobody to nobody is not a move');

// But an unusable param arriving over a real one IS a move — to the picker,
// which is honest, rather than to a stale person the route did not ask for.
eq(subjectChange('amy', ['amy', 'ben'] as RouteParam)?.subject, null,
  'an unusable param does not leave the previous client on screen');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('routeSubject.test.ts — all assertions passed');
