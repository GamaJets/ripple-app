// The phone's `my_sites()` read. Compile with tsc, run with node.
//
// The judgement all lives in `sitesFrom`, which ownedSites.test.ts already
// covers. What is asserted here is the thing that file cannot see: that a read
// which FAILED arrives as a failed read and not as an owner with no gyms. That
// is the one way this wrapper can be wrong, and it is the expensive way — a
// site count of 0 or 1 over a refused RPC is the app making a claim about
// somebody's business that nothing established.
import { fetchOwnerSites, SITES_LOADING, type SitesRpc } from './ownerSiteScope';
import { siteCount, siteNotice, showsSitePicker } from './ownedSites';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const rpc = (data: unknown, error: unknown = null): SitesRpc => ({
  rpc: async () => ({ data, error }),
});
const throwing: SitesRpc = { rpc: async () => { throw new Error('offline'); } };

const run = async () => {
  /* ── the overwhelming case: one gym, and nothing renders ───────────────── */

  const one = await fetchOwnerSites(rpc([{ id: 't1', name: 'Iron Works', current: true }]));
  eq(one.status, 'ready', 'a good read is ready');
  eq(siteCount(one), 1, 'one gym counts as one');
  eq(siteNotice(one), null, 'a single-site owner is told nothing at all — the screens are unchanged for them');
  eq(showsSitePicker(one), false, 'and is offered no picker');

  /* ── the case the sentence exists for ─────────────────────────────────── */

  const many = await fetchOwnerSites(rpc([
    { id: 't1', name: 'Iron Works', current: true },
    { id: 't2', name: 'Iron Works North', current: false },
    { id: 't3', name: 'Iron Works East', current: false },
  ]));
  eq(siteCount(many), 3, 'three gyms count as three');
  const note = siteNotice(many);
  ok(!!note && /one of 3 gyms/.test(note), 'a multi-site owner is told which gym they are looking at, and of how many');
  ok(!!note && /no figure on this page includes them/.test(note),
    'and told in as many words that the figures exclude the other sites — the roll-up this app does not do');

  /* ── a refused read is not an owner with no gyms ──────────────────────── */

  const failed = await fetchOwnerSites(rpc(null, { message: 'permission denied' }));
  eq(failed.status, 'error', 'a PostgREST error is an error');
  eq(failed.sites.length, 0, 'with no sites listed');
  eq(siteCount(failed), null, 'but the COUNT is null — unknown, never 0 and never 1');
  ok(siteNotice(failed) !== null, 'and the screen says so rather than going quiet');
  eq(showsSitePicker(failed), false, 'no control is built out of a failed read');

  /* ── a thrown client is the same fact ─────────────────────────────────── */

  const threw = await fetchOwnerSites(throwing);
  eq(threw.status, 'error', 'an offline client that throws is a failed read, not an empty one');
  eq(siteCount(threw), null, 'and its count is unknown too');

  /* ── the pre-read state ───────────────────────────────────────────────── */

  eq(SITES_LOADING.status, 'loading', 'a screen starts out not having read');
  eq(siteCount(SITES_LOADING), null, 'so the count is unknown, not zero');
  eq(siteNotice(SITES_LOADING), null,
    'and nothing is said while it is in flight — a sentence about a read that has not finished is noise');

  if (errors.length) {
    console.error(`ownerSiteScope: ${errors.length} failure(s)`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('ownerSiteScope: all assertions passed');
};

void run();
