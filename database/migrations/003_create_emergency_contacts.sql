-- ==============================================================================
-- Migration 003: Create Emergency Contacts Table
-- Description: Trusted contacts designated to receive notifications upon SOS activation.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_name VARCHAR(150) NOT NULL,
    contact_phone VARCHAR(30),
    contact_email VARCHAR(255),
    priority_order INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_emergency_contacts_comm_method CHECK (
        contact_phone IS NOT NULL OR contact_email IS NOT NULL
    ),
    CONSTRAINT chk_emergency_contacts_priority_positive CHECK (
        priority_order > 0
    ),
    CONSTRAINT uq_emergency_contacts_user_priority UNIQUE (
        user_id, priority_order
    )
);

-- Index for retrieving a user's emergency contacts ordered by priority
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON emergency_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_priority ON emergency_contacts (user_id, priority_order ASC);
