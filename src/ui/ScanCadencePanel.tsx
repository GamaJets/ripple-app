// How often a body is actually being measured, drawn.
//
// The rule is src/lib/scanCadence.ts and it is pure and tested; this file puts
// it on a screen. It lives in src/ui rather than inside one screen because the
// question is identical for a coach reading a client's record and a coach
// reading their own, and two copies of it would be two chances to disagree
// about what "not since March" means.
//
// ── the four answers this has to keep apart ───────────────────────────────
//
// A read that FAILED, a read that came back TRUNCATED, a client who has never
// been scanned, and a real record. Collapsing any two of them tells a coach
// something false about a person they are about to ring, which is the rule
// app/(trainer)/client-body.tsx states at length and the reason `status`
// arrives here rather than an already-emptied array.
//
// A truncated read is the interesting one. It can still answer HOW LONG IT HAS
// BEEN — the cut falls at the old end, so the newest scan survives it — and it
// cannot answer how often, because every missing row would change the count and
// the median. So the panel shows the one and refuses the other, in that order,
// rather than going dark on both.
//
// ── the month strip ───────────────────────────────────────────────────────
//
// Bars, not a sparkline. The figure being drawn is a COUNT of scans in a
// calendar month and it is nearly always 0, 1 or 2; a line through those
// invents slopes between months where nothing happened. The empty months are
// the whole point of the picture — three bars in January and a flat run to
// September is the sentence the item asks for, drawn.
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { sp, radius, type as ty } from '../theme/scale';
import { isWhole, type LoadStatus } from './loadStatus';
import {
  scanRhythm, sinceLastScan, unreadableScanDays, rhythmLine, stoppedNote,
} from '../lib/scanCadence';

/** How tall the tallest bar is drawn. Small: this is a texture a coach reads in
 *  one look, not a chart they interrogate. */
const BAR_MAX = 34;

/** The month letter under a bar. Built from the 'YYYY-MM' key with a local
 *  midday Date so no timezone can roll it into the month before — the bug
 *  src/lib/localDate.ts exists for, in its smallest form. */
function monthTick(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return '';
  return new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: 'narrow' });
}

/** The spoken form of one bar, so the strip is readable without seeing it. A
 *  month with no scans says so in words: a screen reader given nothing for an
 *  empty bar hears a shorter year rather than a quiet one. */
function monthSpoken(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const name = Number.isFinite(y) && Number.isFinite(m)
    ? new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : key;
  if (n === 0) return `${name}, none`;
  return n === 1 ? `${name}, one scan` : `${name}, ${n} scans`;
}

/**
 * @param days   every `scans.taken_at` on the record, in any order. Bare days
 *               or instants; unreadable values are counted, never dropped
 *               silently.
 * @param status the read's own status. `isWhole` gates every count.
 * @param today  a bare local day from the caller, never `new Date()` here — a
 *               component that reads the clock cannot be shown a March.
 * @param subject how to name the record's owner in the sentences: 'you' for a
 *               coach's own screen, a first name for a client's. Carried as a
 *               word rather than as finished sentences so the verbs agree.
 */
export function ScanCadencePanel({ days, status, today, subject }: {
  days: readonly (string | null | undefined)[];
  status: LoadStatus;
  today: string;
  subject: { they: string; have: string };
}) {
  const t = useTheme();
  const whole = isWhole(status);
  const rhythm = scanRhythm(days, whole, today);
  const since = sinceLastScan(days, today);
  const unreadable = unreadableScanDays(days);
  const stopped = stoppedNote(rhythm, since);

  // A failed read says nothing about the person. This is the one branch that
  // must never mention how often anybody is scanned, because the honest answer
  // is that this screen does not know.
  if (status === 'error') {
    return (
      <Text style={{ ...ty.body, color: t.ink3 }}>
        How often {subject.they} {subject.have} been measured cannot be worked out, because the scans
        could not be read. That is this connection, not {subject.they === 'you' ? 'your' : 'their'} record.
      </Text>
    );
  }
  if (status === 'loading') {
    return <Text style={{ ...ty.body, color: t.ink3 }}>Reading the scan history…</Text>;
  }

  const sinceLine = since
    ? (since.days === 0
      ? 'Measured today.'
      : since.days === 1
        ? 'Last measured yesterday.'
        : `Last measured ${since.days} days ago.`)
    : null;

  return (
    <View>
      {sinceLine ? (
        <Text style={{ ...ty.body, color: t.ink2 }}>{sinceLine}</Text>
      ) : (
        // No readable date anywhere. Under 'ready' that genuinely means nobody
        // has been measured; the caller's own empty state covers the wording
        // for a record with no scans at all, so this only has to not lie.
        <Text style={{ ...ty.body, color: t.ink3 }}>
          Nothing on the record carries a date this screen can place.
        </Text>
      )}

      {rhythmLine(rhythm) ? (
        <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{rhythmLine(rhythm)}</Text>
      ) : whole ? (
        // Whole read, no rhythm: there are fewer than two scans. Said as what
        // it is — one reading is a reading — rather than as a cadence of zero.
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
          There is not enough on the record to say how often — a cadence needs at least two
          measurements to sit between.
        </Text>
      ) : (
        // Truncated. The count, the span and the median are all computed over
        // the whole set and the missing rows are exactly the ones that would
        // change them, so none of them is offered. "Last measured" above is
        // still true, because the cut falls at the old end.
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
          Only part of the scan history came back, so how often cannot be counted from it. The date
          above is still the newest one — it is the oldest scans that are missing, not the recent ones.
        </Text>
      )}

      {rhythm && rhythm.months.length ? (
        <View style={{ marginTop: sp.md }}>
          <View
            accessible
            accessibilityLabel={`Scans by month. ${rhythm.months.map((m) => monthSpoken(m.key, m.n)).join('. ')}.`}
            style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: BAR_MAX + 4 }}
          >
            {rhythm.months.map((m) => {
              const tallest = Math.max(1, ...rhythm.months.map((x) => x.n));
              return (
                <View key={m.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                  {/* A month with no scan still draws a 2pt stub on the surface
                      colour. A zero drawn as nothing is indistinguishable from
                      a month that is not in the window at all, and the gaps are
                      the thing this strip exists to show. */}
                  <View style={{
                    width: '100%',
                    height: m.n ? Math.max(4, Math.round((m.n / tallest) * BAR_MAX)) : 2,
                    borderRadius: radius.sm,
                    backgroundColor: m.n ? t.brand : t.surface2,
                  }} />
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
            {rhythm.months.map((m) => (
              <Text
                key={m.key}
                // The strip above already speaks every month and its count, so
                // these ticks are decoration for that reader and would only
                // repeat it letter by letter.
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ ...ty.caption, color: t.ink3, flex: 1, textAlign: 'center' }}
              >
                {monthTick(m.key)}
              </Text>
            ))}
          </View>
          {rhythm.beforeStrip ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
              {rhythm.beforeStrip === 1
                ? 'One more scan sits before this window.'
                : `${rhythm.beforeStrip} more scans sit before this window.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {stopped ? (
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{stopped}</Text>
      ) : null}

      {unreadable ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          {unreadable === 1
            ? 'One scan carries a date this screen could not read, so it is not counted above.'
            : `${unreadable} scans carry dates this screen could not read, so they are not counted above.`}
        </Text>
      ) : null}
    </View>
  );
}
