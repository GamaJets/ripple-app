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
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates, type ProgramTemplate } from '../../src/ui/programTemplates';
import { notifySuccess } from '../../src/ui/haptics';
import { guardOverwrite } from '../../src/lib/overwriteGuard';

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
  const [assignTpl, setAssignTpl] = useState<ProgramTemplate | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [delFailed, setDelFailed] = useState<string | null>(null);

  // One assign here is many overwrites, so it is held until the programmes it
  // would replace have actually been read. See src/lib/overwriteGuard.ts.
  const assignGuard = guardOverwrite(programStatus, 'the programmes these clients are currently on');

  const openAssign = (tpl: ProgramTemplate) => { setPicked({}); setAssignTpl(tpl); };
  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  const doAssign = async () => {
    if (!assignTpl || pickedIds.length === 0 || !assignGuard.allowed) return;
    const results = await Promise.all(pickedIds.map((id) => assignProgram(id, assignTpl.program)));
    const okCount = results.filter(Boolean).length;
    notifySuccess();
    const tpl = assignTpl; const n = pickedIds.length;
    setAssignTpl(null);
    Alert.alert(okCount === n ? 'Assigned' : 'Partly assigned', okCount === n
      ? `“${tpl.name}” assigned to ${n} client${n > 1 ? 's' : ''}. They'll see it on their Train tab.`
      : `${okCount} of ${n} saved. The rest are on this device only — clients you added by hand have no Train tab until they join.`);
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
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program templates</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Build once, assign to many. Save any program from the builder.
        </Text>

        <Section>
          <Cta label="Build a New Program" wide onPress={() => router.push('/(trainer)/builder')} />
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
                      <Text style={{ ...ty.caption, color: replaces ? t.warn : t.ink3, marginTop: 2 }}>
                        {c.goal}{replaces ? ' · replaces the program they are on' : ''}
                      </Text>
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
                  <Cta label={assignGuard.label ?? `Assign to ${pickedIds.length || 0} client${pickedIds.length === 1 ? '' : 's'}`} wide
                    disabled={pickedIds.length === 0 || !assignGuard.allowed} onPress={doAssign} />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
