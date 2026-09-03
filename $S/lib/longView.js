"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MONTHS = exports.monthLabels = void 0;
exports.monthKey = monthKey;
exports.nextMonth = nextMonth;
exports.monthLabel = monthLabel;
exports.monthsBetween = monthsBetween;
exports.monthlyHistory = monthlyHistory;
exports.yearRows = yearRows;
exports.peakVolume = peakVolume;
exports.intensity = intensity;
exports.bestMonth = bestMonth;
exports.trainedMonths = trainedMonths;
exports.gaps = gaps;
exports.longestGap = longestGap;
exports.monthsSinceLast = monthsSinceLast;
exports.historySpan = historySpan;
exports.stageOf = stageOf;
exports.historyNote = historyNote;
exports.lifetimeTotals = lifetimeTotals;
exports.prTimeline = prTimeline;
exports.volumeArc = volumeArc;
exports.tonnes = tonnes;
const streaks_1 = require("./streaks");
const bodyweightSets_1 = require("./bodyweightSets");
// A hold is not repetitions. This file re-implements the set loop three
// times, and all three multiplied a plank's SECONDS by a load: the twelve-week
// grid, lifetime tonnage and the Milestones timeline were each inflated by
// holds counted as reps, and `est1RM` over forty-five "reps" produced a
// fictional one-rep max that landed on the timeline as a record the member
// never set — and that no real set could beat afterwards.
// src/lib/progression.ts already carried this skip; these three did not.
const timedSets_1 = require("./timedSets");
const format_1 = require("./format");
const DAY = 86400000;
/**
 * The twelve short month names for this grid's axis, index-aligned with
 * `Date#getMonth`, in the reader's own language.
 *
 * A function rather than the exported `MONTH_LABELS` array it replaces. Two
 * reasons: `monthNamesShort()` asks `appLocale()`, which is latched lazily, so
 * a constant built at import time would pin a member's twelve-week grid to
 * whatever locale had been resolved before the app started; and the array this
 * hands back is the one src/lib/format.ts owns, so the axis of this chart and
 * the axis of every other chart cannot drift into two different Septembers.
 */
const monthLabels = () => (0, format_1.monthNamesShort)();
exports.monthLabels = monthLabels;
/** How far back the view will reach: three year-rows. Beyond that the screen
 *  says how many earlier months exist rather than drawing a wall of cells. */
exports.MAX_MONTHS = 36;
const pad2 = (n) => String(n).padStart(2, '0');
/**
 * LOCAL calendar month (not UTC), for the same reason `streaks.dayKey` uses the
 * local day: a session logged on the evening of 31 January belongs to January
 * for the person who trained, even though its ISO timestamp is already February
 * in UTC. Returns null for an unparseable timestamp — a corrupt row must not
 * take the whole history down with it.
 */
function monthKey(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
/** LOCAL calendar day, mirroring streaks.ts. Null on an unparseable timestamp. */
function dayKeyOf(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function ymOf(key) {
    const [y, m] = key.split('-');
    return { year: Number(y), month: Number(m) - 1 };
}
const keyOf = (year, month) => `${year}-${pad2(month + 1)}`;
/** The month after `key`. Used to walk a span; wraps the year for December. */
function nextMonth(key) {
    const { year, month } = ymOf(key);
    return month >= 11 ? keyOf(year + 1, 0) : keyOf(year, month + 1);
}
/** 'Mar 2026'. An unrecognised key is returned as-is rather than guessed at. */
function monthLabel(key) {
    const { year, month } = ymOf(key);
    const name = (0, exports.monthLabels)()[month];
    return name && Number.isFinite(year) ? `${name} ${year}` : key;
}
/** Whole calendar months from `a` to `b` inclusive of both ends. */
function monthsBetween(a, b) {
    const x = ymOf(a), y = ymOf(b);
    return (y.year - x.year) * 12 + (y.month - x.month) + 1;
}
function blankCell(key) {
    const { year, month } = ymOf(key);
    return {
        key, year, month, label: (0, exports.monthLabels)()[month] ?? key,
        trained: false, sessions: null, days: null, volumeKg: null, kcal: null,
        best1RM: null, topLift: null, unpricedSets: 0,
    };
}
function cellFrom(key, entries, history) {
    const cell = blankCell(key);
    if (!entries.length)
        return cell;
    const sessions = new Set();
    const days = new Set();
    const volByLift = new Map();
    let volume = 0, anyVolume = false;
    let kcal = 0, anyKcal = false;
    let best = 0, anyBest = false;
    let unpriced = 0;
    for (const e of entries) {
        sessions.add(e.t);
        const dk = dayKeyOf(e.t);
        if (dk)
            days.add(dk);
        if (typeof e.kcal === 'number' && Number.isFinite(e.kcal)) {
            kcal += e.kcal;
            anyKcal = true;
        }
        for (let i = 0; i < (e.sets?.length ?? 0); i++) {
            const set = e.sets[i];
            const reps = set?.[0] ?? 0;
            if (!(reps > 0))
                continue;
            // A hold's "reps" are seconds. Skipped before the load is resolved, so a
            // plank can reach neither the tonnage nor the estimated max.
            if ((0, timedSets_1.isTimedSet)(e, i))
                continue;
            // The LOAD, which on a bodyweight set is the person plus whatever they
            // hung off themselves. Reading `set[1]` directly is what this did, and on
            // a pull-up that number is zero — so a month of calisthenics reported no
            // tonnage, no top lift and no estimated max, and the grid drew it as an
            // untrained month with sessions in it.
            const weight = (0, bodyweightSets_1.setLoadKg)(e, i, set, history, e.t);
            if (weight == null || !(weight > 0)) {
                if ((0, bodyweightSets_1.isBodyweightSet)(e, i))
                    unpriced++;
                continue;
            }
            const v = reps * weight;
            volume += v;
            anyVolume = true;
            volByLift.set(e.exercise, (volByLift.get(e.exercise) ?? 0) + v);
            const one = (0, streaks_1.est1RM)(weight, reps);
            if (!anyBest || one > best) {
                best = one;
                anyBest = true;
            }
        }
    }
    let topLift = null, topVol = -1;
    for (const [lift, v] of volByLift)
        if (v > topVol) {
            topVol = v;
            topLift = lift;
        }
    return {
        ...cell,
        trained: true,
        sessions: sessions.size,
        days: days.size,
        volumeKg: anyVolume ? Math.round(volume) : null,
        kcal: anyKcal ? Math.round(kcal) : null,
        best1RM: anyBest ? best : null,
        topLift,
        unpricedSets: unpriced,
    };
}
/**
 * The member's history, month by month, oldest first.
 *
 * The window starts at their first logged session — never earlier. Padding the
 * front to a round twelve months is the mistake this whole module is written to
 * avoid: it shows a beginner eleven months of nothing and calls it their year.
 *
 * Months inside the window with no training are still present, flagged
 * `trained: false` with null figures, because a break in the middle is part of
 * the history and has to stay visible (rule 2).
 *
 * Capped to the most recent `maxMonths`; compare `historySpan().months` against
 * the returned length to tell the member that earlier months exist.
 */
function monthlyHistory(log, now = Date.now(), maxMonths = exports.MAX_MONTHS, history = []) {
    const byMonth = new Map();
    let first = null, last = null;
    for (const e of log) {
        const k = monthKey(e.t);
        if (!k)
            continue;
        const bucket = byMonth.get(k);
        if (bucket)
            bucket.push(e);
        else
            byMonth.set(k, [e]);
        if (first == null || k < first)
            first = k;
        if (last == null || k > last)
            last = k;
    }
    if (first == null || last == null)
        return [];
    // Run to this month even when the last session is older — the months since
    // somebody stopped are the most important thing on the page for them.
    const nowKey = monthKey(new Date(now).toISOString()) ?? last;
    const end = nowKey > last ? nowKey : last;
    const cells = [];
    for (let k = first;; k = nextMonth(k)) {
        cells.push(cellFrom(k, byMonth.get(k) ?? [], history));
        if (k === end)
            break;
        // Defensive stop: a clock skewed decades into the future must not spin here.
        if (cells.length > 1200)
            break;
    }
    return cells.length > maxMonths ? cells.slice(cells.length - maxMonths) : cells;
}
/** Lay the months out as calendar years so a year reads at a glance. */
function yearRows(cells) {
    if (!cells.length)
        return [];
    const rows = new Map();
    for (const c of cells) {
        let row = rows.get(c.year);
        if (!row) {
            row = { year: c.year, cells: Array(12).fill(null) };
            rows.set(c.year, row);
        }
        row.cells[c.month] = c;
    }
    return [...rows.values()].sort((a, b) => a.year - b.year);
}
/** The largest monthly tonnage in the series, for scaling a chart. Null when
 *  no month has a tonnage at all — a chart with no scale must not be drawn. */
function peakVolume(cells) {
    let max = null;
    for (const c of cells)
        if (c.volumeKg != null && (max == null || c.volumeKg > max))
            max = c.volumeKg;
    return max;
}
/** 0..1 for shading a cell, or null when there is nothing to shade. Never 0
 *  for an untrained month — that would paint it the same as a light month. */
function intensity(cell, peak) {
    if (!cell.trained || cell.volumeKg == null || peak == null || peak <= 0)
        return null;
    return Math.max(0, Math.min(1, cell.volumeKg / peak));
}
/** The month with the most tonnage. Null when nothing has been lifted. */
function bestMonth(cells) {
    let best = null;
    for (const c of cells)
        if (c.volumeKg != null && (best == null || c.volumeKg > (best.volumeKg ?? -1)))
            best = c;
    return best;
}
/** Months in the window that have training in them. */
function trainedMonths(cells) {
    return cells.filter((c) => c.trained);
}
/**
 * The breaks, in order. Only counts a run that has training on BOTH sides: an
 * open-ended silence at the end is not a gap the member came back from, it is
 * where they are now, and calling it a "2-month break" when it might be three
 * would be putting a false ending on it.
 */
function gaps(cells) {
    const out = [];
    let lastTrained = null;
    let run = 0;
    for (const c of cells) {
        if (c.trained) {
            if (lastTrained != null && run > 0)
                out.push({ afterKey: lastTrained, returnKey: c.key, months: run });
            lastTrained = c.key;
            run = 0;
        }
        else if (lastTrained != null) {
            run++;
        }
    }
    return out;
}
/** The longest break, or null if there has not been one. */
function longestGap(cells) {
    let worst = null;
    for (const g of gaps(cells))
        if (!worst || g.months > worst.months)
            worst = g;
    return worst;
}
/** Whole months since the last logged session, or null when nothing is logged.
 *  This is the open-ended silence `gaps()` deliberately refuses to close. */
function monthsSinceLast(cells) {
    const trained = trainedMonths(cells);
    if (!trained.length)
        return null;
    return cells.length - 1 - cells.indexOf(trained[trained.length - 1]);
}
function historySpan(log, now = Date.now()) {
    let firstT = Infinity, lastT = -Infinity;
    let firstAt = '', lastAt = '';
    for (const e of log) {
        const ts = Date.parse(e.t);
        if (!Number.isFinite(ts))
            continue;
        if (ts < firstT) {
            firstT = ts;
            firstAt = e.t;
        }
        if (ts > lastT) {
            lastT = ts;
            lastAt = e.t;
        }
    }
    if (!firstAt)
        return null;
    // Local midnights, so "days in" counts calendar days rather than 24-hour
    // blocks — a session at 11pm yesterday makes today day two, not day one.
    const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const from = startOfDay(firstT);
    const to = startOfDay(Math.max(now, lastT));
    const days = Math.max(1, Math.round((to - from) / DAY) + 1);
    const firstKey = monthKey(firstAt);
    const nowKey = monthKey(new Date(Math.max(now, lastT)).toISOString()) ?? firstKey;
    return { firstAt, lastAt, days, months: Math.max(1, monthsBetween(firstKey, nowKey)) };
}
function stageOf(span) {
    if (!span)
        return 'empty';
    if (span.days < 28)
        return 'starting';
    if (span.days < 180)
        return 'building';
    return 'long';
}
/**
 * One honest line about the size of the history, for the top of the screen.
 * Never claims a year that is not there and never scolds a beginner for being
 * new. Each branch states only what has actually been counted.
 */
function historyNote(log, now = Date.now()) {
    const span = historySpan(log, now);
    const stage = stageOf(span);
    if (!span || stage === 'empty')
        return 'Your history starts with your first logged session.';
    const cells = monthlyHistory(log, now);
    const months = trainedMonths(cells).length;
    if (stage === 'starting') {
        return `Day ${span.days} — this is the start of your history, and it fills out as the months go by.`;
    }
    return `${months} month${months === 1 ? '' : 's'} with training, back to ${monthLabel(monthKey(span.firstAt))}.`;
}
/** Everything, since the beginning. Null when there is no history to total. */
function lifetimeTotals(log, history = []) {
    const span = historySpan(log, Date.now());
    if (!span)
        return null;
    const sessions = new Set(), days = new Set(), lifts = new Set();
    let volume = 0, anyVolume = false, kcal = 0, anyKcal = false, unpriced = 0;
    for (const e of log) {
        const dk = dayKeyOf(e.t);
        if (!dk)
            continue;
        sessions.add(e.t);
        days.add(dk);
        if (typeof e.kcal === 'number' && Number.isFinite(e.kcal)) {
            kcal += e.kcal;
            anyKcal = true;
        }
        for (let i = 0; i < (e.sets?.length ?? 0); i++) {
            const set = e.sets[i];
            const reps = set?.[0] ?? 0;
            if (!(reps > 0))
                continue;
            // Not lifetime tonnage. A hold is not unpriced work either, so it is not
            // counted in `unpriced` — it is work this total is not about.
            if ((0, timedSets_1.isTimedSet)(e, i))
                continue;
            const weight = (0, bodyweightSets_1.setLoadKg)(e, i, set, history, e.t);
            if (weight == null || !(weight > 0)) {
                if ((0, bodyweightSets_1.isBodyweightSet)(e, i))
                    unpriced++;
                continue;
            }
            volume += reps * weight;
            anyVolume = true;
            lifts.add(e.exercise);
        }
    }
    return {
        firstAt: span.firstAt, lastAt: span.lastAt,
        sessions: sessions.size, days: days.size,
        volumeKg: anyVolume ? Math.round(volume) : null,
        kcal: anyKcal ? Math.round(kcal) : null,
        lifts: lifts.size,
        unpricedSets: unpriced,
    };
}
/**
 * Every improvement on every lift, oldest first. One milestone per session at
 * most per lift — the best set of the session — so a five-set PR day is one
 * moment rather than five.
 */
function prTimeline(log, history = []) {
    const sorted = log
        .filter((e) => Number.isFinite(Date.parse(e.t)) && e.sets && e.sets.length)
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const best = new Map();
    const out = [];
    for (const e of sorted) {
        let top = 0, topW = 0, topR = 0;
        for (let i = 0; i < (e.sets?.length ?? 0); i++) {
            const set = e.sets[i];
            const reps = set?.[0] ?? 0;
            if (!(reps > 0))
                continue;
            // The worst of the three. `est1RM(80, 45)` is a number no human has ever
            // lifted, and once it is on the timeline as a personal record no real set
            // can ever beat it — the member's Milestones list is closed by a plank.
            if ((0, timedSets_1.isTimedSet)(e, i))
                continue;
            const weight = (0, bodyweightSets_1.setLoadKg)(e, i, set, history, e.t);
            if (weight == null || !(weight > 0))
                continue;
            const one = (0, streaks_1.est1RM)(weight, reps);
            if (one > top) {
                top = one;
                topW = weight;
                topR = reps;
            }
        }
        if (top <= 0)
            continue;
        const prior = best.get(e.exercise);
        if (prior != null && top <= prior)
            continue;
        out.push({ at: e.t, exercise: e.exercise, est1RM: top, weight: topW, reps: topR, prev: prior ?? null });
        best.set(e.exercise, top);
    }
    return out;
}
function volumeArc(cells) {
    const withVolume = cells.filter((c) => c.volumeKg != null);
    if (withVolume.length < 2)
        return null;
    const a = withVolume[0], b = withVolume[withVolume.length - 1];
    const from = a.volumeKg, to = b.volumeKg;
    return {
        fromKey: a.key, toKey: b.key,
        fromVolumeKg: from, toVolumeKg: to,
        deltaKg: to - from,
        pct: from > 0 ? Math.round(((to - from) / from) * 100) : null,
        months: monthsBetween(a.key, b.key),
    };
}
/** Tonnes, to one decimal, for a figure that would otherwise run to six digits.
 *  Null in, null out — this must never turn "unknown" into "0.0 t". */
function tonnes(kg) {
    return kg == null ? null : Math.round(kg / 100) / 10;
}
