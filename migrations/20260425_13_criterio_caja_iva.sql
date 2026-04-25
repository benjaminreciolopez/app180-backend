-- Sprint 3D: régimen especial del criterio de caja IVA (Art. 163 decies LIVA).
--
-- En este régimen el devengo del IVA repercutido se produce en el momento
-- del cobro (total o parcial), y la deducción del IVA soportado en el
-- momento del pago. Las facturas no cobradas antes del 31 de diciembre del
-- año inmediatamente posterior se devengan obligatoriamente en esa fecha
-- (Art. 163 terdecies LIVA), pero esa parte se cubre desde la lógica de
-- cálculo del modelo 303.
--
-- Campos añadidos:
--   emisor_180.regimen_iva  general | criterio_caja
--   purchases_180.fecha_pago   fecha de pago de la compra (NULL = no pagada)
--
-- La fecha de cobro de las ventas se deriva del payment_allocations_180
-- ya existente (no se duplica en factura_180).

ALTER TABLE emisor_180
    ADD COLUMN IF NOT EXISTS regimen_iva VARCHAR(20) NOT NULL DEFAULT 'general';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'emisor_180_regimen_iva_chk'
    ) THEN
        ALTER TABLE emisor_180
            ADD CONSTRAINT emisor_180_regimen_iva_chk
            CHECK (regimen_iva IN ('general', 'criterio_caja'));
    END IF;
END $$;

ALTER TABLE purchases_180
    ADD COLUMN IF NOT EXISTS fecha_pago DATE;

CREATE INDEX IF NOT EXISTS idx_purchases_fecha_pago
    ON purchases_180 (empresa_id, fecha_pago)
    WHERE fecha_pago IS NOT NULL;
