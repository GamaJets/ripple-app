#!/usr/bin/env node
// A function that runs as its owner and resolves names as its caller.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// This schema has 250 SECURITY DEFINER functions. A definer function runs with
// its OWNER's rights, which here is `postgres`, which means it does not see row
// level security at all. For a multi-tenant product that is the whole point —
// `is_owner_of()` and `staff_tenant_of()` have to be able to answer questions
// about rows the caller cannot read, or the policies built on them would
// recurse. It is also the reason the body of a definer function is
// the only thing standing between one gym and another's data.
//
// `search_path` is the part of that which is not in the body. A function with
// no `search_path` of its own resolves every unqualified name — every table,
// every operator, every cast — against whatever the CALLER has set, and
// `search_path` is an ordinary session GUC that any PostgREST client can set.
// So an unpinned definer function is a body somebody else gets to finish:
//
//     set search_path = attacker_schema, public;
//     select public.some_unpinned_definer_function();
//
// and every `from clients` inside it reads `attacker_schema.clients`, as
// `postgres`, with RLS off. That is not a data leak, it is arbitrary execution
// with the owner's rights. It is the reason Supabase's own linter raises
// `function_search_path_mutable` and the reason every one of the 250 already
// carries `set search_path`.
//
// ── why a gate ────────────────────────────────────────────────────────────
//
// Because it holds today and nothing keeps it holding. It was checked function
// by function against `pg_proc.proconfig` on 4 September 2026 and the count was
// 250 of 250 — but that is a fact about a database at a moment, established by
// somebody who happened to look. The 251st definer function is written in a
// part file by somebody who is thinking about a booking rule, and the only
// thing that would catch a missing `set search_path` is the Supabase advisor,
// after it is applied, if anybody runs it.
//
// Eight SECURITY INVOKER functions were unpinned when this was written and part
// 1902 pins them, so the rule this gate enforces has no exceptions to remember:
// EVERY function created in `supabase/parts/**` sets a search_path, definer or
// not. Invoker functions do not carry the escalation risk — they run as the
// caller and RLS still applies — but a rule with a carve-out is a rule people
// mis-apply, and "every function pins its path" is one sentence.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// Every `create [or replace] function` in `supabase/parts/*.sql` must carry a
// `set search_path` before its body delimiter. The body delimiter is the
// `as $…$` that opens the function source; everything between the signature and
// it is the option list, which is where `set search_path`, `security definer`,
// `language` and `stable` all live, and the only place a `set` clause is legal.
//
// It judges the EFFECTIVE definition, meaning the one in the highest-numbered
// part, because that is the one the built schema ends on. This matters and is
// not theory: `is_owner_of()` is first created unpinned in part 02 and
// redefined with a pin in part 28, and a gate reading the first
// definition would demand a change to a part that is already superseded — and
// parts are an applied ledger, so the only way to satisfy it would be to edit
// history. `alter function … set search_path` in a later part counts the same
// way, which is how part 1902 pins the eight that were still open.
//
// Functions are tracked by NAME, not by full signature. Two overloads of one
// name are therefore judged together, so a pinned overload would vouch for an
// unpinned one added later under the same name. Parsing a Postgres argument
// list well enough to key on it is more machinery than the risk justifies —
// the two overloads in this schema (`log_gym_event`) are both pinned — but it
// is the gate's one real blind spot inside the files it does read.
//
// ── what this cannot check, said plainly ──────────────────────────────────
//
// It reads the part FILES, not the database. A function created outside this
// repo — by hand in the SQL editor, or by a Supabase migration that never
// became a part — is invisible to it. That is the same blind spot every gate in
// this directory has and the reason `npm run check:schema` probes the live
// catalogue separately. What this guarantees is that the repo cannot be the
// source of an unpinned function.
//
// It also does not check the VALUE. `set search_path to 'public', 'pg_temp'` is
// what all 250 use and what a new one should use, but a part that pinned it to
// something else would pass. Pinning it at all is the property that closes the
// hole; which schemas are on the list is a decision the body has to be read to
// judge.
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
assertRootFloors('check:definer', { 'supabase/parts': files.length });

/**
 * Functions whose pin is real but is not in this repo, with the evidence.
 *
 * A ratchet, in the sense check-sql-caps uses the word: it is allowed to
 * shrink and it fails if it over-states, because a list that names something
 * already fixed is how a ratchet turns into an ignore list.
 */
const PINNED_ELSEWHERE = {
  // Live `pg_proc.proconfig` on 4 Sep 2026 reads `search_path=public, pg_temp`,
  // and no part sets it: part 02 creates it without one, nothing redefines it,
  // and the two dynamic sweeps below only touch functions that return trigger.
  // So somebody pinned it by hand, outside the ledger, and the live catalogue is
  // ahead of these files. Named here rather than pinned again in a new part,
  // because writing DDL to reproduce a state the database is already in would
  // put a statement in the ledger that has never been the thing that made it
  // true. `npm run check:schema` is what compares this repo to the live schema.
  is_my_client: 'pinned live outside the parts ledger; see check:schema',
};

/** `create [or replace] function` — the start of a definition. */
const CREATE = /\bcreate\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)/gi;
/** `alter function foo(...) … set search_path` — pins one that already exists. */
const ALTER_PIN = /\balter\s+function\s+([a-z0-9_."]+)[\s\S]{0,400}?\bset\s+search_path\b/gi;
/**
 * Parts 51 and 141 pin in a loop rather than by name:
 *
 *     for r in select p.oid::regprocedure as sig … where
 *                pg_get_function_result(p.oid) = 'trigger' and p.proconfig is null
 *     loop execute format('alter function %s set search_path = …', r.sig);
 *
 * There is no name in that text to match, so the gate reads the loop's own
 * condition instead: a part shaped like this pins every trigger function that
 * exists by the time it runs. Recognising the shape beats listing the names,
 * because the list would have to be re-derived every time a part is added
 * before 141 and nothing would say so.
 */
const DYNAMIC_TRIGGER_PIN = /alter\s+function\s+%s\s+set\s+search_path/i;
const TRIGGER_SELECTOR = /pg_get_function_result\([^)]*\)\s*=\s*'trigger'/i;

/** Strip `-- …` line comments so a commented-out example cannot trip the scan. */
function withoutLineComments(sql) {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

/** `public.my_fn` and `"My_Fn"` and `my_fn` are all the same function here. */
const key = (n) => n.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();

/** function name → the last thing any part said about its search_path. */
const state = new Map();
let created = 0;
let pinnedByAlter = 0;

for (const f of files) {
  const sql = withoutLineComments(readFileSync(join(PARTS, f), 'utf8'));

  CREATE.lastIndex = 0;
  let m;
  while ((m = CREATE.exec(sql))) {
    created += 1;
    // The option list runs from the signature to the `as $tag$` that opens the
    // body. A dollar-quoted body is the only form used in this repo.
    const rest = sql.slice(m.index);
    const body = /\bas\s+\$[a-z_]*\$/i.exec(rest);
    const head = body ? rest.slice(0, body.index) : rest.slice(0, 2000);
    state.set(key(m[1]), {
      file: f,
      name: m[1],
      pinned: /\bset\s+search_path\b/i.test(head),
      isTrigger: /\breturns\s+trigger\b/i.test(head),
    });
    if (body) CREATE.lastIndex = m.index + body.index + body[0].length;
  }

  ALTER_PIN.lastIndex = 0;
  while ((m = ALTER_PIN.exec(sql))) {
    pinnedByAlter += 1;
    const prior = state.get(key(m[1]));
    // An alter in a LATER part pins whatever the create left open. An alter for
    // a function this repo never creates is somebody else's function; ignored.
    if (prior) state.set(key(m[1]), { ...prior, pinned: true });
  }

  // The loop form: pins every trigger function standing when this part runs.
  if (DYNAMIC_TRIGGER_PIN.test(sql) && TRIGGER_SELECTOR.test(sql)) {
    for (const [k, s] of state) if (s.isTrigger) state.set(k, { ...s, pinned: true });
  }
}

const unpinned = [...state.values()]
  .filter((s) => !s.pinned && !PINNED_ELSEWHERE[key(s.name)]);

// The ratchet may shrink and may not over-state.
const stale = Object.keys(PINNED_ELSEWHERE).filter((k) => state.get(k)?.pinned);
if (stale.length) {
  console.error(
    `\ncheck-definer — ${stale.length} PINNED_ELSEWHERE entr${stale.length === 1 ? 'y is' : 'ies are'} `
    + 'out of date: a part now pins it and the list still names it.\n',
  );
  for (const k of stale) console.error(`  ${k}: delete the entry from scripts/check-definer.mjs.`);
  console.error('\nA list that over-states what is unfixed is how a ratchet becomes an ignore list.\n');
  process.exit(1);
}

if (unpinned.length) {
  console.error(
    `\ncheck-definer — ${unpinned.length} function definition${unpinned.length === 1 ? '' : 's'} `
    + `in supabase/parts ${unpinned.length === 1 ? 'does' : 'do'} not pin a search_path:\n`,
  );
  for (const u of unpinned) console.error(`  ${u.name}\n    last defined in ${u.file}`);
  console.error(
    '\nAn unpinned function resolves every unqualified table name against whatever'
    + '\nsearch_path the CALLER set, and search_path is a session setting any PostgREST'
    + '\nclient can change. For a SECURITY DEFINER function that is not a leak, it is'
    + '\narbitrary execution as postgres with row level security switched off.'
    + '\n\n  right: add the option every other function in this schema carries —'
    + "\n\n           set search_path to 'public', 'pg_temp'"
    + '\n\n         between the signature and the `as $$` that opens the body. To pin a'
    + '\n         function that already exists without rewriting it, `alter function'
    + "\n         name(args) set search_path to 'public', 'pg_temp';` also satisfies this"
    + '\n         — supabase/parts/1902 is the worked example.\n',
  );
  process.exit(1);
}

console.log(
  `check-definer — ok, ${created} function definition${created === 1 ? '' : 's'} across `
  + `${files.length} parts all pin a search_path`
  + (pinnedByAlter ? `, plus ${pinnedByAlter} pinned by alter` : '')
  + (Object.keys(PINNED_ELSEWHERE).length
    ? `; ${Object.keys(PINNED_ELSEWHERE).length} pinned live outside the ledger and ratcheted`
    : ''),
);
