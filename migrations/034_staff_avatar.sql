-- A staff member's profile picture (set from the add / edit staff form).
-- NULL = no picture: the dashboard shows the name's initials instead.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512);
