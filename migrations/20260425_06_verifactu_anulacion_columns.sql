-- RegistroAnulacion (RD 1007/2023): cancelar una factura ya enviada a AEAT.
--
-- Hasta ahora `anularFactura` sólo creaba la rectificativa (R-suffix) y la
-- enviaba como RegistroAlta con importes negativos. El RD exige además un
-- RegistroAnulacion explícito que apunte al registro original — sin éste la
-- AEAT considera la factura como vigente y la rectificativa como nueva
-- factura independiente, no como cancelación.
--
-- Diseño:
--   * `tipo_registro` distingue ALTA vs ANULACION en la misma tabla
--     (cadena de huella única por empresa + modo, idéntica al alta).
--   * `factura_anulada_id` referencia la factura original (sólo ANULACION).
--   * `motivo_anulacion` texto libre — la AEAT no lo exige pero sirve para
--     auditoría interna.

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS tipo_registro VARCHAR(20) NOT NULL DEFAULT 'ALTA';

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS factura_anulada_id INTEGER;

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

-- Constraint para que tipo_registro sólo acepte valores válidos.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'registroverifactu_tipo_registro_chk'
    ) THEN
        ALTER TABLE registroverifactu_180
            ADD CONSTRAINT registroverifactu_tipo_registro_chk
            CHECK (tipo_registro IN ('ALTA', 'ANULACION'));
    END IF;
END $$;

-- FK opcional a la factura anulada (sólo se popula en ANULACION).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'registroverifactu_factura_anulada_fk'
    ) THEN
        ALTER TABLE registroverifactu_180
            ADD CONSTRAINT registroverifactu_factura_anulada_fk
            FOREIGN KEY (factura_anulada_id) REFERENCES factura_180(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_verifactu_tipo_factura_anulada
    ON registroverifactu_180 (tipo_registro, factura_anulada_id)
    WHERE tipo_registro = 'ANULACION';
