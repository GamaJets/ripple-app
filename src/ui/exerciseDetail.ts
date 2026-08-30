// One exercise's full catalogue entry, read on demand.
//
// Deliberately not a provider holding all 917 rows. The catalogue carries
// instructions for nearly every movement, so loading it whole to show one
// screen would pull roughly a megabyte to render a page about a single lift —
// on a phone, on mobile data, to display twelve lines of text.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { exerciseSlug } from '../lib/exerciseId';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';

export interface ExerciseDetail {
  id: string;
  name: string;
  group: string | null;
  isCardio: boolean;
  category: string | null;
  equipment: string | null;
  level: string | null;
  mechanic: string | null;
  force: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  imagePaths: string[];
  /** Storage key in the exercise-demos bucket, or null. A path, never a URL. */
  animationPath: string | null;
  /** 'commercial' once bought, 'evaluation' for a CC BY-NC preview, null when
   *  there is no animation. An evaluation asset must never reach a release. */
  demoLicence: string | null;
  source: string | null;
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/**
 * The catalogue row for an exercise NAME.
 *
 * Keyed by slug rather than by the name itself, because the name reaching this
 * hook comes from a program a coach typed — 'Bent-Over Row' and 'Bent-over Row'
 * are the same movement and must not be two different answers.
 *
 * Four outcomes, kept apart: loading, an error (we could not ask), ready with a
 * row, and ready with NOTHING — which is a real answer meaning the movement is
 * not in the catalogue. A coach can type any exercise they like, and one they
 * invented this morning has no row. That must read as "we have no guide for
 * this" and never as a failure.
 */
export function useExerciseDetail(name: string | null | undefined) {
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const id = exerciseSlug(name || '');

  const load = useCallback(async () => {
    if (!id) { setDetail(null); setStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, muscle_group, is_cardio, category, equipment, level, mechanic, force, primary_muscles, secondary_muscles, instructions, image_paths, animation_path, demo_licence, source')
        .eq('id', id)
        .maybeSingle();
      if (error) { reportError('exerciseDetail.read', error, { id }); setDetail(null); setStatus('error'); return; }
      if (!data) { setDetail(null); setStatus('ready'); return; }
      setDetail({
        id: data.id,
        name: data.name,
        group: data.muscle_group ?? null,
        isCardio: !!data.is_cardio,
        category: data.category ?? null,
        equipment: data.equipment ?? null,
        level: data.level ?? null,
        mechanic: data.mechanic ?? null,
        force: data.force ?? null,
        primaryMuscles: strs(data.primary_muscles),
        secondaryMuscles: strs(data.secondary_muscles),
        instructions: strs(data.instructions),
        imagePaths: strs(data.image_paths),
        animationPath: typeof data.animation_path === 'string' && data.animation_path ? data.animation_path : null,
        demoLicence: typeof data.demo_licence === 'string' && data.demo_licence ? data.demo_licence : null,
        source: data.source ?? null,
      });
      setStatus('ready');
    } catch (e) {
      reportError('exerciseDetail.read', e, { id });
      setDetail(null);
      setStatus('error');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  return { detail, status, reload: load };
}

export interface CatalogueRow { id: string; name: string; group: string | null; hasDemo: boolean }

/**
 * Every movement in the catalogue, names only.
 *
 * Names, group and whether a demonstration exists — nothing else. The full
 * rows carry instructions for 871 exercises and come to roughly a megabyte;
 * pulling that to draw a scrollable list of names would spend it on text no
 * one is reading yet. The detail screen fetches the one row it needs.
 *
 * `hasDemo` is computed here rather than on the screen so the list can say
 * which entries are illustrated WITHOUT reading image_paths into every row —
 * `image_paths is not null` is a cheap thing for Postgres to answer and an
 * expensive thing to ship.
 */
export function useExerciseCatalogue() {
  const [rows, setRows] = useState<CatalogueRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, muscle_group, image_paths')
        .order('name', { ascending: true })
        .limit(capLimit());
      if (error) { reportError('exerciseCatalogue.read', error); setStatus('error'); return; }
      const page = capped(data);
      setRows(page.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        group: r.muscle_group ?? null,
        hasDemo: Array.isArray(r.image_paths) && r.image_paths.length > 0,
      })));
      // 'partial' rather than 'ready': the catalogue is 917 rows against a cap
      // of 1000, so this is quiet today and will not be forever. A list that
      // silently stops at the cap is how a client concludes we have never heard
      // of an exercise that is sitting just past row 1000.
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('exerciseCatalogue.read', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { rows, status, reload: load };
}
