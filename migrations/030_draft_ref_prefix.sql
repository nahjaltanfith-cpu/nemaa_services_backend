-- Draft reference codes use the short D- prefix (was DRAFT-); submitted requests stay REQ-.
UPDATE service_requests SET ref_code = 'D-' || substring(ref_code FROM 7)
WHERE ref_code LIKE 'DRAFT-%';
