// Coach · Who Brings You Clients. The clients on this coach's own book who have
// brought other people in, and how far those people got.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// src/lib/referralCredit.ts has held the rules since part 128 gave a referral a
// referrer, and every one of them faced the member: my code, my friends, my two
// counts. `referrals` carries a single select policy — the referred user's — so
// a coach reading the table directly got zero rows and no error, and a client
// who had personally brought four people onto a coach's book was, to that
// coach's app, identical to one who had brought nobody.
//
// supabase/parts/630 is the read. It returns counts and the coach's own
// client's name, and nothing at all about the people who were referred: they
// used somebody else's code, most of them are not this coach's clients, and
// none of them agreed to be listed to them.
//
// ── What this screen states, and what it will not ──────────────────────────
//
// Counts. Not money. There is no credit, no discount, no free session and no
// "worth" anywhere on the page, and `COACH_REWARD_NOTE` says so out loud rather
// than leaving it to be assumed. Repple is white-label: what a referral is worth
// is a commercial decision belonging to each coach in their own currency, and
// this app has never been told what that is. A figure invented here would be
// offered to a real person and held to.
//
// And joined is never converted. A signup, a first session and a first payment
// are three different promises; the database can keep the middle one, and both
// halves are always on the row so that neither can be read as the other.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useCoachReferrals } from '../../src/ui/coachReferrals';
import {
  coachSummaryLine, referrerLine, CONVERSION_RULE,
  COACH_REWARD_NOTE, COACH_REFERRAL_PRIVACY_NOTE,
} from '../../src/lib/referralCredit';

export default function CoachReferrals() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  const { status, rows, reload } = useCoachReferrals();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  /**
   * The coach's own name for this client, where the roster has one.
   *
   * `coach_referrals()` returns a first name — the same minimal field
   * `my_referrals()` returns, chosen there on privacy grounds and kept here
   * because the RPC has no reason to hand back more than the caller already
   * holds. The coach's roster IS what they already hold, so the fuller name
   * comes from there and the server's is the fallback. A roster that has not
   * loaded, or came back short, simply leaves the fallback showing.
   */
  const nameFor = useMemo(() => {
    const byId = new Map(r.roster.map((c) => [c.id, c.name]));
    return (id: string, fallback: string) => byId.get(id) ?? fallback;
  }, [r.roster]);

  const summary = coachSummaryLine(status, rows);
  const listable = status === 'ready' || status === 'partial';

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={t.ink3} />}
      >

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Who Brings You Clients</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{summary}</Text>

        {status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Not read" title="We couldn’t check who has been referring"
              note="Nobody is listed below because the read did not come back. This is not a book on which nobody has referred anybody — pull down to try again.">
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { void reload(); }} /></View>
            </Notice>
          </Section>
        ) : null}

        {status === 'partial' ? (
          <Section><PartialRead what="clients" shown={rows?.length ?? 0} onPress={() => { void reload(); }} /></Section>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="Your referrers" note={status === 'ready' && rows ? `${rows.length}` : undefined} />

          {/* What "started training" means, said before anybody reads the second
              number as a payment or a renewal. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{CONVERSION_RULE}</Text>

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Checking who has been bringing people in…</Text>
          ) : !listable || !rows ? null : rows.length === 0 ? (
            // Only under a whole read, and `coachSummaryLine` has already said
            // it once at the top. This is the sentence that must never appear
            // under 'error', and the branch above is what keeps it out.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nobody on your book has brought somebody in with their code yet. Their code is on their
              own Invite screen — most clients have never opened it, and asking is free.
            </Text>
          ) : (
            rows.map((row, i) => {
              const name = nameFor(row.id, row.name);
              return (
                <View key={row.id}
                  accessible accessibilityRole="text"
                  accessibilityLabel={`${name}. ${referrerLine(row)}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>
                      {name.split(' ').map((x) => x[0]).join('')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{name}</Text>
                    {/* Both counts, always. Neither is derived from the other and
                        neither is a score. */}
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{referrerLine(row)}</Text>
                  </View>
                  {/* The count they brought in, and no second figure beside it
                      pretending to be what it was worth. */}
                  <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{row.joined}</Text>
                </View>
              );
            })
          )}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Thanking them" />
          <Text style={{ ...ty.label, color: t.ink3 }}>{COACH_REWARD_NOTE}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{COACH_REFERRAL_PRIVACY_NOTE}</Text>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Message a Client" onPress={() => router.push('/(trainer)/messages')} />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
