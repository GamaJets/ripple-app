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
// ── And the answer the gate had no word for ────────────────────────────────
//
// Applying the gate per member was not enough, because what reached it had
// already been flattened. A HAND-ADDED member — a `coach_clients` row the coach
// typed in, no account, no app — is in the roster, so their disclosures read
// 'ready'; their `injuries` is `undefined`, which src/ui/roster.tsx leaves
// undefined on purpose because undefined is "nobody has ever asked this person"
// and `[]` is "they were asked and said none"; and `(c?.injuries ?? [])` turned
// the first into the second. `guardInjuries` returns ALLOWED on an empty list.
// So the member with the LEAST known about them opened the gate most easily,
// and the silence read as an all-clear — on the one write that reaches eight
// people at once.
//
// The answers are told apart in src/lib/disclosureFact.ts and each has a
// sentence. The assign is NOT withheld for a hand-added member — that is the
// ordinary use of Add Client and refusing it would be a worse product than the
// defect — but it is no longer made in silence: their row says nobody has ever
// asked them, and the alert the coach confirms NAMES them. Named, not counted:
// "some members have never been asked" is a sentence a coach taps through,
// because it is not about anybody.
//
// ── LoadStatus ─────────────────────────────────────────────────────────────
//
// A group whose membership could not be read must never render as an empty
// group: eight people and a refused read look identical, and an assign over
// that would report success having reached nobody. Every count on this page is
// held behind a whole read of BOTH the membership and `assigned_programs`,
// because "three of eight have it" computed off part of either is a wrong
// sentence, not a smaller one.
import { useCallback, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead, Flag, PageHead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import { useProgramGroups, type ProgramGroup } from '../../src/ui/groupProgram';
import {
  planFanOut, programSignature, memberState, groupCoverage, listNames, fanOutSubject,
  memberVersions, versionSpread, behindNote, bespokeNote,
  type FanOutMember, type MemberState,
} from '../../src/lib/groupProgram';
import { areaLabel, injuryFlag } from '../../src/lib/injuries';
import { disclosureFact, neverAskedBrief, type DisclosureFact } from '../../src/lib/disclosureFact';
import { num } from '../../src/lib/format';
import type { Program } from '../../src/lib/programs';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
// `getUser()` resolves rather than rejecting when the auth host is unreachable,
// so `!auth?.user?.id` meant "signed out, or we could not ask". See
// src/lib/authReadFate.ts.
import { signedInUid } from '../../src/lib/signedInUid';

import { notifySuccess } from '../../src/ui/haptics';
// ── the day the block begins, for everybody in the group at once ──────────
//
// Both already existed and neither was reachable from here: `DateSheet` is the
// month sheet builder.tsx and templates.tsx pick a start date in, and
// `assignProgramTo`'s third argument is the column it writes. No new table, no
// new component and no new dependency — see the section above the Assign
// button for what was missing.
import { DateSheet } from '../../src/ui/DateSheet';
import { CLIENT_STARTS_NOW, isStartDate } from '../../src/lib/programStart';
import { FORWARD_ICON } from '../../src/ui/direction';

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
  const { groups, status: groupStatus, createGroup, deleteGroup, setGroupProgram, addMembers, removeMember, refresh: refreshGroups } = useProgramGroups();
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  /**
   * `assignProgramTo`, not `assignProgram`.
   *
   * They do the same write. `assignProgram` is the convenience wrapper that
   * throws the REASON away — `(await assignProgramTo(…)).ok` — and this screen
   * was the last caller of it left in the app: builder.tsx:366,
   * dashboard.tsx:606 and templates.tsx:95 all moved to the pair, and
   * dashboard.tsx carries the note saying why.
   *
   * It mattered most here and was fixed here last. A fan-out writes to eight
   * people in one press and their failures are NOT the same failure:
   *
   *   · `is_my_client` looks in `clients`, so a hand-added member is refused
   *     42501 — the server was reached and said no;
   *   · an upsert that matched no rows is the server accepting the request and
   *     changing nothing, which is a different thing again;
   *   · a dropped connection genuinely did not reach the server;
   *   · and a lost session was never sent at all.
   *
   * All four were being reported with one sentence — "did not reach the server,
   * so they cannot see it yet. Clients you added by hand have no Train tab until
   * they join" — which is false of three of them, and hangs the hand-added
   * explanation on every coach whose wifi dropped. The group below now names
   * each cause with the people it actually happened to.
   */
  const { getProgram, assignProgramTo, status: programStatus, reload: reloadPrograms } = useAssignedPrograms();
  const { templates, status: tplStatus, reload: reloadTemplates } = useProgramTemplates();
  const acks = useInjuryAcks();
  // Five reads, and a fan-out to a group crosses every one of them: who is in
  // the group, who is on the book, what each member is already on, which
  // template is being sent, and whose injuries have been acknowledged. Each
  // fails independently and an empty answer from any of them is a wrong
  // answer rather than a gap — a fan-out sized by a partial read assigns over
  // people it never saw.
  const reloadEverything = useCallback(() => Promise.all([
    Promise.resolve(refreshGroups()), refreshRoster(),
    Promise.resolve(reloadPrograms()), Promise.resolve(reloadTemplates()),
    acks.refresh(),
  ]), [refreshGroups, refreshRoster, reloadPrograms, reloadTemplates, acks]);
  const pull = usePullToRefresh(reloadEverything);
  // And on the way back in. This screen is registered `href: null` inside
  // <Tabs>, so it mounts once and its five reads ran once — a coach who sent a
  // programme to a group, opened somebody's copy in the builder to check it,
  // and came back was shown the versions as they stood before they sent it.
  // "on version 2 of this programme" about a person who is now on version 3 is
  // the sentence that gets acted on. See src/ui/refreshOnFocus.ts.
  useRefreshOnFocus(reloadEverything);

  const [newName, setNewName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickTpl, setPickTpl] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [writeNote, setWriteNote] = useState<string | null>(null);
  /**
   * The day this group's block begins — one date, sent to all of them.
   *
   * ── what a group assign was writing before ────────────────────────────
   *
   * Nothing. `assignProgramTo` takes a start date as its third argument,
   * builder.tsx:1963 and templates.tsx:256 both pass one, and this screen
   * called the wrapper that has no third argument at all. So an
   * `assigned_programs` row fanned out to a group had `starts_on` null, and
   * null is not a small omission on a BLOCK: `blockPosition` answers 'no-date',
   * `clientWeek` resolves index 0, and week one is what every member's Train
   * tab shows them for the whole of a twelve-week bootcamp. The coach's own
   * copy of that is app/(trainer)/client-week.tsx printing "compared against
   * week 1, because no start date is set on this block" against somebody in
   * week seven.
   *
   * A group is the place this matters most and the only place it was missing.
   * Eight people doing one block start it on ONE day — that is what makes it a
   * bootcamp rather than eight programmes — and it is one date to choose rather
   * than eight, which is why it belongs on the fan-out and not on each of them.
   *
   * Blank is the ordinary case and stays the default: "assign it now" is what
   * this has always meant, `isStartDate` is what decides whether a value is
   * sendable, and `undefined` rather than null is passed when it is not — so a
   * re-assign from here cannot silently clear a date somebody set in the
   * builder.
   */
  const [startsOn, setStartsOn] = useState('');
  const [startPick, setStartPick] = useState(false);

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
  //
  // The status was not enough on its own, and this is the screen where that
  // cost the most. A HAND-ADDED member — a `coach_clients` row the coach typed
  // in, no account, no app — IS in the roster, so `c` was truthy and
  // `disclosures` read 'ready'; their `injuries` is `undefined`, which
  // src/ui/roster.tsx leaves undefined deliberately because undefined is
  // "nobody has ever asked this person" and `[]` is "they were asked and said
  // none"; and `(c?.injuries ?? [])` turned the first into the second.
  // `guardInjuries` returns ALLOWED on an empty list, so the member with the
  // LEAST known about them opened the gate most easily — and this is the
  // fan-out, so one press put a programme in front of eight people on the
  // strength of a silence.
  //
  // src/lib/disclosureFact.ts holds the three apart and hands this screen both
  // the status the gate needs and the sentence the coach needs. The assign is
  // NOT withheld for a hand-added member — that is the ordinary use of Add
  // Client and refusing it would be a worse product than the defect — but it is
  // no longer made in silence: `fact.note` is drawn on their row below and they
  // are NAMED in the sentence the coach confirms. A caller that takes
  // `gateStatus` and draws no `note` has put this defect back.
  const factFor = (clientId: string): DisclosureFact => {
    const c = roster.find((r) => r.id === clientId);
    return disclosureFact(rosterStatus, c, clientId, c?.name.split(' ')[0] ?? 'This client');
  };
  const asMember = (clientId: string): FanOutMember => {
    const c = roster.find((r) => r.id === clientId);
    const fact = factFor(clientId);
    return {
      clientId,
      name: c?.name.split(' ')[0] ?? 'This client',
      disclosures: fact.gateStatus,
      ackStatus: acks.status,
      injuries: fact.injuries,
      acknowledged: acks.acknowledged(clientId),
    };
  };
  /** First names of the people this assign WOULD write to who have never been
   *  asked about injuries. Read off `plan.send` rather than off the membership:
   *  a member the gate is already holding is a different sentence, said by the
   *  gate on their own row, and naming them twice teaches a coach to skip
   *  both. */
  const neverAskedNames = (ids: readonly string[]): string[] =>
    ids.filter((id) => factFor(id).kind === 'never-asked')
      .map((id) => roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client');

  const members = useMemo(() => (open ? open.memberIds.map(asMember) : []), [open, roster, rosterStatus, acks]);
  const groupSig = useMemo(() => programSignature(open?.program ?? null), [open]);
  const states = useMemo(
    () => (open ? open.memberIds.map((id) => memberState(programStatus, groupSig, getProgram(id))) : []),
    [open, groupSig, programStatus, getProgram],
  );
  const cover = groupCoverage(states, groupStatus, programStatus);

  /* ── which VERSION of the group's programme each of them is on ───────────
     `memberState` answers 'diverged' for two people who need opposite things:
     one is still on last month's version of this programme and needs one tap,
     and the other had their Thursday rewritten around a shoulder and must not
     be written to at all. The group's past programmes make the difference
     sayable — and it is DERIVED, every render, from what each of them is
     actually training, rather than stamped on them when the fan-out ran and
     left to go stale the moment somebody edits one client's copy in the
     builder. See supabase/parts/177 and src/lib/groupProgram.ts. */
  const currentVersion = useMemo(() => {
    const vs = open?.versions ?? [];
    // The version whose fingerprint matches the group's programme AS IT STANDS,
    // and not simply the highest number. A group whose plan was changed while
    // the version write was refused has a live programme that is not its newest
    // version, and calling that newest one "current" would report every member
    // as behind something nobody has.
    const match = vs.filter((v) => v.signature != null && v.signature === groupSig);
    return match.length ? Math.max(...match.map((v) => v.version)) : null;
  }, [open, groupSig]);
  const versionRows = useMemo(
    () => memberVersions(programStatus, open?.versions ?? [], currentVersion,
      (open?.memberIds ?? []).map((id) => ({ clientId: id, assigned: getProgram(id) })), groupSig),
    [programStatus, open, currentVersion, groupSig, getProgram],
  );
  const spread = useMemo(
    () => versionSpread(versionRows, groupStatus, programStatus, currentVersion),
    [versionRows, groupStatus, programStatus, currentVersion],
  );
  const nameOfClient = (id: string) => roster.find((c) => c.id === id)?.name ?? 'One client';

  /**
   * When each member was last seen at all — the half of a group this screen
   * could not answer.
   *
   * A group screen said which PROGRAMME each of eight people was on and nothing
   * whatever about whether any of them was doing it, which is the question a
   * coach opens a bootcamp for. Trainerize and Everfit both lead their group
   * view with it.
   *
   * NO NEW READ, and that is the point rather than a saving. `RosterClient.
   * lastActive` is already on every row in `roster` above — it is the string
   * the Clients tab prints and orders itself by, built in src/ui/roster.tsx
   * from `check_ins`, `workouts`, `sessions` and `gym_visits`. A second read
   * here, over a different window, would let this screen and the Clients tab
   * show a coach two different answers about the same person on the same
   * morning, which is the failure src/lib/clientBlock.ts and
   * src/lib/clientValue.ts are both written about.
   *
   * Four answers, never two:
   *
   *   · the roster read failed — unknown, and NOT a member who has gone quiet;
   *   · it came back short and this member is not in the part that did;
   *   · '—', which is roster.tsx's own mark for a stats read that was truncated;
   *   · and the string itself, which for somebody typed in by hand is already
   *     'added by you' rather than a silence about a person with no app.
   */
  const lastSeenLineFor = (id: string): string | null => {
    if (rosterStatus === 'loading') return null;
    if (rosterStatus === 'error') {
      return 'whether they have been training could not be read — this is not a statement that they have not';
    }
    const c = roster.find((x) => x.id === id);
    if (!c) {
      return rosterStatus === 'partial'
        ? 'not in the part of your book that came back, so nothing here is about their training'
        : 'not on your book, so there is nothing of theirs to read';
    }
    // roster.tsx writes '—' when the activity read hit its row ceiling. A dash
    // beside "last active" reads as a broken screen; it is a read that did not
    // finish, and it says so.
    if (!c.lastActive || c.lastActive === '—') {
      return 'when they were last active could not be established';
    }
    return `last active ${c.lastActive}`;
  };
  const behind = behindNote(versionRows, nameOfClient, spread);
  const bespoke = bespokeNote(versionRows, nameOfClient, spread);

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
      // Both fates return false, and that is the answer rather than a
      // fallback — the same one `recordInjuryChoice` in app/(trainer)/builder
      // .tsx takes, for the same reason stated above this function: this
      // client's programme is then abandoned rather than sent with no record
      // of the coach's decision behind it. Refusing on an outage is the
      // correct refusal, and nothing is written under a missing trainer id.
      //
      // The defect was that the two were indistinguishable afterwards: a
      // `false` returned because the auth host was down looked exactly like a
      // coach who was not signed in. `signedInUid` reports the first under this
      // context and stays quiet about the second.
      //
      // Narrowed on `fate`, never on `!who.uid`: `string` includes ''.
      const who = await signedInUid('group.injuryChoice');
      if (who.fate !== null) return false;
      const uid = who.uid;

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
      // The third fact, said at the moment of decision and not only on a row
      // the coach may have scrolled past. NAMED rather than counted, and that
      // matters more here than anywhere: this is the one write that reaches
      // eight people at once, and "some members have never been asked" is a
      // sentence a coach taps straight through because it is not about anybody.
      // src/lib/disclosureFact.ts builds it out of the same facts the rows use.
      const askedNote = neverAskedBrief(neverAskedNames(plan.send));
      if (loaded.length || askedNote) {
        const lines = loaded.slice(0, 6).map((x) =>
          `· ${x.m.name} — ${x.movements.slice(0, 2).map((v) => `${v.exercise} (${areaLabel(v.area).toLowerCase()}, ${v.severity})`).join('; ')}`);
        const more = loaded.length - lines.length;
        const loadedBody = loaded.length
          ? `${lines.join('\n')}${more > 0 ? `\n· and ${more} more` : ''}\n\n`
            + 'You can absolutely programme these on purpose. Confirming records that you chose to, with the date, for each of them — and they can see that record too.'
          : null;
        // Two different confirmations, because they are two different
        // decisions. Loading a disclosed injury on purpose is destructive and
        // is recorded against the coach; assigning to somebody nobody has asked
        // is the ordinary case and is only being STATED. A red button on both
        // is a red button nobody reads.
        const go = await new Promise<boolean>((resolve) => {
          Alert.alert(
            loaded.length ? 'This programme loads what they disclosed' : 'Never asked about injuries',
            [loadedBody, askedNote].filter(Boolean).join('\n\n'),
            [
              { text: loaded.length ? 'Change the Programme' : 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: loaded.length ? 'I Know — Assign' : 'Assign', style: loaded.length ? 'destructive' : 'default', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!go) { setBusy(false); return; }
      }

      const norecord: string[] = [];
      /** Each refusal with the reason the server actually gave for it, kept
       *  per person: one press can fail four different ways across eight
       *  clients, and a coach can only act on the one that is theirs. */
      const failed: { name: string; why: string }[] = [];
      const done: string[] = [];
      for (const m of sending) {
        const movements = loadsFor(m);
        if (movements.length) {
          const recorded = await recordChoice(m.clientId, movements);
          // Their programme is abandoned, not sent-and-unrecorded. The others
          // are unaffected: this is one client's record, not the group's.
          if (!recorded) { norecord.push(m.name); continue; }
        }
        // The same date for every member, and only when `isStartDate` can read
        // it. `undefined` and never null where it cannot: null is how a caller
        // says "take the date off", and a group re-assign must not wipe a date
        // a coach set on one person's copy in the builder.
        const r = await assignProgramTo(m.clientId, program, isStartDate(startsOn) ? startsOn : undefined);
        if (r.ok) done.push(m.name);
        // `why` is null only on an `ok`, so this fallback is unreachable — it is
        // here because a silent empty string in a report about somebody's
        // training is worse than a sentence saying the reason is missing.
        else failed.push({ name: m.name, why: r.why ?? 'No reason came back, so what happened to their copy is unknown.' });
      }

      if (done.length) notifySuccess();
      const parts: string[] = [];
      parts.push(done.length
        ? `${listNames(done)} ${done.length === 1 ? 'is' : 'are'} now on “${program.title}” and will see it on their Train tab.`
          + (isStartDate(startsOn)
            // Said in the confirmation as well as beside the field, because
            // this is the sentence a coach reads at the moment they would
            // otherwise assume the block is being held back until the date.
            ? ` The block is dated ${startsOn}, which is what counts their week number from then on — it is on their plan now.`
            : ' No start date was set, so week one is what they are on until you date the block.')
        : 'Nobody was assigned.');
      if (plan.blocked.length) {
        parts.push(`${listNames(plan.blocked.map((b) => b.name))} ${plan.blocked.length === 1 ? 'was' : 'were'} NOT assigned — read what they have disclosed first.`);
      }
      if (norecord.length) {
        parts.push(`${listNames(norecord)} ${norecord.length === 1 ? 'was' : 'were'} NOT assigned: the record of your decision to load a disclosed injury could not be saved, and sending it without that record would leave no sign you knew.`);
      }
      if (failed.length) {
        // Grouped by the reason rather than listed by name, because the reason
        // is the part the coach does something about — and the same reason
        // twice under two names reads as two problems.
        const byReason = new Map<string, string[]>();
        for (const f of failed) byReason.set(f.why, [...(byReason.get(f.why) ?? []), f.name]);
        for (const [why, names] of byReason) {
          parts.push(`${listNames(names)} ${names.length === 1 ? 'was' : 'were'} NOT assigned. ${why}`);
        }
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
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          The padding stays at 40: the field sits well above the end of this screen, and the
          inset iOS adds already gives the focused row the room it needs to rise. Padding it
          out to a keyboard's height here would only scroll into empty space. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <PageHead title="Program Groups" subtitle="Write it once" />
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
              <Pressable key={g.id} onPress={() => { setOpenId(isOpen ? null : g.id); setWriteNote(null); setStartsOn(''); }}
                accessibilityRole="button"
                // Including whether the membership was READ. "3 clients" and
                // "membership not read" are different answers and the label was
                // saying neither.
                accessibilityLabel={`${g.name}. ${groupStatus === 'ready' ? `${g.memberIds.length} ${g.memberIds.length === 1 ? 'client' : 'clients'}` : 'membership not read'}${g.program ? `, ${g.program.title}` : ', no programme yet'}`}
                style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  {/* A circle, as the board draws every row's icon. */}
                  <View style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
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
                  <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
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

              {/* ── which version each of them is on ────────────────────────
                  The group still does not own the plan; what it now keeps is
                  the programmes it used to have, so "on an older version of
                  this" can be told apart from "on something else entirely".
                  Those two need opposite actions and they are two separate
                  sentences for exactly that reason — the second half of a
                  paragraph is the half that gets skimmed, and the half being
                  skimmed here is the one where a coach silently reverts the
                  change they made for somebody's shoulder. */}
              {open.program && spread.countable && (spread.behind > 0 || spread.bespoke > 0 || currentVersion != null) ? (
                <View style={{ marginTop: sp.md }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Versions</Text>
                  <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>
                    {currentVersion == null
                      ? 'This programme has not been recorded as a version yet, so nobody can be placed against it. Changing the programme records one.'
                      : `${num(spread.onCurrent)} on version ${num(currentVersion)} · ${num(spread.behind)} on an earlier one · ${num(spread.bespoke)} on something else`}
                  </Text>
                  {behind ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Flag tone={t.warn}>{behind}</Flag>
                    </View>
                  ) : null}
                  {bespoke ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Flag tone={t.ink3}>{bespoke}</Flag>
                    </View>
                  ) : null}
                </View>
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
                // Which version this one is on, where their programme is one of
                // the group's. Null for a client on a bespoke plan and for one
                // whose assignment could not be read, and `st` is what tells
                // those two apart — a version number over an unread row would
                // be a fact invented out of a failure.
                const mv = versionRows[i];
                const held = plan.blocked.find((b) => b.clientId === id);
                // What this screen knows about their injuries, as one of three
                // facts rather than as an empty list. See the note over
                // `asMember` and src/lib/disclosureFact.ts.
                //
                // The gate speaks first where it has something to say — it
                // knows whether the coach has read a disclosure and whether a
                // read failed, and has better words for both. `fact.note` fills
                // the two silences the gate leaves: a member who was asked and
                // disclosed nothing, and a member nobody has ever asked.
                //
                // Drawn on every row here, clearance included, and that is the
                // difference from the picker in app/(trainer)/templates.tsx,
                // where a clearance waits for a tick: there is no unticked row
                // in a group. Every name on this list is a person the button
                // below writes to, so every one of them is at the point of
                // decision already.
                const fact = factFor(id);
                const factLine = held ? held.reason : fact.note;
                // The one unread status src/lib/disclosureFact.ts writes a sentence for, and
                // the only one drawn BESIDE the gate's refusal rather than instead of it. The
                // gate says their injuries "could not be read", which of a row that actually
                // arrived is not quite true, and "held until they load" is advice that will not
                // help — the read landed and carried no list. Every other unread status has
                // `note: null` precisely so this does not happen twice on one row.
                const noListLine = held && fact.why === 'no-list' ? fact.note : null;
                // Read once, not once per branch: this walks the roster.
                const lastSeen = lastSeenLineFor(id);
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
                        {/* Named only where the record supports it. A version
                            number beside somebody whose assignment could not be
                            read would be a fact invented out of a failure, and
                            "on a different programme" is not "on version 2" —
                            it is the client whose copy was edited for them. */}
                        {/* Whether they are actually training it, from the
                            roster row this screen already holds. Directly under
                            the programme state because the two together are the
                            whole question: somebody on the current version who
                            has not been seen in three weeks is the person this
                            group exists to catch, and neither line alone says
                            so. */}
                        {lastSeen ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{lastSeen}</Text>
                        ) : null}
                        {mv?.behind && mv.version != null ? (
                          <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>
                            on version {num(mv.version)} of this programme — send it again to move them onto the current one
                          </Text>
                        ) : st === 'diverged' && mv && mv.version == null ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                            not any version of this programme — somebody edited their copy
                          </Text>
                        ) : null}
                      </View>
                      {/* One person's copy, edited without touching anybody
                          else's — which is the whole reason the group owns the
                          list and not the plan. */}
                      <Ghost label="Just Theirs" onPress={() => router.push({ pathname: '/(trainer)/builder', params: { clientId: id, from: 'trainerGroup' } })} />
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
                    {/* Their own sentence, on their own row. A count of how
                        many are held tells the coach nothing about whose
                        shoulder it is — and an absence gets a sentence here
                        too, because the row that says nothing at all is the one
                        that reads as an all-clear. */}
                    {factLine ? (
                      <Flag tone={held || fact.warn ? t.warn : t.ink3} style={{ marginTop: sp.sm }}>{factLine}</Flag>
                    ) : null}
                    {noListLine ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{noListLine}</Text>
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

              {/* ── the day the block begins ────────────────────────────
                  ABOVE the button, for the reason builder.tsx gives about its
                  own copy: a coach decides when a block starts before they send
                  it, and a control discovered after the press is a control
                  discovered by having got it wrong.

                  The field IS the button. Nothing here raises a keyboard —
                  `DateSheet` carries its own "Type a Date" for coaches pasting a
                  date out of a client's message — and dismissing it writes
                  nothing, because a picker that committed whatever was under the
                  highlight would date a block the coach never chose. */}
              {open.program ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Starts on</Text>
                  <Pressable onPress={() => setStartPick(true)} accessibilityRole="button"
                    accessibilityLabel={startsOn
                      ? `The day this group's block begins. Currently ${startsOn}. Opens a calendar.`
                      : "The day this group's block begins. Not set, so it begins now. Opens a calendar."}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 4, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }}>
                    <Icon name="calendar" size={16} color={t.ink3} />
                    <Text style={{ ...ty.body, color: startsOn ? t.ink : t.ink3, flex: 1 }}>
                      {startsOn || 'Not set — begins now'}
                    </Text>
                  </Pressable>
                  {startsOn ? (
                    <View style={{ alignItems: 'flex-start', marginTop: sp.sm }}>
                      <Ghost label="Clear the Date" a11yLabel="Clear the start date, so the block begins now"
                        onPress={() => setStartsOn('')} />
                    </View>
                  ) : null}
                  {/* A value the sheet cannot produce can still arrive by
                      typing, and a date that will not be sent must say so
                      before the press rather than after it. */}
                  {startsOn && !isStartDate(startsOn) ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                      {`“${startsOn}” is not a date this app will store, so it will not be sent. The programme would still go out, dated nothing.`}
                    </Flag>
                  ) : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    One date for everybody in this group — it is what counts the week number on each
                    of their Train tabs, which is what makes a twelve-week block advance rather than
                    sitting on week one. {CLIENT_STARTS_NOW}
                  </Text>
                </View>
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

      {/* ── the day this group's block begins ───────────────────────────
          The same sheet builder.tsx and templates.tsx pick a start date in, so
          a date is entered the same way wherever a coach sets one and no screen
          grows its own parser. Cancelling leaves the field exactly as it was. */}
      <DateSheet
        visible={startPick}
        value={startsOn}
        heading="Starts On"
        note={open ? `The day “${open.name}” begins. Leave it unset to start now.` : 'Leave it unset to start now.'}
        onCancel={() => setStartPick(false)}
        onPick={(iso) => { setStartsOn(iso); setStartPick(false); }}
      />

      {/* ── pick the group's programme ──────────────────────────────────── */}
      <Modal visible={pickTpl} transparent animationType="slide" onRequestClose={() => setPickTpl(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPickTpl(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
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
              }} accessibilityRole="button"
                accessibilityLabel={`${tpl.name}. ${tpl.program.days.length} days, ${tpl.program.days.reduce((a, d) => a + d.exercises.length, 0)} exercises`}
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
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
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
                  accessibilityRole="button" accessibilityLabel={`${c.name}. ${c.goal}`}
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
              {/* No `|| 0` behind the length. An array length is already a
                  number and never null, so the fallback could only ever rewrite
                  a real 0 as 0 — dead code in the exact shape
                  scripts/check-invented-zero.mjs exists to find, on a screen
                  where the next figure along is a count of people. */}
              <Cta wide label={`Add ${Object.keys(picked).filter((k) => picked[k]).length}`}
                disabled={!Object.keys(picked).some((k) => picked[k])} onPress={doAddMembers} />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
