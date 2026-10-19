// What a client actually logged, one session at a time.
//
// A coach asked for "last session at the top, and let me pick any day and see
// exactly what they did", having been bitten by Hevy: tapping a chart point
// changed the total and left the list on another day. Here the chips, the
// chart bars and the detail list read ONE selected `at` (src/lib/sessionPick.ts),
// so they cannot disagree. Everything shown is the logged record, never the
// template.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme } from './components';
import { END_ALIGN } from './direction';
import { Section, SectionHead, PartialRead, Flag } from './kit';
import { sp, radius, hairline, type as ty, font } from '../theme/scale';
import { MIN_TARGET } from '../lib/a11y';
import { sessionsOf } from '../lib/clientTraining';
import { pickSession, loggedSets, compareToPrevious, volumeVsPrevious, type LoggedSet, type Dir } from '../lib/sessionPick';
import { setsSummary } from '../lib/ownTraining';
import { liftLabel, volumeIn, type WeightUnit } from '../lib/units';
import { fmtDay, num } from '../lib/format';
import { deltaLabel } from '../lib/deltaLabel';
import type { WorkoutEntry } from '../lib/mockData';
import type { LoadStatus } from './loadStatus';

const CHART_SESSIONS = 12;
const FEEL: Record<NonNullable<LoggedSet['feel']>, string> = { easy: 'easy', ok: 'ok', hard: 'hard' };
const DIR_MARK: Record<Dir, string> = { up: '\u2191', down: '\u2193', same: '=', new: 'new', unknown: '' };
const DIR_WORD: Record<Dir, string> = { up: 'heavier than last time', down: 'lighter than last time', same: 'same top load as last time', new: 'first time on record', unknown: 'no load to compare' };

function setLine(s: LoggedSet, unit: WeightUnit): string {
  const load = s.kg != null ? liftLabel(s.kg, unit) : s.bw ? 'bodyweight' : null;
  const work = s.secs != null ? `${num(s.secs)} s` : s.reps != null ? `${num(s.reps)} reps` : 'no reps';
  return [load ? `${load} × ${work}` : work, s.tempo ? `tempo ${s.tempo}` : null, s.feel ? FEEL[s.feel] : null].filter(Boolean).join(' · ');
}

export function SessionLog({ log, status, unit, who, onRefresh }: {
  log: readonly WorkoutEntry[] | null;
  status: LoadStatus;
  unit: WeightUnit;
  who: string;
  onRefresh?: () => void;
}) {
  const t = useTheme();
  const sessions = useMemo(() => sessionsOf(log ?? []), [log]);
  const [at, setAt] = useState<string | null>(null);
  const shown = pickSession(sessions, at);
  const idx = shown ? sessions.indexOf(shown) : -1;
  const vs = useMemo(() => (idx >= 0 ? compareToPrevious(sessions, idx) : []), [sessions, idx]);

  if (status === 'loading') {
    return <Section><SectionHead title="Last Session" /><Text style={{ ...ty.caption, color: t.ink3 }}>Reading what {who} logged…</Text></Section>;
  }
  if (status === 'error') {
    return <Section><SectionHead title="Last Session" /><Flag tone={t.warn}>What {who} logged could not be read. That is not the same as nothing logged.</Flag></Section>;
  }
  if (!sessions.length || !sessions[0]) {
    return <Section><SectionHead title="Last Session" note="Nothing Logged" /><Text style={{ ...ty.caption, color: t.ink3 }}>{who} has not logged a session in this window.</Text></Section>;
  }

  const last = sessions[0];
  const chart = sessions.slice(0, CHART_SESSIONS).reverse();
  const maxVol = Math.max(1, ...chart.map((s) => s.volumeKg ?? 0));
  const volDelta = idx >= 0 ? volumeVsPrevious(sessions, idx) : null;

  return (
    <>
      {/* ── the newest session, compact ─────────────────────────────── */}
      <Section>
        <SectionHead title="Last Session" note={last.day ? fmtDay(last.at) : undefined} />
        {last.entries.map((e, i) => (
          <View key={`${e.exercise}-${i}`} style={{ flexDirection: 'row', gap: sp.sm, marginTop: i ? 6 : 0 }}>
            <Text style={{ ...ty.label, ...font('600'), color: t.ink, flex: 1 }} numberOfLines={1}>{e.exercise}</Text>
            <Text style={{ ...ty.caption, color: t.ink2, flexShrink: 1, textAlign: END_ALIGN }}>{setsSummary(e.sets, unit) ?? (e.cardio ? `${num(e.cardio.mins)} min` : 'no sets')}</Text>
          </View>
        ))}
      </Section>

      {/* ── any session, picked ──────────────────────────────────────── */}
      <Section>
        <SectionHead title="Session History" note={`${num(sessions.length)} Sessions`} />
        {/* Volume per session; each bar selects that session. */}
        <View accessibilityLabel="Volume per session, oldest to newest. Tap a bar to see that session."
          style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 64, marginBottom: sp.md }}>
          {chart.map((s) => {
            const on = shown?.at === s.at;
            const h = s.volumeKg == null ? 4 : Math.max(4, Math.round((s.volumeKg / maxVol) * 60));
            return (
              <Pressable key={s.at} onPress={() => setAt(s.at)} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={`${s.day ? fmtDay(s.at) : 'Undated session'}${s.volumeKg != null ? `, ${num(volumeIn(s.volumeKg, unit))} ${unit}` : ''}`}
                hitSlop={{ top: 8, bottom: 8 }} style={{ flex: 1, height: 64, justifyContent: 'flex-end' }}>
                <View style={{ height: h, borderRadius: 3, backgroundColor: on ? t.brand : t.surface3 }} />
              </Pressable>
            );
          })}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.xs }}>
          {sessions.map((s) => {
            const on = shown?.at === s.at;
            return (
              <Pressable key={s.at} onPress={() => setAt(s.at)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: sp.md, borderRadius: radius.pill,
                         backgroundColor: on ? t.brand : t.surface2 }}>
                <Text style={{ ...ty.caption, ...font('600'), color: on ? t.brandInk : t.ink2 }}>{s.day ? fmtDay(s.at) : 'Undated'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {status === 'partial' ? <View style={{ marginTop: sp.sm }}><PartialRead what="sessions" shown={sessions.length} onPress={onRefresh} /></View> : null}

        {shown ? (
          <View style={{ marginTop: sp.md }}>
            <Text style={{ ...ty.label, ...font('600'), color: t.ink }}>
              {shown.day ? fmtDay(shown.at) : 'Undated session'} · {num(shown.exercises)} exercise{shown.exercises === 1 ? '' : 's'} · {num(shown.sets)} set{shown.sets === 1 ? '' : 's'}
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              {shown.volumeKg != null ? `${num(volumeIn(shown.volumeKg, unit))} ${unit} volume` : 'No priced volume'}
              {volDelta != null ? ` · ${deltaLabel(volumeIn(volDelta, unit), { since: 'the session before', unit, decimals: 0 })}` : ''}
            </Text>
            {shown.entries.map((e, i) => {
              const cmp = vs.find((x) => x.exercise.trim().toLowerCase() === e.exercise.trim().toLowerCase());
              return (
                <View key={`${e.exercise}-${i}`} style={{ marginTop: sp.md, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
                    <Text style={{ ...ty.label, ...font('600'), color: t.ink, flex: 1 }}>{e.exercise}</Text>
                    {cmp && cmp.dir !== 'unknown' ? (
                      <View accessible accessibilityLabel={DIR_WORD[cmp.dir]} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cmp.dir === 'up' ? t.good : cmp.dir === 'down' ? t.warn : t.ink3 }} />
                        <Text style={{ ...ty.caption, ...font('600'), color: t.ink2 }}>
                          {DIR_MARK[cmp.dir]}{cmp.prevTop != null && cmp.dir !== 'new' ? ` vs ${liftLabel(cmp.prevTop, unit)}` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {loggedSets(e).map((s, k) => (
                    <Text key={k} style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>Set {k + 1} · {setLine(s, unit)}</Text>
                  ))}
                  {e.cardio ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{num(e.cardio.mins)} min{e.cardio.dist ? ` · ${num(e.cardio.dist)} ${e.cardio.unit}` : ''}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </Section>
    </>
  );
}
