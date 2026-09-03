// Trainer · Ad spend. What the coach's ads cost, collected instead of typed —
// and, in equal weight on the page, the money it could NOT attribute.
//
// ── Why the unmatched list is not a footnote ─────────────────────────────
//
// Part 98 gives a coach cost-per-client and a return per channel. Both are a
// division, and a spend figure that is quietly too low makes every channel look
// better than it is. The way that happens with automatic collection is an ad
// whose destination has no `?c=` on it: the check sees the money leave and has
// nowhere to file it. Dropping those ads would produce a smaller, tidier,
// entirely wrong total, and nothing on screen would look wrong.
//
// So unmatched spend is shown with its own figure, its own ads, and a sentence
// saying what to change. A coach who can see £600 sitting outside their codes
// can go and fix six ads in ten minutes. A coach who cannot see it believes it
// does not exist.
//
// ── Three channels, and the same failure one level up ────────────────────
//
// Part 350 adds Google Ads and TikTok beside Meta, and with them a second way to
// print a number that is quietly too low: three channels are three independent
// reads, and a total that leaves out the one that failed is a smaller figure
// that looks exactly like a real one.
//
// So this screen never prints a combined figure while a connected channel is
// unread. It says which channel, it shows what the channels that DID answer
// reported, and it leaves the total blank until the missing one comes back.
// `combineChannelSpend` in src/lib/adChannels.ts is the rule and has the test;
// part 350's apply_synced_spend() applies exactly the same rule to what part 98
// divides, so the screen and the figures cannot disagree.
//
// ── Manual beats collected, and the screen says so ───────────────────────
//
// Part 100 decides the precedence and this screen makes it visible: where a
// coach has typed a figure, that figure stays and the collected one is shown
// beside it, marked as not in use, with one button to hand the code over. Nothing
// here ever silently replaces a number the coach entered.
//
// ── What does not work yet ───────────────────────────────────────────────
//
// Meta grants `ads_read` only after App Review. Until Repple has it, a coach who
// is not a developer or tester on Repple's Meta app can complete the whole
// sign-in and then be refused the spend. That is said on the screen, in the first
// card, because a coach who has not been told reads it as Repple being broken.
// It is about Meta and nothing else: Google and TikTok are separate APIs with
// separate approvals and neither waits on it. Typing what you spent works today
// and is not going away.
//
// ── Manual entry lives on the Clients screen ─────────────────────────────
//
// The spend field per code is on the coach dashboard, beside the figures it
// feeds, and stays there. This screen is about the connections and what they
// found; it does not duplicate the field, because two places to type the same
// number is how they come to disagree.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Card, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { num } from '../../src/lib/format';
import { money } from '../../src/lib/gymRecord';
import { UNMATCHED_NOTE, unmatchedReasonNote } from '../../src/lib/adMatch';
import {
  AD_CHANNELS, NO_TOTAL_NOTE, channelLabel, channelPlaces, channelStateNote,
  combineRefusalNote, coverageNote, type AdChannel,
} from '../../src/lib/adChannels';
import {
  APP_REVIEW_NOTE, READ_ONLY_NOTE, chooseAdAccount, connectAdChannel, disconnectAdChannel,
  fetchAdSpend, runAdSync, useSyncedSpend, asChannelRun,
  type AdAccountChoice, type AdSpendRead, type ChannelState,
} from '../../src/ui/adSpend';
import {
  fetchMyCodeReturns, fetchOrganicCodes, setCodeOrganic, type CodeReturnsRead,
} from '../../src/ui/joinCode';
import { worstStatus } from '../../src/ui/loadStatus';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

const DASH = '—';

/** A date as a coach reads one. Unknown stays unknown. */
function when(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return DASH;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMPTY_READ: AdSpendRead = {
  status: 'loading',
  channels: AD_CHANNELS.map((c) => ({ channel: c, account: null, run: null, matched: [], unmatched: [] })),
  sources: [],
  combined: { ok: false, reason: 'no-channels', missing: [], currencies: [], channels: [] },
};

export default function TrainerAdSpend() {
  const t = useTheme();
  const router = useRouter();
  const G = layout.gutter;

  const [read, setRead] = useState<AdSpendRead>(EMPTY_READ);
  const [returns, setReturns] = useState<CodeReturnsRead>({ status: 'loading', rows: [] });
  const [busy, setBusy] = useState<string | null>(null);
  // Only set when a login carries several ad accounts — choosing one is the
  // coach's decision and is never made for them. Keyed by channel, because two
  // channels can be mid-choice at once and a single list would attach the wrong
  // account to the wrong provider.
  const [choices, setChoices] = useState<{ channel: AdChannel; accounts: AdAccountChoice[] } | null>(null);

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([fetchAdSpend(), fetchMyCodeReturns()]);
    setRead(a);
    setReturns(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  // The screen is only as complete as its worst read. A code list that failed
  // while the connections landed would let the currency comparison below run on
  // half the facts.
  const status = worstStatus(read.status, returns.status);

  const connect = async (c: AdChannel) => {
    setBusy(`connect:${c}`);
    const r = await connectAdChannel(c);
    setBusy(null);
    if (!r.ok) { Alert.alert('Not connected', r.reason); return; }
    if (r.warning) Alert.alert('Connected, with a catch', r.warning);
    setChoices(r.chosen ? null : { channel: c, accounts: r.accounts });
    await load();
  };

  const choose = async (c: AdChannel, id: string) => {
    setBusy(`choose:${id}`);
    const r = await chooseAdAccount(c, id);
    setBusy(null);
    if (!r.ok) { Alert.alert('Not saved', r.reason); return; }
    setChoices(null);
    await load();
  };

  const sync = async (c: AdChannel) => {
    setBusy(`sync:${c}`);
    const r = await runAdSync(c);
    setBusy(null);
    // The failure is recorded server-side as a failed run, so the screen below
    // shows "last check failed" rather than the previous success's date.
    if (!r.ok) Alert.alert(`Could not check your ${channelLabel(c)} spend`, r.reason);
    await load();
  };

  const disconnect = async (c: AdChannel) => {
    setBusy(`disconnect:${c}`);
    const r = await disconnectAdChannel(c);
    setBusy(null);
    if (!r.ok) Alert.alert('Still connected', r.reason);
    await load();
  };

  const takeSynced = async (codeId: string | null, label: string) => {
    setBusy(`use:${codeId ?? 'default'}`);
    const r = await useSyncedSpend(codeId);
    setBusy(null);
    if (!r.ok) Alert.alert(`${label} is unchanged`, r.reason);
    await load();
  };

  // ── A code that costs nothing, and was reported as costing an unknown amount
  //
  // Every code with no spend against it is reported as "cost unknown", on the
  // reasonable premise that an unpriced channel is a gap in the record. For a
  // paid channel it is. For a code read out at the end of a class, put in a
  // caption, or printed on a card the coach had anyway, it is not — the cost is
  // nothing, and that is a real answer.
  //
  // NULL is unknown and is never an empty Set. A failed read must leave every
  // code reading exactly as it did before this existed, rather than silently
  // reporting all of them as costing money.
  const [organic, setOrganic] = useState<Set<string> | null>(null);
  const [organicMsg, setOrganicMsg] = useState<string | null>(null);
  const loadOrganic = useCallback(async () => { setOrganic(await fetchOrganicCodes()); }, []);
  useEffect(() => { void loadOrganic(); }, [loadOrganic]);

  // Three reads, all of them: the spend, the code returns and the organic set.
  // Refreshing the spend alone would leave the currency comparison below
  // running half on the new figures and half on the old.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([load(), loadOrganic()]),
    [load, loadOrganic],
  ));

  const toggleOrganic = async (id: string, next: boolean) => {
    const r = await setCodeOrganic(id, next);
    if (!r.ok) { setOrganicMsg(r.reason); return; }
    setOrganicMsg(null);
    await loadOrganic();
  };

  /** The figure currently in use for a code, and where it came from. */
  const sourceFor = (codeId: string | null) => read.sources.find((s) => (s.codeId ?? null) === (codeId ?? null)) ?? null;
  /** What the clients off that code have paid, so the currencies can be checked. */
  const revenueFor = (codeId: string | null) => returns.rows.find((r) => (r.id ?? null) === (codeId ?? null))?.revenue ?? null;

  const connected = read.channels.filter((c) => !!c.account);
  const combined = read.combined;
  const settled = read.status === 'ready';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What your ads cost</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Ad Spend</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Connect Meta, Google Ads or TikTok and Repple reads what each campaign cost, matching ads to your join codes by
          the link they point at. Set a join link as the ad’s destination and there is nothing else to set up.
        </Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{READ_ONLY_NOTE}</Text>

        {/* Said first, and not softened. A coach who is refused by Meta after a
            successful sign-in must know why before it happens to them. It names
            Meta, because the other two are not waiting on it. */}
        <View style={{ marginTop: sp.xl }}>
          <Notice tone={t.warn} kicker="Meta only" title="Meta has to approve this first" note={APP_REVIEW_NOTE} />
        </View>

        {/* The three words on this screen a coach reads as the same thing and
            which are not: matched, unmatched, and cost unknown. One dismissible
            row; src/lib/screenHelp.ts holds the sentences. */}
        <ScreenHelp screen="coach-adspend" />

        {/* ── The connections, one card each ─────────────────────────────── */}
        <Section>
          <SectionHead
            title="Your ad accounts"
            note={settled ? `${num(connected.length)} of ${num(AD_CHANNELS.length)} connected` : undefined}
          />
          {status === 'loading' ? (
            <ActivityIndicator color={t.brand} style={{ marginVertical: 24 }} />
          ) : read.status === 'error' ? (
            <Flag tone={t.crit}>
              {read.reason || 'We could not check whether your ad accounts are connected, so nothing on this screen says whether they are. If they were connected, they still are.'}
            </Flag>
          ) : (
            read.channels.map((s, i) => (
              <View key={s.channel} style={{ marginTop: i ? sp.lg : 0 }}>
                {i > 0 ? <Rule /> : null}
                <View style={{ marginTop: i > 0 ? sp.lg : 0 }}>
                  <ChannelCard
                    state={s}
                    busy={busy}
                    onConnect={() => { if (!busy) connect(s.channel); }}
                    onSync={() => { if (!busy) sync(s.channel); }}
                    onDisconnect={() => { if (!busy) disconnect(s.channel); }}
                  />
                </View>
              </View>
            ))
          )}
        </Section>

        {/* Several ad accounts on one login. Picking for them would decide which
            business's money the coach is shown, silently.

            ── And the ONE-account case, which had no door at all ─────────────

            `length > 1` was the only gate. supabase/functions/ads-oauth returns
            `{ ok: true, connected: true, accounts, warning }` with NO `chosen`
            when `choose_ad_account` errors — which happens on a single-account
            login — and ads-google does the same. So `choices` was stored with
            one account in it, the picker was withheld because one is not more
            than one, and ChannelCard went on telling the coach to connect again
            and pick one. They reconnect, get the same warning, reconnect again;
            ad spend for that channel can never be collected and every
            cost-per-enquiry figure downstream of it stays missing.
            app/(trainer)/share-kit.tsx tests `pages?.length` for this identical
            shape, so the two screens disagreed about what one item means. */}
        {choices && choices.accounts.length > 0 ? (
          <Section>
            <SectionHead
              title={choices.accounts.length > 1 ? 'Which ad account?' : 'Confirm your ad account'}
              note={choices.accounts.length > 1
                ? `This ${channelLabel(choices.channel)} login can see more than one`
                : `This ${channelLabel(choices.channel)} login found one, and it was not saved`} />
            {choices.accounts.length === 1 ? (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                Nothing is wrong with the connection — the account below simply was not stored when you
                connected, and spend cannot be collected until it is. This is the tap that fixes it;
                connecting again will not.
              </Text>
            ) : null}
            {choices.accounts.map((c) => (
              <View key={c.id} style={{ marginTop: sp.md }}>
                <Card>
                  <Text style={{ ...ty.head, color: t.ink }}>{c.name || c.id}</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                    {c.id}{c.currency ? ` · ${c.currency}` : ' · currency not stated'}{c.active ? '' : ' · not active'}
                  </Text>
                  <View style={{ marginTop: sp.md }}>
                    <Ghost
                      label={busy === `choose:${c.id}` ? 'Saving…' : 'Use This One'}
                      a11yLabel={`Use ${c.name || c.id} for ${channelLabel(choices.channel)}`}
                      onPress={() => { if (!busy) choose(choices.channel, c.id); }}
                    />
                  </View>
                </Card>
              </View>
            ))}
          </Section>
        ) : null}

        {/* ── What it all came to, or why there is no such figure ────────── */}
        {settled ? (
          <Section>
            <SectionHead
              title="Spent, by code"
              note={combined.ok ? `${num(combined.codes.length)} ${combined.codes.length === 1 ? 'code' : 'codes'}` : undefined}
            />

            {!combined.ok ? (
              <View>
                <Flag tone={combined.reason === 'no-channels' ? t.ink3 : t.warn}>
                  {combineRefusalNote(combined)}
                </Flag>
                {combined.reason === 'channel-unread' || combined.reason === 'currency-clash' ? (
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{NO_TOTAL_NOTE}</Text>
                ) : null}

                {/* The figures that ARE known, shown apart. Withholding the
                    total is not withholding the facts, and a coach can still
                    act on the channel that answered. */}
                {read.channels.filter((s) => s.run?.status === 'ok' && s.matched.length > 0).map((s) => (
                  <View key={s.channel} style={{ marginTop: sp.lg }}>
                    <Rule />
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>{channelLabel(s.channel)}</Text>
                    {s.matched.map((m, i) => (
                      <View key={`${m.code}-${i}`} style={{
                        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
                        gap: sp.md, marginTop: sp.md,
                      }}>
                        <Text style={{ ...ty.body, color: t.ink }}>{m.code}</Text>
                        <Text style={{ ...ty.body, color: t.ink }}>{money(m.cents, m.currency) ?? DASH}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : combined.codes.length === 0 ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Every connected channel was checked and none of their ads points at one of your join links, so none of the
                spend they found is credited to a code. What could not be placed is listed below.
              </Text>
            ) : (
              <View>
                <Text style={{ ...ty.label, color: t.ink3 }}>{coverageNote(combined.channels)}</Text>
                {combined.codes.map((m, i) => {
                  const src = sourceFor(m.codeId);
                  const overridden = src?.source === 'manual';
                  const rev = revenueFor(m.codeId);
                  const currencyClash = !!rev && rev.currency !== m.currency;
                  return (
                    <View key={`${m.code}-${i}`} style={{ marginTop: sp.lg }}>
                      <Rule />
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, marginTop: sp.lg }}>
                        <Text style={{ ...ty.head, color: t.ink }}>{m.code}</Text>
                        <Text style={{ ...ty.head, color: t.ink }}>{money(m.cents, m.currency) ?? DASH}</Text>
                      </View>
                      <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                        Across {num(m.ads)} {m.ads === 1 ? 'ad' : 'ads'} pointing at this code’s join link.
                      </Text>

                      {/* Which channels the figure is made of. A coach who can
                          see that most of it is one channel can act on that;
                          a single number only says the total is high. */}
                      {m.parts.length > 1 ? (
                        <View style={{ marginTop: sp.sm }}>
                          {m.parts.map((p) => (
                            <View key={p.channel} style={{
                              flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, marginTop: 2,
                            }}>
                              <Text style={{ ...ty.caption, color: t.ink3 }}>{channelLabel(p.channel)}</Text>
                              <Text style={{ ...ty.caption, color: t.ink2 }}>{money(p.cents, m.currency) ?? DASH}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                      {/* The precedence, made visible. Both numbers, and which
                          one is in use — never a silent replacement. */}
                      {overridden ? (
                        <View style={{ marginTop: sp.md }}>
                          <Flag tone={t.warn}>
                            You entered {money(src!.cents, src!.currency) ?? DASH} for this code, and yours is the figure being
                            used. The {money(m.cents, m.currency) ?? DASH} above is what your ad accounts reported and it has
                            not replaced anything.
                          </Flag>
                          <View style={{ marginTop: sp.md }}>
                            <Ghost
                              label={busy === `use:${m.codeId ?? 'default'}` ? 'Switching…' : 'Use the Collected Figure'}
                              a11yLabel={`Use the collected figure for ${m.code} instead of the one you entered`}
                              onPress={() => { if (!busy) takeSynced(m.codeId, m.code); }}
                            />
                          </View>
                        </View>
                      ) : (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                          This is the figure your return for {m.code} is worked out from. Type your own on the Clients screen
                          and yours will be kept instead, including on the next check.
                        </Text>
                      )}

                      {/* Two currencies do not divide. Named rather than
                          converted: a converted figure carries a rate nobody
                          chose. */}
                      {currencyClash ? (
                        <View style={{ marginTop: sp.md }}>
                          <Flag tone={t.crit}>
                            This spend is in {m.currency} and the clients off this code paid in {rev!.currency}. Repple will
                            not divide one by the other, so there is no return shown for it — record this code’s spend in{' '}
                            {rev!.currency} yourself if you want the comparison.
                          </Flag>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </Section>
        ) : null}

        {/* ── What it could not match. The point of the screen. ───────────── */}
        {settled && read.channels.some((s) => s.run?.status === 'ok') ? (
          <Section>
            <SectionHead
              title="Not matched to any code"
              note={unmatchedCount(read) ? `${num(unmatchedCount(read))} ${unmatchedCount(read) === 1 ? 'ad' : 'ads'}` : undefined}
            />
            {unmatchedCount(read) === 0 ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Every ad these checks saw pointed at one of your join links, so all of the spend they found is credited to a
                code.
              </Text>
            ) : (
              <View>
                <Text style={{ ...ty.label, color: t.ink3 }}>{UNMATCHED_NOTE}</Text>
                {read.channels.filter((s) => s.run?.status === 'ok' && s.unmatched.length > 0).map((s) => (
                  <View key={s.channel} style={{ marginTop: sp.lg }}>
                    <Rule />
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, marginTop: sp.lg }}>
                      <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>{channelLabel(s.channel)}</Text>
                      <Text style={{ ...ty.head, color: t.ink }}>
                        {/* Null is not zero: one unreadable amount makes this
                            channel's total unknown rather than short, because a
                            partial sum of unattributed money reads exactly like
                            the whole of it. */}
                        {s.run!.unmatchedCents != null && s.run!.currency ? (money(s.run!.unmatchedCents, s.run!.currency) ?? DASH) : DASH}
                      </Text>
                    </View>
                    {s.run!.unmatchedCents == null ? (
                      <View style={{ marginTop: sp.sm }}>
                        <Flag tone={t.warn}>
                          At least one of these ads did not report what it cost, so this cannot be totalled. It is more than
                          the ads below that did.
                        </Flag>
                      </View>
                    ) : null}
                    {s.unmatched.map((u, i) => (
                      <View key={`${u.adId ?? 'ad'}-${i}`} style={{ marginTop: sp.md }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
                          <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{u.adName || 'Unnamed ad'}</Text>
                          <Text style={{ ...ty.body, color: t.ink }}>
                            {u.cents != null && u.currency ? (money(u.cents, u.currency) ?? DASH) : DASH}
                          </Text>
                        </View>
                        <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{unmatchedReasonNote(u.reason)}</Text>
                        {u.url ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }} numberOfLines={2}>{u.url}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </Section>
        ) : null}

        {/* ── Typing it in yourself, which never stops working ────────────── */}
        <Section>
          <SectionHead title="Entering it yourself" />
          <Text style={{ ...ty.body, color: t.ink2 }}>
            Every code’s spend field is on the Clients screen, beside the figures it feeds, and it works whether or not an ad
            account is connected. A figure you type there is never replaced by a collected one — it wins, and this screen
            shows you when the two disagree. Clearing the field hands that code back to the checks.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Ads are not the only thing a code costs you. A code you read out in a class or put in a caption will never appear
            in an ad account, and its absence here says nothing about what it cost — no ad spend is unknown, not free.
          </Text>
        </Section>

        {/* ── Codes that cost nothing ──────────────────────────────────────
            The other half of the sentence above. "No ad spend is unknown, not
            free" is exactly right and it leaves the coach with no way to say
            which of their codes IS free — so every organic channel sits in the
            unpriced pile forever, making it long enough that nobody reads it.

            Marking one free is a statement about the CHANNEL, not a spend of
            zero for a period: a zero would have to be re-entered every month to
            keep meaning the same thing. See supabase/parts/211.

            Only drawn on a settled codes read. Under 'error' `returns.rows` is
            empty and a section headed "Codes that cost nothing" over it would
            read as a coach with no codes. */}
        {returns.status === 'ready' && returns.rows.length > 0 ? (
          <Section>
            <SectionHead title="Codes that cost you nothing" />
            <Text style={{ ...ty.body, color: t.ink2 }}>
              A code you read out in a class, put in a caption or printed on a card you had anyway is free, and that is a
              real answer rather than a gap. Marked codes stop being reported as unpriced, so what is left in that list is
              the paid spend you have genuinely not entered.
            </Text>
            {organic === null ? (
              <View style={{ marginTop: sp.md }}>
                <Flag tone={t.warn}>
                  Which of your codes are marked free could not be read, so none of them is shown as marked here. That is
                  this screen not knowing, and nothing has been changed.
                </Flag>
              </View>
            ) : (
              <View style={{ marginTop: sp.md }}>
                {organicMsg ? <Flag tone={t.crit}>{organicMsg}</Flag> : null}
                {returns.rows.map((row, i) => {
                  // The default code has no row in `coach_join_codes` — it lives
                  // on `trainers.join_code` — so there is nothing to mark and no
                  // switch is offered. Part 81 makes the same distinction.
                  if (!row.id || row.isDefault) return null;
                  const on = organic.has(row.id);
                  const id = row.id;
                  return (
                    <View key={id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: sp.md,
                      paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring,
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{row.label}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {row.code}{on ? ' · marked free' : row.spend ? ' · you have entered a cost' : ' · cost unknown'}
                        </Text>
                      </View>
                      {on
                        ? <Ghost label="Not Free" a11yLabel={`Stop treating ${row.label} as free`} onPress={() => { void toggleOrganic(id, false); }} />
                        : <Ghost label="Mark Free" a11yLabel={`Mark ${row.label} as costing nothing`} onPress={() => { void toggleOrganic(id, true); }} />}
                    </View>
                  );
                })}
              </View>
            )}
          </Section>
        ) : null}

        {/* The other half of the same question. Everything above divides money
            by the people who FINISHED — installed the app, made an account and
            spent the code. An ad that produced twenty enquiries and no joins
            reads here as a total failure, and it is not one: it is an
            onboarding problem, and the two need opposite responses. */}
        <Section>
          <SectionHead title="Who asked and did not join" />
          <Text style={{ ...ty.body, color: t.ink2 }}>
            These figures count clients. Somebody who clicked a join link and left their details without making an account
            is not among them and never will be, so a code with real interest behind it and nobody through the door looks
            from this screen exactly like a code nothing happened on.
          </Text>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Your Enquiries" onPress={() => router.push('/(trainer)/leads')} />
          </View>
        </Section>

        {status === 'error' && read.status !== 'error' ? (
          <Section>
            <Flag tone={t.crit}>
              {returns.reason || 'Your codes could not be read, so nothing above compares this spend with what those clients paid.'}
            </Flag>
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Every unmatched ad across every channel that answered. */
function unmatchedCount(read: AdSpendRead): number {
  return read.channels.reduce((n, s) => n + (s.run?.status === 'ok' ? s.unmatched.length : 0), 0);
}

/**
 * One channel: whether it is connected, what its last check said, and the two
 * or three things a coach can do about it.
 *
 * Drawn identically for all three deliberately. The differences between Meta,
 * Google and TikTok are real and they are the OWNER's problem — three developer
 * portals, three approvals — and none of them changes what a coach does here.
 */
function ChannelCard({ state, busy, onConnect, onSync, onDisconnect }: {
  state: ChannelState;
  busy: string | null;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const t = useTheme();
  const c = state.channel;
  const account = state.account;
  const run = state.run;
  const chosen = !!account?.externalAccountId;
  const label = channelLabel(c);

  if (!account) {
    return (
      <View>
        <Text style={{ ...ty.head, color: t.ink }}>{label}</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
          Not connected. Ads here run on {channelPlaces(c)}.
        </Text>
        <View style={{ marginTop: sp.md }}>
          <Ghost
            label={busy === `connect:${c}` ? 'Opening…' : `Connect ${label}`}
            a11yLabel={`Connect your ${label} ad account`}
            onPress={onConnect}
          />
        </View>
      </View>
    );
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
        <Text style={{ ...ty.head, color: t.ink }}>{label}</Text>
        <Text style={{ ...ty.caption, color: t.ink3 }}>{account.currency || 'currency not read yet'}</Text>
      </View>
      <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>
        {account.accountName || account.externalAccountId || label}
      </Text>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
        Connected {when(account.connectedAt)}
        {account.managerAccountId ? ` · under manager ${account.managerAccountId}` : ''}
      </Text>

      {!chosen ? (
        <View style={{ marginTop: sp.md }}>
          <Flag tone={t.warn}>
            You are signed in to {label} but no ad account has been chosen, so there is nothing to read spend from yet. Connect
            again to pick one.
          </Flag>
        </View>
      ) : null}

      {account.expiresSoon ? (
        <View style={{ marginTop: sp.md }}>
          <Flag tone={t.warn}>
            This connection is close to expiring. Repple renews it on each check; if a check fails with a sign-in error,
            connect again.
          </Flag>
        </View>
      ) : null}

      {/* What the last check said. A check that failed is not a check that
          found nothing — they send a coach to opposite conclusions and are
          never merged. */}
      {chosen ? (
        <View style={{ marginTop: sp.md }}>
          {!run ? (
            <Flag tone={t.warn}>{channelStateNote(c, 'never')}</Flag>
          ) : run.status === 'failed' ? (
            <View>
              <Flag tone={t.crit}>{run.failure || `${label} did not say why the check on ${when(run.startedAt)} failed.`}</Flag>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Nothing was recorded from it — a failed check knows no figures, so it writes none. While this channel is
                unread there is no combined figure at all, because one that left it out would be a smaller number that looks
                like a real one.
              </Text>
            </View>
          ) : (
            <View>
              <Text style={{ ...ty.label, color: t.ink2 }}>
                Checked {when(run.startedAt)} · {num(run.adsSeen ?? 0)} {run.adsSeen === 1 ? 'ad' : 'ads'}
                {run.currency ? ` · ${run.currency}` : ''}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {run.windowFrom && run.windowTo
                  ? `Covering ${when(run.windowFrom)} to ${when(run.windowTo)} — the whole life of the account, so it lines up with the lifetime revenue your codes are measured on.`
                  : 'This covers the whole life of the account, which is what the lifetime revenue your codes are measured on needs. The exact days were not reported.'}
              </Text>
              {run.adsSeen === 0 ? (
                <View style={{ marginTop: sp.sm }}>
                  <Flag tone={t.ink3}>
                    The check worked and this ad account has no ads in it. Codes you promote organically will never appear
                    here at all — a code with no ad spend is unknown, not free.
                  </Flag>
                </View>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md, flexWrap: 'wrap' }}>
        <Cta
          label={busy === `sync:${c}` ? 'Checking…' : 'Check Now'}
          a11yLabel={`Check what you have spent on ${label}`}
          onPress={onSync}
          disabled={!chosen || !!busy}
        />
        <Ghost
          label={busy === `disconnect:${c}` ? 'Disconnecting…' : 'Disconnect'}
          a11yLabel={`Disconnect your ${label} ad account`}
          onPress={onDisconnect}
        />
      </View>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
        Disconnecting stops future checks on {label}. What has already been recorded stays — what a campaign cost last month
        did not stop being true.
      </Text>
    </View>
  );
}
