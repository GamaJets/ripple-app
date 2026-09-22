// The community board's pure half. Compile with tsc, run with node.
//
// Pins the three things that would ship a wrong sentence or a wrong post: the
// word screen (catches the obvious, spares ordinary words that contain one),
// the feed's state line (a failed read is never "nothing posted"), and the like
// count (never a count over a read that was not whole).
import {
  COMMENT_MAX, MAX_IMAGE_BYTES, POST_MAX, REPORT_REASONS, canModerate, communityImagePath, composeProblem,
  eventInstant, eventProblem, feedStateLine, imageRefusal, isCommunityImagePath, likeState, objectionableWord,
  shapeComments, shapePosts, upcoming, urlProblem, type RawPost,
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

/* ── photos, resources, events (part 3330) ────────────────────────────── */
{
  const T = '11111111-1111-4111-8111-111111111111', A = '22222222-2222-4222-8222-222222222222';
  ok(composeProblem('  ', POST_MAX, true) === null, 'a photo post may have no words');
  ok(/reword/.test(composeProblem('shit', POST_MAX, true) ?? ''), 'but the words it has are still screened');
  const path = communityImagePath(T, A, 1700000000000.4, 'Ab!9', 'jpg');
  ok(path === `${T}/${A}/1700000000000-ab9.jpg`, 'the path is tenant/author/file');
  ok(isCommunityImagePath(path), 'and reads back as one');
  for (const bad of [`${T}/x.jpg`, `${T}/${A}/../x.jpg`, `${T}/${A}/a/b.jpg`, `${T}/${A}/a.gif`, null])
    ok(!isCommunityImagePath(bad), `a path shaped otherwise is not drawn: ${bad}`);
  ok(imageRefusal(MAX_IMAGE_BYTES) === null && /5 MB/.test(imageRefusal(MAX_IMAGE_BYTES + 1) ?? ''), 'the 5 MB cap');
  ok(imageRefusal(0) !== null, 'an empty file is refused');
  ok(urlProblem('https://example.com/a?b=1') === null, 'an https link passes');
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'https://exa mple.com', 'https://localhost', '', 'https://x.co/' + 'a'.repeat(500)])
    ok(urlProblem(bad) !== null, `refused link: ${bad.slice(0, 30)}`);
  const at = eventInstant('2026-10-03', '6:30 pm')!;
  const d = new Date(at);
  ok(d.getHours() === 18 && d.getMinutes() === 30 && d.getDate() === 3, '6:30 pm is 18:30 on that day');
  ok(eventInstant('2026-10-03', '18:30') === at, '24-hour time reads the same');
  ok(new Date(eventInstant('2026-10-03', '12 am')!).getHours() === 0, '12 am is midnight');
  for (const [day, time] of [['2026-02-31', '10:00'], ['2026-10-03', '25:00'], ['2026-10-03', '13 pm'], ['03/10/2026', '10:00'], ['2026-10-03', '']])
    ok(eventInstant(day, time) === null, `unreadable: ${day} ${time}`);
  ok(eventProblem(null, '') !== null, 'no time, no event');
  ok(/passed/.test(eventProblem(1000, '', 2000) ?? ''), 'a past time is refused');
  ok(eventProblem(3000, 'Studio 2', 2000) === null, 'a future time with a place passes');
  ok(eventProblem(3000, 'x'.repeat(121), 2000) !== null, 'a long place is refused');

  const base: RawPost = { id: 'a', author_id: 'u', author_name: 'Sam', author_role: 'trainer', channel: 'coaches', body: '', created_at: '2026-09-01T10:00:00Z', hidden_at: null };
  const rows = shapePosts([
    { ...base, id: 'img', image_path: path },
    { ...base, id: 'bad-img', image_path: 'elsewhere/x.jpg' },
    { ...base, id: 'res', body: 'Mobility guide', kind: 'resource', url: 'https://example.com/guide' },
    { ...base, id: 'res-http', body: 'x', kind: 'resource', url: 'http://example.com' },
    { ...base, id: 'ev1', body: 'Later', kind: 'event', event_at: '2026-10-05T10:00:00Z', event_place: ' Hall ' },
    { ...base, id: 'ev0', body: 'Sooner', kind: 'event', event_at: '2026-10-04T10:00:00Z' },
    { ...base, id: 'ev-old', body: 'Gone', kind: 'event', event_at: '2026-09-01T10:00:00Z' },
    { ...base, id: 'ev-none', body: 'When?', kind: 'event', event_at: null },
  ]);
  ok(rows.map((p) => p.id).join() === 'img,res,ev1,ev0,ev-old', 'wordless posts need a good photo; resources need https; events need a time');
  ok(rows[0].imagePath === path && rows[0].kind === 'post', 'the photo is carried');
  ok(rows[2].eventPlace === 'Hall', 'the place is trimmed');
  ok(upcoming(rows, Date.parse('2026-09-22T00:00:00Z')).map((p) => p.id).join() === 'ev0,ev1', 'UPCOMING IS SOONEST FIRST AND PAST EVENTS DROP OFF');
  ok(/No upcoming/.test(feedStateLine('ready', 0, 'members', 'event')!) && /resource/.test(feedStateLine('ready', 0, 'coaches', 'resource')!), 'empty tabs say what is empty');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('community: ok');
