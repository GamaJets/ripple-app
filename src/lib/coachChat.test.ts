// The kept AI Coach conversation. Compile with tsc, run with node.
//
// Five failures are guarded here, and four of them are about somebody's health
// information rather than about a data structure:
//
//   1. TWO ACCOUNTS, OR TWO SIDES, SHARING A THREAD. `outboxKey(uid)` exists
//      because two people sharing a phone must not inherit each other's unsent
//      writes. This is the same rule with one extra turn: a trainer self-tracks
//      on the client screens, so ONE uid legitimately holds a client-side thread
//      about their own body and a coach-side thread about their own revenue.
//      The key has to separate both.
//
//   2. AN UNREADABLE THREAD READ AS AN EMPTY ONE. Same rule, same reason, as
//      `readOutbox` and `readCrashQueue`: bytes nobody could parse are not "you
//      have never asked me anything", and a caller that collapses them writes
//      the next reply straight over a fortnight of conversation.
//
//   3. A WITHDRAWN CONSENT THAT LEAVES THE THREAD BEHIND. The replies in a
//      health thread are written from somebody's body, sleep and injuries. A
//      member who turns that off and comes back to it all still on screen has
//      been told their answer did something it did not do.
//
//   4. A BLOB WHOSE `health` FLAG IS MISSING OR DAMAGED. Every other unreadable
//      field in this file falls towards keeping the member's words. This one
//      must fall the other way, because guessing wrong here means a thread full
//      of somebody's body surviving a consent they have withdrawn.
//
//   5. A THREAD THAT GROWS FOR EVER. AsyncStorage on Android is one SQLite row
//      per key, and the honest amount of health material to keep is the amount
//      still useful to the person.
import {
  COACH_CHAT_PREFIX, THREAD_CAP, coachChatKey, readThread, threadForConsent,
  trimThread, writeThread, WITHDRAWN_THREAD_NOTE, THREAD_KEPT_NOTE, COACH_THREAD_KEPT_NOTE,
} from './coachChat';
import type { ChatMsg } from './coach';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const UID = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const say = (n: number): ChatMsg => ({ role: n % 2 === 0 ? 'user' : 'assistant', content: `line ${n}` });

/* ── 1 · the key ───────────────────────────────────────────────────────── */

{
  ok(coachChatKey(UID, 'client').includes(UID), 'the thread is per account');
  ok(coachChatKey(UID, 'client').startsWith(COACH_CHAT_PREFIX), 'and is versioned, so a shape change is not read as damage');
  ok(coachChatKey(UID, 'client') !== coachChatKey(OTHER, 'client'),
    'two people sharing a phone do not inherit each other’s conversation');
  ok(coachChatKey(UID, 'client') !== coachChatKey(UID, 'coach'),
    'and one person holding both roles does not have the AI Coach restore their Assistant’s thread');
}

/* ── 2 · reading the device ────────────────────────────────────────────── */

{
  eq(readThread(null).read, true, 'a key that was never written is a real empty thread');
  eq(readThread(null).thread, null, 'and holds nothing');
  eq(readThread('').read, true, 'so is an empty string');
  eq(readThread('{ not json').read, false, 'bytes nobody could parse are NOT an empty conversation');
  eq(readThread('[]').read, false, 'and neither is a list where an object belongs');
  eq(readThread('{"health":false}').read, false, 'nor an object with no messages in it at all');

  const raw = JSON.stringify({
    health: false,
    msgs: [
      { role: 'user', content: 'am I on track' },
      { role: 'nobody', content: 'x' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'yes' },
    ],
  });
  const back = readThread(raw);
  eq(back.read, true, 'one unreadable message is not a failure to read the file');
  eq(back.thread?.msgs.length, 2, 'a message with an unknown role or no words is dropped rather than shown blank');
  eq(back.thread?.msgs[1].content, 'yes', 'and the rest keep their order');
}

/* ── 3 · a damaged or missing health flag ──────────────────────────────── */

{
  const noFlag = readThread(JSON.stringify({ msgs: [{ role: 'user', content: 'my knee' }] }));
  eq(noFlag.thread?.health, true, 'a thread with no health flag is treated as health — the only field in this file that guesses towards caution');
  const badFlag = readThread(JSON.stringify({ health: 'yes', msgs: [{ role: 'user', content: 'my knee' }] }));
  eq(badFlag.thread?.health, true, 'and so is one whose flag is not a boolean');
  // The consequence, which is the point of the two assertions above.
  eq(threadForConsent(noFlag.thread, false).dropped, true,
    'so a damaged flag cannot be how a withdrawn consent leaves the conversation behind');
}

/* ── 4 · what a withdrawn consent does ─────────────────────────────────── */

{
  const health = { health: true, msgs: [say(0), say(1)] };
  const plain = { health: false, msgs: [say(0), say(1)] };

  eq(threadForConsent(health, true).msgs.length, 2, 'a health thread comes back while the member is still sharing');
  eq(threadForConsent(health, true).dropped, false, 'and nothing is claimed to have been dropped');

  eq(threadForConsent(health, false).msgs.length, 0, 'a health thread does not come back once they have turned it off');
  eq(threadForConsent(health, false).dropped, true, 'and the screen is told, because a conversation vanishing in silence is its own defect');

  eq(threadForConsent(plain, false).msgs.length, 2,
    'a thread written WITHOUT their health details is untouched by the same answer — declining is not a reason to lose the conversation you had while declining');
  eq(threadForConsent(plain, false).dropped, false, 'and nothing is announced about it');

  eq(threadForConsent(null, true).msgs.length, 0, 'no stored thread is no thread');
  eq(threadForConsent(null, false).dropped, false, 'and is not reported as a withdrawal');
}

/* ── 5 · the cap ───────────────────────────────────────────────────────── */

{
  const many: ChatMsg[] = [];
  for (let i = 0; i < THREAD_CAP + 7; i++) many.push(say(i));
  const cut = trimThread(many);
  eq(cut.length, THREAD_CAP, 'a thread is trimmed to the cap');
  eq(cut[cut.length - 1].content, `line ${THREAD_CAP + 6}`, 'the newest message survives — a conversation is read from the bottom');
  eq(cut[0].content, `line ${7}`, 'and the oldest are the ones that go');

  const few = [say(0), say(1)];
  eq(trimThread(few).length, 2, 'a short thread is left exactly as it is');
  ok(trimThread(few) !== few, 'and is copied rather than handed back by reference');

  // The trim is inside the write, so there is no path that stores an untrimmed
  // thread — including a caller that forgets it exists.
  const stored = readThread(writeThread(many, true));
  eq(stored.thread?.msgs.length, THREAD_CAP, 'what goes on the disk is trimmed by the writer, not by the caller');
  eq(stored.thread?.health, true, 'and carries the flag a later withdrawal is enforced against');
}

/* ── 6 · the round trip ────────────────────────────────────────────────── */

{
  const msgs = [say(0), say(1), say(2)];
  const back = readThread(writeThread(msgs, false));
  eq(back.read, true, 'what this file writes, this file can read');
  eq(back.thread?.msgs.length, 3, 'with every message still there');
  eq(back.thread?.health, false, 'and a false flag stays false rather than defaulting to the cautious side on the way back');
  eq(back.thread?.msgs[0].role, msgs[0].role, 'and roles survive');
}

/* ── 7 · the sentences ─────────────────────────────────────────────────── */

{
  // The member's model is that the conversation is still there. The line has to
  // say it is gone, and say the reason, without promising anything further.
  ok(/removed|not kept|nothing was kept/i.test(WITHDRAWN_THREAD_NOTE), 'the withdrawal line says the copy is gone');
  ok(!/will be|we will/i.test(WITHDRAWN_THREAD_NOTE), 'and promises nothing further');
  ok(/phone/i.test(THREAD_KEPT_NOTE), 'the member is told where the conversation is');
  ok(/coach cannot read/i.test(THREAD_KEPT_NOTE), 'and told the one thing they would otherwise have to assume');
  ok(!/coach cannot read/i.test(COACH_THREAD_KEPT_NOTE),
    'the coach’s own line does not make the member’s promise — it is a different subject, and a reassurance that does not apply is noise at best');
  ok(/phone/i.test(COACH_THREAD_KEPT_NOTE), 'but it still says where the conversation is');
}

if (errors.length) {
  console.error(`coachChat: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('coachChat: ok');
