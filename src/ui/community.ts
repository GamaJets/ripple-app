// Reads and writes for the community board (part 3300). RLS decides who sees
// what: the channel, the tenant, blocks, personal hides and moderator-hidden
// rows are all filtered by the server, so the screen draws what comes back.
// Every write checks that it landed (src/lib/wroteRows.ts) and returns null or
// the sentence to show.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { writeFailure } from '../lib/wroteRows';
import {
  COMMUNITY_RULES_VERSION, FEED_CAP, shapeComments, shapePosts,
  type Channel, type Comment, type Post, type ReportReason,
} from '../lib/community';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export type Outcome = string | null;

const POST_COLS = 'id, author_id, author_name, author_role, channel, body, created_at, hidden_at';
const COMMENT_COLS = 'id, post_id, author_id, author_name, author_role, body, created_at, hidden_at';

/** One write, reduced to null or a sentence. `run` must ask for `count: 'exact'`. */
async function wrote(where: string, what: string, run: () => PromiseLike<{ error: unknown; count: number | null }>): Promise<Outcome> {
  if (!USE_SUPABASE) return `${what} needs an account.`;
  try {
    const r = await run();
    const why = writeFailure(what, r);
    if (why && r.error) reportError(where, r.error);
    return why;
  } catch (e) {
    reportError(where, e);
    return `${what} could not be saved.`;
  }
}

export function useCommunityFeed(channel: Channel) {
  const rev = useAuthRevision();
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [likes, setLikes] = useState<{ post_id: string; user_id: string }[]>([]);
  const [likeStatus, setLikeStatus] = useState<LoadStatus>('loading');
  const run = useRef(0);

  const reload = useCallback(async () => {
    const me = ++run.current;
    if (!USE_SUPABASE) { setPosts([]); setStatus('ready'); setLikeStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase.from('community_posts').select(POST_COLS)
        .eq('channel', channel)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit(FEED_CAP));
      if (me !== run.current) return;
      if (error) { reportError('community.feed', error); setStatus('error'); return; }
      const page = capped(data as any[] | null, FEED_CAP);
      const shaped = shapePosts(page.rows);
      setPosts(shaped);
      setStatus(page.truncated ? 'partial' : 'ready');
      if (!shaped.length) { setLikes([]); setLikeStatus('ready'); return; }
      setLikeStatus('loading');
      const l = await supabase.from('community_likes').select('post_id, user_id')
        .in('post_id', shaped.map((p) => p.id)).limit(capLimit());
      if (me !== run.current) return;
      if (l.error) { reportError('community.likes', l.error); setLikeStatus('error'); return; }
      const lp = capped(l.data as any[] | null);
      setLikes(lp.rows);
      setLikeStatus(lp.truncated ? 'partial' : 'ready');
    } catch (e) {
      if (me !== run.current) return;
      reportError('community.feed', e);
      setStatus('error');
    }
  }, [channel]);

  useEffect(() => { setPosts([]); setLikes([]); void reload(); }, [reload, rev]);

  const after = async (o: Outcome) => { if (!o) await reload(); return o; };

  return {
    posts, status, likes, likeStatus, reload,
    publish: async (body: string) => after(await wrote('community.post', 'Your post', () =>
      supabase.from('community_posts').insert({ channel, body: body.trim() }, { count: 'exact' }))),
    like: async (postId: string, on: boolean, me: string) => after(await wrote('community.like', 'That like', () =>
      on
        ? supabase.from('community_likes').insert({ post_id: postId }, { count: 'exact' })
        : supabase.from('community_likes').delete({ count: 'exact' }).eq('post_id', postId).eq('user_id', me))),
    remove: async (postId: string) => after(await wrote('community.delete', 'That post', () =>
      supabase.from('community_posts').delete({ count: 'exact' }).eq('id', postId))),
    hideForMe: async (postId: string) => after(await wrote('community.hide', 'Hiding that post', () =>
      supabase.from('community_hides').insert({ post_id: postId }, { count: 'exact' }))),
    block: async (userId: string) => after(await wrote('community.block', 'That block', () =>
      supabase.from('community_blocks').insert({ blocked_id: userId }, { count: 'exact' }))),
    /** Moderators only; RLS refuses anyone else and `wrote` says so. */
    moderatePost: async (postId: string, hide: boolean) => after(await wrote('community.moderate', 'That post', () =>
      supabase.from('community_posts').update({ hidden_at: hide ? new Date().toISOString() : null }, { count: 'exact' }).eq('id', postId))),
  };
}

export function useComments(postId: string | null) {
  const [list, setList] = useState<Comment[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const forId = useRef(postId);
  forId.current = postId;

  const reload = useCallback(async () => {
    const id = postId;
    if (!USE_SUPABASE || !id) { setList([]); setStatus(USE_SUPABASE ? 'loading' : 'ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase.from('community_comments').select(COMMENT_COLS)
        .eq('post_id', id).order('created_at').order('id').limit(capLimit());
      if (forId.current !== id) return;
      if (error) { reportError('community.comments', error); setStatus('error'); return; }
      const page = capped(data as any[] | null);
      setList(shapeComments(page.rows));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      if (forId.current !== id) return;
      reportError('community.comments', e);
      setStatus('error');
    }
  }, [postId]);

  useEffect(() => { setList([]); void reload(); }, [reload]);

  const after = async (o: Outcome) => { if (!o) await reload(); return o; };
  return {
    list, status, reload,
    add: async (body: string) => after(await wrote('community.comment', 'Your comment', () =>
      supabase.from('community_comments').insert({ post_id: postId, body: body.trim() }, { count: 'exact' }))),
    remove: async (id: string) => after(await wrote('community.comment.delete', 'That comment', () =>
      supabase.from('community_comments').delete({ count: 'exact' }).eq('id', id))),
    moderate: async (id: string, hide: boolean) => after(await wrote('community.comment.moderate', 'That comment', () =>
      supabase.from('community_comments').update({ hidden_at: hide ? new Date().toISOString() : null }, { count: 'exact' }).eq('id', id))),
  };
}

export function report(target: { postId: string } | { commentId: string }, reason: ReportReason): Promise<Outcome> {
  const row: { reason: ReportReason; post_id?: string; comment_id?: string } =
    'postId' in target ? { post_id: target.postId, reason } : { comment_id: target.commentId, reason };
  return wrote('community.report', 'Your report', () =>
    supabase.from('community_reports').insert(row, { count: 'exact' }));
}

/** Whether the caller has accepted the current rules. Null while unknown, so
 *  the screen neither shows the sheet nor lets a post through on a guess. */
export function useCommunityRules() {
  const rev = useAuthRevision();
  const [accepted, setAccepted] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    if (!USE_SUPABASE) { setAccepted(false); return; }
    setAccepted(null);
    try {
      const { data, error } = await supabase.from('community_rules_acceptance').select('version').maybeSingle();
      if (error) { reportError('community.rules', error); return; }
      setAccepted(!!data && Number(data.version) >= COMMUNITY_RULES_VERSION);
    } catch (e) { reportError('community.rules', e); }
  }, []);

  useEffect(() => { void reload(); }, [reload, rev]);

  const accept = async (): Promise<Outcome> => {
    const o = await wrote('community.rules.accept', 'Accepting the rules', () =>
      supabase.from('community_rules_acceptance')
        .upsert({ version: COMMUNITY_RULES_VERSION, accepted_at: new Date().toISOString() }, { onConflict: 'user_id', count: 'exact' }));
    if (!o) setAccepted(true);
    return o;
  };
  return { accepted, accept, reload };
}

export interface ReportRow {
  id: string; reason: string; createdAt: number;
  target: { kind: 'post' | 'comment'; id: string; body: string; authorName: string; hidden: boolean } | null;
}

/** Open reports for the moderator's gym, newest first. */
export function useCommunityReports() {
  const rev = useAuthRevision();
  const [list, setList] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const reload = useCallback(async () => {
    if (!USE_SUPABASE) { setList([]); setStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase.from('community_reports')
        .select('id, reason, created_at, community_posts(id, body, author_name, hidden_at), community_comments(id, body, author_name, hidden_at)')
        .is('resolved_at', null)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit());
      if (error) { reportError('community.reports', error); setStatus('error'); return; }
      const page = capped(data as any[] | null);
      setList(page.rows.map((r: any): ReportRow => {
        const p = r.community_posts, c = r.community_comments;
        const t = p ? { kind: 'post' as const, ...p } : c ? { kind: 'comment' as const, ...c } : null;
        return {
          id: r.id, reason: r.reason, createdAt: Date.parse(r.created_at),
          // Null when the moderator cannot read the target any more (deleted,
          // or by somebody they blocked). The report can still be dismissed.
          target: t ? { kind: t.kind, id: t.id, body: t.body, authorName: t.author_name, hidden: !!t.hidden_at } : null,
        };
      }));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('community.reports', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload, rev]);

  /** Hide the reported post or comment and close the report, or just close it. */
  const resolve = async (r: ReportRow, outcome: 'hidden' | 'dismissed'): Promise<Outcome> => {
    if (outcome === 'hidden' && r.target && !r.target.hidden) {
      const table = r.target.kind === 'post' ? 'community_posts' : 'community_comments';
      const o = await wrote('community.reports.hide', r.target.kind === 'post' ? 'That post' : 'That comment', () =>
        supabase.from(table).update({ hidden_at: new Date().toISOString() }, { count: 'exact' }).eq('id', r.target!.id));
      if (o) return o;
    }
    const o = await wrote('community.reports.resolve', 'That report', () =>
      supabase.from('community_reports').update({ outcome }, { count: 'exact' }).eq('id', r.id));
    if (!o) await reload();
    return o;
  };

  return { list, status, reload, resolve };
}
