// Coach · Photos a client sent you.
//
// ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
//
// Clients have been able to send a coach a progress photo since
// supabase/parts/47-share-progress-photo.sql, and until now the only place one
// could be opened was a strip inside the client sheet on the dashboard. This is
// the screen for actually looking at them.
//
// ── WHAT A COACH CAN SEE HERE, AND WHY IT IS SO LITTLE ─────────────────────
//
// Exactly the photos this client sent to this coach, one at a time, and nothing
// else. Not "my clients' photos" — there is no such read, at either layer.
// `progress_photos_shared_read` grants a ROW only where a grant addressed to
// the viewer exists, and `photos_obj_read_shared` grants the FILE by the same
// predicate, so a photo with no grant is a 403 on the bytes as well as an
// absent row. Being somebody's coach shows you none of this; being sent a photo
// shows you that photo. There is nothing on this screen to turn on, because
// there is no setting the other end of which would be somebody undressing in a
// bathroom on the strength of a default.
//
// This screen adds no permission. It is a viewer for a grant that already
// exists, and if it were deleted tomorrow nobody's access would change.
//
// ── THE THREE FAILURES THAT MATTER, IN ORDER ───────────────────────────────
//
// 1 · SHOWING A PHOTO THAT WAS TAKEN BACK. The worst thing this screen could
//     do. Two independent guards, so neither has to be relied on alone: the
//     list is re-asked of the server every few minutes, and every signed link
//     dies on its own within five (src/lib/photoInbox.ts). With no signal at
//     all the second still holds — the pictures stop rendering rather than
//     sitting on a desk indefinitely on the strength of a read that has stopped
//     being true. If a photo vanishes from the list while it is open, the
//     viewer closes and says so.
//
// 2 · SAYING "THEY HAVE SENT YOU NOTHING" WHEN THE READ FAILED. Those are two
//     different sentences and a coach acts on them differently — one is a
//     reason to ask, the other is a reason to retry. A third, "you are not
//     their coach right now", is separated out too, because a severed link
//     empties this list for a reason that is nothing to do with the client.
//
// 3 · SAYING SOMETHING ABOUT THE BODY IN THE PICTURE. There is none of that
//     here, deliberately: no before/after pairing the client did not ask for,
//     no derived body-composition reading off an image, no commentary, no
//     progress verdict. What was sent, when it was taken, when it was sent.
//     The coach is a person who can look at a photograph and think for
//     themselves; the app's job is to not put words in their mouth about
//     somebody else's body.
//
// ── TWO DATES, NEVER ONE ───────────────────────────────────────────────────
//
// When it was TAKEN and when it was SENT are different facts. A six-week-old
// photo sent this morning is not this morning's progress, and a screen showing
// one date lets it read as though it were. Both are on every tile, and the gap
// is spelled out in words whenever there is one.
//
// There is deliberately no download, no share and no save. This is somebody
// else's photograph of their own body, shown to one person by name; a copy
// button would quietly make it something else.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { isQueryableId } from '../../src/lib/clientDrift';
import { fetchSharedInbox, SHARED_URL_TTL_S } from '../../src/lib/photoShare';
import {
  liveUrl, linkState, refreshEveryMs, inboxStale, unusableCount, stillShared,
  withdrawnNote, emptyReason, inboxNote, checkedNote, gapNote, stamp,
  type Inbox, type InboxPhoto,
} from '../../src/lib/photoInbox';

/** How often the screen wakes up. It re-renders the tiles (so a link that has
 *  just lapsed stops being drawn the moment it lapses rather than at the next
 *  tap) and re-reads the list when one is due. One timer, two jobs, because a
 *  second timer is a second thing to get wrong. */
const TICK_MS = 15_000;

/** A dash is what a record that cannot support a date renders as. Never a
 *  guess, never today's date, never the other one of the two. */
const NO_DATE = '—';

export default function ClientPhotos() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();

  // Opened from a client's sheet, this arrives already pointed at that person;
  // opened on its own it starts pointed at nobody. It is never used as an
  // access claim — the id only says whose photos to ASK for, and the answer
  // still comes from the grants that client wrote.
  const params = useLocalSearchParams<{ clientId?: string }>();
  const fromParam = typeof params.clientId === 'string' && params.clientId ? params.clientId : null;
  const [picked, setPicked] = useState<string | null>(fromParam);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Read inside the loader and inside the timer, neither of which may be
  // rebuilt when these change: a new loader identity restarts the refresh
  // interval, and an interval that keeps restarting is one that never fires —
  // which would quietly remove the guard against showing a withdrawn photo.
  const openRef = useRef<string | null>(null);
  openRef.current = open;
  const inboxRef = useRef<Inbox | null>(null);
  inboxRef.current = inbox;
  // When the server was last ASKED, as opposed to when it last answered. A
  // failed read leaves no list to be stale, and without this the timer would
  // retry a refused read every fifteen seconds for as long as the screen is
  // open. The retry is wanted; the hammering is not.
  const lastTryRef = useRef(0);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const firstName = client ? client.name.split(' ')[0] : 'They';

  const load = useCallback(async (clientId: string) => {
    if (!USE_SUPABASE) {
      setInbox(null);
      setErr('This build is not talking to a server, so there is nothing to read.');
      return;
    }
    // A client the coach added by hand has no account, so no photo of theirs
    // exists to be sent. Asking anyway means a uuid parse error on the server
    // and a coach reading a database message.
    if (!isQueryableId(clientId)) {
      setInbox(null);
      setErr(null);
      return;
    }
    setLoading(true);
    lastTryRef.current = Date.now();
    try {
      const next = await fetchSharedInbox(clientId);
      // A reply for a client the coach has since switched away from is not an
      // answer about the client on screen.
      if (next.clientId !== clientId) return;
      setInbox(next);
      setErr(null);
      // The refresh is also the revocation check. A photo that has left the
      // list between two reads is one the client took back — or deleted — and
      // it must leave the viewer at the same moment it leaves the list.
      const openId = openRef.current;
      if (openId && !stillShared(openId, next)) {
        setOpen(null);
        setWithdrawn(withdrawnNote());
      }
    } catch (e) {
      reportError('clientPhotos.load', e);
      // Null, never []. An empty list under a failed read would tell this coach
      // their client has sent them nothing, which is a claim about the client
      // that a failed read has not earned.
      setInbox(null);
      setErr('Could not read what they have sent you.');
    } finally {
      setLoading(false);
    }
  }, []);

  // If this route is reached a second time with a different client on it, the
  // selection follows. Without this the screen would keep the person it was
  // first opened for and put their photos under the new name in the header.
  useEffect(() => { if (fromParam) setPicked(fromParam); }, [fromParam]);

  // Switching client throws away the previous answer immediately. Leaving it up
  // while the next read is in flight would put one person's photos under
  // another person's name.
  useEffect(() => {
    setInbox(null);
    setErr(null);
    setOpen(null);
    setWithdrawn(null);
    if (picked) void load(picked);
  }, [picked, load]);

  // Coming back to the screen is the moment a coach is most likely to act on
  // what it says, so anything that has been sitting is re-read rather than
  // trusted from before. A list read seconds ago is left alone: the point is
  // freshness, not traffic.
  useFocusEffect(useCallback(() => {
    if (picked && inboxStale(inboxRef.current, Date.now(), SHARED_URL_TTL_S)) void load(picked);
  }, [picked, load]));

  useEffect(() => {
    if (!picked) return;
    const id = setInterval(() => {
      const at = Date.now();
      // Re-rendering on the tick is what makes a lapsed link stop being drawn
      // the moment it lapses, rather than the next time something else happens
      // to re-render the screen.
      setNow(at);
      if (inboxStale(inboxRef.current, at, SHARED_URL_TTL_S)
          && at - lastTryRef.current >= refreshEveryMs(SHARED_URL_TTL_S)) {
        void load(picked);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [picked, load]);

  const opened = useMemo(
    () => (open && inbox ? inbox.photos.find((p) => p.id === open) ?? null : null),
    [open, inbox],
  );
  const reason = emptyReason(inbox);
  const stale = unusableCount(inbox, now);

  /** One tile's two dates and, when there is one, the gap between them. */
  const dates = (p: InboxPhoto) => ({
    taken: stamp(p.takenAt) ?? NO_DATE,
    sent: stamp(p.sharedAt) ?? NO_DATE,
    gap: gapNote(p.takenAt, p.sharedAt),
  });

  const spoken = (p: InboxPhoto) => {
    const d = dates(p);
    return `Progress photo. Taken ${d.taken === NO_DATE ? 'on a date that was not recorded' : d.taken}. `
      + `Sent ${d.sent === NO_DATE ? 'on a date that was not recorded' : d.sent}.`;
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /** The picture, or the reason there isn't one. An expired signature and a
   *  file that would not sign are different states with different futures, so
   *  they say different things rather than sharing a grey box. */
  const frame = (p: InboxPhoto) => {
    const box = { width: '100%' as const, aspectRatio: 3 / 4, borderRadius: radius.md, backgroundColor: t.surface2 };
    const url = liveUrl(p.link, now);
    if (url) {
      return <Image source={{ uri: url }} accessible accessibilityLabel={spoken(p)} style={box} />;
    }
    const why = linkState(p.link, now) === 'expired'
      ? 'Link expired\nfetching it again'
      : 'Picture\nunavailable';
    return (
      <View accessible accessibilityLabel={`${spoken(p)} ${why.replace('\n', ' ')}.`}
        style={{ ...box, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.sm }}>
        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>{why}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Sent to you</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Progress photos</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          You see a photo here because the client sent you that photo. Being their coach shows you
          none of the others, and they can take any of these back at any time.
        </Text>

        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nobody is listed below because the list did not come back — not because your book is empty. Open this again once you are connected." />
          </Section>
        ) : null}

        <Section>
          <SectionHead title="Client" />
          {r.roster.length === 0 && r.status !== 'error' ? (
            <Text style={{ ...ty.body, color: t.ink3 }}>Nobody is on your book yet.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {r.roster.map((c) => (
                <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                  accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                  accessibilityLabel={c.name} style={chip(picked === c.id)}>
                  <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Section>

        {picked ? (
          <View>
            <Rule />
            <Section>
              <SectionHead
                title={client?.name ?? 'Sent to you'}
                note={inboxNote(inbox) ?? undefined}
              />

              {withdrawn ? (
                <Notice tone={t.warn} kicker="Withdrawn" title="One of these has gone" note={withdrawn} />
              ) : null}

              {err ? (
                <Notice tone={t.warn} kicker="Not loaded" title="Their photos could not be read"
                  note={`${err} That is not the same as ${firstName} having sent none — nothing came back, so this screen cannot say either way.`} />
              ) : !isQueryableId(picked) ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  You added {firstName} to your book yourself, so they have no Repple account and no
                  photos to send from one.
                </Text>
              ) : reason === 'unknown' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading what they have sent you…</Text>
              ) : reason === 'unlinked' ? (
                // The empty list here is about the account, not about the
                // person. Saying "they have sent you nothing" would be a claim
                // about a client whose photos may well still be waiting for
                // whoever their coach is now.
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  You are not currently linked as {firstName}&rsquo;s coach, so nothing they have sent
                  can be opened here. This does not tell you whether they sent anything.
                </Text>
              ) : reason === 'none' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  {firstName} has not sent you any progress photos. There is nothing to turn on —
                  a photo reaches you only when they send that photo.
                </Text>
              ) : inbox ? (
                <View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
                    {inbox.photos.map((p) => {
                      const d = dates(p);
                      return (
                        <Pressable key={p.id} onPress={() => { setWithdrawn(null); setOpen(p.id); }}
                          accessibilityRole="button" accessibilityLabel={`Open larger. ${spoken(p)}`}
                          style={{ flexBasis: '47%', flexGrow: 1, maxWidth: '48%' }}>
                          {frame(p)}
                          {/* Both dates on every tile, the shot first. One date
                              alone is how a six-week-old photo sent this
                              morning gets read as this morning. */}
                          <Text style={{ ...ty.caption, color: t.ink2, marginTop: 5 }}>Taken {d.taken}</Text>
                          <Text style={{ ...ty.caption, color: t.ink3 }}>Sent {d.sent}</Text>
                          {d.gap ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{d.gap}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    {checkedNote(inbox, now)}{loading ? ' · checking again' : ''}. Links stop working after{' '}
                    {Math.round(SHARED_URL_TTL_S / 60)} minutes and this list is re-read about every{' '}
                    {Math.round(refreshEveryMs(SHARED_URL_TTL_S) / 60000)} minutes, so a photo they take
                    back stops opening here shortly after they do it.
                  </Text>

                  {stale ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                      {stale === 1
                        ? 'One of these has no picture behind it at the moment.'
                        : `${stale} of these have no picture behind them at the moment.`}
                    </Flag>
                  ) : null}

                  <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                    <Ghost label={loading ? 'Checking…' : 'Check again now'} onPress={() => { if (picked) void load(picked); }} />
                  </View>
                </View>
              ) : null}
            </Section>
          </View>
        ) : null}
      </ScrollView>

      {/* ── one photo, larger ────────────────────────────────────────────────
          Full screen on the app's own background rather than a scrim over the
          list: a body is not a preview to be half-seen behind a grid. The two
          dates travel with the picture, because this is the view somebody is
          most likely to read as "now". */}
      <Modal visible={!!opened} animationType="fade" onRequestClose={() => setOpen(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          {opened ? (
            <View style={{ flex: 1, paddingHorizontal: layout.gutter, paddingBottom: sp.xl }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <Ghost icon="back" a11yLabel="Close photo" onPress={() => setOpen(null)} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Sent by {firstName}</Text>
                  <Text style={{ ...ty.head, color: t.ink, marginTop: 2 }}>
                    Taken {dates(opened).taken}
                  </Text>
                </View>
              </View>

              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                {liveUrl(opened.link, now) ? (
                  <Image source={{ uri: liveUrl(opened.link, now) as string }}
                    accessible accessibilityLabel={spoken(opened)} resizeMode="contain"
                    style={{ width: '100%', height: '100%', borderRadius: radius.md }} />
                ) : (
                  <Text style={{ ...ty.body, color: t.ink3, textAlign: 'center' }}>
                    {linkState(opened.link, now) === 'expired'
                      ? 'The link to this picture has expired. It is being fetched again.'
                      : 'This one has no picture behind it any more.'}
                  </Text>
                )}
              </View>

              <View style={{ borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>
                  Taken {dates(opened).taken} · sent to you {dates(opened).sent}
                </Text>
                {dates(opened).gap ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{dates(opened).gap}</Text>
                ) : null}
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
