-- ==============================================================================
-- Migration 006: Create Alert Events Table
-- Description: Immutable audit trail for recording state transitions and actions during an SOS.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit retrieval and analytics
CREATE INDEX IF NOT EXISTS idx_alert_events_alert_id ON alert_events (alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_events_event_type ON alert_events (event_type);
CREATE INDEX IF NOT EXISTS idx_alert_events_created_at ON alert_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_alert_created ON alert_events (alert_id, created_at ASC);
