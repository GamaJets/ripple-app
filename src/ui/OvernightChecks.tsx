// The section that says what the overnight passes did — and, at greater length,
// what nobody can say about them.
//
// Five pg_cron jobs run against a coach's book every night and write into their
// inbox: quiet clients, expiring credentials, ended blocks, expired session
// packs, ageing invoices. The coach has never been told any of it happened. The
// argument for showing it, and the account of the day and night when all five
// failed on every run with nothing anywhere to say so, is in the header of
// src/lib/nightlyPasses.ts.
//
// ── Why this is a component and not a screen ──────────────────────────────
//
// Because the honest amount of content is a dozen lines and the honest place
// for it is beside the one pass a coach already reacts to. Quiet Clients is
// where `run_overdue_client_notices` sends them (`route: '/(trainer)/nudges'`),
// so a coach reading "nobody is drifting" is exactly the person who needs to
// know whether the check that decides that ran at all.
//
// ── It is folded, and it opens on its own when something is wrong ─────────
//
// Shut by default: five lines saying a check happened is noise on a screen
// whose job is to be short. It opens itself when the read did not come back
// whole, because that is the state a coach must not be able to scroll past —
// and the control is named in both directions so a screen reader hears which
// one it is about to do.
import { useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, Ghost, Notice } from './kit';
import { sp, hairline, type as ty } from '../theme/scale';
import { fmtRelativeDay } from '../lib/format';
import { isWhole } from './loadStatus';
import { useNightlyPasses } from './nightlyPasses';
import {
  NIGHTLY_PASSES, tallyPasses, passCountLine, handedLine,
  SILENCE_IS_NOT_PROOF, HANDED_NOT_ARRIVED,
} from '../lib/nightlyPasses';

export function OvernightChecks() {
  const t = useTheme();
  const read = useNightlyPasses();
  const [open, setOpen] = useState(false);

  // `isWhole`, not `!== 'error'`. A truncated page of notifications is a page
  // of real rows and a PREFIX of the week, so every count over it is a floor —
  // `passCountLine` is handed this and says "at least" rather than printing a
  // subtotal in the shape of a total.
  const whole = isWhole(read.status);
  const tallies = tallyPasses(read.rows);
  // Opened for the reader when the answer is untrustworthy. A coach may close a
  // quiet week; they may not be allowed to never see that the week could not be
  // read.
  const shown = open || read.status === 'error' || read.status === 'partial';

  return (
    <Section>
      <SectionHead title="Overnight Checks" />
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
        Five checks run against your book every night and write into your inbox. Nothing is sent to
        your clients by any of them.
      </Text>

      {read.status === 'loading' ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>Reading what they wrote…</Text>
      ) : (
        <>
          {read.status === 'error' ? (
            <Notice tone={t.warn} kicker="Overnight Checks" title="Your inbox could not be read"
              note="Nothing is listed below because the read did not come back. That is not a quiet week — it is an unanswered question, and the checks themselves are not what failed here." />
          ) : null}
          {read.status === 'partial' ? (
            <Notice tone={t.warn} kicker="Overnight Checks" title="This is part of the week"
              note="Your inbox came back at its row limit, so the figures below are floors rather than counts — there were at least this many, and there may have been more." />
          ) : null}

          {shown ? (
            <View>
              {NIGHTLY_PASSES.map((p, i) => {
                const tally = tallies[i];
                const handed = handedLine(tally);
                return (
                  <View key={p.key}
                    style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                      <Text style={{ ...ty.head, color: t.ink, flex: 1 }}>{p.title}</Text>
                      {/* The date on its own, as a slot rather than inside a
                          sentence: `fmtRelativeDay` answers with a dash when it
                          cannot read the timestamp, and a dash is an answer in a
                          slot and a hole in a sentence. */}
                      {tally.latestAt ? (
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{fmtRelativeDay(tally.latestAt)}</Text>
                      ) : null}
                    </View>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{p.what}</Text>
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
                      {passCountLine(tally, whole)}
                    </Text>
                    {handed ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{handed}</Text>
                    ) : null}
                    {/* The one pass that is not only a notice. Said on the row
                        and not in a footnote: a night pack-expiry does not run
                        leaves paid-for sessions bookable on a pack that has
                        expired, which is a write the product depends on rather
                        than a message somebody missed. */}
                    {p.alsoDoes ? (
                      <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{p.alsoDoes}</Text>
                    ) : null}
                  </View>
                );
              })}

              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.lg }}>{SILENCE_IS_NOT_PROOF}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{HANDED_NOT_ARRIVED}</Text>
            </View>
          ) : null}

          {/* Withheld while the read is untrustworthy, because the section is
              forced open in that state and the control could not shut it — a
              control that does nothing is worse than one that is not there. */}
          {read.status === 'ready' ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost label={open ? 'Hide The Overnight Checks' : 'Show What Ran Overnight'}
                onPress={() => setOpen((v) => !v)} />
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}
