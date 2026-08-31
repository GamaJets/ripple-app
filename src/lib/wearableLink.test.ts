// The connection state machine — the four sentences, and the loop the tester
// actually walked. Compile with tsc then run with node.
//
// The assertions that matter here are the ones about what must NOT be said. A
// test that only checked "a live token says Connected" would pass against the
// code that produced four TestFlight reports, because that code said Connected
// too — on one screen, while the other screen called the same device
// disconnected. So most of what follows pins the negatives:
//
//   · a working device is never described as disconnected because ONE metric
//     was refused (the whole bug);
//   · a remembered row never produces the word Connected once the token behind
//     it is known dead;
//   · a gap that reconnecting cannot fix never offers a reconnect, because
//     offering one is what put this tester round the loop four times.
//
// Not wired into `npm test` — package.json and tsconfig.test.json belong to
// another agent this session. Run it with:
//
//   npx tsc src/lib/wearableLink.test.ts --outDir .tmp-wearablelink \
//     --module node16 --moduleResolution node16 --target ES2020 --strict \
//     --ignoreConfig ; node .tmp-wearablelink/wearableLink.test.js
//
// Flat, with no `lib/` in that path: naming one file infers the root from the
// inputs, and everything this test reaches lives under src/lib. Under
// tsconfig.test.json, whose rootDir is `src`, it lands at .tmp/lib/ like the
// rest.
//
// `--ignoreConfig` because naming a file on the command line means tsconfig.json
// is not loaded and the current TypeScript errors rather than proceeding
// silently. It also takes @types/node with it, so the one `process.exit` at the
// bottom reports TS2591 while still emitting — hence `;` rather than `&&`. Under
// tsconfig.test.json, where this belongs, "types": ["node"] settles it.
import { describeLink, classifyRefusal, isLinked, type LinkFacts, type TokenProof } from './wearableLink';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const NAME = 'WHOOP';
const NOW = 1_756_000_000_000;
const facts = (over: Partial<LinkFacts> = {}): LinkFacts => ({
  providerName: NAME,
  remembered: 'connected',
  token: { kind: 'none' },
  ...over,
});

/** No sentence anywhere may leak a placeholder, and all of them name the device. */
const sane = (v: { label: string; detail: string }, where: string) => {
  ok(!/undefined|null|\[object|NaN/i.test(`${v.label} ${v.detail}`), `${where}: must not leak a placeholder to the client`);
  ok(v.detail.length > 0 && v.label.length > 0, `${where}: must say something`);
};

// ── state 1 · never connected ───────────────────────────────────────────────
//
// Nothing remembered and nothing proven. The one case where "connect this" is a
// true instruction rather than a guess.
{
  const v = describeLink(facts({ remembered: 'disconnected' }));
  ok(v.state === 'never', 'nothing remembered must be "never"');
  ok(!v.connected, 'nothing remembered must not count as connected');
  ok(v.action === 'connect', 'a device never connected must offer Connect');
  ok(v.detail.includes(NAME), 'the sentence must name the device');
  ok(!/reconnect/i.test(v.detail), 'somebody who never connected must not be told to RE-connect');
  sane(v, 'never');
}

// A stored row that the server says does not exist is the same fact, and must
// read the same way. It is not "expired" — there is nothing to renew.
{
  const v = describeLink(facts({ token: { kind: 'dead', at: NOW, why: 'no-token' } }));
  ok(v.state === 'never', 'a token the server has no row for must be "never"');
  ok(v.action === 'connect', 'no stored token must offer Connect, not Reconnect');
}

// ── state 2 · connected and working ─────────────────────────────────────────
{
  const v = describeLink(facts({ token: { kind: 'alive', at: NOW } }));
  ok(v.state === 'live', 'a remembered row with a proven token is "live"');
  ok(v.connected, 'a live link must count as connected');
  ok(v.action === null, 'a working device must not ask the client to do anything');
  ok(v.tone === 'ok', 'a working device must not be drawn as a warning');
  sane(v, 'live');
}

// ── state 3 · connected, token dead, needs re-authorising ───────────────────
//
// The three ways a token dies arrive as three different `reason` strings and
// must not collapse into one sentence: one of them is the vendor withdrawing
// access and one of them may well be our end.
{
  const deaths: TokenProof[] = [
    { kind: 'dead', at: NOW, why: 'expired-no-refresh' },
    { kind: 'dead', at: NOW, why: 'refresh-failed' },
    { kind: 'dead', at: NOW, why: 'revoked' },
  ];
  const seen = new Set<string>();
  for (const token of deaths) {
    const why = (token as { why: string }).why;
    const v = describeLink(facts({ token }));
    ok(v.state === 'expired', `${why}: a dead token must be "expired"`);
    ok(!v.connected, `${why}: a dead token must not count as connected`);
    ok(v.action === 'reconnect', `${why}: a dead token must offer Reconnect`);
    ok(v.tone === 'warn', `${why}: a dead token is a problem and must be drawn as one`);
    // The reassurance is not decoration. A client told their device is
    // disconnected assumes the history went with it.
    ok(/nothing you have recorded is lost/i.test(v.detail), `${why}: must say the client's history survives`);
    seen.add(v.detail);
    sane(v, `expired/${why}`);
  }
  ok(seen.size === deaths.length, 'the three ways a token dies must not share one sentence');
}

// A dead token OUTRANKS the remembered row. This is the ordering rule: the app
// remembering a connection is not evidence the connection works, and rendering
// the row as "Connected" is how one screen came to contradict the other.
{
  const v = describeLink(facts({ remembered: 'connected', token: { kind: 'dead', at: NOW, why: 'refresh-failed' } }));
  ok(v.label !== 'Connected', 'a remembered row must not print "Connected" over a dead token');
  ok(!isLinked(facts({ remembered: 'connected', token: { kind: 'dead', at: NOW, why: 'refresh-failed' } })),
    'isLinked must agree with describeLink about a dead token');
}

// ── state 4 · connected, but this build cannot read THAT metric ─────────────
//
// The reported bug, stated as an assertion. WHOOP is signed in, WHOOP is
// serving every other figure in the app, and the sleep endpoint has answered
// 403 because Repple never asked for the scope. That is a fact about one
// metric. It must not be reported as a fact about the account.
{
  const v = describeLink(facts({
    token: { kind: 'alive', at: NOW },
    metric: { name: 'sleep', proof: { kind: 'refused', at: NOW } },
  }));
  ok(v.state === 'metric-blocked', 'a refused metric on a live token must be "metric-blocked"');
  ok(v.connected, 'a refused metric must NOT disconnect the account — this is the bug');
  ok(v.label === 'Connected', 'a working device must still say Connected');
  ok(/connected and working/i.test(v.detail), 'the sentence must lead with the device working');
  ok(/sleep/.test(v.detail), 'the sentence must name the metric that is missing');
  ok(v.action === 'reconnect', 'a scope that can be granted must offer the re-auth that grants it');
  ok(!/not connected|no longer connected|disconnected/i.test(v.detail),
    'a metric gap must never be worded as the account being disconnected');
  sane(v, 'metric-blocked/refused');
}

// The other half of the fourth state: Repple has no reader for this metric at
// all. Reconnecting cannot possibly help, so it is not offered — offering it is
// exactly what sent the tester round "reconnected whoop and it says need to
// connect whoop" four times.
{
  const v = describeLink(facts({
    token: { kind: 'alive', at: NOW },
    metric: { name: 'sleep', proof: { kind: 'absent', why: 'Garmin does not publish a sleep endpoint Repple can read.' } },
  }));
  ok(v.state === 'metric-blocked', 'an absent reader on a live token must be "metric-blocked"');
  ok(v.connected, 'an absent reader must not disconnect the account');
  ok(v.action === null, 'a gap reconnecting cannot fix must not offer a reconnect');
  ok(v.tone !== 'warn', 'a gap in Repple is not the client\'s problem and must not be drawn as an alarm');
  sane(v, 'metric-blocked/absent');
}

// A metric that read fine leaves the answer exactly where it was.
{
  const v = describeLink(facts({ token: { kind: 'alive', at: NOW }, metric: { name: 'sleep', proof: { kind: 'ok', at: NOW } } }));
  ok(v.state === 'live', 'a metric that read fine must leave the link "live"');
}

// ── the transient ───────────────────────────────────────────────────────────
{
  const v = describeLink(facts({ remembered: 'connecting' }));
  ok(v.state === 'connecting', 'a handshake in flight must be "connecting"');
  ok(v.action === null, 'a handshake in flight must not ask for a second tap');
  ok(!/not connected/i.test(v.detail), 'a handshake in flight must not be reported as a failure');
}

// ── classifying what the server actually said ───────────────────────────────
//
// The edge function sends one `connected: false` for two unrelated events. This
// is the split that keeps them apart, and the `accountProvenAlive` argument is
// the only evidence there is to split them on.
{
  ok(classifyRefusal(null, false).why === 'no-token', 'no reason at all means there is no stored row');
  ok(classifyRefusal('', true).level === 'account', 'no reason at all is an account fact even on a live account');
  ok(classifyRefusal('expired_no_refresh_token', true).level === 'account', 'an expired grant is an account fact');
  ok(classifyRefusal('expired_no_refresh_token', true).why === 'expired-no-refresh', 'the expired-grant reason must survive');
  ok(classifyRefusal('refresh_failed', true).why === 'refresh-failed', 'a failed renewal must survive');

  // The load-bearing pair. Same string from the server; different answers,
  // because on the left we have watched the same token work.
  ok(classifyRefusal('whoop_unauthorized', true).level === 'metric',
    'one endpoint refusing a token that is otherwise working is a METRIC fact');
  ok(classifyRefusal('whoop_unauthorized', false).level === 'account',
    'one endpoint refusing a token nothing has proven is all we know: treat it as the account');

  // An unrecognised reason must not be optimistically read as "fine".
  ok(classifyRefusal('something_new_from_the_server', true).level === 'account',
    'an unrecognised refusal must not be assumed harmless');
}

// ── the walk the tester actually took ───────────────────────────────────────
//
// Devices said connected, Recovery said reconnect, the reconnect changed
// nothing, and round again. Replayed here as four steps, asserting at each one
// that the two screens are now saying the same thing about the account.
{
  // The screens differ only in whether they are asking about a metric. Devices
  // asks the account question; Recovery asks the sleep question. Same function.
  const devices = (t: TokenProof, m?: LinkFacts['metric']) => describeLink(facts({ token: t, metric: m }));
  const recovery = (t: TokenProof, m?: LinkFacts['metric']) => describeLink(facts({ token: t, metric: m }));

  // Step 1 — WHOOP signed in, the daily roll-up working, sleep never asked for.
  const alive: TokenProof = { kind: 'alive', at: NOW };
  const refusedSleep: LinkFacts['metric'] = { name: 'sleep', proof: { kind: 'refused', at: NOW } };
  const d1 = devices(alive);
  const r1 = recovery(alive, refusedSleep);
  ok(d1.connected === r1.connected, 'step 1: the two screens must agree the account is connected');
  ok(d1.connected, 'step 1: WHOOP is signed in and serving other figures — that is connected');
  ok(!/not connected/i.test(r1.detail), 'step 1: Recovery must no longer call a working WHOOP disconnected');

  // Step 2 — the client taps Reconnect, this time with the sleep scope asked
  // for, and the endpoint answers. The metric gap closes and NOTHING about the
  // account had to change, because the account was never the problem.
  const r2 = recovery(alive, { name: 'sleep', proof: { kind: 'ok', at: NOW + 1000 } });
  ok(r2.state === 'live', 'step 2: a granted scope must resolve to plain "live"');
  ok(r2.action === null, 'step 2: a resolved reconnect must stop asking to reconnect');
  ok(devices(alive).state === r2.state, 'step 2: both screens must land on the same state after the re-auth');

  // Step 3 — the separate, genuine death: the token really does expire later.
  // Now BOTH screens say reconnect, and neither says Connected.
  const dead: TokenProof = { kind: 'dead', at: NOW + 2000, why: 'refresh-failed' };
  const d3 = devices(dead);
  const r3 = recovery(dead, refusedSleep);
  ok(d3.state === 'expired' && r3.state === 'expired', 'step 3: a really dead token must read the same on both screens');
  ok(d3.detail === r3.detail, 'step 3: the same fact must produce the same sentence on both screens');
  ok(!d3.connected && !r3.connected, 'step 3: neither screen may call a dead token connected');

  // Step 4 — the re-auth succeeds and the verdicts are cleared. This is the
  // "reconnecting must visibly resolve" requirement, as an assertion: with the
  // dead verdict gone, both screens must say Connected without a relaunch.
  // Recovery is asked with the sleep scope, because that is the only thing that
  // makes it a different screen from Devices. Passing it no metric — as this
  // step used to — made `recovery(cleared)` the same call as `devices(cleared)`
  // against the same pure function, so "both screens must agree on the state"
  // was comparing a value to itself and could not fail however far the two
  // screens drifted. The re-auth that just succeeded is the one that granted
  // the scope, so the sleep proof here is 'ok'.
  const cleared: TokenProof = { kind: 'none' };
  const grantedSleep: LinkFacts['metric'] = { name: 'sleep', proof: { kind: 'ok', at: NOW + 3000 } };
  const d4 = devices(cleared);
  const r4 = recovery(cleared, grantedSleep);
  ok(d4.connected && r4.connected, 'step 4: after a successful re-auth both screens must say connected');
  ok(d4.state === r4.state, 'step 4: both screens must agree on the state, not just the flag');
  ok(d4.state === 'live', 'step 4: and the state they agree on is plain "live" — nothing is still blocked');
  // The failure this replay was written against, one step on: Recovery going on
  // saying "reconnect" after the reconnect worked. It can only be caught while
  // Recovery is being asked its own question.
  ok(r4.action === null, 'step 4: Recovery stops asking for a reconnect once the scope it wanted has been granted');
  ok(!/reconnect/i.test(d4.detail + r4.detail), 'step 4: nothing may still be asking for a reconnect that just happened');
}

if (errors.length) {
  console.error(`wearableLink.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('wearableLink.test: ok');
