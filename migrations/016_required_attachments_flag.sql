-- Required attachments become { "name": "...", "required": true|false }: the admin marks each
-- document as mandatory (blocks submitting the request) or optional. Existing plain names are
-- converted; the ones written as "(إن وجد)" / "(إن وجدت)" were meant to be optional.
UPDATE services
SET required_attachments = COALESCE((
        SELECT jsonb_agg(
            CASE WHEN jsonb_typeof(item) = 'string'
                THEN jsonb_build_object('name', item #>> '{}', 'required', (item #>> '{}') !~ 'إن وجد')
                ELSE item
            END ORDER BY position)
        FROM jsonb_array_elements(required_attachments) WITH ORDINALITY AS list(item, position)
    ), '[]'::jsonb)
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(required_attachments) AS list(item)
    WHERE jsonb_typeof(item) = 'string'
);
