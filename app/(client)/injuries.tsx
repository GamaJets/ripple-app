// Client · Injuries & limitations. Disclose injuries so the AI coach, your
// trainer, and the Train tab train AROUND them (safer swaps, cautions). Add an
// area, severity and note; mark recovered when you heal; delete anytime. Stored
// in the shared client profile (persisted). Guidance only — not medical advice.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): the
// per-injury bordered boxes became hairline-separated rows, the disclaimer
// became the screen's one <Notice>, and severity is a coloured dot beside ink
// text rather than coloured text.
//
// ── Correcting one, and deleting one on purpose ────────────────────────────
//
// This screen offered Mark Recovered, Reactivate and Delete, though
// `updateInjury` has always accepted any patch. So fixing a wrong severity or a
// typo meant Delete and re-add — and that is not a wash: re-adding mints a new
// id and a new disclosure key, which throws away the coach's acknowledgement
// over a spelling. Editing keeps the id and the disclosure date, so a
// correction is a correction (src/lib/injuryEdit.ts).
//
// What it does NOT do is get round the gate. `injuryKey` is `area:severity`, so
// changing either is a new disclosure and the coach is asked to read it again —
// correctly, because a mild knee that is now severe is news. The sheet says
// which of the two kinds of edit is being made before it is saved.
//
// And Delete now has an <Alert> in front of it, like every other destructive
// action in this app. It names the injury, because "are you sure?" over five
// rows a few pixels apart does not say which one, and it offers Mark Recovered
// to somebody whose injury has simply healed.
//
// NOTHING HERE TOUCHES THE DOCUMENT. An injury may have been read off a
// physiotherapy report, and that report is private to the client by design:
// own-folder storage policies with no trainer branch (supabase/parts/91), an
// allowlist that keeps the note away from the model (src/lib/coachShare.ts),
// and a viewer that never hands the file to another app
// (src/lib/injuryDocView.ts). Editing the injury a report produced changes the
// injury and nothing else.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, ListRow, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { INJURY_AREAS, areaLabel, newInjuryId, type Injury, type InjurySeverity } from '../../src/lib/injuries';
import { injuryPatch, editAckWarning, deleteInjuryConfirm, editSheetTitle } from '../../src/lib/injuryEdit';
import { ackState } from '../../src/lib/injuryGate';
import { useMyInjuryAcks } from '../../src/ui/injuryAcks';
import { fmtDay, num } from '../../src/lib/format';

const SEVS: { id: InjurySeverity; label: string }[] = [
  { id: 'mild', label: 'Mild' }, { id: 'moderate', label: 'Moderate' }, { id: 'severe', label: 'Severe' },
];

export default function Injuries() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState('knee');
  const [sev, setSev] = useState<InjurySeverity>('moderate');
  const [note, setNote] = useState('');
  // The injury being corrected, or null when the sheet is a first disclosure.
  // Held whole rather than as an id: the warning below is about what CHANGED,
  // so it needs the values as they were before the fields were touched.
  const [editing, setEditing] = useState<Injury | null>(null);

  const active = c.injuries.filter((i) => i.status === 'active');
  const past = c.injuries.filter((i) => i.status === 'recovered');
  const sevColor = (s: InjurySeverity) => (s === 'severe' ? t.crit : s === 'moderate' ? t.s3 : t.ink3);

  // Disclosing an injury has, until now, looked from this side exactly like a
  // form that went nowhere. The client had no way of knowing their coach ever
  // saw it, and no way of seeing what the coach then did about it — even though
  // both records were written to be readable by them (injury_ack_client_read
  // and program_inj_ack_client_r), and the second one exists specifically so
  // somebody who disclosed a knee can see that leg press was assigned knowing.
  const mine = useMyInjuryAcks();
  // The coach's side asks the same function. Two screens, one definition of
  // "read": a confirmation covers the disclosures it was made against, so a
  // client who has added one since is told it is waiting rather than read.
  const coachRead = ackState(mine.status, active, mine.read?.keys ?? null);

  const closeSheet = () => { setNote(''); setSev('moderate'); setArea('knee'); setEditing(null); setOpen(false); };

  const startEdit = (i: Injury) => {
    setEditing(i); setArea(i.area); setSev(i.severity); setNote(i.note ?? ''); setOpen(true);
  };

  const save = () => {
    if (editing) {
      // The id and `at` are not in the patch, so the disclosure keeps both.
      // That is the whole of the fix: delete-and-re-add minted a new id, and a
      // new id is a new disclosure the coach has not read.
      c.updateInjury(editing.id, injuryPatch({ area, severity: sev, note }));
      closeSheet();
      return;
    }
    c.addInjury({ id: newInjuryId(), area, severity: sev, status: 'active', note: note.trim() || undefined, at: new Date().toISOString() });
    closeSheet();
  };

  /** Delete, with the confirm every other destructive action in this app has.
   *  The sentences are in src/lib/injuryEdit.ts so the screen and its tests
   *  cannot come to describe the same tap differently. */
  const confirmDelete = (i: Injury) => {
    const cf = deleteInjuryConfirm(i);
    Alert.alert(cf.title, cf.body, [
      { text: 'Keep It', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => c.removeInjury(i.id) },
    ]);
  };

  // Only ever about an edit in progress, and only when it changes what the
  // coach acknowledged. Null for a first disclosure, for a note-only fix, and
  // for anything on a recovered injury.
  const ackWarning = editing ? editAckWarning(editing, { area, severity: sev, note }) : null;

  // One injury: a status dot, the area, its severity as ink text, and its two
  // actions. Divided by a hairline rather than boxed.
  const Row = ({ inj, first }: { inj: Injury; first?: boolean }) => {
    const { id, area: areaId, severity, status, note: nt } = inj;
    return (
    <View style={{ paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      {/* One element, one sentence. The dot's colour is the severity said in
          colour, and colour is the one thing a screen reader cannot read out —
          so the row is grouped and spoken whole rather than as three fragments
          with an unnamed shape in front of them. */}
      <View accessible accessibilityRole="text"
        accessibilityLabel={`${areaLabel(areaId)}, ${status === 'active' ? `${severity} injury, active` : 'recovered'}${nt ? `. ${nt}` : ''}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status === 'active' ? sevColor(severity) : t.ink3 }} />
          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{areaLabel(areaId)}</Text>
          <Text style={{ ...ty.caption, color: t.ink2, textTransform: 'capitalize' }}>{status === 'active' ? severity : 'recovered'}</Text>
        </View>
        {nt ? <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{nt}</Text> : null}
      </View>
      {/* Named, because "Delete, button" in a list of injuries does not say
          which one — and this one cannot be undone from here. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
        {status === 'active' ? (
          <Ghost label="Mark Recovered" icon="check" a11yLabel={`Mark your ${areaLabel(areaId).toLowerCase()} injury as recovered`} onPress={() => c.updateInjury(id, { status: 'recovered' })} />
        ) : (
          <Ghost label="Reactivate" a11yLabel={`Mark your ${areaLabel(areaId).toLowerCase()} injury as active again`} onPress={() => c.updateInjury(id, { status: 'active' })} />
        )}
        {/* Before Delete, and deliberately so. Correcting is the thing most
            people opening these controls actually want, and it was the one
            thing this row did not offer. */}
        <Ghost label="Edit" icon="pencil" a11yLabel={`Edit your ${areaLabel(areaId).toLowerCase()} injury`} onPress={() => startEdit(inj)} />
        {/* Now behind an Alert, like every other destructive action in the
            client app. It was a bare button on a screen whose rows are a few
            pixels apart. */}
        <Ghost label="Delete" a11yLabel={`Delete your ${areaLabel(areaId).toLowerCase()} injury`} onPress={() => confirmDelete(inj)} />
      </View>
    </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Training</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Injuries & Limitations</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>Your coach and your plan train around these — flagging and swapping risky moves.</Text>

        <Notice tone={t.s3} kicker="Guidance only" title="Not medical advice"
          note="For pain, a new injury, or a diagnosis, see a doctor or physio before training." />

        <View style={{ marginTop: sp.md }}>
          <Cta label="Disclose an Injury" onPress={() => setOpen(true)} wide />
        </View>

        {/* The second way in, not a replacement for the first. Typing it in is
            still the shortest path and stays exactly where it was; this is for
            somebody holding a physio report who would otherwise have to
            translate it themselves. What comes back from a document is a set of
            SUGGESTIONS they confirm one at a time — see app/(client)/injury-doc
            for why it is never allowed to write on its own. */}
        <ListRow icon="camera" title="Read It Off a Document"
          note="Physio report, scan or doctor's note. You confirm what it finds — nothing is added on its own."
          onPress={() => router.push('/(client)/injury-doc')} />

        {/* An injury on this screen is in the list; whether it reached the
            server is a separate fact, and it is the one that decides if the
            coach ever sees it. Said here rather than left to be discovered. */}
        {c.saveFailed ? (
          <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
            Your last change has not reached the server yet, so your coach may still be seeing the old list. It keeps retrying — check back before you rely on it.
          </Flag>
        ) : null}

        {active.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Active" note={String(active.length)} />
              {active.map((i, idx) => <Row key={i.id} inj={i} first={idx === 0} />)}
            </Section>
          </View>
        ) : null}

        {past.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Recovered" note={String(past.length)} />
              {past.map((i, idx) => <Row key={i.id} inj={i} first={idx === 0} />)}
            </Section>
          </View>
        ) : null}

        {/* ── has the coach read them? ─────────────────────────────────────
            Only where there is something to have read. Every branch below is a
            different sentence, including the one that says we could not find
            out — "your coach has read these" is a claim about another person's
            attention and is never made on the strength of a read that failed. */}
        {/* `!== false`, not `=== true`: null means the coach link could not be
            read, and hiding this on an unread answer would take the whole point
            of the section away from exactly the person a failure is worst for.
            Somebody genuinely uncoached is not told about a coach. */}
        {active.length > 0 && c.coachLinked !== false ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Your Coach" />
              {coachRead === 'unknown' ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                  We couldn't check whether your coach has read these just now. Open this screen again in a moment.
                </Text>
              ) : coachRead === 'none' ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                  Not read yet. Your coach is shown these before they can assign you a programme, and can't assign one until they confirm they have read them.
                </Text>
              ) : coachRead === 'stale' ? (
                <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
                  Your coach read your injuries on {mine.read?.at ? fmtDay(mine.read.at) : 'an earlier date'}. You have disclosed something since, so they will be asked to read it again before they can assign you anything.
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                  <Icon name="check" size={16} color={t.good} />
                  <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>
                    Your coach confirmed they have read these{mine.read?.at ? ` on ${fmtDay(mine.read.at)}` : ''}.
                  </Text>
                </View>
              )}

              {/* What they did about it. A coach may put a movement that loads
                  a disclosure into a programme on purpose — that is their
                  judgement — but not without saying so, and this is where the
                  saying-so is addressed to the person it is about. */}
              {mine.choices.length > 0 ? (
                <View style={{ marginTop: sp.lg, gap: sp.md }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Assigned knowing about these</Text>
                  {mine.choices.slice(0, 5).map((ch, i) => (
                    <View key={i}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{fmtDay(ch.at)}</Text>
                      <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>
                        {ch.movements.slice(0, 6).map((m) => `${m.exercise} (${areaLabel(m.area).toLowerCase()})`).join(', ')}
                        {ch.movements.length > 6 ? ` and ${num(ch.movements.length - 6)} more` : ''}
                      </Text>
                    </View>
                  ))}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    If any of these hurt, stop and tell your coach.
                  </Text>
                </View>
              ) : null}
            </Section>
          </View>
        ) : null}

        {/* An empty list is "you have disclosed nothing" only when the read
            that produced it finished. Under a failed one it means we do not
            know what you disclosed — and this screen printing "No injuries
            disclosed" over that would be the app telling somebody their coach
            has been given a clean sheet it never read. */}
        {c.injuries.length === 0 && c.profileStatus === 'ready' ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Icon name="check" size={30} color={t.ink3} />
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, marginTop: sp.md }}>No injuries disclosed</Text>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs, maxWidth: 260 }}>If something's bothering you, add it here so your plan can adapt.</Text>
          </View>
        ) : c.injuries.length === 0 && c.profileStatus === 'loading' ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading what you have disclosed…</Text>
          </View>
        ) : c.injuries.length === 0 ? (
          <View style={{ marginTop: sp.lg }}>
            <Flag tone={t.crit}>
              Your injuries could not be read, so this is not your list — it is an empty screen standing in for one. Anything you add now will save, but check back before you rely on what is here.
            </Flag>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeSheet}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={closeSheet} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: layout.gutter, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {/* An edit and a first disclosure are the same three fields and two
                entirely different acts, so the sheet says which one it is. */}
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>{editSheetTitle(!!editing)}</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Area</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.lg }}>
              {/* Which of these is chosen was carried by the fill colour alone.
                  A screen reader was told nothing: no role, no selected state,
                  so a member using VoiceOver heard nineteen identical buttons
                  and had no way to know which body part they had picked — on
                  the form that decides what their coach is allowed to program
                  for them. `radio` with a selected state is what the OS
                  announces as "Knee, selected". */}
              {INJURY_AREAS.map((a) => { const on = area === a.id; return (
                <Pressable key={a.id} onPress={() => setArea(a.id)}
                  accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }}
                  accessibilityLabel={a.label} accessibilityHint="The part of your body that is injured"
                  style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{a.label}</Text>
                </Pressable>); })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Severity</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {SEVS.map((sv) => { const on = sev === sv.id; return (
                <Pressable key={sv.id} onPress={() => setSev(sv.id)}
                  accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }}
                  accessibilityLabel={sv.label} accessibilityHint="How bad the injury is"
                  style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{sv.label}</Text>
                </Pressable>); })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. sharp on deep squats; cleared for light work" placeholderTextColor={t.ink3} multiline
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64, marginBottom: sp.lg, textAlignVertical: 'top' }} />

            {/* Said BEFORE the save, not discovered afterwards. Only when the
                edit changes `area:severity` — the key `injuryKey` and the
                coach's assign gate both read — because a note fixed for a typo
                must not re-gate anybody, and telling somebody it will is as
                wrong as doing it. */}
            {ackWarning ? <Flag tone={t.s3} style={{ marginBottom: sp.lg }}>{ackWarning}</Flag> : null}

            <Cta label={editing ? 'Save Changes' : 'Save'} onPress={save} wide
              a11yLabel={editing ? `Save your changes to this ${areaLabel(area).toLowerCase()} injury` : undefined} />
            <Pressable onPress={closeSheet} accessibilityRole="button"
              accessibilityLabel={editing ? 'Cancel without changing this injury' : 'Cancel without disclosing an injury'}
              style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
