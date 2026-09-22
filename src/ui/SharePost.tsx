// The share button every app uses: tap it, see the card, pick Story or Post,
// and the PNG goes to the phone's share sheet (Instagram, TikTok, WhatsApp,
// anywhere) with the caption on the clipboard.
//
// The card is composed in src/lib/postCard.ts, which refuses rather than print
// a figure nobody read. This file only draws it and hands it over, through the
// same SVG → toDataURL → sharePngAsset path app/(trainer)/share-kit.tsx proved.
import { useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Alert, Platform, useWindowDimensions } from 'react-native';
import Svg, { Rect, Text as SvgText, TSpan, Path, G } from 'react-native-svg';
import { useTheme } from './components';
import { Cta, Ghost, Segmented } from './kit';
import { Icon } from './Icon';
import { sp, type as ty, elevation } from '../theme/scale';
import { cardSize, charsPerLine, wrapLines, type CardShape } from '../lib/shareAsset';
import { encodeToMatrix, qrPath, QR_QUIET_ZONE } from '../lib/joinQr';
import { sharePngAsset } from '../lib/social';
import type { PostBuild, PostCard } from '../lib/postCard';

const GROUND = '#0B1D19';
const INK = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.62)';

/** The card in export pixels. Drawn at preview size; `toDataURL` scales it up. */
function PostArt({ card, shape, accent, width, ref }: {
  card: PostCard; shape: CardShape; accent: string; width: number; ref?: React.Ref<Svg>;
}) {
  const { w, h } = cardSize(shape);
  const story = shape === 'story';
  const pad = Math.round(w * 0.08);
  const contentW = w - pad * 2;

  const kickerSize = Math.round(w * 0.032);
  const headSize = Math.round(w * (card.headline.length > 22 ? 0.075 : 0.095));
  const headLead = Math.round(headSize * 1.12);
  const head = wrapLines(card.headline, charsPerLine(contentW, headSize), 3);
  const big = card.big;
  const bigSize = big ? Math.round(w * (big.value.length > 6 ? 0.15 : big.value.length > 3 ? 0.2 : 0.26)) : 0;
  const lineSize = Math.round(w * (card.lines.length > 3 ? 0.036 : 0.042));
  const lineLead = Math.round(lineSize * 1.45);

  const qrSide = card.qr ? Math.round(w * 0.24) : 0;
  const matrix = card.qr ? encodeToMatrix(card.qr) : null;
  const footerSize = Math.round(w * 0.032);
  const footerY = h - pad;

  let y = pad + Math.round(h * 0.01);
  const accentY = y;
  y += Math.round(h * 0.03) + kickerSize;
  const kickerY = y;
  y += Math.round(h * (story ? 0.07 : 0.05));
  const headTop = y + headSize * 0.8;
  y = headTop + (head.length - 1) * headLead + Math.round(h * (story ? 0.06 : 0.04));
  const bigY = y + bigSize * 0.8;
  if (big) y = bigY + Math.round(h * 0.035);
  const linesTop = y + lineSize;
  // Lines never run into the QR or the footer.
  const floor = footerY - footerSize - (qrSide ? qrSide + Math.round(h * 0.02) : Math.round(h * 0.03));
  const room = Math.max(0, Math.floor((floor - linesTop) / lineLead) + 1);
  const lines = card.lines.slice(0, room).flatMap((l) => wrapLines(l, charsPerLine(contentW, lineSize), 2)).slice(0, room);
  // A story is tall: centre the text in the space above the footer instead of
  // leaving its lower half empty. A post is short enough to read top down.
  const lastY = lines.length ? linesTop + (lines.length - 1) * lineLead : big ? bigY : headTop;
  const shift = story ? Math.max(0, Math.round((floor - lastY) / 2 - h * 0.04)) : 0;

  return (
    <Svg ref={ref} width={width} height={Math.round(width * h / w)} viewBox={`0 0 ${w} ${h}`}>
      <Rect x={0} y={0} width={w} height={h} fill={GROUND} />
      <G transform={`translate(0 ${shift})`}>
      <Rect x={pad} y={accentY} width={Math.round(w * 0.08)} height={Math.round(h * 0.006)} rx={4} fill={accent} />
      <SvgText x={pad} y={kickerY} fill={accent} fontSize={kickerSize} fontWeight="700" letterSpacing={kickerSize * 0.12}>
        {card.kicker.toUpperCase()}
      </SvgText>
      {head.map((l, i) => (
        <SvgText key={`h${i}`} x={pad} y={headTop + i * headLead} fill={INK} fontSize={headSize} fontWeight="800">{l}</SvgText>
      ))}
      {big ? (
        <SvgText x={pad} y={bigY} fill={accent} fontSize={bigSize} fontWeight="800">
          {big.value}
          {big.unit ? <TSpan fill={MUTED} fontSize={Math.round(bigSize * 0.36)} fontWeight="600" dx={Math.round(bigSize * 0.12)}>{big.unit}</TSpan> : null}
        </SvgText>
      ) : null}
      {lines.map((l, i) => (
        <SvgText key={`l${i}`} x={pad} y={linesTop + i * lineLead} fill={INK} fontSize={lineSize} fontWeight="600">{l}</SvgText>
      ))}
      </G>
      {matrix ? (() => {
        const n = matrix.count + QR_QUIET_ZONE * 2;
        const s = qrSide / n;
        const x = w - pad - qrSide, qy = footerY - qrSide;
        return (
          <G>
            <Rect x={x} y={qy} width={qrSide} height={qrSide} rx={12} fill="#FFFFFF" />
            <G transform={`translate(${x + QR_QUIET_ZONE * s} ${qy + QR_QUIET_ZONE * s}) scale(${s})`}>
              <Path d={qrPath(matrix)} fill="#000000" />
            </G>
          </G>
        );
      })() : null}
      <Rect x={pad} y={footerY - footerSize * 0.85} width={Math.round(footerSize * 0.5)} height={Math.round(footerSize * 0.5)} rx={3} fill={accent} />
      <SvgText x={pad + footerSize} y={footerY - footerSize * 0.35} fill={MUTED} fontSize={footerSize} fontWeight="700">
        {wrapLines(card.footer, charsPerLine(contentW - qrSide - footerSize, footerSize), 1)[0] ?? ''}
      </SvgText>
    </Svg>
  );
}

const SHAPES = [
  { key: 'story' as const, label: 'Story', a11yLabel: 'Story, 9 by 16' },
  { key: 'post' as const, label: 'Post', a11yLabel: 'Square post, 4 by 5' },
];

/** The preview sheet. `build` is null while closed. */
export function SharePostSheet({ build, onClose }: { build: PostBuild | null; onClose: () => void }) {
  const t = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [shape, setShape] = useState<CardShape>('story');
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<Svg>(null);

  const size = cardSize(shape);
  // Fit the preview inside the sheet on a small phone and at large text.
  const previewW = Math.min(screenW - 80, Math.round((screenH * 0.5) * size.w / size.h), 340);

  const capture = (): Promise<string | null> => new Promise((resolve) => {
    const node = svgRef.current as unknown as { toDataURL?: (cb: (d: string) => void, o?: object) => void } | null;
    if (!node || typeof node.toDataURL !== 'function') { resolve(null); return; }
    let settled = false;
    const finish = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), 5000);
    try { node.toDataURL((d: string) => { clearTimeout(timer); finish(d || null); }, { width: size.w, height: size.h }); }
    catch { clearTimeout(timer); finish(null); }
  });

  // The picture is made while this sheet is open, then the sheet closes and
  // the system share sheet opens once it has gone. iOS will not present one
  // sheet from another that is closing, and stacking them left a closed sheet
  // behind that swallowed taps.
  const pending = useRef<{ png: string | null; card: PostCard } | null>(null);
  const handOver = async () => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    const r = await sharePngAsset(p.png ?? '', p.card.filename, p.card.caption);
    if (r.sent === 'text') {
      Alert.alert('Sent as Text', 'This phone could not make the picture, so the words went on their own.');
    }
  };
  const share = async () => {
    if (!build?.ok || busy) return;
    setBusy(true);
    pending.current = { png: await capture(), card: build.card };
    setBusy(false);
    onClose();
    // Android has no onDismiss and no such restriction. On iOS the timer is
    // the backstop for an onDismiss that never fires; handOver runs once.
    if (Platform.OS !== 'ios') void handOver();
    else setTimeout(() => { void handOver(); }, 800);
  };

  return (
    <Modal visible={!!build} transparent animationType="slide" onRequestClose={onClose} onDismiss={() => { void handOver(); }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose}
        accessibilityRole="button" accessibilityLabel="Close" />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%', ...elevation.e2 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 34, gap: sp.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ ...ty.title, color: t.ink }}>Share</Text>
            <Ghost label="Close" onPress={onClose} />
          </View>
          {build && !build.ok ? (
            <Text style={{ ...ty.body, color: t.ink2 }}>{build.why}</Text>
          ) : build?.ok ? (<>
            <Segmented options={SHAPES} value={shape} onChange={setShape} />
            <View style={{ alignItems: 'center' }}
              accessible accessibilityLabel={`Card preview. ${build.card.kicker}. ${build.card.headline}. ${build.card.big ? `${build.card.big.value} ${build.card.big.unit}. ` : ''}${build.card.lines.join('. ')}`}>
              <View style={{ borderRadius: 14, overflow: 'hidden' }}>
                <PostArt ref={svgRef} card={build.card} shape={shape} accent={t.brandBright} width={previewW} />
              </View>
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>
              The picture goes to your share sheet. The caption is copied, so paste it into your post.
            </Text>
            <Cta label={busy ? 'Preparing…' : 'Share'} wide onPress={() => { void share(); }} disabled={busy} />
          </>) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A button that builds its card on tap and opens the sheet. */
export function SharePostButton({ label, make, wide }: { label: string; make: () => PostBuild; wide?: boolean }) {
  const [build, setBuild] = useState<PostBuild | null>(null);
  return (<>
    {wide ? <Cta label={label} wide onPress={() => setBuild(make())} />
      : <Ghost icon="share" label={label} onPress={() => setBuild(make())} />}
    <SharePostSheet build={build} onClose={() => setBuild(null)} />
  </>);
}

/** A small icon-only share button, for a row or a header. */
export function ShareIconButton({ a11yLabel, make }: { a11yLabel: string; make: () => PostBuild }) {
  const t = useTheme();
  const [build, setBuild] = useState<PostBuild | null>(null);
  return (<>
    <Pressable onPress={() => setBuild(make())} accessibilityRole="button" accessibilityLabel={a11yLabel} hitSlop={10}
      style={{ padding: 6 }}>
      <Icon name="share" size={20} color={t.brand} />
    </Pressable>
    <SharePostSheet build={build} onClose={() => setBuild(null)} />
  </>);
}
