// The card a message draws for the workout or form check it points at
// (part 3550). Read from the named row through the reader's own RLS, so a
// coach sees it only for their own client and a deleted or expired row reads
// as gone rather than as a stale copy. Also the picker's two short lists.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Icon } from './Icon';
import { sp, radius, type as ty } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fmtDay } from '../lib/format';
import type { ChatRole, MessageRef } from './messaging';

interface RefView { title: string; line: string }

async function readRef(ref: MessageRef): Promise<RefView | null> {
  if (!USE_SUPABASE) return null;
  try {
    if (ref.kind === 'workout') {
      const { data, error } = await supabase.from('workouts').select('exercise, performed_at, sets').eq('id', ref.id).maybeSingle();
      if (error) { reportError('messageRef.workout', error); return null; }
      if (!data) return { title: 'Workout', line: 'This workout is no longer in the log.' };
      const n = Array.isArray(data.sets) ? data.sets.length : 0;
      return { title: String(data.exercise), line: `${fmtDay(String(data.performed_at))}${n ? ` · ${n} set${n === 1 ? '' : 's'}` : ''}` };
    }
    const { data, error } = await supabase.from('form_clips').select('note, created_at, coach_reply').eq('id', ref.id).maybeSingle();
    if (error) { reportError('messageRef.clip', error); return null; }
    if (!data) return { title: 'Form Check', line: 'This clip has expired or been deleted.' };
    return { title: 'Form Check', line: `${fmtDay(String(data.created_at))}${data.note ? ` · “${data.note}”` : ''}${data.coach_reply ? ' · answered' : ''}` };
  } catch (e) { reportError('messageRef.read', e); return null; }
}

export function MessageRefCard({ msgRef, role, clientId, mine }: { msgRef: MessageRef; role: ChatRole; clientId: string; mine: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const [v, setV] = useState<RefView | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void readRef(msgRef).then((r) => { if (live) setV(r); });
    return () => { live = false; };
  }, [msgRef.kind, msgRef.id]);
  const open = () => {
    if (role === 'coach') router.push({ pathname: '/(trainer)/client-training', params: { clientId } } as never);
    else router.push('/(client)/history' as never);
  };
  return (
    <Pressable onPress={open} accessibilityRole="button"
      accessibilityLabel={v ? `${v.title}. ${v.line}` : msgRef.kind === 'workout' ? 'Shared workout' : 'Shared form check'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, padding: sp.md, borderRadius: radius.md, marginBottom: sp.xs,
        alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.brand }}>
      <Icon name={msgRef.kind === 'workout' ? 'train' : 'video'} size={18} color={t.brand} />
      <View style={{ flexShrink: 1 }}>
        <Text style={{ ...ty.label, color: t.ink }}>{v?.title ?? (msgRef.kind === 'workout' ? 'Workout' : 'Form Check')}</Text>
        <Text style={{ ...ty.caption, color: t.ink3 }}>
          {v === undefined ? 'Loading…' : v === null ? 'Could not be read just now.' : v.line}
        </Text>
      </View>
    </Pressable>
  );
}

export interface RefOption { ref: MessageRef; label: string }

/** The member's own last few workouts or clips, for the picker. Null on a failed read. */
export async function recentRefOptions(kind: MessageRef['kind'], uid: string, n = 5): Promise<RefOption[] | null> {
  if (!USE_SUPABASE || !uid) return null;
  try {
    if (kind === 'workout') {
      const { data, error } = await supabase.from('workouts').select('id, exercise, performed_at')
        .eq('user_id', uid).not('sets', 'is', null).order('performed_at', { ascending: false }).limit(n);
      if (error) { reportError('messageRef.recentWorkouts', error); return null; }
      return (data ?? []).map((r: any) => ({ ref: { kind, id: String(r.id) }, label: `${r.exercise} · ${fmtDay(String(r.performed_at))}` }));
    }
    const { data, error } = await supabase.from('form_clips').select('id, note, created_at')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(n);
    if (error) { reportError('messageRef.recentClips', error); return null; }
    return (data ?? []).map((r: any) => ({ ref: { kind, id: String(r.id) }, label: `${r.note ? String(r.note).slice(0, 30) : 'Form check'} · ${fmtDay(String(r.created_at))}` }));
  } catch (e) { reportError('messageRef.recent', e); return null; }
}
