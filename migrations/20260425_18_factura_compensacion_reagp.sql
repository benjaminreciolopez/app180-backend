-- Sprint 6: cierre REAGP. El autónomo en REAGP (Arts. 124-134 LIVA) no
-- repercute IVA en sus ventas; en su lugar percibe una compensación a tanto
-- alzado del cliente (12% agric/forestal o 10,5% ganadería/pesca). Persistimos
-- el porcentaje y el importe de la compensación a nivel de factura para que
-- aparezca en PDF, libros y modelos.

ALTER TABLE factura_180
    ADD COLUMN IF NOT EXISTS compensacion_reagp_pct NUMERIC(4,2);

ALTER TABLE factura_180
    ADD COLUMN IF NOT EXISTS compensacion_reagp_importe NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'factura_180_compensacion_reagp_chk'
    ) THEN
        ALTER TABLE factura_180
            ADD CONSTRAINT factura_180_compensacion_reagp_chk
            CHECK (compensacion_reagp_pct IS NULL OR compensacion_reagp_pct IN (10.5, 12.0));
    END IF;
END $$;
