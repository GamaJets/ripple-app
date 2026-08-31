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
// owner sends, and tickets from `useOwnerOps` plus real in-app feedback rows.
// Nothing is seeded, so each tab now says so honestly instead of rendering a
// blank stretch of screen.
//
// The Activity tab is the exception, and says so on itself. Its `activity` is
// `seedActivity` in src/ui/ownerOps.tsx — a module-level `[]` that no code path
// in this repository writes to — while the copy over it promised that "trials,
// plan changes and suspensions land here as they happen". They cannot: the
// actions it names were deleted when this app stopped being a subscription
// console, and nothing replaced them with a write. So an owner was watching an
// empty feed for events that were never coming, and would have read the silence
// as a quiet month. The tab now states what it is rather than inventing rows to
// fill it.
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
  // `activity` is deliberately not taken from the provider any more: it is a
  // module-level empty array nothing writes to, and reading it here is what made
  // the Activity tab look like a feed waiting for its first event.
  const { anns, addAnn, tickets, resolveTicket, openTickets } = useOwnerOps();
  const [localResolved, setLocalResolved] = useState<Record<string, boolean>>({});
  // null is the inbox we do not have: it is the initial value AND what
  // fetchAllFeedback returns for a refused read, which is deliberate — see the
  // note on that function. It used to be collapsed here with `d ?? []`, one line
  // under a comment saying null means unread rather than empty, and the tab then
  // asserted "No tickets. Feedback sent from inside the app lands here." That is
  // the sentence you least want to be wrong about during a test round: it says
  // the testers are silent when what happened is that we could not hear them.
  const [fbRows, setFbRows] = useState<FeedbackRow[] | null>(null);
  // Which of the two nulls this is. Without it "still reading" and "the read
  // came back refused" draw the same screen and neither can be acted on.
  const [fbFailed, setFbFailed] = useState(false);
  // The await is guarded: an unhandled rejection here left the support inbox on
  // its initial [] with no record that anything had gone wrong, and the tab
  // stated "No tickets." over a read that never returned.
  useEffect(() => {
    let c = false;
    (async () => {
      try { const d = await fetchAllFeedback(); if (!c) { setFbRows(d); setFbFailed(d === null); } }
      catch (e) { reportError('ownerOps.feedback', e); if (!c) { setFbRows(null); setFbFailed(true); } }
    })();
    return () => { c = true; };
  }, []);
  const inboxKnown = fbRows != null;
  const fbTickets = (fbRows ?? []).map((r) => ({ id: 'fb' + r.id, subject: (r.category || 'Feedback') + (r.rating ? ' · ' + '★'.repeat(r.rating) : ''), from: (r.role || 'Client') + (r.appVersion ? ' · v' + r.appVersion : ''), body: r.body, resolved: !!localResolved['fb' + r.id] }));
  const allTickets = [...fbTickets, ...tickets];
  const resolveAny = (id: string) => { if (id.startsWith('fb')) setLocalResolved((p) => ({ ...p, [id]: true })); else resolveTicket(id); };
  const openCount = allTickets.filter((x) => !x.resolved).length;
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
          {/* The open count is only offered when the inbox is actually in hand:
              a badge counting the tickets we managed to read is a smaller
              number than the truth, and reads as the whole of it. */}
          {([['announce', 'Announce'], ['support', `Support${inboxKnown && openCount ? ' (' + openCount + ')' : ''}`], ['activity', 'Activity']] as const).map(([k, label]) => (
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
              <SectionHead title="New Announcement" />
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
              {/* "All resolved" is a claim about every ticket there is, so it
                  needs the whole inbox behind it. */}
              <SectionHead title="Support Inbox" note={inboxKnown && allTickets.length ? (openCount ? `${openCount} open` : 'All resolved') : undefined} />
              {fbFailed ? (
                // Tickets held on this device still show below — they are real —
                // but they are not the inbox, and saying nothing here would let
                // however many of them there are stand in for all of it.
                <Empty tone={t.warn}>
                  The support inbox could not be read. This is not "no tickets" — feedback sent from inside the app
                  may be waiting, and nothing on this screen has ruled that out.
                </Empty>
              ) : !inboxKnown ? (
                <Empty tone={t.ink3}>Reading the support inbox…</Empty>
              ) : allTickets.length === 0 ? (
                <Empty tone={t.ink3}>No tickets. Feedback sent from inside the app lands here.</Empty>
              ) : null}
              {allTickets.map((tk, i) => {
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
              <SectionHead title="Platform Activity" />
              {/* No feed exists to be empty. The previous copy — "Nothing yet —
                  trials, plan changes and suspensions land here as they happen"
                  — described a stream that is not being written: the array
                  behind it has no writer anywhere in the app, and the three
                  events it named were removed with the subscription console.
                  An owner reading it would take an empty screen for a quiet
                  month at their gym. Saying so plainly is the fix; inventing a
                  feed to fill it is not. */}
              <Empty tone={t.ink3}>
                Nothing records platform activity yet. This is not a quiet stretch at your gym — no event log
                is being written at all, so this tab will stay empty until one is.
              </Empty>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                What your gym actually did is on the screens that read it: sessions on Revenue, staff on
                Trainers, memberships and payments on Members.
              </Text>
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
