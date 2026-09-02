// Supabase Edge Function: sweep-stale-visits
//
// ── What this is for ───────────────────────────────────────────────────────
//
// `sweepStaleVisits` has existed in src/lib/gymVisits.ts since the door log was
// built and has never had a caller anywhere in this repository. Meanwhile the
// Door screen told the owner, in as many words, that a visit left open
// overnight is "swept with a note" — a sentence about a job nothing ran.
//
// The consequence is not cosmetic. A visit with no `exited_at` is an open visit
// forever: it sits in "Inside now" if the screen reads a wide enough window, it
// is excluded from every dwell average (correctly — see below), and the pile
// grows by however many people forget to scan out each day. A gym six months in
// has hundreds, and nobody can tell the four people actually in the building
// from the four hundred who left in March.
//
// ── What a sweep does and does not write ──────────────────────────────────
//
// It writes a NOTE. It does not write `exited_at`, and that is the whole design:
// stamping a plausible exit time would quietly corrupt every dwell figure
// computed afterwards, and a twenty-hour stay in the average is not a rounding
// error. What the sweep records is that somebody has accounted for the row — it
// is not a person standing in the gym.
//
// ── Why this needs the service role, and why that is safe here ────────────
//
// The console runs on the anon key plus the signed-in owner's session, and the
// owner CAN sweep their own gym: `gym_visits_staff_u` is `tenant_id =
// my_tenant() and my_role() in ('trainer','owner')`. /door offers exactly that
// as a button. What an owner's session cannot do is run at 4am across every
// tenant, which is what a scheduled job is.
//
// The service role bypasses RLS completely, so NONE of the policies that scope
// the rest of the platform apply inside this function. Everything below is
// therefore written to be safe without them:
//
//   · it takes NO input. There is no tenant parameter, no hours parameter and
//     no request body that is read at all. A definer-shaped function that
//     accepts a tenant id from its caller is the exact bug 35-class-capacity-
//     and-scope.sql was written to fix, and the safest version of that argument
//     is not to have the parameter;
//   · it writes ONE column, `note`, and only on rows that are already open and
//     already older than the cutoff. It cannot close a visit, cannot move one
//     between tenants and cannot read anything back to a caller;
//   · it returns counts only — never a row, never a member id, never a name. A
//     scheduled job's response body is read by a log, and a log is not a place
//     to put who was in the gym.
//
// ── Authorisation ─────────────────────────────────────────────────────────
//
// A shared secret in a header, checked in constant-ish time, and NOT the
// service key itself — a cron entry holding the service key is a service key in
// a place that gets copied into a screenshot. Supabase's own scheduler sends
// whatever headers the schedule declares.
//
// The function refuses outright when SWEEP_SECRET is unset, rather than running
// unauthenticated. An endpoint that writes to every tenant's door log must fail
// closed on a missing configuration, not open.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sweep-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('SWEEP_SECRET') ?? '';

/**
 * How long a visit may stay open before it is swept.
 *
 * Twelve hours, matching the default in `sweepStaleVisits`. It has to be longer
 * than the longest honest visit and shorter than the gap between two visits by
 * the same person, and twelve clears both: nobody trains for twelve hours, and
 * a 6am regular is not back until 6am tomorrow.
 *
 * Not configurable by the caller, for the reason in the header: this function
 * takes no input at all.
 */
const STALE_HOURS = 12;

/** The exact note. Must stay byte-identical to `SWEEP_NOTE` in
 *  src/lib/gymVisits.ts — the console reads it to tell a visit nobody closed
 *  from one the sweep has already accounted for, and two spellings would make
 *  the same row look unswept to one surface and swept to the other. */
const SWEEP_NOTE = 'auto-closed: no exit recorded';

/** The prefix a staff override writes. Byte-identical to `OVERRIDE_PREFIX` in
 *  src/lib/gymVisits.ts and to the `like` pattern in supabase/parts/490 and
 *  491 — three spellings of one string is three chances for the sweep to erase
 *  the audit note it is meant to leave alone. */
const OVERRIDE_PREFIX = 'admitted anyway: ';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Fail closed. An unset secret is a misconfigured deploy, and the wrong
  // response to one is to start writing to every gym in the database.
  if (!SECRET) return json({ ok: false, error: 'not configured' }, 503);
  if (!SUPABASE_URL || !SERVICE) return json({ ok: false, error: 'not configured' }, 503);

  const offered = req.headers.get('x-sweep-secret') ?? '';
  // Length-first, then a constant-time-ish compare over the whole string. This
  // is a scheduled job rather than a login, so the threat is low — but a
  // short-circuiting `===` on a secret is the kind of thing that is only ever
  // noticed after it matters.
  if (offered.length !== SECRET.length || !timingSafeEqual(offered, SECRET)) {
    return json({ ok: false, error: 'refused' }, 401);
  }

  const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString();

  // One statement across every tenant. There is no per-tenant loop and no
  // tenant filter, deliberately: this is not scoped work being done on somebody's
  // behalf, it is housekeeping over one column of one table, and a loop would
  // need a list of tenants — which means reading the tenants table, which means
  // this function starts knowing things it has no reason to know.
  //
  // The `or` is how PostgREST expresses "not already swept" over a NULLABLE
  // column: a plain `.neq` drops rows whose note is null, which is the majority
  // of them and exactly the set that needs sweeping. Without it every nightly
  // run re-updates every stale row the platform has ever accumulated and reports
  // the same growing number for ever.
  const { data, error } = await db
    .from('gym_visits')
    .update({ note: SWEEP_NOTE })
    .is('exited_at', null)
    .lt('entered_at', cutoff)
    .or(`note.is.null,note.neq."${SWEEP_NOTE}"`)
    // The one desk note a sweep may not overwrite. A note beginning
    // `admitted anyway: ` records that the gym admitted somebody against its
    // own record and why a member of staff decided to — see supabase/parts/490
    // and OVERRIDE_PREFIX in src/lib/gymVisits.ts. Every other desk note is
    // worth less than an accurate count of what is still open; this one is not.
    .not('note', 'like', `${OVERRIDE_PREFIX}%`)
    // Only the id. This response ends up in a log; a member id or a name does
    // not belong in one.
    .select('id');

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({
    ok: true,
    swept: (data ?? []).length,
    staleHours: STALE_HOURS,
    cutoff,
    at: new Date().toISOString(),
  });
});

/** Compare two equal-length strings without returning early on the first
 *  difference. Not a substitute for a real MAC, and not pretending to be. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
