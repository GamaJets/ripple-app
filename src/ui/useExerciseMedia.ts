// Resolving a catalogue row's pictures, once, for all three apps.
//
// Three screens show the same movement — the client's, the coach's and the
// owner's — and each one used to work out its own URLs. That is the shape that
// already went wrong here: a capitalisation helper existed four times and three
// copies stayed on the old behaviour after the fourth was fixed, so the client
// app and the coach app disagreed about the name of a muscle.
//
// Media is worse than a label to get wrong, because the failure is silent: one
// screen shows the movement and another shows an empty box, and nothing errors.
//
// ── Two sources, and only one of them is a URL ─────────────────────────────
//
// A path in OUR bucket is private and has to be signed, asynchronously. A path
// still on a vendor CDN is a URL as soon as you prepend the base. This hook is
// where that distinction is decided, so no screen has to know about it.
import { useEffect, useMemo, useState } from 'react';
import { frameUrls, demoIsShippable, evalAnimationUrl } from '../lib/exerciseMedia';
import { signMedia, needsSigning } from './signedMedia';
import type { ExerciseDetail } from './exerciseDetail';

export interface ExerciseMedia {
  /** Stills in play order — start then peak. Reversed, the cross-fade runs the
   *  movement backwards. */
  frames: string[];
  /** The looping animation, or null when there is none for this movement or
   *  the licence does not permit showing it in this build. */
  animUrl: string | null;
}

export function useExerciseMedia(detail: ExerciseDetail | null): ExerciseMedia {
  // Gated on the licence recorded against the row, never on anything a screen
  // knows: an evaluation asset renders while a pack is being judged and never
  // in a build that reaches a real person.
  const mayShow = demoIsShippable(detail?.demoLicence, !__DEV__);

  const vendorFrames = useMemo(
    () => frameUrls(detail?.imagePaths, detail?.source),
    [detail?.imagePaths, detail?.source],
  );

  const ourPaths = useMemo(
    () => (detail?.imagePaths ?? []).filter(needsSigning),
    [detail?.imagePaths],
  );
  const [ourFrames, setOurFrames] = useState<string[]>([]);
  const [animUrl, setAnimUrl] = useState<string | null>(null);

  const pathsKey = ourPaths.join('|');
  const animPath = detail?.animationPath ?? null;

  useEffect(() => {
    let cancelled = false;
    // One request for the stills AND the animation. A cross-fade cannot start
    // until both frames are in, and separate round trips are separate chances
    // to be looking at half a movement.
    const evalUrl = evalAnimationUrl(animPath, detail?.demoLicence);
    const wanted = [
      ...ourPaths,
      ...(animPath && mayShow && !evalUrl && needsSigning(animPath) ? [animPath] : []),
    ];
    if (!wanted.length) {
      setOurFrames([]);
      setAnimUrl(mayShow ? evalUrl : null);
      return;
    }
    (async () => {
      const signed = await signMedia(wanted);
      if (cancelled) return;
      setOurFrames(ourPaths.map((p) => signed.get(p)).filter((u): u is string => !!u));
      setAnimUrl(mayShow ? (evalUrl ?? (animPath ? signed.get(animPath) ?? null : null)) : null);
    })();
    return () => { cancelled = true; };
  }, [pathsKey, animPath, mayShow, detail?.demoLicence]);

  return {
    // Ours when we have them; the vendor CDN is the fallback while a few rows
    // are still served from it.
    frames: ourFrames.length ? ourFrames : vendorFrames,
    animUrl,
  };
}
