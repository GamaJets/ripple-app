// The two things an invitation read or write must never do quietly.
// Compile with tsc, run with node.
//
// Both of these shipped. A read with no `.limit()` handed the phone whatever
// PostgREST felt like returning and called it the whole of somebody's
// invitations; an insert refused by `uq_member_invites_open` put
// `duplicate key value violates unique constraint "uq_member_invites_open"`
// under a gym owner's form, on a refusal that is a rule the gym itself set.
//
// Neither is a race. The first needs a thousand rows, which is unlikely; the
// second needs only a list read that failed (`openTo` is `[]` by design then)
// or a second machine at the same front desk, both of which are Tuesday.
import {
  fetchInvites, fetchMyInvites, createInvite, createInvites, acceptInvite,
  isDuplicateInvite, DuplicateInviteError, DUPLICATE_INVITE_NOTE,
} from './memberInvites';
import { ROW_CAP, TruncatedRead } from './rowCap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

async function threw(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); } catch (e) { return e; }
  return null;
}

/* ── a Supabase stand-in that records what was actually asked for ─────────── */

interface Q {
  table: string;
  /** What `.limit()` was given, or null when the read asked for no ceiling at
   *  all — which is the defect, not the absence of one. */
  limit: number | null;
  orders: [string, unknown][];
  payload: unknown;
}

type Answer = { data: unknown; error: unknown };

function client(answers: Record<string, Answer>) {
  const asked: Q[] = [];
  const from = (table: string) => {
    const seen: Q = { table, limit: null, orders: [], payload: null };
    const q: any = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.order = (c: string, o: unknown) => { seen.orders.push([c, o]); return q; };
    q.limit = (n: number) => { seen.limit = n; return q; };
    q.insert = (p: unknown) => { seen.payload = p; return q; };
    q.then = (res: (v: Answer) => unknown, rej: (e: unknown) => unknown) => {
      asked.push(seen);
      return Promise.resolve(answers[table] ?? { data: [], error: null }).then(res, rej);
    };
    return q;
  };
  return { sb: { from } as any, asked };
}

const inviteRow = (n: number) => ({
  id: `i${n}`, tenant_id: 't1', email: `p${n}@example.com`, full_name: null,
  plan_id: null, invited_by: null, token: null, status: 'pending',
  created_at: '2026-09-01T09:00:00.000Z', expires_at: null,
  accepted_at: null, accepted_by: null,
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => inviteRow(i));

/* ── fetchMyInvites: the read that could be cut without anybody being told ── */

void (async () => {
  {
    const { sb, asked } = client({ member_invites: { data: rows(3), error: null } });
    const out = await fetchMyInvites(sb);
    eq(out.rows.length, 3, 'a short page comes back whole');
    eq(out.truncated, false, 'and is not reported as a prefix');
    const q = asked.find((a) => a.table === 'member_invites')!;
    eq(q.limit, ROW_CAP + 1,
      'the read asks for one row PAST the ceiling — a full page and a cut one are otherwise identical');
    ok(q.orders.length >= 2,
      'and orders on a tiebreak as well as the date, so which rows a cut read keeps is the same every time');
  }

  {
    const { sb } = client({ member_invites: { data: rows(ROW_CAP), error: null } });
    const out = await fetchMyInvites(sb);
    eq(out.rows.length, ROW_CAP, 'a page exactly at the cap is a complete set');
    eq(out.truncated, false, 'and is not called a prefix — that would be a false refusal');
  }

  {
    const { sb } = client({ member_invites: { data: rows(ROW_CAP + 1), error: null } });
    const out = await fetchMyInvites(sb);
    eq(out.truncated, true, 'a page past the cap is reported as a prefix');
    eq(out.rows.length, ROW_CAP,
      'and the probe row is NOT handed back as an invitation — it was asked for to be counted');
    // The whole point of keeping them: these are real, redeemable invitations
    // on the one screen that can accept them. Throwing would take them away to
    // protect a figure nobody on the phone computes. See src/lib/rowCap.ts.
    ok(out.rows.every((r) => r.status === 'pending'),
      'the rows a truncated read keeps are still real rows');
  }

  {
    const { sb } = client({ member_invites: { data: null, error: { message: 'nope' } } });
    ok((await threw(() => fetchMyInvites(sb))) !== null,
      'a failed read throws — it is never an empty list of invitations');
  }

  /* ── fetchInvites: the sibling, which must keep REFUSING ────────────────── */

  {
    const { sb } = client({ member_invites: { data: rows(ROW_CAP + 1), error: null } });
    const e = await threw(() => fetchInvites(sb, 't1'));
    ok(e instanceof TruncatedRead,
      'the console read still refuses a cut page: it feeds summariseInvites, and a rate over part of a set is a wrong number');
  }

  /* ── createInvite: the refusal that reads as a system fault ─────────────── */

  {
    const { sb } = client({
      member_invites: {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_member_invites_open"' },
      },
    });
    const e = await threw(() => createInvite(sb, 't1', { email: 'Jane@Example.com ' }));
    ok(e instanceof DuplicateInviteError, 'a 23505 becomes the gym’s own rule, not a constraint name');
    const m = (e as Error).message;
    ok(m.includes('jane@example.com'),
      'it names the address the index actually compared — normalised, as the index compares it');
    ok(!/duplicate key|unique constraint|23505|uq_member_invites_open/i.test(m),
      'and no Postgres reaches the owner');
    ok(/reopen/i.test(m), 'the rule says a lapsed invitation still holds the place until it is reopened');
    ok(/[Nn]othing has been written/.test(m),
      'and says nothing was written, because nothing was');
    eq((e as DuplicateInviteError).email, 'jane@example.com',
      'the address travels on the error, so a screen can find the row');
  }

  {
    // The code lost in transit; the constraint name is the fallback.
    const { sb } = client({
      member_invites: { data: null, error: { message: 'violates unique constraint "uq_member_invites_open"' } },
    });
    ok((await threw(() => createInvite(sb, 't1', { email: 'a@b.com' }))) instanceof DuplicateInviteError,
      'the constraint name alone is enough to recognise it');
  }

  {
    // Everything else is rethrown AS IT ARRIVED. Inventing a friendlier
    // sentence here would describe a cause nobody established.
    const raw = { code: '42501', message: 'new row violates row-level security policy' };
    const { sb } = client({ member_invites: { data: null, error: raw } });
    eq(await threw(() => createInvite(sb, 't1', { email: 'a@b.com' })), raw,
      'an RLS refusal is passed through untouched, not dressed up as a duplicate');
  }

  {
    const { sb, asked } = client({ member_invites: { data: null, error: null } });
    const e = await threw(() => createInvite(sb, 't1', { email: 'not an address' }));
    ok(e instanceof Error && !(e instanceof DuplicateInviteError),
      'a bad address is still refused in words before the round trip');
    eq(asked.length, 0, 'and nothing is sent to the server for it');
  }

  /* ── createInvites: one statement, so the whole batch or none of it ─────── */

  {
    const { sb } = client({ member_invites: { data: null, error: { code: '23505', message: 'duplicate key value' } } });
    const e = await threw(() => createInvites(sb, 't1', [
      { email: 'a@b.com' }, { email: 'c@d.com' },
    ]));
    ok(e instanceof DuplicateInviteError, 'the batch refusal is translated too');
    eq((e as DuplicateInviteError).email, null,
      'with NO address — Postgres does not say which row, and a guess would have an owner strike the wrong line out');
    const m = (e as Error).message;
    ok(/not in the refusal|which one/i.test(m), 'so the sentence says which one is not known');
    ok(!/duplicate key|23505/i.test(m), 'and still no Postgres');
  }

  {
    const { sb } = client({ member_invites: { data: null, error: null } });
    const out = await createInvites(sb, 't1', [
      { email: 'a@b.com' }, { email: 'A@B.com' }, { email: 'nope' },
    ]);
    eq(out.sent, 1, 'a duplicate within the batch is dropped before the insert, not after it fails');
    eq(out.rejected.length, 2, 'and both rejects are reported by row, never silently trimmed');
  }

  /* ── the predicate the console needs, so its swap is a rename ───────────── */

  ok(isDuplicateInvite(new DuplicateInviteError('a@b.com')),
    'the predicate recognises this module’s own wrapper — a call site swapping its private copy needs no second branch');
  ok(isDuplicateInvite({ code: '23505' }), 'and the raw code');
  ok(isDuplicateInvite({ details: 'Key (tenant_id, lower(email)) … uq_member_invites_open' }),
    'and the constraint name in details');
  ok(!isDuplicateInvite(null), 'null is not a duplicate refusal');
  ok(!isDuplicateInvite(new Error('boom')), 'nor is an ordinary failure');
  ok(!isDuplicateInvite({ code: '23503' }), 'nor a foreign key violation — a different fault with a different fix');
  ok(!isDuplicateInvite({ code: '42501', message: 'permission denied' }),
    'nor an RLS refusal, which must not be reported to an owner as their own duplicate');

  ok(!/uq_member_invites_open|23505/.test(DUPLICATE_INVITE_NOTE),
    'the shared sentence describes the rule, never the index');
  ok(!/reopen beside|press|button|list below/i.test(DUPLICATE_INVITE_NOTE),
    'and names no button: only a screen knows what controls it has');

  /* ── acceptInvite: no membership id is not a success we failed to notice ── */

  {
    const sb: any = { from: () => { throw new Error('unused'); }, rpc: async () => ({ data: null, error: null }) };
    eq(await acceptInvite(sb, 'i1'), null,
      'an RPC that returned nothing resolves null — never a membership nobody evidenced');
  }
  {
    const sb: any = { from: () => { throw new Error('unused'); }, rpc: async () => ({ data: 'm1', error: null }) };
    eq(await acceptInvite(sb, 'i1'), 'm1', 'and the membership the server opened comes back as itself');
  }

  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('memberInvites.test.ts — all assertions passed');
})();
