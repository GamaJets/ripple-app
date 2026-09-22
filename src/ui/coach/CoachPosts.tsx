// Coach · Share Kit on the Business tab. Four posts a coach makes to win
// clients, each built from something the coach already has in the app:
//
//   · A Client Win   → the existing Share Kit screen, behind its consent gate.
//   · An Offer       → one of their own active packages, at its real price.
//   · Open Spots     → hours from their own weekly availability, the ones they tick.
//   · Join Me        → their coaching code as a QR.
//
// A read that fails leaves its row explaining that, never a card with a blank
// or a zero on it. The cards themselves come from src/lib/postCard.ts.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../components';
import { Section, SectionHead, ListRow, Cta } from '../kit';
import { sp, radius, type as ty } from '../../theme/scale';
import { SharePostSheet } from '../SharePost';
import { useAuth } from '../auth';
import { useTenant } from '../tenant';
import { useAvailability } from '../availability';
import { fetchMyPackages, type TrainerPackage } from '../../lib/connect';
import { fetchMyJoinCode } from '../joinCode';
import { handOut } from '../../lib/handOutCode';
import { money } from '../../lib/gymRecord';
import { weekdayNameShort, fmtClock } from '../../lib/format';
import { offerPost, spotsPost, joinPost, type PostBuild } from '../../lib/postCard';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: on ? t.brandSoft : t.surface2 }}>
      <Text style={{ ...ty.label, color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
}

export function CoachPosts() {
  const t = useTheme();
  const { user } = useAuth();
  const { tenant, status: tenantStatus } = useTenant();
  const brand = tenantStatus === 'ready' ? (tenant?.name || user?.name || '').trim() : '';
  const { slots, status: slotStatus } = useAvailability();
  const [pkgs, setPkgs] = useState<TrainerPackage[] | null>(null);
  const [link, setLink] = useState<{ code: string; link: string } | null | 'error'>(null);
  const [open, setOpen] = useState<'offer' | 'spots' | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [build, setBuild] = useState<PostBuild | null>(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([fetchMyPackages(), fetchMyJoinCode()]);
    setPkgs(p.status === 'error' ? null : p.rows.filter((r) => r.active));
    if (c.ok) { const h = handOut(c.code); setLink({ code: h.code, link: h.link }); } else setLink('error');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const joinUrl = link && link !== 'error' ? link.link : null;
  const noBrand = (): PostBuild => ({ ok: false, why: 'Your business name has not loaded yet. Try again in a moment.' });

  const sorted = [...slots].sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7) || a.hour - b.hour || a.minute - b.minute);
  const slotLabel = (s: (typeof slots)[number]) => `${weekdayNameShort(s.dow)} ${fmtClock(s.hour, s.minute)}`;

  return (
    <Section>
      <SectionHead title="Share Kit" note="Posts for Instagram, TikTok and More" />
      <ListRow icon="trophy" title="A Client Win" note="Only with your client's yes" onPress={() => router.push('/(trainer)/share-kit')} />

      <ListRow icon="sparkle" title="An Offer or Package"
        note={pkgs === null ? 'Your packages could not be read' : pkgs.length ? `${pkgs.length} to choose from` : 'Add a package first, under Payments'}
        onPress={() => setOpen(open === 'offer' ? null : 'offer')} />
      {open === 'offer' && pkgs?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
          {pkgs.map((p) => (
            <Chip key={p.id} label={p.name} on={false} onPress={() => setBuild(!brand ? noBrand() : offerPost({
              name: p.name, price: money(p.price_cents, p.currency) ?? '',
              detail: p.sessions ? `${p.sessions} ${p.sessions === 1 ? 'Session' : 'Sessions'}${p.billing_interval ? ` a ${cap(p.billing_interval)}` : ''}` : p.billing_interval ? `Every ${cap(p.billing_interval)}` : null,
              brand, link: joinUrl,
            }))} />
          ))}
        </View>
      ) : null}

      <ListRow icon="calendar" title="Open Spots This Week"
        note={slotStatus === 'error' ? 'Your hours could not be read' : sorted.length ? 'Tick the hours that are free' : 'Set your weekly hours on the Calendar first'}
        onPress={() => setOpen(open === 'spots' ? null : 'spots')} />
      {open === 'spots' && sorted.length ? (
        <View style={{ gap: sp.md, marginBottom: sp.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {sorted.map((s) => {
              const on = picked.has(s.id);
              return <Chip key={s.id} label={slotLabel(s)} on={on} onPress={() => setPicked((x) => {
                const n = new Set(x); if (on) n.delete(s.id); else n.add(s.id); return n;
              })} />;
            })}
          </View>
          <Cta label={`Share ${picked.size || ''} Open ${picked.size === 1 ? 'Spot' : 'Spots'}`.replace('  ', ' ')} onPress={() => setBuild(!brand ? noBrand()
            : spotsPost({ times: sorted.filter((s) => picked.has(s.id)).map(slotLabel), brand, link: joinUrl }))} />
        </View>
      ) : null}

      <ListRow icon="share" title="Join Me (Code + QR)"
        note={link === 'error' ? 'Your code could not be read' : link ? `Code ${link.code}` : 'Reading your code…'}
        onPress={() => setBuild(!brand ? noBrand() : link && link !== 'error'
          ? joinPost({ code: link.code, link: link.link, brand })
          : { ok: false, why: link === 'error' ? 'Your coaching code could not be read. Try again when you have a connection.' : 'Your code is still loading.' })} />
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
        Each post is a picture for your share sheet, in your name. The caption is copied for you.
      </Text>
      <SharePostSheet build={build} onClose={() => setBuild(null)} />
    </Section>
  );
}
