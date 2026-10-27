-- ==============================================================================
-- Migration 010: Web Push Subscriptions
-- Description: Stores per-alert browser push subscriptions created by recipients
-- through their tracking portal. The raw tracking token is stored encrypted
-- (AES-256-GCM) so notification click-through links work without keeping
-- plaintext tokens at rest.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    expiration_time BIGINT NULL,
    tracking_token_encrypted TEXT NOT NULL,
    user_agent VARCHAR(512) NULL,
    last_notified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT push_subscriptions_alert_endpoint_key UNIQUE (alert_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_alert_id
ON push_subscriptions (alert_id);
