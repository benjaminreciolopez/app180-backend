-- Migración: Permitir OTPs de registro (sin empleado_id ni empresa_id, con email)
ALTER TABLE otp_codes_180 ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE otp_codes_180 ALTER COLUMN empleado_id DROP NOT NULL;
ALTER TABLE otp_codes_180 ALTER COLUMN empresa_id DROP NOT NULL;
