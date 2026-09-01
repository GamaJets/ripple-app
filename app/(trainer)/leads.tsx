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
//   error    the read did not come back. NOTHING is listed and the banner says
//            so out loud. An empty list here is not an empty inbox.
//   partial  more enquiries exist than came back. The rows are real and are
//            shown; no figure on the screen is a total, and PartialRead says
//            which is which.
//   codes    the enquiries read and the CODES did not. The people are real and
//            where they came from is unknown, so no campaign is named — rather
//            than every one of them rendering as a code the coach does not hold,
//            which reads as broken attribution instead of a failed read.
//   ready    the list is the list.
//
// ── Contact is one field, and the app never guesses ───────────────────────
//
// `contact` holds whatever the person typed. `contactKind` in src/lib/leads.ts
// reads it back as an email, a phone number, or NEITHER, and 'unknown' is a real
// answer: an Instagram handle gets no dial button, because a coach finds out
// that a tel: link over a handle dials nothing only after they have tapped it.
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Notice, Flag, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { num } from '../../src/lib/format';
import { useLeads } from '../../src/ui/leads';
import {
  FOLLOW_UP_IS_MANUAL, MISTYPED_CODE_NOTE, LEAD_STATE_LABEL, LEAD_STATE_NOTE, MAX_FOLLOW_UP,
  FOLLOW_UP_LABEL, FOLLOW_UP_WHEN, followUpDraft, followUpLink, followUpRecord,
  type LeadRow, type LeadState, type FollowUpKind,
} from '../../src/lib/leads';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { fetchMyCoachBrand } from '../../src/ui/coachBrand';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { appLocale } from '../../src/lib/locale';

/** A date as a coach reads one. Unknown stays unknown. */
function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
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
  const { name: coachName } = useMyTrainerProfile();
  const [tradingName, setTradingName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const b = await fetchMyCoachBrand();
        // A failed read is no trading name, which reads perfectly well — the
        // draft simply does not name a business. It is NOT a reason to fall
        // back to the app's own name, which is the one name it must not use.
        if (live) setTradingName(b?.brandName ?? null);
      } catch { if (live) setTradingName(null); }
    })();
    return () => { live = false; };
  }, []);

  const listed = book.rows.filter((r) => filter === 'all' || r.state === filter);

  const mark = (lead: LeadRow, state: LeadState) => {
    void book.setState(lead.id, state).then((r) => {
      if (!r.ok) Alert.alert('Not saved', r.reason);
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
              if (!r.ok) Alert.alert('Not removed', r.reason);
            });
          },
        },
      ],
    );
  };

  const reach = (lead: LeadRow) => {
    const url = lead.contactKind === 'email'
      ? `mailto:${lead.contact}`
      : `tel:${lead.contact.replace(/[^\d+]/g, '')}`;
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'Could not open that',
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
        'Nothing to open it with',
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
          'Could not open that',
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
      if (!r.ok) { Alert.alert('Not recorded', r.reason); return; }
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Who asked and did not join</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Enquiries</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Your join link now carries a short form, so somebody who is not ready to install the app can still leave their
          name. They arrive here with the code they came in on, so an enquiry is attributed the same way a client is.
        </Text>

        {/* Said first, and not softened. */}
        <View style={{ marginTop: sp.xl }}>
          <Notice tone={t.warn} kicker="Nothing is sent" title="Following these up is you, by hand" note={FOLLOW_UP_IS_MANUAL} />
        </View>

        {/* What the words on the rows below actually mean — an enquiry is not a
            client, the code is the attribution, and "contacted" is a note to
            self. src/lib/screenHelp.ts holds them; one dismissible row. */}
        <ScreenHelp screen="coach-enquiries" />

        <Section>
          <SectionHead title="Your enquiries" />
          <Text style={{ ...ty.label, color: t.ink2 }}>{book.note}</Text>

          {book.status === 'loading' ? (
            <ActivityIndicator color={t.brand} style={{ marginVertical: 24 }} />
          ) : book.status === 'error' ? (
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
              {book.status === 'partial' ? (
                <View style={{ marginTop: sp.lg }}>
                  <PartialRead what="enquiries" shown={book.rows.length} onPress={() => { void book.reload(); }} />
                </View>
              ) : null}

              {/* The filter. Only worth drawing once there is something to
                  filter — four buttons above an empty list is furniture. */}
              {book.rows.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, flexWrap: 'wrap' }}>
                  {FILTERS.map((f) => {
                    const n = f.key === 'all' ? book.rows.length : book.rows.filter((r) => r.state === f.key).length;
                    return f.key === filter
                      ? <Cta key={f.key} label={`${f.label} (${num(n)})`} onPress={() => setFilter(f.key)} />
                      : <Ghost key={f.key} label={`${f.label} (${num(n)})`} onPress={() => setFilter(f.key)} />;
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

        <Section>
          <SectionHead title="What this cannot see" />
          <Text style={{ ...ty.body, color: t.ink2 }}>{MISTYPED_CODE_NOTE}</Text>
          <View style={{ marginTop: sp.md }}>
            <Rule />
          </View>
          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
            An enquiry is never joined to an account, so this screen cannot tell you whether one of these people later
            signed up. Marking an enquiry closed says you are finished with it — it does not say how it ended.
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
      <Modal visible={!!writing} animationType="slide" transparent onRequestClose={() => setWriting(null)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 34 }}>
            <Text style={{ ...ty.head, color: t.ink }}>What you did about {writing?.name ?? 'this enquiry'}</Text>
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
        </View>
      </Modal>
    </SafeAreaView>
  );
}
