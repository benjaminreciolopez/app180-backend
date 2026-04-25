-- Almacena el XML del registro tal como se envía a la AEAT (con la firma
-- XAdES-EPES embebida y el sello de tiempo, cuando estén implementados).
--
-- Sirve para tres cosas:
--   1. Auditoría / inspección: regenerar la prueba exacta enviada.
--   2. Reenvío idempotente sin reconstruir el XML.
--   3. Verificación a posteriori del Encadenamiento (Huella anterior/actual).
--
-- Conservación obligatoria 8 años por RD 1619/2012 (art. 19) y RD 1007/2023.

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS xml_firmado TEXT;

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS tsa_timestamp_token TEXT;

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS tsa_timestamp_at TIMESTAMPTZ;
