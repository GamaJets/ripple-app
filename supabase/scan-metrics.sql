-- Repple — optional richer InBody metrics on scans (visceral fat, InBody score,
-- BMR, fat/lean mass, body water/protein/minerals, segmental lean). Stored as a
-- single JSONB blob so new fields never need another migration. The app already
-- keeps these device-locally; run this + wire the write to make them sync across
-- devices and show up for the client's trainer. Idempotent; safe to re-run.
alter table scans add column if not exists metrics jsonb;
