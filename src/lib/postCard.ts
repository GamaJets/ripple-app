// One card format for everything the three apps let somebody post: a member's
// workout, PR, badge or progress; a coach's offer, open hours or join code; a
// gym's classes, promo code, milestones or event.
//
// Pure. Every builder takes figures the caller has already READ and formatted
// (unit, locale, currency are the caller's), and returns a card or the reason
// there isn't one. The rule is src/lib/shareAsset.ts's rule 1: a figure that was
// not read is never published as zero, so an empty input refuses instead of
// printing "0 sets" to somebody's followers. src/ui/SharePost.tsx draws the
// card and hands the PNG to the share sheet.
//
// A client's own figures never appear on a coach or gym card here: the coach's
// client-win card lives in app/(trainer)/share-kit.tsx behind its consent gate.

export interface PostCard {
  /** Small line at the top, drawn in capitals. */
  kicker: string;
  headline: string;
  /** The one figure the card is about, when there is one. */
  big: { value: string; unit: string } | null;
  /** Supporting lines, at most six, already worded. */
  lines: string[];
  /** The gym's or app's name, bottom left. Never "Repple" on a white-label build. */
  footer: string;
  /** Goes on the clipboard, for the post's text. */
  caption: string;
  filename: string;
  /** A link drawn as a QR code, bottom right. */
  qr: string | null;
}

export type PostBuild = { ok: true; card: PostCard } | { ok: false; why: string };

export const MAX_LINES = 6;

const clean = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function slug(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'card';
}

function post(p: Omit<PostCard, 'lines' | 'qr' | 'big'> & { lines?: (string | null | undefined)[]; qr?: string | null; big?: PostCard['big'] }): PostBuild {
  const lines = (p.lines ?? []).map(clean).filter(Boolean).slice(0, MAX_LINES);
  return {
    ok: true,
    card: {
      kicker: clean(p.kicker), headline: clean(p.headline), big: p.big ?? null, lines,
      footer: clean(p.footer), caption: clean(p.caption), filename: `${slug(p.filename)}.png`, qr: clean(p.qr) || null,
    },
  };
}

const no = (why: string): PostBuild => ({ ok: false, why });

/* ── member ─────────────────────────────────────────────────────────────── */

export function workoutPost(i: { focus: string; sets: number; minutes: number | null; volume: string | null; prs: string[]; brand: string }): PostBuild {
  if (!(i.sets > 0)) return no('No sets were logged, so there is no workout to share.');
  const focus = clean(i.focus) || 'Workout';
  return post({
    kicker: 'Workout Complete',
    headline: `${focus} Done.`,
    big: { value: String(i.sets), unit: i.sets === 1 ? 'Set' : 'Sets' },
    lines: [
      i.minutes != null && i.minutes > 0 ? `${i.minutes} Minutes` : null,
      // numbers-ok: volume arrives already formatted by the caller, in the member's locale and unit.
      i.volume ? `Volume ${i.volume}` : null,
      ...i.prs.slice(0, 3).map((p) => `New Best · ${p}`),
    ],
    footer: i.brand,
    caption: `${focus} done: ${i.sets} ${i.sets === 1 ? 'set' : 'sets'}${i.prs.length ? `, ${i.prs.length} new ${i.prs.length === 1 ? 'best' : 'bests'}` : ''}. Training with ${clean(i.brand)}.`,
    filename: `${focus}-workout`,
  });
}

export function badgePost(i: { name: string; meaning: string; brand: string }): PostBuild {
  if (!clean(i.name)) return no('This badge has not been earned yet.');
  return post({
    kicker: 'Badge Earned',
    headline: clean(i.name),
    lines: [i.meaning],
    footer: i.brand,
    caption: `Earned the ${clean(i.name)} badge. Training with ${clean(i.brand)}.`,
    filename: `${i.name}-badge`,
  });
}

/** `change` arrives signed and in the member's unit, e.g. "−3.4 kg". */
export function progressPost(i: { what: string; change: string | null; since: string; lines?: string[]; brand: string }): PostBuild {
  if (!clean(i.change)) return no('There are not two readings to compare yet.');
  const [value, ...unit] = clean(i.change).split(' ');
  return post({
    kicker: 'My Progress',
    headline: clean(i.what),
    big: { value, unit: unit.join(' ') },
    lines: [clean(i.since), ...(i.lines ?? [])],
    footer: i.brand,
    caption: `${clean(i.what)}: ${clean(i.change)} ${clean(i.since).toLowerCase()}. Training with ${clean(i.brand)}.`,
    filename: `${i.what}-progress`,
  });
}

export function scanPost(i: { improving: string[]; date: string; brand: string }): PostBuild {
  const n = i.improving.length;
  if (!n) return no('Nothing has improved since the last scan yet, so there is nothing to post.');
  return post({
    kicker: `Body Scan · ${clean(i.date)}`,
    headline: 'Moving the Right Way',
    big: { value: String(n), unit: 'Improving' },
    lines: i.improving.slice(0, 5),
    footer: i.brand,
    caption: `${n} ${n === 1 ? 'measure' : 'measures'} improving on my latest body scan. Training with ${clean(i.brand)}.`,
    filename: 'body-scan',
  });
}

/* ── coach ──────────────────────────────────────────────────────────────── */

export function offerPost(i: { name: string; price: string; detail: string | null; brand: string; link: string | null }): PostBuild {
  if (!clean(i.name) || !clean(i.price)) return no('Pick a package to post.');
  return post({
    kicker: 'Now Taking Clients',
    headline: clean(i.name),
    big: { value: clean(i.price), unit: '' },
    lines: [i.detail, i.link ? 'Scan to Join' : null],
    footer: i.brand,
    caption: `${clean(i.name)}, ${clean(i.price)}.${i.link ? ` Join here: ${clean(i.link)}` : ''}`,
    filename: `${i.name}-offer`,
    qr: i.link,
  });
}

export function spotsPost(i: { times: string[]; brand: string; link: string | null }): PostBuild {
  const times = i.times.map(clean).filter(Boolean);
  if (!times.length) return no('Pick at least one open time to post.');
  return post({
    kicker: 'Open Spots This Week',
    headline: times.length === 1 ? 'One Spot Open' : `${times.length} Spots Open`,
    lines: times,
    footer: i.brand,
    caption: `Spots open this week: ${times.join(', ')}.${i.link ? ` Book here: ${clean(i.link)}` : ''}`,
    filename: 'open-spots',
    qr: i.link,
  });
}

export function joinPost(i: { code: string; link: string; brand: string }): PostBuild {
  if (!clean(i.code) || !clean(i.link)) return no('Your code could not be read, so there is nothing to post yet.');
  return post({
    kicker: 'Train With Me',
    headline: 'Scan to Join',
    big: { value: clean(i.code), unit: '' },
    lines: ['Or enter the code in the app'],
    footer: i.brand,
    caption: `Train with me. Join with code ${clean(i.code)}: ${clean(i.link)}`,
    filename: 'join-me',
    qr: i.link,
  });
}

/* ── gym ────────────────────────────────────────────────────────────────── */

export function classesPost(i: { classes: { title: string; when: string }[]; brand: string }): PostBuild {
  const rows = i.classes.filter((c) => clean(c.title) && clean(c.when));
  if (!rows.length) return no('No classes are scheduled in the next seven days.');
  return post({
    kicker: 'This Week',
    headline: `Classes at ${clean(i.brand)}`,
    lines: rows.slice(0, MAX_LINES).map((c) => `${clean(c.when)} · ${clean(c.title)}`),
    footer: i.brand,
    caption: `This week at ${clean(i.brand)}: ${rows.slice(0, MAX_LINES).map((c) => `${clean(c.title)} ${clean(c.when)}`).join(', ')}.`,
    filename: 'classes-this-week',
  });
}

export function promoPost(i: { code: string; pct: number; brand: string }): PostBuild {
  if (!clean(i.code) || !(i.pct > 0)) return no('Pick a live promo code to post.');
  return post({
    kicker: 'Members Offer',
    headline: `${i.pct}% Off`,
    big: { value: clean(i.code).toUpperCase(), unit: '' },
    lines: ['Use This Code When You Join'],
    footer: i.brand,
    caption: `${i.pct}% off at ${clean(i.brand)} with code ${clean(i.code).toUpperCase()}.`,
    filename: `${i.code}-promo`,
  });
}

export function milestonePost(i: { visits: number | null; classes: number | null; period: string; brand: string }): PostBuild {
  if (!(i.visits != null && i.visits > 0)) return no('No class visits are recorded for this period yet.');
  return post({
    kicker: clean(i.period),
    headline: 'Our Members Showed Up',
    big: { value: i.visits.toLocaleString(), unit: i.visits === 1 ? 'Class Visit' : 'Class Visits' },
    lines: [i.classes != null && i.classes > 0 ? `Across ${i.classes.toLocaleString()} ${i.classes === 1 ? 'Class' : 'Classes'}` : null],
    footer: i.brand,
    caption: `${i.visits.toLocaleString()} class visits at ${clean(i.brand)} ${clean(i.period).toLowerCase()}. Thank you, members.`,
    filename: 'member-milestone',
  });
}

export function eventPost(i: { title: string; when: string; note: string; brand: string }): PostBuild {
  if (!clean(i.title)) return no('Give the event a name.');
  return post({
    kicker: clean(i.when) || 'Coming Up',
    headline: clean(i.title),
    lines: [i.note],
    footer: i.brand,
    caption: [clean(i.title), clean(i.when), clean(i.note)].filter(Boolean).join('. ') + ` At ${clean(i.brand)}.`,
    filename: `${i.title}-event`,
  });
}
