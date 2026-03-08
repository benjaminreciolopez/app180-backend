-- Agregar columnas de certificado VeriFactu que el código espera
-- La tabla se creó con cert_aeat_path/password pero el código usa verifactu_certificado_path/password
-- Fecha: 2026-03-08

ALTER TABLE configuracionsistema_180
ADD COLUMN IF NOT EXISTS verifactu_certificado_path TEXT;

ALTER TABLE configuracionsistema_180
ADD COLUMN IF NOT EXISTS verifactu_certificado_password TEXT;

ALTER TABLE configuracionsistema_180
ADD COLUMN IF NOT EXISTS verifactu_cert_fabricante_path TEXT;

ALTER TABLE configuracionsistema_180
ADD COLUMN IF NOT EXISTS verifactu_cert_fabricante_password TEXT;

ALTER TABLE configuracionsistema_180
ADD COLUMN IF NOT EXISTS verifactu_info_fabricante JSONB;

-- Migrar datos existentes de cert_aeat_* a verifactu_certificado_*
UPDATE configuracionsistema_180
SET verifactu_certificado_path = COALESCE(verifactu_certificado_path, cert_aeat_path),
    verifactu_certificado_password = COALESCE(verifactu_certificado_password, cert_aeat_password)
WHERE cert_aeat_path IS NOT NULL;

COMMENT ON COLUMN configuracionsistema_180.verifactu_certificado_path IS 'Ruta al certificado .p12 del CLIENTE/CONTRIBUYENTE para VeriFactu';
COMMENT ON COLUMN configuracionsistema_180.verifactu_certificado_password IS 'Contraseña del certificado del cliente';
COMMENT ON COLUMN configuracionsistema_180.verifactu_cert_fabricante_path IS 'Ruta al certificado .p12 del FABRICANTE/PRODUCTOR del software';
COMMENT ON COLUMN configuracionsistema_180.verifactu_cert_fabricante_password IS 'Contraseña del certificado del fabricante';
COMMENT ON COLUMN configuracionsistema_180.verifactu_info_fabricante IS 'Información del fabricante para registro AEAT';
