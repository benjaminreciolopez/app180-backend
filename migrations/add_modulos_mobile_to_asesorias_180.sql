-- Permite a una asesoría definir un subset de módulos visibles en PWA móvil
-- distinto del subset desktop. NULL = usar `modulos` completo.
ALTER TABLE asesorias_180
ADD COLUMN IF NOT EXISTS modulos_mobile JSONB DEFAULT NULL;

COMMENT ON COLUMN asesorias_180.modulos_mobile IS 'Subset de modulos visibles en PWA movil. NULL = usar modulos completo';
