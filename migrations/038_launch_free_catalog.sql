-- Launch period: every existing service and center is offered free.
-- Prices stay untouched, so the website shows "مجاني" with the original price struck through.
UPDATE services SET is_free = TRUE WHERE is_free = FALSE;
UPDATE enablement_centers SET is_free = TRUE WHERE is_free = FALSE;
