// A gym's community board: the pure half. Tables, policies and the reasons for
// them are in supabase/parts/3300-a-gyms-community-is-its-own.sql; the reads
// and writes are src/ui/community.ts; the screens draw src/ui/CommunityFeed.tsx.
//
// Same rule as src/lib/challenges.ts, because this is also about other people:
// no sentence about what the gym has posted is written unless the read
// established it. An empty feed under a failed read is "we could not read it",
// never "nothing has been posted", and a like count over a truncated read of
// likes is not a count.
import type { LoadStatus } from '../ui/loadStatus';

export type Channel = 'members' | 'coaches';
export type AuthorRole = 'owner' | 'trainer' | 'client';

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

/** Why this text cannot be sent, or null when it can. */
export function composeProblem(text: string, max: number): string | null {
  const s = text.trim();
  if (!s) return 'Write something first.';
  if (s.length > max) return `That is ${s.length - max} characters over the limit of ${max}.`;
  if (objectionableWord(s)) return 'That includes language this community does not allow. Please reword it.';
  return null;
}

/* ── shaping reads ─────────────────────────────────────────────────────── */

export interface RawPost {
  id: string | null; author_id: string | null; author_name: string | null; author_role: string | null;
  channel: string | null; body: string | null; created_at: string | null; hidden_at: string | null;
}

export interface Post {
  id: string; authorId: string; authorName: string; authorRole: AuthorRole;
  channel: Channel; body: string; createdAt: number; hidden: boolean;
}

export type Comment = Omit<Post, 'channel'> & { postId: string };
export interface RawComment extends Omit<RawPost, 'channel'> { post_id: string | null }

const isRole = (r: unknown): r is AuthorRole => r === 'owner' || r === 'trainer' || r === 'client';

function shapeOne(r: RawPost | RawComment) {
  const t = r.created_at ? Date.parse(r.created_at) : NaN;
  if (!r.id || !r.author_id || !r.body || !Number.isFinite(t)) return null;
  return {
    id: r.id, authorId: r.author_id,
    authorName: (r.author_name || '').trim() || (r.author_role === 'client' ? 'Member' : 'Coach'),
    authorRole: isRole(r.author_role) ? r.author_role : 'client',
    body: r.body, createdAt: t, hidden: !!r.hidden_at,
  };
}

/** Rows safe to draw, in the order given. A row missing its id, author, body
 *  or time is dropped rather than drawn with a guess in the gap. */
export function shapePosts(rows: RawPost[] | null | undefined): Post[] {
  const out: Post[] = [];
  for (const r of rows ?? []) {
    const s = shapeOne(r);
    if (s && (r.channel === 'members' || r.channel === 'coaches')) out.push({ ...s, channel: r.channel });
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
export function feedStateLine(status: LoadStatus, count: number, channel: Channel): string | null {
  if (status === 'error') return 'We couldn’t read the community just now. This is a connection problem, not an empty board.';
  if (status === 'loading' && count === 0) return 'Loading the community…';
  if (status === 'ready' && count === 0) {
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
