-- Sprint 3B: vincular factura original con su rectificativa.
--
-- Hasta ahora, al crear una rectificativa la factura original quedaba en
-- estado 'ANULADA' sin ningún puntero hacia la rectificativa que la sustituyó.
-- Esto provocaba que el modelo 303 sumara incorrectamente las ventas: la
-- factura original (ANULADA) quedaba excluida y la rectificativa (con
-- importes negativos) sí se sumaba, dejando un neto de -original en el
-- periodo, en vez del 0 (mismo periodo) o +original (periodo del original)
-- + (-original) (periodo de la rectificativa) que exige el Art. 89 LIVA.
--
-- Añadimos la columna `factura_rectificativa_id` en la factura original
-- apuntando a la id de la rectificativa. Esto permite a los modelos 303/390
-- distinguir entre "anulada por rectificativa" (debe seguir contando en su
-- periodo) y "anulada manualmente" (excluida del cómputo).

ALTER TABLE factura_180
    ADD COLUMN IF NOT EXISTS factura_rectificativa_id INTEGER;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'factura_180_rectificativa_fk'
    ) THEN
        ALTER TABLE factura_180
            ADD CONSTRAINT factura_180_rectificativa_fk
            FOREIGN KEY (factura_rectificativa_id) REFERENCES factura_180(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_factura_180_rectificativa_id
    ON factura_180 (factura_rectificativa_id)
    WHERE factura_rectificativa_id IS NOT NULL;
