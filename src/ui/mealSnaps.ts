// Meal photos: pick, shrink, upload, list, sign, comment (part 3560).
// Private bucket `meal-photos`, key '<client id>/<ms>-<token>.jpg'. Every read
// is the reader's own RLS: the member sees theirs, their coach sees theirs.
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { ensureMediaPermission } from './permissions';

export const MEAL_BUCKET = 'meal-photos';
/** Signed URLs live ten minutes; the feed re-signs on focus. */
export const MEAL_URL_SECONDS = 600;
/** The feed's page. Mirrored by nothing server-side: a plain client limit. */
export const MEAL_PAGE = 30;

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealPhoto {
  id: string; clientId: string; path: string; takenAt: string; meal: MealSlot | null; note: string | null;
  kcal: number | null; protein: number | null; carbs: number | null; fat: number | null;
}
export interface MealComment { id: string; photoId: string; authorRole: 'client' | 'coach'; body: string; createdAt: string; mine: boolean }

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export async function pickMealPhoto(source: 'camera' | 'library'): Promise<{ uri: string | null; error: string | null }> {
  if (!(await ensureMediaPermission(source === 'camera' ? 'camera' : 'library', 'photograph a meal'))) return { uri: null, error: null };
  try {
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (res.canceled || !res.assets?.[0]) return { uri: null, error: null };
    return { uri: res.assets[0].uri, error: null };
  } catch (e) { reportError('mealPhotos.pick', e); return { uri: null, error: 'The camera could not be opened.' }; }
}

export async function saveMealPhoto(uid: string, uri: string, extra: { meal: MealSlot | null; note: string; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }): Promise<string | null> {
  if (!USE_SUPABASE) return 'This build has no server, so the photo has nowhere to go.';
  let bytes: ArrayBuffer;
  try {
    const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
    const res = await fetch(out.uri);
    if (!res.ok) return 'That photo could not be read off your phone.';
    bytes = await res.arrayBuffer();
  } catch (e) { reportError('mealPhotos.prepare', e); return 'That photo could not be prepared. Try another one.'; }
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const up = await supabase.storage.from(MEAL_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (up.error) { reportError('mealPhotos.upload', up.error); return 'The photo could not be uploaded, so nothing was saved.'; }
  const note = extra.note.trim();
  const { error } = await supabase.from('meal_photos').insert({
    client_id: uid, path, meal: extra.meal, note: note ? note.slice(0, 500) : null,
    kcal: extra.kcal, protein: extra.protein, carbs: extra.carbs, fat: extra.fat,
  });
  if (error) {
    reportError('mealPhotos.insert', error);
    const rm = await supabase.storage.from(MEAL_BUCKET).remove([path]);
    if (rm.error) reportError('mealPhotos.orphan', rm.error);
    return 'The photo could not be saved.';
  }
  return null;
}

export async function deleteMealPhoto(p: MealPhoto): Promise<boolean> {
  const { error } = await supabase.from('meal_photos').delete().eq('id', p.id).select('id');
  if (error) { reportError('mealPhotos.delete', error); return false; }
  const rm = await supabase.storage.from(MEAL_BUCKET).remove([p.path]);
  if (rm.error) reportError('mealPhotos.deleteObject', rm.error);
  return true;
}

/** Null on a failed read; the array is the newest MEAL_PAGE. */
export async function listMealPhotos(clientId: string): Promise<{ photos: MealPhoto[]; urls: Record<string, string>; comments: Record<string, MealComment[]> } | null> {
  if (!USE_SUPABASE || !clientId) return null;
  try {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) { reportError('mealPhotos.auth', authErr); return null; }
    const me = auth?.user?.id ?? null;
    const { data, error } = await supabase.from('meal_photos')
      .select('id, client_id, path, taken_at, meal, note, kcal, protein, carbs, fat')
      .eq('client_id', clientId).order('taken_at', { ascending: false }).limit(MEAL_PAGE);
    if (error) { reportError('mealPhotos.list', error); return null; }
    const photos: MealPhoto[] = (data ?? []).map((r: any) => ({
      id: String(r.id), clientId: String(r.client_id), path: String(r.path), takenAt: String(r.taken_at),
      meal: r.meal ?? null, note: r.note ?? null, kcal: n(r.kcal), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat),
    }));
    const urls: Record<string, string> = {};
    if (photos.length) {
      const { data: signed, error: se } = await supabase.storage.from(MEAL_BUCKET).createSignedUrls(photos.map((p) => p.path), MEAL_URL_SECONDS);
      if (se) reportError('mealPhotos.sign', se);
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
    }
    const comments: Record<string, MealComment[]> = {};
    if (photos.length) {
      const { data: cs, error: ce } = await supabase.from('meal_photo_comments')
        .select('id, photo_id, author_id, author_role, body, created_at')
        .in('photo_id', photos.map((p) => p.id)).order('created_at', { ascending: true });
      if (ce) { reportError('mealPhotos.comments', ce); return null; }
      for (const c of (cs ?? []) as any[]) {
        (comments[c.photo_id] ??= []).push({ id: String(c.id), photoId: String(c.photo_id), authorRole: c.author_role, body: String(c.body), createdAt: String(c.created_at), mine: !!me && c.author_id === me });
      }
    }
    return { photos, urls, comments };
  } catch (e) { reportError('mealPhotos.list', e); return null; }
}

export async function addMealComment(photoId: string, role: 'client' | 'coach', body: string): Promise<boolean> {
  const b = body.trim();
  if (!b) return false;
  const { error } = await supabase.from('meal_photo_comments').insert({ photo_id: photoId, author_role: role, body: b.slice(0, 1000) }).select('id');
  if (error) { reportError('mealPhotos.comment', error); return false; }
  return true;
}
