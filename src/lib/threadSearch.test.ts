// Looking for something somebody said. Compile with tsc, run with node.
//
// Three failures are guarded here, and the first is the one that makes the
// feature worse than not having it:
//
//   1. "NO MATCHES" OVER A PREFIX. `useThread` reads newest-first at the row
//      cap, so a search on this screen is a search of the recent end of the
//      conversation. Said without its denominator, an empty result is a claim
//      about the whole thread that the screen cannot support — and a member who
//      believes their coach never mentioned their knee stops looking.
//
//   2. A FAILED READ SEARCHED AS IF IT WERE THE THREAD. Under 'error' what is
//      on screen is whatever was cached; a match count over it is a number
//      about the wrong set.
//
//   3. AN EMPTY QUERY TREATED AS A SEARCH. A field somebody has not typed in
//      must not empty the conversation, and a query of spaces is not a search.
import {
  messageMatches, normaliseQuery, searchThread, threadSearchA11y, threadSearchActive,
  threadSearchLine, type SearchableMessage,
} from './threadSearch';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const m = (id: string, body: string): SearchableMessage => ({ id, body });

const THREAD = [
  m('1', 'How is the knee this week?'),
  m('2', 'Sore after Tuesday'),
  m('3', ''),
  m('4', 'Come  at   7 on Thursday'),
  m('5', 'KNEE is better'),
];

/* ── 3 · an empty query is not a search ────────────────────────────────── */

{
  ok(!threadSearchActive(''), 'an empty field is not a search');
  ok(!threadSearchActive('   '), 'nor is one holding spaces');
  ok(!threadSearchActive(null), 'nor a null');
  ok(threadSearchActive(' knee '), 'and a real word is, whatever is around it');
  eq(searchThread(THREAD, '').length, THREAD.length, 'no query hides nothing — the absence of a search is the absence of a filter');
  eq(searchThread(THREAD, '  ').length, THREAD.length, 'and neither does a field of spaces');
  eq(threadSearchLine({ query: '', matched: 0, searched: 5, hasOlder: true, status: 'ready' }), null, 'and says nothing about a search nobody ran');
  eq(threadSearchA11y({ query: '', matched: 0 }), undefined, 'including to a screen reader');
}

/* ── matching ──────────────────────────────────────────────────────────── */

{
  const hits = searchThread(THREAD, 'knee');
  eq(hits.length, 2, 'case is not part of the question');
  eq(hits[0].id, '1', 'and the matches keep the order of the conversation — read out of order they are a different one');
  eq(hits[1].id, '5', 'both of them');
  eq(searchThread(THREAD, 'come at 7')[0]?.id, '4', 'a run of spaces in the message matches a single space in the query');
  eq(normaliseQuery('  COME   at 7 '), 'come at 7', 'the query is trimmed, lowered and collapsed and nothing else');
  eq(searchThread(THREAD, 'nobody said this').length, 0, 'a word nobody wrote matches nothing');
  ok(!messageMatches(m('3', ''), 'knee'), 'a message with no words — a photo — answers no search for a word');
  ok(!messageMatches(undefined, 'knee'), 'and neither does nothing at all');
  ok(!messageMatches(m('1', 'knee'), '   '), 'an empty needle matches nothing rather than everything');
}

/* ── 1 · the denominator ───────────────────────────────────────────────── */

{
  const none = threadSearchLine({ query: 'knee', matched: 0, searched: 200, hasOlder: true, status: 'partial' });
  ok(!!none && /No match in the 200 messages on this screen/.test(none), 'an empty result names the set it looked at');
  ok(!!none && /not searched/.test(none), 'and says the rest of the conversation was not searched');
  ok(!!none && /load them/.test(none), 'and what to do about it');

  const whole = threadSearchLine({ query: 'knee', matched: 0, searched: 12, hasOlder: false, status: 'ready' });
  ok(!!whole && /No match in the 12 messages on this screen/.test(whole), 'a whole conversation still names its size');
  ok(!!whole && !/not searched/.test(whole), 'and does not warn about messages that do not exist');

  const some = threadSearchLine({ query: 'knee', matched: 2, searched: 200, hasOlder: true, status: 'ready' });
  ok(!!some && /2 matches in the 200 messages/.test(some), 'a result says both halves');
  ok(!!some && /not searched/.test(some), 'and still admits what it could not look at — two matches is not "the" two matches');

  const one = threadSearchLine({ query: 'knee', matched: 1, searched: 200, hasOlder: false, status: 'ready' });
  ok(!!one && /^1 match in the 200 messages/.test(one), 'one match says one');
  const oneOfOne = threadSearchLine({ query: 'knee', matched: 0, searched: 1, hasOlder: false, status: 'ready' });
  ok(!!oneOfOne && /1 message on this screen/.test(oneOfOne), 'and a thread of one is a message, not messages');
}

/* ── 2 · a failed read ─────────────────────────────────────────────────── */

{
  const bad = threadSearchLine({ query: 'knee', matched: 0, searched: 3, hasOlder: false, status: 'error' });
  ok(!!bad && /could not be read/.test(bad), 'a failed read is said first');
  ok(!!bad && !/No match/.test(bad), 'and no count is stated over it — the number would be about the wrong set');
  ok(!!bad && /There may be more/.test(bad), 'and the doubt is left open');
}

/* ── what a screen reader is told ──────────────────────────────────────── */

{
  const a = threadSearchA11y({ query: 'knee', matched: 2 });
  ok(!!a && /2 matching messages/.test(a), 'the count is announced');
  ok(!!a && /hidden while you are searching/.test(a), 'and so is the fact that the conversation is not all there — the bubbles look the same either way');
  const one = threadSearchA11y({ query: 'knee', matched: 1 });
  ok(!!one && /1 matching message\./.test(one), 'one is singular');
}

if (errors.length) {
  console.error(`threadSearch: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('threadSearch: ok');
