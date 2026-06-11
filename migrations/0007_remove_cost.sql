-- migrations/0007_remove_cost.sql
DROP INDEX IF EXISTS idx_logs_cost;
ALTER TABLE logs DROP COLUMN cost_usd;
DROP TABLE IF EXISTS pricing;
