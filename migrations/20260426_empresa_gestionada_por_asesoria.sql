-- 20260426_empresa_gestionada_por_asesoria.sql
-- Permite que una asesoría cree y gestione empresas (clientes) que NO tienen CONTENDO instalado.
-- La empresa existe en empresa_180 sin user_id (no hay usuario humano que se loguee), y la
-- asesoría accede via asesoria_clientes_180 con permisos completos.

-- 1) Permitir empresa_180.user_id NULL (si era NOT NULL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'empresa_180'
      AND column_name = 'user_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE empresa_180 ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- 2) Nueva columna: si no es NULL, esta empresa es "gestionada por asesoría" (cliente sin app)
ALTER TABLE empresa_180
  ADD COLUMN IF NOT EXISTS gestionada_por_asesoria_id uuid REFERENCES asesorias_180(id) ON DELETE SET NULL;

COMMENT ON COLUMN empresa_180.gestionada_por_asesoria_id IS
  'Si no es NULL: la empresa es un cliente gestionado por una asesoría sin que tenga la app instalada (no hay user_id propio).';

CREATE INDEX IF NOT EXISTS idx_empresa_180_gestionada_por_asesoria
  ON empresa_180 (gestionada_por_asesoria_id) WHERE gestionada_por_asesoria_id IS NOT NULL;

-- 3) RLS: las empresas gestionadas son accesibles por usuarios de la asesoría que las gestiona.
-- Asumimos política existente. Añadimos política específica para asesores sobre sus empresas gestionadas.
-- (Si la app usa contendo_app role, la lógica de permisos vive en backend; este SQL solo añade columna.)
