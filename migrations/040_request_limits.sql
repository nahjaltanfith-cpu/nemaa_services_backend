-- Request limits: per NGO (general settings), per service and per center (their forms).

-- NULL = open (no limit on beneficiaries).
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS max_beneficiaries INTEGER CHECK (max_beneficiaries IS NULL OR max_beneficiaries > 0);
ALTER TABLE enablement_centers
    ADD COLUMN IF NOT EXISTS max_beneficiaries INTEGER CHECK (max_beneficiaries IS NULL OR max_beneficiaries > 0);

-- Whether the target was free when requested, so an NGO's free count survives ending the launch
-- period (flipping services to paid) and deleting a service.
ALTER TABLE service_requests
    ADD COLUMN IF NOT EXISTS target_is_free BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE service_requests r SET target_is_free = s.is_free FROM services s WHERE r.service_id = s.id;
UPDATE service_requests r SET target_is_free = c.is_free FROM enablement_centers c WHERE r.center_id = c.id;

-- Admin exception: this NGO is not held to any request limit.
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS limits_exempt BOOLEAN NOT NULL DEFAULT FALSE;

-- period: lifetime | yearly | monthly | custom (periodFrom..periodTo, e.g. the launch phase).
INSERT INTO app_settings (key, value)
VALUES ('request_limits', '{"maxFreeServices": 3, "maxTotalServices": 5, "period": "lifetime", "periodFrom": null, "periodTo": null}')
ON CONFLICT (key) DO NOTHING;

-- Counting the beneficiaries of a service or center on every catalog read.
CREATE INDEX IF NOT EXISTS service_requests_service_active_idx ON service_requests (service_id)
    WHERE deleted_at IS NULL AND status IN ('under_study', 'needs_completion', 'in_progress');
CREATE INDEX IF NOT EXISTS service_requests_center_active_idx ON service_requests (center_id)
    WHERE deleted_at IS NULL AND status IN ('under_study', 'needs_completion', 'in_progress');
