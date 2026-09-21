// Owner · Trainers. The gym's coaching staff — who they carry and what they
// actually delivered.
//
// This screen used to manage Repple subscriptions: add a trainer, put them on
// Starter/Pro/Studio, suspend them, watch "Platform MRR" update. None of it was
// written anywhere, and none of it is a gym owner's business — those plans are
// what a trainer pays Repple. Now it reads the gym's real roster.
//
// Inviting is kept because it is the one action here that was always real: it
// writes a `trainer_invites` row the invitee accepts in their own app.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { num } from '../../src/lib/format';
import { Section, SectionHead, ScreenHeader, KpiRow, Cta, Ghost, Flag, Notice, Donut, Legend, TonedChip, HeroCard, HeroRing, Scrim, fig } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { FORWARD_ICON } from '../../src/ui/direction';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, font, grown } from '../../src/theme/scale';
import { usePlatformTrainers, type GymTrainer } from '../../src/ui/trainers';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useTrainerInvites } from '../../src/ui/trainerInvites';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { parseEmail } from '../../src/lib/csvImport';
import { trainerHealth, gymRollup } from '../../src/lib/ownerAnalytics';
import { riskLabel } from '../../src/lib/status';

export default function OwnerTrainers() {
  const t = useTheme();
  const router = useRouter();
  // `sessions30` and `payroll30` off the provider are the same two sums
  // `gymRollup` computes below, and this screen now reads them from `roll`
  // alongside `delivered30` and `unmarked30` — which the provider does not
  // publish, and which are the halves that make the hero's sentence true.
  // Two sources for one figure is how the two come to disagree.
  const { trainers, loading, status: trainersStatus, refresh } = usePlatformTrainers();
  const { tenant, status: tenantStatus, refresh: refreshTenant } = useTenant();
  // `trainers.length === 0` was read straight off as "the gym has no trainers",
  // and a refused read leaves exactly that. This is the screen where that costs
  // most: an owner with a full roster was shown an empty one and told "No
  // trainers yet. Invite one by email" — an instruction to fix a problem they
  // do not have, on the one screen whose job is to list the staff they employ.
  // Every branch that says something about the roster now asks this first.
  //
  // ── And the roster is only as trustworthy as the TENANT read under it ────
  //
  // `PlatformTrainersProvider` (src/ui/trainers.tsx) destructures `tenant` from
  // `useTenant()` and never reads its `status`. A refused tenant read leaves
  // `tenant` null — which that provider treats as "this account has no gym at
  // all, so there is no roster we are failing to read" — and it publishes an
  // empty roster under status 'ready'. Every guard on this screen then passes
  // cleanly, and the empty-roster sentence below is stated over a read that
  // failed one level up.
  //
  // `worstStatus` is the house answer for a screen fed by more than one read:
  // it is only as complete as its worst. `src/ui/memberChurn.ts` already checks
  // the tenant status the same way, which is why the churn half of these
  // screens has never had this hole.
  const rosterStatus = worstStatus(tenantStatus, trainersStatus);
  const trainersUnread = rosterStatus === 'error';
  // `isWhole`, not `!== 'error'`. Neither read emits 'partial' today —
  // `fetchGymTrainers` calls `assertWhole` and throws rather than degrading, and
  // the tenant is a single row — so this is the house rule holding rather than a
  // live miscount being fixed. That is the difference between a gate that is
  // right and one that happens to be.
  const trainersUnknown = loading || !isWhole(rosterStatus);
  // The gym's own currency (`tenants.currency`, part 99), not the operating
  // record's fallback. Null while the tenant is unread, and gymMoney falls back
  // for exactly that window.
  const cur = tenant?.currency ?? null;
  const { sent: sentInvites, status: invitesStatus, sendTrainerInvite, revokeTrainerInvite, reload: reloadInvites } = useTrainerInvites();
  const [invOpen, setInvOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  // The invite sheet reports its own outcome rather than closing on hope. See
  // `send` below for what it used to do instead.
  const [invBusy, setInvBusy] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);
  const [sel, setSel] = useState<GymTrainer | null>(null);
  /**
   * When the roster last came back.
   *
   * Derived from the provider's own `status` rather than added to the provider,
   * because 'ready' is the only moment the rows on screen are known to be
   * current — `refresh()` puts it back to 'loading' and an error leaves it at
   * 'error', so a failed retry cannot move the stamp.
   */
  const [trainersAt, setTrainersAt] = useState<number | null>(null);
  useEffect(() => { if (trainersStatus === 'ready') setTrainersAt(Date.now()); }, [trainersStatus]);
  // The other two reads this screen renders: the gym (whose currency every money
  // line here is denominated in) and the invitations under "Pending Invites".
  const [tenantAt, setTenantAt] = useState<number | null>(null);
  useEffect(() => { if (tenantStatus === 'ready') setTenantAt(Date.now()); }, [tenantStatus]);
  const [invitesAt, setInvitesAt] = useState<number | null>(null);
  useEffect(() => { if (invitesStatus === 'ready') setInvitesAt(Date.now()); }, [invitesStatus]);
  /** One line over three reads, and it is the age of the oldest. Stamping the
   *  newest would put a fresh age on a roster nobody had re-read. */
  const fetchedAt = oldestFetch(trainersAt, tenantAt, invitesAt);
  /** Everything on this screen, read again. The Refresh button beside the stamp
   *  and the pull gesture run the same thing — the pending invitations were the
   *  half with no way to be asked for at all, so an invitation accepted in the
   *  coach's app sat here as "Pending" until the app was killed. */
  const refreshAll = useCallback(() => { refresh(); refreshTenant(); reloadInvites(); }, [refresh, refreshTenant, reloadInvites]);
  const pull = usePullToRefresh(refreshAll);

  // The sheet closes when the invitation is ON THE SERVER, and not before.
  //
  // This was `await sendTrainerInvite(invEmail); setInvOpen(false);` — the
  // boolean dropped on the floor. Paired with the provider inserting its
  // optimistic row before the network call, a refused invite closed the sheet
  // and left a "Pending" row for somebody who had not been invited: the two
  // halves of one bug, and either half alone would have been survivable. The
  // provider no longer invents the row; this no longer claims it was sent.
  const send = async () => {
    const parsed = parseEmail(invEmail);
    if (!parsed.ok) { setInvErr('Enter the email address they will sign in with.'); return; }
    setInvBusy(true); setInvErr(null);
    const sent = await sendTrainerInvite(parsed.value);
    setInvBusy(false);
    if (!sent) {
      setInvErr(`${parsed.value} has not been invited. Nothing was sent and nothing was saved. Check your connection and try again.`);
      return;
    }
    setInvOpen(false); setInvEmail('');
  };

  // Same again: a revoke the server refused used to take the invitation off this
  // screen while leaving it live in the invitee's app, where accepting it still
  // attaches them to the gym.
  const revoke = async (id: string, email: string) => {
    const done = await revokeTrainerInvite(id);
    if (!done) {
      Alert.alert('Not Cancelled', `The invitation to ${email} is still open. Nothing changed. Try again in a moment.`);
    }
  };

  const current = sel ? trainers.find((x) => x.id === sel.id) ?? null : null;
  const roll = gymRollup(trainers, tenant?.sessionFee ?? null);
  const pending = sentInvites.filter((i) => i.status === 'pending');
  /** Whether the invite list is the whole one. `useTrainerInvites` reports
   *  'partial' on a truncated read of `trainer_invites` (src/ui/trainerInvites.
   *  tsx) — the sent list only grows, nothing is ever deleted from it, so it is
   *  exactly the table that crosses a thousand rows by sitting there — and this
   *  screen was counting `pending.length` under it with `String()`, which walks
   *  straight past `fig()` and prints a subtotal as a total. */
  const invitesWhole = isWhole(invitesStatus);
  const invitesUnread = invitesStatus === 'error';
  const G = layout.gutter;
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: 30, ...elevation.e2 };
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };

  /**
   * A gym with nobody on its roster yet — a WHOLE read with no trainers in it.
   * Never an unread or a loading roster: those are empty arrays too, and the
   * screen tells an owner in so many words not to invite anyone on the strength
   * of one.
   */
  const onboarding = !trainersUnknown && trainers.length === 0;
  // Trainers sorted worst-health first so problems surface at the top, the way
  // Overview's board sorts the same people.
  const ranked = trainers.map((tr) => ({ tr, h: trainerHealth(tr) })).sort((a, b) => a.h.score - b.h.score);

  // One block, drawn in one of two places — see the note where it is placed.
  // A variable holding elements rather than a component declared in the render
  // body: a component here would be a new type on every render and remount the
  // list under it (scripts/check-remount.mjs).
  const invitesBlock = (
    <>
      {/* The section used to appear only when `pending.length > 0`, so a
          REFUSED invite read — which leaves the list empty — removed it from
          the screen without a word. An owner concludes nobody is waiting on
          them and either re-invites somebody they already invited, or stops
          chasing a hire. Every other unread state on this screen gets a
          sentence; this one got a disappearance. */}
      {/* `!invitesWhole` joins the gate for the same reason `invitesUnread`
          did. Under a truncated read the sentence below — "more invitations
          than fit in one read" — sat INSIDE a section that only rendered
          when the prefix happened to contain a pending row. A gym whose open
          invitations are all older than the newest rows that came back got no
          section, no count and no sentence: the disclosure was hidden by the
          very condition it exists to explain. */}
      {pending.length > 0 || invitesUnread || !invitesWhole ? (<>
        <Section>
          <SectionHead title="Pending Invites" note={invitesWhole && pending.length ? String(pending.length) : undefined} />
          {invitesUnread ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your sent invitations could not be read, so this cannot say who is waiting on you.
              That is a failed read, not an empty list. Nobody&rsquo;s invitation has been
              cancelled, and re-sending one on the strength of this screen would invite the same
              person twice.
            </Text>
          ) : null}
          {!invitesWhole && !invitesUnread ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
              More invitations than fit in one read, so the ones below are the most recent rather
              than all of them and there is no count over them.
            </Text>
          ) : null}
          {pending.map((i, ix) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: ix === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{i.email}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Awaiting sign-up / accept</Text>
              </View>
              <Ghost label="Cancel" onPress={() => { void revoke(i.id, i.email); }} />
            </View>
          ))}
        </Section>
      </>) : null}
    </>
  );


  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* The board's tab-root opening: eyebrow, title, and the one global
            action as a round control. Inviting is that action — it is the only
            write on this screen — and it is also the hero's full-width
            button whenever the roster read is whole, because a plus in the
            corner is not where a first-time owner looks for "add somebody". */}
        <ScreenHeader
          eyebrow="Your Coaching Staff"
          title="Trainers"
          actions={<>
            {/* The same search control the Overview tab carries. Studio's
                hidden screens hang off Overview (13 of them) and Ops (5), so
                an owner standing on any other tab root had no way into
                app/(owner)/explore.tsx and its search over OWNER_NAV. Before
                the invite control, not after: `actions` renders in order and
                the primary action of a screen belongs at its trailing edge. */}
            <Ghost icon="search" a11yLabel="Search every screen" onPress={() => router.push('/(owner)/explore')} />
            <Ghost icon="plus" a11yLabel="Invite a Trainer by Email" onPress={() => { setInvEmail(''); setInvErr(null); setInvOpen(true); }} />
          </>}
        />

        {/* ── the hero: the staff at a glance, and the one action ──────────
            The approved night card, first on the screen. It absorbed the
            "Roster Unread" notice that stood here: under an unread roster the
            hero says so in words and its one action is to read again, because
            every figure below is a dash for that one reason. Under a loading
            roster it says it is reading, and under a short one (neither read
            emits 'partial' today) that it is not a count. Only a WHOLE read
            gets a number, a ring, or the invite button; an owner is never
            told to invite anybody on the strength of a read that failed.

            The ring is the share of the staff `trainerHealth` puts On Track,
            over the same thirty days as everything else here. No ring for a
            gym with nobody on it: nought of nought is not a share. */}
        {(() => {
          const openInvite = () => { setInvEmail(''); setInvErr(null); setInvOpen(true); };
          if (trainersUnknown) {
            return (
              <HeroCard eyebrow="YOUR COACHING STAFF"
                title={loading || rosterStatus === 'loading' ? 'Reading Your Roster' : trainersUnread ? 'Your Trainers Could Not Be Read' : 'Only Part of Your Roster Came Back'}
                meta={loading || rosterStatus === 'loading'
                  ? 'Nothing is counted until the whole roster is here.'
                  : trainersUnread
                    ? 'Nothing below is a statement about your staff. An empty roster here means the read failed, not that nobody works for you.'
                    : 'So there is no count of your staff and no total of their sessions.'}
                cta={loading || rosterStatus === 'loading' ? undefined : { label: 'Try Again', onPress: refreshAll }} />
            );
          }
          if (onboarding) {
            return (
              <HeroCard eyebrow="YOUR COACHING STAFF" title="No Trainers Yet"
                meta="Invite a trainer by email. They join your gym when they accept in their own app, and their clients and sessions start counting here."
                cta={{ label: 'Invite a Trainer', onPress: openInvite }} />
            );
          }
          const n = roll.trainers;
          const good = ranked.filter((r) => r.h.risk === 'ok').length;
          return (
            <HeroCard eyebrow="YOUR COACHING STAFF · LAST 30 DAYS"
              title={`${num(n)} ${n === 1 ? 'Trainer' : 'Trainers'}`}
              meta={`${num(roll.clients)} ${roll.clients === 1 ? 'client' : 'clients'} · ${num(roll.atRiskCount)} ${roll.atRiskCount === 1 ? 'needs' : 'need'} a look`}
              ring={<HeroRing value={n > 0 ? good / n : null} figure={num(good)} sub={`of ${num(n)} ${riskLabel('ok').toLowerCase()}`}
                spoken={`${num(good)} of ${num(n)} trainers ${riskLabel('ok').toLowerCase()} over the last 30 days`} />}
              cta={{ label: 'Invite a Trainer', onPress: openInvite }} />
          );
        })()}

        {onboarding ? invitesBlock : null}

        {/* ── roster health: the state of the staff, before anything else ──── */}
        <Section>
          {/* Every figure on this screen is over the same thirty days — the
              window `fetchGymTrainers` reads — and the head says so once
              rather than each row implying it. */}
          <SectionHead title="Roster Health" note="Last 30 days" />
          {/* All three are counts over `trainers`, which is empty under a failed
              read as well as under an empty gym — hence fig() behind the same
              flag rather than String() behind `loading` alone. */}
          {/* The roster as a mix, since the approved look: how many of the
              staff sit in each of `trainerHealth`'s four states, in the words
              `riskLabel` gives them everywhere else. The trainer count is the
              figure in the hole. Under an unread or loading roster the slices
              are withheld — the grey track and dashes, never four noughts. */}
          {(() => {
            const count = (risk: string) => (trainersUnknown ? null : ranked.filter((r) => r.h.risk === risk).length);
            const slices = ([['ok', 'brand'], ['watch', 'amber'], ['high', 'red'], ['idle', 'neutral']] as const).map(([risk, tone]) => {
              const n = count(risk);
              return { label: riskLabel(risk), value: n, tone, shown: n == null ? null : num(n) };
            });
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg, flexWrap: 'wrap' }}>
                <Donut slices={slices} centre={trainersUnknown ? null : num(roll.trainers)} sub={roll.trainers === 1 ? 'trainer' : 'trainers'}
                  spoken={trainersUnknown
                    ? (loading ? 'Roster health, not read yet' : 'Roster health could not be read')
                    : `${num(roll.trainers)} trainer${roll.trainers === 1 ? '' : 's'}. ${slices.map((x) => `${x.label}, ${x.shown}`).join('. ')}`} />
                <Legend items={slices} />
              </View>
            );
          })()}
          <View style={{ marginTop: sp.lg }}>
            <KpiRow items={[
              { label: 'Clients', value: trainersUnknown ? '—' : fig(num(roll.clients)) },
              { label: 'Need a Look', value: trainersUnknown ? '—' : fig(roll.atRiskCount) },
            ]} />
          </View>
          {/* The gym-wide exception, with its consequence beside it: payroll is
              withheld while ANY finished session has no outcome, and the rows
              below say whose they are. */}
          {!trainersUnknown && roll.unmarked30 > 0 ? (
            <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
              {`${num(roll.unmarked30)} finished session${roll.unmarked30 === 1 ? '' : 's'} ${roll.unmarked30 === 1 ? 'has' : 'have'} no outcome recorded, so the 30 days cannot be valued yet. The rows below show whose.`}
            </Flag>
          ) : null}
        </Section>

        {/* The age of all three reads, under the roster's figures rather than
            in the header so the first viewport is the gym and not the plumbing. */}
        <Fetched at={fetchedAt} onRefresh={refreshAll} busy={loading} />

        <Section>
          {/* Worst first, as Overview's health board sorts the same people: the
              provider's order is most clients first, which put the trainer an
              owner most needs to see at the foot of the list. */}
          <SectionHead title="Trainers" note={!trainersUnknown && trainers.length ? 'Worst first' : undefined} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : trainersUnread ? (
            // Ahead of the empty branch, because they are the same empty array.
            // This one used to fall through to "No trainers yet. Invite one by
            // email", which is the app telling a staffed gym it has no staff.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Your roster could not be read, so nobody could be listed. This is a failed read,
              not an empty gym. Do not invite anyone on the strength of it.
            </Text>
          ) : trainers.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No trainers yet. Once somebody you invite accepts, they appear here with their clients
              and delivered sessions.
            </Text>
          ) : ranked.map(({ tr, h }, ix) => {
            // Delivered OF booked, and whatever is still unmarked, over the
            // same thirty days as the figures above — one period for every
            // number on the row.
            const work = `${num(tr.delivered30)} of ${num(tr.sessions30)} session${tr.sessions30 === 1 ? '' : 's'} delivered`;
            const who = `${tr.clients} client${tr.clients === 1 ? '' : 's'}`;
            return (
              // Overview's health row, with the WHY kept on it: this is the
              // screen an owner comes to for the detail, so the sentence that
              // put a trainer where they are is on the row and the sheet is for
              // the money. The state is in WORDS in the caption — the band's
              // colour on the monogram and the pill never says it alone.
              <HealthRow key={tr.id} divider={ix > 0} name={tr.name} score={h.score} band={h.tone}
                reason={h.reason}
                caption={`${riskLabel(h.risk)} · ${who} · ${work}${tr.unmarked30 > 0 ? ` · ${num(tr.unmarked30)} unmarked` : ''}`}
                onPress={() => setSel(tr)} />
            );
          })}
        </Section>

        {/* Sessions led this screen, "because it is the number that moves". It
            is the supporting evidence now: the review's order for Trainers is
            roster health and exceptions first, and a gym-wide session count
            says nothing about WHICH trainer needs the owner. It sits under the
            roster it is a sum of. */}
        {/* ── "Delivered" was the one word this figure could not carry ─────
            The label read "Sessions Delivered · 30 Days" over `sessions30`,
            which is every booking whose clock has passed WHATEVER its outcome
            — src/lib/gymTrainers.ts says so at the field, and `markOutcome`
            writes `outcome` without touching `status`, so a no-show, a
            cancellation and a late cancellation are all inside it and inside
            neither `delivered30` nor `unmarked30`.

            The money beside it is `payroll30`, which is `delivered30 × fee`.
            So the two halves of one hero counted two different populations,
            and an owner dividing the money by the figure above it reads back a
            session fee their gym does not charge. This was the third of the
            three screens ownerAnalytics' own header names: /dashboard and
            /revenue were corrected, and this one — the screen whose entire
            subject is what the coaching staff delivered — was not.

            The count is worth having and the word was not. `delivered` now
            appears only beside the figure that means it. */}
        {/* A card rather than the kit's bare `Hero`, which is the one block on
            this screen the board does not draw. The head's note is the way
            through to Revenue. */}
        {(() => {
          const figure = trainersUnknown ? '—' : fig(num(roll.sessions30));
          const note =
            loading ? 'Loading your roster…'
            : trainersUnread ? 'Your roster could not be read'
            // A prefix of the roster is not the roster, so it carries no count
            // of trainers and no total of their sessions. Neither read emits
            // this today — both refuse rather than degrade — so this is the
            // house rule holding rather than a live miscount being fixed.
            : !isWhole(rosterStatus) ? 'Only part of your roster came back, so this is not a total'
            : trainers.length === 0 ? 'Invite a trainer and their sessions start counting here.'
            // Said ahead of the money, because it is the reason there is none:
            // `payroll30For` returns null while ANY session is unmarked, and an
            // owner met "set a session fee" while their fee was already set.
            : roll.unmarked30 > 0
              ? `Across ${trainers.length} trainer${trainers.length === 1 ? '' : 's'} · ${num(roll.delivered30)} marked delivered, ${num(roll.unmarked30)} still unmarked, so this cannot be valued yet`
            : roll.payroll30 == null
              ? `Across ${trainers.length} trainer${trainers.length === 1 ? '' : 's'} · ${num(roll.delivered30)} marked delivered · set a session fee to see what that is worth`
              // gymMoney returns null when the gym has not set a currency, and
              // an unguarded ${} would put the word "null" in front of an
              // owner. The count is still true, so it is still said.
              : gymMoney(roll.payroll30, cur) == null
              ? `Across ${trainers.length} trainer${trainers.length === 1 ? '' : 's'} · ${num(roll.delivered30)} marked delivered · set your gym's currency to see what that is worth`
              : `${num(roll.delivered30)} marked delivered · worth ${gymMoney(roll.payroll30, cur)} at your session fee`;
          return (
            <Section>
              <SectionHead title="Sessions · 30 Days" note="Revenue" onPress={() => router.push('/(owner)/revenue')} />
              {/* One spoken sentence over label, figure and note, as the Hero
                  grouped them. Shrunk to fit and never wrapped — a count broken
                  across two lines is a count read wrong. */}
              <View accessible accessibilityLabel={`Sessions in 30 days, ${figure}, ${note}`}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.35}
                  style={{ ...ty.hero, ...numeric, color: t.ink }}>{figure}</Text>
                <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{note}</Text>
              </View>
            </Section>
          );
        })()}

        {/* ── pending invitations: below the operating roster, unless there
            is no roster yet, where they follow the hero directly. The invite
            button that sat in this block is the hero's action now. */}
        {onboarding ? null : invitesBlock}
      </ScrollView>

      {/* ── invite ─────────────────────────────────────────────────────── */}
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Scrim opacity={0.4} label="Cancel" onPress={() => { setInvErr(null); setInvOpen(false); }} />
          <View style={sheet}>
            <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.sm }}>Invite a Trainer</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              They join your gym when they accept in their own app.
            </Text>
            <TextInput value={invEmail} onChangeText={(v) => { setInvEmail(v); if (invErr) setInvErr(null); }}
              placeholder="their@email.com" placeholderTextColor={t.ink3} accessibilityLabel="Their email address"
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={input} />
            {invErr ? (
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{invErr}</Flag>
            ) : null}
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
              <View style={{ flex: 1 }}><Ghost label="Cancel" onPress={() => { setInvErr(null); setInvOpen(false); }} /></View>
              <View style={{ flex: 1 }}><Cta label={invBusy ? 'Sending…' : 'Send Invite'} wide disabled={invBusy} onPress={() => { void send(); }} /></View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── one trainer ────────────────────────────────────────────────── */}
      <Modal visible={!!current} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={{ flex: 1 }}>
          <Scrim opacity={0.4} onPress={() => setSel(null)} />
          <View style={sheet}>
            {current ? (() => { const h = trainerHealth(current); return (
              <>
                <Text style={{ ...ty.head, color: t.ink }}>{current.name}</Text>
                <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{h.reason}</Text>
                <KpiRow items={[
                  { label: 'Clients', value: fig(current.clients) },
                  { label: 'Delivered · 30d', value: fig(current.delivered30) },
                  { label: 'Health', value: fig(h.score) },
                ]} />
                {/* Value the confirmed work only. This used to multiply the fee
                    by every booking whose start time had passed, which priced
                    no-shows and slots nobody had cancelled. */}
                {current.unmarked30 > 0 ? (
                  <Notice
                    kicker="Awaiting Outcomes"
                    title={`${current.unmarked30} session${current.unmarked30 === 1 ? '' : 's'} need marking before this can be valued.`}
                  />
                ) : tenant?.sessionFee != null && cur ? (
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.lg }}>
                    {gymMoney(current.delivered30 * tenant.sessionFee, cur)} at your {gymMoney(tenant.sessionFee, cur)}/session fee
                  </Text>
                ) : tenant?.sessionFee != null ? (
                  // A fee with no currency is a number. Saying "6,300 at your
                  // 75/session fee" invites the reader to supply their own
                  // money for it, which is the wrong-amount bug without even a
                  // wrong symbol to notice.
                  <Notice kicker="No Currency" title="Set your gym's currency in Ops to value these sessions." />
                ) : (
                  <Notice kicker="No Session Fee" title="Set a session fee in Ops to value delivered sessions." />
                )}
                <View style={{ marginTop: sp.xl }}><Ghost label="Close" onPress={() => setSel(null)} /></View>
              </>
            ); })() : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * One trainer on the health board, the approved mockup's way: a monogram on
 * the band's pale plate, the name, why, what they delivered, and the score in
 * a pill of the same band. Overview carries the same row without the reason;
 * it is here twice because this lane may not add to src/ui/kit.tsx, and it is
 * a candidate to move there.
 *
 * The bands are `trainerHealth`'s own — good from 70, moderate from 40, low
 * under it (src/lib/ownerAnalytics.ts) — and NOT the mockup's 80 and 60, which
 * nothing in this product computes. Good is the ACCENT, so under white-label
 * it is the gym's colour; amber and red are the data palette and do not move.
 */
function HealthRow({ name, reason, caption, score, band, divider, onPress }: {
  name: string; reason: string; caption: string; score: number; band: 'good' | 'moderate' | 'low'; divider?: boolean; onPress: () => void;
}) {
  const t = useTheme();
  const tone = band === 'good' ? 'brand' as const : band === 'moderate' ? 'amber' as const : 'red' as const;
  const plate = tone === 'brand' ? t.brandSoft : t.data[`${tone}Soft`];
  const ink = tone === 'brand' ? t.brandText : t.data[`${tone}Ink`];
  const D = grown(42);
  // Array.from, not x[0]: a name that opens with an astral-plane letter is two
  // UTF-16 units, and half of one is a replacement character.
  const mono = name.split(' ').filter(Boolean).map((w) => Array.from(w)[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${name}. ${reason} ${caption}. Health ${score} of 100, ${band}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: grown(64), paddingVertical: sp.md, borderTopWidth: divider ? hairline : 0, borderTopColor: t.ring }}>
      <View style={{ width: D, height: D, borderRadius: radius.pill, backgroundColor: plate, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...ty.label, ...font('700'), color: ink }}>{mono}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ ...ty.head, color: t.ink }}>{name}</Text>
        <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{reason}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{caption}</Text>
      </View>
      <View><TonedChip label={String(score)} tone={tone} /></View>
      <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
    </Pressable>
  );
}
