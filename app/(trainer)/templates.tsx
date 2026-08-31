// Trainer · Program Templates. The coach's saved weekly programs — build once,
// assign to many. Tap a template to bulk-assign it to any selection of clients
// (each gets it on their Train tab), open it in the builder, or delete it.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional, modal and route from
// the previous version is preserved — only the presentation changed: the bordered
// template cards and the dashed "build" button became hairline-separated rows and
// a single primary action, and the Georgia serif headers are gone.
//
// ── The bulk assign is now withheld, not warned about ──────────────────────
//
// One tap in the sheet below replaces the training programme of every client
// the coach ticked. `getProgram` returns null both for a client who is on
// nothing and for a client whose row did not come back, so against an unread
// `assigned_programs` that tap silently overwrote however many of them were on
// something bespoke — and the confirmation said "Assigned". The control waits
// for a whole read now, and when it has one it marks the clients whose
// programme it is about to replace. See src/lib/overwriteGuard.ts.
//
// The library itself had the quieter half of the same problem: three built-in
// starters are always present, so a failed read of the coach's own templates
// produced a page that looked perfectly healthy and was missing everything
// they had ever built.
//
// ── The injury gate was not applied here at all ────────────────────────────
//
// The builder withholds Assign for ONE client until their disclosures have
// been read — src/lib/injuryGate.ts, which refuses when the disclosures could
// not be READ and not merely when they are empty. This sheet, which assigns to
// twelve people at once, asked nothing. So the single fastest way to put a
// programme in front of somebody's shoulder without ever seeing it was to tick
// their name here instead of opening them in the builder, and the coach would
// have been told "Assigned".
//
// The gate is now consulted PER TICKED CLIENT, through the same fan-out plan
// the group screen uses (src/lib/groupProgram.ts). The clear ones are assigned;
// the ones whose disclosures have not been read are named on their own row,
// excluded from the write, and the button says "Assign to 7 of 8". Nobody is
// silently skipped — a bulk assign that quietly dropped somebody would be worse
// than one that refused, because the coach would believe they had sent it.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates, type ProgramTemplate } from '../../src/ui/programTemplates';
import { notifySuccess } from '../../src/ui/haptics';
import { guardOverwrite } from '../../src/lib/overwriteGuard';
import { planFanOut, listNames, fanOutSubject, type FanOutMember } from '../../src/lib/groupProgram';
import type { LoadStatus } from '../../src/ui/loadStatus';
import type { Injury } from '../../src/lib/injuries';

export default function Templates() {
  const t = useTheme();
  const router = useRouter();
  // All three providers carry a status and this screen read none of them.
  //
  // The library is seeded with three built-in starters, so a failed read of
  // `program_templates` produces a page that looks entirely healthy and is
  // missing every programme the coach ever built — and "No templates yet" is
  // printed under the same condition. The bulk assign below is worse: it
  // replaces the programme of every client the coach ticks, and `getProgram`
  // returns null both for a client who has none and for a client whose row did
  // not come back. Ticking twelve names against an unread `assigned_programs`
  // silently overwrites however many of them were on something bespoke.
  const { templates, removeTemplate, status: tplStatus } = useProgramTemplates();
  const { roster, status: rosterStatus } = useRoster();
  const { assignProgram, getProgram, status: programStatus } = useAssignedPrograms();
  const acks = useInjuryAcks();
  const [assignTpl, setAssignTpl] = useState<ProgramTemplate | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [delFailed, setDelFailed] = useState<string | null>(null);

  // One assign here is many overwrites, so it is held until the programmes it
  // would replace have actually been read. See src/lib/overwriteGuard.ts.
  // Kept alongside the plan below because it is what licenses the "replaces the
  // program they are on" marker on each row, which is a claim about a read.
  const assignGuard = guardOverwrite(programStatus, 'the programmes these clients are currently on');

  const openAssign = (tpl: ProgramTemplate) => { setPicked({}); setAssignTpl(tpl); };
  const pickedIds = Object.keys(picked).filter((k) => picked[k]);

  // ── One ticked client, as both guards need to see them ───────────────────
  //
  // `disclosures` is how the read of THIS person's own injury list went, and is
  // a different question from how the acknowledgement read went. A client the
  // roster never produced has an empty injury list for exactly the same reason
  // a healthy client does, so only the status separates them — and a gate that
  // opened on that silence is how somebody gets overhead press programmed
  // around a shoulder nobody read.
  const asMember = (clientId: string): FanOutMember => {
    const c = roster.find((r) => r.id === clientId);
    const disclosures: LoadStatus =
      rosterStatus === 'error' ? 'error'
      : c ? 'ready'
      : rosterStatus === 'loading' ? 'loading'
      : 'error';
    return {
      clientId,
      name: c?.name.split(' ')[0] ?? 'This client',
      disclosures,
      ackStatus: acks.status,
      injuries: (c?.injuries ?? []).map((i, n): Injury => ({
        id: `${clientId}-${n}`, area: i.area, severity: i.severity as Injury['severity'],
        status: 'active', note: i.note, at: '',
      })),
      acknowledged: acks.acknowledged(clientId),
    };
  };
  const pickedMembers = pickedIds.map(asMember);
  // 'ready' for the list itself: unlike a group's membership, this list is the
  // ticks the coach just made with their own thumb. There is no read of it that
  // could have come back short — the roster it was ticked FROM carries its own
  // banner above.
  const plan = planFanOut('ready', programStatus, pickedMembers, !!assignTpl, fanOutSubject(pickedIds.length));

  const doAssign = async () => {
    if (!assignTpl || !plan.allowed) return;
    const tpl = assignTpl;
    const sending = plan.send;
    const results = await Promise.all(sending.map((id) => assignProgram(id, tpl.program)));
    const okCount = results.filter(Boolean).length;
    if (okCount) notifySuccess();
    setAssignTpl(null);
    const parts: string[] = [];
    parts.push(okCount
      ? `“${tpl.name}” assigned to ${okCount} client${okCount === 1 ? '' : 's'}. They'll see it on their Train tab.`
      : 'Nobody was assigned.');
    if (okCount < sending.length) {
      parts.push(`${sending.length - okCount} did not reach the server, so they are on this device only — clients you added by hand have no Train tab until they join.`);
    }
    // Named, never silently dropped. A coach who believes twelve people got a
    // programme when eleven did is worse off than one who was refused.
    if (plan.blocked.length) {
      parts.push(`${listNames(plan.blocked.map((b) => b.name))} ${plan.blocked.length === 1 ? 'was' : 'were'} NOT assigned — they have disclosed injuries this screen cannot confirm you have read. Open them in the builder and read what they disclosed.`);
    }
    Alert.alert(
      !okCount ? 'Not assigned' : (okCount === pickedIds.length ? 'Assigned' : 'Partly assigned'),
      parts.join('\n\n'),
    );
  };

  const dayCount = (tpl: ProgramTemplate) => tpl.program.days.length;
  const exCount = (tpl: ProgramTemplate) => tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your library</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program Templates</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Build once, assign to many. Save any program from the builder.
        </Text>

        <Section>
          <Cta label="Build a New Program" wide onPress={() => router.push('/(trainer)/builder')} />
          {/* A tick-list is remembered by nobody. A group is the same fan-out
              with the list kept, so tomorrow the coach can still answer "who is
              on the bootcamp programme". */}
          <View style={{ marginTop: sp.sm }}>
            <Ghost label="Program Groups" onPress={() => router.push('/(trainer)/group')} />
          </View>
        </Section>

        <Rule />

        <Section>
          {/* A count over a library that came back short is not the size of the
              library. Only a whole read may be counted. */}
          <SectionHead title="Templates" note={tplStatus === 'ready' && templates.length ? String(templates.length) : undefined} />

          {/* The starters are the problem, not the consolation. Three of them
              are always present, so a coach whose dozen saved programmes did
              not come back sees a working library with somebody else's
              programmes in it and concludes their work is gone. */}
          {tplStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Library" title="Your saved templates could not be read"
              note="Only the built-in starters are listed below. That is not a statement that you have saved nothing — your own programmes are on the server and did not come back. Reopen this screen once you have signal." />
          ) : tplStatus === 'partial' ? (
            <PartialRead what="templates in your library" shown={templates.length} />
          ) : null}

          {delFailed ? (
            <Notice tone={t.crit} kicker="Delete" title="That template was not deleted" note={delFailed} />
          ) : null}

          {templates.length === 0 && tplStatus === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No templates yet — build a program above and save it here.</Text>
          ) : null}
          {templates.map((tpl, i) => (
            <View key={tpl.id} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="grid" size={18} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dayCount(tpl)} days · {exCount(tpl)} exercises{tpl.id.startsWith('seed_') ? ' · starter' : ''}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}><Cta label="Assign to Clients" wide onPress={() => openAssign(tpl)} /></View>
                <Ghost label="Edit" onPress={() => router.push({ pathname: '/(trainer)/builder', params: { templateId: tpl.id } })} />
                {/* `removeTemplate` resolves false when the delete never
                    reached the server, and the row disappears from this list
                    either way. Without saying so, a refused delete looks
                    exactly like a successful one until the template reappears
                    at the next launch. */}
                {!tpl.id.startsWith('seed_') ? (
                  <Pressable onPress={() => Alert.alert('Delete template?', `Remove “${tpl.name}”?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
                    const gone = await removeTemplate(tpl.id);
                    setDelFailed(gone ? null : `“${tpl.name}” is off this list but the server did not confirm the delete, so it is still in your library and will be back when you reopen the app.`);
                  } }])}
                    hitSlop={8} accessibilityRole="button" accessibilityLabel={'Delete ' + tpl.name} style={{ padding: 8 }}>
                    <Icon name="minus" size={17} color={t.ink3} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </Section>

      </ScrollView>

      {/* ── bulk-assign sheet ────────────────────────────────────────────── */}
      <Modal visible={!!assignTpl} transparent animationType="slide" onRequestClose={() => setAssignTpl(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAssignTpl(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%', ...elevation.e2 }}>
          {assignTpl && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
              <Text style={{ ...ty.title, color: t.ink }}>Assign “{assignTpl.name}”</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>Pick the clients who should get this program.</Text>

              {/* This assign replaces whatever each client is on, so the sheet
                  has to say which of them are on something. Under any status
                  but 'ready' it cannot, and the button at the bottom is
                  withheld rather than annotated. */}
              {!assignGuard.allowed ? (
                <Notice tone={t.warn} kicker={programStatus === 'loading' ? 'Reading' : 'Programmes'}
                  title={programStatus === 'loading' ? 'Reading what these clients are on' : 'What these clients are on could not be read'}
                  note={assignGuard.reason ?? undefined} />
              ) : null}

              {/* The injury half. Held per ticked client, and said out loud —
                  a bulk assign that quietly dropped somebody would leave the
                  coach believing they had sent it. */}
              {assignGuard.allowed && !plan.allowed && plan.reason && pickedIds.length ? (
                <Notice tone={t.warn} kicker="Injuries" title={plan.label ?? 'Held'} note={plan.reason} />
              ) : null}
              {plan.allowed && plan.heldNote ? (
                <Notice tone={t.warn} kicker="Not everybody" title="Some of these are held" note={plan.heldNote} />
              ) : null}

              {/* An unread roster is not an empty one, and a short one is not
                  the whole book — "Select all" over it selects part of it. */}
              {rosterStatus === 'error' ? (
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="Nobody is listed below because the roster did not come back — it does not mean you have no clients." />
              ) : rosterStatus === 'partial' ? (
                <PartialRead what="clients on your book" shown={roster.length} />
              ) : null}

              {roster.length === 0 && rosterStatus === 'ready' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>No clients yet — add or invite a client first.</Text>
              ) : null}
              {roster.map((c, i) => {
                const on = !!picked[c.id];
                // Only sayable off a whole read. Under any other status the
                // absence of a programme means nothing was found out, and
                // marking somebody "no program yet" on that basis is how a
                // coach comes to overwrite one without realising.
                const replaces = assignGuard.allowed && !!getProgram(c.id);
                const held = plan.blocked.find((b) => b.clientId === c.id);
                return (
                  <Pressable key={c.id} onPress={() => setPicked((p) => ({ ...p, [c.id]: !p[c.id] }))}
                    accessibilityRole="button" accessibilityLabel={c.name}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: on ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      {on ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                    </View>
                    <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{c.name.split(' ').map((x) => x[0]).join('')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                      {/* The warning is a DOT, not the ink. warn as caption text
                          measures 3.87–4.08:1 on the three light palettes —
                          under AA — so "replaces the program they are on" was
                          hardest to read on the coach who most needed it. The
                          words carry the meaning; the dot carries the tone at
                          the 3:1 a mark has to clear. */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {replaces ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                        <Text style={{ ...ty.caption, color: replaces ? t.ink2 : t.ink3, flex: 1 }}>
                          {c.goal}{replaces ? ' · replaces the program they are on' : ''}
                        </Text>
                      </View>
                      {/* Their own sentence, on their own row. A count of how
                          many are held tells the coach nothing about whose
                          shoulder it is. */}
                      {held ? (
                        <Flag tone={t.warn} style={{ marginTop: 4 }}>{held.reason}</Flag>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
                <Ghost label="Select All" onPress={() => setPicked(Object.fromEntries(roster.map((c) => [c.id, true])))} />
                <View style={{ flex: 1 }}>
                  {/* Withheld, not warned about. One tap here writes over as
                      many training programmes as there are ticks, with no undo
                      and nothing told to the clients — so it waits until the
                      screen knows what it would be replacing. */}
                  {/* `planFanOut` is shared with the Groups screen, and with
                      nobody ticked it answers in that screen's vocabulary:
                      "Nobody In This Group Yet". This screen has no groups —
                      the sheet opens with `setPicked({})` and the coach's whole
                      client list sitting directly above the button — so on
                      every fresh open the primary control named a group that
                      does not exist and told the coach it was empty while their
                      clients were on screen. The `??` fallback written for this
                      case could never run, because `plan.label` is null only
                      once at least one client is ticked. Asked before the
                      shared guard, so the guard keeps answering for every other
                      refusal (the overwrite check, a missing programme) where
                      its wording is right. */}
                  <Cta label={pickedIds.length === 0
                    ? 'Pick Who Gets This'
                    : (plan.label ?? `Assign to ${pickedIds.length} client${pickedIds.length === 1 ? '' : 's'}`)} wide
                    disabled={pickedIds.length === 0 || !plan.allowed} onPress={doAssign} />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
