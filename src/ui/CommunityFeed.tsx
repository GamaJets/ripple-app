// The community board, drawn the same way in all three apps: the client's
// Community, the coach's Members / Coaches channels, and the owner's view of
// the members channel. What each app may do is a prop here and a policy in
// part 3300; the prop only decides which controls are offered.
//
// Apple guideline 1.2 in the UI: rules accepted before a first post or
// comment, Report on every post and comment, Block on every author, Hide From
// My Feed on every post, and moderators' Hide For Everyone.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert } from 'react-native';
import { useTheme } from './components';
import { useAuth } from './auth';
import { Card, Cta, Ghost, Flag, TonedChip, Rule, Section, SectionHead } from './kit';
import { Icon } from './Icon';
import { sp, layout, radius, elevation, type as ty, numeric, font } from '../theme/scale';
import { BRAND } from '../lib/brands';
import {
  COMMENT_MAX, COMMUNITY_RULES, FEED_CUT_LINE, POST_MAX, REPORT_REASONS,
  ago, composeProblem, feedStateLine, likeState, reasonLabel, roleLabel, rulesContactLine,
  type Channel, type Post, type ReportReason,
} from '../lib/community';
import { report, useComments, useCommunityFeed, useCommunityReports, useCommunityRules, type ReportRow } from './community';

type Target = { kind: 'post' | 'comment'; id: string; authorId: string; authorName: string; hidden: boolean };

function useField() {
  const t = useTheme();
  return {
    ...ty.body, color: t.ink, backgroundColor: t.surface2,
    borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 80, textAlignVertical: 'top' as const,
  };
}

/** A bottom sheet. */
function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, maxHeight: '85%', ...elevation.e2 }}>
        <ScrollView contentContainerStyle={{ padding: layout.gutter, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          {children}
          <Pressable onPress={onClose} style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: sp.sm }} accessibilityRole="button">
            <Text style={{ ...ty.label, ...font('500'), color: t.ink3 }}>Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The rules, and the one button that accepts them. */
function RulesSheet({ open, onClose, onAccepted }: { open: boolean; onClose: () => void; onAccepted: () => void }) {
  const t = useTheme();
  const rules = useCommunityRules();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose}>
      <Text style={{ ...ty.title, color: t.ink }}>Community Rules</Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>This community is private to your gym. Agree to these before your first post.</Text>
      {COMMUNITY_RULES.map((r, i) => (
        <Flag key={i} tone={t.brand} style={{ marginTop: sp.md }}>{r}</Flag>
      ))}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{rulesContactLine(BRAND.supportEmail)}</Text>
      <View style={{ marginTop: sp.lg }}>
        <Cta label="I Agree" wide disabled={busy} onPress={async () => {
          setBusy(true); setErr(null);
          const o = await rules.accept();
          setBusy(false);
          if (o) setErr(o); else onAccepted();
        }} />
      </View>
      {err ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{err}</Flag> : null}
    </Sheet>
  );
}

/** A text box and a send button, behind the rules. */
function Composer({ max, placeholder, label, onSend }: {
  max: number; placeholder: string; label: string; onSend: (body: string) => Promise<string | null>;
}) {
  const t = useTheme();
  const field = useField();
  const rules = useCommunityRules();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  if (rules.accepted === null) {
    return (
      <View style={{ paddingVertical: sp.md, gap: sp.sm }}>
        <Text style={{ ...ty.caption, color: t.ink3 }}>Checking whether you have agreed to the community rules…</Text>
        <View style={{ alignSelf: 'flex-start' }}><Ghost label="Check Again" onPress={rules.reload} /></View>
      </View>
    );
  }
  if (!rules.accepted) {
    return (
      <View style={{ paddingVertical: sp.md }}>
        <Cta label="Read the Rules to Post" wide onPress={() => setRulesOpen(true)} />
        <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} onAccepted={() => { setRulesOpen(false); rules.reload(); }} />
      </View>
    );
  }
  return (
    <View style={{ paddingVertical: sp.md, gap: sp.sm }}>
      <TextInput value={text} onChangeText={(s) => { setText(s); setErr(null); }} placeholder={placeholder} placeholderTextColor={t.ink3}
        multiline maxLength={max + 200} accessibilityLabel={placeholder} style={field} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ ...ty.caption, ...numeric, color: text.trim().length > max ? t.ink : t.ink3, ...(text.trim().length > max ? font('700') : null) }}>{text.trim().length > max ? `Too Long: ${text.trim().length} / ${max}` : `${text.trim().length} / ${max}`}</Text>
        <Cta label={label} disabled={busy || !text.trim()} onPress={async () => {
          const why = composeProblem(text, max);
          if (why) { setErr(why); return; }
          setBusy(true);
          const o = await onSend(text);
          setBusy(false);
          if (o) setErr(o); else setText('');
        }} />
      </View>
      {err ? <Flag tone={t.warn}>{err}</Flag> : null}
    </View>
  );
}

/** Report, block, hide and moderate one post or comment. */
function ActionsSheet({ target, me, moderator, onClose, onHideForMe, onBlock, onDelete, onModerate }: {
  target: Target | null; me: string | null; moderator: boolean; onClose: () => void;
  onHideForMe?: (id: string) => Promise<string | null>;
  onBlock: (userId: string) => Promise<string | null>;
  onDelete: (t: Target) => Promise<string | null>;
  onModerate: (t: Target, hide: boolean) => Promise<string | null>;
}) {
  const t = useTheme();
  const [step, setStep] = useState<'menu' | 'report' | 'done'>('menu');
  const [msg, setMsg] = useState<string | null>(null);
  const close = () => { setStep('menu'); setMsg(null); onClose(); };
  const run = async (p: Promise<string | null>, done?: string) => {
    const o = await p;
    if (o) { setMsg(o); return; }
    if (done) { setMsg(done); setStep('done'); } else close();
  };
  if (!target) return null;
  const mine = !!me && target.authorId === me;
  const noun = target.kind === 'post' ? 'Post' : 'Comment';

  return (
    <Sheet open={!!target} onClose={close}>
      {step === 'menu' ? (
        <View style={{ gap: sp.sm }}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.sm }}>{mine ? `Your ${noun}` : `${noun} by ${target.authorName}`}</Text>
          {!mine ? <Ghost label={`Report ${noun}`} icon="info" onPress={() => { setMsg(null); setStep('report'); }} /> : null}
          {!mine && target.kind === 'post' && onHideForMe ? (
            <Ghost label="Hide From My Feed" icon="eye-off" onPress={() => run(onHideForMe(target.id))} />
          ) : null}
          {!mine ? (
            <Ghost label={`Block ${target.authorName}`} icon="lock" onPress={() => Alert.alert(
              `Block ${target.authorName}?`,
              'You will stop seeing their posts and comments. They are not told.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: () => { void run(onBlock(target.authorId)); } }],
            )} />
          ) : null}
          {moderator ? (
            <Ghost label={target.hidden ? 'Show to Everyone Again' : 'Hide for Everyone'} icon={target.hidden ? 'eye' : 'eye-off'}
              onPress={() => run(onModerate(target, !target.hidden))} />
          ) : null}
          {mine ? (
            <Ghost label={`Delete ${noun}`} onPress={() => Alert.alert(
              `Delete this ${noun.toLowerCase()}?`, 'This cannot be undone.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void run(onDelete(target)); } }],
            )} />
          ) : null}
        </View>
      ) : step === 'report' ? (
        <View style={{ gap: sp.sm }}>
          <Text style={{ ...ty.title, color: t.ink }}>What Is Wrong With It?</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>Your gym’s owner and coaches see the report. {target.authorName} is not told who sent it.</Text>
          {REPORT_REASONS.map((r) => (
            <Ghost key={r.key} label={r.label} onPress={() => run(
              report(target.kind === 'post' ? { postId: target.id } : { commentId: target.id }, r.key as ReportReason),
              'Thank you. Your report has gone to your gym’s moderators. You can also block this person or hide the post.',
            )} />
          ))}
        </View>
      ) : null}
      {msg ? <Flag tone={step === 'done' ? t.brand : t.warn} style={{ marginTop: sp.md }}>{msg}</Flag> : null}
    </Sheet>
  );
}

/** One post's comments, and a box to add one. */
function CommentsSheet({ post, me, moderator, canPost, onClose, onBlock }: {
  post: Post | null; me: string | null; moderator: boolean; canPost: boolean; onClose: () => void;
  onBlock: (userId: string) => Promise<string | null>;
}) {
  const t = useTheme();
  const c = useComments(post?.id ?? null);
  const [target, setTarget] = useState<Target | null>(null);
  if (!post) return null;
  return (
    <Sheet open={!!post} onClose={onClose}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{post.authorName} · {ago(post.createdAt)}</Text>
      <Text style={{ ...ty.body, color: t.ink, marginTop: sp.xs }}>{post.body}</Text>
      <Rule />
      {c.status === 'error' ? (
        <View style={{ paddingVertical: sp.md, gap: sp.sm }}>
          <Text style={{ ...ty.label, color: t.ink2 }}>We couldn’t read the comments. That is a connection problem, not an empty thread.</Text>
          <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try Again" onPress={c.reload} /></View>
        </View>
      ) : c.status === 'loading' && !c.list.length ? (
        <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.md }}>Loading comments…</Text>
      ) : c.status === 'ready' && !c.list.length ? (
        <Text style={{ ...ty.caption, color: t.ink3, paddingVertical: sp.md }}>No comments yet.</Text>
      ) : null}
      {c.list.map((x) => (
        <Pressable key={x.id} onPress={() => setTarget({ kind: 'comment', id: x.id, authorId: x.authorId, authorName: x.authorName, hidden: x.hidden })}
          accessibilityRole="button" accessibilityLabel={`${x.authorName}: ${x.body}. Options`}
          style={{ paddingVertical: sp.sm }}>
          <Text style={{ ...ty.caption, ...font('500'), color: t.ink2 }}>
            {x.authorName}{roleLabel(x.authorRole) ? ` · ${roleLabel(x.authorRole)}` : ''} · {ago(x.createdAt)}{x.hidden ? ' · Hidden' : ''}
          </Text>
          <Text style={{ ...ty.body, color: x.hidden ? t.ink3 : t.ink }}>{x.body}</Text>
        </Pressable>
      ))}
      {c.status === 'partial' ? <Text style={{ ...ty.caption, color: t.ink3 }}>These are the first comments, not all of them.</Text> : null}
      {canPost && !post.hidden ? <Composer max={COMMENT_MAX} placeholder="Write a comment" label="Reply" onSend={c.add} /> : null}
      <ActionsSheet target={target} me={me} moderator={moderator} onClose={() => setTarget(null)}
        onBlock={async (id) => { const o = await onBlock(id); if (!o) await c.reload(); return o; }}
        onDelete={(x) => c.remove(x.id)} onModerate={(x, hide) => c.moderate(x.id, hide)} />
    </Sheet>
  );
}

export function CommunityFeed({ channel, canPost, moderator }: { channel: Channel; canPost: boolean; moderator: boolean }) {
  const t = useTheme();
  const { user } = useAuth();
  const me = user?.id ?? null;
  const feed = useCommunityFeed(channel);
  const [target, setTarget] = useState<Target | null>(null);
  const [thread, setThread] = useState<Post | null>(null);
  const [likeErr, setLikeErr] = useState<string | null>(null);
  const stateLine = feedStateLine(feed.status, feed.posts.length, channel);

  return (
    <View>
      {canPost ? (
        <Composer max={POST_MAX} label="Post" onSend={feed.publish}
          placeholder={channel === 'coaches' ? 'Share with the other coaches' : 'Share something with your gym'} />
      ) : null}

      {stateLine ? (
        <View style={{ paddingVertical: sp.lg, gap: sp.sm }}>
          <Text style={{ ...ty.label, color: feed.status === 'error' ? t.ink2 : t.ink3 }}>{stateLine}</Text>
          {feed.status === 'error' ? <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try Again" onPress={feed.reload} /></View> : null}
        </View>
      ) : null}
      {likeErr ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{likeErr}</Flag> : null}

      {feed.posts.map((p) => {
        const l = likeState(feed.likeStatus, feed.likes, p.id, me);
        const role = roleLabel(p.authorRole);
        return (
          <Card key={p.id} style={{ marginTop: sp.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Text style={{ ...ty.head, color: t.ink, flexShrink: 1 }}>{p.authorName}</Text>
              {role ? <TonedChip label={role} tone="purple" /> : null}
              {p.hidden ? <TonedChip label="Hidden" tone="red" /> : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginStart: 'auto' }}>{ago(p.createdAt)}</Text>
            </View>
            <Text style={{ ...ty.body, color: p.hidden ? t.ink3 : t.ink, marginTop: sp.sm }}>{p.body}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg, marginTop: sp.md }}>
              <Pressable disabled={!me || p.hidden} accessibilityRole="button"
                accessibilityLabel={`${l.mine ? 'Unlike' : 'Like'}${l.count != null ? `. ${l.count} likes` : ''}`}
                onPress={async () => { setLikeErr(null); const o = await feed.like(p.id, !l.mine, me!); if (o) setLikeErr(o); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
                <Icon name="heart" size={18} filled={l.mine} color={l.mine ? t.brand : t.ink3} />
                {/* A dash, not a zero, when the like read was not whole. */}
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{l.count != null ? l.count : '–'}</Text>
              </Pressable>
              <Pressable onPress={() => setThread(p)} accessibilityRole="button" accessibilityLabel="Comments"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
                <Icon name="chat" size={18} color={t.ink3} />
                <Text style={{ ...ty.caption, color: t.ink3 }}>Comments</Text>
              </Pressable>
              <Pressable onPress={() => setTarget({ kind: 'post', id: p.id, authorId: p.authorId, authorName: p.authorName, hidden: p.hidden })}
                accessibilityRole="button" accessibilityLabel="Report, block or hide" style={{ marginStart: 'auto', minHeight: 44, justifyContent: 'center', paddingHorizontal: sp.sm }}>
                <Text style={{ ...ty.head, color: t.ink3 }}>•••</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}

      {feed.status === 'partial' ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{FEED_CUT_LINE}</Text> : null}

      <ActionsSheet target={target} me={me} moderator={moderator} onClose={() => setTarget(null)}
        onHideForMe={feed.hideForMe} onBlock={feed.block}
        onDelete={(x) => feed.remove(x.id)} onModerate={(x, hide) => feed.moderatePost(x.id, hide)} />
      <CommentsSheet post={thread} me={me} moderator={moderator} canPost={canPost} onClose={() => setThread(null)}
        onBlock={feed.block} />
    </View>
  );
}

/** Open reports for a moderator: hide the thing, or dismiss the report. */
export function CommunityReports() {
  const t = useTheme();
  const r = useCommunityReports();
  const [err, setErr] = useState<string | null>(null);
  const act = async (x: ReportRow, o: 'hidden' | 'dismissed') => { setErr(null); const why = await r.resolve(x, o); if (why) setErr(why); };

  return (
    <Section>
      <SectionHead title="Reports" note={r.status === 'ready' ? (r.list.length ? `${r.list.length} Open` : undefined) : undefined} />
      {r.status === 'error' ? (
        <View style={{ gap: sp.sm }}>
          <Text style={{ ...ty.label, color: t.ink2 }}>We couldn’t read the reports. That is a connection problem, not an empty queue.</Text>
          <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try Again" onPress={r.reload} /></View>
        </View>
      ) : r.status === 'loading' && !r.list.length ? (
        <Text style={{ ...ty.caption, color: t.ink3 }}>Loading reports…</Text>
      ) : r.status === 'ready' && !r.list.length ? (
        <Text style={{ ...ty.caption, color: t.ink3 }}>No open reports.</Text>
      ) : null}
      {r.list.map((x) => (
        <Card key={x.id} style={{ marginTop: sp.md }}>
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            <TonedChip label={reasonLabel(x.reason)} tone="red" />
            <Text style={{ ...ty.caption, color: t.ink3 }}>{x.target ? `${x.target.kind === 'post' ? 'Post' : 'Comment'} by ${x.target.authorName}` : 'No longer readable'} · {ago(x.createdAt)}</Text>
          </View>
          {x.target ? <Text style={{ ...ty.body, color: t.ink, marginTop: sp.sm }}>{x.target.body}</Text> : null}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            {x.target && !x.target.hidden ? <Cta label="Hide It" onPress={() => act(x, 'hidden')} /> : null}
            <Ghost label={x.target?.hidden ? 'Close Report' : 'Dismiss'} onPress={() => act(x, 'dismissed')} />
          </View>
        </Card>
      ))}
      {r.status === 'partial' ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>These are the newest reports, not all of them.</Text> : null}
      {err ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{err}</Flag> : null}
    </Section>
  );
}
