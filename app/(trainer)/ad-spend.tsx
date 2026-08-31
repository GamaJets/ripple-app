// Trainer · Ad spend. What the coach's ads cost, collected instead of typed —
// and, in equal weight on the page, the money it could NOT attribute.
//
// ── Why the unmatched list is not a footnote ─────────────────────────────
//
// Part 98 gives a coach cost-per-client and a return per channel. Both are a
// division, and a spend figure that is quietly too low makes every channel look
// better than it is. The way that happens with automatic collection is an ad
// whose destination has no `?c=` on it: the sync sees the money leave and has
// nowhere to file it. Dropping those ads would produce a smaller, tidier,
// entirely wrong total, and nothing on screen would look wrong.
//
// So unmatched spend is shown with its own figure, its own ads, and a sentence
// saying what to change. A coach who can see £600 sitting outside their codes
// can go and fix six ads in ten minutes. A coach who cannot see it believes it
// does not exist.
//
// ── Manual beats synced, and the screen says so ──────────────────────────
//
// Part 100 decides the precedence and this screen makes it visible: where a
// coach has typed a figure, that figure stays and the synced one is shown
// beside it, marked as not in use, with one button to hand the code over to the
// sync. Nothing here ever silently replaces a number the coach entered.
//
// ── What does not work yet ───────────────────────────────────────────────
//
// Meta grants `ads_read` only after App Review. Until Repple has it, a coach
// who is not a developer or tester on Repple's Meta app can complete the whole
// sign-in and then be refused the spend. That is said on the screen, in the
// first card, because a coach who has not been told reads it as Repple being
// broken. Typing what you spent works today and is not going away.
//
// ── Manual entry lives on the Clients screen ─────────────────────────────
//
// The spend field per code is on the coach dashboard, beside the figures it
// feeds, and stays there. This screen is about the connection and what it
// found; it does not duplicate the field, because two places to type the same
// number is how they come to disagree.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Card, Cta, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { num } from '../../src/lib/format';
import { money } from '../../src/lib/gymRecord';
import { UNMATCHED_NOTE, unmatchedReasonNote } from '../../src/lib/adMatch';
import {
  APP_REVIEW_NOTE, chooseAdAccount, connectAdAccount, disconnectAdAccount, fetchAdSpend,
  runAdSync, useSyncedSpend, type AdAccountChoice, type AdSpendRead,
} from '../../src/ui/adSpend';
import { fetchMyCodeReturns, type CodeReturnsRead } from '../../src/ui/joinCode';
import { worstStatus } from '../../src/ui/loadStatus';

const DASH = '—';

/** A date as a coach reads one. Unknown stays unknown. */
function when(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return DASH;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TrainerAdSpend() {
  const t = useTheme();
  const router = useRouter();
  const G = layout.gutter;

  const [read, setRead] = useState<AdSpendRead>({ status: 'loading', account: null, run: null, matched: [], unmatched: [], sources: [] });
  const [returns, setReturns] = useState<CodeReturnsRead>({ status: 'loading', rows: [] });
  const [busy, setBusy] = useState<string | null>(null);
  // Only set when a Meta login carries several ad accounts — choosing one is
  // the coach's decision and is never made for them.
  const [choices, setChoices] = useState<AdAccountChoice[]>([]);

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([fetchAdSpend(), fetchMyCodeReturns()]);
    setRead(a);
    setReturns(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  // The screen is only as complete as its worst read. A code list that failed
  // while the sync list landed would let the currency comparison below run on
  // half the facts.
  const status = worstStatus(read.status, returns.status);

  const connect = async () => {
    setBusy('connect');
    const r = await connectAdAccount();
    setBusy(null);
    if (!r.ok) { Alert.alert('Not connected', r.reason); return; }
    if (r.warning) Alert.alert('Connected, with a catch', r.warning);
    setChoices(r.chosen ? [] : r.accounts);
    await load();
  };

  const choose = async (id: string) => {
    setBusy(id);
    const r = await chooseAdAccount(id);
    setBusy(null);
    if (!r.ok) { Alert.alert('Not saved', r.reason); return; }
    setChoices([]);
    await load();
  };

  const sync = async () => {
    setBusy('sync');
    const r = await runAdSync();
    setBusy(null);
    // The failure is recorded server-side as a failed run, so the screen below
    // shows "last attempt failed" rather than the previous success's date.
    if (!r.ok) Alert.alert('Could not check your ad spend', r.reason);
    await load();
  };

  const disconnect = async () => {
    setBusy('disconnect');
    const r = await disconnectAdAccount();
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

  const account = read.account;
  const run = read.run;
  const connected = !!account;
  const chosen = !!account?.externalAccountId;

  /** The figure currently in use for a code, and where it came from. */
  const sourceFor = (codeId: string | null) => read.sources.find((s) => (s.codeId ?? null) === (codeId ?? null)) ?? null;
  /** What the clients off that code have paid, so the currencies can be checked. */
  const revenueFor = (codeId: string | null) => returns.rows.find((r) => (r.id ?? null) === (codeId ?? null))?.revenue ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What your ads cost</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Ad Spend</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Connect your ad account and Repple reads what each campaign cost, matching ads to your join codes by the link
          they point at. Set a join link as the ad’s destination and there is nothing else to set up.
        </Text>

        {/* Said first, and not softened. A coach who is refused by Meta after a
            successful sign-in must know why before it happens to them. */}
        <View style={{ marginTop: sp.xl }}>
          <Notice tone={t.warn} kicker="Not approved yet" title="Meta has to approve this first" note={APP_REVIEW_NOTE} />
        </View>

        {/* ── The connection ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your ad account" />
          {status === 'loading' ? (
            <ActivityIndicator color={t.brand} style={{ marginVertical: 24 }} />
          ) : read.status === 'error' ? (
            <Flag tone={t.crit}>
              {read.reason || 'We could not check whether your ad account is connected, so nothing on this screen says whether it is. If it was connected, it still is.'}
            </Flag>
          ) : !connected ? (
            <View>
              <Text style={{ ...ty.body, color: t.ink2 }}>
                No ad account is connected, so nothing here has been collected automatically. What you have typed in yourself
                is unaffected and is still what your figures are worked out from.
              </Text>
              <View style={{ marginTop: sp.lg }}>
                <Cta label={busy === 'connect' ? 'Opening Meta…' : 'Connect Meta ads'} onPress={() => { if (!busy) connect(); }} wide />
              </View>
            </View>
          ) : (
            <View>
              <Text style={{ ...ty.body, color: t.ink }}>
                {account?.accountName || account?.externalAccountId || 'Meta'}
              </Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                Connected {when(account?.connectedAt ?? null)}
                {account?.currency ? ` · bills in ${account.currency}` : ' · currency not read yet'}
              </Text>
              {!chosen ? (
                <View style={{ marginTop: sp.md }}>
                  <Flag tone={t.warn}>
                    You are signed in to Meta but no ad account has been chosen, so there is nothing to read spend from yet.
                    Choose one below.
                  </Flag>
                </View>
              ) : null}
              {account?.expiresSoon ? (
                <View style={{ marginTop: sp.md }}>
                  <Flag tone={t.warn}>
                    This connection is close to expiring. Repple renews it on each check; if a check fails with a sign-in
                    error, connect again.
                  </Flag>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg, flexWrap: 'wrap' }}>
                <Cta label={busy === 'sync' ? 'Checking…' : 'Check now'} onPress={() => { if (!busy && chosen) sync(); }} disabled={!chosen} />
                <Ghost label={busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'} onPress={() => { if (!busy) disconnect(); }} />
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Disconnecting stops future checks. What has already been recorded stays — what a campaign cost last month
                did not stop being true.
              </Text>
            </View>
          )}
        </Section>

        {/* Several ad accounts on one login. Picking for them would decide which
            business's money the coach is shown, silently. */}
        {choices.length > 1 ? (
          <Section>
            <SectionHead title="Which ad account?" note="This Meta login can see more than one" />
            {choices.map((c) => (
              <View key={c.id} style={{ marginTop: sp.md }}>
                <Card>
                  <Text style={{ ...ty.head, color: t.ink }}>{c.name || c.id}</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                    {c.id}{c.currency ? ` · ${c.currency}` : ' · currency not stated'}{c.active ? '' : ' · not active'}
                  </Text>
                  <View style={{ marginTop: sp.md }}>
                    <Ghost label={busy === c.id ? 'Saving…' : 'Use this one'} onPress={() => { if (!busy) choose(c.id); }} />
                  </View>
                </Card>
              </View>
            ))}
          </Section>
        ) : null}

        {/* ── The last check ─────────────────────────────────────────────── */}
        {connected && read.status === 'ready' ? (
          <Section>
            <SectionHead title="Last check" />
            {!run ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Your ad spend has never been checked, so nothing below has been collected. That is not the same as your ads
                having cost nothing.
              </Text>
            ) : run.status === 'failed' ? (
              <View>
                {/* A check that failed is not a check that found nothing. They
                    send a coach to opposite conclusions and are never merged. */}
                <Text style={{ ...ty.body, color: t.ink }}>The last check failed on {when(run.startedAt)}.</Text>
                <View style={{ marginTop: sp.sm }}>
                  <Flag tone={t.crit}>{run.failure || 'Meta did not say why.'}</Flag>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Nothing was recorded from it — a failed check knows no figures, so it writes none. Whatever was recorded
                  before is still what your figures use.
                </Text>
              </View>
            ) : (
              <View>
                <Text style={{ ...ty.body, color: t.ink }}>
                  Checked {when(run.startedAt)} · {num(run.adsSeen)} {run.adsSeen === 1 ? 'ad' : 'ads'}
                  {run.currency ? ` · ${run.currency}` : ''}
                </Text>
                <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                  {run.windowFrom && run.windowTo
                    ? `Covering ${when(run.windowFrom)} to ${when(run.windowTo)} — the whole life of the account, so it lines up with the lifetime revenue your codes are measured on.`
                    : 'The window this covers was not reported, so treat the figures as the account’s whole history.'}
                </Text>
                {run.adsSeen === 0 ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.ink3}>
                      The check worked and this ad account has no ads in it. Codes you promote organically will never appear
                      here at all — a code with no ad spend is unknown, not free.
                    </Flag>
                  </View>
                ) : null}
              </View>
            )}
          </Section>
        ) : null}

        {/* ── What it matched ────────────────────────────────────────────── */}
        {run?.status === 'ok' && read.status === 'ready' && read.matched.length > 0 ? (
          <Section>
            <SectionHead title="Matched to a code" note={`${num(read.matched.length)} ${read.matched.length === 1 ? 'code' : 'codes'}`} />
            {read.matched.map((m, i) => {
              const src = sourceFor(m.codeId);
              const overridden = !m.applied && src?.source === 'manual';
              const rev = revenueFor(m.codeId);
              const currencyClash = !!rev && rev.currency !== m.currency;
              return (
                <View key={`${m.code}-${i}`} style={{ marginTop: sp.lg }}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, marginTop: i > 0 ? sp.lg : 0 }}>
                    <Text style={{ ...ty.head, color: t.ink }}>{m.code}</Text>
                    <Text style={{ ...ty.head, color: t.ink }}>{money(m.cents, m.currency) ?? DASH}</Text>
                  </View>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                    Across {num(m.ads)} {m.ads === 1 ? 'ad' : 'ads'} pointing at this code’s join link.
                  </Text>

                  {/* The precedence, made visible. Both numbers, and which one
                      is in use — never a silent replacement. */}
                  {overridden ? (
                    <View style={{ marginTop: sp.md }}>
                      <Flag tone={t.warn}>
                        You entered {money(src!.cents, src!.currency) ?? DASH} for this code, and yours is the figure being
                        used. The {money(m.cents, m.currency) ?? DASH} above is what Meta reported and it has not replaced
                        anything.
                      </Flag>
                      <View style={{ marginTop: sp.md }}>
                        <Ghost
                          label={busy === `use:${m.codeId ?? 'default'}` ? 'Switching…' : 'Use the synced figure instead'}
                          onPress={() => { if (!busy) takeSynced(m.codeId, m.code); }}
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                      This is the figure your return for {m.code} is worked out from. Type your own on the Clients screen and
                      yours will be kept instead, including on the next check.
                    </Text>
                  )}

                  {/* Two currencies do not divide. Named rather than converted:
                      a converted figure carries a rate nobody chose. */}
                  {currencyClash ? (
                    <View style={{ marginTop: sp.md }}>
                      <Flag tone={t.crit}>
                        This spend is in {m.currency} and the clients off this code paid in {rev!.currency}. Repple will not
                        divide one by the other, so there is no return shown for it — record this code’s spend in{' '}
                        {rev!.currency} yourself if you want the comparison.
                      </Flag>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Section>
        ) : null}

        {/* ── What it could not match. The point of the screen. ───────────── */}
        {run?.status === 'ok' && read.status === 'ready' ? (
          <Section>
            <SectionHead
              title="Not matched to any code"
              note={read.unmatched.length ? `${num(read.unmatched.length)} ${read.unmatched.length === 1 ? 'ad' : 'ads'}` : undefined}
            />
            {read.unmatched.length === 0 ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Every ad this check saw pointed at one of your join links, so all of the spend it found is credited to a code.
              </Text>
            ) : (
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>Spent, and not credited to any code</Text>
                  <Text style={{ ...ty.head, color: t.ink }}>
                    {/* Null is not zero: one unreadable amount makes the TOTAL
                        unknown rather than short, because a partial sum of
                        unattributed money reads exactly like all of it. */}
                    {run.unmatchedCents != null && run.currency ? (money(run.unmatchedCents, run.currency) ?? DASH) : DASH}
                  </Text>
                </View>
                {run.unmatchedCents == null ? (
                  <View style={{ marginTop: sp.sm }}>
                    <Flag tone={t.warn}>
                      At least one of these ads did not report what it cost, so this cannot be totalled. It is more than the
                      ads below that did.
                    </Flag>
                  </View>
                ) : null}
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{UNMATCHED_NOTE}</Text>

                {read.unmatched.map((u, i) => (
                  <View key={`${u.adId ?? 'ad'}-${i}`} style={{ marginTop: sp.lg }}>
                    <Rule />
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, marginTop: sp.lg }}>
                      <Text style={{ ...ty.head, color: t.ink, flex: 1 }}>{u.adName || 'Unnamed ad'}</Text>
                      <Text style={{ ...ty.head, color: t.ink }}>
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
            )}
          </Section>
        ) : null}

        {/* ── Typing it in yourself, which never stops working ────────────── */}
        <Section>
          <SectionHead title="Entering it yourself" />
          <Text style={{ ...ty.body, color: t.ink2 }}>
            Every code’s spend field is on the Clients screen, beside the figures it feeds, and it works whether or not an ad
            account is connected. A figure you type there is never replaced by a synced one — it wins, and this screen shows
            you when the two disagree. Clearing the field hands that code back to the sync.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Ads are not the only thing a code costs you. A code you read out in a class or put in a caption will never appear
            in an ad account, and its absence here says nothing about what it cost — no ad spend is unknown, not free.
          </Text>
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
