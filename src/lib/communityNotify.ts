// What part 3320's three triggers write into a person's notifications, in one
// place the tests can read. The SQL is the sender; this is its mirror, and
// communityNotify.test.ts fails if the two stop saying the same words.
//
// Nothing on a handset sends these. The rows are written by triggers on
// assessments, community_comments and community_reports, and part 900's
// dispatcher pushes them on the 'clients' channel with quiet hours applied.

export type NotifyRole = 'client' | 'trainer' | 'owner';

export const ASSESSMENT_TITLE = 'New Assessment Recorded';
export const REPLY_TITLE = 'New Reply To Your Post';
export const REPORT_TITLE = 'New Report In Community';

export function assessmentBody(label: string, hasPrior: boolean): string {
  return `${label} · ${hasPrior ? 'See how it compares with last time' : 'See your first result'}`;
}

export function replyBody(authorName: string): string {
  return `${authorName.trim() || 'Someone'} replied to your post.`;
}

const REASON_WORDS: Record<string, string> = {
  spam: 'spam', harassment: 'harassment', hate: 'hate speech',
  sexual: 'sexual content', violence: 'violence',
};

/** Never quotes the reported words: they would land on a lock screen. */
export function reportBody(target: 'post' | 'comment', reason: string): string {
  return `A ${target} was reported for ${REASON_WORDS[reason] ?? 'another reason'}. Open Community to review it.`;
}

export function communityRoute(role: NotifyRole | null | undefined): string {
  return role === 'owner' ? '/(owner)/community' : role === 'trainer' ? '/(trainer)/community' : '/(client)/community';
}

/** Whether a reply reaches the post's author. Own replies and any block,
 *  either way round, notify nobody. */
export function replyNotifies(
  postAuthor: string, commenter: string,
  blocks: ReadonlyArray<{ blocker: string; blocked: string }>,
): boolean {
  if (postAuthor === commenter) return false;
  return !blocks.some((b) =>
    (b.blocker === postAuthor && b.blocked === commenter) || (b.blocker === commenter && b.blocked === postAuthor));
}
