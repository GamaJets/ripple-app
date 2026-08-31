// Client · Your Coach. The one person coaching you, and the ways to reach them.
//
// ── Why this screen did not exist ──────────────────────────────────────────
//
// `trainers.tsx` is a DIRECTORY — coaches who ticked "list me". There was no
// screen anywhere for the coach you already have, and one could not be built,
// because a client cannot read their coach's row: `trainers_peer_r` is
// trainer-to-trainer and `trainers_public_directory_r` only covers
// `listed = true`, which defaults to false.
//
// So the normal case was the broken one. A coach who found their client by
// join code — which is how this product is designed to work — was invisible to
// that client, while a stranger browsing the directory could read a listed
// coach's whole profile. The person paying them could see less than a passer-by.
//
// `my_coach_profile()` (part 130) is the fix, and it is a function rather than
// a policy for the reason part 115 sets out: RLS chooses ROWS, never columns,
// so a policy wide enough to show a bio also hands over `session_fee` and
// `join_code` — a join code being exactly the thing that lets somebody else
// attach themselves to that coach. The function returns the safe columns and
// takes no argument, so there is nothing to probe with.
//
// It answers only while the coaching relationship is ACTIVE. When coaching
// ends, `end_coaching()` clears `clients.trainer_id` and this screen empties —
// the profile goes when the relationship goes, which is what both parties
// would expect.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, ListRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';

interface CoachProfile {
  id: string;
  name: string | null;
  avatar: string | null;
  tagline: string | null;
  bio: string | null;
  specialties: string[];
  offers: string[];
}

/** Initials for the circle when there is no photo. Never built from a dash. */
function monogram(name: string | null): string {
  if (!name) return '';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export default function MyCoach() {
  const t = useTheme();
  const router = useRouter();
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    const { data, error } = await supabase.rpc('my_coach_profile');
    if (error) {
      // A failed read is not "you have no coach". Somebody who has a coach and
      // is told they do not will go looking for a way to re-link, which is the
      // one action that could actually break something.
      reportError('myCoach.load', error);
      setStatus('error');
      return;
    }
    const row = Array.isArray(data) ? data[0] : null;
    setCoach(row ? {
      id: String(row.coach_id),
      name: row.coach_name ?? null,
      avatar: row.coach_avatar ?? null,
      tagline: row.tagline ?? null,
      bio: row.bio ?? null,
      specialties: Array.isArray(row.specialties) ? row.specialties.filter(Boolean) : [],
      offers: Array.isArray(row.offers) ? row.offers.filter(Boolean) : [],
    } : null);
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const go = (route: string) => router.push(route as never);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Coaching</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Your Coach</Text>
          </View>
        </View>

        {status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl }}>Loading.</Text>
        ) : status === 'error' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl }}>
            This could not be read just now. It is not a statement that you have no coach — try again when
            you have signal.
          </Text>
        ) : !coach ? (
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.body, color: t.ink }}>You are training on your own.</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              If a coach has given you a six-digit code, enter it on Find a Trainer and they will get your
              request.
            </Text>
            <View style={{ marginTop: sp.lg }}>
              <Ghost label="Find a Trainer" onPress={() => go('/(client)/trainers')} />
            </View>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
              <View style={{
                width: 62, height: 62, borderRadius: 31, backgroundColor: t.surface2,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {coach.avatar
                  ? <Image source={{ uri: coach.avatar }} style={{ width: 62, height: 62 }} />
                  : <Text style={{ ...ty.head, color: t.ink3 }}>{monogram(coach.name)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                {/* A name that could not be read renders as a dash. It is never
                    replaced with "Your coach", which would look like a name and
                    is not one. */}
                <Text style={{ ...ty.head, color: t.ink }}>{coach.name ?? '—'}</Text>
                {coach.tagline ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{coach.tagline}</Text>
                ) : null}
              </View>
            </View>

            {coach.bio ? (
              <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg, lineHeight: 22 }}>{coach.bio}</Text>
            ) : null}

            {coach.specialties.length ? (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>SPECIALISES IN</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {coach.specialties.map((s) => (
                    <View key={s} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>{s}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {coach.offers.length ? (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>OFFERS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {coach.offers.map((o) => (
                    <View key={o} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>{o}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <Rule />

            <Section>
              <SectionHead title="Reach Them" />
              <ListRow icon="message" title="Message" note="Your thread with them" onPress={() => go('/(client)/messages')} />
              <ListRow icon="calendar" title="Book a Session" note="Their open times" onPress={() => go('/(client)/calendar')} />
              <ListRow icon="trophy" title="Packs & Memberships" note="What you have bought from them" onPress={() => go('/(client)/packages')} />
            </Section>

            <Section>
              <SectionHead title="What They Can See" />
              {/* Said here rather than left to be discovered. A client is
                  entitled to know what coaching costs them in privacy, and the
                  answers are not obvious: the injury document stays with the
                  client and only the extracted injury reaches the coach, and
                  blood sugar is invisible until the client turns sharing on. */}
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Your training log, your check-ins, your scans and measurements, and any injury you have
                disclosed. Not the document behind an injury — only what was read out of it. Not your blood
                sugar, unless you turn sharing on yourself.
              </Text>
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
