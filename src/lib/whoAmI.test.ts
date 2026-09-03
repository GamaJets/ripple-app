// What src/lib/whoAmI.ts must do, and the three things it must never do.
//
// Every case here was written by first breaking the rule in a scratchpad copy
// and confirming the named assertion failed.
import { shareGetUser, WHO_AM_I_MS } from './whoAmI';

// Reaching success rather than defaulting to it: a suite that hangs on an
// un-settled promise would otherwise exit 0 having asserted nothing.
process.exitCode = 1;

const errors: string[] = [];
function ok(cond: boolean, what: string): void { if (!cond) errors.push(what); }
function eq<T>(got: T, want: T, what: string): void {
  if (got !== want) errors.push(`${what} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

/** A UserResponse, near enough: what supabase-js hands back either way. */
type Resp = { data: { user: { id: string } | null }; error: { message: string } | null };
const good = (id: string): Resp => ({ data: { user: { id } }, error: null });
const bad = (message: string): Resp => ({ data: { user: null }, error: { message } });
const failed = (r: Resp) => r.error !== null;

/** A clock that only moves when a test moves it. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** A `native` that never settles until the test lets it. */
function gate<T>() {
  let release!: (v: T) => void;
  const p = new Promise<T>((res) => { release = res; });
  return { p, release };
}

async function main(): Promise<void> {
  /* ── the point of the whole module: one request, not eleven ───────────── */
  {
    let calls = 0;
    const g = gate<Resp>();
    const who = shareGetUser<Resp>(() => { calls++; return g.p; }, failed);

    // Eleven providers mounting in the same tick, exactly the measured case.
    const all = Promise.all(Array.from({ length: 11 }, () => who.getUser()));
    eq(calls, 1, 'eleven callers arriving while a request is out make ONE request');
    g.release(good('u1'));
    const got = await all;
    eq(calls, 1, 'and none of them starts a second one after it lands');
    ok(got.every((r) => r === got[0]), 'every joined caller is handed the same response object');
    eq(got[0].data.user?.id, 'u1', 'and it is the answer the server actually gave');
  }

  /* ── an answer is reused for the window, and re-read after it ─────────── */
  {
    let calls = 0;
    const c = clock();
    const who = shareGetUser<Resp>(async () => { calls++; return good('u1'); }, failed, { now: c.now });

    await who.getUser();
    await who.getUser();
    eq(calls, 1, 'a second caller inside the window reuses the landed answer');

    c.advance(WHO_AM_I_MS - 1);
    await who.getUser();
    eq(calls, 1, 'still reused one millisecond before the window closes');

    c.advance(1);
    await who.getUser();
    eq(calls, 2, 'and re-read the moment it does — this is not a session cache');
  }

  /* ── NEVER hold a failure ─────────────────────────────────────────────── */
  {
    let calls = 0;
    const c = clock();
    const who = shareGetUser<Resp>(async () => { calls++; return bad('session missing'); }, failed, { now: c.now });

    const first = await who.getUser();
    const second = await who.getUser();
    eq(calls, 2, 'an errored response is never held — the next caller asks again');
    eq(first.error?.message, 'session missing', 'and the caller is handed the error response itself');
    eq(second.error?.message, 'session missing', 'both times');
    ok(first.data.user === null, 'with the user null, exactly as supabase-js returned it');
  }

  /* ── a failure must not poison the answer that follows it ─────────────── */
  {
    let n = 0;
    const c = clock();
    const who = shareGetUser<Resp>(async () => (++n === 1 ? bad('offline') : good('u1')), failed, { now: c.now });

    await who.getUser();
    const after = await who.getUser();
    eq(after.data.user?.id, 'u1', 'a signed-in answer after a failed one is the one returned');
  }

  /* ── NEVER share an answer about somebody else ────────────────────────── */
  {
    const seen: (string | undefined)[] = [];
    const c = clock();
    const who = shareGetUser<Resp>(async (jwt) => { seen.push(jwt); return good(jwt ?? 'me'); }, failed, { now: c.now });

    await who.getUser();                    // the signed-in user
    const other = await who.getUser('tok'); // a specific bearer — send-push's case
    eq(seen.length, 2, 'an explicit token always goes to the server');
    eq(other.data.user?.id, 'tok', 'and is answered about ITS bearer, not the signed-in user');

    await who.getUser();
    eq(seen.length, 2, 'while the signed-in answer is still reused');

    // And the reverse: a token call must not become the held answer either.
    const mine = await who.getUser();
    eq(mine.data.user?.id, 'me', 'a token call never becomes the held answer for the session');
  }

  /* ── an empty-string token is still a token ───────────────────────────── */
  {
    const seen: (string | undefined)[] = [];
    const who = shareGetUser<Resp>(async (jwt) => { seen.push(jwt); return good('x'); }, failed);
    await who.getUser();
    await who.getUser('');
    eq(seen.length, 2, "getUser('') asks the server — an empty token is somebody asking about a token");
    eq(seen[1], '', 'and it is passed through unchanged rather than dropped');
  }

  /* ── forget: signing out must not leave the old person held ───────────── */
  {
    let n = 0;
    const c = clock();
    const who = shareGetUser<Resp>(async () => good(++n === 1 ? 'first' : 'second'), failed, { now: c.now });

    await who.getUser();
    who.forget();
    const after = await who.getUser();
    eq(after.data.user?.id, 'second', 'forget() drops the held answer, so a new sign-in is not answered as the old one');
  }

  /* ── a throw is a throw, not a response ───────────────────────────────── */
  {
    const boom = new TypeError('Network request failed');
    const who = shareGetUser<Resp>(async () => { throw boom; }, failed);
    let caught: unknown = null;
    try { await who.getUser(); } catch (e) { caught = e; }
    ok(caught === boom, 'a throw out of getUser is re-thrown, not returned as a response');
    // Returning it would hand every call site an object with no `error` key,
    // and they would read `data.user` off a TypeError.
  }

  if (errors.length) {
    for (const e of errors) console.error('  ✗ ' + e);
    console.error(`\nwhoAmI — ${errors.length} failure${errors.length === 1 ? '' : 's'}.`);
    process.exit(1);
  }
  console.log('whoAmI ok — one request per burst, no failure held, no answer about somebody else shared.');
  process.exitCode = 0;
}

void main();
