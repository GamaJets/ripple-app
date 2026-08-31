// Client · Injuries & limitations. Disclose injuries so the AI coach, your
// trainer, and the Train tab train AROUND them (safer swaps, cautions). Add an
// area, severity and note; mark recovered when you heal; delete anytime. Stored
// in the shared client profile (persisted). Guidance only — not medical advice.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): the
// per-injury bordered boxes became hairline-separated rows, the disclaimer
// became the screen's one <Notice>, and severity is a coloured dot beside ink
// text rather than coloured text. Every route, hook and branch is unchanged.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Cta, Ghost, ListRow, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { INJURY_AREAS, areaLabel, newInjuryId, type InjurySeverity } from '../../src/lib/injuries';
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

  const save = () => {
    c.addInjury({ id: newInjuryId(), area, severity: sev, status: 'active', note: note.trim() || undefined, at: new Date().toISOString() });
    setNote(''); setSev('moderate'); setArea('knee'); setOpen(false);
  };

  // One injury: a status dot, the area, its severity as ink text, and its two
  // actions. Divided by a hairline rather than boxed.
  const Row = ({ id, areaId, severity, status, note: nt, first }: { id: string; areaId: string; severity: InjurySeverity; status: string; note?: string; first?: boolean }) => (
    <View style={{ paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status === 'active' ? sevColor(severity) : t.ink3 }} />
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{areaLabel(areaId)}</Text>
        <Text style={{ ...ty.caption, color: t.ink2, textTransform: 'capitalize' }}>{status === 'active' ? severity : 'recovered'}</Text>
      </View>
      {nt ? <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{nt}</Text> : null}
      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
        {status === 'active' ? (
          <Ghost label="Mark Recovered" icon="check" onPress={() => c.updateInjury(id, { status: 'recovered' })} />
        ) : (
          <Ghost label="Reactivate" onPress={() => c.updateInjury(id, { status: 'active' })} />
        )}
        <Ghost label="Delete" onPress={() => c.removeInjury(id)} />
      </View>
    </View>
  );

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

        <Notice tone={t.s3} kicker="Guidance only" title="Not Medical Advice"
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
        <ListRow icon="camera" title="Read it off a document"
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
              {active.map((i, idx) => <Row key={i.id} id={i.id} areaId={i.area} severity={i.severity} status={i.status} note={i.note} first={idx === 0} />)}
            </Section>
          </View>
        ) : null}

        {past.length > 0 ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Recovered" note={String(past.length)} />
              {past.map((i, idx) => <Row key={i.id} id={i.id} areaId={i.area} severity={i.severity} status={i.status} note={i.note} first={idx === 0} />)}
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

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: layout.gutter, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Disclose an Injury</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Area</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.lg }}>
              {INJURY_AREAS.map((a) => { const on = area === a.id; return (
                <Pressable key={a.id} onPress={() => setArea(a.id)} style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{a.label}</Text>
                </Pressable>); })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Severity</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              {SEVS.map((sv) => { const on = sev === sv.id; return (
                <Pressable key={sv.id} onPress={() => setSev(sv.id)} style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{sv.label}</Text>
                </Pressable>); })}
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. sharp on deep squats; cleared for light work" placeholderTextColor={t.ink3} multiline
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64, marginBottom: sp.lg, textAlignVertical: 'top' }} />

            <Cta label="Save" onPress={save} wide />
            <Pressable onPress={() => setOpen(false)} style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
