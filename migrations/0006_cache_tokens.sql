-- migrations/0006_cache_tokens.sql
ALTER TABLE logs ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0;
ALTER TABLE logs ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
