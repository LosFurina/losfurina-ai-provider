-- Rename summary columns to store full raw body
ALTER TABLE logs RENAME COLUMN request_summary TO request_body;
ALTER TABLE logs RENAME COLUMN response_summary TO response_body;
