// Client · Notices. Everything a coach or a gym has posted to this person,
// oldest ones included.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// `announcements` had exactly one reader in the app: the client dashboard,
// which showed the LATEST row and nothing else. So a gym owner posting "we are
// closed Monday" reached the members who happened to open their home screen
// that day; everybody else found out by turning up. And the day after, when a
// second notice pushed the first one out of that single slot, the first was
// readable nowhere in the product at all — not in the inbox, which had no row
// for it, and not in any history, because there was none.
//
// A notice that cannot be re-read is a notice half the gym never received. This
// is the other half of the fix; the fan-out in src/ui/announcements.tsx is the
// first half.
//
// ── It re-reads nothing ────────────────────────────────────────────────────
//
// Every row here comes from the provider that app/_layout.tsx already mounts,
// which is the same store the dashboard block reads. That matters beyond the
// saved request: a screen with its own query would have its own idea of what
// arrived, and the two would disagree the first time one of them failed. There
// is one read and one `status`, and this screen states what that status means
// rather than deciding it again.
//
// ── An empty list is two different sentences ───────────────────────────────
//
// Under 'ready' nothing has been posted. Under 'error' we could not find out,
// and "nothing has been posted" said to somebody whose gym closes tomorrow is
// exactly the failure src/ui/loadStatus.ts exists to prevent. The two are drawn
// differently and only one of them is a statement about the gym.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { useAnnouncements } from '../../src/ui/announcements';
import { inboxAge } from '../../src/lib/notifyInbox';

export default function Notices() {
  const t = useTheme();
  const router = useRouter();
  const { announcements, status } = useAnnouncements();

  // A client authors nothing here, so everything they can read is addressed to
  // them. `mine` is filtered anyway rather than assumed: this store is shared
  // with the coach and the owner apps, and a screen that assumed its reader
  // never wrote one would list an author's own notices back to them as though
  // somebody had sent them.
  const rows = announcements.filter((a) => !a.mine);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your gym and your coach</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Notices</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Everything posted to you, newest first. Notices stay here after the day they were sent.
        </Text>

        <Rule />

        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not read" title="We couldn’t read your notices"
              note={rows.length
                ? 'What is below is what we had before the read failed. There may be a newer notice that is not on this list.'
                : 'This is not an empty noticeboard — it is one we could not open. Try again in a moment, or ask at the desk.'} />
          </Section>
        ) : null}

        {status === 'partial' ? (
          <Section><PartialRead what="notices" shown={rows.length} /></Section>
        ) : null}

        <Section>
          <SectionHead title="Posted To You" note={status === 'ready' && rows.length ? String(rows.length) : undefined} />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your notices…</Text>
          ) : rows.length === 0 ? (
            // Only said under 'ready'. Under 'error' the banner above has the
            // page and this sentence never appears — see the header.
            status === 'ready' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Nothing has been posted to you yet. When your gym or your coach posts a notice it appears here, and stays.
              </Text>
            ) : null
          ) : rows.map((a, i) => (
            <View key={a.id} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
                {/* Who it is from is a heading this app writes; the words below
                    are theirs, verbatim. The two are never blended — see the
                    note in src/lib/notifyCopy.ts on writing under a name. */}
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {a.kind === 'coach' ? 'From your coach' : 'From your gym'}
                </Text>
                <Text style={{ ...ty.caption, color: t.ink3 }}>{inboxAge(a.at)}</Text>
              </View>
              <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.xs }}>{a.body}</Text>
            </View>
          ))}
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            A notice is one-way. Replying to your coach happens in your messages, and nobody is told whether you read this.
          </Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
