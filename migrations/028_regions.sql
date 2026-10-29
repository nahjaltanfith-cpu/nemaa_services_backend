-- Saudi Arabia's 13 administrative regions (the NGO registration form picks one).
-- Fixed ids keep every database (local, server) on the same values.
CREATE TABLE IF NOT EXISTS regions (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

INSERT INTO regions (id, name) VALUES
    (1, 'الرياض'),
    (2, 'مكة المكرمة'),
    (3, 'المدينة المنورة'),
    (4, 'القصيم'),
    (5, 'الشرقية'),
    (6, 'عسير'),
    (7, 'تبوك'),
    (8, 'حائل'),
    (9, 'الحدود الشمالية'),
    (10, 'جازان'),
    (11, 'نجران'),
    (12, 'الباحة'),
    (13, 'الجوف')
ON CONFLICT (id) DO NOTHING;

-- NGOs registered before this field stay without a region (NULL).
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS region_id SMALLINT REFERENCES regions (id);
