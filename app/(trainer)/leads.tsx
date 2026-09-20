// Coach · Enquiries. The people who clicked the join link and did not join.
//
// ── Why this screen exists ────────────────────────────────────────────────
//
// The join code is the top of this funnel and it is a good one: parallel named
// codes (part 81), a cost and a return per code (part 98), and ad spend matched
// to a code by the link the ad points at (part 100, src/lib/adMatch.ts). Every
// figure in that set is about somebody who ALREADY installed the app, made an
// account and decided. The person who opened /join?c=FLYER7, read it and closed
// the tab is in none of them — a code measures conversions, not enquiries.
//
// That gap is not academic here. web/join.html redirects a phone to a store
// listing that, as of 30 Aug 2026, still 404s; the only route that page offered
// somebody who could not install was to email support by hand. Those people
// were the whole of a coach's unmeasured demand and Repple held nothing about
// them at all.
//
// ── THE THING THIS SCREEN DOES NOT DO ─────────────────────────────────────
//
// It does not send anything. There is no email here, no sequence, no schedule
// and no template, and there is not going to be one until this product has an
// email channel — which it does not, at any layer. `FOLLOW_UP_IS_MANUAL` is
// printed at the top of the screen in those words, because a coach who is not
// told will assume an enquiry has been acknowledged by something, and the
// person who left their number will hear nothing at all.
//
// This is the same limit app/(trainer)/nudges.tsx holds for the same family of
// reasons: what the app produces is a prompt and a record, and the contact
// itself is the coach's own hand.
//
// ── The four states this screen must keep apart ───────────────────────────
//
// Every row here is a stranger's name and a way to reach them, so getting the
// count wrong costs either a lost enquiry or a phone call to somebody who was
// already rung.
//
//   error    a read did not come back, and `book.status` is the worst of two of
//            them. When it is the ENQUIRY read, the hook has cleared the rows,
//            nothing is listed and the banner says so out loud — an empty list
//            here is not an empty inbox. When it is only the CODES read, the
//            enquiries are drawn anyway: status decides what may be SAID, never
//            who is listed, and a label lookup must not take a coach's list of
//            strangers off the screen.
//   partial  more enquiries exist than came back. The rows are real and are
//            shown; no figure on the screen is a total, and PartialRead says
//            which is which.
//   codes    the enquiries read and the CODES did not. The people are real and
//            where they came from is unknown, so no campaign is named — rather
//            than every one of them rendering as a code the coach does not hold,
//            which reads as broken attribution instead of a failed read.
//   ready    the list is the list.
//
// ── The order this screen draws, and the order it does not ───────────────
//
// `shapeLeads` sorts New, then Contacted, then Closed, and newest-first inside
// each of the three; the list below keeps that, because that is the order a
// coach scans. Within New — which is the whole of the pile that still needs
// doing — it is also the order that buries the enquiry that costs them a
// client: the one from eleven days ago sinks one place for every new arrival,
// and it sinks faster the better the marketing works. So the wait
// gets a section of its own, above the list, oldest first —
// src/lib/leadWait.ts, which carries the whole argument for why that is a
// separate queue rather than a re-sort of a list somebody is scanning.
//
// ── ONE conversion figure, and six refusals ──────────────────────────────
//
// A coach wants to know how many of the people who asked about them became
// clients, and this screen holds rows that look like they answer it. Almost
// every fraction that can be built out of them is a lie — the app cannot see an
// enquiry that arrived by phone, cannot see a click, and cannot read a
// non-match as a non-join. src/lib/leadConversion.ts finds the one figure that
// survives, prints it with its denominator in the same sentence and never as a
// percentage, and names the six it will not compute WITH THE REASON FOR EACH —
// because a coach who finds no conversion figure assumes the app has not got
// round to it and works one out by hand off the counts that are on screen.
//
// ── Contact is one field, and the app never guesses ───────────────────────
//
// `contact` holds whatever the person typed. `contactKind` in src/lib/leads.ts
// reads it back as an email, a phone number, or NEITHER, and 'unknown' is a real
// answer: an Instagram handle gets no dial button, because a coach finds out
// that a tel: link over a handle dials nothing only after they have tapped it.
import { useCallback, useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, PageHead, Ghost, Cta, Notice, Flag, PartialRead, Meter, Donut, Legend, type Slice, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, font } from '../../src/theme/scale';
import { num } from '../../src/lib/format';
import { isWhole } from '../../src/ui/loadStatus';
import { useLeads } from '../../src/ui/leads';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import {
  FOLLOW_UP_IS_MANUAL, ENQUIRY_IS_ANNOUNCED, MISTYPED_CODE_NOTE, LEAD_STATE_LABEL, LEAD_STATE_NOTE, MAX_FOLLOW_UP,
  FOLLOW_UP_LABEL, FOLLOW_UP_WHEN, followUpDraft, followUpLink, followUpRecord,
  type LeadRow, type LeadState, type FollowUpKind,
} from '../../src/lib/leads';
import {
  LEAD_WAIT_TITLE, waitingLeads, hasLeadWait, leadWaitCountNote, leadWaitLine,
  leadWaitNote, longestWaitingLine,
} from '../../src/lib/leadWait';
import {
  CONVERSION_TITLE, CONVERSION_DENOMINATOR_NOTE, CONVERSION_NUMERATOR_NOTE,
  WITHHELD_CONVERSIONS, conversionFigureLine, enquiryConversion,
} from '../../src/lib/leadConversion';
import { telUrl, DIAL_UNAVAILABLE_NOTE } from '../../src/lib/dialling';
import { useNow } from '../../src/ui/today';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { fetchMyCoachBrand } from '../../src/ui/coachBrand';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { appLocale } from '../../src/lib/locale';
import { localDate } from '../../src/lib/localDate';

/**
 * A date as a coach reads one. Unknown stays unknown.
 *
 * `localDate` and not `new Date(iso)`. The three values that reach here —
 * `lead.at`, `lead.joinedAt` and a follow-up's `at` — are timestamptz today and
 * parse identically either way, but `new Date('2026-09-14')` is UTC midnight
 * read back through local getters, so the first bare date that ever reaches
 * this line renders as the day BEFORE for every coach west of Greenwich. That
 * is the defect src/lib/localDate.ts exists for, and src/lib/leadWait.ts
 * already refuses to age a bare date for the same reason — one file guarding
 * against it while the file beside it prints it is how the two disagree about
 * what day somebody enquired.
 */
function when(iso: string | null): string {
  const d = localDate(iso);
  if (!d || !Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The mark beside a state. A coloured dot beside ink text, never coloured
 *  text: the scale reserves status colour for status, and none of these clears
 *  AA as type. Same rule as driftTone on the Quiet Clients screen. */
function stateTone(t: ReturnType<typeof useTheme>, s: LeadState): string {
  if (s === 'new') return t.warn;
  if (s === 'contacted') return t.good;
  return t.ink3;
}

type Filter = 'all' | LeadState;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'closed', label: 'Closed' },
];

/** The funnel's stages, in the order an enquiry moves through them. Amber for
 *  the ones waiting on the coach, blue once they have been spoken to, grey for
 *  the ones put away. */
const FUNNEL: { key: Exclude<Filter, 'all'>; label: string; tone: Tone }[] = [
  { key: 'new', label: 'New', tone: 'amber' },
  { key: 'contacted', label: 'Contacted', tone: 'blue' },
  { key: 'closed', label: 'Closed', tone: 'neutral' },
];
const SOURCE_TONES: Tone[] = ['blue', 'purple', 'orange', 'teal', 'pink'];

export default function TrainerLeads() {
  const t = useTheme();
  const router = useRouter();
  const G = layout.gutter;
  const book = useLeads();

  const [filter, setFilter] = useState<Filter>('all');
  // One sheet, one flag. A sibling pair whose `visible` expressions share an
  // identifier is the bug check-runtime-traps.mjs exists for.
  const [writing, setWriting] = useState<LeadRow | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Which enquiry the draft picker is open for. Its own flag: iOS will not
  // stack two modals from the same parent, and check-runtime-traps.mjs exists
  // for a sibling pair whose `visible` expressions share an identifier.
  const [drafting, setDrafting] = useState<LeadRow | null>(null);

  // Who the message is from. The coach's own name and their own TRADING name —
  // never this app's. A prospect reading their first message from a coach must
  // not meet the coach's supplier in it, and a chain's member must not meet a
  // competitor: the same violation the join page was fixed for, on the one
  // message somebody reads before they are anybody's customer.
  const { name: coachName, reload: reloadProfile } = useMyTrainerProfile();
  const [tradingName, setTradingName] = useState<string | null>(null);
  const loadTradingName = useCallback(async () => {
    try {
      const b = await fetchMyCoachBrand();
        // A failed read is no trading name, which reads perfectly well — the
      // draft simply does not name a business. It is NOT a reason to fall
      // back to the app's own name, which is the one name it must not use.
      setTradingName(b?.brandName ?? null);
    } catch { setTradingName(null); }
  }, []);
  useEffect(() => { void loadTradingName(); }, [loadTradingName]);

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Enquiries arrive from OUTSIDE the app — somebody filling in a join page —
   * so nothing on this list moves because of anything the coach did, and
   * there is no other gesture that goes and looks.
   *
   * The two name reads go with it. Both are stamped into the message a
   * prospect receives, and a draft written from a stale trading name is a
   * message sent under a business name the coach has since changed. */
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([book.reload(), reloadProfile(), loadTradingName()]),
    [book, reloadProfile, loadTradingName],
  ));

  const listed = book.rows.filter((r) => filter === 'all' || r.state === filter);

  /* ── how long nobody has done anything ─────────────────────────────────
   *
   * `useNow()` and not `new Date()` in a memo. This screen is registered
   * `href: null` in app/(trainer)/_layout.tsx, so it mounts once and is never
   * torn down — not by backgrounding the phone — and a wait measured from a
   * clock that stopped at mount reads "2 days" on the Thursday of the week it
   * was opened. The whole point of this section is the number of days, so a
   * frozen one would be the single worst value on the screen. See
   * src/ui/today.ts.
   *
   * `followUpsUnread` is passed through rather than folded into the predicate:
   * under a failed note read, `followUpsFor` returning nothing means "we did
   * not see a note", which is not "there is no note", and the section says so
   * instead of asserting nobody has touched these people. */
  const now = useNow();
  const waitBook = waitingLeads(
    book.rows,
    (id) => book.followUpsFor(id).length > 0,
    !book.followUpsUnread,
    now.getTime(),
    book.status,
  );
  const waitCount = leadWaitCountNote(waitBook, book.status);
  const waitNote = leadWaitNote(waitBook);
  const longest = longestWaitingLine(waitBook, book.status);

  /* ── the one figure, computed over the same rows the list draws ────────── */
  const conversion = enquiryConversion(book.rows, book.status);

  /* ── where they came from, for the ring ──────────────────────────────────
   * By the campaign the row's code resolved to. A row with no campaign is its
   * own grey slice and is NAMED as that — dropping it would make the ring a
   * whole of the attributed enquiries while its centre counts all of them.
   * The five biggest keep a hue each and the rest share one slice: a ring of
   * twelve colours is a ring nobody can read against its legend. Only
   * rendered under a whole read; see the section that draws it. */
  const sourceSlices: Slice[] = (() => {
    const by = new Map<string, number>();
    let unnamed = 0;
    for (const r of book.rows) {
      if (r.campaign) by.set(r.campaign, (by.get(r.campaign) ?? 0) + 1); else unnamed += 1;
    }
    const ranked = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const rest = ranked.slice(SOURCE_TONES.length).reduce((n, x) => n + x[1], 0);
    return [
      ...ranked.slice(0, SOURCE_TONES.length).map(([label, n], i): Slice => ({ label, value: n, tone: SOURCE_TONES[i], shown: num(n) })),
      ...(rest ? [{ label: 'Other Campaigns', value: rest, tone: 'amber' as const, shown: num(rest) }] : []),
      ...(unnamed ? [{ label: 'No Campaign Named', value: unnamed, tone: 'neutral' as const, shown: num(unnamed) }] : []),
    ];
  })();

  const mark = (lead: LeadRow, state: LeadState) => {
    void book.setState(lead.id, state).then((r) => {
      if (!r.ok) Alert.alert('Not Saved', r.reason);
    });
  };

  const remove = (lead: LeadRow) => {
    Alert.alert(
      `Remove ${lead.name}?`,
      'Their name, their message and how to reach them are deleted, along with everything you recorded about following them up. This cannot be undone, and it is what to do when somebody asks to be taken off your list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void book.erase(lead.id).then((r) => {
              if (!r.ok) Alert.alert('Not Removed', r.reason);
            });
          },
        },
      ],
    );
  };

  const reach = (lead: LeadRow) => {
    // The tel: half is `telUrl` now (src/lib/dialling.ts), so the coach's
    // emergency-contact screen and this one clean a number the same way and
    // both refuse the same strings. `contactKind` has already answered which of
    // the two this is; the fallback covers a 'phone' that `telUrl` will not
    // dial, which is a string the coach must read rather than tap.
    const url = lead.contactKind === 'email'
      ? `mailto:${lead.contact}`
      : telUrl(lead.contact);
    if (!url) {
      Alert.alert('Not a Number This Phone Can Ring', DIAL_UNAVAILABLE_NOTE);
      return;
    }
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'Could Not Open That',
        'Your phone would not open an app for this. The details are on the screen behind this — copy them out by hand.',
      );
    });
  };

  /**
   * Hand the drafted words to the coach's own mail or messages app.
   *
   * Nothing is sent by this app and nothing leaves a server. That is not a
   * compromise on the white-label rule, it is a better answer than a sending
   * domain would be: the address it arrives from is the account already on the
   * coach's phone, so a chain's coach writes from the chain's address and this
   * software's name appears nowhere.
   *
   * The follow-up note is pre-filled afterwards rather than written, and it says
   * "opened" rather than "sent" — the coach may edit the draft to nothing or
   * close the mail app, and this app observed neither.
   */
  const openDraft = (lead: LeadRow, kind: FollowUpKind) => {
    const draft = followUpDraft(kind, lead, coachName, tradingName);
    const url = followUpLink(lead, draft);
    if (!url) {
      Alert.alert(
        'Nothing to Open It With',
        'What they left is neither an email address nor a phone number, so there is no app to hand this to. The details are on the screen behind this — copy them out by hand.',
      );
      return;
    }
    setDrafting(null);
    Linking.openURL(url).then(
      () => {
        // Pre-fill the note rather than write it. A coach who has just opened
        // their mail app is exactly the person who will not come back and type
        // one, and a record nobody wrote is the reason somebody gets rung twice.
        setWriting(lead);
        setDraft(followUpRecord(kind, lead.contactKind === 'email' ? 'email' : 'text'));
      },
      () => {
        Alert.alert(
          'Could Not Open That',
          'Your phone would not open an app for this. Nothing has been sent and nothing has been recorded.',
        );
      },
    );
  };

  const saveFollowUp = () => {
    const lead = writing;
    if (!lead || saving) return;
    setSaving(true);
    void book.addFollowUp(lead.id, draft).then((r) => {
      setSaving(false);
      if (!r.ok) { Alert.alert('Not Recorded', r.reason); return; }
      setWriting(null);
      setDraft('');
    });
  };

  const leadCard = (lead: LeadRow, i: number) => {
    const notes = book.followUpsFor(lead.id);
    return (
      <View key={lead.id} style={{ paddingVertical: sp.lg, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stateTone(t, lead.state) }} />
          <Text style={{ ...ty.head, color: t.ink, flex: 1 }}>{lead.name}</Text>
          <Text style={{ ...ty.micro, color: t.ink3 }}>{LEAD_STATE_LABEL[lead.state]}</Text>
        </View>

        {/* Where they came from. The campaign name is the coach's own, matched
            on the code string exactly as ad spend is — and where the code is
            not one they hold now, that is said rather than papered over. */}
        <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
          {book.codesRead
            ? (lead.campaign
              ? `${lead.campaign} · ${lead.viaCode} · ${when(lead.at)}`
              : `${lead.viaCode} · a code you no longer hold · ${when(lead.at)}`)
            : `${lead.viaCode} · ${when(lead.at)}`}
        </Text>

        {/* ── the enquiry that became a client ───────────────────────────
            Part 157 refused a fourth STATE and was right to: `state` is the
            coach's own workflow and a value in it that the app wrote would be
            the app deciding where their enquiry had got to. This is a different
            thing on different columns — an account with this exact email joined
            through this exact code — and it is evidence rather than a guess.

            Only drawn when it is TRUE. `joined` is three-valued and the two
            other values render nothing at all: false is "no match", which is
            not "did not join" (they may have joined on another code, or typed a
            different address), and null is a database without part 211. A badge
            reading "not a client" against either would be a verdict this screen
            has not earned. */}
        {lead.joined === true ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.good}>
              Somebody with this email address joined you on this code{lead.joinedAt ? ` on ${when(lead.joinedAt)}` : ''}.
              That is a match on the address and the code, not a guess — it is the only evidence this app has that a
              channel produced a client rather than a click.
            </Flag>
          </View>
        ) : null}

        {lead.note ? (
          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{lead.note}</Text>
        ) : (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>They left no message.</Text>
        )}

        <View style={{ marginTop: sp.md, padding: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
          <Text style={{ ...ty.body, color: t.ink }} selectable>{lead.contact}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            {lead.contactKind === 'email' ? 'An email address, as they typed it.'
              : lead.contactKind === 'phone' ? 'A phone number, as they typed it.'
                : 'This is neither an email address nor a phone number, so there is nothing to open it with. It is shown exactly as they typed it.'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, flexWrap: 'wrap' }}>
          {lead.contactKind === 'email' ? <Cta label="Email Them" onPress={() => reach(lead)} /> : null}
          {lead.contactKind === 'phone' ? <Cta label="Call Them" onPress={() => reach(lead)} /> : null}
          {lead.state !== 'contacted' ? (
            <Ghost label="Mark Contacted" onPress={() => mark(lead, 'contacted')} />
          ) : null}
          {lead.state !== 'closed' ? (
            <Ghost label="Mark Closed" onPress={() => mark(lead, 'closed')} />
          ) : (
            <Ghost label="Reopen" onPress={() => mark(lead, 'new')} />
          )}
          {/* Only where there is something to open it with. `contactKind`
              returns 'unknown' rather than guessing, and offering to draft a
              message to an Instagram handle is worse than offering nothing —
              the coach finds out after they have tapped it. */}
          {lead.contactKind !== 'unknown' ? (
            <Ghost label="Draft a Message"
              a11yLabel={`Draft a message to ${lead.name}`}
              onPress={() => setDrafting(lead)} />
          ) : null}
          <Ghost label="Record a Follow-up" onPress={() => { setWriting(lead); setDraft(''); }} />
          <Ghost label="Remove" onPress={() => remove(lead)} />
        </View>

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{LEAD_STATE_NOTE[lead.state]}</Text>

        {/* What the coach already did. Append-only server side, so this is a
            record rather than a field, and it is shown under the buttons that
            add to it. */}
        {book.followUpsUnread ? (
          <View style={{ marginTop: sp.md }}>
            <Flag tone={t.warn}>
              What you recorded about following people up could not be read, so nothing is listed below. This is not an
              enquiry nobody has touched — check before you ring them again.
            </Flag>
          </View>
        ) : notes.length ? (
          <View style={{ marginTop: sp.md }}>
            {notes.map((n) => (
              <View key={n.id} style={{ marginTop: sp.sm }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>{when(n.at)}</Text>
                <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{n.body}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* Back leads the row and carries a label. Seen on an iPhone 17 Pro:
            it trailed, which put the one control that leaves this screen in the
            top-RIGHT corner — where iOS has never put it and where the rest of
            this app does not put it — and without `a11yLabel` a screen reader
            announced it as "button". The house form is in
            src/ui/FeedbackScreen.tsx, which carries the whole argument. */}
        <PageHead title="Enquiries" subtitle="Who asked and did not join" />

        {/* ── the funnel, and where they came from ────────────────────────
            Round five: the page opens on a picture of the list under it. The
            stages as stacked meters, each a share of every enquiry on record,
            and the campaigns as a ring. Both are COUNTS OVER THE WHOLE LIST,
            so both are drawn only under `isWhole(book.status)` — the same
            gate the filter's own counts sit behind, for the same reason: a
            queue is worked to zero, and a bar over part of it is a promise
            about a pile nobody has seen the bottom of. On any other read the
            list below still draws, under its own notice, and this does not.

            Became Clients is `enquiryConversion`'s own two numbers and
            nothing else — matched OUT OF checked, with the denominator in the
            bar's note every time, never a percentage. The section further
            down still says what each half of that fraction counts. */}
        {isWhole(book.status) && book.rows.length > 0 ? (
          <Section>
            <SectionHead title="The Funnel" note={`${num(book.rows.length)} on record`} />
            {FUNNEL.map((f) => {
              const n = book.rows.filter((r) => r.state === f.key).length;
              return <Meter key={f.key} label={f.label} val={n} target={book.rows.length} tone={f.tone}
                note={`${num(n)} of ${num(book.rows.length)}`} />;
            })}
            {conversion.kind === 'figure' ? (
              <Meter label="Became Clients" val={conversion.matched} target={conversion.checked} tone="brand"
                note={`${num(conversion.matched)} of ${num(conversion.checked)} checked`} />
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.lg, marginTop: sp.xl }}>
              <Donut slices={sourceSlices} centre={num(book.rows.length)} sub={book.rows.length === 1 ? 'enquiry' : 'enquiries'}
                spoken={`Where they came from: ${sourceSlices.map((x) => `${x.label} ${x.shown}`).join(', ')}`} />
              <Legend items={sourceSlices} />
            </View>
          </Section>
        ) : null}

        {/* Said first, and not softened. */}
        <View style={{ marginTop: sp.xl }}>
          <Notice tone={t.warn} kicker="Nothing Is Sent" title="Following These Up Is You, by Hand" note={FOLLOW_UP_IS_MANUAL} />
        </View>

        {/* R5, and its own sentence rather than a clause on the one above.
            Until supabase/parts/470 an enquiry was written by an unauthenticated
            form and sat here until the coach happened to open this screen, so
            the app was not even telling them there was something to follow up.
            "You will be told" and "nothing is sent to them" are two facts, and
            a coach who read them as one would believe the enquirer had been
            acknowledged by something. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{ENQUIRY_IS_ANNOUNCED}</Text>

        {/* What the words on the rows below actually mean — an enquiry is not a
            client, the code is the attribution, and "contacted" is a note to
            self. src/lib/screenHelp.ts holds them; one dismissible row. */}
        <ScreenHelp screen="coach-enquiries" />

        {/* ── who has been waiting longest ──────────────────────────────────
            Above the list and not a re-sort of it: the list below is scanned
            top-down and a list that re-orders under the thumb makes the next
            tap land on somebody else. This is a queue — short, worked from the
            top, read once — and the longest wait is at the top of it by
            definition. Drawn only when there IS one; a coach who has cleared
            their enquiries is not shown an empty box congratulating them.

            Nothing in here accuses the coach of anything. This app sends
            nothing and never saw the phone call they made from the gym floor,
            so every sentence is about the record and not about them. */}
        {hasLeadWait(waitBook) ? (
          <Section>
            <SectionHead title={LEAD_WAIT_TITLE} note={waitCount ?? undefined} />
            {longest ? (
              <Text style={{ ...ty.head, color: t.ink }}>{longest}</Text>
            ) : null}
            {waitNote ? (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{waitNote}</Text>
            ) : null}

            <View style={{ marginTop: sp.md }}>
              {waitBook.rows.map((w, i) => (
                // One node per row, labelled as one sentence: a name read out
                // on its own and a wait read out after it are two swipes for a
                // fact that is only a fact together.
                <View
                  key={w.lead.id}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`${w.lead.name}. ${leadWaitLine(w)}`}
                  style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}
                >
                  <Text style={{ ...ty.body, color: t.ink }}>{w.lead.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{leadWaitLine(w)}</Text>
                </View>
              ))}
            </View>

            {/* The one action, and it moves the list below rather than doing
                anything to an enquiry: everything you can DO to one of these
                people is already on their card, and a second set of buttons is
                a second place the two can disagree. */}
            {waitBook.rows.length > 0 ? (
              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Show Only New"
                  a11yLabel="Filter the list below to new enquiries"
                  onPress={() => setFilter('new')} />
              </View>
            ) : null}
          </Section>
        ) : null}

        <Section>
          <SectionHead title="Your Enquiries" />
          <Text style={{ ...ty.label, color: t.ink2 }}>{book.note}</Text>

          {/* ── what "error" is allowed to hide ────────────────────────────
              `book.status` is the WORST of two reads (worstStatus in
              src/ui/leads.ts), so a failed CODES read — a label lookup, which
              only ever decides whether "Gym flyer" can be printed beside a code
              — arrives here as 'error' exactly like a failed enquiry read. This
              branch used to be `book.status === 'error'`, and under it a coach
              whose codes read dropped was shown NO enquiries and the sentence
              "nothing is listed because the read did not come back", four
              inches under `book.note` telling them "the people below are real"
              and under a Waiting Longest section naming those same people by
              hand. Their real list — strangers who left a phone number — was
              hidden by a read about labels.

              So the rows that came back are drawn whenever there are rows, the
              same rule src/lib/leadWait.ts states for its own queue: status
              decides what may be SAID, never who is listed. The banner is for
              the case it describes — nothing to list. When the enquiry read
              itself fails the hook clears the rows, so an empty list under
              'error' is that case and this branch still catches it. */}
          {book.status === 'loading' ? (
            <ActivityIndicator color={t.brand} style={{ marginVertical: 24 }} accessible accessibilityRole="progressbar" accessibilityLabel="Reading your enquiries…" />
          ) : book.status === 'error' && book.rows.length === 0 ? (
            <View style={{ marginTop: sp.lg }}>
              <Flag tone={t.crit}>
                Nothing is listed because the read did not come back — not because nobody has been in touch. Close this
                and open it again once you have a connection.
              </Flag>
              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Try Again" onPress={() => { void book.reload(); }} />
              </View>
            </View>
          ) : (
            <View>
              {/* Rows, under a status that failed. The only way to be here is a
                  codes read that did not land while the enquiries did: the hook
                  clears `rows` when the enquiry read fails, and a codes read
                  that DID land cannot make the fold 'error'. So the missing
                  half is named, and nothing is called a count. */}
              {book.status === 'error' ? (
                <View style={{ marginTop: sp.lg }}>
                  <Flag tone={t.warn}>
                    Your codes could not be read, so nothing below is put against a campaign and no figure on this
                    screen is a count. The enquiries themselves came back and are listed — they are the ones this read
                    saw, and they are real people.
                  </Flag>
                  <View style={{ marginTop: sp.lg }}>
                    <Ghost label="Try Again" onPress={() => { void book.reload(); }} />
                  </View>
                </View>
              ) : null}

              {book.status === 'partial' ? (
                <View style={{ marginTop: sp.lg }}>
                  <PartialRead what="enquiries" shown={book.rows.length} onPress={() => { void book.reload(); }} />
                </View>
              ) : null}

              {/* The filter. Only worth drawing once there is something to
                  filter — four buttons above an empty list is furniture. */}
              {book.rows.length > 0 ? (
                /* The board's segment bar — one `surface2` pill, four equal
                   segments, the chosen one in ink — where this was a wrap of
                   one Cta and three Ghosts. Same four positions. */
                <View accessibilityRole="tablist"
                  style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.pill, padding: 3, gap: 2, marginTop: sp.lg }}>
                  {FILTERS.map((f) => {
                    // Counted only when the read is the whole book. An
                    // enquiry queue is worked TO ZERO: "New (18)" is a promise
                    // that eighteen is the pile, so a coach clears eighteen,
                    // watches the chip read zero and stops — which is the one
                    // outcome a leads screen exists to prevent. The PartialRead
                    // notice for this same read is drawn twelve lines above.
                    const n = !isWhole(book.status) ? null
                      : f.key === 'all' ? book.rows.length : book.rows.filter((r) => r.state === f.key).length;
                    const on = f.key === filter;
                    return (
                      <Pressable key={f.key} onPress={() => setFilter(f.key)}
                        accessibilityRole="tab" accessibilityState={{ selected: on }}
                        accessibilityLabel={`${f.label}, ${n == null ? 'not counted' : num(n)}`}
                        style={{ flex: 1, minHeight: 40, paddingHorizontal: sp.sm, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.ink : 'transparent' }}>
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
                          style={{ ...ty.label, ...font(on ? '600' : '500'), ...numeric, color: on ? t.bg : t.ink2 }}>
                          {f.label} {num(n)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {listed.length === 0 ? (
                <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>
                  {book.rows.length === 0
                    ? 'Nobody has left their details yet. Share a join link and the form goes with it.'
                    : 'Nothing in your list is at that stage right now.'}
                </Text>
              ) : (
                <View style={{ marginTop: sp.md }}>{listed.map(leadCard)}</View>
              )}
            </View>
          )}
        </Section>

        {/* ── the one conversion figure ──────────────────────────────────────
            A ratio, never a percentage, and the denominator is inside the same
            sentence as the numerator rather than in a caption under it. A
            figure whose whole meaning is its denominator must not be
            renderable without one, and the way that rule gets broken is
            somebody setting the top number in a big font.

            `conversionFigureLine` returns the REASON when there is no figure,
            so this Text says something true in all four read states and there
            is no branch here that can print a zero the app has not measured. */}
        <Section>
          <SectionHead title={CONVERSION_TITLE} />
          <Text style={{ ...ty.body, color: t.ink }}>{conversionFigureLine(conversion)}</Text>
          {conversion.kind === 'figure' ? (
            <View style={{ marginTop: sp.lg }}>
              {/* Both halves of the fraction are described, every time it is
                  shown. The bottom one is the house rule — a percentage over
                  the leads the app can see is not a conversion rate and the
                  screen must say what it is counting — and the top one is
                  there because a coach reading "3" reads it as "and the other
                  fifteen did not", which is a conclusion about their own
                  marketing drawn from fifteen unknowns. */}
              <Flag tone={t.ink3}>{CONVERSION_DENOMINATOR_NOTE}</Flag>
              <View style={{ marginTop: sp.md }}>
                <Flag tone={t.ink3}>{CONVERSION_NUMERATOR_NOTE}</Flag>
              </View>
            </View>
          ) : null}
        </Section>

        {/* ── and the ones it refuses ─────────────────────────────────────────
            Written out rather than left as a silence. A coach who looks for a
            conversion rate and does not find one assumes the app has not got
            round to it, and works one out by hand off the two counts that ARE
            on this screen — which is the exact figure every reason below says
            is wrong. Each one is a fact about the data, not a policy. */}
        <Section>
          <SectionHead title="Figures This Will Not Show" />
          <Text style={{ ...ty.label, color: t.ink2 }}>
            Each of these is a number somebody could work out from this screen, and each one would be wrong for a
            reason that is about the data rather than about your marketing.
          </Text>
          {WITHHELD_CONVERSIONS.map((w, i) => (
            <View
              key={w.figure}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${w.figure}. ${w.why}`}
              style={{ paddingTop: sp.md, marginTop: i ? sp.md : sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}
            >
              <Text style={{ ...ty.body, color: t.ink }}>{w.figure}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{w.why}</Text>
            </View>
          ))}
        </Section>

        {/* ── where these come from ────────────────────────────────────────
            This paragraph opened the screen, above the notice and above the
            queue, so the first thing under the title was how the form works —
            and who has been waiting longest started below the fold. The
            data-layout review's rule is that the first viewport holds the
            decision; how an enquiry gets here is background, and it sits with
            the other background at the foot. The two sentences that change what
            a coach DOES — nothing is sent, and you will be told — stay at the
            top, unsoftened. */}
        <Section>
          <SectionHead title="Where These Come From" />
          <Text style={{ ...ty.body, color: t.ink2 }}>
            Your join link carries a short form, so somebody who is not ready to install the app can still leave their
            name. They arrive here with the code they came in on, so an enquiry is attributed the same way a client is.
          </Text>
        </Section>

        <Section>
          <SectionHead title="What This Cannot See" />
          <Text style={{ ...ty.body, color: t.ink2 }}>{MISTYPED_CODE_NOTE}</Text>
          <View style={{ marginTop: sp.md }}>
            <Rule />
          </View>
          {/* This paragraph used to read "an enquiry is never joined to an
              account", and part 211 made that false: an account created with
              the enquiry's exact email address on the enquiry's exact code
              stamps the row, and the card above says so. What is still true is
              the half that matters — the match is exact, so its absence is
              not an answer. Left wrong, this sentence contradicted a green
              badge four inches above it, which is how a screen teaches a coach
              that it does not know what it is talking about. */}
          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
            An enquiry is matched to an account only when the email address and the code are both exactly the same, so
            a match is evidence and the absence of one is not. Somebody who joined on a different code, signed up with
            another address, or was added by you by hand looks the same here as somebody who never came back. Marking an
            enquiry closed says you are finished with it — it does not say how it ended.
          </Text>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="What Your Ads Cost" onPress={() => router.push('/(trainer)/ad-spend')} />
          </View>
        </Section>

      </ScrollView>

      {/* ── which draft ───────────────────────────────────────────────────
          Three moments a coach actually writes, rather than one generic
          "message". The captions are there so a coach picks the right one and
          not the first one — a last word sent as a first reply is the worst
          version of this feature.

          Nothing is sent from here. The draft goes to the mail or messages app
          already on the coach's phone, signed in as them, so it arrives from
          THEIR address. That is what makes this safe under white-label: no
          sending domain is involved, so nobody's prospect meets this software's
          name in their first message. */}
      <Modal visible={!!drafting} animationType="slide" transparent onRequestClose={() => setDrafting(null)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34 }}>
            <Text style={{ ...ty.head, color: t.ink }}>Write to {drafting?.name ?? 'this enquiry'}</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              This opens your own {drafting?.contactKind === 'email' ? 'mail app' : 'messages app'} with the words
              already in it, from your own address. Nothing is sent until you press send there, and Repple sends
              nothing at any point.
            </Text>
            <View style={{ marginTop: sp.lg }}>
              {(['first', 'second', 'last'] as FollowUpKind[]).map((k, i) => (
                <View key={k} style={{ marginTop: i ? sp.md : 0 }}>
                  <Cta label={FOLLOW_UP_LABEL[k]}
                    a11yLabel={`${FOLLOW_UP_LABEL[k]} to ${drafting?.name ?? 'this enquiry'}`}
                    wide onPress={() => { if (drafting) openDraft(drafting, k); }} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{FOLLOW_UP_WHEN[k]}</Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: sp.lg }}>
              <Ghost label="Cancel" onPress={() => setDrafting(null)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── recording a follow-up ─────────────────────────────────────────── */}
      {/* ── the keyboard covered this sheet ────────────────────────────────
          This sheet is anchored to the bottom of the window and is short, so with the
          keyboard up the WHOLE of it — the note, the caption and Save — sat behind it.
          Nothing scrolls here, so there is no scroller for the page fix to act on: the
          sheet itself has to rise.

          The scrim container becomes the KeyboardAvoidingView rather than gaining a
          wrapper, which is exactly how app/(trainer)/costs.tsx, receipts.tsx and
          invoices.tsx do it — `behavior="padding"` shrinks the flex:1 column and the
          bottom-anchored sheet comes up with it. */}
      <Modal visible={!!writing} animationType="slide" transparent onRequestClose={() => setWriting(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34 }}>
            <Text style={{ ...ty.head, color: t.ink }}>What You Did About {writing?.name ?? 'this enquiry'}</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Repple sent nothing and will send nothing. Write down what you actually did, so the next time you open this
              you know where it got to — and so you do not ring the same person twice.
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={MAX_FOLLOW_UP}
              placeholder="Rang, left a voicemail. Trying again Thursday."
              placeholderTextColor={t.ink3}
              style={{
                ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
                padding: sp.md, marginTop: sp.lg, minHeight: 110, textAlignVertical: 'top',
              }}
            />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              This is kept for good and cannot be edited afterwards — a note about a moment that can be rewritten later
              records nothing. It goes away only if you remove the enquiry itself.
            </Text>
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
              <Cta label={saving ? 'Saving…' : 'Save'} onPress={saveFollowUp} />
              <Ghost label="Cancel" onPress={() => { if (!saving) { setWriting(null); setDraft(''); } }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
