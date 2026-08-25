-- ==============================================================================
-- Migration 007: Create Notification Attempts Table
-- Description: Records delivery lifecycle and status across channels (SMS, Email, Push, WhatsApp).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS notification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    emergency_contact_id UUID REFERENCES emergency_contacts(id) ON DELETE SET NULL,
    channel VARCHAR(30) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL,
    provider_message_id VARCHAR(255),
    attempt_number INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    CONSTRAINT chk_notification_attempt_number_positive CHECK (
        attempt_number > 0
    )
);

-- Indexes for delivery status queries and auditing
CREATE INDEX IF NOT EXISTS idx_notification_attempts_alert_id ON notification_attempts (alert_id);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_contact_id ON notification_attempts (emergency_contact_id);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_status ON notification_attempts (status);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_attempted_at ON notification_attempts (attempted_at DESC);
