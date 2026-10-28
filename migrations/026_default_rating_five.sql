-- Ratings are not computed from reviews yet: a new service or center starts at a full 5 instead of
-- showing "0.0" on the website. Existing 0 ratings (never rated) become 5 too.
-- The migration runner executes this file in a transaction.
ALTER TABLE services ALTER COLUMN rating SET DEFAULT 5;
ALTER TABLE enablement_centers ALTER COLUMN rating SET DEFAULT 5;
UPDATE services SET rating = 5 WHERE rating = 0;
UPDATE enablement_centers SET rating = 5 WHERE rating = 0;
