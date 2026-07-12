// Trainer · Analytics — revenue, clients, retention, platform fee.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_TRAINER } from '../../src/lib/mockData';
import { ROSTER } from '../../src/lib/trainerMock';
import { useRoster } from '../../src/ui/roster';
import { DistBar, DeltaBadge } from '../../src/ui/charts';
import { Sparkline } from '../../src/ui/charts';
import { askCoach } from '../../src/lib/coach';
import { useMonthlyHistory } from '../../src/ui/useMrrHistory';

function Big({ t, label, value, sub, tint }: { t: Theme; label: string; value: string; sub: string; tint?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: tint ? t.brand : t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
      <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 12, fontWeight: '700', opacity: tint ? 0.85 : 1 }}>{label}</Text>
      <Text style={{ color: tint ? t.brandInk : t.ink, fontSize: 26, fontWeight: '800', textTransform: 'capitalize', marginTop: 6 }}>{value}</Text>
      <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 11, marginTop: 2, opacity: tint ? 0.85 : 1 }}>{sub}</Text>
    </View>
  );
}

export default function TrainerAnalytics() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();
  const staleDays = (str) => { const m = /([0-9]+)d/.exec(str); return m ? parseInt(m[1], 10) : 0; };
  const atRisk = roster.filter((c) => c.adherence < 82 || staleDays(c.lastActive) >= 2);
  const clients = roster.length;
  const sessionsMo = clients * 4;
  const revenue = sessionsMo * MOCK_TRAINER.sessionFee;
  const platformFee = 99;
  const net = revenue - platformFee;
  const avgAdh = clients ? Math.round(roster.reduce((a, c) => a + c.adherence, 0) / clients) : 0;
  const onTrack = roster.filter((c) => c.adherence >= 85).length;
  const watch = roster.filter((c) => c.adherence >= 70 && c.adherence < 85).length;
  const riskCount = roster.filter((c) => c.adherence < 70).length;
  const atRiskRevenue = atRisk.length * MOCK_TRAINER.sessionFee * 4;
  const [digest, setDigest] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  const genDigest = async () => {
    setDigestBusy(true); setDigest('');
    const ctx = { revenueUsd: revenue, netUsd: net, clients, avgAdherence: avgAdh + '%', atRiskClients: atRisk.length, onTrack, watch, atRiskLow: riskCount };
    const reply = await askCoach([{ role: 'user', content: 'You are my fitness-coaching business assistant. Write a short Monday digest (3-4 sentences) from these numbers (revenueUsd/netUsd are US dollars/month): one line on revenue and clients, one on roster health (on-track vs at-risk), and one concrete action to grow or retain. Encouraging and specific.' }], ctx);
    setDigestBusy(false);
    setDigest(reply || 'Could not generate the digest right now — the AI backend may be unavailable.');
  };
  const revHist = useMonthlyHistory('repple.trainer.revHistory', revenue);
  const months = [['Feb', 0.55], ['Mar', 0.62], ['Apr', 0.7], ['May', 0.82], ['Jun', 0.9], ['Jul', 1]] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Analytics</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Your coaching business at a glance</Text>
        <Pressable onPress={() => router.push('/(trainer)/leaderboard')} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Client leaderboard</Text><Text style={{ color: t.ink3, fontSize: 18 }}>›</Text></Pressable>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <Big t={t} label="Monthly revenue" value={'$' + revenue.toLocaleString()} sub={`${sessionsMo} sessions × $${MOCK_TRAINER.sessionFee}`} tint />
          <Big t={t} label="Net after fee" value={'$' + net.toLocaleString()} sub={`− $${platformFee} platform`} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Big t={t} label="Active clients" value={String(clients)} sub="all retained" />
          <Big t={t} label="Avg adherence" value={avgAdh + '%'} sub="across clients" />
        </View>

        {atRisk.length > 0 ? (
          <Pressable onPress={() => router.push('/(trainer)/dashboard')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.warn, padding: 15, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(250,178,25,0.16)', alignItems: 'center', justifyContent: 'center' }}><Icon name="target" size={20} color={t.warn} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>~${atRiskRevenue.toLocaleString()}/mo at risk</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{atRisk.length} client{atRisk.length > 1 ? 's' : ''} slipping — check in before they churn.</Text>
            </View>
            <Text style={{ color: t.ink3, fontSize: 16 }}>›</Text>
          </Pressable>
        ) : null}

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Roster health</Text>
            <Text style={{ color: t.ink3, fontSize: 12 }}>{avgAdh}% avg adherence</Text>
          </View>
          <DistBar segments={[{ label: 'On track', value: onTrack, color: t.brand }, { label: 'Watch', value: watch, color: t.warn }, { label: 'At risk', value: riskCount, color: t.crit }]} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            {[['On track', onTrack, t.brand], ['Watch', watch, t.warn], ['At risk', riskCount, t.crit]].map(([l, v, c]) => (
              <View key={l as string} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c as string }} />
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{l as string} {v as number}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Revenue trend</Text>
            {revHist.delta !== 0 ? <DeltaBadge value={revHist.delta} unit="" suffix="vs last mo" /> : <Text style={{ color: t.ink3, fontSize: 11 }}>tracking started</Text>}
          </View>
          <Sparkline data={revHist.series} w={300} h={64} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            {revHist.labels.map((l, i) => (<Text key={i} style={{ color: t.ink3, fontSize: 10 }}>{l}</Text>))}
          </View>
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 4 }}>At-risk clients</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Low adherence or inactive 2+ days — reach out</Text>
          {atRisk.length === 0 ? (
            <Text style={{ color: t.ink3, fontSize: 13 }}>Everyone's on track — nice coaching.</Text>
          ) : atRisk.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{c.adherence}% adherence · last active {c.lastActive}</Text>
              </View>
              <View style={{ backgroundColor: c.adherence < 82 ? 'rgba(208,59,59,0.15)' : 'rgba(250,178,25,0.18)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: c.adherence < 82 ? t.crit : t.warn, fontSize: 11, fontWeight: '800' }}>{c.adherence < 82 ? 'LOW ADHERENCE' : 'INACTIVE'}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Icon name="sparkle" size={16} color={t.brand} />
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>Weekly business digest</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>An AI Monday summary of your coaching business.</Text>
          {digest ? <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 10 }}><Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>{digest}</Text></View> : null}
          <Pressable onPress={genDigest} disabled={digestBusy} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {digestBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>{digestBusy ? 'Writing…' : digest ? 'Regenerate' : 'Generate digest'}</Text>
          </Pressable>
        </View>

        <View style={{ backgroundColor: t.surface2, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
          <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 20 }}>
            You’re on the <Text style={{ color: t.brand, fontWeight: '800' }}>Pro</Text> plan (${platformFee}/mo to Repple). Add clients or session packages to grow — every new client at ${MOCK_TRAINER.sessionFee}/session adds about ${MOCK_TRAINER.sessionFee * 4}/mo.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
