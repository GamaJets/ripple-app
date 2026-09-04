#!/usr/bin/env node
// Who may execute it, and who may read it column by column. The half of a
// schema that lives outside the function bodies and the RLS policies.
//
// Two gates in one file, because they are one question asked about the two
// kinds of object and the mistake is identical in both — a part that adds
// something and says nothing about who may reach it.
//
//   §1  EXECUTE on functions, read from supabase/parts/*.sql. Silence hands a
//       SECURITY DEFINER function to `anon`.
//   §2  SELECT and UPDATE on table COLUMNS, read from supabase/setup.sql.
//       Silence makes a new column unreadable to the role that owns the row.
//
// §1 is below; §2 begins at "who may READ it, column by column".
//
// ── §1 ────────────────────────────────────────────────────────────────────
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// Part 1901 closed a real hole: a coach could read any user's profile by
// writing themselves a `coach_clients` row. The fix added a SECURITY DEFINER
// helper, `coach_roster_row_is_earned()`, and granted EXECUTE to
// `authenticated` — which an RLS policy genuinely needs, because a policy
// whose function the querying role may not execute fails the write outright
// rather than falling back to permissive.
//
// What it did not do is REVOKE, and four hours later the same function was
// answering strangers at `/rest/v1/rpc/coach_roster_row_is_earned`. One of its
// three branches does not mention `auth.uid()` —
//
//     not exists (select 1 from public.profiles p where p.id = p_client)
//
// — which is correct for the case it was written for (a coach typing in a
// client who has no account) and, read from outside, is an oracle: pass a
// uuid, and `true` means no such account exists while `false` means one does.
// A SECURITY DEFINER function bypasses RLS by construction, so how well
// `profiles` is otherwise protected does not enter into it.
//
// It was caught by running `get_advisors` AFTER applying. The same sweep found
// seventeen more; part 2050 closed sixteen and left the two that are supposed
// to be public. Nothing in this repository would have caught any of them
// before they were applied: every `scripts/check-*.mjs` was grepped and not one
// looks at EXECUTE grants. `check:definer` is the closest and it enforces `set
// search_path` and nothing else.
//
// ── why silence is the defect ─────────────────────────────────────────────
//
// Postgres grants EXECUTE on a new function to PUBLIC by default, and in a
// Supabase project PUBLIC includes `anon` — the role every unauthenticated
// PostgREST request runs as, using the publishable key compiled into the
// shipped app. So a part that says nothing about grants has not declined to
// decide; it has decided, in favour of everybody.
//
// ── and why a `grant … to authenticated` is not an answer ─────────────────
//
// This is the trap part 1901 fell into and it is the whole reason this gate
// insists on the word `anon`. Supabase ships ALTER DEFAULT PRIVILEGES on
// schema `public` that grants EXECUTE to `anon` and to `authenticated`
// SEPARATELY, on every function as it is created. Part 141's header records
// what that looked like when it was measured live:
//
//     my_tenant_brand and claim_tenant_brand had NO public grant — their part
//     had revoked it — and were still anon-callable … Revoking PUBLIC is not
//     revoking anon.
//
// So `grant execute … to authenticated` adds nothing that was not already
// there, and `revoke … from public` removes a grant that was not the one doing
// the damage. The only statement that settles the question names `anon`.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// For every function created in `supabase/parts/*.sql` that is SECURITY
// DEFINER or `returns trigger`, the ledger must SETTLE whether `anon` may
// execute it. Settled means one of:
//
//   · a `revoke all|execute on function <name>(…) from …` whose role list
//     names `anon`, in that part or any later one;
//   · one of the three ledger-wide dynamic sweeps that revoke from `anon` in a
//     loop — parts 40, 51 and 141 — standing at or after the function's last
//     privilege reset. There is no name in that text to match, so the loop's
//     own selector is read instead, exactly as check-definer.mjs reads the
//     trigger-pinning loops;
//   · a deliberate `grant execute … to anon`, PAIRED with `[anon entry point]`
//     in the function's own `comment on function`. That marker is not invented
//     here: part 141's sweep reads it at runtime off `obj_description` to
//     decide which functions to spare, and `leave_my_details` (part 157) and
//     `public_coach_page` (part 340) are the two that carry it.
//
// Trigger functions are included even when they are SECURITY INVOKER, because
// part 141 §2 states the rule for them without qualification — "trigger
// functions are not callable by anyone" — and because EXECUTE is checked when
// a trigger is CREATED, not each time it fires, so revoking from every role
// costs a trigger function nothing. A trigger function can never be an anon
// entry point, so a grant to `anon` on one is always wrong and the marker does
// not excuse it.
//
// ── what it deliberately does NOT check ───────────────────────────────────
//
// SECURITY INVOKER functions that do not return trigger. `session_span`,
// `is_my_client`, `money_text`, `mark_notifications_read` and about thirty
// others run as the CALLER, so row level security still applies to every table
// they touch and reaching one as `anon` resolves to the same nothing that
// calling the table directly would. Judging them would mean arguing about
// Supabase's intended API surface on every part, which is how a gate acquires
// a `--force`. The escalation this file is about needs `security definer`, and
// that is where the line is drawn.
//
// ── what it cannot see, said plainly ──────────────────────────────────────
//
// It reads the part FILES. It does not connect to anything. A grant made by
// hand in the SQL editor, or by a Supabase migration that never became a part,
// is invisible to it — and that is not hypothetical here: on 4 September 2026
// nine trigger functions held a live `anon` EXECUTE that no part had ever
// mentioned. `npm run check:schema` is the gate that probes the real database;
// `get_advisors` for `security` is the sweep that names the category
// (`anon_security_definer_function_executable`) and both are worth more than
// this file the day something is applied out of band.
//
// The consequence worth stating out loud: this gate goes GREEN the moment a
// revoke is written in a part, which is before that part has been applied.
// A green run means the ledger is complete, not that the database is clean.
//
// Functions are tracked by NAME and not by signature, the same simplification
// check-definer.mjs makes and for the same reason — parsing a Postgres argument
// list well enough to key on it is more machinery than the risk justifies. Two
// overloads of one name are judged together, so a revoke on one would vouch
// for the other. `log_gym_event` is the only overloaded name in this schema and
// both of its overloads are revoked.
//
// It does not read the role list beyond looking for the word `anon`, so
// `revoke all … from anon` and `revoke execute … from public, anon,
// authenticated` count the same. Which roles SHOULD keep EXECUTE is a decision
// the body has to be read to make; that anon is not silently among them is the
// property this closes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PARTS = join(ROOT, 'supabase/parts');

/** The number that orders a part, matching scripts/build-supabase-setup.mjs. */
const partNumber = (f) => Number.parseInt(f, 10);

const files = readdirSync(PARTS)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => partNumber(a) - partNumber(b) || a.localeCompare(b));
assertRootFloors('check:grants', { 'supabase/parts': files.length });

/**
 * Functions whose EXECUTE grants are settled somewhere this repository is not,
 * with the evidence and the count.
 *
 * The ratchet contract check-hundreds.mjs sets out, in full: a file listed at 1
 * fails at 2, and it fails when the count SHRINKS or the entry matches nothing
 * at all. An over-stating list is how a ratchet turns into an ignore list, and
 * a stale entry here caught a real drift the night this was written.
 *
 * ── EMPTY, AND THAT IS THE POINT ──────────────────────────────────────────
 *
 * It held nine when this gate first ran, all of them SECURITY INVOKER trigger
 * functions created after part 141 and so missed by its sweep:
 * body_scan_sheet_consent_names_a_recipient (part 1140),
 * coach_message_templates_touch (250), guard_client_tenant and
 * guard_session_tenant (1062), guard_trainer_tenant (1905),
 * injury_doc_consent_path_is_the_clients (1000), notify_channel_prefs_touch
 * (251), notify_quiet_hours_check (530) and trainer_availability_check (650).
 *
 * They were not a guess. `has_function_privilege('anon', oid, 'EXECUTE')` on
 * the live database returned true for all nine on 4 September 2026 — they are
 * the entire live divergence between these files and that database, and the
 * only functions `anon` can execute besides the two that say they are for
 * anon. None is reachable in practice, because calling a trigger function over
 * RPC raises "trigger functions can only be called as triggers"; all nine are
 * revoked by supabase/parts/2180, on part 2050's argument that a grant nobody
 * needs and nobody wrote reads as deliberate five years later.
 *
 * Kept as an empty Map rather than deleted, because the mechanism below is what
 * makes the next offence recordable without being excused.
 */
const KNOWN = new Map([
]);

/** `create [or replace] function` — the start of a definition. */
const CREATE = /\bcreate\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)/gi;
/** `drop function [if exists] name` — the one thing that RESETS grants. */
const DROP = /\bdrop\s+function\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/gi;
/**
 * A whole `revoke … on function … from …;` statement, and a whole
 * `grant … on function … to …;` one. Both are read for their object list and
 * their role list; the object list is parsed out afterwards, because a single
 * statement may legally name several functions.
 */
const REVOKE = /\brevoke\s+(?:all|execute)\b[^;]*?\bon\s+function\b([^;]*?)\bfrom\b([^;]*);/gi;
const GRANT = /\bgrant\s+(?:all|execute)\b[^;]*?\bon\s+function\b([^;]*?)\bto\b([^;]*);/gi;
/** `public.foo(uuid, text)` inside an object list. Args optional: Postgres lets
 *  them be omitted when the name is unambiguous. */
const OBJECT = /([a-z0-9_."]+)\s*(?:\([^)]*\))?/gi;

/**
 * The dynamic sweeps: parts 40, 51 and 141 revoke in a loop over `pg_proc`
 * rather than by name, so there is no function name in the text to match.
 *
 * The loop's own SELECTOR is read instead — the same technique, for the same
 * reason, as check-definer.mjs's DYNAMIC_TRIGGER_PIN: recognising the shape
 * beats keeping a list of names that would have to be re-derived every time a
 * part is added before 141, with nothing to say so.
 */
const SWEEP_REVOKES_ANON = /revoke\s+(?:all|execute)[^;']*on\s+function\s+%s[^;']*from[^;']*\banon\b/i;
const SWEEP_TAKES_TRIGGERS = /pg_get_function_result\([^)]*\)\s*=\s*'trigger'/i;
const SWEEP_TAKES_FUNCTIONS = /pg_get_function_result\([^)]*\)\s*<>\s*'trigger'/i;

/** Strip `-- …` line comments so a commented-out example cannot trip the scan.
 *  The COMMENT ON text is read from the raw source instead, since that is a
 *  SQL string and not a SQL comment. */
const withoutLineComments = (sql) =>
  sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

/** `public.my_fn` and `"My_Fn"` and `my_fn` are all the same function here. */
const key = (n) => n.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();

/** Every function named in an object list, keyed. */
function objects(list) {
  const out = [];
  OBJECT.lastIndex = 0;
  let m;
  while ((m = OBJECT.exec(list))) {
    const k = key(m[1]);
    if (k && k !== ',') out.push(k);
  }
  return out;
}

/**
 * The `[anon entry point]` marker, read off `comment on function`.
 *
 * The comment body is a single-quoted SQL string with `''` for an apostrophe,
 * and the two that carry this marker are both long prose paragraphs containing
 * apostrophes and full stops. A lazy `[\s\S]*?;` would stop at the first
 * semicolon inside the sentence, so the string is walked properly.
 */
function anonEntryPoints(raw) {
  const found = new Set();
  const HEAD = /\bcomment\s+on\s+function\s+([a-z0-9_."]+)\s*(?:\([^)]*\))?\s*is\s*'/gi;
  let m;
  while ((m = HEAD.exec(raw))) {
    let i = m.index + m[0].length;
    let text = '';
    while (i < raw.length) {
      if (raw[i] === "'") {
        if (raw[i + 1] === "'") { text += "'"; i += 2; continue; }
        break;
      }
      text += raw[i];
      i += 1;
    }
    if (/\[anon entry point\]/i.test(text)) found.add(key(m[1]));
    HEAD.lastIndex = i;
  }
  return found;
}

/* ── the ledger, read in order ────────────────────────────────────────────── */

/**
 * Where a statement sits in the ledger, as one comparable number: the part's
 * position, then the character offset inside it.
 *
 * The offset half is not tidiness. A `revoke … from anon` and a `grant … to
 * anon` in the SAME part are two different decisions and the LAST one is the
 * one that holds, so a key that stopped at the part number would read
 *
 *     revoke all on function f() from public, anon;
 *     grant execute on function f() to anon;
 *
 * as settled — which is the opposite of what that part does. The first draft of
 * this gate did exactly that and passed a scratchpad function it had just
 * handed to anonymous callers.
 */
const seq = (partIdx, offset) => partIdx * 1e9 + offset;

/**
 * key → {
 *   name, file,            the last definition and where it is
 *   judged,                definer or returns trigger, so this gate has a view
 *   isTrigger,
 *   reset,                 seq of the point where its grants last went back to
 *                          the Supabase default — the first create, and any
 *                          create that follows a drop. CREATE OR REPLACE does
 *                          NOT reset privileges, which is why part 2050 can
 *                          settle a function part 1011 created and part 1500
 *                          redefined.
 *   resetFile,
 *   said[],                every statement that spoke about anon, as
 *                          { seq, anon: true|false } — true for a grant TO
 *                          anon, false for a revoke FROM it (or a sweep that
 *                          covers it). The last one after `reset` is the answer.
 *   marked,                carries [anon entry point] in its own comment
 * }
 */
const state = new Map();
const sweeps = [];
let judged = 0;

files.forEach((file, idx) => {
  const raw = readFileSync(join(PARTS, file), 'utf8');
  const sql = withoutLineComments(raw);

  // Creates and drops, in the order they appear, because a drop immediately
  // before a create in the same part is exactly the shape that resets grants.
  const events = [];
  CREATE.lastIndex = 0;
  let m;
  while ((m = CREATE.exec(sql))) {
    // The option list runs from the signature to the `as $tag$` that opens the
    // body — the only place `security definer` and `returns trigger` can be.
    const rest = sql.slice(m.index);
    const body = /\bas\s+\$[a-z_]*\$/i.exec(rest);
    const head = body ? rest.slice(0, body.index) : rest.slice(0, 2000);
    events.push({
      at: m.index,
      kind: 'create',
      k: key(m[1]),
      name: m[1],
      definer: /\bsecurity\s+definer\b/i.test(head),
      trigger: /\breturns\s+trigger\b/i.test(head),
    });
    if (body) CREATE.lastIndex = m.index + body.index + body[0].length;
  }
  DROP.lastIndex = 0;
  while ((m = DROP.exec(sql))) events.push({ at: m.index, kind: 'drop', k: key(m[1]) });
  events.sort((a, b) => a.at - b.at);

  const droppedHere = new Set();
  for (const e of events) {
    if (e.kind === 'drop') { droppedHere.add(e.k); continue; }
    let s = state.get(e.k);
    if (!s) {
      s = { said: [], reset: null };
      state.set(e.k, s);
    }
    s.name = e.name;
    s.file = file;
    s.isTrigger = e.trigger;
    s.judged = e.definer || e.trigger;
    s.why = e.definer ? 'security definer' : 'returns trigger';
    if (s.reset === null || droppedHere.has(e.k)) { s.reset = seq(idx, e.at); s.resetFile = file; }
  }

  REVOKE.lastIndex = 0;
  while ((m = REVOKE.exec(sql))) {
    if (!/\banon\b/i.test(m[2])) continue;      // revoking PUBLIC is not revoking anon
    for (const k of objects(m[1])) state.get(k)?.said.push({ seq: seq(idx, m.index), anon: false });
  }
  GRANT.lastIndex = 0;
  while ((m = GRANT.exec(sql))) {
    if (!/\banon\b/i.test(m[2])) continue;
    for (const k of objects(m[1])) state.get(k)?.said.push({ seq: seq(idx, m.index), anon: true });
  }

  for (const k of anonEntryPoints(raw)) {
    const s = state.get(k);
    if (s) s.marked = idx;
  }

  const sweepAt = SWEEP_REVOKES_ANON.exec(sql);
  if (sweepAt) {
    sweeps.push({
      seq: seq(idx, sweepAt.index),
      file,
      triggers: SWEEP_TAKES_TRIGGERS.test(sql),
      functions: SWEEP_TAKES_FUNCTIONS.test(sql),
    });
  }
});

// A gate that recognised none of the sweeps would report every function
// created before part 141 as an offence, which is 121 false positives and a
// deleted gate. If the shapes stop matching, say so rather than crying wolf.
if (sweeps.length < 3) {
  console.error(`check-grants: matched only ${sweeps.length} of the 3 dynamic revoke sweeps `
    + '(parts 40, 51 and 141). Those loops are what settles every function created before part '
    + '141, and without them this gate would report a hundred false offences. The loop shape has '
    + 'changed; fix SWEEP_REVOKES_ANON in scripts/check-grants.mjs. Refusing to pass.');
  process.exit(1);
}

/* ── the judgement ────────────────────────────────────────────────────────── */

const silent = [];     // nothing in the ledger says who may execute it
const unmarked = [];   // the ledger hands it to anon and the function does not say so

for (const [k, s] of state) {
  if (!s.judged) continue;
  judged += 1;

  // Everything the ledger says about this function's anon grant after the last
  // point the Supabase default reasserted itself, plus the dynamic sweeps that
  // cover its kind. The LAST word is the one that holds.
  const spoken = [
    ...s.said,
    ...sweeps
      .filter((w) => (s.isTrigger ? w.triggers : w.functions))
      .map((w) => ({ seq: w.seq, anon: false })),
  ]
    .filter((w) => w.seq > s.reset)
    .sort((a, b) => a.seq - b.seq);

  if (!spoken.length) { silent.push({ k, ...s }); continue; }
  if (!spoken[spoken.length - 1].anon) continue;

  // Deliberately reachable. Allowed for a real RPC that says so about itself,
  // and never for a trigger function.
  if (s.marked == null || s.isTrigger) unmarked.push({ k, ...s });
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const byFile = new Map();
for (const s of silent) {
  if (!byFile.has(s.resetFile)) byFile.set(s.resetFile, []);
  byFile.get(s.resetFile).push(s);
}

const fresh = [];
for (const [file, hits] of byFile) {
  const allowed = KNOWN.get(file)?.count ?? 0;
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, allowed, total: hits.length })));
}

if (unmarked.length) {
  console.error(`\ncheck-grants — ${unmarked.length} function${unmarked.length === 1 ? '' : 's'} `
    + `the parts hand to \`anon\` without saying so:\n`);
  for (const u of unmarked) {
    console.error(`  ${u.name}\n    granted to anon, last defined in ${u.file}`);
    if (u.isTrigger) {
      console.error('    wrong: it returns trigger. Calling one over RPC raises "trigger functions');
      console.error('           can only be called as triggers", so the grant buys nothing, and');
      console.error('           part 141 §2 revokes trigger functions from every role for that');
      console.error('           reason. There is no such thing as a trigger anon entry point.');
    } else {
      console.error('    right: if it really is a public entry point, say so IN ITS OWN COMMENT —');
      console.error("           `comment on function … is '… [anon entry point] …';` — because part");
      console.error("           141's sweep reads that marker off obj_description() at runtime to");
      console.error('           decide what to spare. Without it the next standalone re-run of 141');
      console.error('           revokes the grant and the feature goes quiet without an error.');
      console.error('           supabase/parts/157 and /340 are the two worked examples.');
    }
    console.error('');
  }
  process.exit(1);
}

if (fresh.length) {
  fresh.sort((a, b) => partNumber(a.resetFile) - partNumber(b.resetFile) || (a.k < b.k ? -1 : 1));
  console.error(`\ncheck-grants — ${fresh.length} function${fresh.length === 1 ? '' : 's'} `
    + `in supabase/parts ${fresh.length === 1 ? 'is' : 'are'} created and never told who may `
    + 'execute them:\n');
  for (const f of fresh) {
    if (f.allowed) console.error(`  (${f.resetFile} is on the ratchet at ${f.allowed}; it now has ${f.total})`);
    console.error(`  ${f.name}  (${f.why})\n    created in ${f.resetFile}`);
  }
  console.error(
    '\nSaying nothing is not declining to decide. Postgres grants EXECUTE on a new function'
    + '\nto PUBLIC, and Supabase\'s stock ALTER DEFAULT PRIVILEGES on schema `public` grants it'
    + '\nto `anon` and `authenticated` separately on top — so an unrevoked function is live at'
    + '\n/rest/v1/rpc/<name> for anybody holding the publishable key that ships in the app. A'
    + '\nSECURITY DEFINER function bypasses RLS by construction, so how well its tables are'
    + '\nprotected does not enter into it.'
    + '\n\n  right: in the same part, under the function —'
    + '\n\n           revoke all on function public.name(args) from public, anon;'
    + '\n           grant execute on function public.name(args) to authenticated;'
    + '\n\n         Keep the grant if an RLS policy calls it: a policy whose function the querying'
    + '\n         role may not execute fails the write outright. The grant alone is NOT enough —'
    + "\n         that is precisely what part 1901 did. `revoke … from public` alone is not enough"
    + '\n         either; part 141 measured two functions that had no PUBLIC grant and were still'
    + '\n         anon-callable. The statement has to name `anon`.'
    + '\n\n         A trigger function is revoked from all three, as part 141 §2 does: EXECUTE is'
    + '\n         checked when the trigger is created, not when it fires, so it costs nothing.'
    + '\n\n         supabase/parts/2050 is the worked example, and supabase/parts/2180 is the'
    + '\n         smaller one.\n',
  );
  process.exit(1);
}

/* A ratchet entry that has gone quiet is either work somebody did or a scan
 * that never opened the file, and the two must not print the same sentence. */
const onDisk = new Set(files);
const unscanned = [];
const drifted = [];
for (const [file, entry] of KNOWN) {
  const n = byFile.get(file)?.length ?? 0;
  if (n >= entry.count) continue;
  if (!onDisk.has(file)) unscanned.push(file);
  else drifted.push({ file, was: entry.count, now: n });
}

if (unscanned.length) {
  console.error('\ncheck-grants: parts this gate is tracking are not in supabase/parts any more, '
    + 'so its "ok" would be a claim about a ledger it did not read:\n');
  for (const f of unscanned) console.error(`  ${f}`);
  console.error('\nA part has been renamed or removed. Parts are an applied ledger and are not '
    + 'meant to move; find out what happened before changing the list.\n');
  process.exit(1);
}

if (drifted.length) {
  console.error('\ncheck-grants — the ratchet in scripts/check-grants.mjs over-states what is '
    + 'still open:\n');
  for (const d of drifted) {
    console.error(`  ${d.file}: listed at ${d.was}, now has ${d.now}. `
      + `${d.now === 0 ? 'Delete the entry.' : `Lower the count to ${d.now}.`}`);
  }
  console.error('\nA list that names something already fixed is how a ratchet becomes an ignore '
    + 'list, and a stale entry is how it quietly stops describing the tree.\n');
  process.exit(1);
}

/* ══ §2 ─ who may READ it, column by column ═══════════════════════════════ */
//
// ── the bug this half exists for ──────────────────────────────────────────
//
// `public.trainers` does not grant SELECT to `authenticated` table-wide. It
// grants it COLUMN BY COLUMN — part 131 revoked the table-level grant on
// purpose, because in PostgreSQL a table-level SELECT supersedes a column
// revoke and there was no other way to keep `join_code` off the directory.
//
// Part 191 then added `trial_started_at` with `alter table … add column` and
// wrote no grant. Adding a column to a table whose SELECT is column-level does
// not extend the grant to it, so the column existed and nobody could read it.
// PostgREST answers a request that names a column the role holds no grant on
// with 403, before RLS is consulted at all — this is a privilege check and the
// row is not the question.
//
// Measured on 4 September 2026 against project phgfwzpkkwdysftlgkoq, one
// second apart, same row, same session, same policy:
//
//     GET /rest/v1/trainers?select=session_fee,delivery_mode&id=eq.<uid>  200
//     GET /rest/v1/trainers?select=trial_started_at&id=eq.<uid>&limit=1   403
//
// 29 of 29 `select=trial_started_at` requests in the last 24 hours of edge
// logs were 403, and it was the only REST 403 in that window. So this was not
// intermittent and not one coach: every coach's trial read had failed, every
// time, for as long as the column had existed.
//
// ── why nothing else could see it ─────────────────────────────────────────
//
// The app handled the refusal CORRECTLY at every layer, which is exactly why
// nobody found it. src/ui/trialAccount.ts checks `.error` first and answers
// 'error' rather than 'no start date'; src/lib/trialGate.ts prints the note for
// an unread account rather than an expired trial; app/(trainer)/billing.tsx
// renders that note. The sentence the coach read — "when your trial started
// could not be read" — was TRUE. A defect whose every layer behaves well
// produces no stack trace, no report and no bad screenshot.
//
// `scripts/check-schema.mjs` compares COLUMNS, not grants, so a column that
// exists and cannot be read looks identical to one that works. `check:reads`
// reads the app's selects and not the ledger's grants. Nothing in this
// repository related the two, and the only signals were a status code and the
// grants themselves.
//
// ── and it had already happened once ──────────────────────────────────────
//
// Part 151's header is the same defect, found the same way and eight months
// earlier: part 126 added `late_cancel_applies`, `late_cancel_notice_hours`
// and `late_cancel_fee`, part 131 enumerated the grant FIVE FILES LATER and
// missed all three, and the coach's cancellation-policy editor was refused
// 42501 until somebody opened that screen. 151 records the asymmetry that
// makes it worse than it sounds: 131 left INSERT and UPDATE alone, so the
// screen could not READ the stored policy and could still overwrite it with
// the defaults its hook falls back to on a failed read.
//
// Twice is a class, not an accident, and the shape is always the same — a
// column added by a later part to a table whose grant is an enumeration
// written by an earlier one.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// For every (table, role) where the role's SELECT or UPDATE on that table is
// COLUMN-LEVEL rather than table-wide, every column the table has must be
// named in some grant to that role, or carry a `grant-ok:` marker saying why
// it is deliberately withheld.
//
// The union across privileges is deliberate, and it is what keeps this gate
// from arguing about narrow UPDATE grants. `trial_started_at` is granted
// SELECT and NOT UPDATE, on purpose — part 191's trigger makes it immutable
// and the grant is the second lock. A rule stated per privilege would demand
// an escape marker for every column a role may read and not write, which is
// most of them. The question this asks is the one the defect answers to: is
// there a column of this table that this role was never given ANY access to,
// while holding a hand-written list of the others.
//
// A role that holds table-wide SELECT is not asked. A new column is readable
// the moment it exists, so the failure this is about cannot occur; which
// columns that role may WRITE stays a decision for the part to make.
//
// ── what it deliberately does NOT check ───────────────────────────────────
//
// INSERT. A column-level INSERT grant is narrow by construction — you do not
// grant `created_at`, or an id with a default, or a status the trigger sets —
// so "every column must appear" is the wrong sentence for it and would need an
// escape marker per defaulted column on every table in the schema.
//
// Whether the granted columns are the RIGHT ones. This cannot tell that a
// coach should not be able to read some column; it can only tell that a
// column was passed over in silence. Widening a grant to shut it up is
// therefore a real risk, and the two right answers are named in the failure
// text: grant the column, or say why not.
//
// ── what it cannot see, said plainly ──────────────────────────────────────
//
// The same limit as the half above. It reads supabase/setup.sql — generated
// from supabase/parts/ and checked by `db:check` — and connects to nothing. A
// grant made by hand in the SQL editor is invisible to it, in both directions:
// it will report a column that is actually granted, and it will pass a column
// that is actually refused. `npm run check:schema` is the gate that probes the
// real database. Going green here means the ledger is complete, not that the
// database is.
//
// It reads setup.sql rather than the parts because a grant is only meaningful
// in the order it is applied, and setup.sql IS that order — one file, one
// pass, with the same statement sequence Postgres saw.

const SETUP = join(ROOT, 'supabase/setup.sql');
const setupSql = readFileSync(SETUP, 'utf8');

/**
 * Everything that is not code, blanked to spaces, keeping every newline and
 * every offset so a finding can still name a line.
 *
 * This is a scanner and not three regex passes, and that is not fastidiousness.
 * The first draft blanked line comments, then string literals, and setup.sql
 * contains comment prose with apostrophes AND string literals containing `--`.
 * Each pass broke the other's quoting: 17,015 lines went missing and the gate
 * reported `trainers` as having 16 columns and passed. One left-to-right pass
 * that knows which of the four states it is in is the only version that can be
 * right, because that is what the server does.
 */
function blankNonCode(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '-' && src[i + 1] === '-') {                     // line comment
      let e = src.indexOf('\n', i);
      if (e === -1) e = src.length;
      blank(i, e); i = e; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {                     // block comment, nestable
      let depth = 0; let k = i;
      while (k < src.length) {
        if (src[k] === '/' && src[k + 1] === '*') { depth += 1; k += 2; continue; }
        if (src[k] === '*' && src[k + 1] === '/') { depth -= 1; k += 2; if (!depth) break; continue; }
        k += 1;
      }
      blank(i, k); i = k; continue;
    }
    if (ch === "'") {                                           // string, '' escapes a quote
      let k = i + 1;
      while (k < src.length) {
        if (src[k] !== "'") { k += 1; continue; }
        if (src[k + 1] === "'") { k += 2; continue; }
        k += 1; break;
      }
      blank(i, k); i = k; continue;
    }
    if (ch === '"') {                                           // quoted identifier — KEPT
      let k = i + 1;
      while (k < src.length) {
        if (src[k] !== '"') { k += 1; continue; }
        if (src[k + 1] === '"') { k += 2; continue; }
        k += 1; break;
      }
      i = k; continue;
    }
    if (ch === '$') {                                           // dollar-quoted body
      const tag = /^\$(?:[a-z_][a-z0-9_]*)?\$/i.exec(src.slice(i, i + 64));
      if (tag) {
        const close = src.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? src.length : close + tag[0].length;
        blank(i, end); i = end; continue;
      }
    }
    i += 1;
  }
  return out.join('');
}

const code = blankNonCode(setupSql);
if (code.length !== setupSql.length) {
  console.error('check-grants: the setup.sql scanner changed the length of the file, so every '
    + 'offset it reports is wrong. Fix blankNonCode in scripts/check-grants.mjs.');
  process.exit(1);
}

/** `public.trainers`, `"Trainers"` and `trainers` are one table here. */
const tkey = (n) => n.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
const lineAt = (off) => code.slice(0, off).split('\n').length;

/** Statements, with the offset each one starts at. */
const stmts = [];
{
  let start = 0;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== ';') continue;
    stmts.push({ at: start, text: code.slice(start, i) });
    start = i + 1;
  }
  if (code.slice(start).trim()) stmts.push({ at: start, text: code.slice(start) });
}

/** Split on commas that are not inside parentheses — a type like `numeric(5,1)`
 *  and a column list like `(a, b)` both have to survive this. */
const commaSplit = (s) => {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
};
/** The parenthesised group starting at or after `from`, balanced. */
const groupAfter = (s, from) => {
  const open = s.indexOf('(', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') { depth -= 1; if (!depth) return { open, close: i }; }
  }
  return null;
};

const TABLE_CREATE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)\s*\(/i;
const TABLE_ALTER = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)([\s\S]*)$/i;
/** A table-constraint clause, which sits in the same comma list as a column. */
const NOT_A_COLUMN = /^(constraint|primary|unique|foreign|check|exclude|like)$/i;

const TABLE_GRANT = /\bgrant\s+([\s\S]*?)\s+on\s+(?:table\s+)?([\s\S]*?)\s+to\s+([\s\S]*)$/i;
const TABLE_REVOKE = /\brevoke\s+(?:grant\s+option\s+for\s+)?([\s\S]*?)\s+on\s+(?:table\s+)?([\s\S]*?)\s+from\s+([\s\S]*)$/i;
/** An object list this half has no view on: it is not a table. */
const NOT_A_TABLE = /^(function|procedure|routine|schema|sequence|database|domain|type|language|tablespace|foreign|large|all)\b/i;

/** table → Map(column → offset it was added at). */
const tableColumns = new Map();
/** Tables whose `create table` this actually read. A grant on anything else is
 *  a table whose columns cannot be enumerated, and is refused rather than passed. */
const createdTables = new Set();
const addColumn = (t, c, at) => {
  const cols = tableColumns.get(t) ?? new Map();
  if (!cols.has(c)) cols.set(c, at);
  tableColumns.set(t, cols);
};

/**
 * `${table} ${role}` → what that role holds, per privilege.
 *
 * `mode` is 'none', 'table' (table-wide, so every column present and future),
 * or 'columns' (a hand-written enumeration). Statements are applied in file
 * order, which is apply order, so the last word holds — with one asymmetry
 * that is Postgres's and not this file's: a column-level REVOKE against a
 * table-level GRANT does nothing. Part 131 proved that live, twice, and the
 * whole column-by-column arrangement on `trainers` exists because of it.
 */
const holds = new Map();
const holding = (t, r) => {
  const k = `${t} ${r}`;
  let h = holds.get(k);
  if (!h) {
    h = { table: t, role: r, priv: { select: { mode: 'none', cols: new Set() }, update: { mode: 'none', cols: new Set() } } };
    holds.set(k, h);
  }
  return h;
};

for (const st of stmts) {
  const text = st.text;

  let m = TABLE_CREATE.exec(text);
  if (m) {
    const t = tkey(m[1]);
    createdTables.add(t);
    if (!tableColumns.has(t)) tableColumns.set(t, new Map());
    const g = groupAfter(text, m.index);
    if (g) {
      for (const item of commaSplit(text.slice(g.open + 1, g.close))) {
        const word = item.trim().split(/\s+/)[0];
        if (word && !NOT_A_COLUMN.test(word)) addColumn(t, tkey(word), st.at);
      }
    }
    continue;
  }

  // `alter default privileges … grant/revoke … on tables …` names no table and
  // must not be read as one.
  if (/\balter\s+default\s+privileges\b/i.test(text)) continue;

  m = TABLE_ALTER.exec(text);
  if (m) {
    const t = tkey(m[1]);
    for (const action of commaSplit(m[2])) {
      const a = action.trim();
      let g = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/i.exec(a);
      if (g && !NOT_A_COLUMN.test(g[1])) { addColumn(t, tkey(g[1]), st.at); continue; }
      g = /^drop\s+(?:column\s+)?(?:if\s+exists\s+)?([a-z0-9_."]+)/i.exec(a);
      if (g && !NOT_A_COLUMN.test(g[1])) { tableColumns.get(t)?.delete(tkey(g[1])); continue; }
      g = /^rename\s+column\s+([a-z0-9_."]+)\s+to\s+([a-z0-9_."]+)/i.exec(a);
      if (g) {
        const cols = tableColumns.get(t);
        if (cols?.has(tkey(g[1]))) { const at = cols.get(tkey(g[1])); cols.delete(tkey(g[1])); cols.set(tkey(g[2]), at); }
      }
    }
    continue;
  }

  for (const [RE, giving] of [[TABLE_GRANT, true], [TABLE_REVOKE, false]]) {
    const g = RE.exec(text);
    if (!g) continue;
    const objects = g[2].trim();
    if (NOT_A_TABLE.test(objects)) break;
    const tables = objects.split(',').map((o) => tkey(o.trim())).filter((o) => /^[a-z0-9_.]+$/.test(o));
    const roles = g[3].split(',')
      .map((r) => r.replace(/\b(cascade|restrict|with\s+grant\s+option|group)\b/gi, '').trim().toLowerCase())
      .filter(Boolean);
    if (!tables.length || !roles.length) break;

    for (const item of commaSplit(g[1])) {
      const priv = item.trim().split(/[\s(]/)[0].toLowerCase();
      const group = item.includes('(') ? groupAfter(item, 0) : null;
      const named = group
        ? item.slice(group.open + 1, group.close).split(',').map((c) => tkey(c.trim())).filter(Boolean)
        : null;
      // `all` and `all privileges` are table-wide by definition; they cannot
      // carry a column list.
      for (const p of priv === 'all' ? ['select', 'update'] : [priv]) {
        if (p !== 'select' && p !== 'update') continue;
        for (const t of tables) {
          for (const r of roles) {
            const s = holding(t, r).priv[p];
            if (giving && !named) { s.mode = 'table'; s.cols.clear(); }
            else if (giving) { if (s.mode !== 'table') s.mode = 'columns'; for (const c of named) s.cols.add(c); }
            else if (!named) { s.mode = 'none'; s.cols.clear(); }
            else if (s.mode === 'columns') for (const c of named) s.cols.delete(c);
          }
        }
      }
    }
    break;
  }
}

/**
 * `grant-ok: public.trainers.join_code — <why>`, read off the RAW file because
 * it lives in a SQL comment.
 *
 * Same contract as every other `…-ok:` marker in scripts/: it names the thing
 * it excuses, and a marker with no reason after it does not count. The reason
 * is the whole value — a bare marker is an ignore list with extra steps, and
 * the two this schema legitimately needs both had their reason written in
 * English years before there was anything to read it.
 *
 * The reason has to START on the marker's own line, and `[ \t]*` rather than
 * `\s*` is what says so. The first draft used `\s*`, which crosses a newline,
 * so a bare `-- grant-ok: public.trainers.join_code` quietly borrowed the
 * continuation comment underneath it as its reason and passed. Wrapping onto
 * the following lines is fine; beginning there is not.
 */
const WITHHELD_MARKER = /grant-ok:[ \t]*([a-z0-9_."]+)\.([a-z0-9_"]+)[ \t]*([^\n]*)/gi;
const withheld = new Map();       // `${table}.${column}` → { reason, line }
const reasonless = [];
{
  let m;
  while ((m = WITHHELD_MARKER.exec(setupSql))) {
    const reason = m[3].replace(/^[\s:—–-]+/, '').trim();
    const at = `${tkey(m[1])}.${tkey(m[2])}`;
    const line = setupSql.slice(0, m.index).split('\n').length;
    if (reason.length < 20) { reasonless.push({ at, line }); continue; }
    withheld.set(at, { reason, line });
  }
}

/* ── the judgement ────────────────────────────────────────────────────────── */

const ungranted = [];     // a column of a column-granted table nobody named
const opaque = [];        // a column-level grant on a table we could not enumerate
const consulted = new Set();
let columnLevel = 0;

for (const h of [...holds.values()].sort((a, b) => (a.table === b.table ? (a.role < b.role ? -1 : 1) : (a.table < b.table ? -1 : 1)))) {
  const modes = [h.priv.select.mode, h.priv.update.mode];
  if (modes.includes('table')) continue;      // table-wide reader: a new column is readable
  if (!modes.includes('columns')) continue;   // holds nothing here
  columnLevel += 1;

  if (!createdTables.has(h.table)) { opaque.push(h); continue; }

  const named = new Set([...h.priv.select.cols, ...h.priv.update.cols]);
  const all = tableColumns.get(h.table) ?? new Map();
  for (const [col, at] of all) {
    if (named.has(col)) continue;
    const mark = withheld.get(`${h.table}.${col}`);
    if (mark) { consulted.add(`${h.table}.${col}`); continue; }
    ungranted.push({ table: h.table, role: h.role, col, addedLine: lineAt(at) });
  }
}

// A parse that finds nothing would print "ok" about a file it did not
// understand, and this half has no ratchet to notice that for it.
if (createdTables.size < 100 || columnLevel < 1) {
  console.error('\ncheck-grants: the setup.sql pass found '
    + `${createdTables.size} tables and ${columnLevel} column-level grant${columnLevel === 1 ? '' : 's'}, `
    + 'which is too few to be a reading of this schema — it held 159 and 2 on 4 September 2026. '
    + 'Whatever it is about to say would be a claim about a file it did not parse. The statement '
    + 'shapes have changed; fix the §2 half of scripts/check-grants.mjs rather than the floor.\n');
  process.exit(1);
}

if (reasonless.length) {
  console.error(`\ncheck-grants — ${reasonless.length} \`grant-ok:\` marker${reasonless.length === 1 ? '' : 's'} `
    + 'with no reason:\n');
  for (const r of reasonless) console.error(`  supabase/setup.sql:${r.line}  ${r.at}`);
  console.error('\nThe reason IS the marker. Withholding a column from a role is a decision '
    + '\nsomebody has to be able to disagree with in five years, and "grant-ok" on its own is'
    + '\nan ignore list. Write the sentence:'
    + '\n\n  -- grant-ok: public.trainers.join_code — handed out through my_join_code(); a grant'
    + '\n  --   here would put it back on the directory, which is what part 131 took it off.\n');
  process.exit(1);
}

if (opaque.length) {
  console.error('\ncheck-grants — a column-level grant on a table this gate could not enumerate:\n');
  for (const o of opaque) console.error(`  ${o.table} (to ${o.role})`);
  console.error('\nIts `create table` is not in supabase/setup.sql, so "every column is granted" '
    + 'is not something this can\ncheck — and passing quietly is how the column-level half stops '
    + 'covering a table without saying so.\n');
  process.exit(1);
}

if (ungranted.length) {
  console.error(`\ncheck-grants — ${ungranted.length} column${ungranted.length === 1 ? '' : 's'} `
    + `${ungranted.length === 1 ? 'is' : 'are'} on a table whose grant is written out column by `
    + 'column, and in no grant at all:\n');
  for (const u of ungranted) {
    console.error(`  public.${u.table}.${u.col}  —  ${u.role} holds no grant naming it`);
    console.error(`    added at supabase/setup.sql:${u.addedLine}`);
  }
  console.error(
    '\nThis role\'s SELECT on that table is COLUMN-LEVEL, so adding a column does not extend the'
    + '\ngrant to it. PostgREST answers a request that names a column the role may not read with'
    + '\n403 — before RLS, because it is a privilege check and the row is not the question — so'
    + '\nevery `select=<column>` this appears in has been refused since the column existed, for'
    + '\nevery user of that role.'
    + '\n\n  right: in the part that adds the column, under the `alter table` —'
    + '\n\n           grant select (name) on public.table to authenticated;'
    + '\n\n         Only the privileges the column actually needs. A column that a trigger keeps'
    + '\n         immutable gets SELECT and not UPDATE, which is what part 2200 does for'
    + '\n         `trial_started_at` and why the check above unions the two rather than asking'
    + '\n         them separately.'
    + '\n\n         NOT `grant select on public.table to authenticated`. A table-wide grant issued'
    + '\n         to fix one column supersedes every column revoke on that table, and hands over'
    + '\n         the columns the enumeration existed to keep back. Part 131 tried the reverse of'
    + '\n         that and recorded the result: a column-level revoke against a table-level grant'
    + '\n         reports success and changes nothing.'
    + '\n\n  or:    if it is meant to be unreadable, say so where the schema can be read —'
    + '\n\n           -- grant-ok: public.table.column — <why this role must not read it>'
    + '\n\n         supabase/parts/139 and /2200 are the two worked examples.'
    + '\n\n         Do not widen a grant to silence this. The two answers are grant the column or'
    + '\n         write the sentence; there is no third one that leaves the question open.'
    + '\n\nThis has happened twice already and looked like something else both times: part 151'
    + '\n(a policy editor that could not load and could still save over itself) and part 2200'
    + '\n(every coach on the platform told their trial start date could not be read).\n',
  );
  process.exit(1);
}

/* A marker that excuses nothing is the same failure as a ratchet entry that
 * names something already fixed: it stops describing the tree, and the next
 * person reads it as a live decision. */
const staleMarkers = [...withheld].filter(([at]) => !consulted.has(at));
if (staleMarkers.length) {
  console.error(`\ncheck-grants — ${staleMarkers.length} \`grant-ok:\` marker${staleMarkers.length === 1 ? '' : 's'} `
    + 'excusing nothing:\n');
  for (const [at, mark] of staleMarkers) {
    console.error(`  supabase/setup.sql:${mark.line}  ${at}`);
  }
  console.error('\nEither the column is granted now, or it no longer exists, or the table\'s grant '
    + 'became table-wide.\nIn all three the marker is a sentence about the schema that is no longer '
    + 'true, and it reads as a\nlive decision to whoever finds it next. Delete it.\n');
  process.exit(1);
}

const marked = [...state.values()].filter((s) => s.marked != null).map((s) => s.name);
const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(
  `check-grants — ok, ${judged} definer and trigger function${judged === 1 ? '' : 's'} across `
  + `${files.length} parts all say who may execute them`
  + (marked.length ? `; ${marked.length} deliberate anon entry point${marked.length === 1 ? '' : 's'} (${marked.join(', ')})` : '')
  + `; ${sweeps.length} dynamic sweeps recognised`
  + (backlog ? `; ${backlog} known and ratcheted` : ''),
);
console.log(
  `check-grants — ok, ${columnLevel} table/role pair${columnLevel === 1 ? '' : 's'} grant columns `
  + `one by one across ${createdTables.size} tables, and name every column those tables have`
  + (withheld.size
    ? `; ${withheld.size} deliberately withheld (${[...withheld.keys()].join(', ')})`
    : ''),
);
