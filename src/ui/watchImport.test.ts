// What `readRecent` says when one device answers and another does not.
//
// The defect these assert against: the per-provider catch in `fetchRecent`
// returned `[]`, so a WHOOP that refused was indistinguishable from a WHOOP
// that had recorded nothing, and both screens printed "No workouts found in
// the last 14 days from your devices" over it.
//
// ── Why the stubs at the top ───────────────────────────────────────────────
//
// `src/ui/watchImport.ts` is not a pure module — it pulls the provider
// registry (Expo, HealthKit, Supabase), AsyncStorage and `reportError`, none of
// which exist under plain `node`. The three facts under test are pure, so the
// heavy edges are replaced here and everything else — `linkFor`, the real
// ledger, the real sort and the real sentences — runs as shipped. The registry
// stub is not a concession either: fake providers are exactly what lets one
// device fail on demand.
//
// `require` and the assertions are declared locally rather than pulled from
// 'assert' and @types/node: this file is compiled by the APP tsconfig as well
// as the test one, and that config carries no node types.
/* eslint-disable @typescript-eslint/no-var-requires */
import type { WearableProvider, WorkoutSample } from '../lib/wearables/types';

declare const require: (m: string) => any;

/** Enough of `assert` for this file, and no dependency on Node's types. */
const assert = {
  ok(v: unknown, m?: string) { if (!v) throw new Error(m || 'expected truthy'); },
  strictEqual(a: unknown, b: unknown, m?: string) {
    if (!Object.is(a, b)) throw new Error(`${m ? m + ': ' : ''}${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  },
  deepStrictEqual(a: unknown, b: unknown, m?: string) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m ? m + ': ' : ''}${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  },
  async rejects(fn: () => Promise<unknown>, re: RegExp) {
    try { await fn(); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!re.test(msg)) throw new Error(`rejected with the wrong message: ${msg}`);
      return;
    }
    throw new Error('expected a rejection, got none');
  },
};

const Module = require('module');
const realLoad = Module._load;

/** Swapped per test — the catalogue `watchImport` reads. */
const catalogue: { list: WearableProvider[] } = { list: [] };
/** Every `reportError` this run made, so a swallowed failure is still recorded. */
const reported: Array<{ where: string; meta: unknown }> = [];

Module._load = function patched(req: string, ...rest: unknown[]) {
  if (req.endsWith('wearables/registry')) return { get PROVIDERS() { return catalogue.list; } };
  if (req.endsWith('/reportError') || req.endsWith('./reportError')) {
    return { reportError: (where: string, _e: unknown, meta: unknown) => { reported.push({ where, meta }); } };
  }
  if (req === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: { getItem: async () => null, setItem: async () => undefined } };
  }
  return realLoad.call(this, req, ...rest);
};

const wi = require('./watchImport') as typeof import('./watchImport');
const ledger = require('../lib/wearableLinkLedger') as typeof import('../lib/wearableLinkLedger');

/** A provider that answers with `samples`, or throws when `samples` is an Error. */
const provider = (id: string, name: string, samples: WorkoutSample[] | Error | null): WearableProvider => ({
  meta: { id, name, icon: '', kind: 'cloud', blurb: '', metrics: [] },
  isAvailable: () => true,
  connect: async () => true,
  disconnect: async () => undefined,
  fetchToday: async () => ({}),
  ...(samples === null ? {} : {
    fetchWorkouts: async () => { if (samples instanceof Error) throw samples; return samples; },
  }),
} as unknown as WearableProvider);

const sample = (id: string, start: string, activity: string): WorkoutSample =>
  ({ id, start, activity, mins: 30, source: id.split(':')[0] } as unknown as WorkoutSample);

const connected = { apple: 'connected', whoop: 'connected' } as Record<string, string>;

let ran = 0;
/** Non-zero exit without Node's `process` in the type environment. */
const fail = () => { (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1; };

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { ran += 1; console.log(`ok    ${name}`); })
    .catch((e: Error) => { console.error(`FAIL  ${name}\n      ${e && e.message}`); fail(); });
}

const reset = () => {
  reported.length = 0;
  ledger.forgetLink('apple' as never);
  ledger.forgetLink('whoop' as never);
  ledger.forgetLink('oura' as never);
};

(async () => {
  // ── one answered, one failed ─────────────────────────────────────────────
  await test('a provider that throws is "failed", never an empty list', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', [sample('apple:1', '2026-09-10T07:00:00.000Z', 'Run')]),
      provider('whoop', 'WHOOP', new Error('401')),
    ];
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.reach, 'partial');
    assert.strictEqual(r.answered.length, 1);
    assert.strictEqual(r.failed.length, 1);
    assert.strictEqual(r.failed[0].name, 'WHOOP');
    // The shape itself refuses to carry an empty list for a failure.
    assert.ok(!('samples' in r.failed[0]), 'a failed read must not carry a samples array');
    assert.strictEqual(r.samples.length, 1);
    assert.strictEqual(r.emptyAndWhole, false);
    assert.strictEqual(reported.length, 1, 'the failure is still recorded');
  });

  await test('the partial sentence names the device and refuses "no workouts"', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', []),
      provider('whoop', 'WHOOP', new Error('401')),
    ];
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.reach, 'partial');
    assert.strictEqual(r.samples.length, 0);
    // THE defect: zero samples, and it is not an empty answer.
    assert.strictEqual(r.emptyAndWhole, false);
    const note = wi.readNote(r, '14 days', 'your devices');
    assert.ok(note && note.includes('WHOOP'), 'names the device that did not answer');
    assert.ok(note && !note.startsWith('No workouts found'), 'never opens with the empty claim');
  });

  // ── everything answered, and held nothing ────────────────────────────────
  await test('every provider answering nothing IS "no workouts found"', async () => {
    reset();
    catalogue.list = [provider('apple', 'Apple Health', []), provider('whoop', 'WHOOP', [])];
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.reach, 'whole');
    assert.strictEqual(r.emptyAndWhole, true);
    assert.strictEqual(wi.readNote(r, '14 days', 'your devices'), 'No workouts found in the last 14 days from your devices.');
  });

  await test('a whole read with workouts has nothing to say', async () => {
    reset();
    catalogue.list = [provider('apple', 'Apple Health', [sample('apple:1', '2026-09-10T07:00:00.000Z', 'Run')])];
    const r = await wi.readRecent({ apple: 'connected' }, 14);
    assert.strictEqual(r.reach, 'whole');
    assert.strictEqual(wi.readNote(r, '14 days', 'Apple Health'), null);
  });

  // ── everything failed ────────────────────────────────────────────────────
  await test('every provider failing is "none", and is not an empty list', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', new Error('HealthKit')),
      provider('whoop', 'WHOOP', new Error('401')),
    ];
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.reach, 'none');
    assert.strictEqual(r.emptyAndWhole, false);
    assert.strictEqual(wi.failedNames(r), 'Apple Health and WHOOP');
    const note = wi.readNote(r, '14 days', 'your devices');
    assert.ok(note && note.includes('no list'), 'says it is no list rather than a list of nothing');
  });

  // ── never asked ──────────────────────────────────────────────────────────
  await test('a dead token is "not-asked", not "failed" — and importSources agrees', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', [sample('apple:1', '2026-09-10T07:00:00.000Z', 'Run')]),
      provider('whoop', 'WHOOP', new Error('the reader must never be reached')),
    ];
    // The server has proven WHOOP's token dead, while the app still remembers
    // the member connecting it. That disagreement is what used to send a
    // doomed request whose refusal became an empty list.
    ledger.noteTokenDead('whoop' as never, 'revoked');
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.failed.length, 0, 'nothing was asked, so nothing failed');
    const whoop = r.notAsked.find((x) => x.id === 'whoop');
    assert.ok(whoop && whoop.status === 'not-asked' && whoop.why === 'token-dead');
    assert.strictEqual(r.reach, 'whole');
    // `importSources` reads the same one answer rather than the raw flag.
    assert.deepStrictEqual(wi.importSources(connected).map((p) => p.meta.id), ['apple']);
  });

  await test('a provider with no workout reader is "not-asked: no-reader"', async () => {
    reset();
    catalogue.list = [provider('oura', 'Oura Ring', null)];
    const r = await wi.readRecent({ oura: 'connected' }, 14);
    const oura = r.notAsked.find((x) => x.id === 'oura');
    assert.ok(oura && oura.status === 'not-asked' && oura.why === 'no-reader');
    assert.strictEqual(r.reach, 'none');
    assert.strictEqual(r.emptyAndWhole, false, 'nothing asked is never an empty answer');
  });

  await test('nothing connected says so, rather than "no workouts"', async () => {
    reset();
    catalogue.list = [provider('whoop', 'WHOOP', [])];
    const r = await wi.readRecent({}, 14);
    assert.strictEqual(r.reach, 'none');
    const note = wi.readNote(r, '14 days', 'your devices');
    assert.ok(note && note.includes('No device is connected'));
  });

  await test('a dead token that was connected is offered a reconnect, not an absence', async () => {
    reset();
    catalogue.list = [provider('whoop', 'WHOOP', [])];
    ledger.noteTokenDead('whoop' as never, 'expired-no-refresh');
    const r = await wi.readRecent({ whoop: 'connected' }, 14);
    const note = wi.readNote(r, '14 days', 'WHOOP');
    assert.ok(note && note.includes('reconnecting'), 'points at the one thing that fixes it');
  });

  // ── the ordering the two screens depend on ───────────────────────────────
  await test('answered samples are merged newest first', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', [sample('apple:1', '2026-09-01T07:00:00.000Z', 'Run')]),
      provider('whoop', 'WHOOP', [sample('whoop:1', '2026-09-11T07:00:00.000Z', 'Row')]),
    ];
    const r = await wi.readRecent(connected, 14);
    assert.deepStrictEqual(r.samples.map((x) => x.id), ['whoop:1', 'apple:1']);
  });

  // ── the deprecated wrapper ───────────────────────────────────────────────
  // The assertion that stood here drove `fetchRecent`, which has since been
  // removed — both screens moved to `readRecent` and the wrapper went with the
  // second of them, as its own note said it should. What it proved is now
  // proved directly and more strongly: `readRecent` does not merely throw
  // instead of returning [], it has no `samples` field on the 'failed' variant
  // at all, so the empty-list reading is refused by the compiler.
  // The assertion that stood here drove `fetchRecent`, which has since been
  // removed — both screens moved to `readRecent` and the wrapper went with the
  // second of them, as its own note said it should.
  //
  // What it proved — that an all-failed read does not hand back an empty list —
  // is already proved above ('every provider failing is "none"'). What is NOT
  // proved above, and is the only reason this stays, is that the failure is
  // NAMED: `failed` carries the provider and `readNote` puts its name in the
  // sentence. An all-failed read that said "none" without saying WHO refused
  // would pass every assertion above it and still leave a member with no idea
  // which device to go and reconnect.
  await test('an all-failed read names the provider that refused', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', new Error('HealthKit')),
      provider('whoop', 'WHOOP', new Error('401')),
    ];
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.reach, 'none');
    assert.ok(r.failed.length > 0, 'the failure is named, not swallowed');
    const note = wi.readNote(r, '14 days', 'your devices') ?? '';
    assert.ok(/WHOOP/.test(note), 'the sentence names the provider that refused');
    assert.ok(!/no workouts found/i.test(note), 'and never calls a failed read an empty one');
  });

  // Was 'fetchRecent still returns the samples it can, for the callers not yet
  // moved'. There are no such callers now and no fetchRecent — but the property
  // it guarded is the one that matters most on this surface and is kept: one
  // provider refusing must not throw away the half that answered, AND the half
  // that is missing must be stated rather than quietly absent. The old wrapper
  // could only do the first of those.
  await test('a partial failure keeps what answered and names what did not', async () => {
    reset();
    catalogue.list = [
      provider('apple', 'Apple Health', [sample('apple:1', '2026-09-10T07:00:00.000Z', 'Run')]),
      provider('whoop', 'WHOOP', new Error('401')),
    ];
    const r = await wi.readRecent(connected, 14);
    assert.strictEqual(r.samples.length, 1, 'a partial failure must not throw away the half that answered');
    assert.strictEqual(r.reach, 'partial');
    assert.strictEqual(r.emptyAndWhole, false, 'a partial read may never be called empty');
    assert.ok(/WHOOP/.test(wi.readNote(r, '14 days', 'your devices') ?? ''), 'the provider that refused is named');
  });

  console.log(`\n${ran} passed`);
})();
