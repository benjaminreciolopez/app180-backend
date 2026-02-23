-- Agregar columnas de firma digital a registros VeriFactu
-- Sistema de DOBLE FIRMA: Cliente + Fabricante

ALTER TABLE registroverifactu_180 ADD COLUMN IF NOT EXISTS firma_cliente TEXT;
ALTER TABLE registroverifactu_180 ADD COLUMN IF NOT EXISTS firma_fabricante TEXT;
ALTER TABLE registroverifactu_180 ADD COLUMN IF NOT EXISTS info_cert_cliente JSONB;
ALTER TABLE registroverifactu_180 ADD COLUMN IF NOT EXISTS info_cert_fabricante JSONB;
ALTER TABLE registroverifactu_180 ADD COLUMN IF NOT EXISTS fecha_firma TIMESTAMPTZ;
ALTER TABLE registroverifactu_180 ADD COLUMN IF NOT EXISTS algoritmo_firma VARCHAR(50) DEFAULT 'SHA-256-RSA';

-- Comentarios
COMMENT ON COLUMN registroverifactu_180.firma_cliente IS 'Firma digital del cliente/usuario (certificado del contribuyente)';
COMMENT ON COLUMN registroverifactu_180.firma_fabricante IS 'Firma digital del fabricante/productor (certificado del desarrollador)';
COMMENT ON COLUMN registroverifactu_180.info_cert_cliente IS 'Información del certificado del cliente (NIF, validez, etc.)';
COMMENT ON COLUMN registroverifactu_180.info_cert_fabricante IS 'Información del certificado del fabricante';
COMMENT ON COLUMN registroverifactu_180.fecha_firma IS 'Timestamp de la firma digital';
COMMENT ON COLUMN registroverifactu_180.algoritmo_firma IS 'Algoritmo de firma (default: SHA-256-RSA)';

-- Agregar columnas a configuración del sistema para certificado del fabricante
ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS verifactu_cert_fabricante_path TEXT;
ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS verifactu_cert_fabricante_password TEXT;
ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS verifactu_info_fabricante JSONB;

COMMENT ON COLUMN configuracionsistema_180.verifactu_cert_fabricante_path IS 'Ruta al certificado .p12 del FABRICANTE/PRODUCTOR del software';
COMMENT ON COLUMN configuracionsistema_180.verifactu_cert_fabricante_password IS 'Contraseña del certificado del fabricante (cifrada)';
COMMENT ON COLUMN configuracionsistema_180.verifactu_info_fabricante IS 'Información del fabricante para registro AEAT';
