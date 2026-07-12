// Find a Trainer — client-side marketplace. Browse coaches on the platform,
// filter by online/in-person, view a profile, and request coaching (which flips
// the client's coaching mode). This is how solo/unpaired clients get a coach.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Icon } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { useInvites } from '../../src/ui/invites';
import { notifySuccess } from '../../src/ui/haptics';

const SERIF = 'Georgia';
type Mode = 'online' | 'inperson';
interface Coach { id: string; name: string; tagline: string; specialties: string[]; rating: number; reviews: number; priceMo: number; modes: Mode[]; location?: string; bio: string }

const COACHES: Coach[] = [
  { id: 't1', name: 'Sam Rivera', tagline: 'Strength & sustainable fat loss', specialties: ['Fat loss', 'Strength', 'Nutrition'], rating: 4.9, reviews: 128, priceMo: 149, modes: ['online', 'inperson'], location: 'Austin, TX', bio: 'NASM-certified coach with 8 years helping busy professionals drop fat and build strength. Weekly check-ins, form reviews, and a nutrition plan tuned to your InBody scans.' },
  { id: 't2', name: 'Maya Chen', tagline: 'Hypertrophy & physique', specialties: ['Build muscle', 'Hypertrophy', 'Contest prep'], rating: 4.8, reviews: 96, priceMo: 179, modes: ['online'], bio: 'Competitive bodybuilder and online coach. Science-based programming, progressive overload tracking, and detailed video feedback on every lift.' },
  { id: 't3', name: 'Jordan Blake', tagline: 'Mobility, rehab & longevity', specialties: ['Mobility', 'Rehab', 'Tone'], rating: 5.0, reviews: 64, priceMo: 129, modes: ['online', 'inperson'], location: 'Denver, CO', bio: 'Movement specialist focused on pain-free training. Great for coming back from injury or building a durable base before you push heavy.' },
  { id: 't4', name: 'Priya Nair', tagline: "Women's strength & pre/postnatal", specialties: ['Strength', 'Prenatal', 'Tone'], rating: 4.9, reviews: 210, priceMo: 159, modes: ['online'], bio: "Pre/postnatal-certified strength coach. Programs that adapt to your phase of life, with habit coaching and check-ins that keep you consistent." },
  { id: 't5', name: 'Alex Morgan', tagline: 'HIIT & conditioning', specialties: ['HIIT', 'Conditioning', 'Fat loss'], rating: 4.7, reviews: 88, priceMo: 139, modes: ['inperson'], location: 'Miami, FL', bio: 'High-energy in-person conditioning coach. Interval work, kettlebells and metcons that torch calories and build engine.' },
];

function Stars({ t, rating }: { t: Theme; rating: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name="trophy" size={12} color={t.s3} />
      <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700' }}>{rating.toFixed(1)}</Text>
    </View>
  );
}

function ModeBadge({ t, mode }: { t: Theme; mode: Mode }) {
  return (
    <View style={{ borderWidth: 1, borderColor: t.ring, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '700' }}>{mode === 'inperson' ? 'In-person' : 'Online'}</Text>
    </View>
  );
}

export default function FindTrainer() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const { received, acceptInvite, declineInvite } = useInvites();
  const acceptCoach = async (id: string, coachName: string | null, mode: string) => {
    const m = await acceptInvite(id);
    cd.setCoachingMode(m);
    notifySuccess();
    Alert.alert('You are connected', (coachName || 'Your coach') + ' is now your ' + (m === 'inperson' ? 'in-person' : 'online') + ' coach. Their plan, feedback and messaging are now on your app.', [{ text: 'Great' }]);
  };
  const [filter, setFilter] = useState<'all' | Mode>('all');
  const [sel, setSel] = useState<Coach | null>(null);

  const list = COACHES.filter((c) => filter === 'all' || c.modes.includes(filter as Mode));

  const request = (coach: Coach, mode: Mode) => {
    cd.setCoachingMode(mode);
    setSel(null);
    Alert.alert(
      'Request sent',
      `${coach.name} will confirm your ${mode === 'inperson' ? 'in-person' : 'online'} coaching request shortly. Your app is now set up for coached mode — their plan, feedback and messaging will appear once they accept.`,
      [{ text: 'Great' }]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: SERIF }}>Find a trainer</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>Browse coaches on Repple and start online or in-person.</Text>

        {received.length > 0 ? (
          <View style={{ marginBottom: 16 }}>
            {received.map((iv) => (
              <View key={iv.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 15, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Icon name="sparkle" size={15} color={t.brand} />
                  <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Coaching invitation{iv.demo ? ' · sample' : ''}</Text>
                </View>
                <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{iv.coachName || 'A coach'} invited you</Text>
                <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 12 }}>{iv.mode === 'inperson' ? 'In-person' : 'Online'} coaching. Accept to connect — their program, feedback and messaging turn on for you.</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => declineInvite(iv.id)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800' }}>Decline</Text></Pressable>
                  <Pressable onPress={() => acceptCoach(iv.id, iv.coachName, iv.mode)} style={{ flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Accept invitation</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {([['all', 'All'], ['online', 'Online'], ['inperson', 'In-person']] as const).map(([id, label]) => {
            const on = filter === id;
            return (
              <Pressable key={id} onPress={() => setFilter(id)} style={{ paddingHorizontal: 15, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {list.map((c) => (
          <Pressable key={c.id} onPress={() => setSel(c)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brand, fontWeight: '800', fontSize: 16 }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{c.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 1 }}>{c.tagline}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>${c.priceMo}</Text>
                <Text style={{ color: t.ink3, fontSize: 10 }}>/ month</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <Stars t={t} rating={c.rating} />
              <Text style={{ color: t.ink3, fontSize: 12 }}>{c.reviews} reviews</Text>
              <View style={{ flex: 1 }} />
              {c.modes.map((m) => <ModeBadge key={m} t={t} mode={m} />)}
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '86%' }}>
          {sel && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: t.brand, fontWeight: '800', fontSize: 20 }}>{sel.name.split(' ').map((x) => x[0]).join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: SERIF }}>{sel.name}</Text>
                  <Text style={{ color: t.ink3, fontSize: 13, marginTop: 1 }}>{sel.tagline}{sel.location ? ` · ${sel.location}` : ''}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Stars t={t} rating={sel.rating} />
                <Text style={{ color: t.ink3, fontSize: 12 }}>{sel.reviews} reviews</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>${sel.priceMo}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}> / mo</Text></Text>
              </View>

              <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 21, marginBottom: 16 }}>{sel.bio}</Text>

              <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Specialties</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
                {sel.specialties.map((sp) => (
                  <View key={sp} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 }}>
                    <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700' }}>{sp}</Text>
                  </View>
                ))}
              </View>

              <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Start coaching</Text>
              {sel.modes.map((m) => (
                <Pressable key={m} onPress={() => request(sel, m)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 9, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                  <Icon name={m === 'inperson' ? 'people' : 'video'} size={16} color={t.brandInk} />
                  <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Request {m === 'inperson' ? 'in-person' : 'online'} coaching · ${sel.priceMo}/mo</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setSel(null)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
