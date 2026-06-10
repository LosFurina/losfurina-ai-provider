ALTER TABLE logs ADD COLUMN cost_usd REAL DEFAULT 0;
ALTER TABLE logs ADD COLUMN source TEXT DEFAULT 'proxy';
ALTER TABLE logs ADD COLUMN provider_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_cost ON logs(cost_usd);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider_id);
