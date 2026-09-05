// Trainer · Share Kit — compose a graphic worth posting, then hand it to the
// phone's share sheet.
//
// ── why this screen exists ──────────────────────────────────────────────────
//
// Because the thing next door pretended to be an upload client. "Broadcast a
// Session" listed YouTube, Instagram, Facebook and TikTok, showed a connection
// dot beside each, and published to none of them — there was no OAuth flow, no
// token store, no upload endpoint, and the Settings → Integrations screen its
// footnote sent coaches to has never existed. The post-mortem is in the header
// of src/lib/social.ts, along with what direct publishing would actually cost
// (an app review per network, and Instagram only publishes for Business
// accounts through the Graph API, from media it fetches off a public URL we
// would have to host).
//
// None of which the coach can do anything about. What they can do — tonight, on
// the build in their pocket — is make something good and post it themselves in
// two taps. The owner has said online coaching is where these trainers live, so
// this is not a consolation feature; it is the marketing surface, done in the
// only way that is honestly available.
//
// ── the two cards, and why one of them takes typing ─────────────────────────
//
// MY WEEK is built from the coach's own delivered sessions — real rows, marked
// by them, read here and counted. Nothing on it belongs to anybody else, so
// there is no consent question and no gate.
//
// A CLIENT RESULT's FIGURES are deliberately NOT sourced from the database, and
// that is a decision rather than a shortcut. This app holds no record of any
// client having agreed to have their numbers posted, and a coach is not
// entitled to consent on their client's behalf. An app that offered "pick a
// client → here are their scan figures → share" would be volunteering somebody's
// body composition for publication on the strength of one tap by a person who is
// not the subject. So the coach types the figures their client actually agreed
// to, ticks that they agreed, and the gate in src/lib/shareAsset.ts refuses to
// build a card otherwise.
//
// The subtle half is the free text. A coach writing about a client will type
// their name without thinking — so when the name has not been consented to,
// `scrubName` takes it back out of what they wrote, in the caption AND in the
// headline, which are the two places it would realistically have escaped from.
//
// ── the photograph, and why it works the other way round ────────────────────
//
// This screen used to say that progress photos never entered it at all, because
// `ShareCard` had no image field. That was right while the only consent in the
// building was a tick a COACH put in a box: a coach ticking a box about their
// client's body is not that client agreeing to anything, and the app could not
// tell the difference.
//
// It can now. supabase/parts/331 gives the client a per-photo permission to
// PUBLISH — written by them, unwritable by the coach, and a child row of the
// send grant so that taking the photo back takes it with it. So the photo half
// of this screen is built the OPPOSITE way to the figures half:
//
//   · the figures are TYPED, because the app cannot verify what was agreed;
//   · the photo is PICKED FROM A LIST THE DATABASE BUILT, because the app can.
//
// The picker is `publishablePhotos()` over the permissions read, so there is no
// route from "this coach can see the photo" to "this photo is on the card". A
// coach who can plainly see a photo in their inbox and cannot put it on a card
// is told why, in `SEEING_IS_NOT_PUBLISHING`, rather than left to conclude the
// screen is broken.
//
// And when there is no permission — or when the permissions read failed — the
// card is drawn WITHOUT a photo and without a marker where one would have been.
// A labelled gap would publish the fact that somebody was asked.
//
// The coach's OWN LOGO has none of this attached to it. It is theirs, it
// identifies nobody else, and the only thing that keeps it off a card is not
// being able to read it.
//
// ── the one network that is posted to directly, and the line it cannot cross ─
//
// There is now an Instagram lane beside the share sheet. It is not the old
// `publishToSocials` coming back: it is one network, with a real OAuth
// connection to a Business or Creator account, a card Meta fetches, and a
// report of what Meta actually said — a container that was created and a post
// that was published being two events, only the second of which is a post. When
// there is no approved credential it says "not available" in those words. See
// src/lib/instagramPublish.ts and supabase/functions/instagram-publish.
//
// AND IT NEVER TAKES A CARD WITH A CLIENT'S PHOTOGRAPH ON IT. Instagram does
// not accept an image; it fetches one, from a public unauthenticated URL that
// this product has to create for it. A client's per-photo publish permission
// (supabase/parts/331) is permission for a post their coach makes, from their
// coach's phone. It is not permission to put a picture of their body at an
// address anybody on the internet can fetch. So a card carrying a photograph
// keeps the share sheet — which posts to the same account, in two taps, with no
// public copy of anything — and the screen says that in plain words rather than
// hiding the button.
//
// The refusal is `checkPublishable`, which is the only thing that can produce
// the value `publishCardToInstagram` accepts. There is no state on this screen
// that could be got into where a photo card reaches the publish call.
//
// ── registration ────────────────────────────────────────────────────────────
//
// Declared in app/(trainer)/_layout.tsx as
// `<Tabs.Screen name="share-kit" options={{ href: null, title: 'Share Kit' }} />`,
// which is what keeps it off the tab bar, and reached from the Go To grid via
// COACH_FEATURES in src/lib/features.ts. This note used to say the line was
// still owed by another change; it has since landed, and `check:tabs` and
// `check:reachable` both hold it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// The instant the published window is cut on, recomputed at local midnight, on
// foreground and on focus. See the card memo below.
import { useNow } from '../../src/ui/today';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
// React Native's own <Image>, which is in every binary ever built. The
// thumbnails here are still photographs and nothing needs an animated format,
// so this screen does not have to branch on HAS_NATIVE_IMAGE.
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, useWindowDimensions, Image as RnImage } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Rect, Text as SvgText, Line, Image as SvgImage, Defs, ClipPath } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost, Notice, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { deliveredBetween, fetchMySessions, windowStart } from '../../src/lib/trainerSessions';
import type { PtSession } from '../../src/lib/gymSessions';
import {
  CARD_SIZES, cardSize, charsPerLine, wrapLines, weekCard, resultCard,
  BRAND_UNREAD_NOTE, LOGO_SET_NOT_FETCHED,
  type CardShape, type ShareCard, type CardBuild, type Stat,
} from '../../src/lib/shareAsset';
import { sharePngAsset, imageShareBlocker } from '../../src/lib/social';
import { useRoster } from '../../src/ui/roster';
import { useMyCoachLogo } from '../../src/ui/coachLogo';
import { fetchPhotosSharedWithMe, type SharedPhoto } from '../../src/lib/photoShare';
import { photoDataUri, usePublishGrantsFrom } from '../../src/ui/photoPublish';
import {
  PICK_A_CLIENT_FIRST, SEEING_IS_NOT_PUBLISHING, publishConsentNote, publishConsentOf,
  publishablePhotos, type PublishConsent,
} from '../../src/lib/photoPublish';
import type { LoadStatus } from '../../src/ui/loadStatus';
import {
  PHOTO_KEEPS_THE_SHARE_SHEET, WHY_NO_PHOTOGRAPHS, checkPublishable, connectionNote,
  outcomeNote, reviewRefusalNote,
} from '../../src/lib/instagramPublish';
import {
  chooseInstagramPage, connectInstagram, disconnectInstagram, publishCardToInstagram,
  useMyInstagram, type PageChoice,
} from '../../src/ui/instagram';
import { BACK_ICON } from '../../src/ui/direction';

/** How far back "my week" looks. Two spans, because a quiet week is a real
 *  thing and a coach should be able to widen the window rather than be told
 *  there is nothing to post about. */
const SPANS: { days: number; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
];

type Mode = 'week' | 'result';

export default function ShareKit() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user: authUser, loading: authLoading } = useAuth();
  const coachId = authUser?.id ?? null;
  // `status` as well as the tenant. src/ui/tenant.tsx carries it precisely
  // because "this coach has no gym" and "the gym could not be read" are two
  // different answers, and on this screen the difference is which NAME gets
  // published — see `BRAND_UNREAD_NOTE`.
  const { tenant, status: tenantStatus, refresh: refreshTenant } = useTenant();

  const [mode, setMode] = useState<Mode>('week');
  const [shape, setShape] = useState<CardShape>('post');
  const [days, setDays] = useState<number>(7);

  /** The coach's own sessions. NULL means the read has not landed OR failed —
   *  which is the same thing to every FIGURE below, and is never a zero. */
  const [rows, setRows] = useState<PtSession[] | null>(null);
  /**
   * Whether the read is still in flight.
   *
   * `rows === null` is the right answer for every figure — nothing may be put
   * on a card either way — but it is the wrong answer for the SENTENCE, and the
   * sentence is what the coach reads. This screen opens on the week card with
   * `rows` null, so the first thing on it, every single time and before any
   * request had come back, was a notice headed "Could not read your sessions".
   * Nothing had failed; nothing had been asked yet.
   *
   * `null` was collapsing three facts — not read yet, read failed, not signed
   * in yet — onto the one wording that asserts a failure. Every sibling screen
   * keeps them apart (payments.tsx and ad-spend.tsx both carry a loading flag);
   * this one had no loading state at all.
   */
  const [sessionsPending, setSessionsPending] = useState(true);
  const [busy, setBusy] = useState(false);

  // ── the Instagram lane ──────────────────────────────────────────────────
  //
  // `ig.state` is never 'connected' under a failed read — see connectionState
  // in src/lib/instagramPublish.ts. A green dot that means nothing is the exact
  // defect src/lib/social.ts was written to end, and this screen is the one it
  // was written on.
  const ig = useMyInstagram();
  const [igBusy, setIgBusy] = useState(false);
  /**
   * The Pages a fresh connection turned up, when there was more than one with
   * an Instagram account on it. Null when there is nothing to choose. A coach
   * who also runs a client's gym Page must not have a card posted to the wrong
   * business's feed, and there is no undoing a post.
   *
   * THIS ALONE DECIDES WHETHER THE PICKER IS DRAWN, and it did not used to.
   * The list was gated on `pages?.length` AND `ig.state === 'connected'`, and
   * those two are mutually exclusive: 'connected' is `account.ready`, which is
   * `ig_user_id is not null` in `my_instagram_account()`, and the edge function
   * leaves `ig_user_id` null in exactly the case that produces a list —
   * `chosen` is settled server-side only when precisely one Page has an
   * Instagram account on it. So the picker was gated on the one state in which
   * there is nothing to pick, `chooseInstagramPage` was called from nowhere,
   * and a coach whose Meta login reached two accounts read "Choose the account"
   * over a screen offering them nothing to choose from.
   */
  const [pages, setPages] = useState<PageChoice[] | null>(null);

  // The client-result inputs. Nothing here is remembered between shares: a
  // consent tick is about one post, and a stored one would silently become a
  // standing permission the client never gave.
  const [spanText, setSpanText] = useState('12 weeks in');
  const [figures, setFigures] = useState<Stat[]>([{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]);
  const [note, setNote] = useState('');
  const [clientName, setClientName] = useState('');
  const [okFigures, setOkFigures] = useState(false);
  const [okName, setOkName] = useState(false);

  /** The coach's own mark. No gate: it is theirs. A null `dataUri` is both "not
   *  set" and "could not be fetched", and the card is the same either way. */
  const logo = useMyCoachLogo();

  // ── the photo half ──────────────────────────────────────────────────────
  //
  // Which client this card is about. Null until the coach says, and while it is
  // null NOTHING is read: there is no list of everybody's photos anywhere in
  // this screen, because a picker that showed one would be the wrong shape even
  // with every permission in place.
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  // Bumped by the pull below and read by the sessions effect, so the refresh
  // goes through the one read rather than a duplicate of it.
  const [sessionsNonce, setSessionsNonce] = useState(0);
  const [subject, setSubject] = useState<string | null>(null);
  /** What that client has SENT this coach. Null is unknown, never "none". */
  const [sent, setSent] = useState<SharedPhoto[] | null>(null);
  const [sentStatus, setSentStatus] = useState<LoadStatus>('loading');
  /** What they have separately agreed may be PUBLISHED. */
  const grants = usePublishGrantsFrom(subject);
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** The chosen photo as bytes. Fetched rather than linked, because the export
   *  rasterises the SVG and a remote href is a race it loses silently. */
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [photoPending, setPhotoPending] = useState(false);

  // Changing the subject drops everything about the previous one. A photo id
  // left over from another client is the one bug this whole feature cannot have.
  // Lifted out of the effect so the pull below can run it again. It still
  // clears first: this is also what runs when the SUBJECT changes, and a
  // photo left over from another client is the one bug this feature cannot
  // have.
  const loadSentPhotos = useCallback(async () => {
    if (!subject) { setSent(null); setSentStatus('loading'); return; }
    setSent(null);
    setSentStatus('loading');
    try {
      const rows = await fetchPhotosSharedWithMe(subject);
      setSent(rows); setSentStatus('ready');
    } catch (e) {
      reportError('shareKit.sharedPhotos', e);
      // Null, not []. An empty list here would say this client has sent
      // nothing, which is a claim about them.
      setSent(null); setSentStatus('error');
    }
  }, [subject]);

  useEffect(() => {
    setPickedId(null);
    setPickedUri(null);
    void loadSentPhotos();
  }, [loadSentPhotos]);

  /** The photos this coach may actually use: what they can see, narrowed by
   *  what the client agreed to. Null while either read is unknown, and the
   *  screen says which. */
  const usable = useMemo(
    () => publishablePhotos(sent, coachId, grants.grants, grants.status),
    [sent, coachId, grants.grants, grants.status],
  );

  /** The client's own answer about the photo the coach has picked. Resolved
   *  from the permissions read every time it is asked, so a read that failed
   *  after the pick collapses back to 'unknown' rather than leaving a stale
   *  yes. */
  const photoConsent: PublishConsent = useMemo(
    () => (pickedId && coachId ? publishConsentOf(pickedId, coachId, grants.grants, grants.status) : 'absent'),
    [pickedId, coachId, grants.grants, grants.status],
  );

  const choosePhoto = async (p: SharedPhoto) => {
    if (pickedId === p.id) { setPickedId(null); setPickedUri(null); return; }
    setPickedId(p.id);
    setPickedUri(null);
    setPhotoPending(true);
    const uri = await photoDataUri(p.url);
    setPhotoPending(false);
    setPickedUri(uri);
  };

  useEffect(() => {
    // Still settling who is signed in. Nothing has been asked for yet, so the
    // read is pending rather than failed.
    if (authLoading) { setSessionsPending(true); return; }
    let live = true;
    // Auth has settled and there is still nobody signed in. Nothing is pending:
    // no request is out and none is coming, because there is no id to make one
    // with — so leaving `sessionsPending` true left this screen saying "Still
    // reading what you have delivered. Nothing has failed" for as long as it
    // was open, with no read in flight and no way to reach any other state.
    // `app/(trainer)/_layout.tsx` only checks the group and does not redirect on
    // a lost session, so nothing else evicts the coach from that sentence
    // either. dashboard.tsx sets `sessionsUnread` for this exact condition;
    // this screen was the outlier, and it now agrees.
    if (!coachId) { setRows(null); setSessionsPending(false); return; }
    setSessionsPending(true);
    (async () => {
      try {
        // Widest span once, narrowed in memory. Switching between 7 and 30 days
        // is a thing a coach does while deciding what to post, and re-reading
        // on every tap would put a spinner in the middle of that.
        const mine = await fetchMySessions(supabase, coachId, windowStart(31), new Date().toISOString());
        if (live) { setRows(mine); setSessionsPending(false); }
      } catch (e) {
        reportError('shareKit.mySessions', e);
        // Explicitly back to null, not to []. An empty array here would build a
        // card saying the coach did nothing this week and post it under their
        // name — the exact failure src/lib/shareAsset.ts is written to refuse.
        // The read is no longer pending, though: this IS the failed case, and
        // it is the only one that may say so.
        if (live) { setRows(null); setSessionsPending(false); }
      }
    })();
    return () => { live = false; };
  }, [coachId, authLoading, sessionsNonce]);

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * This screen composes something that gets POSTED, publicly, under the
   * coach's name, and every read behind it can be refused. The two that
   * matter most are the photos a client has SENT and the separate grants
   * saying which of them may be published: a client withdrawing permission
   * happens on the client's phone, and this is the only way the coach's copy
   * of that answer is asked for again before they post.
   *
   * The sessions read goes through the nonce the effect already watches
   * rather than a second copy of it — the null-not-empty rule in there is the
   * thing that stops a card saying the coach did nothing this week. */
  const pull = usePullToRefresh(useCallback(() => {
    setSessionsNonce((n) => n + 1);
    return Promise.all([
      loadSentPhotos(), Promise.resolve(grants.reload()), refreshRoster(),
      Promise.resolve(logo.reload()), Promise.resolve(ig.reload()), Promise.resolve(refreshTenant()),
    ]);
  }, [loadSentPhotos, grants, refreshRoster, logo, ig, refreshTenant]));

  /**
   * Whether the brand on this card is known at all.
   *
   * A WHOLE read with no tenant is a real answer — an independent coach has no
   * gym and their own name is the brand. Anything else is not knowing, and the
   * fallback below silently turns not knowing into the coach's own account
   * name across a public post.
   */
  const brandKnown = tenantStatus === 'ready';
  const brand = brandKnown ? (tenant?.name || authUser?.name || '').trim() : '';
  const span = SPANS.find((s) => s.days === days) ?? SPANS[0];
  /** Both ends of the window the week card counts over. State, not a render-body
   *  read: this screen is registered `href: null` and does not redraw while
   *  nobody is touching it. */
  const nowMs = useNow().getTime();

  const build: CardBuild = useMemo(() => {
    // Before anything else, and it applies to both card kinds: a card is not
    // composed at all while the name it would carry is unknown. 'unread' is the
    // existing refusal for a card that cannot be made from a read, and it is
    // what disables Share and Post to Instagram below.
    if (!brandKnown) return { ok: false, reason: 'unread', why: BRAND_UNREAD_NOTE };
    if (mode === 'result') {
      return resultCard(
        {
          brand,
          clientName: clientName.trim() || null,
          spanLabel: spanText.trim(),
          figures: figures.filter((f) => f.value.trim()).map((f) => ({ label: f.label.trim() || 'Change', value: f.value.trim() })),
          note: note.trim(),
          logo: logo.dataUri,
          // The consent travels WITH the picture rather than beside it, so
          // there is no arrangement of this screen's state that hands
          // shareAsset.ts a photo and a yes that came from different photos.
          photo: pickedId && pickedUri ? { uri: pickedUri, photoId: pickedId, consent: photoConsent } : null,
        },
        { figures: okFigures, name: okName },
      );
    }

    if (rows === null) return weekCard({ brand, spanLabel: span.label, sessions: null, minutes: null, clients: null, logo: logo.dataUri });

    // `nowMs` from `useNow`, and ONE read of it rather than two. Both bounds of
    // the window this card publishes come from here, and the memo's dependency
    // list moves when a read answers, when the coach picks a span and never
    // when time passes — so a screen left open composed "last 7 days" against
    // the seven days before whenever it mounted, and a card posted on Friday
    // could be counting Monday to Sunday of the week before. `check:frozen-day`
    // looks for an EMPTY dependency array and cannot see this shape;
    // `check:frozen-hook` names it, and this is its entry.
    //
    // Two `Date.now()` calls also gave the two bounds two different instants —
    // harmless at this width and wrong in principle, on the pair that decides
    // which sessions a coach publishes a number about.
    const sinceMs = nowMs - days * 86_400_000;
    const untilMs = nowMs;
    const sessions = deliveredBetween(rows, sinceMs, untilMs);
    // The same predicate, written a second time to get the ROWS rather than the
    // count — and then checked against the count, because two definitions of
    // "delivered" drifting apart is how one card ends up saying 9 sessions and
    // 11 clients. If they ever disagree the extra figures go unknown (and so
    // are dropped) rather than being printed from a rule nobody audited.
    const delivered = rows.filter((s) => {
      if (s.outcome !== 'completed') return false;
      const at = Date.parse(s.startsAt);
      return Number.isFinite(at) && at >= sinceMs && at <= untilMs;
    });
    const agrees = delivered.length === sessions;
    const minutes = agrees ? delivered.reduce((a, s) => a + (s.durationMin || 0), 0) : null;
    const clients = agrees ? new Set(delivered.map((s) => s.clientId).filter(Boolean)).size : null;

    return weekCard({ brand, spanLabel: span.label, sessions, minutes, clients, logo: logo.dataUri });
  }, [mode, rows, days, nowMs, span.label, brand, brandKnown, clientName, spanText, figures, note, okFigures, okName,
      logo.dataUri, pickedId, pickedUri, photoConsent]);

  const size = cardSize(shape);
  const svgRef = useRef<Svg>(null);

  /**
   * The rendered card as a base64 PNG, or null when this build cannot make one.
   *
   * `toDataURL` is callback-based and native. Two ways it fails that a plain
   * promise wrapper would turn into a button that spins for ever: the method is
   * absent on some react-native-svg/architecture combinations, and on others
   * the callback is simply never invoked. Both are handled — absent is checked,
   * silent is timed out — and both come back as null, which the share path
   * below turns into an honest "the caption went as text" rather than a hang.
   */
  const capture = (): Promise<string | null> => new Promise((resolve) => {
    const node = svgRef.current as unknown as { toDataURL?: (cb: (d: string) => void, o?: object) => void } | null;
    if (!node || typeof node.toDataURL !== 'function') { resolve(null); return; }
    let settled = false;
    const finish = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), 5000);
    try {
      node.toDataURL((data: string) => { clearTimeout(timer); finish(data || null); }, { width: size.w, height: size.h });
    } catch { clearTimeout(timer); finish(null); }
  });

  const share = async () => {
    if (!build.ok) { Alert.alert('Nothing to share yet', build.why); return; }
    setBusy(true);
    const png = await capture();
    const r = await sharePngAsset(png ?? '', build.card.filename, build.card.caption);
    setBusy(false);

    if (r.sent === 'image') {
      Alert.alert(
        'Card sent to your share sheet',
        r.captionCopied
          ? 'Your caption is on the clipboard — paste it into the post. A share sheet cannot carry an image and its words to the same place, so they travel separately.'
          : 'Copy your caption from the box on this screen before you post — this version of the app could not put it on the clipboard for you.',
      );
      return;
    }
    // The image did not go. Say which of the two reasons it was, because they
    // have different answers and neither of them is "try again".
    const moduleReason = imageShareBlocker();
    Alert.alert(
      'Sent as text instead',
      moduleReason
        ? `${moduleReason}\n\nYour caption has gone to the share sheet.`
        : 'Your phone could not turn the card into an image just now, so the caption has gone to the share sheet on its own. Nothing has been posted — you still choose where it goes.',
    );
  };

  /**
   * Whether THIS card may go to Instagram, and the sentence when it may not.
   *
   * Recomputed from the card and the export size every render rather than held
   * in state, so there is no arrangement of taps that leaves a stale yes behind
   * a card that has since grown a photograph or changed shape.
   *
   * ── the pick, not the pixels ────────────────────────────────────────────
   *
   * `pickedId` counts as a photograph even before `pickedUri` has resolved, and
   * that is the whole point of this line. `choosePhoto` sets the id and THEN
   * fetches the bytes, so for the second or so in between, `build.card.photo`
   * is null while a photograph is on its way onto the card. A gate reading only
   * the built card would say yes in that window, and the capture a moment later
   * would rasterise the photograph that had since arrived.
   *
   * So the moment a coach picks a photo, this path is closed, and it reopens
   * when they take it off. `mode` is in the condition because the pick belongs
   * to the client-result card and a week card has no photo half at all.
   */
  const igGate = useMemo(
    () => checkPublishable(build.ok
      ? {
        ...build.card,
        width: size.w,
        height: size.h,
        photo: build.card.photo ?? (mode === 'result' && pickedId ? { source: 'client-photo' } : null),
      }
      : null),
    [build, size.w, size.h, mode, pickedId],
  );

  /**
   * The same question, readable from inside an async handler.
   *
   * `igGate` above is captured by the closure at the moment the button is
   * pressed, and a publish is not instantaneous: rasterising the card takes a
   * moment, and a coach can tap a photo during it. This ref is written on every
   * render, so it is the answer as of the last commit rather than as of the
   * press, and `postToInstagram` reads it AFTER the capture has come back.
   *
   * Belt to the gate's braces. The gate is what makes the refusal structural;
   * this is what makes it true at the instant the bytes exist.
   */
  const photoOnCardRef = useRef(false);
  photoOnCardRef.current = !!(build.ok && build.card.photo) || (mode === 'result' && !!pickedId);

  const connect = async () => {
    // Read BEFORE the sign-in, because the reload below is what replaces it.
    //
    // The handle of the account this coach was already posting to is the ONLY
    // thing the app holds that can identify that account in the list Meta comes
    // back with. `instagram_accounts` is unreadable from a device by design
    // (part 401) and `my_instagram_account()` returns names and flags — there
    // is no Page id on this side, and there is no need to invent one: the
    // handle is the same string on both, `ig_username` on the row and
    // `igUsername` on a `PageChoice`, both taken from Meta's
    // `instagram_business_account.username`.
    const wasPostingTo = ig.account?.ready ? ig.account.username : null;
    setIgBusy(true);
    const r = await connectInstagram();
    if (!r.ok) { setIgBusy(false); Alert.alert('Not connected', r.reason); return; }

    if (r.chosen) {
      setIgBusy(false);
      setPages(null);
      ig.reload();
      Alert.alert(
        'Instagram connected',
        `Cards will post to ${r.chosen.igUsername ? `@${r.chosen.igUsername}` : r.chosen.name}.${r.warning ? `\n\n${r.warning}` : ''}`,
      );
      return;
    }

    // Nothing was chosen for them. Either there are several Pages with an
    // Instagram account on them, or there are none — and those are different
    // sentences, because only one of them is a decision the coach can make.
    const withIg = r.pages.filter((p) => p.hasInstagram);
    if (!withIg.length) {
      setIgBusy(false);
      setPages(null);
      ig.reload();
      // The one case this screen cannot repair by itself, and it is said as
      // plainly as it can be. The deployed function has already written
      // `ig_user_id: null` over whatever was there, and there is nothing in
      // this list to put back — see the note on the restore below.
      Alert.alert(
        'Nothing to post to',
        'None of the Pages this login can see has an Instagram Business or Creator account linked to it, so there is nowhere for a post to go. Link one in Meta Business Suite and connect again.'
        + (wasPostingTo ? `\n\nThat sign-in has also cleared the account Repple was posting to. Connect again with the Meta login that reaches @${wasPostingTo}.` : ''),
      );
      return;
    }

    // ── putting back what the reconnect just took away ───────────────────
    //
    // The deployed edge function writes `ig_user_id: chosen?.igUserId ?? null`
    // on EVERY connect, and `chosen` is null whenever the login reaches
    // anything other than exactly one Instagram account. So a coach who was
    // posting perfectly well, and who tapped Connect because the banner on this
    // screen told them their connection expires within the week, has just had
    // their account unset by the act of renewing it.
    //
    // The account they were posting to is named in the list that came back, and
    // they were posting to exactly one of them a moment ago. Putting that one
    // back is not a choice being made for them: it is the state they were
    // already in, restored, and it is the only reading of "connect again and
    // posting keeps working" that is true. Anything else — a handle that was
    // renamed at Meta, a genuinely first connection — still shows the list.
    //
    // This is a REPAIR, not a prevention. The null is written before the app
    // hears anything back, so only the function can stop it being written at
    // all; see the note in supabase/functions/instagram-publish/index.ts.
    const same = wasPostingTo ? withIg.filter((p) => p.igUsername === wasPostingTo) : [];
    if (same.length === 1) {
      const back = await chooseInstagramPage(same[0].id);
      setIgBusy(false);
      ig.reload();
      if (back.ok) {
        setPages(null);
        Alert.alert(
          'Instagram reconnected',
          `Cards still post to @${wasPostingTo}. To post from one of the other accounts this login reaches, disconnect below and connect again.`,
        );
        return;
      }
      // The restore was refused. The list is the way back, and it is now on
      // the screen rather than nowhere.
      setPages(withIg);
      Alert.alert('Pick your account again', `${back.reason}\n\nPick the account you post from.`);
      return;
    }

    setIgBusy(false);
    setPages(withIg);
    ig.reload();
    Alert.alert('Choose the account', 'Your Meta login reaches more than one Instagram account. Pick the one you post from — nothing posts anywhere until you do.');
  };

  const choose = async (p: PageChoice) => {
    setIgBusy(true);
    const r = await chooseInstagramPage(p.id);
    setIgBusy(false);
    if (!r.ok) { Alert.alert('Not saved', r.reason); return; }
    setPages(null);
    ig.reload();
  };

  const disconnect = async () => {
    setIgBusy(true);
    const r = await disconnectInstagram();
    setIgBusy(false);
    if (!r.ok) { Alert.alert('Still connected', r.reason); return; }
    setPages(null);
    ig.reload();
  };

  const postToInstagram = async () => {
    // The gate again at the moment of pressing, not only at the moment of
    // drawing. Nothing between the two can have changed the card without this
    // recomputing, and asking twice costs nothing.
    if (!igGate.ok) { Alert.alert('Not posted', igGate.why); return; }
    setIgBusy(true);
    const png = await capture();
    // The bytes now exist and this is the last moment before they could leave.
    // If a photograph reached the card while the card was being rasterised,
    // those bytes have it in them and nothing else in this function would know.
    if (photoOnCardRef.current) {
      setIgBusy(false);
      Alert.alert('Not posted', PHOTO_KEEPS_THE_SHARE_SHEET);
      return;
    }
    const r = await publishCardToInstagram(igGate.card, png ?? '', build.ok ? build.card.kind : 'week');
    setIgBusy(false);

    if (r.ok) {
      Alert.alert(
        'Posted to Instagram',
        [outcomeNote('published'), r.permalink, r.warning].filter(Boolean).join('\n\n'),
      );
      return;
    }
    // Meta's own words, kept. A permissions refusal is almost always the App
    // Review gate rather than anything wrong with the coach's account, and
    // sending them to check their account is sending them nowhere.
    const permission = /permission/i.test(r.reason);
    Alert.alert(
      r.containerCreated ? 'Not published' : 'Nothing was posted',
      permission ? reviewRefusalNote(r.reason) : r.reason,
    );
  };

  const G = layout.gutter;
  // The preview is the same card, drawn at full export size and scaled down, so
  // what the coach approves is what gets exported. Laying out a small version
  // separately would mean two layouts and one of them being the one nobody
  // looked at.
  const previewW = Math.min(width - G * 2, 340);
  const scale = previewW / size.w;
  const previewH = size.h * scale;

  const setFigure = (i: number, patch: Partial<Stat>) =>
    setFigures((f) => f.map((row, k) => (k === i ? { ...row, ...patch } : row)));

  const field = {
    ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
    paddingHorizontal: sp.md, paddingVertical: sp.md,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Marketing</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Share Kit</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          A card from your real numbers. You post it — Repple never posts for you.
        </Text>

        {/* ── what the card is about ─────────────────────────────────────── */}
        <Section>
          <Segmented
            options={[{ key: 'week', label: 'My Week' }, { key: 'result', label: 'A Client Result' }]}
            value={mode}
            onChange={(k) => setMode(k as Mode)}
          />
        </Section>

        {mode === 'week' ? (
          <Section style={{ paddingTop: 0 }}>
            <SectionHead title="Period" />
            <Segmented
              options={SPANS.map((s) => ({ key: String(s.days), label: s.label }))}
              value={String(days)}
              onChange={(k) => setDays(Number(k))}
            />
          </Section>
        ) : (
          <>
            <Rule />
            <Section>
              <SectionHead title="The result" note="You type it" />
              <TextInput value={spanText} onChangeText={setSpanText} placeholder="12 weeks in" placeholderTextColor={t.ink3} style={field} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>The headline on the card — the period, in your words.</Text>

              <View style={{ marginTop: sp.lg, gap: sp.sm }}>
                {figures.map((f, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: sp.sm }}>
                    <TextInput value={f.label} onChangeText={(v) => setFigure(i, { label: v })} placeholder={i === 0 ? 'Weight' : 'Label'} placeholderTextColor={t.ink3} style={{ ...field, flex: 1 }} />
                    <TextInput value={f.value} onChangeText={(v) => setFigure(i, { value: v })} placeholder={i === 0 ? '−8.4 kg' : 'Figure'} placeholderTextColor={t.ink3} style={{ ...field, flex: 1 }} />
                  </View>
                ))}
              </View>
              {/* Typed, not fetched, and the screen says why. A coach who
                  expects the app to fill these in should understand that the
                  refusal is deliberate rather than missing. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Type the figures your client agreed you could post. Repple will not pull them from their record — those are theirs, not yours to publish.
              </Text>

              <TextInput value={note} onChangeText={setNote} placeholder="Add a line of your own (optional)" placeholderTextColor={t.ink3} multiline
                style={{ ...field, marginTop: sp.lg, minHeight: 72, textAlignVertical: 'top' }} />
            </Section>

            <Rule />

            <Section>
              <SectionHead title="Their permission" />
              <Check
                on={okFigures}
                onPress={() => setOkFigures((v) => !v)}
                title="They agreed these figures can be posted publicly"
                note="Without this there is no card to share — not a warning you can tap past."
              />
              <Check
                on={okName}
                onPress={() => setOkName((v) => !v)}
                title="They agreed to be named"
                note="Off by default, and asked separately. Their name is removed from your caption too."
              />
              {okName ? (
                <TextInput value={clientName} onChangeText={setClientName} placeholder="Their name" placeholderTextColor={t.ink3} style={{ ...field, marginTop: sp.md }} />
              ) : (
                <TextInput value={clientName} onChangeText={setClientName} placeholder="Their name — used to keep it OFF the card" placeholderTextColor={t.ink3} style={{ ...field, marginTop: sp.md }} />
              )}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {okName
                  ? 'The first name goes on the card. The surname never does.'
                  : 'Tell Repple their name and it will strip it out of anything you typed above. Only the first name is ever printed, and only with the tick.'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                These two are your word about what your client agreed. Repple cannot check them, which is why it asks you to look at what you wrote.
              </Text>
            </Section>

            <Rule />

            {/* ── the photograph, on the client's own say-so ───────────────
                Built the opposite way round to the figures above: the coach
                types those because the app cannot verify them, and picks this
                from a list the database built because it can. */}
            <Section>
              <SectionHead title="A Photo" note="Their call" />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>{SEEING_IS_NOT_PUBLISHING}</Text>

              {rosterStatus === 'error' ? (
                <Notice kicker="Could not read your clients" title="No photos offered"
                  note="Your book could not be read, so there is nobody to look up permissions for. This is not a coach with no clients." />
              ) : rosterStatus === 'loading' ? (
                // Two states used to fall past this branch into the chip row
                // and render as one: a short book and a book still arriving,
                // both drawn as the whole book. What this screen composes gets
                // POSTED PUBLICLY under the coach's name, and the coach looking
                // for the one client whose result they want to put out, and not
                // finding them, concludes the permission was withdrawn.
                <Text style={{ ...ty.caption, color: t.ink3 }}>Reading your clients…</Text>
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.sm }}>
                    {roster.map((c) => {
                      const on = c.id === subject;
                      return (
                        <Pressable key={c.id} onPress={() => setSubject(on ? null : c.id)}
                          accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.name}
                          style={{ paddingVertical: sp.sm, paddingHorizontal: sp.md, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2, borderWidth: hairline, borderColor: on ? t.brand : t.ring }}>
                          <Text style={{ ...ty.label, fontWeight: '600', color: on ? t.brandInk : t.ink }}>{c.name}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {rosterStatus === 'partial' ? (
                    <View style={{ marginTop: sp.md }}>
                      <Flag tone={t.warn}>
                        Your book came back short, so these are not all of your clients. A client you
                        cannot find here has not withdrawn anything — pull to refresh and look again.
                      </Flag>
                    </View>
                  ) : null}

                  {!subject ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{PICK_A_CLIENT_FIRST}</Text>
                  ) : sentStatus === 'error' ? (
                    <Notice kicker="Could not read their photos" title="No photos offered"
                      note="What this client has sent you could not be read, so nothing is offered. Nothing has been posted and this is not a client who sent none." />
                  ) : grants.status === 'error' ? (
                    // The distinction this whole item turns on. Their photos
                    // read fine; what they AGREED to did not, and a card is not
                    // made out of an unanswered question.
                    <Notice kicker="Could not read their permissions" title="No photo on this card"
                      note={publishConsentNote('unknown') ?? ''} />
                  ) : usable === null ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Reading what they have agreed to…</Text>
                  ) : usable.length === 0 ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      {publishConsentNote('absent')}
                    </Text>
                  ) : (
                    <>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.md, marginTop: sp.md }}>
                        {usable.map((p) => {
                          const on = p.id === pickedId;
                          return (
                            <Pressable key={p.id} onPress={() => { void choosePhoto(p); }}
                              accessibilityRole="button" accessibilityState={{ selected: on }}
                              accessibilityLabel={`Progress photo they agreed you can publish${on ? ', chosen' : ''}`}
                              style={{ borderRadius: radius.md, borderWidth: on ? 2 : hairline, borderColor: on ? t.brand : t.ring, overflow: 'hidden' }}>
                              {p.url ? (
                                <RnImage source={{ uri: p.url }} style={{ width: 84, height: 112, backgroundColor: t.surface2 }} />
                              ) : (
                                // A permission whose file would not sign. Shown
                                // as the gap it is rather than as a blank frame
                                // that reads as a photograph.
                                <View style={{ width: 84, height: 112, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', padding: sp.sm }}>
                                  <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Would not open</Text>
                                </View>
                              )}
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                        {photoPending ? 'Preparing that photo…'
                          : pickedId && !pickedUri ? 'That photo could not be prepared, so the card is made without it. Nothing about their permission has changed.'
                          : pickedId ? 'On the card. Tap it again to take it off.'
                          : 'Tap one to put it on the card. Only the photos this client has agreed you can publish are here.'}
                      </Text>
                    </>
                  )}
                </>
              )}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                A photo with a first name beside it identifies somebody, so without the naming tick above their name comes off the card and out of everything you typed.
              </Text>
            </Section>
          </>
        )}

        <Rule />

        {/* ── shape ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Shape" />
          <Segmented
            options={CARD_SIZES.map((s) => ({ key: s.key, label: s.label, note: s.note }))}
            value={shape}
            onChange={(k) => setShape(k as CardShape)}
          />
        </Section>

        <Rule />

        {/* ── the card ───────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your card" note={build.ok ? `${size.w} × ${size.h}` : undefined} />
          {build.ok ? (
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: previewW, height: previewH, overflow: 'hidden', borderRadius: radius.md, borderWidth: hairline, borderColor: t.ring }}>
                {/* Drawn at export size and scaled about its centre, so the
                    bitmap `toDataURL` takes is the full 1080-wide one whether or
                    not the native side honours the size options. */}
                <View style={{ position: 'absolute', start: (previewW - size.w) / 2, top: (previewH - size.h) / 2, width: size.w, height: size.h, transform: [{ scale }] }}>
                  <CardArt ref={svgRef} card={build.card} w={size.w} h={size.h} accent={t.brand} />
                </View>
              </View>
            </View>
          ) : (
            // A pending read is not a failed one. `build.reason` is 'unread'
            // for both, because to the CARD they are the same refusal — but to
            // the coach they are not, and this is the line they read.
            build.reason === 'unread' && sessionsPending ? (
              <Notice kicker="Reading your sessions" title="No card yet"
                note="Still reading what you have delivered. Nothing has failed — the figures for a card appear here once the read lands." />
            ) : (
            <Notice tone={build.reason === 'unread' ? undefined : t.brand}
              kicker={build.reason === 'unread' ? 'Could not read your sessions' : build.reason === 'consent' ? 'Their call, not yours' : 'Nothing to put on it yet'}
              title="No card"
              note={build.why} />
            )
          )}
        </Section>

        {/* The logo is set and its picture did not arrive. Said HERE, on the
            screen that publishes, because this is the only surface where an
            unbranded card is permanent — app/(trainer)/brand.tsx has drawn the
            same distinction all along. */}
        {logo.path && logo.pictureStatus === 'error' ? (
          <Section>
            <Flag tone={t.warn}>{LOGO_SET_NOT_FETCHED}</Flag>
          </Section>
        ) : null}

        {build.ok ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Caption" note="Copied when you share" />
              <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md }}>
                <Text selectable style={{ ...ty.body, color: t.ink }}>{build.card.caption}</Text>
              </View>
            </Section>
          </>
        ) : null}

        <Section>
          {/* A card that could not be built refuses this control, and the
              refusal was said ONLY in the palette: the fill drops to
              `surface2` and the ink to `ink3`. A coach using VoiceOver heard
              "Share this card, button", tapped it, and got silence — with no
              way to learn that the figures behind the card had not been read.
              The state is now announced as well as coloured. */}
          <Pressable onPress={share} disabled={busy || !build.ok} accessibilityRole="button" accessibilityLabel="Share this card"
            accessibilityState={{ disabled: busy || !build.ok, busy }}
            style={{ backgroundColor: build.ok ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm, opacity: busy ? 0.7 : 1 }}>
            {busy ? <ActivityIndicator color={t.brandInk} /> : <Icon name="share" size={16} color={build.ok ? t.brandInk : t.ink3} />}
            <Text style={{ ...ty.label, fontWeight: '600', color: build.ok ? t.brandInk : t.ink3 }}>{busy ? 'Preparing…' : 'Share this card'}</Text>
          </Pressable>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Opens your phone's share sheet — Instagram, TikTok, WhatsApp, or anywhere else you post. You choose the destination and you confirm the post.
          </Text>
        </Section>

        <Rule />

        {/* ── the one network posted to directly ──────────────────────────
            Everything above stays exactly as it was. This is one network
            beside it, and the sentence about photographs is on the screen
            rather than in a comment, because it is the reason the thing is
            safe rather than an apology for a missing feature. */}
        <Section>
          <SectionHead title="Post to Instagram" note={ig.account?.username ? `@${ig.account.username}` : undefined} />

          {/* The list, and it is FIRST and unconditional on the connection
              state. A list exists only when a sign-in came back without an
              account settled on, which is precisely the state the connection
              reads as not-connected in — so anding this with
              `ig.state === 'connected'` was asking for the one state in which
              there is nothing to choose, and drew the not-connected branch
              underneath an alert saying "Choose the account". */}
          {pages?.length ? (
            <>
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                Your Meta login reaches more than one Instagram account. Pick the one you post from. Nothing posts anywhere until you do.
              </Text>
              {pages.map((p) => (
                <Pressable key={p.id} onPress={() => { void choose(p); }} disabled={igBusy}
                  accessibilityRole="button" accessibilityLabel={`Post to ${p.igUsername ? `@${p.igUsername}` : p.name}`}
                  accessibilityState={{ disabled: igBusy, busy: igBusy }}
                  style={{ paddingVertical: sp.md, paddingHorizontal: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>{p.igUsername ? `@${p.igUsername}` : p.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.name}</Text>
                </Pressable>
              ))}
            </>
          ) : ig.state === 'connected' ? (
            <>
              {igGate.ok ? (
                <>
                  <Cta label={igBusy ? 'Posting…' : 'Post to Instagram'} wide disabled={igBusy || !build.ok}
                    a11yLabel="Post this card to Instagram" onPress={() => { void postToInstagram(); }} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    {WHY_NO_PHOTOGRAPHS}
                  </Text>
                </>
              ) : (
                // The refusal, said as the reason it is safe. A card with a
                // client's photo on it has no button here and does not need
                // one: the share sheet above posts it to the same account.
                <Flag tone={t.warn}>{igGate.why}</Flag>
              )}
              {ig.account?.expiresSoon ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                  This connection expires within the week. Connect again before it does and posting keeps working.
                </Flag>
              ) : null}
              <Ghost label="Disconnect Instagram" onPress={() => { void disconnect(); }} />
            </>
          ) : ig.state === 'not-connected' ? (
            <>
              {/* Authorised, with no account settled on. A real state and its
                  own sentence: telling this coach they are not connected would
                  have them wondering what happened to the sign-in they just
                  completed. Signing in again is what produces the list to
                  choose from, so the button is the same one. */}
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                {ig.account
                  ? 'You are signed in to Meta and no Instagram account has been chosen yet, so there is nowhere for a card to go. Sign in again and pick the account you post from.'
                  : connectionNote('not-connected')}
              </Text>
              <Cta label={igBusy ? 'Connecting…' : 'Connect Instagram'} wide disabled={igBusy}
                a11yLabel="Connect your Instagram account" onPress={() => { void connect(); }} />
            </>
          ) : (
            // 'unknown' and 'unconfigured'. Neither is a dead button and
            // neither is a dot that means nothing: both say what is true and
            // leave the share sheet above doing the job today.
            <Flag tone={t.warn}>{connectionNote(ig.state)}</Flag>
          )}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}

/* ── the artwork ──────────────────────────────────────────────────────────── */

/**
 * The card itself, as SVG, at export resolution.
 *
 * Fixed dark ground and white ink rather than the app's theme, on purpose. This
 * is an artefact for somebody else's feed, not a screen: a coach who happens to
 * have light mode on should not get a white card, and the same card should not
 * come out differently depending on a setting they made months ago for reasons
 * that had nothing to do with posting. The one thing that does follow the app
 * is the accent, because that is the tenant's brand colour and this is a
 * white-label product.
 *
 * Every string is wrapped through `wrapLines` before it is drawn. SVG has no
 * line box — `<Text>` draws one line and lets it run off the edge of the image,
 * silently, in the exported PNG that nobody opens again before posting it.
 */
// `ref` is an ordinary prop here — React 19 passes it straight through to a
// function component, so there is no forwardRef wrapper to keep in step. The
// ref is the whole point of the component: it is what `toDataURL` is called on.
function CardArt({ card, w, h, accent, ref }: {
  card: ShareCard; w: number; h: number; accent: string; ref?: React.Ref<Svg>;
}) {
  const GROUND = '#0B0F14';
  const INK = '#FFFFFF';
  const MUTED = 'rgba(255,255,255,0.58)';

  const pad = Math.round(w * 0.089);          // 96 at 1080
  const contentW = w - pad * 2;
  const footerY = h - pad;

  // The coach's mark, top right, opposite the accent bar. A BOX rather than a
  // size: `preserveAspectRatio="xMaxYMin meet"` fits the image inside it
  // whatever shape it is, so a wide wordmark and a square badge both land on
  // the same line and neither is stretched. A logo that stretched would be
  // worse than no logo, because it is the one thing on the card its owner will
  // recognise as wrong.
  const logoBoxW = Math.round(w * 0.24);
  const logoBoxH = Math.round(w * 0.075);

  const kickerSize = Math.round(w * 0.032);
  const headSize = Math.round(w * (card.headline.length > 22 ? 0.072 : 0.088));
  const headLead = Math.round(headSize * 1.14);
  const headLines = wrapLines(card.headline, charsPerLine(contentW, headSize), 3);

  const kickerLines = wrapLines(card.kicker, charsPerLine(contentW, kickerSize), 1);
  const kickerY = pad + kickerSize + Math.round(h * 0.03);
  const headTop = kickerY + Math.round(h * 0.05) + headSize;

  // Stats are anchored to the bottom rather than flowing from the headline, so
  // a one-line headline and a three-line one produce the same footer position —
  // a card whose baseline moves is a card that looks like a different template
  // every time.
  const statSize = Math.round(w * 0.062);
  const statLabel = Math.round(w * 0.026);
  const statStep = Math.round(statSize * 1.85);
  const ruleY = footerY - Math.round(h * 0.045);
  const statsBottom = ruleY - Math.round(h * 0.035);
  const statsTop = statsBottom - statStep * (card.stats.length - 1);

  const footLines = wrapLines(card.footer, charsPerLine(contentW * 0.7, Math.round(w * 0.03)), 1);

  // The client's photograph, between the headline and the figures. It is the
  // only element on this card whose height is computed from what is left rather
  // than chosen: the figures stay anchored to the bottom (a card whose baseline
  // moves looks like a different template every time) and the headline can be
  // three lines, so the band takes the gap between them.
  //
  // `slice` fills the band and crops, rather than letter-boxing a portrait
  // photograph into a landscape hole and leaving two black bars on a graphic
  // somebody is about to post.
  const photoTop = headTop + headLead * Math.max(0, headLines.length - 1) + Math.round(h * 0.045);
  const photoBottom = statsTop - statSize - Math.round(h * 0.035);
  const photoH = photoBottom - photoTop;
  // Below this it is a strip rather than a picture of a person. There is room
  // on both canvases for the normal case; this is the guard for a three-line
  // headline and three figures on the shorter one, and it drops the photo
  // rather than drawing something unrecognisable.
  const photoFits = !!card.photo && photoH >= Math.round(w * 0.28);

  return (
    <Svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Rect x={0} y={0} width={w} height={h} fill={GROUND} />
      {/* The accent, spent on two marks and nothing else: the rule under the
          kicker and the tick beside the footer. The instrument-panel rule from
          src/ui/kit — colour marks the live thing, not the chrome. */}
      <Rect x={pad} y={pad} width={Math.round(w * 0.075)} height={Math.round(h * 0.006)} fill={accent} rx={Math.round(h * 0.003)} />

      {/* The coach's own mark. Drawn from bytes already in memory — a remote
          href would be a race `toDataURL` resolves by capturing nothing. */}
      {card.logo ? (
        <SvgImage href={{ uri: card.logo.uri }} x={w - pad - logoBoxW} y={pad - Math.round(logoBoxH * 0.25)}
          width={logoBoxW} height={logoBoxH} preserveAspectRatio="xMaxYMin meet" />
      ) : null}

      {/* The client's photograph. It is here because `resultCard` put it here,
          and `resultCard` put it here because that client's own permission row
          said so. There is no branch in this component that could add one. */}
      {card.photo && photoFits ? (
        <>
          <Defs>
            <ClipPath id="cardPhoto">
              <Rect x={pad} y={photoTop} width={contentW} height={photoH} rx={Math.round(w * 0.02)} />
            </ClipPath>
          </Defs>
          <SvgImage href={{ uri: card.photo.uri }} x={pad} y={photoTop} width={contentW} height={photoH}
            preserveAspectRatio="xMidYMid slice" clipPath="url(#cardPhoto)" />
        </>
      ) : null}

      {kickerLines.map((l, i) => (
        <SvgText key={`k${i}`} x={pad} y={kickerY} fill={MUTED} fontSize={kickerSize} fontWeight="600" letterSpacing={kickerSize * 0.12}>
          {l.toUpperCase()}
        </SvgText>
      ))}

      {headLines.map((l, i) => (
        <SvgText key={`h${i}`} x={pad} y={headTop + i * headLead} fill={INK} fontSize={headSize} fontWeight="700">
          {l}
        </SvgText>
      ))}

      {card.stats.map((s, i) => (
        <SvgText key={`s${i}`} x={pad} y={statsTop + i * statStep} fill={INK} fontSize={statSize} fontWeight="700">
          {s.value}
          <SvgText fill={MUTED} fontSize={statLabel} fontWeight="600" letterSpacing={statLabel * 0.1}>
            {`   ${s.label.toUpperCase()}`}
          </SvgText>
        </SvgText>
      ))}

      <Line x1={pad} y1={ruleY} x2={w - pad} y2={ruleY} stroke="rgba(255,255,255,0.16)" strokeWidth={2} />

      {footLines.map((l, i) => (
        <SvgText key={`f${i}`} x={pad} y={footerY} fill={MUTED} fontSize={Math.round(w * 0.03)} fontWeight="600">
          {l}
        </SvgText>
      ))}
      <Rect x={w - pad - Math.round(w * 0.03)} y={footerY - Math.round(w * 0.022)} width={Math.round(w * 0.03)} height={Math.round(w * 0.008)} fill={accent} rx={Math.round(w * 0.004)} />
    </Svg>
  );
}

/* ── small controls ───────────────────────────────────────────────────────── */

/** A row of mutually exclusive options. Not a component in the kit because the
 *  kit's ChipGrid is for tags, which are multi-select and wrap. */
function Segmented({ options, value, onChange }: {
  options: { key: string; label: string; note?: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: sp.sm }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            accessibilityLabel={o.note ? `${o.label}. ${o.note}` : o.label}
            style={{ flex: 1, paddingVertical: sp.md, paddingHorizontal: sp.sm, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: hairline, borderColor: on ? t.brand : t.ring }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: on ? t.brandInk : t.ink }}>{o.label}</Text>
            {o.note ? <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink3, marginTop: 2, opacity: on ? 0.8 : 1 }}>{o.note}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A consent tick. Deliberately its own control rather than a Switch: a switch
 *  reads as a preference, and this is somebody else's permission. */
function Check({ on, onPress, title, note }: { on: boolean; onPress: () => void; title: string; note: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={title}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
      <View style={{ width: 22, height: 22, borderRadius: 7, marginTop: 2, borderWidth: hairline, borderColor: on ? t.brand : t.ink3, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" size={13} color={t.brandInk} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text>
      </View>
    </Pressable>
  );
}
