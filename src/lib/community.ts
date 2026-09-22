// A gym's community board: the pure half. Tables, policies and the reasons for
// them are in supabase/parts/3300-a-gyms-community-is-its-own.sql; the reads
// and writes are src/ui/community.ts; the screens draw src/ui/CommunityFeed.tsx.
//
// Same rule as src/lib/challenges.ts, because this is also about other people:
// no sentence about what the gym has posted is written unless the read
// established it. An empty feed under a failed read is "we could not read it",
// never "nothing has been posted", and a like count over a truncated read of
// likes is not a count.
import { num1 } from './format';
import type { LoadStatus } from '../ui/loadStatus';

export type Channel = 'members' | 'coaches';
export type AuthorRole = 'owner' | 'trainer' | 'client';
/** Mirrors `kind` on community_posts (part 3330). A resource is a link for the
 *  gym's coaches; an event has a time and is drawn under Upcoming until it passes. */
export type PostKind = 'post' | 'resource' | 'event';

/** Mirrors `version >= 1` in the two insert policies of part 3300. Raise both
 *  together to ask everyone to accept the rules again. */
export const COMMUNITY_RULES_VERSION = 1;
export const POST_MAX = 2000;
export const COMMENT_MAX = 1000;
/** How many posts one read asks for. The feed is newest first, so a cut
 *  feed is the newest page of it, and the screen says there is more. */
export const FEED_CAP = 50;

export const COMMUNITY_RULES: string[] = [
  'Be kind. No harassment, bullying, threats or hate of any kind.',
  'Nothing sexual, violent or graphic, and nothing illegal.',
  'No spam, selling or links to things your gym has not approved.',
  'Keep other people’s health and personal details private.',
  'Your gym’s owner and coaches can hide anything that breaks these rules, and can remove you from the community.',
  'You can report any post or comment, block anyone, and hide posts you do not want to see. Reports go to your gym’s owner and coaches.',
];

/** Who a member can reach about the community. Apple asks for published
 *  contact details; the screen fills in the brand's support address. */
export function rulesContactLine(supportEmail: string): string {
  return `Questions or a problem a report does not cover? Speak to your gym, or email ${supportEmail}.`;
}

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'other';
/** Mirrors the `reason` check on community_reports. */
export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'harassment', label: 'Harassment' },
  { key: 'hate', label: 'Hate' },
  { key: 'sexual', label: 'Sexual Content' },
  { key: 'violence', label: 'Violence' },
  { key: 'spam', label: 'Spam' },
  { key: 'other', label: 'Something Else' },
];

export function reasonLabel(r: string | null | undefined): string {
  return REPORT_REASONS.find((x) => x.key === r)?.label ?? 'Reported';
}

/* ── the word screen ───────────────────────────────────────────────────────
 *
 * A FIRST line, not the only one. It stops the obvious before it is sent and
 * spares a moderator the easy cases; it cannot read intent, other languages or
 * a word spelled creatively enough, which is what reports, blocks and the
 * moderators are for. Whole words only, so "Scunthorpe", "assess" and
 * "classic" are not caught. Common character swaps (0→o, 1→i, $→s…) are
 * undone first.
 *
 * ponytail: a short fixed list. Swap for a maintained list or a server-side
 * classifier if reports show it being walked around.
 */
const BLOCKED = new Set([
  'fuck', 'fucker', 'fucking', 'fucked', 'motherfucker', 'shit', 'shitty', 'bullshit',
  'cunt', 'cunts', 'bitch', 'bitches', 'whore', 'slut', 'sluts', 'dick', 'dickhead',
  'cock', 'pussy', 'asshole', 'arsehole', 'bastard', 'wanker', 'twat', 'prick',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spic', 'chink', 'kike', 'tranny',
  'porn', 'nudes', 'rape', 'rapist', 'kys',
]);

const SWAPS: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** The first blocked word in `text`, or null. */
export function objectionableWord(text: string): string | null {
  const norm = text.toLowerCase().replace(/[013457@$!]/g, (c) => SWAPS[c] ?? c);
  for (const w of norm.split(/[^a-z]+/)) {
    if (w && BLOCKED.has(w)) return w;
  }
  return null;
}

/** Why this text cannot be sent, or null when it can. A post carrying a photo
 *  may have no words; the words it does have are still screened. */
export function composeProblem(text: string, max: number, hasImage = false): string | null {
  const s = text.trim();
  if (!s) return hasImage ? null : 'Write something first.';
  if (s.length > max) return `That is ${s.length - max} characters over the limit of ${max}.`;
  if (objectionableWord(s)) return 'That includes language this community does not allow. Please reword it.';
  return null;
}

/* ── photos, links and events (part 3330) ──────────────────────────────── */

export const COMMUNITY_MEDIA_BUCKET = 'community-media';
/** Mirrors the bucket's file_size_limit in part 3330. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** The long edge a photo is resized to before upload. */
export const IMAGE_MAX_PX = 1280;
export const URL_MAX = 500;
export const PLACE_MAX = 120;

/** `<tenant>/<author>/<time>-<token>.<ext>`: the shape part 3330's folder
 *  check and storage policies key on. */
export function communityImagePath(tenantId: string, authorId: string, at: number, token: string, ext: 'png' | 'jpg'): string {
  const safe = String(token ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'photo';
  return `${tenantId}/${authorId}/${Math.floor(at)}-${safe}.${ext}`;
}

/** A path read back from a row is drawn only if it has that shape: two folders,
 *  a png or jpg file, no traversal. */
export function isCommunityImagePath(path: string | null | undefined): boolean {
  const p = String(path ?? '');
  return p.length <= 300 && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-z0-9-]+\.(png|jpg)$/.test(p);
}

export function imageRefusal(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'That photo could not be read off your phone, so nothing was uploaded.';
  if (bytes > MAX_IMAGE_BYTES) return `That photo is ${num1(bytes / (1024 * 1024))} MB after resizing and the limit is 5 MB. Try a different photo.`;
  return null;
}

/** Why this link cannot be shared, or null. Https only, because the check on
 *  the column says so and because a plain http link opens unencrypted. */
export function urlProblem(url: string): string | null {
  const s = url.trim();
  if (!s) return 'Add the link you want to share.';
  if (s.length > URL_MAX) return `That link is longer than ${URL_MAX} characters.`;
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(s)) return 'Links must start with https:// and have no spaces.';
  return null;
}

/** `YYYY-MM-DD` and `18:30` or `6:30 pm`, on this phone's clock, to an instant.
 *  Null when either cannot be read.
 *  ponytail: the phone's zone, not the gym's. Use src/lib/gymZone.ts if coaches post events from another zone. */
export function eventInstant(day: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(time.trim());
  if (!d || !m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const ap = m[3]?.toLowerCase();
  if (ap) { if (h < 1 || h > 12) return null; h = (h % 12) + (ap === 'pm' ? 12 : 0); }
  if (h > 23 || min > 59) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, min);
  // Rejects 2026-02-31 rolling into March.
  if (at.getMonth() !== Number(d[2]) - 1 || at.getDate() !== Number(d[3])) return null;
  return at.getTime();
}

/** Why this event cannot be posted, or null. */
export function eventProblem(at: number | null, place: string, now: number = Date.now()): string | null {
  if (at == null) return 'Pick a day and type a time like 18:30 or 6:30 pm.';
  if (at <= now) return 'That time has already passed.';
  if (place.trim().length > PLACE_MAX) return `The place is longer than ${PLACE_MAX} characters.`;
  return null;
}

/** Events still to come, soonest first. The read already asks the server for
 *  these; this keeps one that passes while the screen is open off it. */
export function upcoming(posts: Post[], now: number = Date.now()): Post[] {
  return posts.filter((p) => p.kind === 'event' && p.eventAt != null && p.eventAt > now)
    .sort((a, b) => a.eventAt! - b.eventAt!);
}

/** "Sat 26 Sep, 18:30" in the phone's own locale. */
export function eventWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/* ── shaping reads ─────────────────────────────────────────────────────── */

export interface RawPost {
  id: string | null; author_id: string | null; author_name: string | null; author_role: string | null;
  channel: string | null; body: string | null; created_at: string | null; hidden_at: string | null;
  kind?: string | null; image_path?: string | null; url?: string | null; event_at?: string | null; event_place?: string | null;
}

export interface Post {
  id: string; authorId: string; authorName: string; authorRole: AuthorRole;
  channel: Channel; body: string; createdAt: number; hidden: boolean;
  kind: PostKind; imagePath: string | null; url: string | null; eventAt: number | null; eventPlace: string | null;
}

export type Comment = Omit<Post, 'channel' | 'kind' | 'imagePath' | 'url' | 'eventAt' | 'eventPlace'> & { postId: string };
export interface RawComment extends Omit<RawPost, 'channel' | 'kind' | 'image_path' | 'url' | 'event_at' | 'event_place'> { post_id: string | null }

const isRole = (r: unknown): r is AuthorRole => r === 'owner' || r === 'trainer' || r === 'client';

function shapeOne(r: RawPost | RawComment, bodyMayBeEmpty = false) {
  const t = r.created_at ? Date.parse(r.created_at) : NaN;
  if (!r.id || !r.author_id || !Number.isFinite(t)) return null;
  if (!r.body && !bodyMayBeEmpty) return null;
  return {
    id: r.id, authorId: r.author_id,
    authorName: (r.author_name || '').trim() || (r.author_role === 'client' ? 'Member' : 'Coach'),
    authorRole: isRole(r.author_role) ? r.author_role : 'client',
    body: r.body ?? '', createdAt: t, hidden: !!r.hidden_at,
  };
}

/** Rows safe to draw, in the order given. A row missing its id, author, time,
 *  or both its words and its photo, is dropped rather than drawn with a guess
 *  in the gap; so is an event without a readable time or a resource without an
 *  https link. */
export function shapePosts(rows: RawPost[] | null | undefined): Post[] {
  const out: Post[] = [];
  for (const r of rows ?? []) {
    const imagePath = isCommunityImagePath(r.image_path) ? r.image_path! : null;
    const s = shapeOne(r, !!imagePath);
    if (!s || (r.channel !== 'members' && r.channel !== 'coaches')) continue;
    const kind: PostKind = r.kind === 'resource' || r.kind === 'event' ? r.kind : 'post';
    const url = r.url && !urlProblem(r.url) ? r.url.trim() : null;
    const ev = r.event_at ? Date.parse(r.event_at) : NaN;
    const eventAt = Number.isFinite(ev) ? ev : null;
    if (kind === 'resource' && !url) continue;
    if (kind === 'event' && eventAt == null) continue;
    out.push({ ...s, channel: r.channel, kind, imagePath, url, eventAt, eventPlace: (r.event_place || '').trim() || null });
  }
  return out;
}

export function shapeComments(rows: RawComment[] | null | undefined): Comment[] {
  const out: Comment[] = [];
  for (const r of rows ?? []) {
    const s = shapeOne(r);
    if (s && r.post_id) out.push({ ...s, postId: r.post_id });
  }
  return out;
}

export interface LikeState { count: number | null; mine: boolean }

/**
 * Likes on one post, from a read of the like rows for the page on screen.
 * The count is given only when that read was whole; `mine` is true whenever
 * the caller's own row came back, because a row that came back is a fact.
 */
export function likeState(status: LoadStatus, rows: { post_id: string; user_id: string }[], postId: string, me: string | null): LikeState {
  const on = rows.filter((r) => r.post_id === postId);
  return { count: status === 'ready' ? on.length : null, mine: !!me && on.some((r) => r.user_id === me) };
}

/** The one line a feed shows instead of posts, or null when it shows posts. */
export function feedStateLine(status: LoadStatus, count: number, channel: Channel, kind: PostKind = 'post'): string | null {
  if (status === 'error') return 'We couldn’t read the community just now. This is a connection problem, not an empty board.';
  if (status === 'loading' && count === 0) return 'Loading the community…';
  if (status === 'ready' && count === 0) {
    if (kind === 'resource') return 'No coach has shared a resource yet.';
    if (kind === 'event') return 'No upcoming events.';
    return channel === 'coaches' ? 'No coach has posted here yet.' : 'Nothing has been posted yet. Say hello.';
  }
  return null;
}

/** Said under a feed that was cut, so the end of the list is not read as the
 *  start of the gym's history. */
export const FEED_CUT_LINE = `These are the newest ${FEED_CAP} posts. Older posts are still there.`;

export function roleLabel(r: AuthorRole): string | null {
  return r === 'owner' ? 'Owner' : r === 'trainer' ? 'Coach' : null;
}

export function canModerate(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'trainer';
}

/** "Just now", "5m", "3h", "2d", then a date. */
export function ago(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString();
}
