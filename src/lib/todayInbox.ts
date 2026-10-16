/**
 * The coach's Today inbox: the Needs Attention queue split into the kinds
 * of job a coach does in one pass (reply to everyone who wrote, then the
 * check-ins, then the plans, then the money).
 *
 * This is a pure grouping of the queue the dashboard has already built. It
 * never adds a person, and it drops nobody: every attention kind maps to
 * exactly one bucket, and 'all' is the queue itself.
 */
export type AttnKind = 'drift' | 'adherence' | 'unread' | 'plan' | 'owed' | 'credits' | 'setup';
export type InboxBucket = 'all' | 'reply' | 'checkin' | 'plan' | 'money';

export const BUCKET_OF: Record<AttnKind, Exclude<InboxBucket, 'all'>> = {
  unread: 'reply',
  drift: 'checkin',
  adherence: 'checkin',
  plan: 'plan',
  setup: 'plan',
  owed: 'money',
  credits: 'money',
};

export const BUCKET_LABEL: Record<InboxBucket, string> = {
  all: 'All',
  reply: 'Replies',
  checkin: 'Check-ins',
  plan: 'Programs',
  money: 'Payments',
};

const ORDER: InboxBucket[] = ['all', 'reply', 'checkin', 'plan', 'money'];

/** Counts per bucket. A person with no kind (null) counts only under 'all'. */
export function inboxCounts(kinds: readonly (AttnKind | null)[]): Record<InboxBucket, number> {
  const out: Record<InboxBucket, number> = { all: kinds.length, reply: 0, checkin: 0, plan: 0, money: 0 };
  for (const k of kinds) if (k) out[BUCKET_OF[k]] += 1;
  return out;
}

/**
 * The tabs worth drawing: 'all' always, and every other bucket that has
 * somebody in it. With a single kind of job in the queue no tabs are drawn,
 * because a filter that can only show the same list is just noise.
 */
export function inboxTabs(kinds: readonly (AttnKind | null)[]): { key: InboxBucket; label: string; count: number }[] {
  const n = inboxCounts(kinds);
  const tabs = ORDER.filter((b) => b === 'all' || n[b] > 0).map((b) => ({ key: b, label: BUCKET_LABEL[b], count: n[b] }));
  return tabs.length > 2 ? tabs : [];
}

export function inBucket(kind: AttnKind | null, bucket: InboxBucket): boolean {
  return bucket === 'all' || (kind != null && BUCKET_OF[kind] === bucket);
}
