-- Migración: Añadir módulo 'contable' a empresa_config_180
-- Separa contabilidad de facturación como módulo independiente

-- 1. Renombrar 'contabilidad' → 'contable' donde exista (asesorías)
UPDATE empresa_config_180
SET modulos = modulos - 'contabilidad' || jsonb_build_object('contable', modulos->'contabilidad')
WHERE modulos ? 'contabilidad';

-- 2. Empresas con facturacion=true → darles contable=true (preservar acceso existente)
UPDATE empresa_config_180
SET modulos = modulos || '{"contable": true}'::jsonb
WHERE (modulos->>'facturacion')::boolean = true
  AND NOT (modulos ? 'contable');

-- 3. Resto → contable: false
UPDATE empresa_config_180
SET modulos = modulos || '{"contable": false}'::jsonb
WHERE NOT (modulos ? 'contable');

-- 4. Hacer lo mismo para modulos_mobile si tiene datos
UPDATE empresa_config_180
SET modulos_mobile = modulos_mobile - 'contabilidad' || jsonb_build_object('contable', modulos_mobile->'contabilidad')
WHERE modulos_mobile IS NOT NULL AND modulos_mobile ? 'contabilidad';

UPDATE empresa_config_180
SET modulos_mobile = modulos_mobile || '{"contable": true}'::jsonb
WHERE modulos_mobile IS NOT NULL
  AND (modulos_mobile->>'facturacion')::boolean = true
  AND NOT (modulos_mobile ? 'contable');

UPDATE empresa_config_180
SET modulos_mobile = modulos_mobile || '{"contable": false}'::jsonb
WHERE modulos_mobile IS NOT NULL
  AND NOT (modulos_mobile ? 'contable');
