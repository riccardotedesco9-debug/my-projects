-- Add explanation column to free_slots for "why this slot" context
ALTER TABLE free_slots ADD COLUMN explanation TEXT;
