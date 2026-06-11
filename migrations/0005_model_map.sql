-- migrations/0005_model_map.sql
ALTER TABLE providers ADD COLUMN model_map TEXT DEFAULT '{}';
