// The four states that used to look the same.
import {
  lastUpdateCheck, sayUpdateCheck, watchUpdateCheck, forgetUpdateCheck,
  updateCheckLine, whyFailed, type UpdateCheck,
} from './updateCheck';

process.exitCode = 1;
const errors: string[] = [];
const ok = (c: boolean, what: string) => { if (!c) errors.push(what); };
const eq = (got: unknown, want: unknown, what: string) => {
  if (got !== want) errors.push(`${what} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const at = () => '09:41';

forgetUpdateCheck();
eq(lastUpdateCheck().state, 'idle', 'nothing has happened before the first launch check');

// ── the pair this module exists for ──────────────────────────────────────
// "already up to date" and "never asked" are the two a person holding a stuck
// phone has to tell apart, and they call for opposite next moves.
const never = updateCheckLine({ state: 'idle' }, at);
const fine = updateCheckLine({ state: 'current', at: 1 }, at);
ok(never !== fine, 'a phone that never checked does not read the same as one that is current');
ok(!/up to date/.test(never), 'never having checked is not reported as being up to date');
ok(/up to date/.test(fine), 'being current says so');
ok(fine.includes('09:41'), 'a settled check carries the time it happened, which is what proves it ran');

// A failure names its reason. A diagnostic line with no reason on it is the
// thing the old `catch {}` already did.
const bad = updateCheckLine({ state: 'failed', at: 1, why: 'no reason given' }, at);
ok(/failed/.test(bad), 'a failed check says it failed');
ok(bad.includes('no reason given'), 'a failed check carries its reason');

eq(updateCheckLine({ state: 'disabled' }, at), 'off in this build', 'a dev build says updates are off rather than staying silent');

// Every state produces a line — a state added later with no sentence would
// render as undefined on the screen somebody is reading to unstick a phone.
const all: UpdateCheck[] = [
  { state: 'idle' }, { state: 'disabled' }, { state: 'checking', at: 1 },
  { state: 'current', at: 1 }, { state: 'downloading', at: 1 },
  { state: 'applying', at: 1 }, { state: 'ready', at: 1 },
  { state: 'failed', at: 1, why: 'x' },
];
for (const c of all) {
  const line = updateCheckLine(c, at);
  ok(typeof line === 'string' && line.length > 0, `${c.state} has a sentence`);
}

// 'ready' and 'current' are the pair this module exists for, so they must not
// read alike: one means there is nothing to get, the other that there is and it
// is already on the phone. A tester reading "up to date" on a handset holding
// an unapplied bundle is the confusion the whole file is about.
ok(updateCheckLine({ state: 'ready', at: 1 }, at) !== updateCheckLine({ state: 'current', at: 1 }, at),
  'a downloaded-but-not-applied update does not read as already up to date');
ok(/next time you open/i.test(updateCheckLine({ state: 'ready', at: 1 }, at)),
  'and it says what will make it run');

// ── watchers ─────────────────────────────────────────────────────────────
forgetUpdateCheck();
const seen: string[] = [];
const off = watchUpdateCheck((c) => seen.push(c.state));
sayUpdateCheck({ state: 'checking', at: 1 });
sayUpdateCheck({ state: 'current', at: 2 });
eq(seen.join(','), 'checking,current', 'a watcher hears each state in order');
eq(lastUpdateCheck().state, 'current', 'the record holds the latest state');
off();
sayUpdateCheck({ state: 'failed', at: 3, why: 'x' });
eq(seen.length, 2, 'an unsubscribed watcher hears nothing more');

// One bad listener must not stop the others: the Build screen unmounting mid
// notify should not cost the record its update.
forgetUpdateCheck();
let reached = false;
watchUpdateCheck(() => { throw new Error('bad listener'); });
watchUpdateCheck(() => { reached = true; });
sayUpdateCheck({ state: 'current', at: 1 });
ok(reached, 'a throwing listener does not stop the next one');
eq(lastUpdateCheck().state, 'current', 'and the record is still written');

// ── whyFailed ────────────────────────────────────────────────────────────
eq(whyFailed(new Error('')), 'no reason given', 'an empty message still says something');
eq(whyFailed(undefined), 'no reason given', 'a thrown non-error still says something');
eq(whyFailed('   '), 'no reason given', 'whitespace is not a reason');
ok(/offline/.test(whyFailed(new Error('Network request failed'))), 'a network failure suggests being offline, which is the ordinary cause');
eq(whyFailed(new Error('manifest signature invalid')), 'manifest signature invalid', 'a real reason is passed through unchanged');

forgetUpdateCheck();

if (errors.length) {
  console.error(`updateCheck — ${errors.length} failure(s):`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
console.log('updateCheck — ok');
process.exitCode = 0;
