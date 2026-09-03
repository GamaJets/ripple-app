"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasBodyFigure = void 0;
exports.bodyFigure = bodyFigure;
/**
 * A figure the vendor actually holds, or null.
 *
 * Zero is not a small measurement, it is an absent one. WHOOP returns
 * weight_kilogram as null when the client has never entered it, and a zero-kilo
 * body offered as "your WHOOP weight" is worse than offering nothing, because
 * the client can act on it — the scan form would take the 0 and build a day of
 * food around it.
 */
function bodyFigure(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
/**
 * True when this read carries a figure worth offering to anybody.
 *
 * Status alone is not enough. A 'ready' read holding three nulls is a real
 * answer — the client never told the vendor — and offering it would put a
 * prompt with no number in it in front of them. Both halves are required.
 */
const hasBodyFigure = (r) => r.status === 'ready' && (r.weightKg != null || r.heightM != null || r.maxHeartRate != null);
exports.hasBodyFigure = hasBodyFigure;
