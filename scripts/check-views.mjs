#!/usr/bin/env node
// Every view in supabase/parts must restate `security_invoker = true`.
//
// `create or replace view` does NOT preserve reloptions the new statement
// leaves out — it RESETS them. So a part that re-creates an existing view and
// omits the WITH clause silently turns an invoker view back into a definer
// view, which stops consulting the RLS on the table underneath it.
//
// That is not hypothetical. Part 2370 re-created `public.pending_deletions`
// as `create or replace view public.pending_deletions as ...` to add a
// nullif() around one column. Part 41 had created it `with (security_invoker
// = true)`. The one omission dropped the flag, and because the view carried
// the Supabase default grants, the deletion queue of every gym — names,
// tenant ids, and the date each member asked to be erased — became readable
// by anon.
//
// Nothing in the app would have shown it. All three readers say in a comment
// that they deliberately do not filter by tenant BECAUSE the view is
// invoker-scoped: app/(owner)/deletions.tsx:29, app/(owner)/settings.tsx:227
// and studio-web/app/deletions/page.tsx:32. Their entire tenant isolation was
// this one reloption, and the screens would have looked identical without it.
//
// get_advisors caught it after the fact. This catches it before.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/parts';
let bad = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  const src = readFileSync(join(DIR, file), 'utf8');
  const re = /create\s+(?:or\s+replace\s+)?view\s+([a-z0-9_.]+)/gi;
  for (const m of src.matchAll(re)) {
    // Everything between the view name and the `as` that opens the body is
    // where a WITH clause has to be. Bounded so a `security_invoker` written
    // in a comment further down the file cannot vouch for this statement.
    const after = src.slice(m.index + m[0].length);
    const asAt = /\bas\b/i.exec(after);
    const head = asAt ? after.slice(0, asAt.index) : after.slice(0, 200);
    if (/security_invoker\s*=\s*true/i.test(head)) continue;

    const line = src.slice(0, m.index).split('\n').length;
    console.error(
      `${DIR}/${file}:${line} creates view ${m[1]} without (security_invoker = true).\n`
      + '  `create or replace view` resets reloptions it does not restate, so this\n'
      + '  makes it — or turns it back into — a definer view that ignores the RLS on\n'
      + '  the tables underneath. Add `with (security_invoker = true)` before the `as`.',
    );
    bad++;
  }
}

if (bad) {
  console.error(`\n${bad} view${bad === 1 ? '' : 's'} would run as their owner.`);
  process.exit(1);
}
console.log('check-views: ok — every view in supabase/parts restates security_invoker');
