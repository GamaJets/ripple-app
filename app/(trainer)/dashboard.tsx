// Trainer · Clients — roster with progress, tap a client for detail.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_TRAINER } from '../../src/lib/mockData';
import { useCoachProfile } from '../../src/ui/coachProfile';
import { atRiskClient } from '../../src/lib/trainerMock';
import { METRIC_DEFS, METRIC_GROUPS } from '../../src/lib/inbodyMetrics';
import { type RosterClient } from '../../src/lib/trainerMock';
import { areaLabel } from '../../src/lib/injuries';
import { supabase } from '../../src/lib/supabase';
import { askCoach } from '../../src/lib/coach';
import { useRoster } from '../../src/ui/roster';
import { useCoachFeedback } from '../../src/ui/feedback';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useCoachNotes } from '../../src/ui/coachNotes';
import { useAnnouncements } from '../../src/ui/announcements';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useCheckIns } from '../../src/ui/checkins';
import { useInvites } from '../../src/ui/invites';
import { useTrainerInvites } from '../../src/ui/trainerInvites';
import { useClientTags } from '../../src/ui/clientTags';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { currentStreak, longestStreak, personalRecords, weekStats } from '../../src/lib/streaks';

function Stat({ t, label, value, unit }: { t: Theme; label: string; value: string; unit?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
      <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 21, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>{value}{unit ? <Text style={{ fontSize: 12, color: t.ink3, fontWeight: '600' }}> {unit}</Text> : null}</Text>
    </View>
  );
}

function timeAgo(iso: string) {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function TrainerClients() {
  const t = useTheme();
  const router = useRouter();
  const { roster, addClient, removeClient } = useRoster();
  const { sessionFee } = useCoachProfile();
  const { getFeedback, addFeedback } = useCoachFeedback();
  const { get: getNutri, setAdjust: setNutri, clear: clearNutri } = useCoachNutrition();
  const { getNotes, addNote, removeNote } = useCoachNotes();
  const { addAnnouncement } = useAnnouncements();
  const { sent: sentInvites, sendInvite, revokeInvite } = useInvites();
  const { received: trainerInvites, acceptTrainerInvite, declineTrainerInvite } = useTrainerInvites();
  const { tagsFor, allTags, addTag, removeTag } = useClientTags();
  const { templates } = useProgramTemplates();
  const { assignProgram, getProgram } = useAssignedPrograms();
  const [bulkTplOpen, setBulkTplOpen] = useState(false);
  const [seg, setSeg] = useState<string>('all');
  const [tagDraft, setTagDraft] = useState('');
  const acceptJoin = async (id: string, ownerName: string | null) => {
    await acceptTrainerInvite(id);
    Alert.alert('Welcome to the platform', 'You have joined ' + (ownerName || 'the platform') + ' as a trainer. Let us set up your profile.', [{ text: 'Set up profile', onPress: () => router.push('/(trainer)/profile') }, { text: 'Later' }]);
  };
  const [pnote, setPnote] = useState('');
  const [bcOpen, setBcOpen] = useState(false);
  const [bcText, setBcText] = useState('');
  const [fb, setFb] = useState('');
  const [nnote, setNnote] = useState('');
  const [sel, setSel] = useState<RosterClient | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('Fat loss');
  const [newMode, setNewMode] = useState<'online' | 'inperson'>('online');
  const [invOpen, setInvOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invMode, setInvMode] = useState<'online' | 'inperson'>('online');
  const [newEmail, setNewEmail] = useState('');
  const [clientMeals, setClientMeals] = useState<{ name: string; kcal: number; via: string }[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [draftClient, setDraftClient] = useState<RosterClient | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAiSummary('');
    if (!sel) { setClientMeals([]); return; }
    (async () => {
      try {
        const { data } = await supabase.from('food_logs').select('name, kcal, via').eq('client_id', sel.id).order('logged_at', { ascending: false }).limit(6);
        if (!cancelled) setClientMeals((data || []).map((r: any) => ({ name: r.name, kcal: r.kcal, via: r.via })));
      } catch { if (!cancelled) setClientMeals([]); }
    })();
    return () => { cancelled = true; };
  }, [sel]);
  const active = roster.length;
  const revenue = active * sessionFee * 4;
  const unread = roster.reduce((a, c) => a + c.unread, 0);
  const atRisk = roster.filter(atRiskClient).length;
  const AUTO_SEGS = [
    { key: 'all', label: 'All', n: roster.length },
    { key: 'atrisk', label: 'At-risk', n: roster.filter(atRiskClient).length },
    { key: 'online', label: 'Online', n: roster.filter((c) => c.mode === 'online').length },
    { key: 'inperson', label: 'In-person', n: roster.filter((c) => c.mode === 'inperson').length },
  ];
  const matchSeg = (c: RosterClient) =>
    seg === 'all' ? true
    : seg === 'atrisk' ? atRiskClient(c)
    : seg === 'online' ? c.mode === 'online'
    : seg === 'inperson' ? c.mode === 'inperson'
    : tagsFor(c.id).includes(seg);
  const shownRoster = roster.filter(matchSeg);
  const sendNudge = (client: RosterClient) => {
    const body = 'Hey ' + client.name.split(' ')[0] + ' — checking in! How is your week going? Let me know if you need anything.';
    try { supabase.from('messages').insert({ client_id: client.id, sender: 'coach', body }).then(() => {}, () => {}); } catch { /* ignore */ }
    try { supabase.functions.invoke('send-push', { body: { user_ids: [client.id], title: 'A nudge from your coach', body, data: { route: '/(client)/messages' } } }).then(() => {}, () => {}); } catch { /* ignore */ }
    Alert.alert('Nudge sent', 'A check-in message was sent to ' + client.name.split(' ')[0] + '.');
  };
  // Who needs proactive attention, and why — drives the suggested check-ins.
  const attnReason = (c: RosterClient): string | null => {
    if (atRiskClient(c)) return c.adherence < 80 ? 'Adherence ' + c.adherence + '% — below target' : 'Inactive ' + c.lastActive + ' — check in';
    if (c.unread > 0) return c.unread + ' unread message' + (c.unread > 1 ? 's' : '');
    return null;
  };
  const needsAttention = roster.filter((c) => attnReason(c)).sort((a, b) => a.adherence - b.adherence);
  // AI-draft a personalised check-in the coach reviews before sending.
  const draftNudge = async (client: RosterClient) => {
    setDraftClient(client); setDraftText(''); setDraftBusy(true);
    const reason = attnReason(client) || 'general check-in';
    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence + '%', reason };
    const reply = await askCoach([{ role: 'user', content: 'Draft a short, warm, personalised check-in message (2-3 sentences) I can send to this client as their coach. Reason for reaching out: ' + reason + '. Encourage them, reference their goal, and invite a reply. Write only the message, no preamble.' }], ctx);
    setDraftBusy(false);
    setDraftText(reply || ('Hey ' + client.name.split(' ')[0] + ' — checking in on how your week is going. You are working toward ' + client.goal.toLowerCase() + ', and I am here to help. What can I do to make this week easier?'));
  };
  const sendDraft = () => {
    const client = draftClient; const body = draftText.trim();
    if (!client || !body) return;
    try { supabase.from('messages').insert({ client_id: client.id, sender: 'coach', body }).then(() => {}, () => {}); } catch { /* ignore */ }
    try { supabase.functions.invoke('send-push', { body: { user_ids: [client.id], title: 'A note from your coach', body, data: { route: '/(client)/messages' } } }).then(() => {}, () => {}); } catch { /* ignore */ }
    setDraftClient(null); setDraftText('');
    Alert.alert('Sent', 'Your check-in was sent to ' + client.name.split(' ')[0] + '.');
  };
  const bulkMessage = () => {
    const list = shownRoster;
    if (!list.length) return;
    Alert.alert('Message ' + list.length + ' clients?', 'Send a check-in nudge to everyone in this segment.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => { list.forEach((c) => sendNudge(c)); } }]);
  };
  const bulkAssign = (tpl) => {
    const list = shownRoster;
    list.forEach((c) => assignProgram(c.id, tpl.program));
    setBulkTplOpen(false);
    Alert.alert('Assigned', '"' + tpl.name + '" assigned to ' + list.length + ' client' + (list.length > 1 ? 's' : '') + ' in this segment.');
  };
  const genSummary = async (client: RosterClient) => {
    setAiBusy(true); setAiSummary('');
    const ctx = { name: client.name, goal: client.goal, adherence: client.adherence + '%', recentMeals: clientMeals.map((mm) => mm.name).join(', ') || 'no meals logged yet' };
    const reply = await askCoach([{ role: 'user', content: 'Write a concise 3-4 sentence weekly coaching summary for this client: what is going well, one concern to watch, and one focus for next week. Use their adherence and recent meals.' }], ctx);
    setAiBusy(false);
    setAiSummary(reply || 'Could not generate a summary right now — the AI backend may be unavailable.');
  };

  // Live training data is available for the demo client (c1).
  const hasLog = sel?.id === 'c1';
  const { log } = useWorkoutLog();
  const { latest: latestCheckIn } = useCheckIns();
  const streak = hasLog ? currentStreak(log) : 0;
  const best = hasLog ? longestStreak(log) : 0;
  const wk = hasLog ? weekStats(log) : null;
  const selProgram = sel ? getProgram(sel.id) : null;
  const plannedDays = selProgram ? selProgram.days.length : 3;
  const adhPct = plannedDays > 0 ? Math.max(0, Math.min(1, (wk?.workouts ?? 0) / plannedDays)) : 0;
  const prs = hasLog ? personalRecords(log).slice(0, 3) : [];
  const recent = hasLog ? log.slice(0, 4) : [];
  const timeline = sel ? [
    ...getNotes(sel.id).map((n) => ({ id: 'n' + n.id, at: n.at, body: n.body, kind: 'Note' as const })),
    ...getFeedback(sel.id).map((fb) => ({ id: 'f' + fb.id, at: fb.at, body: fb.body, kind: 'Feedback' as const })),
    ...(hasLog && latestCheckIn ? [{ id: 'ci', at: latestCheckIn.at, body: `Check-in: ${latestCheckIn.weightKg}kg · energy ${latestCheckIn.energy}/5 · sleep ${latestCheckIn.sleep}/5${latestCheckIn.note ? ' — “' + latestCheckIn.note + '”' : ''}`, kind: 'Check-in' as const }] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 14 }}>Coaching</Text>
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>{MOCK_TRAINER.name.replace('Coach ', '')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => router.push('/(trainer)/explore')} accessibilityLabel="Search" style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' }}><Icon name="search" size={14} color={t.ink2} /></Pressable>
          <Pressable onPress={() => { setBcText(''); setBcOpen(true); }} style={{ backgroundColor: t.brand, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.brandInk, fontWeight: '700', fontSize: 12 }}>Broadcast</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Switch role</Text>
          </Pressable>
          </View>
        </View>

                {trainerInvites.length > 0 ? (
          <View style={{ marginBottom: 14 }}>
            {trainerInvites.map((iv) => (
              <View key={iv.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 15, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Icon name="sparkle" size={15} color={t.brand} />
                  <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Platform invitation{iv.demo ? ' · sample' : ''}</Text>
                </View>
                <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{iv.ownerName || 'Repple'} invited you to coach</Text>
                <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 12 }}>Accept to join the platform as a trainer and set up your coaching profile.</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => declineTrainerInvite(iv.id)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Decline</Text></Pressable>
                  <Pressable onPress={() => acceptJoin(iv.id, iv.ownerName)} style={{ flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Accept &amp; set up profile</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
          {([["train","Programs","/(trainer)/builder"],["calendar","Schedule","/(trainer)/calendar"],["video","Videos","/(trainer)/videos"],["chart","Analytics","/(trainer)/analytics"],["trophy","Leaderboard","/(trainer)/leaderboard"],["message","Feedback","/(trainer)/feedback"]] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
<View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Stat t={t} label="Active clients" value={String(active)} />
          <Stat t={t} label="Est. revenue" value={'$' + revenue.toLocaleString()} unit="/mo" />
          <Stat t={t} label="Unread" value={String(unread)} />
        </View>

        {needsAttention.length > 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.warn, padding: 14, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Icon name="sparkle" size={15} color={t.warn} />
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Suggested check-ins</Text>
            </View>
            <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>{needsAttention.length} client{needsAttention.length > 1 ? 's' : ''} could use a nudge. Draft one with AI, review, then send.</Text>
            {needsAttention.slice(0, 4).map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: t.ring }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: t.brand, fontWeight: '800', fontSize: 12 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' }}>{c.name}</Text>
                  <Text style={{ color: t.warn, fontSize: 11, marginTop: 1 }}>{attnReason(c)}</Text>
                </View>
                <Pressable onPress={() => draftNudge(c)} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Icon name="sparkle" size={13} color={t.brandInk} />
                  <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>Draft</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <View><Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Your Clients</Text>{atRisk > 0 ? <Text style={{ color: t.warn, fontSize: 11, fontWeight: '700', marginTop: 1 }}>{atRisk} need a check-in</Text> : null}</View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => { setInvEmail(''); setInvMode('online'); setInvOpen(true); }} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink2, fontWeight: '800', fontSize: 12 }}>Invite by email</Text></Pressable>
            <Pressable onPress={() => { setNewName(''); setNewEmail(''); setNewGoal('Fat loss'); setNewMode('online'); setAddOpen(true); }} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>Add client</Text></Pressable>
          </View>
        </View>
        {sentInvites.filter((i) => i.status === 'pending').length > 0 ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Pending invites</Text>
            {sentInvites.filter((i) => i.status === 'pending').map((i) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, borderStyle: 'dashed', padding: 13, marginBottom: 8 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="message" size={16} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{i.email}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{i.mode === 'inperson' ? 'In-person' : 'Online'} · awaiting sign-up / accept</Text>
                </View>
                <Pressable onPress={() => revokeInvite(i.id)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: t.ring }}>
                  <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 12 }}>Cancel</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, marginHorizontal: -2 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {AUTO_SEGS.map((sg) => (
            <Pressable key={sg.key} onPress={() => setSeg(sg.key)} style={{ backgroundColor: seg === sg.key ? t.brand : t.surface2, borderWidth: 1, borderColor: seg === sg.key ? t.brand : t.ring, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7 }}>
              <Text style={{ color: seg === sg.key ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{sg.label} {sg.n}</Text>
            </Pressable>
          ))}
          {allTags.map((tg) => (
            <Pressable key={tg} onPress={() => setSeg(tg)} style={{ backgroundColor: seg === tg ? t.brand : t.surface2, borderWidth: 1, borderColor: seg === tg ? t.brand : t.ring, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={{ color: seg === tg ? t.brandInk : t.ink3, fontSize: 11 }}>#</Text>
              <Text style={{ color: seg === tg ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' }}>{tg}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {seg !== 'all' && shownRoster.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <Pressable onPress={bulkMessage} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingVertical: 10 }}>
              <Icon name="message" size={14} color={t.brand} />
              <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Message {shownRoster.length}</Text>
            </Pressable>
            <Pressable onPress={() => setBulkTplOpen(true)} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingVertical: 10 }}>
              <Icon name="grid" size={14} color={t.brand} />
              <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Assign program</Text>
            </Pressable>
          </View>
        ) : null}
        {shownRoster.length === 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: t.ink3, fontSize: 13 }}>No clients in this segment.</Text>
          </View>
        ) : null}
        {shownRoster.map((c) => (
          <Pressable key={c.id} onPress={() => setSel(c)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{c.name}</Text>
                  {c.unread > 0 && <View style={{ backgroundColor: t.s6, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{c.unread}</Text></View>}
                  {atRiskClient(c) && <View style={{ backgroundColor: 'rgba(250,178,25,0.18)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: t.warn, fontSize: 10, fontWeight: '800' }}>CHECK IN</Text></View>}
                  {c.injuries && c.injuries.length ? <View style={{ backgroundColor: 'rgba(201,133,0,0.18)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 3 }}><Icon name="heart" size={9} color={t.s3} /><Text style={{ color: t.s3, fontSize: 10, fontWeight: '800' }}>{c.injuries.some((x) => x.isNew) ? 'NEW INJURY' : 'INJURY'}</Text></View> : null}
                  {['c1', 'c2', 'c3', 'c4', 'c5'].includes(c.id) ? <View style={{ backgroundColor: t.surface3, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800' }}>DEMO</Text></View> : null}
                </View>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{c.goal} · {c.mode === 'inperson' ? 'In-person' : 'Online'} · {c.lastActive}</Text>
                {tagsFor(c.id).length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                    {tagsFor(c.id).map((tg) => (
                      <View key={tg} style={{ backgroundColor: t.surface3, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '700', textTransform: 'capitalize' }}>{tg}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ backgroundColor: c.weightDelta <= 0 ? 'rgba(45,212,191,0.15)' : 'rgba(224,103,103,0.15)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14 }}>
                  <Text style={{ color: c.weightDelta <= 0 ? t.brand : t.s6, fontWeight: '700', fontSize: 12 }}>{c.weightDelta > 0 ? '+' : ''}{c.weightDelta} kg</Text>
                </View>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 4 }}>Next: {c.next}</Text>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: t.ink3, fontSize: 11 }}>Plan adherence</Text>
                <Text style={{ color: t.ink2, fontSize: 11, fontWeight: '700' }}>{c.adherence}%</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden' }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: c.adherence >= 85 ? t.brand : t.s3, width: c.adherence + '%' }} />
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '86%' }}>
          {sel && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize' }}>{sel.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 16 }}>{sel.goal} · {sel.mode === 'inperson' ? 'In-person' : 'Online'} · {sel.weightDelta > 0 ? '+' : ''}{sel.weightDelta} kg · {sel.adherence}% adherence</Text>

              {sel.metrics && Object.values(sel.metrics).some((v) => v != null) ? (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Body composition · latest scan</Text>
                  {METRIC_GROUPS.map((g) => {
                    const items = METRIC_DEFS.filter((d) => d.group === g && sel.metrics && sel.metrics[d.key] != null);
                    if (!items.length) return null;
                    return (
                      <View key={g} style={{ marginBottom: 8 }}>
                        <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{g}</Text>
                        {items.map((d) => (
                          <View key={String(d.key)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                            <Text style={{ color: t.ink2, fontSize: 13 }}>{d.label}</Text>
                            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{sel.metrics![d.key]} {d.unit}</Text>
                          </View>
                        ))}
                      </View>
                    );
                  })}
                  {(() => {
                    const m = sel.metrics!; const out: string[] = [];
                    const pair = (l?: number, r?: number, name?: string) => { if (l == null || r == null || !l || !r) return; const diff = Math.abs(l - r) / Math.max(l, r); if (diff >= 0.1) out.push(name + ': ' + (l < r ? 'left' : 'right') + ' ' + Math.round(diff * 100) + '% behind'); };
                    pair(m.leanArmLKg, m.leanArmRKg, 'Arms'); pair(m.leanLegLKg, m.leanLegRKg, 'Legs');
                    return out.length ? <Text style={{ color: t.warn, fontSize: 12, fontWeight: '700', marginTop: 2 }}>{out.join('  ·  ')} — cue the weaker side.</Text> : null;
                  })()}
                </View>
              ) : null}

              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Tags</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {tagsFor(sel.id).length === 0 ? <Text style={{ color: t.ink3, fontSize: 12, fontStyle: 'italic' }}>No tags yet.</Text> : null}
                  {tagsFor(sel.id).map((tg) => (
                    <Pressable key={tg} onPress={() => removeTag(sel.id, tg)} style={{ backgroundColor: t.surface3, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{tg}</Text>
                      <Icon name="minus" size={12} color={t.ink3} />
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput value={tagDraft} onChangeText={setTagDraft} placeholder="Add a tag — e.g. comp prep" placeholderTextColor={t.ink3} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => { if (tagDraft.trim()) { addTag(sel.id, tagDraft); setTagDraft(''); } }} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 }} />
                  <Pressable onPress={() => { if (tagDraft.trim()) { addTag(sel.id, tagDraft); setTagDraft(''); } }} disabled={!tagDraft.trim()} style={{ backgroundColor: tagDraft.trim() ? t.brand : t.surface2, borderColor: tagDraft.trim() ? t.brand : t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' }}>
                    <Text style={{ color: tagDraft.trim() ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 13 }}>Add</Text>
                  </Pressable>
                </View>
                {allTags.filter((tg) => !tagsFor(sel.id).includes(tg)).length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {allTags.filter((tg) => !tagsFor(sel.id).includes(tg)).map((tg) => (
                      <Pressable key={tg} onPress={() => addTag(sel.id, tg)} style={{ borderColor: t.ring, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' }}>+ {tg}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {sel.injuries && sel.injuries.length ? (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Injuries & limitations · disclosed at onboarding</Text>
                  {sel.injuries.map((inj, i) => (
                    <View key={i} style={{ backgroundColor: 'rgba(201,133,0,0.12)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,133,0,0.35)', padding: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <Icon name="heart" size={14} color={t.s3} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 13.5 }}>{areaLabel(inj.area)}</Text>
                          <Text style={{ color: t.s3, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>· {inj.severity}</Text>
                          {inj.isNew ? <View style={{ backgroundColor: t.s3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: t.brandInk, fontSize: 9, fontWeight: '900' }}>NEW</Text></View> : null}
                        </View>
                        {inj.note ? <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{inj.note}</Text> : null}
                      </View>
                    </View>
                  ))}
                  <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 2 }}>Their plan automatically flags and swaps moves that load these areas.</Text>
                </View>
              ) : null}

              {hasLog ? (
                <View>
                  {/* Live training snapshot */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    {[['Streak', `${streak}`], ['Best', `${best}`], ['This wk', `${wk?.workouts ?? 0}`], ['Volume', wk ? `${(wk.volumeKg / 1000).toFixed(1)}t` : '—']].map(([l, v]) => (
                      <View key={l} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{v}</Text>
                        <Text style={{ color: t.ink3, fontSize: 10, marginTop: 2 }}>{l}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Program adherence</Text>
                      <Text style={{ color: adhPct >= 1 ? t.brand : t.ink2, fontSize: 12, fontWeight: '800' }}>{wk?.workouts ?? 0} / {plannedDays} sessions</Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 8, borderRadius: 4, backgroundColor: adhPct >= 0.85 ? t.brand : t.warn, width: (adhPct * 100) + '%' }} /></View>
                    <Text style={{ color: t.ink3, fontSize: 11, marginTop: 5 }}>{selProgram ? 'vs assigned program' : 'vs default 3-day week'} · this week</Text>
                  </View>

                  {latestCheckIn ? (
                    <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 14 }}>
                      <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Latest Check-in · {new Date(latestCheckIn.at).toLocaleDateString()}</Text>
                      <Text style={{ color: t.ink2, fontSize: 13 }}>{latestCheckIn.weightKg} kg · energy {latestCheckIn.energy}/5 · sleep {latestCheckIn.sleep}/5 · mood {latestCheckIn.mood}/5 · adherence {latestCheckIn.adherence}/5</Text>
                      {latestCheckIn.note ? <Text style={{ color: t.ink3, fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>“{latestCheckIn.note}”</Text> : null}
                    </View>
                  ) : null}

                  {prs.length > 0 && (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Personal records</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                        {prs.map((pr) => (
                          <View key={pr.exercise} style={{ backgroundColor: t.surface2, borderRadius: 10, borderWidth: 1, borderColor: t.ring, paddingHorizontal: 10, paddingVertical: 7 }}>
                            <Text style={{ color: t.ink2, fontSize: 11, fontWeight: '600' }}>{pr.exercise}</Text>
                            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '800' }}>{pr.weight} kg × {pr.reps}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Recent Sessions</Text>
                  {recent.map((l, i) => (
                    <View key={i} style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' }}>{l.exercise}</Text>
                        <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{l.sets ? l.sets.map((s: number[]) => `${s[0]}×${s[1]}kg`).join(' · ') : l.cardio ? `${l.cardio.mins} min · ${l.cardio.dist} ${l.cardio.unit}` : ''}</Text>
                      </View>
                      <Text style={{ color: t.ink3, fontSize: 11 }}>{timeAgo(l.t)}</Text>
                    </View>
                  ))}
                  <View style={{ height: 6 }} />
                </View>
              ) : (
                <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 14 }}>
                  <Text style={{ color: t.ink3, fontSize: 13 }}>Last active {sel.lastActive} · next session {sel.next}. Detailed session history appears here once {sel.name.split(' ')[0]} logs workouts.</Text>
                </View>
              )}

              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>AI Weekly Summary</Text>
                {aiSummary ? <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}><Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>{aiSummary}</Text></View> : null}
                <Pressable onPress={() => genSummary(sel)} disabled={aiBusy} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {aiBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
                  <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>{aiBusy ? 'Generating…' : aiSummary ? 'Regenerate summary' : 'Generate AI weekly summary'}</Text>
                </Pressable>
              </View>

              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Timeline</Text>
                {timeline.length === 0 ? (
                  <Text style={{ color: t.ink3, fontSize: 13 }}>No history yet — notes, feedback and check-ins appear here.</Text>
                ) : timeline.slice(0, 8).map((ev) => (
                  <View key={ev.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                    <View style={{ alignItems: 'center' }}>
                      <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 4, backgroundColor: ev.kind === 'Note' ? t.ink3 : ev.kind === 'Feedback' ? t.brand : t.warn }} />
                      <View style={{ flex: 1, width: 1, backgroundColor: t.ring, marginTop: 2 }} />
                    </View>
                    <View style={{ flex: 1, paddingBottom: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text style={{ color: ev.kind === 'Feedback' ? t.brand : ev.kind === 'Check-in' ? t.warn : t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>{ev.kind}</Text>
                        <Text style={{ color: t.ink3, fontSize: 10 }}>{new Date(ev.at).toLocaleDateString()}</Text>
                      </View>
                      <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 18 }}>{ev.body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Meal Plan Targets</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 10 }}>Shape {sel.name.split(' ')[0]}'s daily calories, protein, carbs & fat — applies to their Meals tab live.</Text>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Calories</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                  {[-300, -150, 0, 150, 300].map((v) => { const on = (getNutri(sel.id)?.kcalDelta ?? 0) === v; return (
                    <Pressable key={v} onPress={() => setNutri(sel.id, { kcalDelta: v })} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                      <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{v > 0 ? '+' + v : v}</Text>
                    </Pressable>); })}
                </View>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Protein (g)</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                  {[0, 10, 20, 30].map((v) => { const on = (getNutri(sel.id)?.proteinDelta ?? 0) === v; return (
                    <Pressable key={v} onPress={() => setNutri(sel.id, { proteinDelta: v })} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                      <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{v > 0 ? '+' + v : v}</Text>
                    </Pressable>); })}
                </View>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Carbs (g)</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                  {[-50, -25, 0, 25, 50].map((v) => { const on = (getNutri(sel.id)?.carbDelta ?? 0) === v; return (
                    <Pressable key={v} onPress={() => setNutri(sel.id, { carbDelta: v })} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                      <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{v > 0 ? '+' + v : v}</Text>
                    </Pressable>); })}
                </View>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Fat (g)</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                  {[-20, -10, 0, 10, 20].map((v) => { const on = (getNutri(sel.id)?.fatDelta ?? 0) === v; return (
                    <Pressable key={v} onPress={() => setNutri(sel.id, { fatDelta: v })} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                      <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{v > 0 ? '+' + v : v}</Text>
                    </Pressable>); })}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput value={nnote} onChangeText={setNnote} placeholder="Note on the plan (optional)…" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
                  <Pressable onPress={() => { setNutri(sel.id, { note: nnote.trim() }); }} style={{ backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Save</Text></Pressable>
                </View>
                {getNutri(sel.id) ? (
                  <Pressable onPress={() => { clearNutri(sel.id); setNnote(''); }} style={{ paddingVertical: 8, marginTop: 2 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Clear adjustment</Text></Pressable>
                ) : null}
              </View>

              {clientMeals.length > 0 ? (
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Recent Meals Logged</Text>
                  {clientMeals.map((m, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface2, borderRadius: 10, borderWidth: 1, borderColor: t.ring, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 }}>
                      <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }} numberOfLines={1}>{m.name}</Text>
                      <Text style={{ color: t.ink3, fontSize: 12, marginLeft: 8 }}>{m.kcal} kcal · {m.via}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Coach Feedback</Text>
                {getFeedback(sel.id).length === 0 ? (
                  <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 8 }}>No feedback yet. Leave {sel.name.split(' ')[0]} a note below.</Text>
                ) : getFeedback(sel.id).map((fitem) => (
                  <View key={fitem.id} style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}>
                    <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>{fitem.body}</Text>
                    <Text style={{ color: t.ink3, fontSize: 11, marginTop: 6 }}>{new Date(fitem.at).toLocaleDateString()}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <TextInput value={fb} onChangeText={setFb} placeholder="Leave advice or a note…" placeholderTextColor={t.ink3} multiline style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 44, textAlignVertical: 'top' }} />
                  <Pressable onPress={() => { const id = sel.id; if (fb.trim()) { addFeedback(id, fb); setFb(''); } }} style={{ backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send</Text></Pressable>
                </View>
              </View>

              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Private Notes (only you)</Text>
                {getNotes(sel.id).map((n) => (
                  <View key={n.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}>
                    <Text style={{ color: t.ink2, fontSize: 13, flex: 1, lineHeight: 19 }}>{n.body}</Text>
                    <Pressable onPress={() => removeNote(sel.id, n.id)}><Text style={{ color: t.ink3, fontWeight: '800', fontSize: 14 }}>×</Text></Pressable>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <TextInput value={pnote} onChangeText={setPnote} placeholder="Private note (client can't see this)…" placeholderTextColor={t.ink3} multiline style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
                  <Pressable onPress={() => { const id = sel.id; if (pnote.trim()) { addNote(id, pnote); setPnote(''); } }} style={{ backgroundColor: t.surface3, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.ink, fontWeight: '800' }}>Save</Text></Pressable>
                </View>
              </View>

              <Pressable onPress={() => sendNudge(sel)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Send a check-in nudge</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>A quick "how is it going?" message</Text>
                </View>
                <Icon name="bell" size={17} color={t.brand} />
              </Pressable>
              <Pressable onPress={() => { const id = sel.id; const nm = sel.name; setSel(null); router.push({ pathname: '/(trainer)/chat', params: { clientId: id, name: nm } }); }} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Message {sel.name.split(' ')[0]}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>Open your chat thread</Text>
                </View>
                <Text style={{ color: t.ink3, fontSize: 18 }}>›</Text>
              </Pressable>
              <Pressable onPress={() => { const id = sel.id; setSel(null); router.push({ pathname: '/(trainer)/builder', params: { clientId: id } }); }} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Open program builder</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>Edit sets, reps & exercises for {sel.name.split(' ')[0]}</Text>
                </View>
                <Text style={{ color: t.ink3, fontSize: 18 }}>›</Text>
              </Pressable>
              <Pressable
                onPress={() => { const s = sel; Alert.alert('Remove client?', `Remove ${s.name} from your roster?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { removeClient(s.id); setSel(null); } }]); }}
                style={{ borderWidth: 1, borderColor: t.s6, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4, marginBottom: 8 }}>
                <Text style={{ color: t.s6, fontWeight: '800' }}>Remove Client</Text>
              </Pressable>
              <Pressable onPress={() => setSel(null)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: t.brandInk, fontWeight: '800' }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Add Client</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>They join your roster and become bookable in your schedule.</Text>
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Name</Text>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Client name" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 }} />
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Email <Text style={{ color: t.ink3, fontWeight: '600' }}>(optional — sends an app invite)</Text></Text>
          <TextInput value={newEmail} onChangeText={setNewEmail} placeholder="client@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 }} />
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Goal</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {['Fat loss', 'Build muscle', 'Tone'].map((g) => (
              <Pressable key={g} onPress={() => setNewGoal(g)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: newGoal === g ? t.brand : t.surface2, borderWidth: 1, borderColor: newGoal === g ? t.brand : t.ring }}>
                <Text style={{ color: newGoal === g ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{g}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Coaching type</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {([['online', 'Online'], ['inperson', 'In-person']] as const).map(([id, label]) => (
              <Pressable key={id} onPress={() => setNewMode(id)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: newMode === id ? t.brand : t.surface2, borderWidth: 1, borderColor: newMode === id ? t.brand : t.ring }}>
                <Text style={{ color: newMode === id ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Cancel</Text></Pressable>
            <Pressable onPress={() => { if (!newName.trim()) { Alert.alert('Add a name', 'Enter the client name.'); return; } addClient(newName, newGoal, newMode); const em = newEmail.trim(); const invited = !!em && em.includes('@'); if (invited) { sendInvite(em, newMode); } setAddOpen(false); Alert.alert('Client added', invited ? newName.trim() + ' is on your roster and an invite was sent to ' + em + '. They link to you through the app when they accept.' : newName.trim() + ' is now on your roster.', [{ text: 'Great' }]); }} style={{ flex: 2, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add Client</Text></Pressable>
          </View>
        </View>
              </KeyboardAvoidingView>
      </Modal>
      <Modal visible={bcOpen} transparent animationType="slide" onRequestClose={() => setBcOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBcOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Broadcast to all clients</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>Everyone on your roster sees this on their dashboard.</Text>
          <TextInput value={bcText} onChangeText={setBcText} placeholder="Your announcement…" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 90, textAlignVertical: 'top', marginBottom: 16 }} />
          <Pressable onPress={() => { if (!bcText.trim()) { Alert.alert('Write something', 'Enter your announcement.'); return; } addAnnouncement(bcText); setBcOpen(false); Alert.alert('Sent', 'Your clients will see this on their dashboard.'); }} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send to all clients</Text></Pressable>
        </View>
              </KeyboardAvoidingView>
      </Modal>
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setInvOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Invite a client by email</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>They see your invitation in the Repple app when they sign in with this email; accepting links them to you.</Text>
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Email</Text>
          <TextInput value={invEmail} onChangeText={setInvEmail} placeholder="client@email.com" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="email-address" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 }} />
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Coaching type</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {([['online', 'Online'], ['inperson', 'In-person']] as const).map(([id, label]) => (
              <Pressable key={id} onPress={() => setInvMode(id)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: invMode === id ? t.brand : t.surface2, borderWidth: 1, borderColor: invMode === id ? t.brand : t.ring }}>
                <Text style={{ color: invMode === id ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setInvOpen(false)} style={{ flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Cancel</Text></Pressable>
            <Pressable onPress={() => { const e = invEmail.trim(); if (!e || !e.includes('@')) { Alert.alert('Enter an email', 'Add a valid client email address.'); return; } sendInvite(e, invMode); setInvOpen(false); Alert.alert('Invitation sent', e + ' will see your ' + (invMode === 'inperson' ? 'in-person' : 'online') + ' coaching invite when they sign in to Repple.', [{ text: 'Done' }]); }} style={{ flex: 2, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send invite</Text></Pressable>
          </View>
        </View>
              </KeyboardAvoidingView>
      </Modal>

      {/* AI check-in draft review */}
      <Modal visible={!!draftClient} transparent animationType="slide" onRequestClose={() => setDraftClient(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setDraftClient(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          {draftClient && (
            <>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize' }}>Check in with {draftClient.name.split(' ')[0]}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 14 }}>{attnReason(draftClient)} · edit the draft before sending.</Text>
              {draftBusy ? (
                <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 20, alignItems: 'center', marginBottom: 14, flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
                  <ActivityIndicator color={t.brand} />
                  <Text style={{ color: t.ink3, fontSize: 13 }}>Drafting a personalised check-in…</Text>
                </View>
              ) : (
                <TextInput value={draftText} onChangeText={setDraftText} multiline placeholder="Your message…" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 14, minHeight: 110, textAlignVertical: 'top', marginBottom: 14, lineHeight: 20 }} />
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => draftNudge(draftClient)} disabled={draftBusy} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="sparkle" size={14} color={t.brand} />
                  <Text style={{ color: t.brand, fontWeight: '700', fontSize: 13 }}>Redraft</Text>
                </Pressable>
                <Pressable onPress={sendDraft} disabled={draftBusy || !draftText.trim()} style={{ flex: 1, backgroundColor: (!draftBusy && draftText.trim()) ? t.brand : t.surface2, borderColor: (!draftBusy && draftText.trim()) ? t.brand : t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                  <Text style={{ color: (!draftBusy && draftText.trim()) ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 14 }}>Send check-in</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => setDraftClient(null)} style={{ paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>

      <Modal visible={bulkTplOpen} transparent animationType="slide" onRequestClose={() => setBulkTplOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBulkTplOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '78%' }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>Assign to {shownRoster.length} clients</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 14 }}>Pick a program template for everyone in this segment.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {templates.map((tpl) => {
              const dc = tpl.program.days.length; const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <Pressable key={tpl.id} onPress={() => bulkAssign(tpl)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="grid" size={18} color={t.brand} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{tpl.name}</Text>
                    <Text style={{ color: t.ink3, fontSize: 12 }}>{dc} days · {ec} exercises</Text>
                  </View>
                  <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>Assign</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={() => setBulkTplOpen(false)} style={{ paddingVertical: 12, alignItems: 'center', marginTop: 6 }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text></Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
