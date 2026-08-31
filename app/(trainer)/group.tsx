// Trainer · Program Groups. A coach running a bootcamp writes the programme
// once, names the people it is for, and sends it to all of them — then sees, at
// a glance, which of them is actually on it.
//
// ── The design decision, and the one it was chosen over ────────────────────
//
// A group owns the LIST. It does not own the PLAN.
//
// Assigning to a group is a FAN-OUT: the group's programme is written into each
// member's own `assigned_programs` row, exactly as if the coach had opened the
// builder eight times. The alternative — a group row that owns the programme,
// with clients pointing at it — is tidier on paper and worse everywhere the
// data is read. Everything downstream of a programme is already per client
// (the client's Train tab, their logged sets, adherence, the injury
// acknowledgement of a specific movement for a specific person), so a
// group-owned plan would have to be reconciled against per-client progress on
// every read, in a shipped client app that knows nothing about groups. And
// divergence is not the exception here, it is the job: a client turns up with a
// shoulder on the Wednesday and needs a different row on the Thursday. Under a
// group-owned plan that is an override table — a second source of truth for the
// same question — and under this one it is simply their row, edited in the
// builder, touching nobody else. The full argument, including what this costs,
// is in supabase/parts/134-a-programme-written-once.sql.
//
// The cost, stated plainly on this screen rather than hidden: editing the
// group's programme does NOT rewrite what anybody is already training. It
// changes what the next assign sends, and the members then read as "on
// something different" — which is true, and is the coach's decision to make.
//
// ── The injury gate is per client, and a bulk assign is where that gets lost ─
//
// `src/lib/injuryGate.ts` withholds Assign when a client's disclosures could
// not be READ, not merely when they are empty. A fan-out that asked once
// because asking eleven times was awkward would be the worst version of this
// feature, so the plan is computed per member and the list is SPLIT: the ones
// who are clear get the programme now, the ones who are not are named on this
// screen with their own reason, and the button says "Assign to 7 of 8" rather
// than "Assigned". Nobody is silently skipped. See src/lib/groupProgram.ts.
//
// ── LoadStatus ─────────────────────────────────────────────────────────────
//
// A group whose membership could not be read must never render as an empty
// group: eight people and a refused read look identical, and an assign over
// that would report success having reached nobody. Every count on this page is
// held behind a whole read of BOTH the membership and `assigned_programs`,
// because "three of eight have it" computed off part of either is a wrong
// sentence, not a smaller one.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import { useProgramGroups, type ProgramGroup } from '../../src/ui/groupProgram';
import {
  planFanOut, programSignature, memberState, groupCoverage, listNames, fanOutSubject,
  type FanOutMember, type MemberState,
} from '../../src/lib/groupProgram';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { areaLabel, injuryFlag, type Injury } from '../../src/lib/injuries';
import { num } from '../../src/lib/format';
import type { Program } from '../../src/lib/programs';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { notifySuccess } from '../../src/ui/haptics';

/** What a member's chip says. Never "not assigned yet" off an unread
 *  `assigned_programs` — that is the sentence a coach acts on by assigning. */
const STATE_LABEL: Record<MemberState, string> = {
  on: 'on this programme',
  diverged: 'on a different programme',
  none: 'no programme assigned',
  unknown: 'what they are on could not be read',
};

export default function Groups() {
  const t = useTheme();
  const router = useRouter();
  const { groups, status: groupStatus, createGroup, deleteGroup, setGroupProgram, addMembers, removeMember } = useProgramGroups();
  const { roster, status: rosterStatus } = useRoster();
  const { getProgram, assignProgram, status: programStatus } = useAssignedPrograms();
  const { templates, status: tplStatus } = useProgramTemplates();
  const acks = useInjuryAcks();

  const [newName, setNewName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickTpl, setPickTpl] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [writeNote, setWriteNote] = useState<string | null>(null);

  const open: ProgramGroup | null = groups.find((g) => g.id === openId) ?? null;

  // ── One member, seen the way both guards need to see them ────────────────
  //
  // `disclosures` is how the read of THIS person's own injury list went, which
  // is a different question from how the acknowledgement read went and is the
  // one a bulk assign forgets to ask. A member the roster never produced has an
  // empty injury list for the same reason a healthy client does, so the status
  // is what separates them: under a failed roster read nobody is trustworthy,
  // and a member missing from a whole read is somebody we did not find out
  // about.
  const asMember = (clientId: string): FanOutMember => {
    const c = roster.find((r) => r.id === clientId);
    const disclosures: LoadStatus =
      rosterStatus === 'error' ? 'error'
      : c ? 'ready'
      : rosterStatus === 'loading' ? 'loading'
      : 'error';
    const injuries: Injury[] = (c?.injuries ?? []).map((i, n) => ({
      id: `${clientId}-${n}`, area: i.area, severity: i.severity as Injury['severity'],
      status: 'active', note: i.note, at: '',
    }));
    return {
      clientId,
      name: c?.name.split(' ')[0] ?? 'This client',
      disclosures,
      ackStatus: acks.status,
      injuries,
      acknowledged: acks.acknowledged(clientId),
    };
  };

  const members = useMemo(() => (open ? open.memberIds.map(asMember) : []), [open, roster, rosterStatus, acks]);
  const groupSig = useMemo(() => programSignature(open?.program ?? null), [open]);
  const states = useMemo(
    () => (open ? open.memberIds.map((id) => memberState(programStatus, groupSig, getProgram(id))) : []),
    [open, groupSig, programStatus, getProgram],
  );
  const cover = groupCoverage(states, groupStatus, programStatus);

  const plan = useMemo(
    () => planFanOut(groupStatus, programStatus, members, !!open?.program, fanOutSubject(members.length)),
    [groupStatus, programStatus, members, open],
  );

  // Which movements in the group's programme load what a member has disclosed.
  // Only asked of the members this assign would actually reach — the held ones
  // are not being written to, so there is nothing to warn about for them.
  const loadsFor = (m: FanOutMember): { exercise: string; area: string; severity: string }[] => {
    const p = open?.program;
    if (!p || !m.injuries.length) return [];
    return p.days.flatMap((d) => d.exercises)
      .map((e) => ({ e, f: injuryFlag(e.name, e.group || '', m.injuries) }))
      .filter((x) => x.f !== null)
      .map((x) => ({ exercise: x.e.name, area: x.f!.injury.area, severity: x.f!.injury.severity }));
  };

  // The coach's decision to load a disclosed injury on purpose, recorded before
  // the programme goes out and per client. Same table and same rule as the
  // builder: a programme that went out while the record of the decision did not
  // is the one outcome worse than having no record at all, because afterwards
  // it looks exactly like a coach who never knew.
  const recordChoice = async (clientId: string, movements: { exercise: string; area: string; severity: string }[]): Promise<boolean> => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase.from('program_injury_acknowledgements')
        .insert({ trainer_id: uid, client_id: clientId, movements })
        .select('id');
      if (error) { reportError('group.injuryChoice', error, { clientId }); return false; }
      // Counted, not merely un-errored: a row the policy filtered out is not an
      // error in PostgREST, and this record is the only thing that will ever
      // say the coach knew.
      if (!data || !data.length) {
        reportError('group.injuryChoice', new Error('acknowledgement insert returned no row'), { clientId });
        return false;
      }
      return true;
    } catch (e) { reportError('group.injuryChoice', e, { clientId }); return false; }
  };

  const doAssign = async () => {
    // Belt as well as braces. The control is withheld above and the handler
    // refuses too — an overwrite of several people's training must not be one
    // stray render away from happening.
    if (!open || !open.program || !plan.allowed || busy) return;
    const program = open.program;
    setBusy(true);
    setWriteNote(null);
    try {
      const sending = members.filter((m) => plan.send.includes(m.clientId));

      // Knowing about a disclosure is not the same as deciding to load it
      // anyway. Asked once for the whole group, because it is one programme —
      // but itemised by person, so the coach sees whose shoulder it is.
      const loaded = sending.map((m) => ({ m, movements: loadsFor(m) })).filter((x) => x.movements.length > 0);
      if (loaded.length) {
        const lines = loaded.slice(0, 6).map((x) =>
          `· ${x.m.name} — ${x.movements.slice(0, 2).map((v) => `${v.exercise} (${areaLabel(v.area).toLowerCase()}, ${v.severity})`).join('; ')}`);
        const more = loaded.length - lines.length;
        const go = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'This programme loads what they disclosed',
            `${lines.join('\n')}${more > 0 ? `\n· and ${more} more` : ''}\n\n` +
              'You can absolutely programme these on purpose. Confirming records that you chose to, with the date, for each of them — and they can see that record too.',
            [
              { text: 'Change the Programme', style: 'cancel', onPress: () => resolve(false) },
              { text: 'I Know — Assign', style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!go) { setBusy(false); return; }
      }

      const norecord: string[] = [];
      const failed: string[] = [];
      const done: string[] = [];
      for (const m of sending) {
        const movements = loadsFor(m);
        if (movements.length) {
          const recorded = await recordChoice(m.clientId, movements);
          // Their programme is abandoned, not sent-and-unrecorded. The others
          // are unaffected: this is one client's record, not the group's.
          if (!recorded) { norecord.push(m.name); continue; }
        }
        const saved = await assignProgram(m.clientId, program);
        if (saved) done.push(m.name); else failed.push(m.name);
      }

      if (done.length) notifySuccess();
      const parts: string[] = [];
      parts.push(done.length
        ? `${listNames(done)} ${done.length === 1 ? 'is' : 'are'} now on “${program.title}” and will see it on their Train tab.`
        : 'Nobody was assigned.');
      if (plan.blocked.length) {
        parts.push(`${listNames(plan.blocked.map((b) => b.name))} ${plan.blocked.length === 1 ? 'was' : 'were'} NOT assigned — read what they have disclosed first.`);
      }
      if (norecord.length) {
        parts.push(`${listNames(norecord)} ${norecord.length === 1 ? 'was' : 'were'} NOT assigned: the record of your decision to load a disclosed injury could not be saved, and sending it without that record would leave no sign you knew.`);
      }
      if (failed.length) {
        parts.push(`${listNames(failed)} did not reach the server, so ${failed.length === 1 ? 'they cannot' : 'they cannot'} see it yet. Clients you added by hand have no Train tab until they join.`);
      }
      setWriteNote(parts.length > 1 ? parts.slice(1).join(' ') : null);
      Alert.alert(
        done.length === members.length ? 'Assigned' : done.length ? 'Partly assigned' : 'Not assigned',
        parts.join('\n\n'),
        [{ text: 'OK' }],
      );
    } finally { setBusy(false); }
  };

  const doAddMembers = async () => {
    if (!open) return;
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (!ids.length) { setAddOpen(false); return; }
    const res = await addMembers(open.id, ids);
    setAddOpen(false); setPicked({});
    if (res.failed.length) {
      const names = res.failed.map((id) => roster.find((c) => c.id === id)?.name ?? 'One client');
      Alert.alert(
        res.added.length ? 'Some were not added' : 'Nobody was added',
        `${listNames(names)} ${res.failed.length === 1 ? 'is' : 'are'} not in the group — the server did not accept ${res.failed.length === 1 ? 'them' : 'them'}. Clients you added by hand have no account yet, so there is nothing to assign a programme to until they join.`,
      );
    }
  };

  const G = layout.gutter;
  // Only sayable off two whole reads. A tally over a membership that came back
  // short is not the size of the group.
  const coverLine = cover.countable
    ? `${num(cover.on)} on it · ${num(cover.diverged)} on something else · ${num(cover.none)} not assigned`
    : 'who has it cannot be counted yet';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Write it once</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program Groups</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          A bootcamp, a 6am class, a beginners' block. One programme goes to everybody in the group — and any one of them can be changed afterwards without touching the rest.
        </Text>

        {/* An empty list under a failed read is not an empty list, and this is
            the screen where that mistake sends a coach looking for work they
            have not lost. */}
        {groupStatus === 'error' ? (
          <Notice tone={t.warn} kicker="Groups" title="Your groups could not be read"
            note="Nothing is listed below because the read did not come back — it does not mean you have no groups. Nothing here can be assigned until it loads." />
        ) : groupStatus === 'partial' ? (
          <PartialRead what="groups and the people in them" shown={groups.length} />
        ) : null}

        <Section>
          <SectionHead title="Groups" note={groupStatus === 'ready' && groups.length ? String(groups.length) : undefined} />

          {groups.length === 0 && groupStatus === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>No groups yet — name one below and add the clients who train it together.</Text>
          ) : null}

          {groups.map((g, i) => {
            const isOpen = g.id === openId;
            return (
              <Pressable key={g.id} onPress={() => { setOpenId(isOpen ? null : g.id); setWriteNote(null); }}
                accessibilityRole="button" accessibilityLabel={g.name}
                style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="people" size={18} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{g.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {/* The member count is a figure like any other: only
                          sayable off a whole read of the membership. */}
                      {groupStatus === 'ready' ? `${g.memberIds.length} ${g.memberIds.length === 1 ? 'client' : 'clients'}` : 'membership not read'}
                      {g.program ? ` · ${g.program.title}` : ' · no programme yet'}
                    </Text>
                  </View>
                  <Icon name="chevron" size={16} color={t.ink3} />
                </View>
              </Pressable>
            );
          })}

          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            <TextInput value={newName} onChangeText={setNewName} placeholder="New group name" placeholderTextColor={t.ink3}
              accessibilityLabel="New group name"
              style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }} />
            <Cta label="Create" disabled={!newName.trim()} onPress={async () => {
              const nm = newName.trim();
              const id = await createGroup(nm);
              setNewName('');
              if (!id) { Alert.alert('Not created', `“${nm}” did not reach the server, so it is not in your groups. Try again once you have signal.`); return; }
              setOpenId(id);
            }} />
          </View>
        </Section>

        {open ? (
          <>
            <Rule />
            <Section>
              <SectionHead title={open.name} note={cover.countable ? `${num(cover.on)}/${num(cover.total)}` : undefined} />

              {/* ── the programme ─────────────────────────────────────────── */}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>Programme</Text>
              <Text style={{ ...ty.body, color: open.program ? t.ink : t.ink3, marginTop: 4 }}>
                {open.program
                  ? `${open.program.title} · ${open.program.days.length} days · ${open.program.days.reduce((a, d) => a + d.exercises.length, 0)} exercises`
                  : 'None chosen yet — pick one from your library.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <Ghost label={open.program ? 'Change Programme' : 'Choose From Library'} onPress={() => setPickTpl(true)} />
                <Ghost label="Add Clients" onPress={() => { setPicked({}); setAddOpen(true); }} />
              </View>
              {open.program ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  Changing the programme here does not change what anybody is already training. It changes what the next assign sends — the people below will then read as being on something different, which is the truth about their week until you send it.
                </Text>
              ) : null}

              <View style={{ marginTop: sp.lg }} />
              <Rule />

              {/* ── who has it and who does not ───────────────────────────── */}
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>Who has it</Text>
                <Text style={{ ...ty.body, color: cover.countable ? t.ink : t.ink3, marginTop: 4 }}>{coverLine}</Text>
                {!cover.countable ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                    {groupStatus !== 'ready'
                      ? 'Who is in this group has not been read, so nothing here is a count of anybody.'
                      : 'What these clients are currently on has not been read, so an absent programme below means "we did not find out" rather than "none".'}
                  </Text>
                ) : null}
              </View>

              {groupStatus === 'ready' && open.memberIds.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Nobody in this group yet — add the clients who train it together.</Text>
              ) : null}

              {open.memberIds.map((id, i) => {
                const m = asMember(id);
                const st = states[i] ?? 'unknown';
                const held = plan.blocked.find((b) => b.clientId === id);
                const tone = held ? t.warn : st === 'on' ? t.good : st === 'unknown' ? t.ink3 : t.ink3;
                return (
                  <View key={id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{m.name.slice(0, 2)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{m.name}</Text>
                        <Text style={{ ...ty.caption, color: tone, marginTop: 2 }}>{STATE_LABEL[st]}</Text>
                      </View>
                      {/* One person's copy, edited without touching anybody
                          else's — which is the whole reason the group owns the
                          list and not the plan. */}
                      <Ghost label="Just Theirs" onPress={() => router.push({ pathname: '/(trainer)/builder', params: { clientId: id } })} />
                      <Pressable onPress={() => Alert.alert('Remove from group?', `Take ${m.name} out of “${open.name}”? This does not change the programme they are on.`, [
                        { text: 'Keep', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: async () => {
                          const gone = await removeMember(open.id, id);
                          if (!gone) Alert.alert('Not removed', `${m.name} is still in “${open.name}” — the removal did not reach the server.`);
                        } },
                      ])} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + m.name} style={{ padding: 8 }}>
                        <Icon name="minus" size={17} color={t.ink3} />
                      </Pressable>
                    </View>
                    {held ? (
                      <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{held.reason}</Flag>
                    ) : null}
                  </View>
                );
              })}

              {/* ── the assign ────────────────────────────────────────────── */}
              {!plan.allowed && plan.reason ? (
                <Notice tone={t.warn} kicker="Assign" title={plan.label ?? 'Held'} note={plan.reason} />
              ) : null}
              {plan.allowed && plan.heldNote ? (
                <Notice tone={t.warn} kicker="Not everybody" title="Some of this group is held" note={plan.heldNote} />
              ) : null}
              {writeNote ? (
                <Notice tone={t.warn} kicker="Last assign" title="Not everybody got it" note={writeNote} />
              ) : null}

              <View style={{ marginTop: sp.lg }}>
                <Cta wide disabled={!plan.allowed || busy}
                  label={busy ? 'Assigning…' : (plan.label ?? `Assign to ${plan.send.length} ${plan.send.length === 1 ? 'client' : 'clients'}`)}
                  onPress={doAssign} />
              </View>

              <View style={{ marginTop: sp.md, alignItems: 'flex-start' }}>
                <Ghost label="Delete Group" onPress={() => Alert.alert('Delete group?', `Remove “${open.name}”? The clients keep the programmes they are on — this only deletes the list.`, [
                  { text: 'Keep', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => {
                    const gone = await deleteGroup(open.id);
                    if (!gone) { Alert.alert('Not deleted', `“${open.name}” is still in your groups — the delete did not reach the server.`); return; }
                    setOpenId(null);
                  } },
                ])} />
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>

      {/* ── pick the group's programme ──────────────────────────────────── */}
      <Modal visible={pickTpl} transparent animationType="slide" onRequestClose={() => setPickTpl(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPickTpl(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
            <Text style={{ ...ty.title, color: t.ink }}>Choose a programme</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
              A copy is taken now, so editing the template later will not quietly redefine what this group is understood to be doing.
            </Text>
            {/* Three starters are always present, so a failed read of the
                coach's own library looks like a healthy library with somebody
                else's programmes in it. */}
            {tplStatus === 'error' ? (
              <Notice tone={t.warn} kicker="Library" title="Your saved templates could not be read"
                note="Only the built-in starters are listed. That is not a statement that you have saved nothing." />
            ) : tplStatus === 'partial' ? (
              <PartialRead what="templates in your library" shown={templates.length} />
            ) : null}
            {templates.map((tpl, i) => (
              <Pressable key={tpl.id} onPress={async () => {
                if (!open) return;
                setPickTpl(false);
                const saved = await setGroupProgram(open.id, tpl.program);
                if (!saved) Alert.alert('Not saved', `“${tpl.name}” is showing as this group's programme on this screen but did not reach the server, so it will be gone when you reopen the app. Try again once you have signal.`);
              }} accessibilityRole="button" accessibilityLabel={tpl.name}
                style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {tpl.program.days.length} days · {tpl.program.days.reduce((a, d) => a + d.exercises.length, 0)} exercises
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── add clients to the group ────────────────────────────────────── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
            <Text style={{ ...ty.title, color: t.ink }}>Add to “{open?.name ?? ''}”</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
              Adding somebody does not assign them anything. It puts them on the list, and the next assign reaches them.
            </Text>
            {/* An unread roster is not an empty one, and a short one is not the
                whole book. */}
            {rosterStatus === 'error' ? (
              <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                note="Nobody is listed below because the roster did not come back — it does not mean you have no clients." />
            ) : rosterStatus === 'partial' ? (
              <PartialRead what="clients on your book" shown={roster.length} />
            ) : null}
            {roster.filter((c) => !open?.memberIds.includes(c.id)).map((c, i) => {
              const on = !!picked[c.id];
              return (
                <Pressable key={c.id} onPress={() => setPicked((p) => ({ ...p, [c.id]: !p[c.id] }))}
                  accessibilityRole="button" accessibilityLabel={c.name}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: on ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.goal}</Text>
                  </View>
                </Pressable>
              );
            })}
            <View style={{ marginTop: sp.lg }}>
              <Cta wide label={`Add ${Object.keys(picked).filter((k) => picked[k]).length || 0}`}
                disabled={!Object.keys(picked).some((k) => picked[k])} onPress={doAddMembers} />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
