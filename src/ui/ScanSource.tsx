// The mark that says how a body reading was taken, and the sentence behind it.
//
// One component in src/ui rather than a block of JSX on one screen, because
// three screens show body figures off `scans` — app/(trainer)/my-progress.tsx
// (the coach's own), app/(trainer)/client-body.tsx (a client's), and
// app/(client)/scans.tsx (the member's own) — and a coach and a client
// disagreeing about what "InBody (manual)" means would be worse than neither of
// them being told. The rule itself is in src/lib/scanProvenance.ts and is pure
// and tested; this file is a chip and a line of text.
//
// ── why the chip is not coloured ──────────────────────────────────────────
//
// A typed figure is not a warning. It is frequently the only reading a client
// has, it is what their own app is showing them, and a red mark beside it would
// tell a coach the record is faulty when what it actually says is that nobody
// owns an InBody. The chip is the same quiet surface whatever the source; the
// evidence is in the WORDS, which is where a distinction a coach has to think
// about belongs.
//
// It is also why nothing here is `t.warn` or `t.crit` as text ink — those fail
// the contrast gate as text everywhere (see Flag in src/ui/kit.tsx) and this
// file has no cause to reach for them in the first place.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { sp, radius, type as ty } from '../theme/scale';
import { readSource, sourceChip, evidenceNote, type ScanSource } from '../lib/scanProvenance';

/**
 * The short mark that sits beside a figure: what the record says produced it.
 *
 * `source` is `scans.source` exactly as stored — free text, frequently null.
 * A null column renders as "Source not recorded" rather than as nothing at all:
 * a missing chip is indistinguishable from a screen that has not been updated
 * to show chips, and the whole point is that the coach can rely on the mark
 * being there.
 */
export function SourceChip({ source }: { source: string | null | undefined }) {
  const t = useTheme();
  const s = readSource(source);
  return (
    <View style={{
      alignSelf: 'flex-start', backgroundColor: t.surface2,
      paddingHorizontal: sp.sm, paddingVertical: 2, borderRadius: radius.pill,
    }}>
      {/* No accessibilityLabel and no `accessible` wrapper: this is a plain
          Text with no gesture on it, so a screen reader already reads it, and
          wrapping it would only add a second stop saying the same words. */}
      <Text style={{ ...ty.caption, color: t.ink2 }}>{sourceChip(s)}</Text>
    </View>
  );
}

/**
 * The chip with its sentence under it, for the one place on a screen where the
 * distinction is being explained rather than merely marked.
 *
 * Not on every row. A sentence repeated beside nine readings is a sentence
 * nobody reads by the third one; the rows carry chips and the explanation is
 * said once, about the newest reading, where a coach is actually looking.
 */
export function SourceLine({ source }: { source: string | null | undefined }) {
  const t = useTheme();
  const s: ScanSource = readSource(source);
  return (
    <View style={{ marginTop: sp.sm }}>
      <SourceChip source={source} />
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{evidenceNote(s)}</Text>
    </View>
  );
}

/**
 * The caveat over a series whose readings did not all arrive the same way, or
 * nothing at all when they did.
 *
 * `note` is `mixedSourcesNote` / `changeAcrossSources` from the rule module —
 * passed in rather than computed here so that a screen which has already
 * decided a change is unsafe to caption can say so with the same component.
 */
export function SourceCaveat({ note }: { note: string | null }) {
  const t = useTheme();
  if (!note) return null;
  return (
    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{note}</Text>
  );
}
