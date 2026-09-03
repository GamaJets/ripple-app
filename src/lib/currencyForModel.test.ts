// What a model is told about the coach's currency. Compile with tsc, run with
// node.
//
// The bug this guards: two screens carried the literal 'unknown — the gym has
// not set one, so state no amount' as the value of a `currency` field handed to
// a language model. It is one string for six different states, and after part
// 940 the commonest of them is a coach with NO GYM — for whom it names an
// organisation that does not exist and provokes a paragraph of advice about
// speaking to an owner. A failed read got the same string, which turns an
// outage into a business fact the model reasons from.
import { currencyForModel } from './currencyForModel';
import type { MyCurrency, MyCurrencyGap } from './currencySource';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const set = (currency: string): MyCurrency => ({ currency, from: 'own', gap: null, canSetOwn: false });
const gap = (g: MyCurrencyGap): MyCurrency => ({ currency: null, from: null, gap: g, canSetOwn: false });

/* ── a resolved currency is the code and nothing else ──────────────────── */

eq(currencyForModel(set('GBP')), 'GBP', 'a set currency is handed over as the code');
eq(currencyForModel(set('  jpy ')), 'JPY', 'trimmed and upper-cased, as everywhere else');
eq(currencyForModel({ currency: 'AED', from: 'gym', gap: null, canSetOwn: false }), 'AED',
  'the gym source makes no difference to the code');

/* ── every gap says "unknown" and says which ───────────────────────────── */

const ALL: MyCurrencyGap[] = ['reading', 'unreadable', 'unavailable', 'nowhere', 'gym-unset', 'own-unset'];
for (const g of ALL) {
  const s = currencyForModel(gap(g));
  ok(s.startsWith('unknown'), `${g} begins with the word unknown — got ${JSON.stringify(s)}`);
  ok(s.includes('state no amount'), `${g} tells the model to state no amount`);
  ok(!/^[A-Z]{3}$/.test(s), `${g} is not mistakable for a currency code`);
}

// The six reasons are six different sentences. One string for all of them is
// the defect.
const said = new Set(ALL.map((g) => currencyForModel(gap(g))));
eq(said.size, ALL.length, 'no two gaps produce the same sentence');

/* ── the two that were described wrongly ───────────────────────────────── */

// An independent coach. The string may say they HAVE no gym; what it must
// never do is produce an owner for them to go and ask, which is exactly what
// the literal it replaces did.
ok(!/owner/i.test(currencyForModel(gap('own-unset'))),
  'a coach with no gym is never pointed at an owner');
ok(/no gym/i.test(currencyForModel(gap('own-unset'))),
  'and is described as having none');
ok(!/gym has not set/i.test(currencyForModel(gap('own-unset'))),
  'and is not described with the sentence that belongs to gym-unset');

// A failed read is not a setting nobody made, and the string says so outright
// so the model cannot reason from an absence we invented.
ok(/could not be read/i.test(currencyForModel(gap('unreadable'))),
  'a failed read is described as a failed read');
ok(/not the same as none being set/i.test(currencyForModel(gap('unreadable'))),
  'and is explicitly distinguished from none being set');

// The one state that MAY name an owner, and the only one.
ok(/owner/i.test(currencyForModel(gap('gym-unset'))), 'a gym with none set names the owner');

/* ── nothing read yet is its own answer ────────────────────────────────── */

eq(currencyForModel(null), currencyForModel(gap('reading')), 'no answer yet reads as still reading');
eq(currencyForModel(undefined), currencyForModel(gap('reading')), 'undefined is the same');
ok(currencyForModel(null) !== currencyForModel(gap('unreadable')),
  'a read in flight is not a read that failed');

/* ── a contradiction still refuses to price ────────────────────────────── */

// No code and no gap cannot arise from resolveMyCurrency, and if it ever does
// it must not become a currency.
const contradiction = currencyForModel({ currency: null, from: null, gap: null, canSetOwn: false });
ok(contradiction.startsWith('unknown'), 'no code and no gap is still unknown');
ok(contradiction.includes('state no amount'), 'and still states no amount');

// An empty string is not a currency either.
ok(currencyForModel({ currency: '   ', from: 'own', gap: null, canSetOwn: false }).startsWith('unknown'),
  'whitespace is not a currency code');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('currencyForModel.test.ts — all assertions passed');
