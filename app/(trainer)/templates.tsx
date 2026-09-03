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
import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates, type ProgramTemplate } from '../../src/ui/programTemplates';
import { notifySuccess } from '../../src/ui/haptics';
import { guardOverwrite } from '../../src/lib/overwriteGuard';
import { CLIENT_STARTS_NOW, isStartDate } from '../../src/lib/programStart';
import { isBlock, weekCount } from '../../src/lib/programBlock';
import { planFanOut, listNames, fanOutSubject, type FanOutMember } from '../../src/lib/groupProgram';
import {
  overwriteBrief, bulkReport, selectAllOffer,
  type AssignTarget, type WriteOutcome,
} from '../../src/lib/bulkActions';
import { assignCtaLabel } from '../../src/lib/assignPicker';
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
  const { templates, removeTemplateFrom, isStarter, status: tplStatus, reload: reloadTemplates } = useProgramTemplates();
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  const { assignProgramTo, getProgram, status: programStatus, reload: reloadPrograms } = useAssignedPrograms();
  const acks = useInjuryAcks();
  // Four reads, and this screen crosses all four on every tap: assigning a
  // template to a ticked list needs the library, the book, what each of them
  // is already on — the overwrite confirmation is counted off that — and the
  // injury acknowledgements that decide who may be assigned at all. Every one
  // of them under 'error' is a silent wrong answer rather than a gap, which
  // is why the screen gates on all four and why the refresh asks for all four.
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    Promise.resolve(reloadTemplates()), refreshRoster(),
    Promise.resolve(reloadPrograms()), acks.refresh(),
  ]), [reloadTemplates, refreshRoster, reloadPrograms, acks]));
  const [assignTpl, setAssignTpl] = useState<ProgramTemplate | null>(null);
  /**
   * The day the coach says this block begins, `YYYY-MM-DD`, or '' because they
   * have not said.
   *
   * The builder has offered this since blocks landed and this screen did not,
   * so `assignProgramTo` was called with no third argument and `starts_on` was
   * left null on every assignment made from the library. A block assigned from
   * here could therefore never count a week: `blockPosition` reads 'no-date',
   * `clientWeek` resolves to week one, and a twelve-week template put the
   * client on week one for twelve weeks — the exact failure src/lib/clientBlock.ts
   * was written to end, arriving through the other door.
   *
   * Same semantics as the builder's, deliberately: blank means "assign it now",
   * it never holds the programme back, and `CLIENT_STARTS_NOW` says so under
   * the field.
   */
  const [startsOn, setStartsOn] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [assignBusy, setAssignBusy] = useState(false);
  const [delFailed, setDelFailed] = useState<string | null>(null);

  // One assign here is many overwrites, so it is held until the programmes it
  // would replace have actually been read. See src/lib/overwriteGuard.ts.
  // Kept alongside the plan below because it is what licenses the "replaces the
  // program they are on" marker on each row, which is a claim about a read.
  const assignGuard = guardOverwrite(programStatus, 'the programmes these clients are currently on');

  const openAssign = (tpl: ProgramTemplate) => { setPicked({}); setStartsOn(''); setAssignTpl(tpl); };
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
  // What the sweeping gesture is allowed to claim, given how the roster read
  // went. See the comment beside the control itself.
  const selAll = selectAllOffer(rosterStatus, roster.length);

  /**
   * The bulk assign, in three parts that used to be one.
   *
   * ── 1 · a count is not consent ─────────────────────────────────────────
   *
   * This used to write the moment the coach tapped. The button said "Assign to
   * 12", which is a number, and the tap behind it replaced however many of
   * those twelve were training something a human had written for them — with
   * no undo, no record of what was there, and nothing telling the client their
   * next session had changed. The row markers below say which ones, and a coach
   * scrolling a list of twelve does not read twelve markers before a tap.
   *
   * So the write is preceded by a sentence that states the number and NAMES
   * them, built in src/lib/bulkActions.ts. The names are the part that works:
   * a coach does not recognise "9 of 12", and does recognise the person they
   * spent an hour programming on Tuesday.
   *
   * ── 2 · partial failure is the normal case ────────────────────────────
   *
   * Twelve writes are twelve chances to be refused, and the ordinary reason is
   * not a network: `assigned_programs_coach_rw` runs through `is_my_client`,
   * which looks in `clients`, so every hand-added client on the book fails it.
   * The old report said "8 of 12 saved" and closed the sheet, which leaves the
   * coach unable to name the four or reach them without re-ticking everybody.
   *
   * The report now names both halves, and the FAILURES STAY TICKED so trying
   * again is the same gesture over the set that still needs it. The sheet is
   * only dismissed when there is nothing left in it to do.
   *
   * ── 3 · and the injury gate keeps its own list ────────────────────────
   *
   * `plan.blocked` is who this must not write to at all. They were never in
   * `send`, they stay ticked with the retries, and they are named separately
   * — a client held for an unread disclosure is not a failed write and the two
   * must not be reported as one thing.
   */
  const doAssign = async () => {
    if (!assignTpl || !plan.allowed || assignBusy) return;
    const tpl = assignTpl;
    // Only reachable once `guardOverwrite` has passed inside planFanOut, which
    // is what licenses `onProgramme` being a boolean at all: under any status
    // but a whole read, a null from getProgram means "we did not find out" and
    // this sentence would be counting silence.
    const targets: AssignTarget[] = plan.send.map((id) => {
      const c = roster.find((r) => r.id === id);
      return { clientId: id, name: c?.name.split(' ')[0] ?? 'This client', onProgramme: !!getProgram(id) };
    });
    const brief = overwriteBrief(targets, tpl.name);
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(brief.title, brief.body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        // Destructive only when something is actually being destroyed. A red
        // button on every assign is a red button nobody reads.
        { text: brief.confirmLabel, style: brief.replacing.length ? 'destructive' : 'default', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;

    setAssignBusy(true);
    const outcomes: WriteOutcome[] = await Promise.all(targets.map(async (tg) => {
      // Only ever sent when the coach typed a real date. `undefined` leaves
      // the column alone on an overwrite — a screen that did not offer a date
      // must not silently clear one set from a screen that did — and an
      // unparseable string is not sent at all rather than stored as a date
      // nothing can read back. The same three-way call the builder makes.
      const r = await assignProgramTo(tg.clientId, tpl.program, isStartDate(startsOn) ? startsOn : undefined);
      return { clientId: tg.clientId, name: tg.name, ok: r.ok, why: r.why };
    }));
    setAssignBusy(false);
    const report = bulkReport('assign', outcomes);
    if (outcomes.some((o) => o.ok)) notifySuccess();

    // What is left to do: the writes that did not land, plus the people the
    // injury gate held. Both need the coach to come back to them, so both stay
    // ticked and the sheet stays open for exactly as long as either exists.
    const outstanding = [...report.retry, ...plan.blocked.map((b) => b.clientId)];
    if (outstanding.length) setPicked(Object.fromEntries(outstanding.map((id) => [id, true])));
    else setAssignTpl(null);

    const parts = [report.body];
    // Named, never silently dropped. A coach who believes twelve people got a
    // programme when eleven did is worse off than one who was refused.
    if (plan.blocked.length) {
      parts.push(`${listNames(plan.blocked.map((b) => b.name))} ${plan.blocked.length === 1 ? 'was' : 'were'} not written to at all — they have disclosed injuries this screen cannot confirm you have read, and they are still ticked. Open them in the builder and read what they disclosed.`);
    }
    Alert.alert(report.title, parts.join('\n\n'));
  };

  const dayCount = (tpl: ProgramTemplate) => tpl.program.days.length;
  const exCount = (tpl: ProgramTemplate) => tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

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
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dayCount(tpl)} days · {exCount(tpl)} exercises{isStarter(tpl.id) ? ' · starter' : ''}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}><Cta label="Assign to Clients" wide onPress={() => openAssign(tpl)} /></View>
                <Ghost label="Edit" onPress={() => router.push({ pathname: '/(trainer)/builder', params: { templateId: tpl.id } })} />
                {/* The row no longer leaves this list before the server has
                    counted it. It used to disappear on the tap and be reported
                    as a failure afterwards, which reads as a successful delete
                    with a glitch — and the template was back at the next
                    launch with no explanation. See `removeTemplateFrom`.

                    The confirmation NAMES the template and says what a delete
                    does not touch: a client training a programme assigned from
                    it keeps that programme, because an assignment is a jsonb
                    copy and no foreign key in the database points at
                    `program_templates` at all. */}
                {!isStarter(tpl.id) ? (
                  <Pressable onPress={() => Alert.alert(
                    'Delete This Template?',
                    `“${tpl.name}” is removed from your library for good — there is no undo. Anybody already training it keeps their programme, and every session they have logged is untouched: an assignment is a copy, not a link back to this.`,
                    [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
                      const gone = await removeTemplateFrom(tpl.id);
                      setDelFailed(gone.ok ? null : `“${tpl.name}” is still in your library. ${gone.why ?? 'The server did not say why.'}`);
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
              {/* ── selecting everybody, over a list that may be part of one ──
                  "Select All" over a roster that came back at its row limit
                  ticks a thousand people and calls it everybody. Nothing on
                  screen is false — the names are real and the count is the size
                  of what loaded — and the coach is still about to act on a set
                  they cannot see, believing they can.

                  So the gesture is not withheld and not warned about: it is
                  RENAMED to the number actually shown, and the line under it
                  says there are more past them. Ticking a thousand named people
                  is a true gesture; calling it "all" is not. Under a failed or
                  unfinished read there is no honest scoped version — there is
                  no list — so it is withheld and says which of the two it is.
                  Individual ticks stay available throughout: a tick is a claim
                  about one person the coach can see and read. */}
              {/* ── the day the block begins ──────────────────────────────
                  Only on a block, because on a one-week programme there is no
                  week for a date to count to and the field would be a control
                  that changes nothing a coach can see.

                  It does NOT hold the programme back. `CLIENT_STARTS_NOW` is
                  printed under it saying so, for the reason the builder gives
                  at length: a coach who believes the date is enforced, and
                  assigns a block "starting Monday" on a Thursday, has replaced
                  their client's Friday session while believing they did not. */}
              {isBlock(assignTpl.program) ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>
                    Starts on · {weekCount(assignTpl.program)} week block
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.xs }}>
                    <TextInput value={startsOn} onChangeText={setStartsOn}
                      placeholder="YYYY-MM-DD" placeholderTextColor={t.ink3}
                      autoCapitalize="none" autoCorrect={false}
                      accessibilityLabel="The day this block begins, as year, month and day"
                      style={{
                        ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
                        paddingHorizontal: 12, paddingVertical: 9, flex: 1,
                      }} />
                    {startsOn ? <Ghost label="Clear" onPress={() => setStartsOn('')} /> : null}
                  </View>
                  {/* Refused rather than corrected, and said while they type. A
                      date this app cannot read is not stored at all — a stored
                      value that will not parse puts every screen reading it
                      into "unreadable" for ever. */}
                  {startsOn && !isStartDate(startsOn) ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.xs }}>
                      Write the date as year, month and day — 2026-09-07. Anything else is not saved, and the
                      programme goes out with no start date rather than one nothing can read back.
                    </Flag>
                  ) : (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                      {CLIENT_STARTS_NOW} Without one, everybody you tick stays on week one of this
                      block until you set a date.
                    </Text>
                  )}
                </View>
              ) : null}

              {selAll.note ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{selAll.note}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: selAll.note ? sp.sm : sp.lg }}>
                <View style={{ opacity: selAll.allowed ? 1 : 0.4 }} pointerEvents={selAll.allowed ? 'auto' : 'none'}>
                  <Ghost label={selAll.label} onPress={() => {
                    if (!selAll.allowed) return;
                    setPicked(Object.fromEntries(roster.map((c) => [c.id, true])));
                  }} />
                </View>
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
                  {/* The same label the builder puts on the same gesture, from
                      src/lib/assignPicker.ts — the two were the same expression
                      written twice, and this screen already carries a comment
                      about the one place they had drifted. */}
                  <Cta label={assignCtaLabel({
                    busy: assignBusy,
                    picked: pickedIds.length,
                    exercises: exCount(assignTpl),
                    planLabel: plan.label,
                    soleName: pickedIds.length === 1 ? (roster.find((r) => r.id === pickedIds[0])?.name ?? null) : null,
                  })} wide
                    disabled={pickedIds.length === 0 || !plan.allowed || assignBusy} onPress={doAssign} />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
