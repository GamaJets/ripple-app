// The home `coach_feedback` did not have.
//
// ── What this replaces ────────────────────────────────────────────────────
//
// One line on app/(client)/dashboard.tsx:
//
//     {coachNotes.length > 0 ? (
//       <Text … numberOfLines={4}>{coachNotes[0].body}</Text>
//     ) : null}
//
// The newest note, clipped at four lines, and nothing anywhere else in any of
// the three apps. Every note before it was unreachable to the person it was
// written to, while the coach who wrote them could still read the lot from
// their own client detail — so neither side had any reason to notice. The gym
// noticeboard three blocks further down that same screen shows one notice and
// says in its own comment that "the rest are one tap away in Notices". The
// coach's advice had no Notices.
//
// ── Why a component and not a route ───────────────────────────────────────
//
// Everything below is a whole screen's worth of content with its own heading,
// its own four load states and no dependency on where it is mounted, so
// promoting it to `app/(client)/coach-advice.tsx` is a file that renders this
// and a line in the Tabs list. It is mounted today on app/(client)/my-coach.tsx,
// which is the screen about the person who wrote these notes.
//
// ── It reads the provider, not the table ──────────────────────────────────
//
// `CoachFeedbackProvider` (src/ui/feedback.tsx) is already mounted app-wide and
// already holds these rows, keyed by client id, with a real LoadStatus on them.
// A second reader would be a second query for rows this app has in hand, and —
// worse — a second opinion about whether they are all of them.
//
// Which matters, because that provider's status is genuinely 'partial': it
// reads every note the caller is party to in one query under `capLimit()`. The
// count below is gated on `isWhole` for that reason and not as a formality.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead } from './kit';
import { sp, grown, type as ty } from '../theme/scale';
import { appLocale } from '../lib/locale';
import { isWhole } from './loadStatus';
import { useCoachFeedback } from './feedback';
import { sortAdvice, coachAdviceNote, adviceStampLine } from '../lib/coachAdvice';

/**
 * The day a note was written, in the reader's own locale, or null.
 *
 * `Date.parse` on a timestamptz, which is a full instant — not a bare
 * `YYYY-MM-DD` parsed as UTC, which is the shape that moves a day backwards for
 * every reader west of Greenwich. Null rather than a dash: `adviceStampLine`
 * returns null in turn and the row is not drawn, instead of a label built
 * around a hole.
 */
function writtenOn(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
}

/**
 * Everything this member's coach has written to them.
 *
 * `clientId` is the member's own account id, which is the key the provider
 * stores under and the key the coach wrote against. `coachName` is used only
 * inside sentences and is null wherever it could not be read — every branch of
 * `coachAdviceNote` is written to survive that without a hole in it.
 *
 * There is nothing to tap here on purpose. These are somebody else's words
 * addressed to the reader; the reply is the thread, which the screen this sits
 * on already offers twice.
 */
export function CoachAdvice({ clientId, coachName }: {
  clientId: string;
  coachName: string | null;
}) {
  const t = useTheme();
  const { getFeedback, status: readStatus } = useCoachFeedback();

  // "We do not know who you are" is not "your coach has written you nothing".
  //
  // `useClientData().id` is `sbUid ?? 'unknown'` and the provider that resolves
  // it settles independently of this one, so a caller can hand over the string
  // 'unknown' while the session is still landing. `getFeedback('unknown')`
  // answers with an empty array and the provider's own status is whatever it is
  // — 'ready', quite possibly — and the sentence built from that pair tells a
  // member their coach has never written to them. src/ui/planEditsShared.ts
  // takes the same id through the same guard for the same reason.
  const known = !!clientId && clientId !== 'unknown';
  const status = known ? readStatus : 'error';
  const notes = known ? sortAdvice(getFeedback(clientId)) : [];

  // `isWhole`, not `!== 'error'`. Under 'loading' the list is empty because
  // nothing has arrived, and under 'partial' it is a prefix of an unknown set —
  // so the figure in the sentence would be a count of some of somebody's
  // advice, printed as a count of all of it. See src/ui/loadStatus.ts.
  const countable = isWhole(status) ? notes.length : 0;

  return (
    <Section>
      <SectionHead title="From Your Coach" />
      <Text style={{ ...ty.label, color: t.ink3 }}>
        {coachAdviceNote(status, countable, coachName)}
      </Text>

      {/* The rows are drawn whenever there are any, including under 'partial':
          notes that came back are real notes and withholding them would hide
          advice the member has been given. It is the SENTENCE above that
          declines to say how many there are. */}
      {notes.map((n, i) => {
        const stamp = adviceStampLine(writtenOn(n.at));
        return (
          <View key={n.id} style={{
            paddingVertical: sp.md,
            borderTopWidth: i > 0 ? 1 : 0,
            borderTopColor: t.ring,
          }}>
            {stamp ? (
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>{stamp}</Text>
            ) : null}
            {/* Not clipped. The four-line cap on the dashboard is what a
                dashboard is for; this screen exists so the whole note can be
                read, and a coaching cue truncated mid-sentence is the half of
                it that changes what somebody does under a bar.

                `grown`, never a pinned lineHeight: a paragraph of somebody
                else's writing is the longest run of text here and so the first
                thing to overlap itself at a large text size. */}
            <Text style={{ ...ty.body, color: t.ink2, lineHeight: grown(22) }}>{n.body}</Text>
          </View>
        );
      })}
    </Section>
  );
}
