#!/usr/bin/env node
// The web console may only import lib modules that take their client as an
// argument.
//
// src/lib is shared by the three phone apps and by studio-web. But the modules
// divide into two kinds, and nothing in the type system tells them apart:
//
//   INJECTABLE   fetchVisits(sb, tenantId)   — takes a Queryable, works anywhere
//   PHONE-ONLY   import { supabase } from './supabase'
//
// src/lib/supabase.ts imports @react-native-async-storage/async-storage and
// calls createClient at MODULE SCOPE with EXPO_PUBLIC_* env vars. Under Next
// those are undefined, so importing any phone-only module from the console
// throws while the module is still evaluating — before any of your code runs.
// And even where it survives, that client carries no browser session, so RLS
// refuses every read it makes.
//
// This was found the slow way: an agent building the Classes page discovered
// @lib/classAttendance could not be imported at all and had to reach for
// @lib/gymSchedule instead. The failure is import-time and total, so it does
// not reach production — but it costs whoever hits it an hour, and it will be
// hit again every time somebody reasonably assumes a shared module is shared.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIB = 'src/lib';
const CONSOLE_DIRS = ['studio-web/app', 'studio-web/components', 'studio-web/lib'];

// Which shared modules build the phone's own client rather than accepting one.
const phoneOnly = new Set();
for (const f of readdirSync(LIB)) {
  if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
  const src = readFileSync(join(LIB, f), 'utf8');
  if (/^import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*'\.\/supabase'/m.test(src)) {
    phoneOnly.add(f.replace(/\.ts$/, ''));
  }
}

const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(CONSOLE_DIRS[0]);
for (const d of CONSOLE_DIRS.slice(1)) {
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) files.push(p);
    }
  })(d);
}

if (!files.length) {
  console.error('found no console files to check, which is not a pass.');
  process.exit(1);
}

const offences = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s*'@lib\/([a-zA-Z0-9_]+)'/g)) {
    if (phoneOnly.has(m[1])) {
      offences.push(`${f}  imports @lib/${m[1]}`);
    }
  }
}

if (offences.length) {
  console.error(`${offences.length} console import${offences.length === 1 ? '' : 's'} of a phone-only module:\n`);
  for (const o of offences) console.error(`  ${o}`);
  console.error('\nThese throw at import time under Next: src/lib/supabase.ts pulls in');
  console.error('AsyncStorage and builds a client from EXPO_PUBLIC_* at module scope.');
  console.error('Use a module that takes the client as an argument instead — the ones');
  console.error('typed `sb: Queryable` work in both places.');
  process.exit(1);
}

console.log(`portal imports ok — ${files.length} console files, none import any of the ${phoneOnly.size} phone-only modules.`);
