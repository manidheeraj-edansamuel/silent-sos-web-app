-- ==============================================================================
-- Migration 011: Add per-contact notification channel preferences
-- Description: Lets each emergency contact opt out of email or SMS delivery
-- while remaining reachable over the other configured channel.
-- ==============================================================================

ALTER TABLE emergency_contacts
    ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN NOT NULL DEFAULT TRUE;
