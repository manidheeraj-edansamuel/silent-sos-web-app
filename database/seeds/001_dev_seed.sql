-- ==============================================================================
-- Development Seed 001: Sample Development Baseline Data
-- WARNING: Development and testing environment use ONLY.
-- ==============================================================================

-- 1. Demo User
INSERT INTO users (id, full_name, phone_number, email, created_at, updated_at)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Demo User (Dev Baseline)',
    '+15550199000',
    'demo.user@example.local',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '30 days'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Emergency Contacts (2 Trusted Contacts with priority ordering)
INSERT INTO emergency_contacts (id, user_id, contact_name, contact_phone, contact_email, priority_order, created_at, updated_at)
VALUES 
(
    'c0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Alex Rivera (Primary Contact)',
    '+15550199001',
    'alex.rivera@example.local',
    1,
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '30 days'
),
(
    'c0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Jordan Taylor (Secondary Contact)',
    '+15550199002',
    'jordan.taylor@example.local',
    2,
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '30 days'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Sample Resolved Alert
INSERT INTO alerts (id, user_id, status, triggered_at, acknowledged_at, resolved_at, created_at, updated_at)
VALUES (
    'e0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'resolved',
    NOW() - INTERVAL '20 minutes',
    NOW() - INTERVAL '15 minutes',
    NOW() - INTERVAL '2 minutes',
    NOW() - INTERVAL '20 minutes',
    NOW() - INTERVAL '2 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- 4. Sample Geospatial Alert Location Breadcrumbs (Empire State Building -> Bryant Park area)
INSERT INTO alert_locations (id, alert_id, location, accuracy_meters, altitude_meters, heading_degrees, speed_mps, logged_at)
VALUES 
(
    'f0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001',
    ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography,
    12.4,
    15.0,
    350.0,
    0.0,
    NOW() - INTERVAL '20 minutes'
),
(
    'f0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000001',
    ST_SetSRID(ST_MakePoint(-73.9851, 40.7510), 4326)::geography,
    8.0,
    16.2,
    20.0,
    1.3,
    NOW() - INTERVAL '15 minutes'
),
(
    'f0000000-0000-0000-0000-000000000003',
    'e0000000-0000-0000-0000-000000000001',
    ST_SetSRID(ST_MakePoint(-73.9840, 40.7535), 4326)::geography,
    4.5,
    17.0,
    45.0,
    0.2,
    NOW() - INTERVAL '2 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- 5. Corresponding Alert Events (Audit Trail)
INSERT INTO alert_events (id, alert_id, event_type, event_data, created_at)
VALUES 
(
    'd0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001',
    'triggered',
    '{"trigger_source": "quick_press_stealth", "client_platform": "web_pwa", "initial_battery": 92}'::jsonb,
    NOW() - INTERVAL '20 minutes'
),
(
    'd0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000001',
    'notification_queued',
    '{"recipients_count": 2, "channels": ["sms", "email"]}'::jsonb,
    NOW() - INTERVAL '19 minutes 50 seconds'
),
(
    'd0000000-0000-0000-0000-000000000003',
    'e0000000-0000-0000-0000-000000000001',
    'notification_sent',
    '{"primary_channel": "sms", "recipient_id": "c0000000-0000-0000-0000-000000000001"}'::jsonb,
    NOW() - INTERVAL '19 minutes 40 seconds'
),
(
    'd0000000-0000-0000-0000-000000000004',
    'e0000000-0000-0000-0000-000000000001',
    'location_updated',
    '{"accuracy_meters": 8.0, "speed_mps": 1.3}'::jsonb,
    NOW() - INTERVAL '15 minutes'
),
(
    'd0000000-0000-0000-0000-000000000005',
    'e0000000-0000-0000-0000-000000000001',
    'acknowledged',
    '{"acknowledged_by": "Alex Rivera", "contact_id": "c0000000-0000-0000-0000-000000000001"}'::jsonb,
    NOW() - INTERVAL '15 minutes'
),
(
    'd0000000-0000-0000-0000-000000000006',
    'e0000000-0000-0000-0000-000000000001',
    'resolved',
    '{"resolved_by": "user", "reason": "safe_arrival"}'::jsonb,
    NOW() - INTERVAL '2 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- 6. Sample Notification Attempt Records
INSERT INTO notification_attempts (id, alert_id, emergency_contact_id, channel, destination, status, provider_message_id, attempt_number, error_message, attempted_at, delivered_at)
VALUES 
(
    'b0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'sms',
    '+15550199001',
    'delivered',
    'SM_dev_demo_001_mock',
    1,
    NULL,
    NOW() - INTERVAL '19 minutes 45 seconds',
    NOW() - INTERVAL '19 minutes 30 seconds'
),
(
    'b0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'email',
    'jordan.taylor@example.local',
    'delivered',
    'MSG_dev_demo_002_mock',
    1,
    NULL,
    NOW() - INTERVAL '19 minutes 40 seconds',
    NOW() - INTERVAL '19 minutes 20 seconds'
)
ON CONFLICT (id) DO NOTHING;
