// The three options, asked once and changeable for ever, in one component.
//
// ── Why this is a component and not two screens ───────────────────────────
//
// It is offered in two places — the coach's Getting Started list, which is
// where it is first asked, and their Profile, which is where it is changed
// later. The words, the order and the sentence under each option have to be
// identical in both, because a coach who reads one description at signup and a
// different one six months on has been told two things about the same switch.
//
// It is deliberately NOT a fourth onboarding surface. There are already three
// things in this app that explain it — the Getting Started checklist, the
// derived first-run tour (src/lib/guide.ts), and the per-screen help rows
// (src/lib/screenHelp.ts) — and guide.ts's own header is the account of what a
// fourth hand-maintained explanation costs: it is the one nobody re-reads, and
// it went stale telling coaches they had five tabs while the bar had six. This
// is a control with a line of copy on it, sitting inside a surface that already
// exists.
//
// ── What it must never do ─────────────────────────────────────────────────
//
// Claim a choice that did not save. `setDelivery` awaits the server and answers
// true or false; on false the selection does not move and the coach is told,
// because a setting that reshapes the app and silently did not take is worse
// than one that visibly refused.
//
// And it must never tick an option because a read failed. Under anything but a
// whole read `deliveryStatusLine` says the read failed rather than "not
// answered", and no row is marked as chosen.
import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Flag } from './kit';
import { sp, radius, hairline, type as ty } from '../theme/scale';
import { isWhole } from './loadStatus';
import { useCoachDelivery } from './coachDelivery';
import {
  DELIVERY_OPTIONS, DELIVERY_LABEL, DELIVERY_NOTE, deliveryStatusLine,
} from '../lib/coachDelivery';
import type { CoachedMode } from '../lib/types';
import { useReachability } from './reachability';
import { retryLine } from '../lib/reachability';

/**
 * Three rows, the current answer ticked, and one line saying what it set up.
 *
 * `onPicked` fires only on a write the server took, so a caller can refresh
 * whatever it draws from the answer without having to guess whether it landed.
 */
export function DeliveryModeChoice({ onPicked }: { onPicked?: (mode: CoachedMode) => void }) {
  const t = useTheme();
  const { declared, status, setDelivery } = useCoachDelivery();
  const [busy, setBusy] = useState<CoachedMode | null>(null);
  const [failed, setFailed] = useState(false);
  const reach = useReachability();
  // A null under a read that did not come back whole is NOT an answer, so
  // nothing is ticked. See the header.
  const chosen = isWhole(status) ? declared : null;

  const pick = async (mode: CoachedMode) => {
    if (busy) return;
    setBusy(mode); setFailed(false);
    const saved = await setDelivery(mode);
    setBusy(null);
    if (saved) onPicked?.(mode);
    else setFailed(true);
  };

  return (
    <View>
      {DELIVERY_OPTIONS.map((m, i) => {
        const on = chosen === m;
        return (
          <Pressable
            key={m}
            onPress={() => void pick(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: busy != null }}
            accessibilityLabel={`${DELIVERY_LABEL[m]}. ${DELIVERY_NOTE[m]}`}
            style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: sp.md,
              paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              opacity: busy != null && busy !== m ? 0.5 : 1,
            }}
          >
            <View style={{
              width: 24, height: 24, borderRadius: radius.pill,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? t.brand : 'transparent',
              borderWidth: on ? 0 : hairline, borderColor: t.ring, marginTop: 2,
            }}>
              {busy === m ? <ActivityIndicator size="small" color={t.ink3} />
                : on ? <Icon name="check" size={13} color={t.brandInk} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{DELIVERY_LABEL[m]}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{DELIVERY_NOTE[m]}</Text>
            </View>
          </Pressable>
        );
      })}

      {/* What the answer DID, in the past tense, or the honest alternative
          when there is no answer or the read failed. One line, on the control,
          which is the whole of "say what changes when they pick". */}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
        {deliveryStatusLine(declared, status)}
      </Text>

      {/* crit as text measures under 4.5:1 on several palettes, so the failure
          goes in a 6pt dot beside ink2 rather than in the words.

          The second half of the sentence used to be "Check your connection and
          tap it again" whatever had happened. `setDelivery` awaits the server,
          so half of what lands here is the server having READ the choice and
          refused it — a policy, a role, a row that is not this coach's — and
          sending them to their wifi settings over that hides the answer and
          has them tapping a control that will refuse identically every time.
          `retryLine` says which; see src/lib/reachability.ts. */}
      {failed ? (
        <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
          That did not save, so nothing has changed. {retryLine(reach)}
        </Flag>
      ) : null}
    </View>
  );
}
