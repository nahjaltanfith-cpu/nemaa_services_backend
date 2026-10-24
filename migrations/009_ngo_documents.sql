-- Storage keys (e.g. temp/<uuid>.pdf) of the two registration documents.
-- NULL means the document is still missing and must be requested from the NGO.
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS ngo_document_key VARCHAR(255);
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS representative_proof_key VARCHAR(255);
