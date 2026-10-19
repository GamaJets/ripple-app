// A program, read-only.
//
// Coach feedback: opening a program from the library or from a client dropped
// them into the builder, an editor with an Assign button and "replace what is
// in the builder?" prompts, when all they wanted was to look at it. So opening
// a program now lands here. Nothing on this screen writes. Assign and Edit are
// explicit buttons, and both go to the screens that already own those writes
// and their safety checks: the template library's assign sheet, and the
// builder (overwrite brief, injury gate, unsaved-work guard).
//
// In a client's context (`clientId`) the screen also shows what that client
// actually logged (src/ui/SessionLog.tsx): the last session up top and any
// past session on tap.
//
// Params: `templateId` (a library template), or `clientId` alone (their
// current program), or `clientId` + `historyId` (an earlier block).
// `clientId` + `templateId` is a template viewed for one client, and Assign
// then loads it into the builder with that client already chosen, the
// existing one-tap-from-the-client flow.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, PageHead, Cta, Ghost, Notice, TonedChip } from '../../src/ui/kit';
import { DayPips } from '../../src/ui/coach/ProgramBuilderFlow';
import { WEEK_DAYS } from '../../src/lib/weekStart';
import { sp, layout, hairline, type as ty, font } from '../../src/theme/scale';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramHistory } from '../../src/ui/programHistory';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { programWeeks } from '../../src/lib/programBlock';
import { liftLabel, type WeightUnit } from '../../src/lib/units';
import { num } from '../../src/lib/format';
import type { Program, ProgramExercise } from '../../src/lib/programs';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { WORKOUT_COLS, rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { capLimit, capped } from '../../src/lib/rowCap';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { SessionLog } from '../../src/ui/SessionLog';
import { END_ALIGN } from '../../src/ui/direction';

/** How far back the session history reads. Six months covers a block and the
 *  one before it; the read is capped and says so when it is. */
const HISTORY_DAYS = 183;

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function prescription(x: ProgramExercise, unit: WeightUnit): string {
  const load = x.loadKg != null && x.loadKg > 0 ? liftLabel(x.loadKg, unit) : null;
  return [
    `${num(x.sets)} × ${x.reps}${load ? ` @ ${load}` : ''}`,
    x.rpe != null ? `RPE ${num(x.rpe)}` : null,
    x.tempo ? `tempo ${x.tempo}` : null,
    x.restSec != null ? `rest ${num(x.restSec)} s` : null,
  ].filter(Boolean).join(' · ');
}

export default function ProgramView() {
  const t = useTheme();
  const router = useRouter();
  const p = useLocalSearchParams();
  const templateId = str(p.templateId);
  const clientId = str(p.clientId);
  const historyId = str(p.historyId);
  const unit: WeightUnit = useSettings().weightUnit;

  const { templates, status: tplStatus } = useProgramTemplates();
  const assigned = useAssignedPrograms();
  const history = useProgramHistory(historyId ? clientId : null);
  const { roster } = useRoster();
  const client = useMemo(() => (clientId ? roster.find((c) => c.id === clientId) ?? null : null), [roster, clientId]);
  const fullName = str(p.name) ?? client?.name ?? '';
  const first = fullName.split(/\s+/)[0] || 'This Client';

  const tpl = templateId ? templates.find((x) => x.id === templateId) ?? null : null;
  const past = historyId ? history.rows?.find((r) => r.id === historyId) ?? null : null;
  const program: Program | null = templateId ? tpl?.program ?? null
    : historyId ? past?.program ?? null
    : clientId ? assigned.getProgram(clientId) : null;
  const readStatus: LoadStatus = templateId ? tplStatus : historyId ? history.status : assigned.status;
  const title = (templateId ? tpl?.name : program?.title)?.trim() || 'Untitled Program';
  const kind = templateId ? 'Template' : historyId ? 'Earlier Program' : 'Current Program';

  // ── what the client logged, for the session history ──────────────────
  const askable = clientId ? clientIsQueryable(clientId, client?.handAdded) : false;
  const [log, setLog] = useState<WorkoutEntry[] | null>(null);
  const [logStatus, setLogStatus] = useState<LoadStatus>('loading');
  const wanted = useRef<string | null>(null);
  const loadLog = useCallback(async () => {
    if (!clientId) return;
    wanted.current = clientId;
    if (!USE_SUPABASE || !askable) { setLog(null); setLogStatus('error'); return; }
    setLogStatus('loading');
    const res = await supabase.from('workouts').select(WORKOUT_COLS).eq('user_id', clientId)
      .gte('performed_at', new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString())
      .order('performed_at', { ascending: false }).order('id', { ascending: false })
      .limit(capLimit());
    if (wanted.current !== clientId) return;
    if (res.error) { reportError('programView.workouts', res.error); setLog(null); setLogStatus('error'); return; }
    const page = capped((res.data ?? []) as unknown as WorkoutRow[]);
    setLog(page.rows.map(rowToEntry));
    setLogStatus(page.truncated ? 'partial' : 'ready');
  }, [clientId, askable]);
  useEffect(() => { void loadLog(); }, [loadLog]);

  const at = () => String(Date.now());
  const editInBuilder = () => {
    if (templateId) router.push({ pathname: '/(trainer)/builder', params: { templateId, ...(clientId ? { clientId, name: fullName } : {}), from: clientId ? 'trainerClient' : 'trainerTemplates', at: at() } } as any);
    else if (clientId) router.push({ pathname: '/(trainer)/builder', params: { clientId, name: fullName, from: 'trainerClient' } } as any);
  };
  const assign = () => {
    if (!templateId) return;
    // From a client: the builder with this template loaded and this client
    // picked, which is the flow coaches asked to keep. From the library: the
    // library's own assign sheet, opened on this template.
    if (clientId) editInBuilder();
    else router.push({ pathname: '/(trainer)/templates', params: { assign: templateId, at: at() } } as any);
  };

  const weeks = programWeeks(program);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <PageHead title={kind} subtitle={clientId ? fullName || undefined : undefined} />

        {!program ? (
          <Section>
            {readStatus === 'loading' ? (
              <Text style={{ ...ty.caption, color: t.ink3 }}>Reading the program…</Text>
            ) : readStatus === 'error' || readStatus === 'partial' ? (
              <Notice tone={t.warn} kicker="Not Read" title="This program could not be read"
                note="That is not the same as there being no program. Go back and open it again once you have signal." />
            ) : (
              <Notice tone={t.ink3} kicker="Program" title={clientId && !templateId && !historyId ? `${first} has no coach-assigned program` : 'This program is no longer in your library'} />
            )}
            {clientId && !templateId && !historyId && readStatus === 'ready' ? (
              <View style={{ marginTop: sp.md }}>
                <Cta label={`Build New Program for ${first}`} wide onPress={editInBuilder} />
              </View>
            ) : null}
          </Section>
        ) : (
          <>
            <Section>
              <Text style={{ ...ty.title, color: t.ink }}>{title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.sm }}>
                <TonedChip label="View Only" tone="neutral" icon="eye" />
                <TonedChip label={`${num(weeks.length)} Week${weeks.length === 1 ? '' : 's'}`} tone="purple" />
                {program.focus?.length ? <TonedChip label={program.focus.join(' · ')} tone="blue" /> : null}
              </View>
              {program.note ? <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{program.note}</Text> : null}
              <View style={{ marginTop: sp.md }}><DayPips days={program.days} weekDays={WEEK_DAYS} /></View>
              {/* The two writes, explicit. Nothing happens on opening. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.lg }}>
                {templateId ? (
                  <Cta label={clientId ? `Assign to ${first}` : 'Assign to Clients'} onPress={assign} />
                ) : null}
                {!historyId ? (
                  <Ghost icon="pencil" label={templateId ? 'Edit in Builder' : 'Edit Program'} onPress={editInBuilder} />
                ) : null}
              </View>
              {historyId ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  An earlier block, kept for the record. Putting it back is an assign, so it goes through the builder.
                </Text>
              ) : null}
            </Section>
          </>
        )}

        {/* What the client did, above what was written: the coach asked for
            the last session first. */}
        {clientId ? <SessionLog log={log} status={logStatus} unit={unit} who={first} onRefresh={() => { void loadLog(); }} /> : null}

        {program ? weeks.map((w, wi) => (
          <Section key={`w${wi}`}>
            <SectionHead title={weeks.length > 1 ? `Week ${wi + 1}` : 'The Week'} />
            {w.days.map((d, di) => (
              <View key={`${d.day}-${di}`} style={{ marginTop: di ? sp.md : 0, paddingTop: di ? sp.md : 0, borderTopWidth: di ? hairline : 0, borderTopColor: t.ring }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>{d.day}{d.focus ? ` · ${d.focus}` : ''}</Text>
                {d.exercises.length === 0 ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{d.cardio ? d.cardio : 'Rest'}</Text>
                ) : d.exercises.map((x, xi) => (
                  <View key={`${x.key}-${xi}`} style={{ flexDirection: 'row', gap: sp.sm, marginTop: 6 }}>
                    <Text style={{ ...ty.label, ...font('600'), color: t.ink, flex: 1 }}>{x.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink2, flexShrink: 1, textAlign: END_ALIGN }}>{prescription(x, unit)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </Section>
        )) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
