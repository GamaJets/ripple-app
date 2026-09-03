"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECOVERY_ACTIVITIES = void 0;
exports.isRecoveryActivity = isRecoveryActivity;
/**
 * Deliberately without MET values. None of these is exercise expenditure: a
 * sauna raises heart rate, but the cost is thermoregulation rather than work,
 * so a calorie figure derived from time and body weight would be invented.
 * `cardioKcal` returns null for anything absent from the MET table.
 */
exports.RECOVERY_ACTIVITIES = [
    'Breathwork',
    'Cold Plunge',
    'Contrast Therapy',
    'Massage',
    'Sauna',
    'Steam Room',
];
const LOWER = new Set(exports.RECOVERY_ACTIVITIES.map((n) => n.toLowerCase()));
/** Whether a logged exercise name is one of the recovery modalities. */
function isRecoveryActivity(name) {
    return !!name && LOWER.has(name.trim().toLowerCase());
}
