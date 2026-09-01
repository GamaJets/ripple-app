# Repple design system

Two files. `src/theme/scale.ts` is everything underneath colour; `src/ui/kit.tsx`
is the primitives. Colour stays in `src/theme/tokens.ts` (10 palettes + the
owner's white-label accent) and is untouched by this system.

## Why

Measured before the migration started:

| | |
|---|---|
| inline `style={{…}}` objects | 3,814 |
| distinct `borderRadius` values | 25+ |
| distinct `fontSize` values | 25+ (incl. 8.5, 11.5, 12.5, 13.5) |
| `fontWeight` 700 or 800 | 1,139 of 1,230 |
| `fontWeight` 500 | 1 |
| shadows / elevation | 0 |

Nobody consciously notices 14px vs 15px padding; everybody feels the result.
And with 93% of text bold there was no hierarchy left to give.

## House rules

1. **Three weights only** — 400 body, 500 emphasis, 600 values and titles.
   Never 700/800/900.
2. **No raw `fontSize`.** Use `type.*` or `value(n)` from the scale.
3. **Exactly one `<Hero>` per screen.** A second hero means neither is one.
4. **Cards are spent, not sprinkled.** A `<Card>` is for something actionable or
   something that must group. Everything else is a `<Section>` separated by a
   `<Rule>`. If a screen has more than two or three cards, it's boxing habit.
5. **Borders divide; elevation groups.** Don't use a border to fake depth.
6. **Accent is for the live metric and the primary action.** Nothing else.
7. **Status colours are reserved** (warn/crit) and never used as *text* colour —
   put a coloured dot beside ink-coloured text instead.
8. **Numbers get tabular figures** so digits don't jitter as values tick.
9. **Empty states are honest.** "No X yet" beats a zero pretending to be data.
10. **Interrupt to ask, never to tell.** A modal is what a QUESTION looks like.
    "Saved", "Logged", "Removed" and "Sent" are statements and belong in the
    bar at the bottom — `useToast().say()`. A destructive action does not get a
    confirmation dialog either: it happens, and `useToast().remove()` holds the
    write for six seconds behind an Undo. See `src/ui/toast.tsx`.
11. **Nothing is written in our locale.** No `'en-GB'` anywhere. Dates, times
    and figures go through `src/lib/format.ts`, which asks
    `src/lib/locale.ts` for the reader's own tag. `npm run check:locale` fails
    the build on a literal. This is a white-label product: there is no default
    locale and no default currency.
12. **Line heights grow with the reader's text.** React Native scales
    `fontSize` on its own and does NOT scale `lineHeight`, so any pinned point
    measurement that has to track the text goes through `grown()` from the
    scale. Never multiply a `fontSize` — see `src/lib/typeScale.ts`.

## The scale — `src/theme/scale.ts`

```ts
sp        xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · huge 48
layout    gutter 22 · section 24
radius    sm 10 · md 16 · pill 999
hairline  StyleSheet.hairlineWidth
elevation e1 (resting card) · e2 (sheet, modal)
type      hero 44/600 · title 26/600 · head 17/600 · body 15/400
          label 13/400 · caption 12/400 · micro 11/500 uppercase
numeric   tabular figures
value(n)  a metric at an arbitrary size (600 + tabular)
fontScale the phone's own text size, clamped. Read once, at module load.
grown(pt) a pinned point measurement at that size — a line height, a strip
          that holds one line, a ring with a figure inside it. NEVER a
          fontSize: React Native is already scaling those, and doing it here
          as well squares the multiplier.
```

Every `lineHeight` in `type` is already `grown()`. A screen that pins its own
box height around one line of text has to do the same, or that text clips for
anybody on Larger Text — which is most of the people who turned it on.

## The kit — `src/ui/kit.tsx`

| Primitive | Use for |
|---|---|
| `<Rule/>` | the divider between sections |
| `<Section>` | vertical rhythm; pairs with `<Rule/>` |
| `<SectionHead title note onPress/>` | quiet uppercase title + trailing note |
| `<Hero label figure unit note arc tone onPress/>` | the one big number |
| `<KpiRow items/>` | metrics as hairline-divided columns |
| `<Card onPress tone/>` | a surface that groups (elevation, not border) |
| `<ActionCard ring ringLabel title note cta onPress/>` | the primary action |
| `<ListRow icon title note onPress/>` | one line of a navigational list |
| `<Cta label onPress tone wide/>` | primary button |
| `<Ghost label icon onPress/>` | low-emphasis button; icon-only = round |
| `<QuickRow items/>` | a row of icon shortcuts |
| `<Meter label val target unit dim/>` | a 3px progress meter |
| `<Spark data/>` | single-series trend, 2px, ringed end dot |
| `<WeekDots done/>` | seven day cells |
| `<Notice tone kicker title note>` | something needing a decision |
| `<Flag tone>` | one line of trouble, inline: a 6pt dot beside ink text |
| `<PartialRead what shown onPress/>` | the banner for a truncated read |

## Saying things — `src/ui/toast.tsx`

```ts
const toast = useToast();

toast.say('Measurements logged.');          // a statement. 3.2s, no tap.

toast.remove({                               // a delete that can be taken back
  id: entry.id,                              // hide the row yourself, now
  text: `${entry.name} removed.`,
  onUndo: putBack,                           // window still open: cannot fail
  onCommit: async () => { ... },             // the real write, 6s later
});
```

`remove()` HOLDS the write rather than reversing it, because a re-insert is a
second write that can be refused and an Undo that sometimes cannot undo is
worse than none. `ToastProvider` flushes anything pending when a second action
is staged and when it unmounts, so a staged delete has exactly two ends: it is
written, or it is undone. `src/lib/undoable.ts` is the arithmetic and is
tested.

A failure still interrupts. "Not removed — it is still counting toward today"
changes what the person believes about their own data and has to be read.

## Screen skeleton

```tsx
<SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
  <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}>
    <View style={{ paddingTop: sp.md }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>CONTEXT</Text>
      <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Screen name</Text>
    </View>

    {/* interrupts (Notice) go here, above the hero */}

    <Hero … />
    <Rule />
    <Section><SectionHead title="…" note="…" onPress={…} /> … </Section>
    <Rule />
    …
  </ScrollView>
</SafeAreaView>
```

## Migration contract

A migration is a **re-skin, not a rewrite**. Non-negotiable:

- Every `router.push` target preserved, exactly.
- Every provider hook still called, in the same order (hooks are order-sensitive).
- Every conditional branch preserved — including the ones that rarely render.
- No new fabricated data. Ever. If a screen shows something invented, delete it
  and leave an honest empty state; never invent a replacement.
- `npx tsc --noEmit -p tsconfig.json` clean before it's done.

Verify a migrated screen with:

```sh
# routes must be identical before and after
grep -ohE "/\((client|trainer|owner)\)/[a-z-]+" OLD | sort -u > /tmp/a
grep -ohE "/\((client|trainer|owner)\)/[a-z-]+" NEW | sort -u > /tmp/b
comm -23 /tmp/a /tmp/b     # must be empty
```
