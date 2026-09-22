// ── The one place that asks the phone which way it reads ─────────────────────
//
// src/lib/direction.ts holds the decisions and is pure: every function there
// takes `rtl` as an argument so it can be tested without a device. This file
// is the other half — it reads `I18nManager.isRTL` ONCE and exports the answers
// already resolved, so that no screen in the app contains the words
// `I18nManager` and no screen contains a branch on direction.
//
// The values are module constants rather than a hook, and that is a claim
// worth stating: `I18nManager.isRTL` cannot change while the app is running.
// Switching a React Native app between LTR and RTL requires a native relaunch —
// I18nManager.forceRTL and I18nManager.allowRTL both say so in their own docs,
// and the OS applies a language change by restarting the process. So there is
// nothing to subscribe to, nothing to re-render, and a hook here would be a
// hook that never fires while implying it might.
//
// ── what this does NOT do ─────────────────────────────────────────────────
//
// It does not turn RTL on. Nothing in this repo calls `I18nManager.forceRTL`,
// and it should not: the flag belongs to the OS and the reader, and forcing it
// would put an English-only build into a mirrored layout for no one's benefit.
// `isRTL` is true when the handset is set to an RTL language AND the binary
// declares support for it — which today it does not, because the app ships no
// translated catalogue. So on every build that exists right now this file
// resolves to the LTR answers and every conversion in the sweep that added it
// is a no-op. That is the intended state: the layout is correct in advance of
// the translations, rather than being a second project that starts after them.
import { I18nManager } from 'react-native';

import {
  START_ALIGN, backArrow, backChar, backIcon, endAlign, forwardArrow, forwardChar,
  forwardIcon, mirrorTurn, type Chevron,
} from '../lib/direction';

/** Is the reader reading right-to-left? Fixed for the life of the process. */
export const isRTL: boolean = I18nManager.isRTL;

/** The chevron a "drill into this" affordance draws. */
export const FORWARD_ICON: Chevron = forwardIcon(isRTL);

/** The chevron a "go back" affordance draws. */
export const BACK_ICON: Chevron = backIcon(isRTL);

/** Forward, as the character some rows draw instead of an Icon. */
export const FORWARD_CHAR: string = forwardChar(isRTL);

/** Back, as a character. */
export const BACK_CHAR: string = backChar(isRTL);

/** Forward, as a full arrow — "this becomes that", not "more over here". */
export const FORWARD_ARROW: string = forwardArrow(isRTL);

/** Back, as an arrow. */
export const BACK_ARROW: string = backArrow(isRTL);

/** `textAlign` for a value pinned to the trailing edge of its row. */
export const END_ALIGN: 'left' | 'right' = endAlign(isRTL);

/** `textAlign` for text pinned to the leading edge — 'auto', in every locale. */
export const START_ALIGN_TEXT = START_ALIGN;

/**
 * The rotation a disclosure chevron should carry, given the angle that is
 * right in English. See mirrorTurn in src/lib/direction.ts for why the sign
 * has to flip rather than the angle being shared.
 */
export function turn(degrees: number): string {
  return mirrorTurn(isRTL, degrees);
}
