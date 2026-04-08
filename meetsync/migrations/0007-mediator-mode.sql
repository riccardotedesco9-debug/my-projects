-- Add mediation mode to sessions (NULL = classic, 'MEDIATED' = share availability directly)
ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT NULL;
