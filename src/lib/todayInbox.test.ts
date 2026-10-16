// The Today inbox's grouping. Compile with tsc, run with node.
import { inboxCounts, inboxTabs, inBucket, BUCKET_OF, type AttnKind } from './todayInbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const all: AttnKind[] = ['drift', 'adherence', 'unread', 'plan', 'owed', 'credits', 'setup'];
for (const k of all) ok(!!BUCKET_OF[k], `${k} has a bucket`);

const q: (AttnKind | null)[] = ['unread', 'drift', 'adherence', 'owed', null];
eq(inboxCounts(q), { all: 5, reply: 1, checkin: 2, plan: 0, money: 1 }, 'counts');
eq(inboxTabs(q).map((x) => x.key), ['all', 'reply', 'checkin', 'money'], 'empty buckets are not drawn');
eq(inboxTabs(['drift', 'adherence']), [], 'one kind of job draws no tabs');
eq(inboxTabs([]), [], 'an empty queue draws no tabs');
ok(inBucket(null, 'all') && !inBucket(null, 'reply'), 'unknown kind is only under All');
ok(inBucket('setup', 'plan') && !inBucket('setup', 'money'), 'setup is a program job');
// No one is lost: the buckets add up to the queue minus the kindless rows.
const n = inboxCounts(q);
eq(n.reply + n.checkin + n.plan + n.money, q.filter(Boolean).length, 'buckets partition the queue');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('todayInbox ok');
