-- Add kind column to channels (music | noise), defaulting existing rows to 'music'
ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'music';
