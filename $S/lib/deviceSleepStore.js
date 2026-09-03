"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storableNights = storableNights;
exports.withStored = withStored;
exports.rowToStored = rowToStored;
exports.storedToRow = storedToRow;
/**
 * The nights from a fresh read that are worth keeping.
 *
 * Only 'measured' ones, and only where a source came with the figure — a night
 * with minutes but no attribution cannot be shown honestly when it comes back,
 * so it is not kept rather than being kept anonymously.
 */
function storableNights(nights) {
    const out = [];
    for (const n of nights || []) {
        if (!n || n.outcome !== 'measured')
            continue;
        const m = n.minutesAsleep;
        const s = n.source;
        if (!s || m == null || !Number.isFinite(m) || m <= 0)
            continue;
        out.push({
            night: n.night,
            minutesAsleep: Math.round(m),
            provider: s.provider,
            sourceId: s.sourceId,
            sourceName: s.sourceName,
            family: s.family,
            basis: s.basis,
        });
    }
    return out;
}
/**
 * A fresh read, backed by what was stored, night by night.
 *
 * The rule is one sentence: a night the devices answered for TODAY stands as
 * they answered it, and a night they did not answer for falls back to the
 * figure they gave us before.
 *
 * Which direction that runs matters, and it runs this way round because a fresh
 * measurement is the devices' current answer and the stored copy is an old one.
 * A provider that has revised a night — WHOOP re-scores a night once its
 * processing catches up — must be allowed to revise it here too, or the app
 * would pin the first figure it ever saw and quietly disagree with the vendor's
 * own screen forever.
 *
 * A backed night keeps the `failed` list from the fresh read. The read still
 * failed; we simply have something real to show for the night anyway, and a
 * screen that wants to say "your WHOOP could not be reached" must still be able
 * to. What it does NOT keep is `outcome: 'unknown'` — a night we hold a real
 * measurement for is not unknown, and leaving it unknown is what deleted the
 * score every time somebody walked into a basement.
 *
 * Nights are matched by date only. Nothing here creates a night that was not in
 * `fresh`: the window is decided by the caller (recentNights), and a stored
 * night outside it is left alone rather than being pushed onto a list whose
 * length other screens count.
 */
function withStored(fresh, stored) {
    if (!stored?.length)
        return [...(fresh || [])];
    const byNight = new Map();
    for (const s of stored)
        if (s && s.minutesAsleep > 0)
            byNight.set(s.night, s);
    return (fresh || []).map((n) => {
        if (!n || n.outcome === 'measured')
            return n;
        const s = byNight.get(n.night);
        if (!s)
            return n;
        const reading = {
            provider: s.provider,
            sourceId: s.sourceId,
            sourceName: s.sourceName,
            family: s.family,
            basis: s.basis,
            night: s.night,
            minutesAsleep: s.minutesAsleep,
        };
        return {
            ...n,
            outcome: 'measured',
            minutesAsleep: s.minutesAsleep,
            source: reading,
            // One reading, from one device, and no claim of corroboration: whatever
            // else answered for this night today, it did not answer with a figure.
            agreement: 'single',
            others: [],
            spreadMin: null,
            // Said, not implied. A kept figure is a real one a named device really
            // reported, but it is not the device answering now, and a screen that
            // cannot tell the two apart would let "your WHOOP says 6h40" stand for a
            // WHOOP that has not been reachable since Tuesday.
            kept: true,
        };
    });
}
/**
 * A `device_sleep_nights` row as a StoredNight, or null if it cannot be one.
 *
 * Defensive about types for the reason src/ui/wellness.tsx documents on its own
 * row mapper: `minutes_asleep` is an integer in Postgres but supabase-js has
 * handed numerics back as strings on some paths, and a string reaching the
 * `minutesAsleep / 60` in readinessSleep produces NaN hours — which is not a
 * dash, it is a score that silently stops existing.
 *
 * A row missing its source name is dropped rather than shown as an unnamed
 * figure. See the header: attribution travels with the figure or the figure
 * does not travel.
 */
function rowToStored(r) {
    if (!r)
        return null;
    const night = String(r.night ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night))
        return null;
    const minutes = Number(r.minutes_asleep);
    if (!Number.isFinite(minutes) || minutes <= 0)
        return null;
    const sourceName = String(r.source_name ?? '');
    if (!sourceName)
        return null;
    return {
        night,
        minutesAsleep: Math.round(minutes),
        provider: String(r.provider ?? ''),
        sourceId: String(r.source_id ?? ''),
        sourceName,
        family: String(r.family ?? 'unknown'),
        basis: r.basis === 'in-bed' ? 'in-bed' : 'asleep',
    };
}
/** A StoredNight as the row to upsert. `user_id` is the caller's own id — the
 *  only one the policy in part 153 will accept. */
function storedToRow(userId, n) {
    return {
        user_id: userId,
        night: n.night,
        minutes_asleep: n.minutesAsleep,
        provider: n.provider,
        source_id: n.sourceId,
        source_name: n.sourceName,
        family: n.family,
        basis: n.basis,
    };
}
