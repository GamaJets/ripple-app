// Owner · Operations. The session fee, notices to members, a support inbox and
// the gym's activity log.
//
// The Announce tab was a notepad. It wrote to a `useState` in
// src/ui/ownerOps.tsx and its own confirmation said so — "Saved to this device
// only — announcements do not reach trainers yet" — while `announcements` sat
// in the schema with policies written for exactly this broadcast and no writer
// anywhere in the product. So a gym closing on Monday had no way to say so.
//
// It now posts a real tenant-wide row and fans it out to every member's
// notifications (src/ui/announcements.tsx, which carries the reasoning about
// who counts as a member and why the push is a separate choice).
//
// The session fee is here because three other screens have always said it is.
// Overview, Revenue and Trainers each carry the line "set a session fee in Ops"
// and Ops had no such control — the only caller of `updateTenant` in the whole
// repository was app/onboarding.tsx, so the number every payroll figure is
// multiplied by could be set once, before the owner had used the product, and
// never again. See the note beside the control for what the column held in the
// meantime.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same three tabs, same providers, same actions — the
// bordered box drawn around every announcement, ticket and event became
// hairline-separated rows, and the Georgia serif header is gone.
//
// No hero: this is a three-task console (write · triage · read), not a screen
// with one live number to lead with.
//
// Every list starts empty and fills from real activity — notices the owner
// posts, and tickets from `useOwnerOps` plus real in-app feedback rows.
// Nothing is seeded, so each tab now says so honestly instead of rendering a
// blank stretch of screen.
//
// The Activity tab used to be the exception. Its `activity` was `seedActivity`
// in src/ui/ownerOps.tsx — a module-level `[]` that no code path in this
// repository wrote to — while the copy over it promised that "trials, plan
// changes and suspensions land here as they happen". They could not: the
// actions it named were deleted when this app stopped being a subscription
// console, and nothing replaced them with a write. So an owner watched an empty
// feed for events that were never coming, and would have read the silence as a
// quiet month. It then said so plainly, which was honest and still useless.
//
// It now reads `gym_events` (supabase/parts/105), which is written by DATABASE
// TRIGGERS on the tables that already record the facts — a member joining, a
// coach joining, a session getting an outcome, a promo code being used. Not by
// app code: a log written next to each action is a log with a hole wherever
// somebody forgot one, and an owner reading a gap cannot tell a quiet Tuesday
// from a missing writer. Nothing holds insert rights on it, so it cannot be
// forged either.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, ListRow, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useOwnerOps } from '../../src/ui/ownerOps';
import { useAnnouncements } from '../../src/ui/announcements';
import { deliverySummary, pushConsequence } from '../../src/lib/notifyCopy';
import { fetchAllFeedback, type FeedbackRow } from '../../src/ui/appFeedback';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { useTenant, gymMoney, GYM_CURRENCY } from '../../src/ui/tenant';
import { parseSessionFee, sessionFeeFieldValue } from '../../src/lib/gymSettings';

/**
 * The currencies a gym can be priced in.
 *
 * A short list rather than every ISO code: this is a one-off setup question,
 * and a scroller of 180 options is a worse answer than eight and a note. It is
 * not a closed set in the database — `tenants.currency` is free text — so
 * adding one here is the whole of adding one.
 *
 * currency-ok: this is the list an owner CHOOSES from. Naming currencies is the
 * entire job of a currency picker, and it is the one place in the product where
 * an ISO code beside nothing is correct — nothing here is a figure, and nothing
 * here is applied to a gym until somebody taps it.
 */
const CURRENCIES = ['AED', 'GBP', 'USD', 'EUR', 'SAR', 'AUD', 'CAD', 'ZAR'] as const;
import { capLimit } from '../../src/lib/rowCap';
import { reportError } from '../../src/lib/reportError';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import type { LoadStatus } from '../../src/ui/loadStatus';

/** One row of the gym's event feed. */
interface GymEvent { id: string; kind: string; summary: string; at: string }

/** The mark beside an event — the kinds are a closed set in the CHECK. */
const EVENT_DOT: Record<string, 'brand' | 'good' | 'warn' | 'ink3'> = {
  'member-joined': 'good',
  'trainer-joined': 'brand',
  'session-delivered': 'good',
  'session-missed': 'warn',
  'promo-redeemed': 'brand',
};

function ago(iso: string) {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  if (h < 1) return 'just now'; if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`;
}

/** An honest "nothing here yet" line — these lists genuinely start empty. */
function Empty({ tone, children }: { tone: string; children: string }) {
  return <Text style={{ ...ty.label, color: tone }}>{children}</Text>;
}

export default function OwnerOps() {
  const t = useTheme();
  const router = useRouter();
  // `activity` is deliberately not taken from the provider any more: it is a
  // module-level empty array nothing writes to, and reading it here is what made
  // the Activity tab look like a feed waiting for its first event.
  // The announcement half of `useOwnerOps` is gone from this screen. It was a
  // module-level useState — a notepad the owner was told, in the button's own
  // confirmation, did not reach anybody. Notices now go through the real table
  // (src/ui/announcements.tsx); only the ticket half of that provider is read
  // here.
  const { tickets, resolveTicket, openTickets } = useOwnerOps();
  const { addGymAnnouncement, mine: myNotices, status: noticeStatus } = useAnnouncements();

  // ── the session fee ──────────────────────────────────────────────────────
  //
  // Overview, Revenue and Trainers have all told the owner to "set a session
  // fee in Ops" since the day they were written, and Ops has never had a
  // control. `updateTenant` had exactly one caller in the repository —
  // app/onboarding.tsx — so the fee was settable once, on the single screen an
  // owner sees before they have any idea what a session is worth to them, and
  // never again.
  //
  // It was worse than unset. `tenants.session_fee` was `not null default 75`
  // until part 118, so every gym in the live database held a 75 (checked: all
  // 31 of them, none of them chosen) and payroll, value-per-client and the
  // revenue hero were all quietly multiplying by it. The fallback copy those
  // three screens carry for a null fee could never have drawn.
  const { tenant, status: tenantStatus, updateTenant } = useTenant();
  const cur = tenant?.currency ?? null;
  // Null means "the owner has not touched the field", so it mirrors the tenant
  // as that read lands. A useState seeded from `tenant` would seed from null —
  // the provider is still in flight when this screen mounts — and then never
  // catch up.
  const [feeDraft, setFeeDraft] = useState<string | null>(null);
  const feeField = feeDraft ?? sessionFeeFieldValue(tenant?.sessionFee ?? null);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeMsg, setFeeMsg] = useState<{ bad: boolean; text: string } | null>(null);
  // Under 'error' the fee we hold is not the gym's answer, so the field must not
  // be offered as one: saving over it would write a value read off a failed
  // read. 'partial' cannot happen here — it is a single row — but worstStatus
  // semantics are respected by asking for 'ready' rather than not-'error'.
  const feeKnown = tenantStatus === 'ready' && !!tenant;
  const saveFee = async () => {
    const parsed = parseSessionFee(feeField);
    if (parsed.kind === 'bad') { setFeeMsg({ bad: true, text: parsed.reason }); return; }
    const next = parsed.kind === 'clear' ? null : parsed.fee;
    setFeeBusy(true); setFeeMsg(null);
    // updateTenant checks the row COUNT, not just the absence of an error — a
    // refused UPDATE under RLS raises nothing and touches nothing.
    const saved = await updateTenant({ sessionFee: next });
    setFeeBusy(false);
    if (!saved) {
      setFeeMsg({ bad: true, text: 'Not saved. Your session fee is unchanged — nothing on the other screens has moved.' });
      return;
    }
    setFeeDraft(null);
    setFeeMsg({
      bad: false,
      text: next == null
        ? 'Session fee cleared. Delivered sessions are shown as a count until you set one again.'
        // The fee saved either way; the confirmation just cannot name an amount
        // in a currency this gym has not chosen, and gymMoney returns null
        // rather than picking one.
        : gymMoney(next, cur) == null
        ? `Saved. Set your gym's currency below and every delivered session will be valued at ${next}.`
        : `Saved. Every delivered session is now valued at ${gymMoney(next, cur)}.`,
    });
  };

  // ── resolving a support ticket ───────────────────────────────────────────
  //
  // `localResolved` below was the whole of it: a key in component state, no
  // write anywhere, so every ticket an owner marked resolved came back on the
  // next open. An inbox you cannot work through is an inbox nobody works
  // through. Part 118 adds `feedback.resolved_at` and a resolve_feedback() RPC
  // — an RPC rather than an UPDATE policy because RLS cannot restrict which
  // columns an update touches, and the value of this inbox is that the words in
  // it are the tester's.
  //
  // Read separately from fetchAllFeedback() rather than through it: that
  // function is shared with the Feedback screen and its row shape is not this
  // screen's to change.
  //
  // null is "not known", not "none resolved" — the same distinction the inbox
  // read itself carries three lines down.
  const [resolvedAt, setResolvedAt] = useState<Record<string, string> | null>(null);
  // Which of the two nulls that is — still reading, or refused. Same pair the
  // inbox read carries, for the same reason.
  const [resolvedFailed, setResolvedFailed] = useState(false);
  useEffect(() => {
    if (!USE_SUPABASE) { setResolvedAt({}); return; }
    let off = false;
    (async () => {
      const { data, error } = await supabase.from('feedback').select('id, resolved_at')
        .order('created_at', { ascending: false }).limit(capLimit());
      if (off) return;
      if (error) { reportError('ownerOps.resolved', error); setResolvedAt(null); setResolvedFailed(true); return; }
      const map: Record<string, string> = {};
      for (const r of data ?? []) { if (r.resolved_at) map[String(r.id)] = String(r.resolved_at); }
      setResolvedAt(map); setResolvedFailed(false);
    })();
    return () => { off = true; };
  }, []);

  // The feed. Read here rather than through a provider because exactly one
  // screen shows it, and a provider would be a second place for it to go stale.
  const [events, setEvents] = useState<GymEvent[]>([]);
  const [evStatus, setEvStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  useEffect(() => {
    if (!USE_SUPABASE) { setEvStatus('ready'); return; }
    let off = false;
    (async () => {
      // No tenant filter: `gym_events_owner_read` is `is_owner_of(tenant_id)`,
      // so the policy already returns this owner's gym and nobody else's.
      const { data, error } = await supabase
        .from('gym_events').select('id, kind, summary, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (off) return;
      if (error) { reportError('ownerOps.events', error); setEvStatus('error'); return; }
      setEvents((data ?? []).map((r: any) => ({
        id: String(r.id), kind: String(r.kind), summary: String(r.summary), at: String(r.created_at),
      })));
      setEvStatus('ready');
    })();
    return () => { off = true; };
  }, []);
  // null is the inbox we do not have: it is the initial value AND what
  // fetchAllFeedback returns for a refused read, which is deliberate — see the
  // note on that function. It used to be collapsed here with `d ?? []`, one line
  // under a comment saying null means unread rather than empty, and the tab then
  // asserted "No tickets. Feedback sent from inside the app lands here." That is
  // the sentence you least want to be wrong about during a test round: it says
  // the testers are silent when what happened is that we could not hear them.
  const [fbRows, setFbRows] = useState<FeedbackRow[] | null>(null);
  // Which of the two nulls this is. Without it "still reading" and "the read
  // came back refused" draw the same screen and neither can be acted on.
  const [fbFailed, setFbFailed] = useState(false);
  // The await is guarded: an unhandled rejection here left the support inbox on
  // its initial [] with no record that anything had gone wrong, and the tab
  // stated "No tickets." over a read that never returned.
  useEffect(() => {
    let c = false;
    (async () => {
      try { const d = await fetchAllFeedback(); if (!c) { setFbRows(d); setFbFailed(d === null); } }
      catch (e) { reportError('ownerOps.feedback', e); if (!c) { setFbRows(null); setFbFailed(true); } }
    })();
    return () => { c = true; };
  }, []);
  // BOTH reads. Which tickets there are, and which of them are dealt with, are
  // two questions and the tab answers with both — "3 open" over a resolved-state
  // read that failed is every ticket counted as open, which reads as a backlog
  // that is not there.
  const inboxKnown = fbRows != null && resolvedAt != null;
  const fbTickets = (fbRows ?? []).map((r) => ({
    id: 'fb' + r.id,
    subject: (r.category || 'Feedback') + (r.rating ? ' · ' + '★'.repeat(r.rating) : ''),
    from: (r.role || 'Client') + (r.appVersion ? ' · v' + r.appVersion : ''),
    body: r.body,
    resolved: !!resolvedAt?.[r.id],
  }));
  const allTickets = [...fbTickets, ...tickets];
  // 'fb' + the feedback row's id is the ticket id this screen shows; the RPC
  // wants the row's own id back.
  const resolveAny = async (id: string) => {
    if (!id.startsWith('fb')) { resolveTicket(id); return; }
    const rowId = id.slice(2);
    if (!USE_SUPABASE) { setResolvedAt((p) => ({ ...(p ?? {}), [rowId]: new Date().toISOString() })); return; }
    const { data, error } = await supabase.rpc('resolve_feedback', { p_id: rowId, p_resolved: true });
    if (error || !data) {
      if (error) reportError('ownerOps.resolveTicket', error);
      Alert.alert('Not resolved', 'This ticket is still open — nothing was saved. Try again in a moment.');
      return;
    }
    setResolvedAt((p) => ({ ...(p ?? {}), [rowId]: String(data) }));
  };
  const openCount = allTickets.filter((x) => !x.resolved).length;
  const [tab, setTab] = useState<'announce' | 'support' | 'activity'>('announce');
  const [text, setText] = useState('');
  // Off by default: the notice reaches every member's notifications either way,
  // and the push is the part that rings a phone at whatever hour it is where
  // they are.
  const [annPush, setAnnPush] = useState(false);
  const [annBusy, setAnnBusy] = useState(false);
  const [openT, setOpenT] = useState<string | null>(null);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Platform</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Operations</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your session fee · notices to members · support · gym activity</Text>
        </View>

        {/* ── the three jobs this screen does ────────────────────────────── */}
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3, marginTop: sp.lg }}>
          {/* The open count is only offered when the inbox is actually in hand:
              a badge counting the tickets we managed to read is a smaller
              number than the truth, and reads as the whole of it. */}
          {([['announce', 'Announce'], ['support', `Support${inboxKnown && openCount ? ' (' + openCount + ')' : ''}`], ['activity', 'Activity']] as const).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: tab === k ? t.brand : 'transparent' }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: tab === k ? t.brandInk : t.ink3 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'announce' ? (
          <View>
            {/* ── the session fee three other screens send owners here for ──── */}
            <Section>
              <SectionHead title="Session Fee"
                note={feeKnown && tenant?.sessionFee != null ? (gymMoney(tenant.sessionFee, cur) ?? undefined) : undefined} />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                What one delivered session is worth. Payroll, value per client and every "at your session fee"
                figure on Overview, Revenue and Trainers is counted against this.
              </Text>
              {tenantStatus === 'loading' ? (
                <Empty tone={t.ink3}>Reading your gym…</Empty>
              ) : tenantStatus === 'error' ? (
                // An empty field under a failed read is not "no fee set", and
                // saving over it would write a value read off a failure.
                <Empty tone={t.warn}>
                  Your gym could not be read, so the fee it currently holds is not known — this is not a
                  statement that none is set. Nothing can be changed until it can be read.
                </Empty>
              ) : !tenant ? (
                <Empty tone={t.ink3}>This account is not attached to a gym, so there is no fee to set.</Empty>
              ) : (<>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <Text style={{ ...ty.label, color: t.ink3 }}>{cur ?? GYM_CURRENCY}</Text>
                  <TextInput value={feeField} onChangeText={(v) => { setFeeDraft(v); if (feeMsg) setFeeMsg(null); }}
                    placeholder="Not set" placeholderTextColor={t.ink3} keyboardType="decimal-pad"
                    accessibilityLabel={`Session fee in ${cur ?? GYM_CURRENCY}`}
                    style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1 }} />
                </View>
                {cur ? null : (<>
                  {/* The gym has not set `tenants.currency`, and until tonight
                      NOTHING IN THE PRODUCT COULD. `updateTenant` was the only
                      write to `tenants` anywhere and its type excluded the
                      column, while half a dozen screens told the owner "an
                      owner sets it in the gym settings" over a control that did
                      not exist. A coach at such a gym cannot price a package at
                      all. So the ask is here, next to the fee it denominates. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    Your gym has not told us what it charges in, so figures are shown in {GYM_CURRENCY} — what
                    the rest of its operating record is recorded in. Set it once and every screen follows.
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
                    {CURRENCIES.map((c) => (
                      <Pressable key={c} onPress={async () => {
                        const saved = await updateTenant({ currency: c });
                        setFeeMsg(saved
                          ? { bad: false, text: `Your gym is priced in ${c}. Existing figures were already recorded in ${GYM_CURRENCY}; this changes what new ones are written as.` }
                          : { bad: true, text: 'Not saved. Your gym still has no currency set.' });
                      }} accessibilityRole="button" accessibilityLabel={`Price this gym in ${c}`}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                        <Text style={{ ...ty.label, ...numeric, color: t.ink2 }}>{c}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>)}
                {feeMsg ? (
                  feeMsg.bad
                    ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{feeMsg.text}</Flag>
                    : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{feeMsg.text}</Text>
                ) : (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    {tenant.sessionFee == null
                      ? 'Not set. Until it is, delivered sessions are counted but not valued.'
                      : 'Clear the field and save to withdraw it — an empty fee is not a fee of zero.'}
                  </Text>
                )}
                <View style={{ marginTop: sp.lg }}>
                  <Cta wide label={feeBusy ? 'Saving…' : 'Save Session Fee'} disabled={feeBusy}
                    onPress={() => { void saveFee(); }} />
                </View>
              </>)}
            </Section>

            <Rule />

            <Section>
          <ListRow icon="calendar" title="Trainer Rota" note="Who is on the floor when, against what is booked"
            onPress={() => router.push('/(owner)/rota')} />
          <ListRow icon="wrench" title="Equipment Register" note="What the gym owns, and what is due a service"
            onPress={() => router.push('/(owner)/equipment')} />
          <ListRow icon="dumbbell" title="Exercise Library" note="Every movement the app can teach, and the kit each one needs"
            onPress={() => router.push('/(owner)/library')} />
          <ListRow icon="clock" title="Deletion Requests" note="Members who asked to be erased, and the 30-day clock"
            onPress={() => router.push('/(owner)/deletions')} />
          <ListRow icon="settings" title="Settings" note="Who you are signed in as, your data, and deleting your account"
            onPress={() => router.push('/(owner)/settings')} />
          <ListRow icon="search" title="User Guide" note="What each tab does, any time"
            onPress={() => router.push('/guide')} />
        </Section>

        {/* ── a notice to the gym's members ─────────────────────────────────
                This section used to write to a `useState` in src/ui/ownerOps.tsx
                and say so — "Saved to this device only — announcements do not
                reach trainers yet" — which was at least honest about being a
                notepad. It now posts a real row to `announcements` with this
                gym's tenant_id, which `ann_write` admits only for an owner of
                that tenant, and fans it out to every member's notifications.

                WHO GETS IT: every member row in this gym, from all_member_ids()
                — the same list the promotions push uses. Not "active members":
                `clients` has no such column, and `memberships` (which does)
                covered one client row in ten in the live database, so an
                "active only" rule would silently drop nine members in ten from
                a closure notice. See src/ui/announcements.tsx for the whole
                argument.

                It reaches MEMBERS, not trainers. The old copy promised trainers
                and there is still no trainer-facing reader for one, so saying
                "trainers" here would be the same false sentence in a new
                direction. */}
            <Section>
              <SectionHead title="Notice to Members" />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                Every member of your gym sees this in their notifications and on their Notices screen, where it stays after today.
              </Text>
              <TextInput value={text} onChangeText={setText} placeholder="e.g. We are closed Monday for the public holiday…" placeholderTextColor={t.ink3} multiline
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, minHeight: 80, textAlignVertical: 'top', marginBottom: sp.md }} />

              {/* The push is a separate decision with its consequence written
                  on it. An owner who can ring every phone in the building is
                  exactly the capability worth being plain about, and this app
                  has no scheduler and no record of anybody's timezone — so the
                  only truthful offer is "now, wherever they are". */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, color: t.ink }}>Also send a push</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{pushConsequence('gym', null)}</Text>
                </View>
                <Switch value={annPush} onValueChange={setAnnPush} />
              </View>

              <View pointerEvents={annBusy ? 'none' : 'auto'} style={{ opacity: annBusy ? 0.6 : 1 }}>
                <Cta wide label={annBusy ? 'Posting…' : 'Post to Members'}
                  onPress={async () => {
                    if (!text.trim()) { Alert.alert('Write something', 'Enter an announcement.'); return; }
                    setAnnBusy(true);
                    let res;
                    try { res = await addGymAnnouncement(text, { push: annPush }); } finally { setAnnBusy(false); }
                    // The text stays in the box on a failure: they wrote it
                    // once, and a cleared field after a refused write is how a
                    // notice gets lost between the owner and the server.
                    if (!res.ok || !res.delivery) {
                      Alert.alert('Not posted', 'That could not be posted, so no member has seen it. Your words are still here — try again in a moment.');
                      return;
                    }
                    setText(''); setAnnPush(false);
                    Alert.alert('Posted', deliverySummary(res.delivery));
                  }} />
              </View>
            </Section>

            <Rule />

            <Section>
              {/* The count is only stated over a whole read. Under 'error' the
                  list in hand is whatever survived, and "0 sent" to an owner
                  who posted three on Friday is the sentence
                  src/ui/loadStatus.ts exists to stop. */}
              <SectionHead title="Sent" note={noticeStatus === 'ready' && myNotices.length ? `${myNotices.length} sent` : undefined} />
              {noticeStatus === 'error' ? (
                <Empty tone={t.ink3}>Your notices could not be read just now. This is not a statement that you have sent none.</Empty>
              ) : myNotices.length === 0 ? (
                <Empty tone={t.ink3}>
                  {noticeStatus === 'loading' ? 'Reading your notices…' : 'Nothing sent yet — notices you post appear here.'}
                </Empty>
              ) : myNotices.map((a, i) => (
                <View key={a.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.body, color: t.ink2 }}>{a.body}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{ago(a.at)}</Text>
                </View>
              ))}
            </Section>
          </View>
        ) : tab === 'support' ? (
          <View>
            <Section>
              {/* "All resolved" is a claim about every ticket there is, so it
                  needs the whole inbox behind it. */}
              <SectionHead title="Support Inbox" note={inboxKnown && allTickets.length ? (openCount ? `${openCount} open` : 'All resolved') : undefined} />
              {fbFailed ? (
                // Tickets held on this device still show below — they are real —
                // but they are not the inbox, and saying nothing here would let
                // however many of them there are stand in for all of it.
                <Empty tone={t.warn}>
                  The support inbox could not be read. This is not "no tickets" — feedback sent from inside the app
                  may be waiting, and nothing on this screen has ruled that out.
                </Empty>
              ) : resolvedFailed ? (
                // The tickets below are real and complete; which of them are
                // dealt with is not known. Every one of them is therefore drawn
                // as open, and that is a claim this read cannot support.
                <Empty tone={t.warn}>
                  Which of these you have already dealt with could not be read, so they are all shown as open.
                  Some of them may not be.
                </Empty>
              ) : !inboxKnown ? (
                <Empty tone={t.ink3}>Reading the support inbox…</Empty>
              ) : allTickets.length === 0 ? (
                <Empty tone={t.ink3}>No tickets. Feedback sent from inside the app lands here.</Empty>
              ) : null}
              {allTickets.map((tk, i) => {
                const open = openT === tk.id;
                return (
                  <View key={tk.id} style={{ borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring, opacity: tk.resolved ? 0.6 : 1 }}>
                    <Pressable onPress={() => setOpenT(open ? null : tk.id)} style={{ paddingVertical: sp.md }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        {tk.resolved ? null : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />}
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{tk.subject}</Text>
                        {tk.resolved ? <Text style={{ ...ty.micro, color: t.ink3 }}>Resolved</Text> : null}
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{tk.from}</Text>
                    </Pressable>
                    {open ? (
                      <View style={{ paddingBottom: sp.md }}>
                        <Text style={{ ...ty.label, color: t.ink2 }}>{tk.body}</Text>
                        {!tk.resolved ? (
                          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                            <Cta label="Mark Resolved" onPress={() => { void resolveAny(tk.id); }} />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Section>
          </View>
        ) : (
          <View>
            <Section>
              <SectionHead title="Your Gym" note={evStatus === 'ready' && events.length ? String(events.length) : undefined} />
              {evStatus === 'error' ? (
                // An empty list under 'error' means the read failed. Saying "no
                // activity" there would tell an owner their gym was quiet, which
                // is the single most misleading thing this screen could say.
                <Empty tone={t.ink3}>
                  The feed could not be read just now. This is not a statement that nothing happened.
                </Empty>
              ) : evStatus === 'loading' ? (
                <Empty tone={t.ink3}>Loading.</Empty>
              ) : events.length === 0 ? (
                <Empty tone={t.ink3}>
                  Nothing yet. Members joining, coaches joining, sessions marked delivered or missed, and
                  promo codes being used all land here as they happen.
                </Empty>
              ) : events.map((e, i) => {
                const tone = EVENT_DOT[e.kind] === 'good' ? t.good
                  : EVENT_DOT[e.kind] === 'warn' ? t.warn
                    : EVENT_DOT[e.kind] === 'brand' ? t.brand : t.ink3;
                return (
                  <View key={e.id} style={{
                    flexDirection: 'row', alignItems: 'center', gap: sp.md,
                    paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                  }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />
                    <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{e.summary}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{ago(e.at)}</Text>
                  </View>
                );
              })}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Written by the database as things happen, so nothing here was typed by anyone and nothing
                can be missed by a screen forgetting to record it. The most recent hundred.
              </Text>
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
