// A horizontal chip strip that shows which chip is selected.
//
// Every one of these in the app is a `<ScrollView horizontal>` over a row of
// `<Chip on={…}>`, and a ScrollView always starts at its left end. With 24
// hours in the strip and 9am selected, the reader gets a row of grey chips and
// no selection anywhere on it. app/(trainer)/calendar.tsx wrote that down at
// its availability sheet and answered it by printing the value in the heading
// — "From · 7:00am" — which says what is selected and still leaves the control
// looking like nothing is.
//
// This moves the strip instead. The arithmetic is src/lib/revealOffset.ts,
// where it can be tested; this is the measuring and the wiring, which cannot.
//
// ── using it ──────────────────────────────────────────────────────────────
//
//   const hour = useRevealSelected(avFrom);
//   <ScrollView horizontal ref={hour.ref} onLayout={hour.onLayout}
//     onScroll={hour.onScroll} scrollEventThrottle={64} …>
//     {HOURS.map((h) => <Chip key={h} {...hour.chip(h)} on={avFrom === h} … />)}
//   </ScrollView>
//
// `chip(key)` returns an `onLayout`, so it spreads onto a Chip that already
// takes one. The key must be the same value the strip is selected BY — pass
// the hour, not the label — because that is what the hook matches on.
import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { revealOffset, type Span } from '../lib/revealOffset';

export interface RevealedStrip<K> {
  ref: (v: ScrollView | null) => void;
  onLayout: (e: LayoutChangeEvent) => void;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  chip: (key: K) => { onLayout: (e: LayoutChangeEvent) => void };
}

export function useRevealSelected<K extends string | number>(selected: K | null | undefined): RevealedStrip<K> {
  const view = useRef<ScrollView | null>(null);
  const spans = useRef(new Map<string, Span>());
  const width = useRef(0);
  const at = useRef(0);
  // The selection as of the last render, read inside callbacks that were
  // created before it changed. A ref and not the closure: `chip(key)` is called
  // during render for every chip, and capturing `selected` in each of those
  // closures is a new function per chip per render for a value one ref holds.
  const want = useRef<K | null | undefined>(selected);
  want.current = selected;

  const reveal = useCallback(() => {
    const k = want.current;
    const to = revealOffset(k == null ? null : spans.current.get(String(k)), width.current, at.current);
    // scrollTo and not scrollToEnd: the offset is already clamped, and
    // `animated: false` because this runs on mount and on measurement, where
    // an animation is a strip that visibly slides for no reason the reader
    // asked for. A tap on a visible chip returns null above and moves nothing.
    if (to != null) view.current?.scrollTo({ x: to, animated: false });
  }, []);

  // On mount and whenever the selection changes. Measurements may not have
  // landed yet on the first pass, which is why `chip` and `onLayout` call it
  // again as they arrive — the first one that completes the picture wins and
  // the rest return null.
  useEffect(reveal, [reveal, selected]);

  return {
    ref: (v) => { view.current = v; },
    onLayout: (e) => { width.current = e.nativeEvent.layout.width; reveal(); },
    onScroll: (e) => { at.current = e.nativeEvent.contentOffset.x; },
    chip: (key: K) => ({
      onLayout: (e: LayoutChangeEvent) => {
        const { x, width: w } = e.nativeEvent.layout;
        const id = String(key);
        const had = spans.current.get(id);
        if (had && had.x === x && had.w === w) return;
        spans.current.set(id, { x, w });
        reveal();
      },
    }),
  };
}
