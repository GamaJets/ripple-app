import { sparkY } from './sparkScale';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (a !== b) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

/* ── the two pictures that used to be one ────────────────────────────────
   The client profile's Days Trained band: top 3, bottom 27. Eight weeks of
   nothing, and eight weeks of five-a-week, both drew a flat line on the floor
   because `(v - min) / ((max - min) || 1)` is 0 either way. */
{
  const never = sparkY(0, 0, 0, 3, 27);
  const always = sparkY(5, 5, 5, 3, 27);
  eq(never, 15, 'eight weeks of nothing is drawn down the middle, not on the floor');
  eq(always, 15, 'and eight weeks of five-a-week is drawn down the middle too');
  ok(never !== 27 && always !== 27, 'neither is pinned to the bottom of the band');
}

/* ── a series that does move is unchanged ───────────────────────────────── */
{
  eq(sparkY(0, 0, 10, 3, 27), 27, 'the lowest reading sits on the floor of the band');
  eq(sparkY(10, 0, 10, 3, 27), 3, 'the highest sits on its ceiling');
  eq(sparkY(5, 0, 10, 3, 27), 15, 'and the middle in the middle');
  // Larger values must sit HIGHER, which in SVG means a SMALLER y. Getting this
  // backwards draws every trend upside down and still passes a "did it move"
  // test, so it is asserted in its own right.
  ok(sparkY(9, 0, 10, 3, 27) < sparkY(1, 0, 10, 3, 27), 'a bigger reading is drawn higher up');
}

/* ── the kit's Spark band, which runs the other way round ────────────────
   top 8, bottom h-18. Same helper, different numbers; the midpoint has to
   follow the band it was given rather than any fixed drawing height. */
{
  eq(sparkY(4, 4, 4, 8, 82), 45, 'a flat series centres in whatever band it is handed');
  eq(sparkY(1, 1, 3, 8, 82), 82, 'and a moving one still reaches the floor of that band');
}

/* ── nothing to scale ─────────────────────────────────────────────────────
   `Math.min()` of an empty list is Infinity and `Math.max()` is -Infinity, so
   an empty series arrives here as two infinities. A NaN y is an SVG path the
   renderer drops silently, which is a chart that is simply missing. */
{
  eq(sparkY(0, Infinity, -Infinity, 3, 27), 15, 'an empty series does not produce NaN');
  eq(sparkY(NaN, 0, 10, 3, 27), 15, 'nor does an unreadable value');
  ok(Number.isFinite(sparkY(5, 0, 0, 3, 27)), 'and a degenerate range is always finite');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sparkScale: ok');
