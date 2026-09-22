// A member's corrections to their own plan belong to the member who made them.
// Compile with tsc, run with node.
//
// src/lib/planEdits.test.ts already holds the SHAPE of the blob — what parses,
// what round-trips, what an absent key means. This file is about whose it is,
// which is a question about sequence and not about shape: the whole defect was
// that the four values and the stored bytes crossed a sign-out, so the assertion
// has to cross one too. One handset, one fake store, one fake server table, the
// real functions from ./planEdits, driven sign-in → sign-out → sign-in.
import {
  PLAN_EDITS_KEY, PLAN_EDITS_PREFIX, planEditsKey, isPlanEditsKey, planEditsStepFor,
  readPlanEdits, writePlanEdits, EMPTY_PLAN_EDITS, type PlanEdits,
} from './planEdits';
import { accountStateStep } from './accountScopedState';
import { PERSONAL_DEVICE_KEYS, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the key carries the account ────────────────────────────────────────── */

const kA = planEditsKey('member-a')!;
const kB = planEditsKey('member-b')!;
ok(kA !== kB, 'two members on one handset do not share a set of plan edits');
ok(isPlanEditsKey(kA) && kA.startsWith(PLAN_EDITS_PREFIX), 'and the key is recognisable as what it is');
ok(kA.includes('member-a'), 'the account really is in it');
ok(!isPlanEditsKey(PLAN_EDITS_KEY),
  'the unqualified key is not one of these — it has no account in it, which was the defect');
// The prefix is the old key plus a colon, so the old key can never be mistaken
// for a scoped one and a scoped one can never collide with it.
ok((PLAN_EDITS_PREFIX as string).startsWith(PLAN_EDITS_KEY)
  && (PLAN_EDITS_PREFIX as string).length > PLAN_EDITS_KEY.length,
  'the scoped keys sit under the old name without ever being it');

eq(planEditsKey(null), null, 'nobody signed in is not an account');
eq(planEditsKey(''), null, 'nor is an empty id');
eq(planEditsKey('   '), null, 'nor a blank one');
// `cd.id` is `sbUid ?? 'unknown'` — src/ui/clientData.tsx. Composing a key from
// it would give every signed-out session on the handset one shared blob, which
// is the unqualified key again wearing a suffix.
eq(planEditsKey('unknown'), null, "'unknown' is not an account");

ok(!PERSONAL_DEVICE_KEYS.some((k) => isPlanEditsKey(k)),
  'it is not on the device-key list — that list is only for keys with no account in them');
ok(!PERSONAL_DEVICE_KEYS.includes(PLAN_EDITS_KEY),
  'and the unqualified key is not cleared at sign-out either — the hook deletes it outright, unread');
ok(ACCOUNT_SCOPED_PREFIXES.every((p) => !PLAN_EDITS_PREFIX.startsWith(p)),
  'it is its own prefix, not smuggled under another module’s');

/* ── the shared step, asserted directly ─────────────────────────────────── */

eq(accountStateStep({ key: null, onScreenKey: null, onScreenSaved: false }).do, 'hold',
  'no account and nothing on screen is nothing to do');
eq(accountStateStep({ key: null, onScreenKey: 'k', onScreenSaved: false }).do, 'hold',
  'the only copy of something is never dropped because a session went quiet');
eq(accountStateStep({ key: null, onScreenKey: 'k', onScreenSaved: true }).do, 'forget',
  'but state with a copy behind it goes when the account does');
{
  const s = accountStateStep({ key: 'kB', onScreenKey: 'kA', onScreenSaved: true });
  ok(s.do === 'load' && s.forget, 'a different account is a wipe and then a read');
  const t = accountStateStep({ key: 'kA', onScreenKey: 'kA', onScreenSaved: true });
  ok(t.do === 'load' && !t.forget, 'and the same account keeps its own');
}

eq(planEditsStepFor({ uid: 'member-a', onScreenKey: null, onScreenSaved: false }).do, 'load',
  'an account is a read');
eq(planEditsStepFor({ uid: 'unknown', onScreenKey: kA, onScreenSaved: true }).do, 'forget',
  "'unknown' is no account here either, not a third member");
{
  const s = planEditsStepFor({ uid: 'member-b', onScreenKey: kA, onScreenSaved: true });
  ok(s.do === 'load' && s.key === kB && s.forget, "member B's read never runs over member A's state");
}

/* ── one handset, two members, and a server that remembers ──────────────── */

class Store {
  items = new Map<string, string>();
  shut = false;
  get(k: string): string | null {
    if (this.shut) throw new Error('store will not open');
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  set(k: string, v: string) { this.items.set(k, v); }
  remove(k: string) { this.items.delete(k); }
}

/** `client_plan_edits`, upserted on `client_id`. One row per member, replaced
 *  each time — which is why a write filed under the wrong id does not heal. */
class Server {
  rows = new Map<string, PlanEdits>();
  upsert(clientId: string, edits: string) { this.rows.set(clientId, readPlanEdits(edits).edits); }
}

/**
 * `usePlanEdits`, reduced to the parts that can cross a session: the four
 * values, the flag that arms the writes, and the account all of it belongs to.
 * Every decision comes from ./planEdits and ./accountScopedState.
 */
class Train {
  edits: PlanEdits = EMPTY_PLAN_EDITS;
  loaded = false;
  cacheable = true;
  onScreenKey: string | null = null;
  constructor(private store: Store, private server: Server) {}

  private forget() {
    this.edits = EMPTY_PLAN_EDITS;
  }

  /** The `[editsKey]` effect. */
  session(uid: string | null) {
    const step = planEditsStepFor({
      uid, onScreenKey: this.onScreenKey, onScreenSaved: this.loaded,
    });
    // Both flags cleared BEFORE the read, never left at the last key's answer.
    this.loaded = false;
    this.cacheable = true;
    if (step.do === 'hold') return;
    if (step.do === 'forget') { this.onScreenKey = null; this.forget(); return; }
    if (step.forget) this.forget();
    this.onScreenKey = step.key;
    try {
      const r = readPlanEdits(this.store.get(step.key));
      if (!r.read) this.cacheable = false;
      this.edits = r.edits;
    } catch { this.cacheable = false; }
    this.loaded = true;
  }

  /** One change the member makes — a swap, a corrected load, anything. */
  change(uid: string | null, patch: Partial<PlanEdits>) {
    const next: PlanEdits = { ...this.edits, ...patch };
    this.edits = next;
    if (!this.loaded) return;                       // rule 1
    if (this.onScreenKey && this.cacheable) this.store.set(this.onScreenKey, writePlanEdits(next));
    // What `push` does: upsert on the clientId the hook was rendered with.
    if (uid && uid !== 'unknown') this.server.upsert(uid, writePlanEdits(next));
  }

  remount(): Train { return new Train(this.store, this.server); }
}

{
  const store = new Store();
  const server = new Server();
  // Whatever the unqualified key held before this fix. It names nobody.
  store.set(PLAN_EDITS_KEY, writePlanEdits({
    ...EMPTY_PLAN_EDITS, swaps: { '0:bench': 'Dumbbell Press' },
  }));

  let screen = new Train(store, server);
  screen.session('member-a');
  eq(Object.keys(screen.edits.swaps).length, 0,
    'member A opens Train with no swaps — the unqualified blob is nobody’s and is not read');

  // The hook deletes the unqualified key on sight. Modelled so the sequence
  // below is the one a real handset runs.
  store.remove(PLAN_EDITS_KEY);
  ok(!store.items.has(PLAN_EDITS_KEY), 'and it is gone from the handset, never having been parsed');

  screen.change('member-a', {
    swaps: { '0:bench': 'Floor Press' },
    removed: ['2:overhead'],
  });
  eq(readPlanEdits(store.items.get(kA)!).edits.swaps['0:bench'], 'Floor Press',
    "A's swap is on the device under A's own key");
  eq(server.rows.get('member-a')!.removed.length, 1, "and on A's server row");
  ok(!server.rows.has('member-b'), 'and on nobody else’s');

  // ── A signs out. The Train tab stays mounted; A's corrections must not. ──
  screen.session(null);
  eq(Object.keys(screen.edits.swaps).length, 0, 'signing out takes the swaps off the screen');
  eq(screen.edits.removed.length, 0, 'and the removed movements');
  eq(screen.loaded, false, 'and disarms the writes');
  ok(store.items.has(kA), "A's own bytes survive under A's key — they are A's record, not litter");

  // ── B signs in on the same handset ──────────────────────────────────────
  screen = screen.remount();
  screen.session('member-b');
  eq(Object.keys(screen.edits.swaps).length, 0, "B's Train tab shows B's plan, unchanged");
  // The defect, exactly: B makes ONE change of their own and A's other fields
  // ride up with it under B's id.
  screen.change('member-b', { custom: [{ key: 'c1', name: 'Cable Row' } as PlanEdits['custom'][number]] });
  const bRow = server.rows.get('member-b')!;
  eq(bRow.custom.length, 1, "B's own addition reaches B's row");
  eq(Object.keys(bRow.swaps).length, 0, "and A's swap does NOT ride up with it");
  eq(bRow.removed.length, 0, "nor A's removed movement");
  const aRow = server.rows.get('member-a')!;
  eq(aRow.swaps['0:bench'], 'Floor Press', "and A's row is untouched by any of it");
  eq(readPlanEdits(store.items.get(kA)!).edits.swaps['0:bench'], 'Floor Press',
    "as are A's stored bytes");

  // ── and A comes back to their own corrections ───────────────────────────
  screen = screen.remount();
  screen.session('member-a');
  eq(screen.edits.swaps['0:bench'], 'Floor Press', 'A signs back in to their own swap');
  eq(screen.edits.removed[0], '2:overhead', 'and their own removal');
  eq(screen.edits.custom.length, 0, "and none of B's additions");
}

/* ── a straight switch, with no signed-out gap ──────────────────────────── */

{
  const store = new Store();
  const server = new Server();
  const screen = new Train(store, server);
  screen.session('member-a');
  screen.change('member-a', { swaps: { '0:bench': 'Floor Press' } });
  screen.session('member-b');
  eq(Object.keys(screen.edits.swaps).length, 0,
    "B never inherits A's swaps even when the session never went null");
  screen.change('member-b', { removed: ['1:squat'] });
  eq(Object.keys(server.rows.get('member-b')!.swaps).length, 0,
    "and nothing of A's is written into B's row");
}

/* ── a read that failed is not an empty plan ────────────────────────────── */

{
  const store = new Store();
  const server = new Server();
  const screen = new Train(store, server);
  screen.session('member-a');
  screen.change('member-a', { swaps: { '0:bench': 'Floor Press' } });
  const kept = store.items.get(planEditsKey('member-a')!)!;

  // B signs in and the read for B's key throws.
  store.shut = true;
  screen.session('member-b');
  eq(screen.cacheable, false, 'a read that threw latches the device write off');
  eq(Object.keys(screen.edits.swaps).length, 0, "and B still does not hold A's swaps");
  store.shut = false;
  screen.change('member-b', { removed: ['1:squat'] });
  eq(store.items.get(planEditsKey('member-a')!), kept,
    "B's change writes nothing over A's stored corrections");
  ok(!store.items.has(planEditsKey('member-b')!),
    'nor over B’s own unread bytes — a failed read is not an empty plan');
  eq(server.rows.get('member-b')!.removed.length, 1,
    'but it still reaches the server, where the row is keyed by the member it belongs to');
}

/* ── the latch does not cross an account ────────────────────────────────── */

{
  const store = new Store();
  const server = new Server();
  store.set(planEditsKey('member-a')!, 'not json at all');
  const screen = new Train(store, server);
  screen.session('member-a');
  eq(screen.cacheable, false, "A's corrupt blob stops A's device writes");
  screen.session('member-b');
  eq(screen.cacheable, true,
    "and B starts clean — one member's parse failure is not the next member's permanent refusal to save");
  screen.change('member-b', { removed: ['1:squat'] });
  ok(store.items.has(planEditsKey('member-b')!), "so B's own corrections are kept");
  eq(store.items.get(planEditsKey('member-a')!), 'not json at all',
    "and A's unreadable bytes are still exactly where they were, never overwritten");
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('planEditsScope: ok');
