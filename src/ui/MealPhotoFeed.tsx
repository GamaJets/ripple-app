// One client's meal photos, newest first, with the comment thread under each.
// The same component on both sides: the member (role 'client', can add and
// delete) and their coach (role 'coach', reads and comments). Accent is the
// app's own brand, so green in the client app and purple in the coach app.
import { useCallback, useState } from 'react';
import { View, Text, Image, TextInput, Alert, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from './components';
import { Section, SectionHead, Ghost } from './kit';
import { sp, radius, type as ty } from '../theme/scale';
import { fmtRelativeDay, num } from '../lib/format';
import { listMealPhotos, addMealComment, deleteMealPhoto, type MealPhoto, type MealComment } from './mealSnaps';

type Feed = { photos: MealPhoto[]; urls: Record<string, string>; comments: Record<string, MealComment[]> };

function macroLine(p: MealPhoto): string | null {
  const bits = [
    p.kcal != null ? `${num(p.kcal)} kcal` : null,
    p.protein != null ? `P ${p.protein}g` : null,
    p.carbs != null ? `C ${p.carbs}g` : null,
    p.fat != null ? `F ${p.fat}g` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

export function MealPhotoFeed({ clientId, role, refreshKey = 0, title = 'Meal Photos' }: { clientId: string | null; role: 'client' | 'coach'; refreshKey?: number; title?: string }) {
  const t = useTheme();
  const [feed, setFeed] = useState<Feed | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!clientId) return () => { live = false; };
    void listMealPhotos(clientId).then((f) => { if (live) setFeed(f); });
    return () => { live = false; };
  }, [clientId, refreshKey, tick]));

  const comment = async (photoId: string) => {
    const body = drafts[photoId] ?? '';
    if (!body.trim()) return;
    const ok = await addMealComment(photoId, role, body);
    if (!ok) { Alert.alert('Not Sent', 'That comment could not be saved. Try again.'); return; }
    setDrafts((d) => ({ ...d, [photoId]: '' }));
    setTick((x) => x + 1);
  };
  const remove = (p: MealPhoto) => {
    Alert.alert('Delete This Photo?', 'It is removed for you and your coach.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void deleteMealPhoto(p).then((ok) => { if (!ok) Alert.alert('Not Deleted', 'That photo could not be deleted.'); setTick((x) => x + 1); }); } },
    ]);
  };

  if (feed === undefined) return null;
  return (
    <Section>
      <SectionHead title={title} note={feed ? `${feed.photos.length} Recent` : undefined} />
      {feed === null ? (
        <Text style={{ ...ty.label, color: t.ink2 }}>Meal photos could not be read just now. That is not the same as there being none.</Text>
      ) : feed.photos.length === 0 ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>
          {role === 'client' ? 'No meal photos yet. Snap your next plate and your coach will see it.' : 'No meal photos from this client yet.'}
        </Text>
      ) : feed.photos.map((p) => {
        const url = feed.urls[p.path];
        const macros = macroLine(p);
        const cs = feed.comments[p.id] ?? [];
        return (
          <View key={p.id} style={{ marginBottom: sp.xl, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: t.surface, borderWidth: 1, borderColor: t.brand }}>
            {url ? (
              <Image source={{ uri: url }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: t.surface2 }} resizeMode="cover"
                accessibilityLabel={p.note ? `Meal photo: ${p.note}` : 'Meal photo'} />
            ) : (
              <View style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.caption, color: t.ink3 }}>This photo could not be loaded.</Text>
              </View>
            )}
            <View style={{ padding: sp.md, gap: sp.xs }}>
              <Text style={{ ...ty.micro, color: t.brand }}>
                {[p.meal ? p.meal[0].toUpperCase() + p.meal.slice(1) : null, fmtRelativeDay(p.takenAt)].filter(Boolean).join(' · ')}
              </Text>
              {p.note ? <Text style={{ ...ty.body, color: t.ink }}>{p.note}</Text> : null}
              {macros ? <Text style={{ ...ty.caption, color: t.ink3 }}>{macros}</Text> : null}
              {cs.map((c) => (
                <View key={c.id} style={{ marginTop: sp.xs, padding: sp.sm, borderRadius: radius.sm, backgroundColor: c.authorRole === 'coach' ? t.surface2 : 'transparent' }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{c.mine ? 'You' : c.authorRole === 'coach' ? 'Coach' : 'Client'} · {fmtRelativeDay(c.createdAt)}</Text>
                  <Text style={{ ...ty.label, color: t.ink }}>{c.body}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                <TextInput value={drafts[p.id] ?? ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [p.id]: v }))}
                  placeholder={role === 'coach' ? 'Comment on this meal' : 'Reply to your coach'} placeholderTextColor={t.ink3}
                  maxLength={1000} accessibilityLabel="Comment"
                  style={{ flex: 1, ...ty.label, color: t.ink, paddingVertical: sp.sm, paddingHorizontal: sp.md, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
                <Pressable onPress={() => { void comment(p.id); }} accessibilityRole="button" accessibilityLabel="Send comment"
                  style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: t.brand }}>
                  <Text style={{ ...ty.label, color: t.brandInk }}>Send</Text>
                </Pressable>
              </View>
              {role === 'client' ? <View style={{ alignSelf: 'flex-start', marginTop: sp.xs }}><Ghost label="Delete Photo" onPress={() => remove(p)} /></View> : null}
            </View>
          </View>
        );
      })}
    </Section>
  );
}
