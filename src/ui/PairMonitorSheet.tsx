// Pair a heart-rate monitor from inside the session that is running.
//
// ── the note that asked for this ──────────────────────────────────────────
//
// `ZonePanel` in app/(client)/workouts.tsx:
//
//     Deliberately not a link to the settings: leaving mid-session to go and
//     pair a device would abandon the workout being logged.
//
// True, and it left the member with two options — lose the session, or finish
// without heart rate. This is the third: a sheet OVER the runner. Nothing
// unmounts, `rememberSession` is untouched, the elapsed clock is wall-clock and
// keeps running, and the offline queue never hears about it. The precedent is
// the exercise-swap sheet a few hundred lines down the same file, which is a
// transparent Modal inside the runner for the same reason.
//
// The rules, the sentences and the refusal to read a resolved promise as a
// success live in src/lib/sessionPairing.ts, under plain node.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { Icon } from './Icon';
import { Flag, Scrim } from './kit';
import { useWearables } from './wearables';
import { PROVIDERS } from '../lib/wearables/registry';
import type { ProviderId } from '../lib/wearables/types';
import type { WatchReach } from '../lib/watchReach';
import { sp, radius, layout, hairline, elevation, type as ty } from '../theme/scale';
import type { Theme } from '../theme/tokens';
import {
  pairRows, pairOutcome, pairResultNote, MID_SESSION_GAP_NOTE,
  type PairOutcome, type PairRow,
} from '../lib/sessionPairing';

/**
 * The sources a running session could pair with, here, now.
 *
 * A hook rather than a constant because `isAvailable()` is a question about the
 * binary AND the handset, and because the connection states move while the
 * sheet is open. Shared with `ZonePanel`, which needs only to know whether the
 * list has anything in it: an offer to pair that opens onto nothing is worse
 * than the settings sentence it replaces.
 */
export function usePairRows(): PairRow[] {
  const w = useWearables();
  return useMemo(
    () => pairRows(
      PROVIDERS.map((p) => ({
        id: p.meta.id,
        name: p.meta.name,
        kind: p.meta.kind,
        // Asked of the provider every time rather than cached: a build without
        // the native module and a phone that has it are different answers, and
        // this is the screen where getting it wrong costs the session.
        available: p.isAvailable(),
        unavailableReason: p.unavailableReason(),
      })),
      w.states,
    ),
    [w.states],
  );
}

export function PairMonitorSheet({ t, visible, onClose, reach, hasSample, onPaired }: {
  t: Theme;
  visible: boolean;
  onClose: () => void;
  /** What the session already knows about getting a reading. Only used to word
   *  the heading — a member who has paired and is getting nothing is here for
   *  the permission, not for the pairing. */
  reach: WatchReach;
  /** Whether a sample has arrived in this session. Decides which half of the
   *  success sentence is true. */
  hasSample: boolean;
  /** Called once a source really is connected, so the runner can rebuild its
   *  zones from whatever the watch has for the window so far. */
  onPaired?: () => void;
}) {
  const w = useWearables();
  // The attempt, and whether the `connect()` call has come back. Both halves
  // matter: the outcome is read from the provider's STATE, and that state is
  // only settled once the promise has resolved — see `pairOutcome`.
  const [attempt, setAttempt] = useState<{ id: ProviderId; settled: boolean } | null>(null);
  const [outcome, setOutcome] = useState<PairOutcome | null>(null);

  const rows = usePairRows();

  // Settle the outcome from the state the provider left behind, not from the
  // call returning. `connect()` resolves `void` and marks the provider 'error'
  // on failure, so an awaited call that came back is not evidence of anything.
  useEffect(() => {
    if (!attempt || !attempt.settled) return;
    const settled = pairOutcome(w.states[attempt.id]);
    setOutcome(settled);
    if (settled === 'connected') onPaired?.();
    // `onPaired` is deliberately out of the dependency list: it is a fresh
    // closure on every render of the runner, and including it would re-run this
    // effect — and re-announce a pairing — on every tick of the session clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, w.states]);

  // A fresh sheet asks a fresh question. Without this, re-opening it after a
  // refusal shows the refusal again over a state that may since have changed.
  useEffect(() => {
    if (!visible) { setAttempt(null); setOutcome(null); }
  }, [visible]);

  const start = async (id: ProviderId) => {
    setOutcome(null);
    setAttempt({ id, settled: false });
    try {
      await w.connect(id);
    } catch {
      // Swallowed on purpose. The provider's own state is the witness and the
      // effect above reads it; a thrown error and a quiet 'error' state are the
      // same outcome to the member and must not be two different sentences.
    }
    setAttempt((a) => (a && a.id === id ? { id, settled: true } : a));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Scrim onPress={onClose} label="Close and carry on with your session" />
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: layout.gutter, paddingBottom: 34, ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingEnd: sp.sm }}>
            <Text style={{ ...ty.head, color: t.ink }}>
              {reach === 'none' ? 'Pair a Heart-Rate Monitor' : 'Check Your Heart-Rate Monitor'}
            </Text>
            {/* The first thing said, because it is the fear that kept this
                sheet from existing: the member is in the middle of a workout
                and is being asked to touch a settings control. */}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
              Your session keeps running. Nothing here can lose a set. Your sets, your clock and your time in each zone all stay where they are.
            </Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close and carry on with your session" hitSlop={8}>
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Close</Text>
          </Pressable>
        </View>

        <ScrollView style={{ marginTop: sp.lg, maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          {rows.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: hairline, borderColor: t.ring }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.name}</Text>
                {/* The provider's own reason, where there is one. "Unavailable"
                    on its own reads as an outage; the reason says whether it is
                    this phone, this build, or something the member can fix. */}
                {!r.available && r.unavailableReason ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.unavailableReason}</Text>
                ) : null}
                {/* A mark in the status colour, the words in ink. crit as text
                    clears 3:1 and not the 4.5:1 a sentence needs, and colour is
                    never the only channel — the sentence says it too. */}
                {r.state === 'error' ? (
                  <Flag style={{ marginTop: 3 }}>That did not connect. Nothing was changed, and your session is untouched.</Flag>
                ) : null}
              </View>
              <Pressable
                onPress={() => { void start(r.id as ProviderId); }}
                disabled={!r.actionable}
                accessibilityRole="button"
                accessibilityState={{ disabled: !r.actionable }}
                accessibilityLabel={r.action + ' ' + r.name + ', without leaving your session'}
                hitSlop={8}
                style={{ backgroundColor: r.actionable ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 10, opacity: r.actionable ? 1 : 0.7 }}
              >
                <Text style={{ ...ty.label, fontWeight: '600', color: r.actionable ? t.brandInk : t.ink3 }}>{r.action}</Text>
              </Pressable>
            </View>
          ))}
          {rows.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              Nothing on this phone can stream a live heart rate into a session. A ring or a band that syncs once a day cannot: it reports the day, not the minute.
            </Text>
          ) : null}
        </ScrollView>

        {outcome ? (
          <View style={{ flexDirection: 'row', gap: 7, marginTop: sp.lg }}>
            <Icon name={outcome === 'connected' ? 'check' : 'info'} size={14} color={outcome === 'connected' ? t.good : t.warn} />
            <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{pairResultNote(outcome, hasSample)}</Text>
          </View>
        ) : (
          // Said BEFORE the tap, not after it. A member deciding whether to
          // pair now needs to know that pairing now does not retrofit the last
          // twenty minutes — otherwise the zone board they see at the finish is
          // a smaller session than the one they trained.
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{MID_SESSION_GAP_NOTE}</Text>
        )}
      </View>
    </Modal>
  );
}
