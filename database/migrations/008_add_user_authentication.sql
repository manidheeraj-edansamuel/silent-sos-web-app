-- ==============================================================================
-- Migration 008: Add User Authentication Fields
-- Description: Adds password hash (Argon2id) and last login tracking to users table.
-- ==============================================================================

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;

-- Index for authentication queries and account monitoring
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users (last_login_at DESC);
