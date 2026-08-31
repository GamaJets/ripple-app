// Owner feedback inbox — every tester's in-app feedback, newest first.
//
// Every row here is a real `feedback` row and every error a real `app_errors`
// row; there is no sample data behind this screen.
//
// An empty inbox is a true empty inbox, and a *failed* read now says so rather
// than borrowing the empty state's words. "No feedback yet" is a specific claim
// about the testers, and it must not be what a refused query looks like.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): the two bordered KPI boxes collapsed into the screen's
// one hero figure, each feedback card became a hairline-separated row, and the
// category no longer tints the *text* — a coloured dot sits beside ink-coloured
// text instead, so Bug/Confusing stay readable at any contrast.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Ghost, PartialRead } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import { fetchAllFeedbackPage, fetchAppErrors, type FeedbackRow, type AppErrorRow } from '../../src/ui/appFeedback';
import { SkeletonList } from '../../src/ui/Skeleton';
import { reportError } from '../../src/lib/reportError';

const CAT_COLOR = (t: any, c: string | null) => c === 'Bug' ? t.crit : c === 'Praise' ? t.brand : c === 'Confusing' ? t.warn : t.ink3;

export default function OwnerFeedback() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<AppErrorRow[]>([]);
  const [showErr, setShowErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The inbox could not be read. Distinct from it being empty. */
  const [unread, setUnread] = useState(false);
  /**
   * The read stopped at the row cap, so these are the newest N submissions and
   * not the inbox.
   *
   * `fetchAllFeedbackPage` has reported this since it was written, and the note
   * on it names this screen: "the screens above it count the rows and average
   * the ratings, which is exactly what a truncated read must not be used for".
   * This screen was calling the wrapper that throws the flag away, so under a
   * cap it printed a hero of "4.6 / 5" over "1,000 submissions" — a rating over
   * a slice of the inbox, in the same type used when it is the whole one, and
   * the number a release decision gets made on. The rows are still real and
   * still worth reading, so the list stays; the average and the count are
   * withheld, which is what src/ui/loadStatus.ts already asks of 'partial'.
   */
  const [truncated, setTruncated] = useState(false);

  const load = async () => {
    // The awaits are wrapped because a rejection used to skip every line after
    // it: `loading` stayed true forever on first paint, and on pull-to-refresh
    // `refreshing` never cleared, leaving a spinner spinning over stale rows
    // with nothing to say it had stopped trying.
    try {
      const [page, errs] = await Promise.all([fetchAllFeedbackPage(), fetchAppErrors(20)]);
      // null is "we could not read it" and must not become an empty list.
      setRows(page?.rows ?? []); setErrors(errs ?? []);
      setUnread(page == null);
      // Under a failed read there is no page to be truthful about, so the flag
      // is cleared rather than left standing from the previous attempt.
      setTruncated(page?.truncated ?? false);
    } catch (e) {
      reportError('ownerFeedback.load', e);
      setUnread(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { let cancelled = false; (async () => { if (!cancelled) await load(); })(); return () => { cancelled = true; }; }, []);
  const onRefresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };

  const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString(); } catch { return ''; } };
  // Null, not 0, and null under truncation too. An average over the newest
  // thousand submissions is not a lower figure than the real average — it is a
  // different one, and nothing on screen would have said so.
  const rated = rows.filter((r) => r.rating);
  const avg = truncated || !rated.length ? null
    : rated.reduce((a, r) => a + (r.rating || 0), 0) / rated.length;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand} />}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What testers are telling you</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Feedback</Text>
          </View>
        </View>

        {/* ── the hero: the one number that summarises the inbox ─────────── */}
        <Hero
          label="Average Rating"
          figure={avg == null ? '—' : avg.toFixed(1)}
          unit={avg == null ? undefined : '/ 5'}
          arc={avg == null ? undefined : avg / 5}
          arcLabel="of five stars"
          note={loading ? 'Loading…'
            : unread ? 'Could not be read'
            // The count goes with the average. Saying "1,000 submissions" under
            // a dash would state as a total the very figure the dash exists to
            // withhold.
            : truncated ? `More than ${rows.length.toLocaleString()} submissions — too many to average here`
            : rows.length === 0 ? 'No submissions yet'
            : `${rows.length} submission${rows.length === 1 ? '' : 's'}`}
        />

        <Rule />

        <Section>
          <SectionHead title="Submissions" note={!truncated && rows.length ? String(rows.length) : undefined} />
          {truncated ? <PartialRead what="submissions" shown={rows.length} onPress={onRefresh} /> : null}
          {loading ? (
            <SkeletonList n={4} />
          ) : rows.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.xxl }}>
              <Icon name={unread ? 'bell' : 'message'} size={26} color={t.ink3} />
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
                {unread
                  ? 'The inbox could not be read, so this is not "no feedback" — pull down to try again.'
                  : 'No feedback yet. It shows up here as testers send it from inside the app.'}
              </Text>
            </View>
          ) : rows.map((r, i) => (
            <View key={r.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CAT_COLOR(t, r.category) }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>{r.category || 'Note'}</Text>
                {r.role ? <Text style={{ ...ty.caption, color: t.ink3, textTransform: 'capitalize' }}>{r.role}</Text> : null}
                {r.rating ? <Text style={{ ...ty.caption, color: t.ink3 }}>{'★'.repeat(r.rating)}</Text> : null}
                <View style={{ flex: 1 }} />
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{fmt(r.createdAt)}</Text>
              </View>
              <Text style={{ ...ty.body, color: t.ink, marginTop: 6 }}>{r.body}</Text>
              {r.appVersion ? <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 4 }}>v{r.appVersion}</Text> : null}
            </View>
          ))}
        </Section>

        {errors.length > 0 ? (<>
          <Rule />
          <Section>
            <Pressable onPress={() => setShowErr((v) => !v)} accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
              <Icon name="wrench" size={15} color={t.crit} />
              <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Recent errors ({errors.length})</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{showErr ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {showErr ? errors.map((e, i) => (
              <View key={e.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                {/* monospace: these are raw thrown messages, read character by character */}
                <Text style={{ ...ty.caption, fontFamily: 'Courier', color: t.ink2 }} numberOfLines={3}>{e.message}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{e.platform || '—'}{e.appVersion ? ' · v' + e.appVersion : ''} · {fmt(e.createdAt)}</Text>
              </View>
            )) : null}
          </Section>
        </>) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
