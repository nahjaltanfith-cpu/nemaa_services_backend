-- The NGO's profile picture (uploaded by the NGO after login, shown next to its chat messages).
-- NULL = no picture: the chat shows the name's initial instead.
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512);
