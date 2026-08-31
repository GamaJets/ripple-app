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
// A CLIENT RESULT is deliberately NOT sourced from the database, and that is a
// decision rather than a shortcut. This app holds no record of any client
// having agreed to be posted about, and a coach is not entitled to consent on
// their client's behalf. An app that offered "pick a client → here are their
// scan figures → share" would be volunteering somebody's body composition for
// publication on the strength of one tap by a person who is not the subject. So
// the coach types the figures their client actually agreed to, ticks that they
// agreed, and the gate in src/lib/shareAsset.ts refuses to build a card
// otherwise. Progress photos never enter it at all: `ShareCard` has no image
// field, so there is no shape here that could carry one.
//
// The subtle half is the caption. A coach writing about a client will type
// their name without thinking — so when the name has not been consented to,
// `scrubName` takes it back out of what they wrote, which is the only place it
// would realistically have escaped from.
//
// ── registration ────────────────────────────────────────────────────────────
//
// This route is NOT declared in app/(trainer)/_layout.tsx, which means
// `check:tabs` fails on it and — worse — it would appear as a TAB. It needs:
//
//     <Tabs.Screen name="share-kit" options={{ href: null, title: 'Share Kit' }} />
//
// That file is owned by another change tonight, so the line is reported rather
// than added.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { deliveredBetween, fetchMySessions, windowStart } from '../../src/lib/trainerSessions';
import type { PtSession } from '../../src/lib/gymSessions';
import {
  CARD_SIZES, cardSize, charsPerLine, wrapLines, weekCard, resultCard,
  type CardShape, type ShareCard, type CardBuild, type Stat,
} from '../../src/lib/shareAsset';
import { sharePngAsset, imageShareBlocker } from '../../src/lib/social';

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
  const { tenant } = useTenant();

  const [mode, setMode] = useState<Mode>('week');
  const [shape, setShape] = useState<CardShape>('post');
  const [days, setDays] = useState<number>(7);

  /** The coach's own sessions. NULL means the read has not landed OR failed —
   *  which is the same thing to every figure below, and is never a zero. */
  const [rows, setRows] = useState<PtSession[] | null>(null);
  const [busy, setBusy] = useState(false);

  // The client-result inputs. Nothing here is remembered between shares: a
  // consent tick is about one post, and a stored one would silently become a
  // standing permission the client never gave.
  const [spanText, setSpanText] = useState('12 weeks in');
  const [figures, setFigures] = useState<Stat[]>([{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]);
  const [note, setNote] = useState('');
  const [clientName, setClientName] = useState('');
  const [okFigures, setOkFigures] = useState(false);
  const [okName, setOkName] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let live = true;
    if (!coachId) { setRows(null); return; }
    (async () => {
      try {
        // Widest span once, narrowed in memory. Switching between 7 and 30 days
        // is a thing a coach does while deciding what to post, and re-reading
        // on every tap would put a spinner in the middle of that.
        const mine = await fetchMySessions(supabase, coachId, windowStart(31), new Date().toISOString());
        if (live) setRows(mine);
      } catch (e) {
        reportError('shareKit.mySessions', e);
        // Explicitly back to null, not to []. An empty array here would build a
        // card saying the coach did nothing this week and post it under their
        // name — the exact failure src/lib/shareAsset.ts is written to refuse.
        if (live) setRows(null);
      }
    })();
    return () => { live = false; };
  }, [coachId, authLoading]);

  const brand = (tenant?.name || authUser?.name || '').trim();
  const span = SPANS.find((s) => s.days === days) ?? SPANS[0];

  const build: CardBuild = useMemo(() => {
    if (mode === 'result') {
      return resultCard(
        {
          brand,
          clientName: clientName.trim() || null,
          spanLabel: spanText.trim(),
          figures: figures.filter((f) => f.value.trim()).map((f) => ({ label: f.label.trim() || 'Change', value: f.value.trim() })),
          note: note.trim(),
        },
        { figures: okFigures, name: okName },
      );
    }

    if (rows === null) return weekCard({ brand, spanLabel: span.label, sessions: null, minutes: null, clients: null });

    const sinceMs = Date.now() - days * 86_400_000;
    const untilMs = Date.now();
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

    return weekCard({ brand, spanLabel: span.label, sessions, minutes, clients });
  }, [mode, rows, days, span.label, brand, clientName, spanText, figures, note, okFigures, okName]);

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
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
                Progress photos are never included. There is no way to put one on a card.
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
                <View style={{ position: 'absolute', left: (previewW - size.w) / 2, top: (previewH - size.h) / 2, width: size.w, height: size.h, transform: [{ scale }] }}>
                  <CardArt ref={svgRef} card={build.card} w={size.w} h={size.h} accent={t.brand} />
                </View>
              </View>
            </View>
          ) : (
            <Notice tone={build.reason === 'unread' ? undefined : t.brand}
              kicker={build.reason === 'unread' ? 'Could not read your sessions' : build.reason === 'consent' ? 'Their call, not yours' : 'Nothing to put on it yet'}
              title="No card"
              note={build.why} />
          )}
        </Section>

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
          <Pressable onPress={share} disabled={busy || !build.ok} accessibilityRole="button" accessibilityLabel="Share this card"
            style={{ backgroundColor: build.ok ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm, opacity: busy ? 0.7 : 1 }}>
            {busy ? <ActivityIndicator color={t.brandInk} /> : <Icon name="share" size={16} color={build.ok ? t.brandInk : t.ink3} />}
            <Text style={{ ...ty.label, fontWeight: '600', color: build.ok ? t.brandInk : t.ink3 }}>{busy ? 'Preparing…' : 'Share this card'}</Text>
          </Pressable>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Opens your phone's share sheet — Instagram, TikTok, WhatsApp, or anywhere else you post. You choose the destination and you confirm the post.
          </Text>
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

  return (
    <Svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Rect x={0} y={0} width={w} height={h} fill={GROUND} />
      {/* The accent, spent on two marks and nothing else: the rule under the
          kicker and the tick beside the footer. The instrument-panel rule from
          src/ui/kit — colour marks the live thing, not the chrome. */}
      <Rect x={pad} y={pad} width={Math.round(w * 0.075)} height={Math.round(h * 0.006)} fill={accent} rx={Math.round(h * 0.003)} />

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
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
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
