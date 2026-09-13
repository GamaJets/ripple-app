// "Money Out" — writing down what the gym just paid for, where it was paid.
//
// ── Why this is a form and not a quick-add ────────────────────────────────
//
// A `gym_costs` row is a claim that money LEFT THE GYM'S ACCOUNT. Part 2730
// spends a page refusing to let anything in the database create one on its own
// — no trigger, no job, no template that posts — because the direct debit
// fails, the landlord gives a rent holiday, the insurer is changed on the 3rd,
// and a row that was never incurred is then in a ledger whose only remaining
// job is to be true, under a month that will later be locked.
//
// A one-tap "£40 cash" on a phone is that same phantom row with a friendlier
// gesture. So this asks for exactly what the console asks for — what it was
// for, how much, in what money, on what day, under which category — and the one
// gate is `gymCostBlockers`, the console's own. Nothing is guessed, nothing is
// pre-filled from what the gym usually pays, and `NO_QUICK_ADD_HERE` says so
// under the form rather than leaving the six fields to look like an oversight.
//
// ── The three things drawn here that are not fields ───────────────────────
//
//   · WHAT IT IS: the row is the owner's own word, checked against nothing, and
//     no receipt is stored behind it. Said before the button, not after.
//   · WHAT NOT TO PUT IN IT: trainer session pay is settled through Payroll and
//     is already /accounting's whole "money out", and a refund belongs against
//     the original payment. Either one typed here counts the same money twice
//     and nothing can detect that two rows are one payment.
//   · WHAT IS ALREADY IN: the month's lines, so the £40 recorded on the walk
//     back from the shop is not recorded again at the desk. Two identical rows
//     are exactly what two identical purchases look like.
import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, Cta, Ghost, Flag, Field } from './kit';
import { DateSheet } from './DateSheet';
import { sp, radius, hairline, type as ty, numeric } from '../theme/scale';
import { MIN_TARGET } from '../lib/a11y';
import { money } from '../lib/gymRecord';
import { calendarDateText } from '../lib/gymWhen';
import {
  GYM_COST_CATEGORIES, gymCostCategoryLabel, gymCostsEmptyLine,
  GYM_COSTS_NOT_TWICE, GYM_COSTS_ARE_NEVER_NETTED,
  type GymCostCategory,
} from '../lib/gymCosts';
import {
  COST_IS_A_CLAIM_ABOUT_YOUR_BANK, NO_QUICK_ADD_HERE, COST_UNCONFIRMED_NOTE,
  CLOSED_MONTH_UNKNOWN_NOTE,
} from '../lib/ownerCostEntry';
import { isWhole, type LoadStatus } from './loadStatus';
import type { OwnerCosts } from './ownerCosts';

/** What the owner has typed, before it is anything. Held here rather than in
 *  the hook: a draft is screen state, and a hook that owned it would make the
 *  form unclearable from anywhere else. */
interface Draft {
  description: string;
  supplier: string;
  amountText: string;
  category: GymCostCategory | null;
  paidOn: string;
  note: string;
}

const EMPTY = (day: string): Draft => ({
  description: '', supplier: '', amountText: '',
  // NOT pre-selected. A category chosen for somebody is a category nobody
  // chose, and "Where it went" on the console is then a split of this app's
  // habits rather than of the gym's money.
  category: null,
  paidOn: day, note: '',
});

/** The box every text field on this form is drawn in. */
function box(t: ReturnType<typeof useTheme>) {
  return {
    ...ty.body, color: t.ink, backgroundColor: t.surface2,
    borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11,
  } as const;
}

/**
 * The gym's outgoings for the month it is in, and the form that adds one.
 *
 * `costs` is the hook; `currency` and `closesUnread` come from the screen,
 * which already holds both. The currency is NOT chosen here — a cost is
 * recorded in the money the gym charges in, and offering a picker would let one
 * ledger hold amounts nobody can add up.
 */
export function GymCostEntry({ costs, currency, closesUnread }: {
  costs: OwnerCosts;
  /** `tenants.currency`, or null because the gym has not set one — in which
   *  case there is nothing to record an amount in and the gate says so. */
  currency: string | null;
  /** True when `gym_month_closes` could not be read, so the form cannot tell
   *  whether the day chosen falls inside a filed month. */
  closesUnread: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => EMPTY(costs.today.day));
  const [problems, setProblems] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const status: LoadStatus = costs.status;
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // Cleared on the first keystroke after a refusal: a list of reasons that
    // stays on screen while the reader fixes them stops being about what is
    // wrong now.
    if (problems.length) setProblems([]);
    if (msg) setMsg(null);
  };

  const submit = async () => {
    setBusy(true);
    setProblems([]);
    setMsg(null);
    const r = await costs.record({
      description: draft.description,
      supplier: draft.supplier,
      amountText: draft.amountText,
      currency,
      // `costEntryBlockers` refuses a category that is not one of the thirteen,
      // which is what a null becomes here. The cast is to the draft's type and
      // not a claim that one was chosen.
      category: (draft.category ?? '') as GymCostCategory,
      paidOn: draft.paidOn,
      note: draft.note,
    });
    setBusy(false);
    if (r.kind === 'refused') { setProblems(r.problems); return; }
    if (r.kind === 'failed') { setMsg({ bad: true, text: `${r.reason} Nothing has been written down.` }); return; }
    if (r.kind === 'unconfirmed') { setMsg({ bad: true, text: COST_UNCONFIRMED_NOTE }); return; }
    setDraft(EMPTY(costs.today.day));
    setOpen(false);
    setMsg({
      bad: false,
      text: `Recorded: ${r.cost.description} — ${money(r.cost.amountCents, r.cost.currency) ?? 'an amount this app cannot state'}`
        + `, paid ${calendarDateText(r.cost.paidOn) ?? r.cost.paidOn}. It is in the gym's ledger and on the console.`,
    });
  };

  return (
    <Section>
      <SectionHead title="Money Out"
        note={isWhole(status) && costs.rows.length ? `${costs.rows.length} this month` : undefined} />
      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
        What the gym paid for, written down where you paid it.
        {costs.monthLabel ? ` The lines below are ${costs.monthLabel}.` : ''}
      </Text>

      {/* ── what is already in ─────────────────────────────────────────── */}
      {/* `gymCostsEmptyLine` words all four silences — still reading, refused,
          truncated, and genuinely nothing recorded — and only the last of them
          is a statement about the gym. `isWhole`, so a prefix of a busy month's
          costs is never drawn as the month's costs. */}
      {!isWhole(status) || costs.rows.length === 0 ? (
        <Text style={{ ...ty.caption, color: t.ink3 }}>{gymCostsEmptyLine(status)}</Text>
      ) : (
        costs.rows.map((c, i) => (
          <View key={c.id} style={{
            flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md,
            borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.description}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {gymCostCategoryLabel(c.category)}
                {c.supplier ? ` · ${c.supplier}` : ''}
                {` · ${calendarDateText(c.paidOn) ?? c.paidOn}`}
              </Text>
            </View>
            {/* A dash where the amount would be, never a zero: a cost whose
                currency or amount cannot be read is money of unknown size. */}
            <Text style={{ ...ty.body, ...numeric, color: t.ink }}>
              {money(c.amountCents, c.currency) ?? '—'}
            </Text>
          </View>
        ))
      )}

      {/* Nothing on this screen is netted against what the gym took, and the
          absence of a profit figure reads as an omission unless somebody says
          it was a decision. */}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{GYM_COSTS_ARE_NEVER_NETTED}</Text>

      {msg ? (
        msg.bad
          ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{msg.text}</Flag>
          : <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{msg.text}</Text>
      ) : null}

      {!open ? (
        <View style={{ marginTop: sp.lg }}>
          <Cta wide label="Record a Cost" onPress={() => { setMsg(null); setOpen(true); }} />
        </View>
      ) : (<>
        <View style={{ height: sp.lg }} />
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{COST_IS_A_CLAIM_ABOUT_YOUR_BANK}</Text>

        <Field label="WHAT WAS IT FOR" hint="a bank statement in eleven months has this and nothing else">
          <TextInput value={draft.description} onChangeText={(v) => set({ description: v })}
            placeholder="Hygiene supplies" placeholderTextColor={t.ink3}
            style={box(t)} />
        </Field>

        <View style={{ height: sp.md }} />
        <Field label="WHO WAS PAID" hint="optional — a cash purchase nobody wrote down is still a real cost">
          <TextInput value={draft.supplier} onChangeText={(v) => set({ supplier: v })}
            placeholder="—" placeholderTextColor={t.ink3}
            style={box(t)} />
        </Field>

        <View style={{ height: sp.md }} />
        <Field
          label={currency ? `HOW MUCH (${currency})` : 'HOW MUCH'}
          hint={currency ? undefined : 'your gym has not set a currency, so this cannot be recorded yet'}
          a11y={currency
            ? `How much was paid, in ${currency}`
            : 'How much was paid. Your gym has not set a currency, so nothing can be recorded until one is set on Ops.'}>
          <TextInput value={draft.amountText} onChangeText={(v) => set({ amountText: v })}
            placeholder="0.00" placeholderTextColor={t.ink3}
            keyboardType="decimal-pad"
            style={{ ...box(t), ...numeric }} />
        </Field>

        <View style={{ height: sp.md }} />
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 5 }}>WHAT KIND OF COST</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {GYM_COST_CATEGORIES.map((c) => {
            const on = c.id === draft.category;
            return (
              <Pressable key={c.id} onPress={() => set({ category: c.id })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${c.label}. ${c.note}`}
                style={{
                  paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill,
                  backgroundColor: on ? t.brand : t.surface2,
                }}>
                <Text style={{ ...ty.label, color: on ? t.brandInk : t.ink2 }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {draft.category ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {GYM_COST_CATEGORIES.find((c) => c.id === draft.category)?.note}
          </Text>
        ) : null}

        <View style={{ height: sp.md }} />
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 5 }}>WHEN THE MONEY WENT OUT</Text>
        <Pressable onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`The day this was paid: ${calendarDateText(draft.paidOn) ?? draft.paidOn}. Change it.`}
          style={{
            ...box(t), minHeight: MIN_TARGET, justifyContent: 'center',
          }}>
          <Text style={{ ...ty.body, color: t.ink }}>{calendarDateText(draft.paidOn) ?? draft.paidOn}</Text>
        </Pressable>
        {/* Whose "today" the form opened on. With no zone on the gym this is
            the phone's, and a day is what decides which month the line is filed
            under — so it is disclosed rather than assumed. */}
        {!costs.today.atGym ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Your gym has not said which timezone it is in, so this opened on this phone&rsquo;s day. Which day a cost
            is dated decides which month it is filed under — check it if you are not at the gym.
          </Text>
        ) : null}
        {closesUnread ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{CLOSED_MONTH_UNKNOWN_NOTE}</Text>
        ) : null}

        <View style={{ height: sp.md }} />
        <Field label="ANYTHING ELSE" hint="optional">
          <TextInput value={draft.note} onChangeText={(v) => set({ note: v })}
            placeholder="—" placeholderTextColor={t.ink3} multiline
            style={{ ...box(t), minHeight: 64, textAlignVertical: 'top' }} />
        </Field>

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{GYM_COSTS_NOT_TWICE}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{NO_QUICK_ADD_HERE}</Text>

        {problems.length ? (
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>{problems.join(' ')}</Flag>
        ) : null}

        <View style={{ marginTop: sp.lg }}>
          <Cta wide label={busy ? 'Recording…' : 'Record This Cost'} disabled={busy}
            onPress={() => { void submit(); }} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => {
            setOpen(false); setProblems([]); setMsg(null);
            setDraft(EMPTY(costs.today.day));
          }} a11yLabel="Close this form without recording anything" />
        </View>
      </>)}

      <DateSheet
        visible={picking}
        value={draft.paidOn}
        heading="The day the money went out"
        note="A cost is filed under the month this day falls in, and a month that has been signed off will refuse it."
        onCancel={() => setPicking(false)}
        onPick={(iso) => { setPicking(false); set({ paidOn: iso }); }}
      />
    </Section>
  );
}
