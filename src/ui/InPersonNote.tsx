// What an in-person screen says to a coach who works online.
//
// ── the gap this closes ───────────────────────────────────────────────────
//
// src/lib/coachDelivery.ts works out whether this coach's book is entirely
// remote, and four screens act on it: the dashboard drops its in-person tools
// below the rest, analytics leads with the figure that describes the coach's
// actual business, the setup checklist stops asking for published hours nobody
// can book, and the join-code screen changes the sentence about what a new
// client does next.
//
// The screens that are in-person BY NATURE said nothing. Mark What Happened,
// Classes, My Register and Client Attendance are each about an hour somebody
// stood in a room for, and a coach who works online opens one, finds it empty,
// and has no way to tell "this is not for how I work" from "this is broken" or
// "I have forgotten to do something". Every one of those screens has a careful
// sentence for a read that failed and none for a screen that was never theirs.
//
// ── what this is allowed to say, and what it must not ─────────────────────
//
// It explains; it never hides. `HIDDEN_NOT_GONE` is appended verbatim because
// the promise the whole feature rests on is that nothing is removed — the
// screen is still in the app, still in search, and a coach who takes one
// in-person client tomorrow finds everything where it was.
//
// It is drawn ONLY on `shape === 'remote'`, which src/lib/coachDelivery.ts
// reaches only when the coach said "online", the roster came back WHOLE, and
// nobody on it trains in person. Every unknown — an unread roster, an
// unanswered question, a declaration that did not load — widens to in-person
// and draws nothing here. A screen that told a coach "this is not for you"
// because a read failed for thirty seconds would be the exact defect this
// codebase fights, pointed at the coach's own livelihood.
//
// `deliveryNote` supplies the reason in the coach's own terms, so this never
// invents a second wording for a fact that already has one.
import { View } from 'react-native';
import { useTheme } from './components';
import { Notice } from './kit';
import { sp } from '../theme/scale';
import { useDeliveryFact } from './coachDelivery';
import { deliveryNote, HIDDEN_NOT_GONE } from '../lib/coachDelivery';

export function InPersonNote({ what }: {
  /**
   * What this screen is for, as a Title Case noun phrase that completes
   * "… Is for Training in the Room". Title Case because it lands in a Notice
   * TITLE, and every title in these apps is Title Case.
   */
  what: string;
}) {
  const t = useTheme();
  const delivery = useDeliveryFact();
  if (delivery.shape !== 'remote') return null;
  return (
    <View style={{ marginTop: sp.md }}>
      {/* `ink3` and not a status tone: nothing is wrong, nothing needs doing,
          and an amber or red mark on a screen that is merely not yours is the
          app raising an alarm about how somebody has chosen to work. */}
      <Notice tone={t.ink3} kicker="How You Coach"
        title={`${what} Is for Training in the Room`}
        note={`${deliveryNote(delivery)} ${HIDDEN_NOT_GONE}`} />
    </View>
  );
}
