// Client · Activity (Phase 3-adjacent, no push dependency). A unified, time-sorted
// feed built from the reactive stores: workouts, PRs, streak milestones, check-ins,
// bookings and coach messages. Reachable from the profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// A feed is list-shaped, so it leads with no hero: hairline-separated rows in one
// section instead of forty bordered cards. Every store, conditional and route is
// preserved.
//
// TF-37: the two figures in this feed that are weights — the load on each set,
// and the weight sent with a check-in — were printed as kilograms regardless of
// what the client reads in. Both now convert. The cardio distance beside them
// does NOT: that unit is recorded on the log entry itself (the client chose km
// or miles when they logged the run), so it is already the client's answer and
// the body-measurement preference has no business overriding it.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useCheckIns } from '../../src/ui/checkins';
import { useSessions } from '../../src/ui/sessions';
import { currentStreak, isNewPR, streakMilestone } from '../../src/lib/streaks';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel } from '../../src/lib/units';
import { SessionHrSheet } from '../../src/ui/SessionHrSheet';
import { ageFromDob } from '../../src/lib/hr';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';

// NOTE: this screen used to filter and book against a hardcoded `CLIENT_ID = 'c1'`,
// a leftover from the mock-data era. The real client id is the Supabase user id.
// Because every client shared the literal 'c1', sessions booked by one client
// matched every other client's filter — so two people would see each other's
// bookings, and the trainer side (which stores real user ids) never matched at all.

interface Event { at: string; icon: string; title: string; sub: string; route?: string; hr?: { title: string; startISO: string; durationMin: number } }

function timeAgo(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
function timeLabel(iso: string) {
  const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${h}${ap}`;
}

export default function Activity() {
  const t = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [hrFor, setHrFor] = useState<{ title: string; startISO: string; durationMin: number } | null>(null);
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const age = ageFromDob(cd.dob);
  // All three providers report a LoadStatus and this screen used none of them.
  //
  // A feed built from three empty lists looks exactly like a feed built from
  // three failed reads, and the screen said "Nothing yet · Log a workout or send
  // a check-in to get started" over the second — to somebody with a year of
  // training, three check-ins and a session booked for Thursday. `worstStatus`
  // is the status of the feed as a whole: it is only as complete as its least
  // complete source.
  const { log, status: logStatus } = useWorkoutLog();
  const { checkins, status: checkinStatus } = useCheckIns();
  const { sessions, status: sessionStatus } = useSessions();
  const feedStatus = worstStatus(logStatus, checkinStatus, sessionStatus);
  // Only a whole log can say that a set was a personal record, for the same
  // reason SessionRunner and the manual-log path in workouts.tsx both check it:
  // `isNewPR` compares against the rest of the log, and a log that is a prefix
  // (or empty because the read failed) makes every set look like a first.
  const prsKnown = isWhole(logStatus);

  const events: Event[] = [];

  // Workouts + PR flags
  for (const e of log) {
    const pr = prsKnown && isNewPR(log, e);
    if (e.sets) {
      events.push({ at: e.t, icon: pr ? 'trophy' : 'dumbbell', title: pr ? `New PR — ${e.exercise}` : `Logged ${e.exercise}`, sub: e.sets.map((s) => `${s[0]}×${weightIn(s[1], wu)}${wu}`).join(' · '), route: pr ? '/(client)/records' : '/(client)/trends', hr: { title: e.exercise, startISO: e.t, durationMin: Math.max(20, e.sets.length * 4) } });
    } else if (e.cardio) {
      events.push({ at: e.t, icon: 'heart', title: `Logged ${e.exercise}`, sub: [`${e.cardio.mins} min`, e.cardio.dist > 0 ? `${e.cardio.dist} ${e.cardio.unit}` : null, e.cardio.watts && e.cardio.watts > 0 ? `${e.cardio.watts} W` : null, e.cardio.hrAvg ? `♥ ${e.cardio.hrAvg} avg / ${e.cardio.hrHigh ?? e.cardio.hrAvg} hi` : null].filter(Boolean).join(' · '), route: '/(client)/trends', hr: { title: e.exercise, startISO: e.t, durationMin: e.cardio.mins || 30 } });
    }
  }
  // Streak milestone (as of now)
  const streak = currentStreak(log);
  const milestone = prsKnown ? streakMilestone(streak) : null;
  if (milestone) events.push({ at: new Date().toISOString(), icon: 'flame', title: 'Streak Milestone', sub: milestone, route: '/(client)/achievements' });
  // Check-ins
  for (const c of checkins) events.push({ at: c.at, icon: 'pencil', title: 'Weekly Check-in Sent', sub: `${fig(weightLabel(c.weightKg, wu))} · Energy ${c.energy}/5 · Sleep ${c.sleep}/5`, route: '/(client)/checkin' });
  // My sessions
  for (const s of sessions) {
    if (s.status === 'booked' && s.clientId === cd.id) events.push({ at: s.startsAt, icon: 'calendar', title: 'Session Booked', sub: `${timeLabel(s.startsAt)} · ${s.durationMin} min`, route: '/(client)/bookings' });
  }

  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const feed = events.slice(0, 40);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Everything across your training</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Activity</Text>
          </View>
        </View>

        <Section>
          {/* The count is the size of what this screen managed to assemble, not
              of what happened. It is shown only when all three reads landed
              whole — under anything less it would be a smaller life stated as a
              number. */}
          <SectionHead title="Recent" note={isWhole(feedStatus) && feed.length > 0 ? `${feed.length} event${feed.length === 1 ? '' : 's'}` : undefined} />

          {feedStatus === 'error' || feedStatus === 'partial' ? (
            <Notice
              tone={t.warn}
              kicker="Activity"
              title={feedStatus === 'error' ? 'We couldn’t read everything' : 'Not everything fits in one read'}
              note={feedStatus === 'error'
                ? 'Your training, check-ins and bookings are read from three places and at least one of them did not answer. What is listed below is real; what is missing is missing from this screen, not from your record.'
                : 'You have more on record than this screen can read in one go. What is listed below is your most recent, and the rest is on your log rather than gone.'}
            />
          ) : null}

          {feed.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
              <Icon name="bell" size={26} color={t.ink3} />
              {/* "Nothing yet" is a claim about the member's whole record, and
                  it is only true under a whole read. */}
              <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>
                {feedStatus === 'loading' ? 'Reading…' : feedStatus === 'error' ? 'Nothing we could read' : 'Nothing yet'}
              </Text>
              <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>
                {feedStatus === 'loading' ? 'Your training, check-ins and bookings are on their way.'
                  : feedStatus === 'error' ? 'This is not an empty record — it is one we could not open. Pull down or come back when you have signal.'
                  : 'Log a workout or send a check-in to get started.'}
              </Text>
            </View>
          ) : feed.map((e, i) => {
            const isOpen = open === i;
            return (
              <View key={i}>
                {i > 0 ? <Rule /> : null}
                <Pressable onPress={() => setOpen(isOpen ? null : i)} accessibilityRole="button" accessibilityLabel={`${e.title}. ${e.sub}. ${isOpen ? 'Collapse' : 'Tap to expand'}`}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={e.icon as any} size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.title}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }} numberOfLines={isOpen ? undefined : 2}>{e.sub}</Text>
                    {isOpen ? (
                      <View style={{ marginTop: sp.md }}>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{timeLabel(e.at)}</Text>
                        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                          {e.route ? (
                            <Ghost label="View Details" onPress={() => router.push(e.route as any)} />
                          ) : null}
                          {e.hr ? (
                            <Ghost label="Heart Rate" icon="heart" onPress={() => setHrFor(e.hr!)} />
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: sp.sm }}>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{timeAgo(e.at)}</Text>
                    <View style={{ transform: [{ rotate: isOpen ? '-90deg' : '0deg' }] }}>
                      <Icon name="chevron" size={14} color={t.ink3} />
                    </View>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Section>
      </ScrollView>
      <SessionHrSheet visible={!!hrFor} onClose={() => setHrFor(null)} title={hrFor?.title || ''} startISO={hrFor?.startISO || new Date().toISOString()} durationMin={hrFor?.durationMin || 45} age={age} />
    </SafeAreaView>
  );
}
