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
import { useCallback, useEffect, useState } from 'react';
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
  recordEndReason, type EndReason,
} from '../lib/endCoaching';
import type { LoadStatus } from './loadStatus';

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
export function EndReasonSheet({ name, verb, onCancel, onDone }: {
  name: string;
  /** What pressing the primary button will do, in the coach's words. Differs
   *  between "end this and record why" and "record why this ended", and a
   *  shared sheet that guessed would promise the wrong one. */
  verb: string;
  onCancel: () => void;
  /** `reason` null means the coach chose to record nothing. */
  onDone: (reason: EndReason | null, note: string | null) => void;
}) {
  const t = useTheme();
  const [reason, setReason] = useState<EndReason | null>(null);
  const [note, setNote] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={onCancel} a11yLabel="Close without recording anything" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Why it ended</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>{name}</Text>
          </View>
        </View>

        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          This is kept on your own record of the coaching and is the only thing that will ever tell you why people
          leave you. Nothing here is sent to them.
        </Text>

        <Section>
          <SectionHead title="Pick one" />
          <View>
            {END_REASONS.map((r, i) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setReason(on ? null : r)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${END_REASON_LABEL[r]}. ${END_REASON_NOTE[r]}`}
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
                      {END_REASON_LABEL[r]}
                    </Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2, marginLeft: 16 }}>
                    {END_REASON_NOTE[r]}
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
            placeholder="What they actually said, in their words if you have them."
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
            Skipping records nothing at all, which is a different answer from “they did not say” — one of those is
            a question nobody asked and the other is a question that was answered.
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
 * Recent endings on this coach's book with no reason recorded against them.
 *
 * `end_reason is null` is the filter, so an ending the coach has already
 * explained drops off the card the moment they explain it, and one where the
 * CLIENT gave a reason never appears at all — there is nothing to ask.
 */
export function useDepartures(): DepartureRead {
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
        .is('end_reason', null)
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
      })));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('departures.read', e);
      setRows(null); setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { rows, status, reload: load };
}

/**
 * The card. Renders nothing at all when there is nothing to ask about — which
 * includes a failed read, because a banner on the Clients screen saying "we
 * could not check whether anybody has left" is noise on a screen that already
 * has four honest warnings on it, and the read is retried on the next mount.
 */
export function UnexplainedDepartures() {
  const t = useTheme();
  const dep = useDepartures();
  const [asking, setAsking] = useState<Departure | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = dep.rows;
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
        <SectionHead title="Why they left" note={`${rows.length}`} />
        <Text style={{ ...ty.label, color: t.ink2 }}>
          {rows.length === 1 ? 'One person has' : `${rows.length} people have`} left your book in the last three
          months with nothing recorded about why. It is the cheapest thing you will ever learn about your own
          business, and you will not remember it in March.
        </Text>
        {msg ? <View style={{ marginTop: sp.md }}><Flag tone={t.crit}>{msg}</Flag></View> : null}
        <View style={{ marginTop: sp.md }}>
          {rows.map((d, i) => (
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
                {d.endedAt ? ` ${new Date(d.endedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                <Ghost label="Record Why"
                  a11yLabel={`Record why ${d.name ?? 'this client'} left`}
                  onPress={() => setAsking(d)} />
              </View>
            </View>
          ))}
        </View>
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
