// The community board's pure half. Compile with tsc, run with node.
//
// Pins the three things that would ship a wrong sentence or a wrong post: the
// word screen (catches the obvious, spares ordinary words that contain one),
// the feed's state line (a failed read is never "nothing posted"), and the like
// count (never a count over a read that was not whole).
import {
  COMMENT_MAX, POST_MAX, REPORT_REASONS, canModerate, composeProblem, feedStateLine,
  likeState, objectionableWord, shapeComments, shapePosts, type RawPost,
} from './community';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

/* ── the word screen ──────────────────────────────────────────────────── */
{
  ok(objectionableWord('you are a c*nt') === null, 'a starred word is not claimed as caught');
  ok(objectionableWord('what the fuck') === 'fuck', 'the obvious is caught');
  ok(objectionableWord('Sh1t session') === 'shit', 'digit swaps are undone');
  ok(objectionableWord('$hit') === 'shit', 'symbol swaps are undone');
  for (const fine of ['Scunthorpe parkrun', 'assess your squat', 'classic deadlift', 'cockpit', 'Dickens', 'grape juice', 'therapist'])
    ok(objectionableWord(fine) === null, `whole words only: "${fine}" passes`);
  ok(composeProblem('   ', POST_MAX) === 'Write something first.', 'blank is refused');
  ok(composeProblem('x'.repeat(POST_MAX + 3), POST_MAX)!.includes('3 characters over'), 'over-length says by how much');
  ok(composeProblem('x'.repeat(COMMENT_MAX), COMMENT_MAX) === null, 'exactly the limit passes');
  ok(/reword/.test(composeProblem('shit', POST_MAX) ?? ''), 'a blocked word asks for a rewording');
  ok(composeProblem('Great class today!', POST_MAX) === null, 'ordinary text passes');
}

/* ── the feed's one line ──────────────────────────────────────────────── */
{
  const err = feedStateLine('error', 0, 'members')!;
  ok(/couldn’t read/.test(err) && !/nothing has been posted/i.test(err), 'A FAILED READ IS NEVER "NOTHING POSTED"');
  ok(feedStateLine('error', 3, 'members') !== null, 'and it is said over stale rows too');
  ok(/Nothing has been posted/.test(feedStateLine('ready', 0, 'members')!), 'an empty ready read may say so');
  ok(/No coach/.test(feedStateLine('ready', 0, 'coaches')!), 'the coaches channel says it its own way');
  ok(feedStateLine('ready', 2, 'members') === null, 'posts on screen need no line');
  ok(feedStateLine('partial', 50, 'members') === null, 'a cut feed shows its rows');
  ok(feedStateLine('loading', 0, 'members') !== null, 'loading says so');
  for (const s of ['loading', 'ready', 'error', 'partial'] as LoadStatus[])
    ok(!/—/.test(feedStateLine(s, 0, 'members') ?? ''), `no em dash in the ${s} line`);
}

/* ── likes ────────────────────────────────────────────────────────────── */
{
  const rows = [{ post_id: 'p1', user_id: 'me' }, { post_id: 'p1', user_id: 'x' }, { post_id: 'p2', user_id: 'x' }];
  const a = likeState('ready', rows, 'p1', 'me');
  ok(a.count === 2 && a.mine, 'a whole read counts, and knows my like');
  const b = likeState('partial', rows, 'p1', 'me');
  ok(b.count === null && b.mine, 'A CUT READ GIVES NO COUNT, but my own row is still a fact');
  ok(likeState('error', [], 'p1', 'me').count === null, 'a failed read gives no count');
  ok(likeState('ready', rows, 'p3', 'me').count === 0, 'a whole read may say zero');
  ok(!likeState('ready', rows, 'p1', null).mine, 'nobody signed in likes nothing');
}

/* ── shaping ──────────────────────────────────────────────────────────── */
{
  const base: RawPost = { id: 'a', author_id: 'u', author_name: 'Sam', author_role: 'trainer', channel: 'members', body: 'hi', created_at: '2026-09-01T10:00:00Z', hidden_at: null };
  const shaped = shapePosts([
    base,
    { ...base, id: null },
    { ...base, id: 'b', channel: 'elsewhere' },
    { ...base, id: 'c', created_at: 'not a date' },
    { ...base, id: 'd', author_name: '  ', author_role: 'client', hidden_at: '2026-09-02T00:00:00Z' },
  ]);
  ok(shaped.map((p) => p.id).join() === 'a,d', 'rows missing an id, a channel or a time are dropped');
  ok(shaped[1].authorName === 'Member' && shaped[1].hidden, 'a blank name falls back by role, and hidden is carried');
  ok(shapeComments([{ ...base, post_id: 'a' }, { ...base, post_id: null }]).length === 1, 'a comment needs its post');
  ok(canModerate('owner') && canModerate('trainer') && !canModerate('client') && !canModerate(null), 'owner and coaches moderate');
  ok(REPORT_REASONS.map((r) => r.key).sort().join() === 'harassment,hate,other,sexual,spam,violence',
    'report reasons mirror the check constraint in part 3300');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('community: ok');
