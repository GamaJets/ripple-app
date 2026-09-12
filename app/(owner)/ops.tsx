// Owner · Operations. The session fee, where the gym is, notices to members, a
// support inbox and the gym's activity log.
//
// WHERE THE GYM IS was added last and is the one setting on this screen that
// is WRONG rather than empty while it is unset. `tenants.timezone` had a single
// writer in the whole product — the web console — and all 54 gyms in the live
// database had it null, so six console screens print the words "in the gym's
// own timezone" over figures bucketed on whichever laptop is open. See the
// section itself, and src/lib/zonePicker.ts for why the picker refuses to offer
// `Etc/GMT+4` and why there is no "use this phone's zone" button.
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
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, Switch, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, ListRow, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useOwnerOps } from '../../src/ui/ownerOps';
import { useAnnouncements } from '../../src/ui/announcements';
import { deliverySummary, pushConsequence } from '../../src/lib/notifyCopy';
import { fetchAllFeedbackPage, type FeedbackRow } from '../../src/ui/appFeedback';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { useTenant, gymMoney, GYM_CURRENCY } from '../../src/ui/tenant';
import { parseSessionFee, sessionFeeFieldValue } from '../../src/lib/gymSettings';
import { fetchGymMerchant, merchantState, startGymOnboarding, type GymMerchant } from '../../src/lib/gymMerchant';
import { Fetched } from '../../src/ui/fetched';
import { oldestFetch } from '../../src/lib/freshness';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { WEB_ORIGIN } from '../../src/lib/deepLink';

/*
 * The currencies a gym can be priced in — THE SHARED LIST, at last.
 *
 * This was its own literal: `['AED', 'GBP', 'USD', 'EUR', 'SAR', 'AUD', 'CAD',
 * 'ZAR']`. Eight codes, every one of them a hundredths currency, defended above
 * as "a short list rather than every ISO code… a scroller of 180 options is a
 * worse answer than eight and a note".
 *
 * The note was the problem. Ops is the ONLY place in this product a gym's
 * currency can be set, so an owner in Japan, Korea, Kuwait, Bahrain or Oman had
 * two options: pick money they do not charge in, or leave the gym unpriced —
 * and unpriced blocks the payment form, the plan form, payroll and the close.
 * "Adding one here is the whole of adding one" is true and it is not something
 * an owner in Tokyo can do at eight in the morning.
 *
 * `CURRENCY_CHOICES` in src/lib/coachCurrency.ts is forty codes covering every
 * member of `ZERO_DECIMAL` and `THREE_DECIMAL`, and its own header named this
 * file and predicted this exact defect: "two pickers writing currencies into
 * one product that offer different sets is a coach and their owner disagreeing
 * about what money exists — and until it does, a gym owner in Tokyo has the
 * same problem this list has just fixed for a coach." It does now.
 *
 * Forty rather than eight is not a scroller: they are pill chips in a wrapping
 * row, alphabetical, the same control the coach's picker draws from the same
 * constant. Alphabetical matters — any other order nominates a favourite, and
 * the eight opened with AED for no reason except where this product was written.
 *
 * currency-ok: this is the list an owner CHOOSES from. Naming currencies is the
 * entire job of a currency picker, and it is the one place in the product where
 * an ISO code beside nothing is correct — nothing here is a figure, and nothing
 * here is applied to a gym until somebody taps it.
 */
import { CURRENCY_CHOICES } from '../../src/lib/coachCurrency';
import { capLimit, capped } from '../../src/lib/rowCap';

/** How far back the gym's activity feed reaches. A BOUND — the screen says
 *  "the most recent hundred" — and a read that comes back at it is a prefix,
 *  which is 'partial' rather than 'ready'. */
const EVENT_LIMIT = 100;
import { reportError } from '../../src/lib/reportError';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
/* ── where the gym is ──────────────────────────────────────────────────────
 *
 * `tenants.timezone` (supabase/parts/710) had exactly one writer in the whole
 * product — the web console's Gym settings screen — and on 4 September 2026
 * all 54 gyms in the live database had it null. Six console screens print the
 * words "in the gym's own timezone" over figures bucketed with the READER's
 * clock while it is unset, and this app, the one an owner actually carries,
 * could not set it at all.
 *
 * The write goes through `saveGymProfile` rather than `updateTenant`: the
 * provider's patch type does not admit the column (src/ui/tenant.tsx), and
 * `saveGymProfile` already carries the rule that matters — it checks the row
 * COUNT, so an UPDATE that RLS matched nothing against is reported as a
 * refusal instead of drawing "Saved" over an unchanged row.
 */
import { saveGymProfile } from '../../src/lib/gymPolicy';
import {
  parseGymZone, zoneOptions, gymTimeLabel, gymDay, readerZone, fetchGymZone,
} from '../../src/lib/gymZone';
import { searchZones, NO_ZONE_LIST_NOTE, type ZoneChoice } from '../../src/lib/zonePicker';

/** One row of the gym's event feed. */
interface GymEvent { id: string; kind: string; summary: string; at: string }

/** The mark beside an event — the kinds are a closed set in the CHECK. */
/**
 * The dot beside a feed entry.
 *
 * A kind that is not in here falls to `ink3`, which is the right default and is
 * why this map does not have to be complete — the SUMMARY says what happened,
 * and the colour is a second channel, never the only one.
 *
 * supabase/parts/187 widens `gym_events` from five kinds to nineteen: money
 * recorded and corrected, a price changed, a membership cancelled or frozen,
 * payroll settled and reversed, equipment retired, a month closed and reopened,
 * and the whole record exported. The ones that carry weight are marked; the
 * rest arrive in ink and read perfectly well.
 */
const EVENT_DOT: Record<string, 'brand' | 'good' | 'warn' | 'ink3'> = {
  'member-joined': 'good',
  'trainer-joined': 'brand',
  'session-delivered': 'good',
  'session-missed': 'warn',
  'promo-redeemed': 'brand',
  'payment-recorded': 'good',
  // The four an owner scanning a week would want to stop on: money taken back,
  // a membership ending, a payroll run withdrawn, and every member's record
  // leaving the platform.
  'payment-corrected': 'warn',
  'membership-cancelled': 'warn',
  'payroll-reversed': 'warn',
  'record-exported': 'warn',
  'invoice-raised': 'brand',
  'price-changed': 'brand',
  'payroll-settled': 'good',
  'month-closed': 'brand',
  'month-reopened': 'warn',
  'equipment-out-of-service': 'warn',
};

function ago(iso: string) {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  if (h < 1) return 'just now'; if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`;
}

/** An honest "nothing here yet" line — these lists genuinely start empty. */
/**
 * One zone, offered.
 *
 * The clock is on the row rather than only on the stored value, because the
 * choice is made HERE: an owner picking between Europe/London and
 * Europe/Lisbon is choosing between 14:32 and 14:32 in March and 14:32 and
 * 13:32 in July, and the row is where that is visible. A null clock means this
 * runtime cannot resolve the zone, and the row says so instead of drawing a
 * blank beside a name.
 */
function ZoneRow({ zone, where, tick, busy, onPress }: {
  zone: string; where: string; tick: number | null; busy: boolean; onPress: () => void;
}) {
  const t = useTheme();
  const clock = gymTimeLabel(tick, zone);
  const city = zone.split('/').slice(-1)[0].replace(/_/g, ' ');
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button"
      accessibilityLabel={clock ? `Set this gym to ${zone}, where it is ${clock}` : `Set this gym to ${zone}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, opacity: busy ? 0.5 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, color: t.ink }}>{city}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{where ? `${where} · ${zone}` : zone}</Text>
      </View>
      <Text style={{ ...ty.label, ...numeric, color: clock ? t.ink2 : t.ink3 }}>
        {clock ?? 'no clock'}
      </Text>
    </Pressable>
  );
}

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
  const { addGymAnnouncement, mine: myNotices, status: noticeStatus, reload: reloadNotices } = useAnnouncements();

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
  const { tenant, status: tenantStatus, updateTenant, refresh: refreshTenant } = useTenant();
  const cur = tenant?.currency ?? null;
  // Null means "the owner has not touched the field", so it mirrors the tenant
  // as that read lands. A useState seeded from `tenant` would seed from null —
  // the provider is still in flight when this screen mounts — and then never
  // catch up.
  const [feeDraft, setFeeDraft] = useState<string | null>(null);
  const feeField = feeDraft ?? sessionFeeFieldValue(tenant?.sessionFee ?? null, tenant?.currency ?? null);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeMsg, setFeeMsg] = useState<{ bad: boolean; text: string } | null>(null);

  /* ── what a late class cancellation costs ────────────────────────────────
     src/lib/classCancel.ts has told every member since it was written that
     "this app does not hold that policy", because there was no column and no
     screen. supabase/parts/2615 is the column; this is the screen.

     Two fields and both clearable, because null is a real state an owner may
     want to return to: it produces the honest "we do not hold your gym's
     policy" sentence rather than a claim. An empty notice field is NOT a
     zero-hour window and an empty fee is NOT a free cancellation — both of
     those are things a gym can state, and stating them is a different act
     from never having said. */
  const [noticeDraft, setNoticeDraft] = useState<string | null>(null);
  const [cancelFeeDraft, setCancelFeeDraft] = useState<string | null>(null);
  const noticeField = noticeDraft ?? (tenant?.classCancelHours == null ? '' : String(tenant.classCancelHours));
  const cancelFeeField = cancelFeeDraft ?? (tenant?.classCancelFee == null ? '' : String(tenant.classCancelFee));
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState<{ bad: boolean; text: string } | null>(null);

  /* ── whether the gym can take a card at all ──────────────────────────────
     null is "no account row", which is every gym today and a real, sayable
     state. It is NOT the same as a read that failed, and `merchantStatus`
     carries that difference: an owner told they have not set this up when the
     read simply did not land would set it up a second time, and a gym with two
     connected accounts has its takings split across two ledgers that cannot be
     merged. */
  const [merchant, setMerchant] = useState<GymMerchant | null>(null);
  const [merchantStatus, setMerchantStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [merchantBusy, setMerchantBusy] = useState(false);
  const [merchantMsg, setMerchantMsg] = useState<string | null>(null);
  /** Bumped by the Refresh control. */
  const [merchantTick, setMerchantTick] = useState(0);
  /**
   * Bumped by the same control, and read by the three effects below that had no
   * way to be run twice at all: the resolved-ticket map, the gym event feed and
   * the support inbox. All three were `useEffect(..., [])` — read once at mount
   * and then fixed for the life of the screen — on the console tab an owner
   * leaves open on a desk all day. The Refresh line only ever re-read the
   * merchant row, so "Read just now" sat over a support inbox from this morning.
   */
  const [readTick, setReadTick] = useState(0);
  /** When the merchant read LANDED. `r.ok` only — a refusal leaves the stamp
   *  on the answer currently on screen, which is what "payouts are on" was
   *  read off. */
  const [merchantAt, setMerchantAt] = useState<number | null>(null);
  /** And the other three server reads on this tab, each stamped where it lands
   *  and each leaving the stamp alone when it does not. */
  const [resolvedAtStamp, setResolvedAtStamp] = useState<number | null>(null);
  const [eventsAt, setEventsAt] = useState<number | null>(null);
  const [inboxAt, setInboxAt] = useState<number | null>(null);
  const [noticesAt, setNoticesAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!USE_SUPABASE) { setMerchantStatus('ready'); return; }
      if (!tenant?.id) { if (tenantStatus !== 'loading') setMerchantStatus(tenantStatus === 'error' ? 'error' : 'ready'); return; }
      setMerchantStatus('loading');
      const r = await fetchGymMerchant(supabase as any, tenant.id);
      if (!live) return;
      if (r.ok) { setMerchant(r.value); setMerchantStatus('ready'); setMerchantAt(Date.now()); }
      else { reportError('ops.gymMerchant', new Error(r.reason)); setMerchantStatus('error'); }
    })();
    return () => { live = false; };
  }, [tenant?.id, tenantStatus, merchantTick]);

  /**
   * Start or resume the gym's Stripe onboarding.
   *
   * The return pages are the same two the coach flow uses and neither
   * congratulates anybody: reaching `return_url` means the owner LEFT Stripe's
   * hosted flow, not that it succeeded, and the honest source of truth is what
   * `account.updated` writes back onto the row. So the account is re-read when
   * they come back to this screen rather than assumed to be live.
   */
  const openStripeSetup = async () => {
    setMerchantBusy(true);
    setMerchantMsg(null);
    const r = await startGymOnboarding(supabase as any, {
      refreshUrl: `${WEB_ORIGIN}/connect-refresh`,
      returnUrl: `${WEB_ORIGIN}/connect-return`,
    });
    setMerchantBusy(false);
    if (!r.ok) { setMerchantMsg(r.error || 'Stripe setup could not be opened. Nothing has changed.'); return; }
    try { await Linking.openURL(r.url); } catch { setMerchantMsg('Stripe setup could not be opened in a browser. Nothing has changed.'); }
  };
  // Under 'error' the fee we hold is not the gym's answer, so the field must not
  // be offered as one: saving over it would write a value read off a failed
  // read. 'partial' cannot happen here — it is a single row — but worstStatus
  // semantics are respected by asking for 'ready' rather than not-'error'.
  /* ── where this gym is ────────────────────────────────────────────────────
   *
   * Its own read, and three states rather than two: `zoneErr` set means nobody
   * could ask, `zone` null with no error means the gym has not said. Rendering
   * the first as the second would tell an owner their gym has no timezone on
   * the strength of a query that never answered, and they would set one that
   * is already set — over the top of whatever is really there.
   */
  const [zone, setZone] = useState<string | null>(null);
  const [zoneErr, setZoneErr] = useState<string | null>(null);
  const [zoneRead, setZoneRead] = useState(false);
  const [zoneQuery, setZoneQuery] = useState('');
  const [zoneBusy, setZoneBusy] = useState(false);
  const [zoneMsg, setZoneMsg] = useState<{ bad: boolean; text: string } | null>(null);
  /**
   * A clock, ticking, beside the zone.
   *
   * The one test of this setting a person can actually perform: nobody can
   * check whether 'Asia/Dubai' is the right STRING, and anybody can check
   * whether the time next to it matches the clock on the wall behind them. The
   * console does the same thing for the same reason.
   *
   * Fifteen seconds rather than one: the label has minute resolution, and a
   * per-second timer on a screen an owner leaves open is a battery cost for a
   * digit that does not change.
   */
  const [tick, setTick] = useState<number | null>(null);
  useEffect(() => {
    setTick(Date.now());
    const id = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      // Settled either way. Without this the demo build — which has no
      // Supabase at all — sits on "Reading your gym…" for ever, which is the
      // one sentence that means "wait, this is coming".
      if (!USE_SUPABASE) { setZoneRead(true); return; }
      if (!tenant?.id) return;
      const r = await fetchGymZone(supabase as any, tenant.id);
      if (!live) return;
      setZone(r.zone); setZoneErr(r.error); setZoneRead(true);
    })();
    return () => { live = false; };
  }, [tenant?.id, readTick]);

  /**
   * Every zone this runtime knows, minus the ones a gym must never be in.
   *
   * Empty is a real answer — `zoneOptions()` returns `[]` on a runtime without
   * `Intl.supportedValuesOf`, which is a live possibility on Hermes — and the
   * screen then offers a typed field with `NO_ZONE_LIST_NOTE` beside it rather
   * than an empty picker. `parseGymZone` is the gate either way.
   */
  const zoneAll = zoneOptions();
  const zoneHits: ZoneChoice[] = searchZones(zoneAll, zoneQuery);
  /** What the owner has typed, when it is itself a valid zone name. This is
   *  what makes the screen usable at all on a runtime with no list: the field
   *  is a search AND the field. */
  const typedZone = parseGymZone(zoneQuery);
  /**
   * Replacing a zone is asked about; setting the first one is not.
   *
   * Setting a zone for the first time only ever improves what is on the
   * screens — before it, every date was drawn on whichever machine read it.
   * CHANGING one moves the boundary of every month that has already been
   * closed: a class at 23:30 on the 31st can leave the month it was filed in.
   * That is not irreversible, and it is not obvious either, so the question is
   * asked and it names both zones rather than saying "are you sure".
   */
  const askZone = (next: string) => {
    if (!zone || zone === next) { void saveZone(next); return; }
    Alert.alert(
      'Change this gym’s timezone?',
      `This gym is measured in ${zone}. Changing it to ${next} re-cuts every day, month and payroll period in the owner console — including months already closed, where a late class can move into the month next door.`,
      [
        { text: 'Keep ' + zone, style: 'cancel' },
        { text: 'Use ' + next, style: 'destructive', onPress: () => { void saveZone(next); } },
      ],
    );
  };

  const saveZone = async (next: string) => {
    if (!tenant?.id) return;
    setZoneBusy(true); setZoneMsg(null);
    try {
      // The count is checked inside `saveGymProfile`, so a refused UPDATE
      // arrives here as a throw rather than as a silent success.
      await saveGymProfile(supabase as any, tenant.id, { timezone: next });
      setZone(next); setZoneQuery(''); setZoneErr(null);
      setZoneMsg({
        bad: false,
        text: `This gym’s day is now measured in ${next}. Every date and time on the owner console — the month close, the payroll month, footfall by hour — is drawn on it from here on, and figures already on a screen change when it is next read.`,
      });
    } catch (e: any) {
      reportError('ops.saveZone', e);
      setZoneMsg({
        bad: true,
        text: zone
          ? `Not saved. This gym is still measured in ${zone}.`
          : 'Not saved. This gym still has no timezone, so every date in the console is still drawn on whichever machine it is read from.',
      });
    } finally { setZoneBusy(false); }
  };

  const feeKnown = tenantStatus === 'ready' && !!tenant;
  /**
   * Save the class cancellation policy, or withdraw it.
   *
   * Parsed here rather than trusted: an empty field is null (withdrawn), and a
   * value that is not a number refuses IN PLACE rather than writing NaN, which
   * PostgREST would send as a null and which would silently look like a
   * withdrawal. The database checks the range again — negative, or over two
   * weeks of notice, is refused there too — so a value that got past this is
   * still refused rather than stored.
   */
  const savePolicy = async () => {
    const num = (raw: string): { ok: true; v: number | null } | { ok: false } => {
      const trimmed = raw.trim();
      if (!trimmed) return { ok: true, v: null };
      const n = Number(trimmed);
      return Number.isFinite(n) && n >= 0 ? { ok: true, v: n } : { ok: false };
    };
    const hours = num(noticeField);
    const fee = num(cancelFeeField);
    if (!hours.ok || !fee.ok) {
      setPolicyMsg({ bad: true, text: 'Those are not numbers this can save. Nothing has changed — clear a field entirely to withdraw that half of the policy.' });
      return;
    }
    if (hours.v != null && hours.v > 336) {
      setPolicyMsg({ bad: true, text: 'A notice period longer than two weeks is refused. Nothing has changed.' });
      return;
    }
    setPolicyBusy(true);
    const saved = await updateTenant({ classCancelHours: hours.v, classCancelFee: fee.v });
    setPolicyBusy(false);
    if (!saved) {
      setPolicyMsg({ bad: true, text: 'Not saved. Your policy is unchanged, and members are still being told this app does not hold it.' });
      return;
    }
    setNoticeDraft(null);
    setCancelFeeDraft(null);
    setPolicyMsg({
      bad: false,
      text: hours.v == null
        ? 'Withdrawn. Members are told this app does not hold your policy, which is true again.'
        : 'Saved. Members cancelling inside that window are now told so before they confirm.',
    });
  };

  const saveFee = async () => {
    const parsed = parseSessionFee(feeField, tenant?.currency ?? null);
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
  // Read separately from fetchAllFeedbackPage() rather than through it: that
  // function is shared with the Feedback screen and its row shape is not this
  // screen's to change.
  //
  // null is "not known", not "none resolved" — the same distinction the inbox
  // read itself carries three lines down.
  const [resolvedAt, setResolvedAt] = useState<Record<string, string> | null>(null);
  // Which of the two nulls that is — still reading, or refused. Same pair the
  // inbox read carries, for the same reason.
  const [resolvedFailed, setResolvedFailed] = useState(false);
  /** And whether the resolved-state read was the whole of it. */
  const [resolvedTruncated, setResolvedTruncated] = useState(false);
  useEffect(() => {
    if (!USE_SUPABASE) { setResolvedAt({}); return; }
    let off = false;
    (async () => {
      const { data, error } = await supabase.from('feedback').select('id, resolved_at')
        .order('created_at', { ascending: false }).limit(capLimit());
      if (off) return;
      if (error) { reportError('ownerOps.resolved', error); setResolvedAt(null); setResolvedFailed(true); setResolvedTruncated(false); return; }
      // `capLimit()` above asks for one row past the ceiling precisely so a
      // full page and a truncated one stop looking identical, and nothing was
      // reading the answer. Every ticket whose resolved_at row fell past the cap
      // is drawn as OPEN — the mirror of the "3 open over a failed read" bug the
      // note above this effect was written about, arriving by the other door.
      const page = capped(data);
      const map: Record<string, string> = {};
      for (const r of page.rows) { if (r.resolved_at) map[String(r.id)] = String(r.resolved_at); }
      setResolvedAt(map); setResolvedFailed(false); setResolvedTruncated(page.truncated); setResolvedAtStamp(Date.now());
    })();
    return () => { off = true; };
  }, [readTick]);

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
        .order('created_at', { ascending: false }).limit(EVENT_LIMIT);
      if (off) return;
      if (error) { reportError('ownerOps.events', error); setEvStatus('error'); return; }
      const rows = data ?? [];
      setEvents(rows.map((r: any) => ({
        id: String(r.id), kind: String(r.kind), summary: String(r.summary), at: String(r.created_at),
      })));
      // `.limit(100)` is a bound, not a cap, and a read that came back AT its
      // bound is a prefix — which is what 'partial' means in this codebase's
      // vocabulary. It was reported as 'ready' unconditionally, and the section
      // header then printed the bare numeral 100 as the gym's activity count.
      // The caption under the list already said "the most recent hundred"; the
      // figure above it did not.
      setEvStatus(rows.length >= EVENT_LIMIT ? 'partial' : 'ready');
      setEventsAt(Date.now());
    })();
    return () => { off = true; };
  }, [readTick]);
  // null is the inbox we do not have: it is the initial value AND what
  // fetchAllFeedbackPage returns for a refused read, which is deliberate — see
  // the note on that function. It used to be collapsed here with `d ?? []`, one line
  // under a comment saying null means unread rather than empty, and the tab then
  // asserted "No tickets. Feedback sent from inside the app lands here." That is
  // the sentence you least want to be wrong about during a test round: it says
  // the testers are silent when what happened is that we could not hear them.
  const [fbRows, setFbRows] = useState<FeedbackRow[] | null>(null);
  // Which of the two nulls this is. Without it "still reading" and "the read
  // came back refused" draw the same screen and neither can be acted on.
  const [fbFailed, setFbFailed] = useState(false);
  /** And whether the inbox that DID come back is the whole inbox. Every count
   *  on this tab is over these rows, and a subtotal called "All resolved" is
   *  the worst thing this screen can say. */
  const [fbTruncated, setFbTruncated] = useState(false);
  // The await is guarded: an unhandled rejection here left the support inbox on
  // its initial [] with no record that anything had gone wrong, and the tab
  // stated "No tickets." over a read that never returned.
  useEffect(() => {
    let c = false;
    (async () => {
      // `fetchAllFeedbackPage`, not `fetchAllFeedback`. The latter is a thin
      // wrapper that returns `page && page.rows` — it THROWS THE TRUNCATION FLAG
      // AWAY. Under a capped read this tab held a thousand-row prefix with
      // `inboxKnown` true, and stated "3 open" and, worse, "All resolved" over
      // tickets it had never read. app/(owner)/feedback.tsx moved to the paged
      // call for exactly this reason and this screen was not moved with it.
      try {
        const page = await fetchAllFeedbackPage();
        if (!c) {
          setFbRows(page ? page.rows : null);
          setFbFailed(page === null);
          setFbTruncated(page?.truncated ?? false);
          if (page !== null) setInboxAt(Date.now());
        }
      }
      catch (e) { reportError('ownerOps.feedback', e); if (!c) { setFbRows(null); setFbFailed(true); setFbTruncated(false); } }
    })();
    return () => { c = true; };
  }, [readTick]);
  // BOTH reads. Which tickets there are, and which of them are dealt with, are
  // two questions and the tab answers with both — "3 open" over a resolved-state
  // read that failed is every ticket counted as open, which reads as a backlog
  // that is not there.
  useEffect(() => { if (noticeStatus === 'ready') setNoticesAt(Date.now()); }, [noticeStatus]);
  /** One line over five reads, and it is the age of the oldest of them. */
  const fetchedAt = oldestFetch(merchantAt, resolvedAtStamp, eventsAt, inboxAt, noticesAt);
  /**
   * Everything on this tab, read again — the merchant row, the support inbox
   * and its resolved-state map, the event feed, the notices this owner has sent
   * and the gym row the session fee is stored on.
   */
  const refreshAll = useCallback(() => {
    setMerchantTick((n) => n + 1);
    setReadTick((n) => n + 1);
    reloadNotices();
    refreshTenant();
  }, [reloadNotices, refreshTenant]);
  const pull = usePullToRefresh(refreshAll);

  // Both reads landed AND both are whole. Either one being a prefix makes
  // `openCount` a count over an unknown fraction, and "All resolved" a claim
  // about tickets nobody read.
  const inboxKnown = fbRows != null && resolvedAt != null && !fbTruncated && !resolvedTruncated;
  /** Read, but not all of it — the state that needs a sentence rather than a
   *  figure. Distinct from `fbFailed`, which has no rows at all. */
  const inboxShort = fbRows != null && resolvedAt != null && (fbTruncated || resolvedTruncated);
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ paddingTop: sp.md }}>
          {/* "Platform" named Repple, not this gym — the same drift Overview
              settled when it dropped "Repple HQ · Platform". Everything on this
              screen belongs to the owner's own gym. */}
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your gym</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Operations</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your session fee · notices to members · support · gym activity</Text>
          {/* The age of this screen. It began as the merchant read alone —
              "payouts enabled" from a read half an hour old, read by an owner
              in a plant room with no signal, is something about their money
              that may no longer be true — and it now speaks for all five reads
              the tabs below draw on, at the age of the oldest. Refresh and the
              pull gesture both run every one of them. */}
          <Fetched at={fetchedAt} busy={merchantStatus === 'loading'} onRefresh={refreshAll} />
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
                  {/* ── the caveat the one person who cannot see it was missing ──
                      The label was `Session fee in ${cur ?? GYM_CURRENCY}`, so a
                      gym that has not set a currency told a screen reader,
                      flatly, that the box is in dirhams — while the caption
                      below explained to everybody else that AED is only a
                      placeholder. The reader who cannot see that caption is the
                      one told the gym charges in AED, on the field that sets
                      what every session in the product is priced at.
                      src/ui/tenant.tsx:106 states the rule: pass the currency
                      honestly, `?? null`, never `|| GYM_CURRENCY`. */}
                  <TextInput value={feeField} onChangeText={(v) => { setFeeDraft(v); if (feeMsg) setFeeMsg(null); }}
                    placeholder="Not set" placeholderTextColor={t.ink3} keyboardType="decimal-pad"
                    accessibilityLabel={cur
                      ? `Session fee in ${cur}`
                      : `Session fee. Your gym has not said what it charges in, so this field is only labelled ${GYM_CURRENCY} as a placeholder — set your currency below first.`}
                    style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1 }} />
                </View>
                {/* ── the currency, ALWAYS offered ────────────────────────
                    This whole block was `{cur ? null : (…)}` — the picker
                    appeared only while the gym had no currency, and disappeared
                    the instant one was chosen. So a gym that picked the wrong
                    one on day one had no path back from ANY surface in the
                    product: the console's /settings did not exist yet, and this
                    was the only control. The write itself was never the problem
                    — `updateTenant` has always admitted `currency` — the gate
                    was.

                    supabase/parts/150 removed every money column's default
                    precisely so a wrong currency could not hide. A control that
                    hides itself once a wrong answer is stored undoes that. */}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {cur
                    ? `This gym is priced in ${cur}. Everything written from here on is denominated in it.`
                    : `Your gym has not told us what it charges in, so the field above is only labelled ${GYM_CURRENCY} as a placeholder. Set your currency once and every screen follows.`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
                  {CURRENCY_CHOICES.map((c) => {
                    const on = c === cur;
                    return (
                      <Pressable key={c} onPress={async () => {
                        if (on) return;
                        const saved = await updateTenant({ currency: c });
                        // No claim about what came before, and no claim that
                        // anything already recorded has moved. The rows keep
                        // the currency they were written in — a payment is a
                        // historical fact — so a gym that changes this has two
                        // currencies in its ledger and every total that mixes
                        // them is withheld rather than added up.
                        setFeeMsg(saved
                          ? {
                              bad: false,
                              text: cur
                                ? `Your gym is now priced in ${c}. Nothing already recorded has been re-denominated: payments, plans and passes keep the currency they were written in, and any total that mixes the two is withheld rather than added up.`
                                : `Your gym is priced in ${c}. That is what every figure written from here on is denominated in.`,
                            }
                          : { bad: true, text: cur ? `Not saved. Your gym is still priced in ${cur}.` : 'Not saved. Your gym still has no currency set.' });
                      }} accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={on ? `This gym is priced in ${c}` : `Price this gym in ${c}`}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                        <Text style={{ ...ty.label, ...numeric, color: on ? t.brandInk : t.ink2 }}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
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

            {/* ── what a late class cancellation costs ──────────────────────
                Beside the session fee because they are the same kind of fact:
                a number this gym charges, which several screens quote and
                which nobody could set. The member-facing half is
                src/lib/classCancel.ts, whose header has said since it was
                written that "there is no column for it, no screen where an
                owner sets one". This is that screen. */}
            <Section>
              <SectionHead title="Class Cancellations"
                note={tenant?.classCancelHours == null ? 'not stated' : `${tenant.classCancelHours}h notice`} />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                How much notice a member must give before a class, and what you charge if they give less.
                Until you set this, members cancelling a class are told plainly that this app does not hold
                your policy and that they should ask you.
              </Text>
              {tenantStatus === 'loading' ? (
                <Empty tone={t.ink3}>Reading your gym…</Empty>
              ) : tenantStatus === 'error' ? (
                <Empty tone={t.warn}>
                  Your gym could not be read, so the policy it currently holds is not known — this is not a
                  statement that none is set. Nothing can be changed until it can be read.
                </Empty>
              ) : (<>
                <View style={{ flexDirection: 'row', gap: sp.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>NOTICE (HOURS)</Text>
                    <TextInput
                      value={noticeField}
                      onChangeText={(v) => { setNoticeDraft(v); if (policyMsg) setPolicyMsg(null); }}
                      placeholder="—"
                      placeholderTextColor={t.ink3}
                      /* decimal-ok: hours of notice are whole — a gym does not
                         run a 12.5-hour window — and `savePolicy` reads this
                         with Number and refuses anything that is not a
                         non-negative number. */
                      keyboardType="number-pad"
                      accessibilityLabel="Hours of notice before a class"
                      style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>
                      {cur ? `FEE (${cur})` : 'FEE'}
                    </Text>
                    <TextInput
                      value={cancelFeeField}
                      onChangeText={(v) => { setCancelFeeDraft(v); if (policyMsg) setPolicyMsg(null); }}
                      placeholder="—"
                      placeholderTextColor={t.ink3}
                      keyboardType="decimal-pad"
                      accessibilityLabel={cur ? `Late cancellation fee in ${cur}` : 'Late cancellation fee'}
                      style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md }}
                    />
                  </View>
                </View>
                {/* The unit is the gym's, and without one the amount cannot be
                    shown to a member at all — said here rather than discovered
                    later by an owner whose fee never appears. */}
                {/* A Flag, not coloured text. check:contrast caught the first
                    version of both of these: status colours are tuned to the
                    3:1 a mark needs and not the 4.5:1 text needs, so the tone
                    goes on the mark and the words stay in ink. */}
                {!cur ? (
                  <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                    Your gym has no currency set, so a fee saved here cannot be shown to members as an amount —
                    they are told you charge for it and to ask you what it is. Set a currency above and the
                    figure appears.
                  </Flag>
                ) : null}
                {policyMsg ? (
                  policyMsg.bad
                    ? <Flag tone={t.crit} style={{ marginTop: sp.sm }}>{policyMsg.text}</Flag>
                    : <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{policyMsg.text}</Text>
                ) : (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    Clear both and save to withdraw the policy. An empty notice is not a zero-hour window, and
                    an empty fee is not a free cancellation — both of those you can state by entering 0.
                  </Text>
                )}
                <View style={{ marginTop: sp.lg }}>
                  <Cta wide label={policyBusy ? 'Saving…' : 'Save Cancellation Policy'} disabled={policyBusy}
                    onPress={() => { void savePolicy(); }} />
                </View>
              </>)}
            </Section>

            <Rule />

            {/* ── where this gym is ────────────────────────────────────────
                The setting every gym on the platform is missing, and the only
                one on this screen that is WRONG rather than empty while it is
                unset: with no zone, "today", the month close, the payroll month
                and footfall by hour are each cut on whichever machine the page
                is open on. Read at the front desk they are right by accident.

                No "use this phone's zone" button, and the phone's own zone is
                shown as a fact about the phone with nothing to press. Part 710
                makes the argument about a laptop and it holds harder here: an
                owner going through their books in an airport would set the gym
                to Europe/Amsterdam with one tap and never find out. */}
            <Section>
              <SectionHead title="Where This Gym Is"
                note={zoneRead && !zoneErr && zone ? (gymTimeLabel(tick, zone) ?? undefined) : undefined} />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                Whose day this gym’s day is. The month close, the payroll month and every “today”
                in the owner console are cut on it.
              </Text>
              {tenantStatus === 'loading' || (tenant?.id && !zoneRead) ? (
                <Empty tone={t.ink3}>Reading your gym…</Empty>
              ) : !tenant ? (
                <Empty tone={t.ink3}>This account is not attached to a gym, so there is no timezone to set.</Empty>
              ) : zoneErr ? (
                <Empty tone={t.warn}>
                  This gym’s timezone could not be read, so whether one is set is not known — this is
                  not a statement that none is. Nothing can be changed until it can be read.
                </Empty>
              ) : (<>
                {zone ? (
                  <View style={{ marginBottom: sp.md }}>
                    <Text style={{ ...ty.body, color: t.ink }}>{zone}</Text>
                    {/* The check anybody can actually perform. A null clock is a
                        stored zone this runtime cannot resolve — said as that,
                        rather than left blank. */}
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {gymTimeLabel(tick, zone) && gymDay(tick, zone)
                        ? `It is ${gymTimeLabel(tick, zone)} on ${gymDay(tick, zone)} there. If that is not the time at the gym, this is the wrong zone.`
                        : 'This phone cannot resolve that zone, so the clock cannot be shown against it. Search below to set one it knows.'}
                    </Text>
                  </View>
                ) : (
                  <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                    Not set. Until it is, every date in the owner console is drawn on whichever
                    machine it is read from — right at the front desk by accident, and wrong for
                    anyone reading from another country.
                  </Flag>
                )}

                <TextInput value={zoneQuery} onChangeText={(v) => { setZoneQuery(v); if (zoneMsg) setZoneMsg(null); }}
                  placeholder={zoneAll.length ? 'Search a city — London, Dubai' : 'Europe/London'}
                  placeholderTextColor={t.ink3} autoCapitalize="none" autoCorrect={false}
                  accessibilityLabel="Search for the city this gym is in"
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />

                {zoneAll.length === 0 ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{NO_ZONE_LIST_NOTE}</Text>
                ) : null}

                {/* Typed a full zone name that this runtime knows, and it is not
                    already in the list below. The only path on a runtime with no
                    list, and a shortcut for anybody who knows the name. */}
                {typedZone.kind === 'zone' && !zoneHits.some((h) => h.zone === typedZone.zone) ? (
                  <ZoneRow zone={typedZone.zone} where="typed" tick={tick} busy={zoneBusy}
                    onPress={() => { askZone(typedZone.zone); }} />
                ) : null}

                {zoneHits.map((h) => (
                  <ZoneRow key={h.zone} zone={h.zone} where={h.where} tick={tick} busy={zoneBusy}
                    onPress={() => { askZone(h.zone); }} />
                ))}

                {zoneQuery.trim() && zoneHits.length === 0 && typedZone.kind !== 'zone' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    {typedZone.kind === 'bad'
                      ? typedZone.reason
                      : `Nothing matches “${zoneQuery.trim()}”. Search the nearest large city rather than the town — zones are named after the city whose clock a place keeps.`}
                  </Text>
                ) : null}

                {zoneMsg ? (
                  zoneMsg.bad
                    ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{zoneMsg.text}</Flag>
                    : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{zoneMsg.text}</Text>
                ) : null}

                {/* A fact about this phone, labelled as one. Not a suggestion,
                    and not something to press — see the note above the section. */}
                {readerZone() ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    This phone’s own clock is set to {readerZone()}. That is where the phone is, which
                    is not necessarily where the gym is — so it is not filled in for you.
                  </Text>
                ) : null}
              </>)}
            </Section>

            <Rule />

            {/* ── the gym's own Stripe account ─────────────────────────────
                Until this exists, a member can read the price of the plan they
                are on and cannot buy it, renew it or move off it, and the gym's
                price book is a document rather than a shop. `gym_connect_
                accounts` (part 280) is one row per GYM and it is deliberately
                NOT the owner's own coach row in `connect_accounts`: a
                membership sold on a coach's account makes a different legal
                entity the merchant of record for it, and nothing in the app
                would look wrong about that until a chargeback arrived.

                Four states and three of them need different words. "Never
                started" is one tap from starting; "Stripe is still verifying"
                is waiting on nobody here; and an account of the wrong KIND can
                never take payments, because Stripe fixes an account's type at
                creation and will not change it. A read that FAILED is the
                fourth and says nothing about the gym at all. */}
            <Section>
              <SectionHead title="Card Payments"
                note={merchantStatus === 'ready' ? (merchant && merchantState(merchant).kind === 'live' ? 'On' : 'Off') : undefined} />
              {merchantStatus === 'loading' ? (
                <Empty tone={t.ink3}>Reading your gym’s payment account…</Empty>
              ) : merchantStatus === 'error' ? (
                <Empty tone={t.warn}>
                  Your gym’s payment account could not be read, so whether it takes cards is not known. This is
                  not a statement that it does not.
                </Empty>
              ) : !tenant ? (
                <Empty tone={t.ink3}>This account is not attached to a gym, so there is nothing to set up.</Empty>
              ) : (<>
                <Text style={{ ...ty.label, color: t.ink3 }}>{merchantState(merchant).note}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  The account is your gym’s own, in your gym’s name. Stripe holds your gym responsible for
                  refunds and disputes on it, and the money never passes through a coach’s account.
                </Text>
                <View style={{ marginTop: sp.lg }}>
                  <Cta wide label={merchantBusy ? 'Opening…' : merchantState(merchant).cta} disabled={merchantBusy}
                    onPress={() => { void openStripeSetup(); }} />
                </View>
                {merchantMsg ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{merchantMsg}</Flag> : null}
              </>)}
            </Section>

            <Rule />

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
              {/* Named. A placeholder disappears the moment somebody types, so
                  it is not a label for anybody — and this is the box whose
                  contents reach every member's phone. */}
              <TextInput value={text} onChangeText={setText}
                accessibilityLabel="The notice every member of your gym will see"
                placeholder="e.g. We are closed Monday for the public holiday…" placeholderTextColor={t.ink3} multiline
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
                {/* This switch is the difference between a note in the app and
                    a push notification to every member of the gym, and it
                    announced nothing at all: to a screen reader it was "switch,
                    on" with no statement of what was on. The sentence beside it
                    is sighted-only. */}
                <Switch value={annPush} onValueChange={setAnnPush}
                  accessibilityLabel="Also send this as a push notification to every member"
                  accessibilityHint={pushConsequence('gym', null)} />
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
                  {/* Only 'error' and 'loading' were branched, so 'partial' fell
                      into the assertion. `useAnnouncements` reads the gym's
                      announcements newest-first at `capLimit()` and reports
                      'partial' on truncation — so an owner whose own notices are
                      older than the newest thousand TENANT-WIDE rows was told
                      they had sent none. The count one line up was already gated
                      on 'ready'; the sentence below it was not. */}
                  {noticeStatus === 'loading' ? 'Reading your notices…'
                    : !isWhole(noticeStatus)
                    ? 'More notices than fit in one read, and none of yours is among the ones that came back. That is not the same as having sent none — pull down to read them again.'
                    : 'Nothing sent yet — notices you post appear here.'}
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
              ) : inboxShort ? (
                // Read, and not all of it. Distinct from the two failures above
                // and from the read still being in flight below — the tickets
                // shown are real, there are more of them, and no count over
                // them is offered.
                <Empty tone={t.warn}>
                  There is more feedback than fits in one read, so these are the most recent rather
                  than all of them and there is no count above. Anything older than these has not
                  been looked at by this screen.
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
                  Nothing yet. Members and coaches joining, sessions marked delivered or missed,
                  promo codes being used, money recorded and corrected, prices changed, payroll
                  settled, months closed and the record exported all land here as they happen.
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
              {/* This sat outside every branch, so under a failed read it
                  followed "The feed could not be read" with "nothing here was
                  typed by anyone… The most recent hundred" — a description of
                  a list that is not on the screen, which is the shape that made
                  the coach app print a Retired paperwork list under "you
                  haven't added any paperwork yet". The provenance is worth
                  saying wherever there is a feed to describe; the row cap is
                  only true of rows that arrived. */}
              {evStatus === 'error' ? null : (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Written by the database as things happen, so nothing here was typed by anyone and nothing
                  can be missed by a screen forgetting to record it.
                  {/* Conditioned on the STATUS and not on the row count.
                      "The most recent hundred" was printed whenever any row
                      arrived, so a complete forty-row feed was described as a
                      truncated one — and a genuinely truncated feed was
                      described in exactly the same words as a complete one, so
                      the sentence told a reader nothing either way. `partial`
                      is the only state in which a hundred rows means there are
                      more, and it is the only state that now says so. */}
                  {evStatus === 'partial'
                    ? ' There is more activity than fits in one read, so these are the most recent hundred and there are older entries this screen has not seen — which is why there is no count above it.'
                    : ''}
                </Text>
              )}
            </Section>
          </View>
        )}
        {/* ── everywhere else in this gym ────────────────────────────────
            OUTSIDE the tab switch, and that is the whole of the fix.

            These six rows are the ONLY route in the app to the Rota, the
            Equipment Register, the Exercise Library, Deletion Requests and
            Settings — five screens with no tab, no hub row anywhere else and no
            other link. They were rendered inside the `tab === 'announce'`
            branch, so switching to Support or Activity made all five vanish
            from the product. An owner who left this screen on Activity and came
            back to it had no way to reach any of them again short of switching
            tabs for no reason they could have guessed.

            `scripts/check-reachable.mjs` could not see it: the routes ARE named
            in this file, which is all that check asks. A route named inside a
            branch that is false is reachable to a grep and unreachable to a
            person. */}
        <Rule />
        <Section>
          <SectionHead title="Everywhere Else" />
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
      </ScrollView>
    </SafeAreaView>
  );
}
