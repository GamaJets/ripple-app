// Why a coaching relationship ended, asked at the only moment it is knowable.
//
// ── What was thrown away ──────────────────────────────────────────────────
//
// `end_coaching(p_other)` took one argument and recorded nothing. A coach
// removing somebody from their book confirmed an alert reading "Remove client?"
// and that was the whole of it; a client leaving of their own accord produced
// the notification "A client has ended their coaching" and no more. Churn is
// the single cheapest thing a coach can learn about their own business, and the
// app was discarding it at the exact instant it existed.
//
// ── THE RULE THIS FILE HOLDS ──────────────────────────────────────────────
//
// A REASON IS ATTRIBUTED TO WHOEVER SAID IT. A coach filling this in about a
// client who said nothing has recorded a BELIEF, and six months later, on a
// churn list, a belief and a client's own words are indistinguishable unless
// something keeps them apart. `end_reason_by` is written by the server from
// auth.uid(); `reasonAttribution` in src/lib/endCoaching.ts is the sentence;
// and every screen in here prints it. See that file's own header.
//
// ── Two entry points, one sheet ───────────────────────────────────────────
//
//   · the coach removing somebody — the ending and the reason are ONE server
//     call, because two have a state between them (ended, unexplained) that
//     every dropped connection reaches;
//   · the coach explaining an ending that already happened — a client who left
//     on their own. `record_end_reason` writes onto the ended row.
//
// ── And why the card can be empty and still say something ─────────────────
//
// `departures` is null on a failed read, never an empty array. "Nobody has left
// recently" said over a refused query is a claim about a coach's business made
// out of our own failure, and it is the sort of good news somebody stops
// checking.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Modal, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useTheme } from './components';
import { Section, SectionHead, Cta, Ghost, Flag, Rule } from './kit';
import { sp, layout, radius, hairline, type as ty } from '../theme/scale';
import { capLimit, capped } from '../lib/rowCap';
import {
  END_REASONS, END_REASON_LABEL, END_REASON_NOTE, MAX_END_NOTE, isEndReason,
  recordEndReason, departureTally, type EndReason,
} from '../lib/endCoaching';
import { departureSectionNote } from '../lib/departureSection';
import { isWhole, type LoadStatus } from './loadStatus';
import { appLocale } from '../lib/locale';
import { num } from '../lib/format';
import { BACK_ICON } from './direction';
import { useScrollPad } from './keyboardPad';

/* ── the sheet ─────────────────────────────────────────────────────────────── */

/**
 * The picker. Nine reasons and a note, and a way out that records nothing.
 *
 * "Skip" is deliberately present and deliberately not the same as picking "They
 * Did Not Say". A coach who skips has not asked; a coach who picks that has
 * asked and been refused. Collapsing them would make a churn list count every
 * hurried removal as a client who would not explain themselves, and the
 * difference decides whether the coach's next move is to ask better questions
 * or to stop asking.
 */
export function EndReasonSheet({
  name, verb, onCancel, onDone,
  reasons = END_REASONS,
  labels = END_REASON_LABEL,
  notes = END_REASON_NOTE,
  explainer = 'This is kept on your own record of the coaching and is the only thing that will ever tell you why people leave you. Nothing here is sent to them.',
  notePlaceholder = 'What they actually said, in their words if you have them.',
  heading = 'Why it ended',
}: {
  name: string;
  /** What pressing the primary button will do, in the coach's words. Differs
   *  between "end this and record why" and "record why this ended", and a
   *  shared sheet that guessed would promise the wrong one. */
  verb: string;
  onCancel: () => void;
  /** `reason` null means the person chose to record nothing. */
  onDone: (reason: EndReason | null, note: string | null) => void;
  /* ── the client's side of the same question ──────────────────────────────
   * Everything below is optional and defaults to the coach's wording, which is
   * what this sheet was written for. app/(client)/my-coach.tsx passes the
   * member's version: the same reason IDS — so a churn list can compare a
   * client's own answer with a coach's guess, which is the whole argument in
   * `reasonAttribution` — with first-person labels, without the two reasons
   * only a coach can answer, and with an explainer that says who reads it.
   * Two sheets would be two vocabularies, and two vocabularies drift. */
  reasons?: readonly EndReason[];
  labels?: Record<string, string>;
  notes?: Record<string, string>;
  explainer?: string;
  notePlaceholder?: string;
  heading?: string;
}) {
  const t = useTheme();
  const scrollPad = useScrollPad(180);
  const [reason, setReason] = useState<EndReason | null>(null);
  const [note, setNote] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          Despite the name this is a full-screen page inside a `Modal animationType="slide"`, not
          a bottom sheet, so it takes the page treatment and not the sheet one.

          220 rather than 40 because the note is the last field and the button that records the
          ending is under it. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={onCancel} a11yLabel="Close without recording anything" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{heading}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>{name}</Text>
          </View>
        </View>

        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{explainer}</Text>

        <Section>
          <SectionHead title="Pick one" />
          <View>
            {reasons.map((r, i) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setReason(on ? null : r)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${labels[r]}. ${notes[r]}`}
                  style={{
                    paddingVertical: sp.md, paddingHorizontal: sp.md,
                    borderTopWidth: i ? hairline : 0, borderTopColor: t.ring,
                    borderRadius: radius.sm,
                    backgroundColor: on ? t.surface2 : 'transparent',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    {/* A dot rather than coloured text: the scale reserves
                        status colour for status and none of these clears AA
                        as type. Same rule as driftTone next door. */}
                    <View style={{
                      width: 8, height: 8, borderRadius: 4,
                      backgroundColor: on ? t.brand : 'transparent',
                      borderWidth: on ? 0 : hairline, borderColor: t.ring,
                    }} />
                    <Text style={{ ...ty.body, fontWeight: on ? '600' : '400', color: t.ink, flex: 1 }}>
                      {labels[r]}
                    </Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2, marginStart: 16 }}>
                    {notes[r]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section>
          <SectionHead title="Anything else" note="optional" />
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={MAX_END_NOTE}
            accessibilityLabel="A note about why this ended"
            placeholder={notePlaceholder}
            placeholderTextColor={t.ink3}
            style={{
              ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
              padding: sp.md, minHeight: 110, textAlignVertical: 'top',
            }}
          />
        </Section>

        <Section>
          <Cta label={verb} wide onPress={() => onDone(reason, note.trim() || null)} />
          <View style={{ marginTop: sp.md }}>
            {/* Not the same as picking "They Did Not Say". See the header. */}
            <Ghost label="Skip and Record Nothing" onPress={() => onDone(null, null)} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Skipping records nothing at all, which is a different answer from a reason — one of those is a
            question nobody answered and the other is a question that was.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── endings nobody has explained ──────────────────────────────────────────── */

export interface Departure {
  clientId: string;
  name: string | null;
  endedAt: string | null;
  /** True when the COACH ended it. False when the client did. Null when the
   *  row predates `ended_by` — which means unknown, not "the client". */
  endedByMe: boolean | null;
  /**
   * As stored, and deliberately not narrowed here.
   *
   * `unknown` rather than `EndReason | null` because the column is plain text
   * and a value this build does not recognise must land in "nothing recorded"
   * rather than being dropped or guessed at — the same rule `departureTally`
   * states. `isEndReason` is the only thing that decides.
   */
  reason: unknown;
}

export interface DepartureRead {
  /** Null on a failed read, and NEVER an empty array for one. An empty list is
   *  a claim that nobody has left, and that is the sort of good news a coach
   *  stops checking. */
  rows: Departure[] | null;
  status: LoadStatus;
  reload: () => Promise<void>;
}

/** How far back an unexplained ending is still worth asking about. Three
 *  months: past that a coach is guessing at what somebody said rather than
 *  remembering it, and a guess filed as a record is the thing this whole
 *  feature is careful about. */
export const DEPARTURE_WINDOW_DAYS = 90;

/**
 * EVERY ending on this coach's book in the window — explained or not.
 *
 * ── why the filter went ───────────────────────────────────────────────────
 *
 * This read used to carry `.is('end_reason', null)`, and the coach dashboard
 * ran a SECOND read of the same table, for the same coach, over the same ninety
 * days, without it — one to ask about the unexplained endings and one to count
 * the explained ones. Two round trips to describe one book, and, because they
 * were written by different hands, two sections that said the same fact in two
 * voices whenever nothing had been recorded yet.
 *
 * One read now answers both. The unexplained ones are the rows `isEndReason`
 * rejects, which is the same test `departureTally` applies, so the list a coach
 * is asked to clear and the count of what is still missing cannot disagree.
 *
 * `reload` is a nonce: pass a number that changes and this re-reads. The card
 * sits on a screen with pull-to-refresh, and without it the gesture refreshed
 * everything around this section and not the section itself.
 */
export function useDepartures(reload?: number): DepartureRead {
  const [rows, setRows] = useState<Departure[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setRows([]); setStatus('ready'); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      if (!uid) { setRows([]); setStatus('ready'); return; }
      const since = new Date(Date.now() - DEPARTURE_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('coaching_relationships')
        .select('client_id, ended_at, ended_by, end_reason, profiles!coaching_relationships_client_id_fkey(full_name)')
        .eq('coach_id', uid)
        .eq('status', 'ended')
        .gte('ended_at', since)
        .order('ended_at', { ascending: false })
        .limit(capLimit());
      if (error) {
        // Includes 42703 on a database that has not had part 168 applied. Both
        // that and a refusal are 'error' here, and 'error' draws no list at all
        // rather than an empty one.
        reportError('departures.read', error);
        setRows(null); setStatus('error'); return;
      }
      const page = capped(data);
      setRows(page.rows.map((r: any) => ({
        clientId: String(r.client_id),
        name: (r.profiles?.full_name ?? '').trim() || null,
        endedAt: r.ended_at ?? null,
        endedByMe: typeof r.ended_by === 'string' ? r.ended_by === uid : null,
        reason: r.end_reason ?? null,
      })));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('departures.read', e);
      setRows(null); setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load, reload]);

  return { rows, status, reload: load };
}

/**
 * Why people have left — the whole of it, in one section.
 *
 * ── the two sections this replaces ────────────────────────────────────────
 *
 * The coach dashboard drew this card and then, immediately under it, a second
 * section counting departure reasons. Both were right. Both were well written.
 * Between them they said the same fact in two voices, down to the month:
 *
 *   WHY THEY LEFT — "One person has left your book in the last three months
 *   with nothing recorded about why. It is the cheapest thing you will ever
 *   learn about your own business, and you will not remember it in March."
 *
 *   WHY PEOPLE HAVE LEFT · Last 90 days — "1 person has left your book in the
 *   last 90 days, and nothing is recorded about why any of them did. Every one
 *   of those answers is still gettable, and none of them will be in March."
 *
 * This one survived because it is the one a coach can ACT on: it names the
 * person and offers Record Why. Everything the other said is carried across —
 * `departureSectionNote` in src/lib/departureSection.ts holds the merged
 * sentence and a test that says which claims may not be lost — and the counts
 * it drew are now the read-back UNDER the ask, off the same single read.
 *
 * ── what it will not say ──────────────────────────────────────────────────
 *
 * Nothing at all when the read failed. A banner reading "we could not check
 * whether anybody has left" is noise on a screen that already carries four
 * honest warnings, and the read is retried on the next mount and on the next
 * pull. Nothing when nobody has left, because "0 people have left you" reads as
 * a compliment on a book that has never had anybody on it.
 *
 * And no TALLY when the read came back truncated. The list of people to ask is
 * still drawn — they are real, and a coach can act on a prefix of them — but a
 * count over a prefix is not a smaller count, it is a different one, and the
 * commonest reason would be a fact about the row cap. `isWhole` is the gate;
 * src/ui/loadStatus.ts records why 'partial' is not 'ready'.
 */
export function UnexplainedDepartures({ reload }: { reload?: number }) {
  const t = useTheme();
  const dep = useDepartures(reload);
  const [asking, setAsking] = useState<Departure | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = dep.rows;
  // Before the early return, because hooks are not conditional.
  const whole = isWhole(dep.status);
  const tally = useMemo(
    () => (rows && whole ? departureTally(rows.map((r) => ({ reason: r.reason, endedAt: r.endedAt }))) : null),
    [rows, whole],
  );
  // `sectionNote` and not `note`: `record` below takes a `note` of its own —
  // the words a client actually said — and two different things called note in
  // one component is how the wrong one gets rendered.
  const sectionNote = useMemo(() => departureSectionNote(tally, DEPARTURE_WINDOW_DAYS), [tally]);
  // The ones there is still something to ask about. `isEndReason` and not
  // `!= null`, so a value this build does not recognise is asked about rather
  // than silently counted as answered.
  const unexplained = useMemo(() => (rows ?? []).filter((r) => !isEndReason(r.reason)), [rows]);

  if (!rows || rows.length === 0) return null;

  const record = async (d: Departure, reason: EndReason | null, note: string | null) => {
    setAsking(null);
    if (!reason) return; // Skipped. Nothing recorded and nothing claimed.
    if (!isEndReason(reason)) return;
    const r = await recordEndReason(d.clientId, reason, note);
    if (!r.ok) { setMsg(r.reason); return; }
    if (!r.stored) {
      setMsg('There was no ended coaching to attach that to, so nothing was recorded. If they are still on your book, they have not left.');
      return;
    }
    setMsg(null);
    await dep.reload();
  };

  return (
    <>
      <Rule />
      <Section>
        <SectionHead title="Why People Have Left" note={`Last ${DEPARTURE_WINDOW_DAYS} days`} />
        {/* The one sentence both sections used to say. Withheld entirely under
            a truncated read, along with the counts below it. */}
        {sectionNote ? <Text style={{ ...ty.label, color: t.ink2 }}>{sectionNote}</Text> : null}
        {/* Truncated, which is not failed and not empty. The rows that DID come
            back are real people a coach can ask, so they are still listed —
            what is withheld is every figure over them, because a count over a
            prefix is a fact about the row cap. src/ui/loadStatus.ts. */}
        {!whole ? (
          <Text style={{ ...ty.label, color: t.ink2 }}>
            More people have left in this window than came back, so nothing here is counted or added up.
            The ones listed below are real and can still be asked; how many there are altogether is not
            something this screen can state.
          </Text>
        ) : null}
        {msg ? <View style={{ marginTop: sp.md }}><Flag tone={t.crit}>{msg}</Flag></View> : null}
        {unexplained.length > 0 ? (
        <View style={{ marginTop: sp.md }}>
          {unexplained.map((d, i) => (
            <View key={d.clientId}
              style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
              <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>{d.name ?? 'A former client'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {/* Who ended it is a fact worth printing: a coach's own decision
                    and a client walking away are different events and the card
                    would otherwise read as if every one of these left. */}
                {d.endedByMe === true ? 'You ended this one.'
                  : d.endedByMe === false ? 'They ended it.'
                    : 'Who ended it was not recorded.'}
                {d.endedAt ? ` ${new Date(d.endedAt).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                <Ghost label="Record Why"
                  a11yLabel={`Record why ${d.name ?? 'this client'} left`}
                  onPress={() => setAsking(d)} />
              </View>
            </View>
          ))}
        </View>
        ) : null}

        {/* ── and the answers already given, counted ──────────────────────
            Under the ask rather than over it: the ask is the thing a coach can
            do something about this morning, and this is the read-back. It was
            a section of its own and had nothing to read back until at least one
            answer existed — a heading with no rows under it, and a caption
            pointing at counts that were not there.

            Counts, never a rate. A percentage over the four people who left a
            coach's book this quarter is noise, which is what
            `MIN_COHORT_FOR_RATE` says elsewhere in the app. */}
        {tally && tally.counts.length > 0 ? (
          <View style={{ marginTop: sp.lg }}>
            {tally.counts.map((c, i) => (
              <View key={c.reason} style={{
                flexDirection: 'row', justifyContent: 'space-between', gap: sp.md,
                paddingVertical: sp.sm,
                borderTopWidth: i ? hairline : 0, borderTopColor: t.ring,
              }}>
                <Text style={{ ...ty.label, color: t.ink, flex: 1 }}>{END_REASON_LABEL[c.reason]}</Text>
                <Text style={{ ...ty.label, color: t.ink2 }}>{num(c.n)}</Text>
              </View>
            ))}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Counts, not percentages. Over a book this size a share would move by twenty points because one
              person moved house, and it would read as a trend.
            </Text>
          </View>
        ) : null}
      </Section>

      <Modal visible={!!asking} animationType="slide" onRequestClose={() => setAsking(null)}>
        {asking ? (
          <EndReasonSheet
            name={asking.name ?? 'A former client'}
            verb="Record This"
            onCancel={() => setAsking(null)}
            onDone={(reason, note) => { void record(asking, reason, note); }}
          />
        ) : null}
      </Modal>
    </>
  );
}
