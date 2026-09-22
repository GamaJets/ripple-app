// "Gym Kit" — the register the coach programs against, read-only.
//
// ── What it draws, and the four things it refuses to ──────────────────────
//
// What the gym has recorded as out of action, and what is past or near a
// service. Nothing else from the register: not purchase dates, not costs, not
// the maintenance log. A coach writing a session needs to know which rack they
// cannot use and which machine an engineer is about to take away, and a full
// inventory on this screen would bury both.
//
// It refuses, in order of how badly each would go wrong:
//
//   1. To draw an EMPTY LIST for a coach with no gym. Seven coaches are live on
//      this product and each is alone in their own tenant; no gym has signed up
//      yet. So the ordinary render is the one with no employer, and a blank
//      space under a heading about the gym's equipment says, silently, "your
//      gym has recorded nothing broken". `coachKitView` answers 'no_gym' from
//      the tenant link before it looks at a row, and this prints the sentence.
//   2. To state ANYTHING over a read that did not land. `KIT_UNREAD_NOTE` says
//      in as many words that it is not a claim about the kit — and the heading
//      carries no figure at all, because a "0" beside "Gym Kit" is read as
//      "nothing is broken" by every coach who glances at it.
//   3. To treat an UNFILLED REGISTER as a working gym. Those are different
//      sentences and this draws them differently.
//   4. To offer a control it cannot honestly complete. `gym_equipment_staff_u`
//      does let a trainer take a machine out of action, and doing that properly
//      writes a reason, a date and a `gym_equipment_log` row that the owner's
//      capacity banner reads. A toggle without those is worse than no toggle,
//      so `KIT_READ_ONLY_NOTE` says where that is done instead.
//
// ── Why a component and not a block inside classes.tsx ────────────────────
//
// app/(trainer)/classes.tsx is eleven hundred lines and already owns a
// timetable, a create form, a series editor and a management sheet. This
// section has its own two reads, its own status and its own five-way view.
// Keeping it here is what stops that screen growing a sixth read into the same
// render and a third meaning for the word `status`.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, Flag, Ghost, Notice } from './kit';
import { sp, type as ty } from '../theme/scale';
import { fmtDay, num } from '../lib/format';
import {
  kitHeadNote, KIT_READ_ONLY_NOTE, KIT_SERVICE_NOTE,
  type DownItem, type ServiceItem,
} from '../lib/coachKit';
import type { MyGymKit } from './coachKit';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * How long a machine has been out, or the sentence for one the register does not
 * date.
 *
 * "Out for 0 days" is not said, because `daysDown` is null rather than 0 where
 * the register carries no date — see `DownItem`. A coach who reads "out since
 * today" about a rower that has been broken since spring plans to have it back.
 */
function downSince(d: DownItem): string {
  if (d.daysDown == null) return 'The register does not say when it went out.';
  if (d.daysDown === 0) return 'Out since today.';
  return `Out for ${num(d.daysDown)} ${plural(d.daysDown, 'day', 'days')}.`;
}

/** One line of a service state, in the coach's words rather than the register's. */
function serviceSince(s: ServiceItem): string {
  const what = KIT_SERVICE_NOTE[s.state];
  if (s.state === 'overdue' && s.daysOverdue != null && s.dueOn) {
    return `Due ${fmtDay(s.dueOn)}, ${num(s.daysOverdue)} ${plural(s.daysOverdue, 'day', 'days')} ago.`;
  }
  if (s.dueOn) return `${what[0].toUpperCase()}${what.slice(1)}, due ${fmtDay(s.dueOn)}.`;
  // No date to name. The sentence still has to be whole: `unrecorded` means a
  // schedule exists and nothing was ever logged against it, and there is
  // genuinely no day to print.
  return `${what[0].toUpperCase()}${what.slice(1)}.`;
}

/**
 * The gym's equipment register on the coach's own screen.
 *
 * Takes the whole hook result rather than just the view, because 'loading' and
 * 'error' arrive as the same 'unread' view — deliberately, since neither
 * entitles anybody to say anything about the kit — and the two want different
 * words on screen. "Reading the register" and "the register could not be read"
 * are both honest; one of them invites a retry.
 */
export function GymKitRegister({ kit }: { kit: MyGymKit }) {
  const t = useTheme();
  const { view, status } = kit;
  const head = kitHeadNote(view);

  return (
    <Section>
      <SectionHead title="Gym Kit" note={head ?? undefined} />
      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
        What your gym has recorded as out of action, and what is past a service. A broken rack is a
        scheduling fact before it is a maintenance one.
      </Text>

      {view.kind === 'unread' ? (
        status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3 }}>Reading your gym’s register…</Text>
        ) : (
          <Notice tone={t.warn} kicker="Gym Kit" title="The register could not be read" note={view.note}>
            <View style={{ marginTop: sp.md }}>
              <Ghost label="Try Again" onPress={kit.refresh} a11yLabel="Read the gym’s equipment register again" />
            </View>
          </Notice>
        )
      ) : null}

      {/* Not a warning and not an error. A coach who works for themselves has
          no gym to have a register, and drawing that in a red-marked banner
          would tell them something is wrong with their account. */}
      {view.kind === 'no_gym' || view.kind === 'unwritten' ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>{view.note}</Text>
      ) : null}

      {view.kind === 'clear' ? (
        <View>
          <Flag tone={t.good}>{view.note}</Flag>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {num(view.items)} {plural(view.items, 'item', 'items')} on the register, {num(view.usableUnits)}{' '}
            {plural(view.usableUnits, 'unit', 'units')} in service.
          </Text>
        </View>
      ) : null}

      {view.kind === 'attention' ? (
        <View>
          {view.down.length > 0 ? (
            <View style={{ marginBottom: view.service.length > 0 ? sp.lg : 0 }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Out of Action</Text>
              {view.down.map((d, i) => (
                <View key={d.id} style={{ marginTop: i === 0 ? 0 : sp.md }}>
                  {/* A dot and ink, never coloured text — `t.crit` as a text
                      colour does not clear 4.5:1 and the contrast gate says so. */}
                  <Flag tone={t.crit}>
                    {d.label}
                    {d.units > 1 ? ` · ${num(d.units)} units` : ''}
                  </Flag>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2, marginStart: 14 }}>
                    {d.reason ? `${d.reason} · ` : ''}{downSince(d)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {view.service.length > 0 ? (
            <View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Due a Service</Text>
              {view.service.map((s, i) => (
                <View key={s.id} style={{ marginTop: i === 0 ? 0 : sp.md }}>
                  <Flag tone={s.state === 'overdue' ? t.serious : t.warn}>{s.label}</Flag>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2, marginStart: 14 }}>
                    {serviceSince(s)}
                  </Text>
                </View>
              ))}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                A service does not stop a machine being used. It is here because an engineer booked for
                Tuesday takes it out of the room on Tuesday.
              </Text>
            </View>
          ) : null}

          <Rule />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {num(view.usableUnits)} {plural(view.usableUnits, 'unit', 'units')} in service,{' '}
            {num(view.downUnits)} out, across {num(view.items)} {plural(view.items, 'item', 'items')} on the register.
          </Text>
        </View>
      ) : null}

      {/* Said under every view that reached the register, including the clear
          one: the absence of a control is a design decision and a coach who
          cannot find the button should be told where the button is. */}
      {view.kind === 'clear' || view.kind === 'attention' ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          {KIT_READ_ONLY_NOTE}
          {kit.gymDayKnown ? '' : ' Service dates are compared against your own calendar day, because your gym has not set a timezone.'}
        </Text>
      ) : null}
    </Section>
  );
}
