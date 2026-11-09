-- Snapshots saved before tolls / tickets were excluded from balances stay NULL ("before fix").
-- Version 2 = rental charges only (src/shared/config/charges.ts).
ALTER TABLE snapshots ADD COLUMN rules_version INTEGER;
