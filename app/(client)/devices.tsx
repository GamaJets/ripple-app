// Watch & Devices — real wearable connections through the provider layer.
// Apple Health reads the paired Apple Watch; live tiles are tappable for detail.
import { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, Modal } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import type { WearableProvider, WorkoutSample } from '../../src/lib/wearables/types';
import { useWearables } from '../../src/ui/wearables';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { tapLight } from '../../src/ui/haptics';

type MetricKey = 'kcal' | 'hr' | 'steps' | 'source';

function ago(ts?: number): string {
 if (!ts) return '';
 const s = Math.floor((Date.now() - ts) / 1000);
 if (s < 60) return 'just now';
 const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
 const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
 return Math.floor(h / 24) + 'd ago';
}
function num(n: number | null | undefined, dashes = '—'): string {
 return typeof n === 'number' ? n.toLocaleString() : dashes;
}
function wkDate(iso: string): string {
 const d = new Date(iso);
 return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function Metric({ t, ico, label, value, unit, onPress, hint }: { t: Theme; ico: string; label: string; value: string; unit: string; onPress: () => void; hint?: string }) {
 return (
 <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: t.ring }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
 <Icon name={(ico || 'chart') as any} size={18} color={t.brand} />
 <Text style={{ color: t.ink3, fontSize: 16 }}>›</Text>
 </View>
 <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize', marginTop: 6 }}>{value}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}> {unit}</Text></Text>
 <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1, textTransform: 'capitalize' }}>{label}</Text>
 {hint ? <Text style={{ color: t.s3, fontSize: 10, marginTop: 3, fontWeight: '700' }}>{hint}</Text> : null}
 </Pressable>
 );
}

export default function Devices() {
 const t = useTheme();
 const router = useRouter();
 const w = useWearables();
 const [detail, setDetail] = useState<MetricKey | null>(null);
 const { log, addWorkouts } = useWorkoutLog();
 const apple = PROVIDERS.find((p) => p.meta.id === 'apple');
 const appleReady = !!apple && apple.isAvailable();
 const [wk, setWk] = useState<WorkoutSample[] | null>(null);
 const [wkBusy, setWkBusy] = useState(false);
 const [importedIds, setImportedIds] = useState<Set<string>>(() => new Set());
 useEffect(() => { (async () => { try { const raw = await AsyncStorage.getItem('repple.hk.imported'); if (raw) setImportedIds(new Set(JSON.parse(raw))); } catch { /* ignore */ } })(); }, []);
 const alreadyLogged = (sm: WorkoutSample) => importedIds.has(sm.id) || log.some((l) => l.t === sm.start && l.exercise === sm.activity);
 const toEntry = (sm: WorkoutSample): WorkoutEntry => ({ t: sm.start, exercise: sm.activity, cardio: { mins: sm.mins, dist: sm.distanceKm ?? 0, unit: 'km' }, kcal: sm.kcal ?? undefined });
 const markImported = (ids: string[]) => { const next = new Set(importedIds); ids.forEach((i) => next.add(i)); setImportedIds(next); AsyncStorage.setItem('repple.hk.imported', JSON.stringify([...next])).catch(() => {}); };
 const findWorkouts = async () => {
 if (!apple?.fetchWorkouts) { Alert.alert('Apple Health', 'Workout import needs the Repple app build with Apple Health.'); return; }
 if (w.states['apple'] !== 'connected') { Alert.alert('Apple Health', 'Connect Apple Health first (in Available Devices below), then tap Find my workouts.'); return; }
 setWkBusy(true);
 try { const list = await apple.fetchWorkouts(14); setWk(list); if (!list.length) Alert.alert('Apple Health', 'No Apple Watch workouts found in the last 14 days. Make sure your watch has synced to the iPhone Health app.'); }
 catch (e: any) { Alert.alert('Apple Health', e?.message || 'Could not read your workouts.'); }
 finally { setWkBusy(false); }
 };
 const importOne = (sm: WorkoutSample) => { if (alreadyLogged(sm)) return; addWorkouts([toEntry(sm)]); markImported([sm.id]); tapLight(); };
 const importAll = () => { const fresh = (wk || []).filter((sm) => !alreadyLogged(sm)); if (!fresh.length) return; addWorkouts(fresh.map(toEntry)); markImported(fresh.map((sm) => sm.id)); tapLight(); };
 // Auto-refresh whenever this screen opens (plus the 60s auto-sync in the store).
 useFocusEffect(useCallback(() => { for (const pv of PROVIDERS) { if (pv.isAvailable()) w.sync(pv.meta.id); } }, [w.sync]));

 const onConnect = async (p: WearableProvider) => {
 const reason = p.unavailableReason();
 if (!p.isAvailable() && reason) { Alert.alert(p.meta.name, reason); return; }
 try {
 await w.connect(p.meta.id);
 } catch (e: any) {
 Alert.alert(p.meta.name, e?.message || 'Could not connect.');
 }
 };

 const connected = PROVIDERS.filter((p) => w.states[p.meta.id] === 'connected');
 const showLive = connected.length > 0 && (w.today.activeKcal != null || w.today.heartRateAvg != null || w.today.steps != null);

 const DETAILS: Record<MetricKey, { ico: string; title: string; value: string; blurb: string }> = {
 kcal: { ico: 'flame', title: 'Calories Burned', value: `${num(w.today.activeKcal)} kcal`, blurb: 'Active energy your watch recorded today. It feeds into your daily calorie target — on training days you can eat back what you earn.' },
 hr: { ico: 'heart', title: 'Average Heart Rate', value: `${num(w.today.heartRateAvg)} bpm`, blurb: 'The mean of today’s heart-rate samples from your watch. During a workout, live heart rate is written into that session.' },
 steps: { ico: 'trending', title: 'Steps', value: num(w.today.steps), blurb: 'Total steps today across your connected devices. A simple daily-movement signal that complements your training.' },
 source: { ico: 'clock', title: 'Connected Sources', value: `${connected.length} ${connected.length === 1 ? 'device' : 'devices'}`, blurb: connected.map((p) => `• ${p.meta.name}`).join('\n') || 'No devices connected yet.' },
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>‹ Back</Text></Pressable>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Watch &amp; Devices</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Connect a wearable to auto-track heart rate and calories burned.</Text>

 {showLive ? (
 <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
 <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.good }} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>Live Today</Text>
 </View>
 <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
 <Metric t={t} ico="" label="Calories Burned" value={num(w.today.activeKcal)} unit="kcal" hint={w.today.activeKcal == null ? 'Wear your Apple Watch' : undefined} onPress={() => setDetail('kcal')} />
 <Metric t={t} ico="" label="Avg Heart Rate" value={num(w.today.heartRateAvg)} unit="bpm" hint={w.today.heartRateAvg == null ? 'Wear your Apple Watch' : undefined} onPress={() => setDetail('hr')} />
 </View>
 <View style={{ flexDirection: 'row', gap: 10 }}>
 <Metric t={t} ico="" label="Steps" value={num(w.today.steps)} unit="" onPress={() => setDetail('steps')} />
 <Metric t={t} ico="" label="Source" value={String(connected.length)} unit={connected.length === 1 ? 'device' : 'devices'} onPress={() => setDetail('source')} />
 </View>
 <Text style={{ color: t.ink3, fontSize: 11, marginTop: 12, lineHeight: 16 }}>Updates automatically. Steps come from your iPhone; heart rate &amp; calories need an Apple Watch (wear it). Calories feed your daily target.</Text>
 </View>
 ) : null}

 {appleReady ? (
 <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 16 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 4 }}>Import Apple Watch workouts</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12, lineHeight: 17 }}>Pull sessions you recorded on your Apple Watch — Pilates, runs, cycling — straight into your training log. No manual entry.</Text>
 {wk == null ? (
 <Pressable onPress={findWorkouts} disabled={wkBusy} accessibilityRole="button" accessibilityLabel="Find my Apple Watch workouts" style={{ alignSelf: 'flex-start', backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, opacity: wkBusy ? 0.6 : 1 }}>
 {wkBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Find my workouts</Text>}
 </Pressable>
 ) : wk.length === 0 ? (
 <Text style={{ color: t.ink3, fontSize: 13 }}>No workouts found in the last 14 days.</Text>
 ) : (
 <View>
 {wk.map((sm) => {
 const done = alreadyLogged(sm);
 return (
 <View key={sm.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.ring }}>
 <View style={{ flex: 1, paddingRight: 10 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13.5 }}>{sm.activity}</Text>
 <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>{[wkDate(sm.start), `${sm.mins} min`, sm.distanceKm ? `${sm.distanceKm} km` : null, sm.kcal ? `${sm.kcal} kcal` : null].filter(Boolean).join(' · ')}</Text>
 </View>
 <Pressable onPress={() => importOne(sm)} disabled={done} accessibilityRole="button" accessibilityLabel={(done ? 'Already in log: ' : 'Import ') + sm.activity} style={{ backgroundColor: done ? t.surface2 : t.brand, borderColor: t.ring, borderWidth: done ? 1 : 0, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}>
 <Text style={{ color: done ? t.ink3 : t.brandInk, fontWeight: '800', fontSize: 12 }}>{done ? 'In log' : 'Import'}</Text>
 </Pressable>
 </View>
 );
 })}
 <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
 <Pressable onPress={importAll} accessibilityRole="button" accessibilityLabel="Import all workouts" style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 12 }}>Import all</Text></Pressable>
 <Pressable onPress={findWorkouts} accessibilityRole="button" accessibilityLabel="Refresh workouts" style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 12 }}>↻ Refresh</Text></Pressable>
 </View>
 </View>
 )}
 </View>
 ) : null}

 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 10 }}>Available Devices</Text>
 {PROVIDERS.map((p) => {
 const st = w.states[p.meta.id] || 'disconnected';
 const on = st === 'connected';
 const busy = !!w.busy[p.meta.id];
 const reason = p.unavailableReason();
 const blocked = !p.isAvailable() && !on;
 return (
 <View key={p.meta.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: on ? t.brand : t.ring, padding: 15, marginBottom: 10 }}>
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
 <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="clock" size={20} color={t.brand} /></View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{p.meta.name}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{p.meta.blurb}</Text>
 </View>
 {busy ? (
 <ActivityIndicator color={t.brand} />
 ) : (
 <Pressable onPress={() => (on ? w.disconnect(p.meta.id) : onConnect(p))}
 style={{ backgroundColor: on ? t.surface2 : blocked ? t.surface2 : t.brand, borderColor: t.ring, borderWidth: on || blocked ? 1 : 0, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 }}>
 <Text style={{ color: on ? t.ink2 : blocked ? t.ink3 : t.brandInk, fontWeight: '800', fontSize: 13 }}>{on ? 'Connected' : blocked ? 'Unavailable' : 'Connect'}</Text>
 </Pressable>
 )}
 </View>

 {blocked && reason ? <Text style={{ color: t.ink3, fontSize: 11, marginTop: 10 }}>ⓘ {reason}</Text> : null}

 {on ? (
 <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: t.ring, paddingTop: 12 }}>
 {(() => {
 const m = w.metrics[p.meta.id];
 if (!m) return <Text style={{ color: t.ink3, fontSize: 12 }}>Connected. Tap Sync — no data for today yet.</Text>;
 return (
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
 {m.activeKcal != null ? <Text style={{ color: t.ink2, fontSize: 12 }}> {m.activeKcal} kcal</Text> : null}
 {m.heartRateAvg != null ? <Text style={{ color: t.ink2, fontSize: 12 }}> {m.heartRateAvg} bpm avg</Text> : null}
 {m.heartRateResting != null ? <Text style={{ color: t.ink2, fontSize: 12 }}> {m.heartRateResting} resting</Text> : null}
 {m.steps != null ? <Text style={{ color: t.ink2, fontSize: 12 }}> {m.steps.toLocaleString()} steps</Text> : null}
 {m.workoutMins != null ? <Text style={{ color: t.ink2, fontSize: 12 }}> {m.workoutMins} min</Text> : null}
 </View>
 );
 })()}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
 <Pressable accessibilityLabel={'Sync ' + p.meta.name} accessibilityRole="button" onPress={() => { tapLight(); w.sync(p.meta.id); }} style={{ alignSelf: 'flex-start', backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>↻ Sync Now</Text>
 </Pressable>
 {w.lastSync[p.meta.id] ? <Text style={{ color: t.ink3, fontSize: 11 }}>Synced {ago(w.lastSync[p.meta.id])}</Text> : null}
 </View>
 </View>
 ) : null}
 </View>
 );
 })}
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 8 }}>Apple Health reads your paired Apple Watch through HealthKit. Cloud devices (WHOOP, Oura, Garmin, Fitbit) connect via their APIs and arrive with the backend rollout.</Text>
 </ScrollView>

 <Modal visible={detail != null} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
 <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setDetail(null)} />
 <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 32 }}>
 {detail ? (
 <>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
 <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{DETAILS[detail].title}</Text>
 <Pressable onPress={() => setDetail(null)}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Close</Text></Pressable>
 </View>
 <Text style={{ color: t.ink, fontSize: 34, fontWeight: '800', marginBottom: 12 }}>{DETAILS[detail].value}</Text>
 <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 21 }}>{DETAILS[detail].blurb}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 16 }}>Trends and history charts arrive with the backend rollout. Manage what Repple can read in Apple Health ▸ Sharing ▸ Repple.</Text>
 </>
 ) : null}
 </View>
 </Modal>
 </SafeAreaView>
 );
}
