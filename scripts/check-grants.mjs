#!/usr/bin/env node
// Who may execute it. The half of a SECURITY DEFINER function that lives
// outside its body.
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

const marked = [...state.values()].filter((s) => s.marked != null).map((s) => s.name);
const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(
  `check-grants — ok, ${judged} definer and trigger function${judged === 1 ? '' : 's'} across `
  + `${files.length} parts all say who may execute them`
  + (marked.length ? `; ${marked.length} deliberate anon entry point${marked.length === 1 ? '' : 's'} (${marked.join(', ')})` : '')
  + `; ${sweeps.length} dynamic sweeps recognised`
  + (backlog ? `; ${backlog} known and ratcheted` : ''),
);
