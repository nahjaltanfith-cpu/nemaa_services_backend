-- NGO accounts with email verification and password-reset OTPs.
-- The migration runner executes this file in a transaction.
CREATE TABLE IF NOT EXISTS ngos (
    id SERIAL PRIMARY KEY,
    ngo_name VARCHAR(200) NOT NULL,
    reg_number VARCHAR(20) NOT NULL UNIQUE,
    field_of_work VARCHAR(200) NOT NULL,
    representative_name VARCHAR(200) NOT NULL,
    position VARCHAR(100),
    email VARCHAR(255) NOT NULL UNIQUE,
    mobile VARCHAR(20) NOT NULL,
    password VARCHAR(255) NOT NULL,
    account_status VARCHAR(20) NOT NULL DEFAULT 'under_review'
        CHECK (account_status IN ('approved', 'under_review', 'needs_documents')),
    email_verified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One active OTP per NGO. otp_code holds an HMAC-SHA256 of the code, never the code itself.
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS otp_code VARCHAR(64);
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS otp_purpose VARCHAR(20);
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS otp_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ngos_otp_purpose_check'
    ) THEN
        ALTER TABLE ngos ADD CONSTRAINT ngos_otp_purpose_check
            CHECK (otp_purpose IN ('verify_email', 'reset_password'));
    END IF;
END $$;
