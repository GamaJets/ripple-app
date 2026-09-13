// A section that is closed until somebody asks for it, with its subject still
// readable while it is shut.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The coach app's tab bar is six items and the rest of app/(trainer) is detail
// screens registered `href: null`; adding a route means editing
// app/(trainer)/_layout.tsx, whose own header records what a seventh bar item
// cost the last time one was added without thinking. So the coach's own tools,
// records, trends, consistency and recovery all land on ONE screen — and a
// screen a coach opens mid-session to log a lift must not have become a
// five-thousand-pixel scroll before the box they came for.
//
// ── Why it is not just a hidden section ────────────────────────────────────
//
// A closed section whose heading is the only thing left is a mystery box, and
// the usual outcome is that nobody opens it. `note` is drawn while it is SHUT —
// one line saying what is inside, or the single figure that makes it worth
// opening — so the shut state still answers something.
//
// ── What a screen reader is told ───────────────────────────────────────────
//
// The header is one `Pressable`, so React Native merges its children into a
// single element and an `accessibilityLabel` on it REPLACES what they say
// rather than adding to it (see the Rule 3 note in scripts/check-a11y.mjs). The
// label is therefore assembled as a sentence — title, then the note — and the
// open/shut state travels in `accessibilityState.expanded` rather than in the
// chevron, which says nothing at all to a reader who cannot see it.
import { useState, type ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Section, SectionHead } from './kit';
import { sp, type as ty } from '../theme/scale';
import { MIN_TARGET } from '../lib/a11y';

export function Disclosure({ title, note, children, startOpen = false }: {
  title: string;
  /** One line, readable while the section is shut. Sentence case: it is prose
   *  under a heading, not a second heading. */
  note?: string;
  children: ReactNode;
  /** Open on first render. For the one section on a screen that is the reason
   *  most people opened it. */
  startOpen?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(startOpen);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={note ? `${title}. ${note}` : title}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: MIN_TARGET }}>
        <View style={{ flex: 1 }}>
          <SectionHead title={title} />
        </View>
        {/* Plus and minus rather than a chevron, and not for taste: a chevron
            points somewhere, and a pointing glyph has to be flipped in a
            right-to-left locale or it argues with the layout Yoga has already
            mirrored (see src/ui/direction.ts). These two mean the same thing in
            both directions. It is decoration either way — the state it draws is
            already in `accessibilityState` on the row, and `Icon` hides itself
            from the accessibility tree. */}
        <Icon name={open ? 'minus' : 'plus'} size={16} color={t.ink3} />
      </Pressable>
      {/* The note stays while the section is shut and goes when it opens — once
          the contents are on screen, a one-line summary of them above is a
          second answer to a question already answered underneath. */}
      {!open && note ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{note}</Text>
      ) : null}
      {open ? <Section style={{ paddingTop: 0 }}>{children}</Section> : null}
    </View>
  );
}
