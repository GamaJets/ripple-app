// Owner · Operations. Announcements to trainers, support inbox, activity log.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { useOwnerOps } from '../../src/ui/ownerOps';
import { fetchAllFeedback, type FeedbackRow } from '../../src/ui/appFeedback';
import { usePlatformTrainers } from '../../src/ui/trainers';

function ago(iso: string) {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  if (h < 1) return 'just now'; if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`;
}

export default function OwnerOps() {
  const t = useTheme();
  const { anns, addAnn, tickets, resolveTicket, activity, openTickets } = useOwnerOps();
  const [fbRows, setFbRows] = useState<FeedbackRow[]>([]);
  const [localResolved, setLocalResolved] = useState<Record<string, boolean>>({});
  useEffect(() => { let c = false; (async () => { const d = await fetchAllFeedback(); if (!c) setFbRows(d); })(); return () => { c = true; }; }, []);
  const fbTickets = fbRows.map((r) => ({ id: 'fb' + r.id, subject: (r.category || 'Feedback') + (r.rating ? ' · ' + '★'.repeat(r.rating) : ''), from: (r.role || 'Client') + (r.appVersion ? ' · v' + r.appVersion : ''), body: r.body, resolved: !!localResolved['fb' + r.id] }));
  const allTickets = [...fbTickets, ...tickets];
  const resolveAny = (id: string) => { if (id.startsWith('fb')) setLocalResolved((p) => ({ ...p, [id]: true })); else resolveTicket(id); };
  const openCount = allTickets.filter((x) => !x.resolved).length;
  const { events } = usePlatformTrainers();
  const feed = [...events, ...activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const [tab, setTab] = useState<'announce' | 'support' | 'activity'>('announce');
  const [text, setText] = useState('');
  const [openT, setOpenT] = useState<string | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Operations</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Talk to trainers · support · platform activity</Text>

        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 10, padding: 3, marginBottom: 16, borderWidth: 1, borderColor: t.ring }}>
          {([['announce', 'Announce'], ['support', `Support${openCount ? ' (' + openCount + ')' : ''}`], ['activity', 'Activity']] as const).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: tab === k ? t.brand : 'transparent' }}>
              <Text style={{ color: tab === k ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 12 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'announce' ? (
          <View>
            <TextInput value={text} onChangeText={setText} placeholder="Announcement to all trainers…" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 80, textAlignVertical: 'top', marginBottom: 12 }} />
            <Pressable onPress={() => { if (!text.trim()) { Alert.alert('Write something', 'Enter an announcement.'); return; } addAnn(text); setText(''); Alert.alert('Sent', 'All trainers will see this.'); }} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 18 }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send to all trainers</Text></Pressable>
            {anns.map((a) => (
              <View key={a.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9 }}>
                <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20 }}>{a.body}</Text>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 6 }}>{ago(a.at)}</Text>
              </View>
            ))}
          </View>
        ) : tab === 'support' ? (
          <View>
            {allTickets.map((tk) => {
              const open = openT === tk.id;
              return (
                <View key={tk.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: tk.resolved ? t.ring : t.brand, padding: 14, marginBottom: 9, opacity: tk.resolved ? 0.6 : 1 }}>
                  <Pressable onPress={() => setOpenT(open ? null : tk.id)}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, flex: 1 }}>{tk.subject}</Text>
                      {tk.resolved ? <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '800' }}>RESOLVED</Text> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.brand }} />}
                    </View>
                    <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{tk.from}</Text>
                  </Pressable>
                  {open ? (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>{tk.body}</Text>
                      {!tk.resolved ? (
                        <Pressable onPress={() => resolveAny(tk.id)} style={{ backgroundColor: t.brand, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Mark resolved</Text></Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View>
            {feed.map((e) => (
              <View key={e.id} style={{ flexDirection: 'row', gap: 12, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 13, marginBottom: 8 }}>
                <Text style={{ fontSize: 20 }}>{e.icon}</Text>
                <Text style={{ color: t.ink2, fontSize: 14, flex: 1 }}>{e.text}</Text>
                <Text style={{ color: t.ink3, fontSize: 11 }}>{ago(e.at)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
