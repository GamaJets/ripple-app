#!/usr/bin/env node
// Every route file in a tab group must be declared in that group's layout.
//
// expo-router's <Tabs> gives a TAB BUTTON to every route file in the directory
// unless the layout says `href: null`. So the way you add a hidden screen and
// the way you add a tab are the same action, and the difference is a line in
// a different file that nothing checks.
//
// It shipped. `app/(client)/glucose.tsx` went out in an over-the-air update
// with no Tabs.Screen entry, which put a sixth item called "glucose" in the
// client's tab bar next to Home, Train, Meals, Progress and Me. Nothing failed,
// nothing warned, and the app still compiled — the only symptom was on the
// phone.
//
// The three tab bars are also load-bearing elsewhere: GUIDE_INTRO in
// src/lib/guideContent.ts writes their counts out in words ("Six tabs for
// running your coaching"), and that sentence was wrong for months for the same
// reason — the bar changed and the prose did not.
//
// This does not check the counts. It checks the thing that silently changes
// them: a file nobody declared.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GROUPS = ['(client)', '(trainer)', '(owner)'];
let bad = 0;

for (const g of GROUPS) {
  const dir = join('app', g);
  const layout = readFileSync(join(dir, '_layout.tsx'), 'utf8');

  // Names as the layout declares them. Deliberately a dumb regex over
  // `name="..."`: a Tabs.Screen written any other way is not something this
  // repo does, and a parser here would be a second thing to keep correct.
  const declared = new Set([...layout.matchAll(/name="([^"]+)"/g)].map((m) => m[1]));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && f !== '_layout.tsx')
    .map((f) => f.replace(/\.tsx$/, ''));

  for (const f of files) {
    if (!declared.has(f)) {
      console.error(
        `${dir}/${f}.tsx has no <Tabs.Screen name="${f}"> in ${dir}/_layout.tsx.\n`
        + `  It will appear as a TAB. If that is not what you want, add:\n`
        + `      <Tabs.Screen name="${f}" options={{ href: null, title: '…' }} />`,
      );
      bad++;
    }
  }
}

if (bad) {
  console.error(`\n${bad} undeclared route${bad === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('check-tabs: ok — every route in the three groups is declared');
