"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attributionLine = attributionLine;
/** The logged-by line for a workout, or null when the person logged it themselves. */
function attributionLine(e, coachName, viewerIsTheClient) {
    if (!e.loggedBy)
        return null;
    const who = coachName?.trim() || 'your coach';
    const by = viewerIsTheClient ? `Logged by ${who}` : 'Logged by you';
    if (!e.amendedAt)
        return by;
    const when = new Date(e.amendedAt);
    const stamp = Number.isNaN(when.getTime())
        ? ''
        : ` on ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    // Said plainly on both sides. The coach needs to know their account of the
    // session was changed; the client needs to know their change is visible.
    return `${by} · amended by ${viewerIsTheClient ? 'you' : 'them'}${stamp}`;
}
