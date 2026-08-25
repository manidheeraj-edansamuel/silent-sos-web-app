-- ==============================================================================
-- Migration 001: Enable PostgreSQL Extensions
-- Description: Enables pgcrypto for UUID/crypto generation and PostGIS for spatial features.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
