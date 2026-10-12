-- ==============================================================================
-- Migration 009: Add Tracking Token Hash to Alerts
-- Description: Adds SHA-256 hash column for secure, unguessable public tracking tokens.
-- Raw tokens are never stored in the database.
-- ==============================================================================

ALTER TABLE alerts 
ADD COLUMN IF NOT EXISTS tracking_token_hash VARCHAR(64) NULL;

-- Unique index for high-speed tracking lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_tracking_token_hash 
ON alerts (tracking_token_hash) 
WHERE tracking_token_hash IS NOT NULL;
