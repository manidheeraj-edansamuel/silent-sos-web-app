-- ==============================================================================
-- Migration 002: Create Users Table
-- Description: Core user entity table for identity and contact records.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30),
    email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for identity queries & lookups
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users (phone_number);

-- Unique index for case-insensitive email lookup when email is provided
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (LOWER(email)) WHERE email IS NOT NULL;
