// Studio · Share Kit on Growth. Four posts a gym makes to fill its classes:
//
//   · This Week's Classes  → the next seven days of the real timetable.
//   · A Promo Code         → one of the gym's live codes, at its real discount.
//   · Member Milestones    → class visits recorded over the last 30 days.
//   · An Event or Opening  → the owner's own words.
//
// No member is named on any of them: the milestone is a count, never a person.
// A read that fails says so on its row instead of posting a zero. The cards come
// from src/lib/postCard.ts and carry the gym's name and brand colour.
import { useEffect, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTheme } from '../components';
import { Section, SectionHead, ListRow, Cta } from '../kit';
import { sp, radius, type as ty } from '../../theme/scale';
import { SharePostSheet } from '../SharePost';
import { useTenant } from '../tenant';
import { useClasses } from '../classes';
import { usePromos } from '../promos';
import { supabase } from '../../lib/supabase';
import { fetchClasses, summariseAttendance, classesThatRan } from '../../lib/gymSchedule';
import { reportError } from '../../lib/reportError';
import { weekdayNameShort, fmtTime } from '../../lib/format';
import { classesPost, promoPost, milestonePost, eventPost, type PostBuild } from '../../lib/postCard';

const DAY_MS = 86_400_000;
const when = (iso: string) => `${weekdayNameShort(new Date(iso).getDay())} ${fmtTime(iso)}`;

export function GymPosts() {
  const t = useTheme();
  const { tenant, status: tenantStatus } = useTenant();
  const brand = tenantStatus === 'ready' ? (tenant?.name ?? '').trim() : '';
  const { classes, status: classStatus } = useClasses();
  const { promos, status: promoStatus } = usePromos();
  const [visits, setVisits] = useState<{ visits: number; classes: number } | null | 'error'>(null);
  const [open, setOpen] = useState<'promo' | 'event' | null>(null);
  const [ev, setEv] = useState({ title: '', when: '', note: '' });
  const [build, setBuild] = useState<PostBuild | null>(null);

  const tenantId = tenant?.id ?? null;
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    const now = Date.now();
    fetchClasses(supabase, tenantId, new Date(now - 30 * DAY_MS).toISOString(), new Date(now).toISOString())
      .then((rows) => {
        const s = summariseAttendance(rows);
        if (alive) setVisits({ visits: s.attended + s.waitlistAttended, classes: s.classes });
      })
      .catch((e) => { reportError('gymPosts.visits', e); if (alive) setVisits('error'); });
    return () => { alive = false; };
  }, [tenantId]);

  const noBrand = (): PostBuild => ({ ok: false, why: 'Your gym’s name has not loaded yet. Try again in a moment.' });
  const now = Date.now();
  const week = classesThatRan(classes).filter((c) => {
    const at = Date.parse(c.startsAt);
    return at >= now && at < now + 7 * DAY_MS;
  });
  const live = promos.filter((p) => p.active);
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 } as const;

  return (
    <Section>
      <SectionHead title="Share Kit" note="Posts for Instagram, TikTok and More" />
      <ListRow icon="calendar" title="This Week's Classes"
        note={classStatus === 'error' ? 'Your timetable could not be read' : classStatus === 'loading' ? 'Reading your timetable…' : `${week.length} in the next seven days`}
        onPress={() => setBuild(!brand ? noBrand() : classStatus === 'error'
          ? { ok: false, why: 'Your timetable could not be read. Try again when you have a connection.' }
          : classesPost({ classes: week.map((c) => ({ title: c.title, when: when(c.startsAt) })), brand }))} />

      <ListRow icon="sparkle" title="A Promo Code"
        note={promoStatus === 'error' ? 'Your codes could not be read' : live.length ? `${live.length} live to choose from` : 'Make a live code below first'}
        onPress={() => setOpen(open === 'promo' ? null : 'promo')} />
      {open === 'promo' && live.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
          {live.map((p) => (
            <Cta key={p.id} label={`${p.code} · ${p.discountPct}% Off`}
              onPress={() => setBuild(!brand ? noBrand() : promoPost({ code: p.code, pct: p.discountPct, brand }))} />
          ))}
        </View>
      ) : null}

      <ListRow icon="people" title="Member Milestones"
        note={visits === 'error' ? 'Class visits could not be read' : visits ? `${visits.visits.toLocaleString()} class visits in the last 30 days` : 'Counting class visits…'}
        onPress={() => setBuild(!brand ? noBrand() : visits === 'error' || visits === null
          ? { ok: false, why: visits === 'error' ? 'Class visits could not be read. Try again when you have a connection.' : 'Still counting class visits.' }
          : milestonePost({ visits: visits.visits, classes: visits.classes, period: 'Last 30 Days', brand }))} />

      <ListRow icon="bell" title="An Event or Opening" note="In your own words"
        onPress={() => setOpen(open === 'event' ? null : 'event')} />
      {open === 'event' ? (
        <View style={{ gap: sp.sm, marginBottom: sp.md }}>
          <TextInput value={ev.title} onChangeText={(title) => setEv((e) => ({ ...e, title }))} placeholder="Name, e.g. Open Day" placeholderTextColor={t.ink3}
            accessibilityLabel="Event name" style={inp} maxLength={60} />
          <TextInput value={ev.when} onChangeText={(w) => setEv((e) => ({ ...e, when: w }))} placeholder="When, e.g. Saturday 10:00" placeholderTextColor={t.ink3}
            accessibilityLabel="When it is" style={inp} maxLength={40} />
          <TextInput value={ev.note} onChangeText={(note) => setEv((e) => ({ ...e, note }))} placeholder="One line about it" placeholderTextColor={t.ink3}
            accessibilityLabel="About the event" style={inp} maxLength={90} />
          <Cta label="Make the Post" onPress={() => setBuild(!brand ? noBrand() : eventPost({ ...ev, brand }))} />
        </View>
      ) : null}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
        Each post is a picture in your gym’s name and colour, for your share sheet. The caption is copied for you. No member is named.
      </Text>
      <SharePostSheet build={build} onClose={() => setBuild(null)} />
    </Section>
  );
}
