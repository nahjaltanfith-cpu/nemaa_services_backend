-- NGO conversations are always open: the dashboard no longer offers closing one.
-- Reopen any that were closed so both sides can send again.
UPDATE ngos SET conversation_open = TRUE WHERE conversation_open = FALSE;
