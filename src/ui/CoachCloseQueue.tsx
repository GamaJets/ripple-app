// "Your Part of the Month" — the sentence a coach had never been shown.
//
// ── What it draws ──────────────────────────────────────────────────────────
//
// The month that just ended at the gym, and the two piles of the coach's own
// work outstanding against it: one-to-ones nobody has said what happened to,
// and classes with bookings and no register. Each row is a tap to the screen
// that clears it.
//
// ── The one distinction this screen exists to make ────────────────────────
//
// The two piles are NOT the same claim and are drawn apart on purpose.
//
// An unmarked one-to-one genuinely stops the month being signed off — it is
// `closeBlockers`' `unmarked_sessions`, computed on the owner's console from
// the same `isAwaitingOutcome` test the list below uses, and the owner's screen
// refuses the close on it today. That is a deadline and it is said as one.
//
// An open class register is not in the close at all. `CLOSE_PARTS` is payments,
// invoices, one-to-ones, memberships and passes; class attendance is none of
// them. Presenting it as a blocker would be the easy version of this feature
// and it would be false — and false in the worst available direction, because a
// coach who is told something is urgent, does it, and finds nothing changes
// stops reading the next warning. `REGISTERS_DO_NOT_BLOCK` says exactly what an
// open register does cost, which is not nothing: the gym's record of that class
// says nobody came.
//
// ── And the thing it must not claim ───────────────────────────────────────
//
// Whether the gym has already closed the month. `gym_month_closes` carries one
// policy and it is `is_owner_of(tenant_id)`, so this app cannot read it from a
// coach's session and will not imply it. `CLOSE_STATE_IS_THE_GYMS` is printed
// under every state of this section, including the clear one.
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Rule, Section, SectionHead, Flag, Ghost, Notice } from './kit';
import { sp, hairline, type as ty, numeric } from '../theme/scale';
import { MIN_TARGET } from '../lib/a11y';
import { num, fmtDay, fmtTime } from '../lib/format';
import { gapLine, type RegisterGap } from '../lib/registerGaps';
import {
  closeQueueNote, CLOSE_STATE_IS_THE_GYMS, UNMARKED_BLOCKS_THE_CLOSE,
  REGISTERS_DO_NOT_BLOCK, CLOSE_QUEUE_CLEAR, CLOSE_HALF_UNREAD,
  type UnmarkedSession,
} from '../lib/coachClose';
import type { MyCloseQueue } from './coachClose';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "Fri 14 Aug · 06:00", through the shared formatters so no weekday or month
 *  name is written out in English anywhere on this screen. */
function whenLabel(iso: string): string {
  const day = fmtDay(iso);
  const at = fmtTime(iso);
  return at ? `${day} · ${at}` : day;
}

/** Who it was with, described rather than named when the name could not be read.
 *  `rowToSession` answers null for an unread name, and a bare dash as the
 *  subject of a sentence reads as the screen having broken. */
const withWho = (s: UnmarkedSession): string => (s.clientName ? `with ${s.clientName}` : 'with a client');

/**
 * One tappable row. The same shape on both piles, so the two read as one list
 * of work with two different consequences rather than as two features.
 */
function QueueRow({ mark, when, title, note, cta, a11y, first, onPress }: {
  mark: string; when: string; title: string; note: string; cta: string;
  a11y: string; first: boolean; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: sp.md,
        paddingVertical: sp.md, minHeight: MIN_TARGET,
        borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring,
      }}>
      {/* A 6pt mark and not coloured words: a status hue as text ink does not
          clear 4.5:1 on the light palettes, and the sentence beside it already
          carries the meaning on its own. */}
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mark }} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>{when}</Text>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{title}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text>
      </View>
      <Text style={{ ...ty.label, color: t.brand }}>{cta}</Text>
    </Pressable>
  );
}

/**
 * The coach's own share of the month their gym is closing.
 *
 * Takes the whole hook result: 'loading' and 'error' both arrive as an unread
 * half — deliberately, since neither entitles anybody to say the coach is clear
 * — and the two want different words.
 */
export function CoachCloseQueue({ queue }: { queue: MyCloseQueue }) {
  const t = useTheme();
  const router = useRouter();
  const { view, status } = queue;

  if (view.kind === 'unread') {
    return (
      <Section>
        <SectionHead title="Your part of the month" />
        {status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3 }}>Working out which month your gym is closing…</Text>
        ) : (
          <Notice tone={t.warn} kicker="Month end" title="Your own rows could not be read" note={view.note}>
            <View style={{ marginTop: sp.md }}>
              <Ghost label="Try Again" onPress={queue.refresh} a11yLabel="Read your outstanding work for the month again" />
            </View>
          </Notice>
        )}
      </Section>
    );
  }

  if (view.kind === 'no_gym') {
    return (
      <Section>
        <SectionHead title="Your part of the month" />
        <Text style={{ ...ty.label, color: t.ink3 }}>{view.note}</Text>
      </Section>
    );
  }

  const sessions = view.sessions;
  const registers = view.registers;

  return (
    <Section>
      <SectionHead title={`Your part of ${view.monthLabel}`} note={closeQueueNote(view) ?? undefined} />

      {/* The heading names a month, so the sentence under it has to say whose
          calendar decided which month that is. A gym with no timezone set gets
          the reader's, and passing that off as the gym's is the defect
          src/lib/gymWindow.ts exists to stop. */}
      {queue.basis === 'reader' ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
          Your gym has not set a timezone, so this is the month that just ended on your own calendar
          rather than on theirs.
        </Text>
      ) : null}

      {view.clear ? <Flag tone={t.good}>{CLOSE_QUEUE_CLEAR}</Flag> : null}

      {/* ── the half that actually holds the month up ──────────────────── */}
      {sessions.state === 'unread' ? (
        <Flag tone={t.warn}>One-to-ones: {CLOSE_HALF_UNREAD}</Flag>
      ) : sessions.rows.length > 0 ? (
        <View>
          <Text style={{ ...ty.micro, color: t.ink3 }}>
            {num(sessions.rows.length)} {plural(sessions.rows.length, 'session', 'sessions')} with no outcome
          </Text>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{UNMARKED_BLOCKS_THE_CLOSE}</Text>
          {sessions.rows.map((s, i) => (
            <QueueRow
              key={s.id}
              mark={t.crit}
              first={i === 0}
              when={whenLabel(s.startsAt)}
              title={`Session ${withWho(s)}`}
              note="Finished, and nobody has recorded what happened."
              cta="Mark it"
              a11y={`Mark the session ${withWho(s)} on ${whenLabel(s.startsAt)}. Finished, and nobody has recorded what happened.`}
              onPress={() => router.push('/(trainer)/sessions')}
            />
          ))}
        </View>
      ) : null}

      {/* ── the half that does not ─────────────────────────────────────── */}
      {registers.state === 'unread' ? (
        <View style={{ marginTop: sessions.state === 'ready' && sessions.rows.length > 0 ? sp.lg : 0 }}>
          <Flag tone={t.warn}>Class registers: {CLOSE_HALF_UNREAD}</Flag>
        </View>
      ) : registers.rows.length > 0 ? (
        <View style={{ marginTop: sessions.state === 'ready' && sessions.rows.length > 0 ? sp.lg : 0 }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>
            {num(registers.rows.length)} {plural(registers.rows.length, 'register', 'registers')} never taken
          </Text>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{REGISTERS_DO_NOT_BLOCK}</Text>
          {registers.rows.map((g: RegisterGap, i) => (
            <QueueRow
              key={g.classId}
              mark={t.warn}
              first={i === 0}
              when={`${whenLabel(g.startsAt)}${g.branch ? ` · ${g.branch}` : ''}`}
              title={g.title}
              note={gapLine(g)}
              cta="Take it"
              a11y={`Take the register for ${g.title}, ${whenLabel(g.startsAt)}. ${gapLine(g)}`}
              onPress={() => router.push({
                pathname: '/(trainer)/class-checkin',
                params: { id: g.classId, title: g.title, branch: g.branch },
              })}
            />
          ))}
        </View>
      ) : null}

      <Rule />
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{CLOSE_STATE_IS_THE_GYMS}</Text>
    </Section>
  );
}
