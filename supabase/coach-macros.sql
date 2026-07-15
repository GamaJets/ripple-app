-- Repple — full-macro coach editor: carb & fat deltas on coach_nutrition so a
-- trainer can shape all four macros (not just calories + protein). The client's
-- targets already layer these via applyCoachAdjust. Idempotent; safe to re-run.
alter table coach_nutrition add column if not exists carb_delta int default 0;
alter table coach_nutrition add column if not exists fat_delta int default 0;
