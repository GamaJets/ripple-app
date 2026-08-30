// Owner · Exercise library — what the platform can teach, and what kit it assumes.
//
// The owner app had no exercise surface at all. An owner evaluating Repple, or
// answering a member who asks whether the app covers something, had no way to
// look: the catalogue existed and only the client and the coach could see it.
//
// ── Why this is not the client's library with a different header ───────────
//
// A client searches this list to find a movement they are about to do. An owner
// searches it to answer two different questions — "can this app teach my
// members X" and "does it assume kit we do not own" — and the second one is
// invisible on the client's screen, where equipment is one chip on the detail
// page two taps away.
//
// So equipment leads every row and is its own filter. Picking "cable" and
// reading the count is how an owner with no cable stack finds out how much of
// the catalogue does not apply to their floor, which is a purchasing question
// and the reason they are on this screen.
//
// ── What must not happen here ──────────────────────────────────────────────
//
// The catalogue is hundreds of movements. A failed read leaves the list empty
// exactly like a genuinely empty catalogue would, and "no exercises" told to a
// gym owner deciding whether to buy the platform is a lie about the product,
// not a cosmetic glitch. `status` keeps loading / unreadable / capped / really
// empty apart, and the counts are gated on 'ready' because a count over a
// truncated read is a wrong number stated confidently.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBackFromHub } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Notice, Ghost, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { catalogueValue as cap } from '../../src/lib/format';


/** The equipment chip standing for rows where the catalogue records none.
 *
 *  Not "Bodyweight". A null equipment column means nobody wrote down what this
 *  movement is performed on — which is a gap in our data, and filing it under
 *  bodyweight would be inventing a fact about 88 exercises. It gets a chip of
 *  its own so those rows are still reachable rather than falling out of every
 *  filter and off the screen. */
const UNRECORDED = 'Not recorded';

const ALL = 'All';

/** Distinct values in the spelling the catalogue uses, matched case-insensitively.
 *  `muscle_group` and `equipment` are both free text on the row, so 'Barbell'
 *  and 'barbell' are the same kit and must not become two chips. */
function distinct(values: (string | null)[], includeUnrecorded: boolean): string[] {
  const seen = new Map<string, string>();
  let anyMissing = false;
  for (const raw of values) {
    const v = (raw || '').trim();
    if (!v) { anyMissing = true; continue; }
    if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), cap(v));
  }
  const list = [...seen.values()].sort((a, b) => a.localeCompare(b));
  return [ALL, ...list, ...(includeUnrecorded && anyMissing ? [UNRECORDED] : [])];
}

const matches = (field: string | null, chip: string) => {
  if (chip === ALL) return true;
  const v = (field || '').trim();
  if (chip === UNRECORDED) return v === '';
  return v.toLowerCase() === chip.toLowerCase();
};

function Chips({ options, value, onChange, a11y }: {
  options: string[]; value: string; onChange: (v: string) => void; a11y: (v: string) => string;
}) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}>
      {options.map((o) => {
        const on = value.toLowerCase() === o.toLowerCase();
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button"
            accessibilityLabel={a11y(o)} accessibilityState={{ selected: on }}
            style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
            <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{o}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const PAGE = 50;

export default function OwnerLibrary() {
  const t = useTheme();
  const router = useRouter();
  const goBack = useBackFromHub('(owner)');
  const { rows, status, reload } = useExerciseCatalogue();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(ALL);
  const [kit, setKit] = useState(ALL);
  // Rendered in pages. Hundreds of <ListRow>s mounted at once is a visibly
  // janky scroll on an older phone, and nobody reads past the first screenful.
  const [shown, setShown] = useState(PAGE);

  const groups = useMemo(() => distinct(rows.map((r) => r.group), false), [rows]);
  const kits = useMemo(() => distinct(rows.map((r) => r.equipment), true), [rows]);

  // A derived chip can vanish underneath the selection — a reload that comes
  // back without the row the chip was made from. Left alone the screen would
  // show an empty list under a chip it is no longer drawing.
  useEffect(() => {
    if (!groups.some((g) => g.toLowerCase() === group.toLowerCase())) setGroup(ALL);
  }, [groups, group]);
  useEffect(() => {
    if (!kits.some((k) => k.toLowerCase() === kit.toLowerCase())) setKit(ALL);
  }, [kits, kit]);

  const term = q.trim().toLowerCase();
  const list = useMemo(
    () => rows.filter((r: CatalogueRow) =>
      matches(r.group, group) && matches(r.equipment, kit) &&
      (term === '' || r.name.toLowerCase().includes(term))),
    [rows, group, kit, term],
  );
  useEffect(() => { setShown(PAGE); }, [term, group, kit]);

  const filtering = term !== '' || group !== ALL || kit !== ALL;
  // Every figure on this screen is a count over the rows we hold. Under
  // 'partial' those rows are a prefix of the catalogue, so the counts would be
  // subtotals printed as totals — the exact thing src/lib/rowCap.ts exists to
  // stop. A dash is the honest answer, and PartialRead below says why.
  const countable = status === 'ready';
  // 'illustrated' is what the owner is being sold: a movement with artwork can
  // be shown to a member, one without is a name and some text.
  const illustrated = rows.filter((r) => r.hasDemo).length;
  // Kit the catalogue names, not counting the "Not recorded" pseudo-chip or All.
  const kitKinds = kits.filter((k) => k !== ALL && k !== UNRECORDED).length;

  // Equipment first, because that is the question this screen is open to answer.
  // A row with no equipment recorded says so rather than being left blank, which
  // would read as bodyweight.
  const rowNote = (r: CatalogueRow) => [
    r.equipment ? cap(r.equipment) : 'Equipment not recorded',
    r.group,
    r.hasDemo ? 'illustrated' : null,
  ].filter(Boolean).join(' · ');

  const emptyLine = () => {
    if (!filtering) return 'The catalogue is empty.';
    const bits: string[] = [];
    if (term) bits.push(`“${q.trim()}”`);
    if (group !== ALL) bits.push(group);
    if (kit !== ALL) bits.push(kit === UNRECORDED ? 'no recorded equipment' : kit);
    return `No movement matches ${bits.join(' · ')}.`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={goBack} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What the platform can teach your members</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Exercise Library</Text>
          </View>
        </View>

        <View style={{ marginTop: sp.lg }}>
          <Hero
            label="Movements in the Catalogue"
            figure={countable ? String(rows.length) : '—'}
            note={
              status === 'loading' ? 'Reading the catalogue…'
              : status === 'error' ? 'The catalogue could not be read, so this is unknown — not zero.'
              : status === 'partial' ? 'More movements than fit in one read. The figure would be a subtotal, so it is not shown.'
              : rows.length === 0 ? 'The catalogue came back empty.'
              : 'Every one is available to your members and to your coaches, at no extra cost.'
            }
          />
        </View>

        <Rule />

        <Section>
          <SectionHead title="What it assumes you own" />
          <KpiRow items={[
            { label: 'Kinds of Kit', value: countable ? String(kitKinds) : '—' },
            { label: 'Illustrated', value: countable ? String(illustrated) : '—' },
            { label: 'Text Only', value: countable ? String(rows.length - illustrated) : '—' },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {countable
              ? 'Filter by equipment below to see how much of the catalogue your floor can actually support. Your register is on the Equipment screen.'
              : 'These stay blank until the whole catalogue has been read, rather than reporting a figure computed from part of it.'}
          </Text>
        </Section>

        <Rule />

        {/* ── finding one ────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={t.ink3}
            accessibilityLabel="Search exercises"
            style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>MUSCLE GROUP</Text>
        <Chips options={groups} value={group} onChange={setGroup}
          a11y={(g) => (g === ALL ? 'Show every muscle group' : `Show ${g} only`)} />

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>EQUIPMENT</Text>
        <Chips options={kits} value={kit} onChange={setKit}
          a11y={(k) => (k === ALL ? 'Show every kind of equipment'
            : k === UNRECORDED ? 'Show movements whose equipment the catalogue does not record'
            : `Show ${k} exercises only`)} />

        <Section>
          <SectionHead
            title={kit === ALL ? (group === ALL ? 'All Exercises' : group) : `${kit}${group === ALL ? '' : ` · ${group}`}`}
            // Only when the read is whole. A "412 exercises" over a capped read
            // is the subtotal-as-total mistake in the one place an owner would
            // read it as a fact about the product.
            note={countable ? `${list.length} of ${rows.length}` : undefined}
          />

          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.lg }}>Reading the exercise catalogue…</Text>
          ) : status === 'error' ? (
            // Not "no exercises". The catalogue is there; we could not read it,
            // and an owner sizing up the platform must not be shown an empty
            // list as though that were the product.
            <Notice tone={t.warn} kicker="Catalogue" title="The exercise list could not be read"
              note="This is our end, not yours — the movements are still there. Nothing below this line is a statement about what the platform covers.">
              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Try Again" onPress={() => { reload(); }} />
              </View>
            </Notice>
          ) : (
            <>
              {status === 'partial' ? <PartialRead what="exercises" shown={rows.length} onPress={reload} /> : null}
              {list.length === 0 ? (
                <View style={{ paddingVertical: sp.lg }}>
                  <Text style={{ ...ty.label, color: t.ink3 }}>{emptyLine()}</Text>
                  {filtering ? (
                    <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                      <Ghost label="Clear Filters" onPress={() => { setQ(''); setGroup(ALL); setKit(ALL); }} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <>
                  {list.slice(0, shown).map((r, i) => (
                    <View key={r.id}>
                      {i > 0 ? <Rule /> : null}
                      <ListRow
                        icon={r.hasDemo ? 'play' : 'dumbbell'}
                        title={r.name}
                        note={rowNote(r)}
                        onPress={() => router.push({ pathname: '/(owner)/exercise', params: { name: r.name, from: 'ownerLibrary' } })}
                      />
                    </View>
                  ))}
                  {list.length > shown ? (
                    <View style={{ marginTop: sp.md }}>
                      {/* A count, not a bare "Show more". The number is the
                          point: it says how much is still below. */}
                      <Ghost label={`Show ${Math.min(PAGE, list.length - shown)} more of ${list.length - shown}`}
                        onPress={() => setShown((n) => n + PAGE)} />
                    </View>
                  ) : null}
                </>
              )}
            </>
          )}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
