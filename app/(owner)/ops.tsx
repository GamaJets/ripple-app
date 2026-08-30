// Owner · Operations. Announcements to trainers, support inbox, activity log.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same three tabs, same providers, same actions — the
// bordered box drawn around every announcement, ticket and event became
// hairline-separated rows, and the Georgia serif header is gone.
//
// No hero: this is a three-task console (write · triage · read), not a screen
// with one live number to lead with.
//
// Every list starts empty and fills from real activity — announcements the
// owner sends, tickets from `useOwnerOps` plus real in-app feedback rows, and
// events recorded by `usePlatformTrainers`. Nothing is seeded, so each tab now
// says so honestly instead of rendering a blank stretch of screen.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, ListRow } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useOwnerOps } from '../../src/ui/ownerOps';
import { fetchAllFeedback, type FeedbackRow } from '../../src/ui/appFeedback';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { reportError } from '../../src/lib/reportError';

function ago(iso: string) {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  if (h < 1) return 'just now'; if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`;
}

/** An honest "nothing here yet" line — these lists genuinely start empty. */
function Empty({ tone, children }: { tone: string; children: string }) {
  return <Text style={{ ...ty.label, color: tone }}>{children}</Text>;
}

export default function OwnerOps() {
  const t = useTheme();
  const router = useRouter();
  const { anns, addAnn, tickets, resolveTicket, activity, openTickets } = useOwnerOps();
  const [fbRows, setFbRows] = useState<FeedbackRow[]>([]);
  const [localResolved, setLocalResolved] = useState<Record<string, boolean>>({});
  // The await is guarded: an unhandled rejection here left the support inbox on
  // its initial [] with no record that anything had gone wrong, and the tab
  // stated "No tickets." over a read that never returned.
  useEffect(() => {
    let c = false;
    (async () => {
      // null means unread, not empty — keep it out of the row list either way.
      try { const d = await fetchAllFeedback(); if (!c) setFbRows(d ?? []); }
      catch (e) { reportError('ownerOps.feedback', e); }
    })();
    return () => { c = true; };
  }, []);
  const fbTickets = fbRows.map((r) => ({ id: 'fb' + r.id, subject: (r.category || 'Feedback') + (r.rating ? ' · ' + '★'.repeat(r.rating) : ''), from: (r.role || 'Client') + (r.appVersion ? ' · v' + r.appVersion : ''), body: r.body, resolved: !!localResolved['fb' + r.id] }));
  const allTickets = [...fbTickets, ...tickets];
  const resolveAny = (id: string) => { if (id.startsWith('fb')) setLocalResolved((p) => ({ ...p, [id]: true })); else resolveTicket(id); };
  const openCount = allTickets.filter((x) => !x.resolved).length;
  // The owner event log used to be built in memory as you clicked around —
  // "X moved to Pro", "Y suspended" — and vanished on close. Those actions no
  // longer exist, so the feed is the real activity stream and nothing else.
  const feed = [...activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const [tab, setTab] = useState<'announce' | 'support' | 'activity'>('announce');
  const [text, setText] = useState('');
  const [openT, setOpenT] = useState<string | null>(null);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Platform</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Operations</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Talk to trainers · support · platform activity</Text>
        </View>

        {/* ── the three jobs this screen does ────────────────────────────── */}
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3, marginTop: sp.lg }}>
          {([['announce', 'Announce'], ['support', `Support${openCount ? ' (' + openCount + ')' : ''}`], ['activity', 'Activity']] as const).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: tab === k ? t.brand : 'transparent' }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: tab === k ? t.brandInk : t.ink3 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'announce' ? (
          <View>
            <Section>
          <ListRow icon="calendar" title="Trainer Rota" note="Who is on the floor when, against what is booked"
            onPress={() => router.push('/(owner)/rota')} />
          <ListRow icon="wrench" title="Equipment Register" note="What the gym owns, and what is due a service"
            onPress={() => router.push('/(owner)/equipment')} />
          <ListRow icon="dumbbell" title="Exercise Library" note="Every movement the app can teach, and the kit each one needs"
            onPress={() => router.push('/(owner)/library')} />
          <ListRow icon="clock" title="Deletion Requests" note="Members who asked to be erased, and the 30-day clock"
            onPress={() => router.push('/(owner)/deletions')} />
          <ListRow icon="settings" title="Settings" note="Who you are signed in as, your data, and deleting your account"
            onPress={() => router.push('/(owner)/settings')} />
          <ListRow icon="search" title="User Guide" note="What each tab does, any time"
            onPress={() => router.push('/guide')} />
        </Section>

        <Section>
              <SectionHead title="New announcement" />
              <TextInput value={text} onChangeText={setText} placeholder="Note to self — this does not reach trainers yet…" placeholderTextColor={t.ink3} multiline
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, minHeight: 80, textAlignVertical: 'top', marginBottom: sp.md }} />
              <Cta wide label="Save Announcement"
                onPress={() => { if (!text.trim()) { Alert.alert('Write something', 'Enter an announcement.'); return; } addAnn(text); setText(''); Alert.alert('Noted', 'Saved to this device only — announcements do not reach trainers yet.'); }} />
            </Section>

            <Rule />

            <Section>
              <SectionHead title="Sent" note={anns.length ? `${anns.length} sent` : undefined} />
              {anns.length === 0 ? (
                <Empty tone={t.ink3}>Nothing sent yet — announcements you post appear here.</Empty>
              ) : anns.map((a, i) => (
                <View key={a.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.body, color: t.ink2 }}>{a.body}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{ago(a.at)}</Text>
                </View>
              ))}
            </Section>
          </View>
        ) : tab === 'support' ? (
          <View>
            <Section>
              <SectionHead title="Support inbox" note={allTickets.length ? (openCount ? `${openCount} open` : 'All resolved') : undefined} />
              {allTickets.length === 0 ? (
                <Empty tone={t.ink3}>No tickets. Feedback sent from inside the app lands here.</Empty>
              ) : allTickets.map((tk, i) => {
                const open = openT === tk.id;
                return (
                  <View key={tk.id} style={{ borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring, opacity: tk.resolved ? 0.6 : 1 }}>
                    <Pressable onPress={() => setOpenT(open ? null : tk.id)} style={{ paddingVertical: sp.md }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        {tk.resolved ? null : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />}
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{tk.subject}</Text>
                        {tk.resolved ? <Text style={{ ...ty.micro, color: t.ink3 }}>Resolved</Text> : null}
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{tk.from}</Text>
                    </Pressable>
                    {open ? (
                      <View style={{ paddingBottom: sp.md }}>
                        <Text style={{ ...ty.label, color: t.ink2 }}>{tk.body}</Text>
                        {!tk.resolved ? (
                          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                            <Cta label="Mark Resolved" onPress={() => resolveAny(tk.id)} />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Section>
          </View>
        ) : (
          <View>
            <Section>
              <SectionHead title="Platform activity" note={feed.length ? `${feed.length} events` : undefined} />
              {feed.length === 0 ? (
                <Empty tone={t.ink3}>Nothing yet — trials, plan changes and suspensions land here as they happen.</Empty>
              ) : feed.map((e, i) => (
                <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Text style={ty.head}>{e.icon}</Text>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{e.text}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{ago(e.at)}</Text>
                </View>
              ))}
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
