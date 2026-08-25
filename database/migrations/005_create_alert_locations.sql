-- ==============================================================================
-- Migration 005: Create Alert Locations Table
-- Description: Geospatial breadcrumbs recorded for an active emergency alert using PostGIS.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS alert_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    accuracy_meters DOUBLE PRECISION,
    altitude_meters DOUBLE PRECISION,
    heading_degrees DOUBLE PRECISION,
    speed_mps DOUBLE PRECISION,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_alert_locations_accuracy_nonnegative CHECK (
        accuracy_meters IS NULL OR accuracy_meters >= 0
    ),
    CONSTRAINT chk_alert_locations_speed_nonnegative CHECK (
        speed_mps IS NULL OR speed_mps >= 0
    ),
    CONSTRAINT chk_alert_locations_heading_range CHECK (
        heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees <= 360)
    )
);

-- Spatial index using GiST on geography point column for high-speed radius/proximity queries
CREATE INDEX IF NOT EXISTS idx_alert_locations_location_gist ON alert_locations USING GIST (location);

-- B-Tree indexes for alert chronology and breadcrumb lookup
CREATE INDEX IF NOT EXISTS idx_alert_locations_alert_id ON alert_locations (alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_locations_alert_logged ON alert_locations (alert_id, logged_at DESC);
