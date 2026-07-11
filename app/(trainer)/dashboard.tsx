// Trainer · Clients — roster with progress, tap a client for detail.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_TRAINER } from '../../src/lib/mockData';
import { type RosterClient } from '../../src/lib/trainerMock';
import { useRoster } from '../../src/ui/roster';
import { useCoachFeedback } from '../../src/ui/feedback';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useCoachNotes } from '../../src/ui/coachNotes';
import { useAnnouncements } from '../../src/ui/announcements';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useCheckIns } from '../../src/ui/checkins';
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
  const { getFeedback, addFeedback } = useCoachFeedback();
  const { get: getNutri, setAdjust: setNutri, clear: clearNutri } = useCoachNutrition();
  const { getNotes, addNote, removeNote } = useCoachNotes();
  const { addAnnouncement } = useAnnouncements();
  const [pnote, setPnote] = useState('');
  const [bcOpen, setBcOpen] = useState(false);
  const [bcText, setBcText] = useState('');
  const [fb, setFb] = useState('');
  const [nnote, setNnote] = useState('');
  const [sel, setSel] = useState<RosterClient | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('Fat loss');
  const active = roster.length;
  const revenue = active * MOCK_TRAINER.sessionFee * 4;
  const unread = roster.reduce((a, c) => a + c.unread, 0);

  // Live training data is available for the demo client (c1).
  const hasLog = sel?.id === 'c1';
  const { log } = useWorkoutLog();
  const { latest: latestCheckIn } = useCheckIns();
  const streak = hasLog ? currentStreak(log) : 0;
  const best = hasLog ? longestStreak(log) : 0;
  const wk = hasLog ? weekStats(log) : null;
  const prs = hasLog ? personalRecords(log).slice(0, 3) : [];
  const recent = hasLog ? log.slice(0, 4) : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 14 }}>Coaching</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>{MOCK_TRAINER.name.replace('Coach ', '')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => { setBcText(''); setBcOpen(true); }} style={{ backgroundColor: t.brand, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.brandInk, fontWeight: '700', fontSize: 12 }}>📣 Broadcast</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Switch role</Text>
          </Pressable>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Stat t={t} label="Active clients" value={String(active)} />
          <Stat t={t} label="Est. revenue" value={'$' + revenue.toLocaleString()} unit="/mo" />
          <Stat t={t} label="Unread" value={String(unread)} />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Your Clients</Text>
          <Pressable onPress={() => { setNewName(''); setNewGoal('Fat loss'); setAddOpen(true); }} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>＋ Add Client</Text></Pressable>
        </View>
        {roster.map((c) => (
          <Pressable key={c.id} onPress={() => setSel(c)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{c.name}</Text>
                  {c.unread > 0 && <View style={{ backgroundColor: t.s6, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{c.unread}</Text></View>}
                </View>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{c.goal} · {c.lastActive}</Text>
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
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 16 }}>{sel.goal} · {sel.weightDelta > 0 ? '+' : ''}{sel.weightDelta} kg · {sel.adherence}% adherence</Text>

              {hasLog ? (
                <View>
                  {/* Live training snapshot */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    {[['🔥 Streak', `${streak}`], ['Best', `${best}`], ['This wk', `${wk?.workouts ?? 0}`], ['Volume', wk ? `${(wk.volumeKg / 1000).toFixed(1)}t` : '—']].map(([l, v]) => (
                      <View key={l} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{v}</Text>
                        <Text style={{ color: t.ink3, fontSize: 10, marginTop: 2 }}>{l}</Text>
                      </View>
                    ))}
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
                      <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Personal Records 🏆</Text>
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
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Meal Plan Targets</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 10 }}>Nudge {sel.name.split(' ')[0]}'s daily calories & protein — applies to their Meals tab live.</Text>
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
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput value={nnote} onChangeText={setNnote} placeholder="Note on the plan (optional)…" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
                  <Pressable onPress={() => { setNutri(sel.id, { note: nnote.trim() }); }} style={{ backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Save</Text></Pressable>
                </View>
                {getNutri(sel.id) ? (
                  <Pressable onPress={() => { clearNutri(sel.id); setNnote(''); }} style={{ paddingVertical: 8, marginTop: 2 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Clear adjustment</Text></Pressable>
                ) : null}
              </View>

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
                    <Pressable onPress={() => removeNote(sel.id, n.id)}><Text style={{ color: t.ink3, fontWeight: '800', fontSize: 14 }}>✕</Text></Pressable>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <TextInput value={pnote} onChangeText={setPnote} placeholder="Private note (client can't see this)…" placeholderTextColor={t.ink3} multiline style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
                  <Pressable onPress={() => { const id = sel.id; if (pnote.trim()) { addNote(id, pnote); setPnote(''); } }} style={{ backgroundColor: t.surface3, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.ink, fontWeight: '800' }}>Save</Text></Pressable>
                </View>
              </View>

              <Pressable onPress={() => { const id = sel.id; setSel(null); router.push({ pathname: '/(trainer)/builder', params: { clientId: id } }); }} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>📋 Open Program Builder</Text>
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
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Add Client</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>They join your roster and become bookable in your schedule.</Text>
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Name</Text>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Client name" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 }} />
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Goal</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {['Fat loss', 'Build muscle', 'Tone'].map((g) => (
              <Pressable key={g} onPress={() => setNewGoal(g)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: newGoal === g ? t.brand : t.surface2, borderWidth: 1, borderColor: newGoal === g ? t.brand : t.ring }}>
                <Text style={{ color: newGoal === g ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{g}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Cancel</Text></Pressable>
            <Pressable onPress={() => { if (!newName.trim()) { Alert.alert('Add a name', 'Enter the client name.'); return; } addClient(newName, newGoal); setAddOpen(false); Alert.alert('Client added ✓', `${newName.trim()} is now on your roster.`, [{ text: 'Great' }]); }} style={{ flex: 2, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add Client</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={bcOpen} transparent animationType="slide" onRequestClose={() => setBcOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBcOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Broadcast to all clients</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>Everyone on your roster sees this on their dashboard.</Text>
          <TextInput value={bcText} onChangeText={setBcText} placeholder="Your announcement…" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 90, textAlignVertical: 'top', marginBottom: 16 }} />
          <Pressable onPress={() => { if (!bcText.trim()) { Alert.alert('Write something', 'Enter your announcement.'); return; } addAnnouncement(bcText); setBcOpen(false); Alert.alert('Sent ✓', 'Your clients will see this on their dashboard.'); }} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send to all clients</Text></Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
