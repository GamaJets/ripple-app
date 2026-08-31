// Client · Compare — two progress photos side by side, with the body-composition
// readings recorded on the two days they were taken.
//
// ── Why this file exists at all ────────────────────────────────────────────
//
// Everything below was already written, and it lived inside an IIFE two-thirds
// of the way down app/(client)/scans.tsx, wrapped in `photos !== null &&
// photos.length > 0 && comparePair(...) !== null`. It worked. What it could not
// do was be a place:
//
//   · it could not be linked to. Nothing anywhere in three apps could send
//     somebody to a comparison — not the dashboard, not a coach message, not a
//     notification, not the Go Deeper row at the bottom of the very screen it
//     was on.
//   · it could not be returned to. Selecting a pair, scrolling away to read a
//     scan, and coming back meant scrolling back down the Progress screen and
//     hoping `cmp` had survived the re-render. Leaving the tab lost it outright.
//   · it could not be shared. The one thing a person actually wants to do with
//     a before-and-after is send it, and there was nothing to send: the panel
//     was a region of somebody else's scroll view.
//
// A route fixes all three, and the pair travels in the URL — `?before=<id>
// &after=<id>` — so the comparison IS the address. That is also why the ids
// are ids: see `selectionFromParams` in src/lib/photoCompare.ts for what
// arrives when a param names a photo that has since been deleted, and why a
// signed URL must never be one of these values.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
//
// Deleting a photo, and sending one to a coach. Both stay on the Progress
// screen's thumbnail strip, where they have always been, because both are
// irreversible-ish acts about ONE photo and this screen is about two. A "send
// to coach" button here would sit under two large pictures and be ambiguous
// about which of them it meant, which is the last thing that control should be.
//
// The share this screen does offer sends the FIGURES and says so — see
// `compareSummary`. No photograph and no URL to one leaves the device from
// here. The bucket is private and its signed URLs expire in an hour: a link in
// a message would leak an object path to everybody it was forwarded to and be
// dead before any of them tapped it, and an attached image would put a
// photograph of somebody's body in a group chat off one tap. Sending a photo is
// already a deliberate, per-photo, revocable act on the Progress screen and it
// stays one.
//
// ── The three states of the photo list ─────────────────────────────────────
//
// Not loaded, loaded and empty, loaded with photos — each renders differently,
// for the reason scans.tsx gives at length: a screen that says "no photos yet"
// while it is still asking is telling somebody their history is gone. Same for
// the share grants, which stay `null` on a failed read rather than falling to
// `[]`; `[]` would mean "your coach can see none of these", which is the one
// reassurance this screen is not allowed to invent.
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Pressable, Image, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { reportError } from '../../src/lib/reportError';
import { Rule, Section, SectionHead, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { listProgressPhotos, comparePair, missingFileCount, type ProgressPhoto } from '../../src/lib/progressPhotos';
import { fetchMyCoach, fetchMyShares, shareStateOf, shareLabel, type ShareGrant, type CoachRef } from '../../src/lib/photoShare';
import {
  compareRows, compareBasis, compareSummary, readingText, deltaText, spanLabel,
  selectionFromParams, COMPARE_DISCLAIMER,
} from '../../src/lib/photoCompare';
import { shareText } from '../../src/lib/exportShare';

/** Expo Router hands a repeated query param back as an array and a single one
 *  as a string. Neither shape is special-cased at the two call sites. */
const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default function Compare() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const params = useLocalSearchParams<{ before?: string | string[]; after?: string | string[] }>();

  // `null` is "not asked yet, or the ask failed" — never "you have none". The
  // two are rendered differently below, and `photosErr` is what tells them
  // apart.
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [photosErr, setPhotosErr] = useState<string | null>(null);
  // Stays null on a failed read. `[]` here would say "your coach can see none
  // of these", which is a reassurance this screen cannot check.
  const [shares, setShares] = useState<ShareGrant[] | null>(null);
  const [coach, setCoach] = useState<CoachRef | null>(null);
  const [sel, setSel] = useState<string[]>([]);

  const loadPhotos = useCallback(async () => {
    try {
      const list = await listProgressPhotos();
      setPhotos(list);
      setPhotosErr(null);
    } catch (e) {
      reportError('compare.photos.load', e);
      setPhotos(null);
      setPhotosErr('Could not load your photos just now.');
    }
  }, []);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, g] = await Promise.all([fetchMyCoach(), fetchMyShares()]);
        if (cancelled) return;
        setCoach(c);
        setShares(g);
      } catch (e) {
        reportError('compare.photos.shares', e);
        // Left null on purpose. Every badge below renders unknown as an
        // em-dash rather than as "only you can see this".
        if (!cancelled) setShares(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The pair named in the URL, seeded ONCE the photo list has landed.
  //
  // Once, because after that the person's taps are the truth: re-running this
  // on every param change would fight the `setParams` below, and re-running it
  // after a reload would silently put back a selection they had just cleared.
  // The ids are checked against the loaded list rather than trusted — a link
  // can name a photo that has been deleted since, and a selection holding an id
  // with no thumbnail behind it is one nobody can complete or clear.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || photos === null) return;
    seeded.current = true;
    const wanted = [one(params.before), one(params.after)].filter((x): x is string => !!x);
    if (wanted.length) setSel(selectionFromParams(wanted, photos));
  }, [photos, params.before, params.after]);

  /**
   * Tap a thumbnail. Two at a time, oldest-of-the-two treated as "before" by
   * `comparePair` rather than by the order they were tapped — so tapping the
   * newer one first still reads as a before-and-after rather than backwards.
   *
   * The URL follows the selection so the comparison can be returned to. Only
   * ids go in it, never a signed URL: those expire in an hour and would sit in
   * a navigation history long after they stopped working.
   */
  const toggle = (id: string) => {
    // `sel` is read here rather than inside a setState updater: the updater can
    // be invoked more than once for one tap, and `setParams` is navigation —
    // running it twice pushes a param change nobody made.
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : sel.length >= 2 ? [sel[1], id] : [...sel, id];
    setSel(next);
    router.setParams({ before: next[0] ?? '', after: next[1] ?? '' });
  };

  const pair = photos ? comparePair(photos, sel) : null;
  // The rows are only built when the scans are actually known. Under 'error'
  // the table is replaced by a sentence, because a table of dashes says "there
  // was no scan on those days" and that is not what a failed read means.
  const rows = pair && cd.scansStatus !== 'error' && cd.scansStatus !== 'loading'
    ? compareRows(pair.before.takenAt, pair.after.takenAt, cd.scans, wu)
    : null;
  const dayOf = (p: ProgressPhoto) => new Date(p.takenAt).toLocaleDateString();

  const sendFigures = () => {
    if (!pair || !rows) return;
    void shareText(compareSummary(dayOf(pair.before), dayOf(pair.after), pair.days, rows), 'My progress comparison');
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Progress photos</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Before &amp; After</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {photos === null ? (
          <Section>
            {photosErr ? (
              <View>
                <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                  {photosErr} Nothing has been deleted — this screen only failed to read the list, so it cannot tell you what is there.
                </Text>
                <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try Again" onPress={loadPhotos} /></View>
              </View>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3 }}>Loading your photos…</Text>
            )}
          </Section>
        ) : photos.length < 2 ? (
          <Section>
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {photos.length === 0
                ? 'No progress photos yet. Add them on the Progress tab and they will appear here to compare.'
                : 'One photo so far. A comparison needs two — add another on the Progress tab, on a different day, and this screen fills in.'}
            </Text>
            <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
              <Ghost label="Go to Progress" onPress={() => router.push('/(client)/scans')} />
            </View>
          </Section>
        ) : (
          <View>
            {/* ── the pair ─────────────────────────────────────────────── */}
            <Section>
              {!pair ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Tap two photos below to compare them. The earlier one is shown as “before” whichever order you pick them in.
                </Text>
              ) : (
                <View>
                  <View style={{ flexDirection: 'row', gap: sp.md }}>
                    {([['Before', pair.before], ['After', pair.after]] as [string, ProgressPhoto][]).map(([label, ph]) => (
                      <View key={label} style={{ flex: 1 }}>
                        {ph.url ? (
                          <Image source={{ uri: ph.url }} accessible accessibilityLabel={`${label} photo, ${dayOf(ph)}`}
                            style={{ width: '100%', height: 260, borderRadius: radius.md, backgroundColor: t.surface2 }} />
                        ) : (
                          // The row is here and the file is not. A gap, not a
                          // blank frame that reads as a photo still loading.
                          <View style={{ width: '100%', height: 260, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.md }}>
                            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Picture unavailable</Text>
                          </View>
                        )}
                        <Text style={{ ...ty.label, fontWeight: '500', color: t.ink, marginTop: 6 }}>{label}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3 }}>{dayOf(ph)}</Text>
                        {/* "Can my coach see this one?" answered on the picture
                            itself, including the honest non-answer when the
                            grants could not be read. */}
                        <Text style={{ ...ty.caption, fontWeight: '500', color: shareStateOf(ph.id, shares) === 'sent' ? t.brand : t.ink3 }}>
                          {shareLabel(shareStateOf(ph.id, shares))}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>{spanLabel(pair.days)}</Text>

                  {/* ── the readings from those two days ──────────────────
                      The InBody scan recorded on each photo's own calendar
                      day and nothing else. src/lib/photoCompare.ts sets out
                      why it is not the photo row's own weight_kg column
                      (always null) and why "same day" is not a string slice.

                      The Change column is the difference between two SCANS
                      that both exist. Nothing here is read off the pictures,
                      and COMPARE_DISCLAIMER says so underneath. */}
                  {cd.scansStatus === 'error' ? (
                    // Not a table of dashes. A dash means "no scan that day",
                    // and saying that when the app merely failed to read the
                    // list would be inventing the tidier answer.
                    <Flag tone={t.warn} style={{ marginTop: sp.lg }}>
                      Your scans could not be read just now, so no figures are shown beside these photos. The photos and their dates above are unaffected.
                    </Flag>
                  ) : cd.scansStatus === 'loading' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>Reading the scans from those days…</Text>
                  ) : rows ? (
                    <View style={{ marginTop: sp.lg }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingBottom: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3, flex: 1.3 }}>Reading</Text>
                        <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'right' }}>Before</Text>
                        <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'right' }}>After</Text>
                        <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'right' }}>Change</Text>
                      </View>
                      {rows.map((r) => (
                        <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                          <Text style={{ ...ty.label, color: t.ink2, flex: 1.3 }}>{r.label}</Text>
                          {/* An unmeasured cell is t.ink3 as well as an
                              em-dash: it must not sit in the same weight as a
                              figure somebody actually recorded. */}
                          <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: r.before === null ? t.ink3 : t.ink, flex: 1, textAlign: 'right' }}>{readingText(r.before, r.unit)}</Text>
                          <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: r.after === null ? t.ink3 : t.ink, flex: 1, textAlign: 'right' }}>{readingText(r.after, r.unit)}</Text>
                          <Text style={{ ...ty.label, ...numeric, color: r.delta === null ? t.ink3 : t.ink2, flex: 1, textAlign: 'right' }}>{deltaText(r.delta, r.unit)}</Text>
                        </View>
                      ))}
                      {/* Which days were scanned, named. A blank column with no
                          sentence beside it reads as a failure of the app
                          rather than as a day off the machine. */}
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{compareBasis(rows)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{COMPARE_DISCLAIMER}</Text>

                      {/* The figures may be sent. The pictures may not, and the
                          button says which it is before it is pressed rather
                          than leaving somebody to find out from whoever
                          received it. */}
                      <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
                        <Ghost icon="share" label="Share These Figures" onPress={sendFigures} />
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                        Sends the dates and the readings above as text. The photos are not attached — they stay private to your account
                        {coach ? `, and sending one to ${coach.name || 'your coach'} is a separate choice you make per photo on the Progress tab.` : '.'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </Section>

            <Rule />

            {/* ── the strip you pick from ──────────────────────────────── */}
            <Section>
              <SectionHead title="Your Photos" note={`${photos.length} saved`} />
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                Oldest first. Tap two to compare; tap a selected one again to drop it. To send a photo to your coach, or delete one, press and hold it on the Progress tab.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.md }}>
                {photos.map((p) => {
                  const selIdx = sel.indexOf(p.id);
                  const shState = shareStateOf(p.id, shares);
                  return (
                    <Pressable key={p.id} onPress={() => toggle(p.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selIdx >= 0 }}
                      accessibilityLabel={`Progress photo from ${dayOf(p)} · ${shState === 'sent' ? 'sent to your coach' : shState === 'private' ? 'only you can see it' : 'not known whether your coach can see it'}`}
                      accessibilityHint="Tap to add it to the comparison above">
                      <View style={{ borderRadius: radius.md, borderWidth: selIdx >= 0 ? 2 : 0, borderColor: t.brand, overflow: 'hidden' }}>
                        {p.url ? (
                          <Image source={{ uri: p.url }} style={{ width: 110, height: 150, backgroundColor: t.surface2 }} />
                        ) : (
                          <View style={{ width: 110, height: 150, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.sm }}>
                            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Picture{'\n'}unavailable</Text>
                          </View>
                        )}
                        {selIdx >= 0 ? (
                          <View style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>{selIdx + 1}</Text>
                          </View>
                        ) : null}
                        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                          <Text style={{ ...ty.caption, fontWeight: '500', textAlign: 'center', color: shState === 'sent' ? t.brand : '#fff' }}>{shareLabel(shState)}</Text>
                        </View>
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, textAlign: 'center' }}>{dayOf(p)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {(missingFileCount(photos) ?? 0) > 0 ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                  {missingFileCount(photos) === 1 ? 'One of these has no picture behind it any more.' : `${missingFileCount(photos)} of these have no picture behind them any more.`} Press and hold it on the Progress tab to clear it.
                </Flag>
              ) : null}
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
