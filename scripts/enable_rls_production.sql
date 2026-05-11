-- =============================================================
-- ACTIVAR RLS EN PRODUCCIÓN — script operativo
-- =============================================================
-- Ejecutar en Supabase Studio → SQL Editor, como rol "postgres"
-- (el de la sesión web, que sí tiene CREATEROLE).
--
-- Prereq: las migraciones 20260425_01..04 ya están aplicadas.
-- El rol contendo_app existe pero está NOLOGIN.
--
-- PASOS:
--   1) Verificar que RLS está habilitada en las tablas tenant.
--   2) Asignar password al rol contendo_app y darle LOGIN.
--   3) Probar conexión con el nuevo rol desde psql / cliente.
--   4) Actualizar SUPABASE_URL en .env (local) y en Render (prod).
--   5) Añadir RLS_TENANT_CONTEXT_ENABLED=true.
--   6) Reiniciar backend. Probar /auth/me, leer una factura, listar empleados.
--   7) Si algo se rompe: rollback = volver al user "postgres" + RLS_TENANT_CONTEXT_ENABLED=false.
-- =============================================================

-- 1) Sanity check: ¿RLS activa en tablas críticas?
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'factura_180', 'lineafactura_180', 'clients_180', 'employees_180',
    'purchases_180', 'asientos_180', 'empresa_config_180', 'nominas_180',
    'titulares_180', 'certificados_digitales_180'
  )
ORDER BY tablename;
-- Esperado: rowsecurity = true en todas.
-- Si alguna está false → falta correr migraciones 20260425_02..04 y 14, 16.

-- 2) Existen las policies por tabla
SELECT tablename, COUNT(*) AS n_policies
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
-- Esperado: 4 policies por tabla tenant (SELECT/INSERT/UPDATE/DELETE).

-- 3) Asignar password fuerte al rol contendo_app y darle LOGIN.
--    Genera uno con: node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
--    Sustituye <PASSWORD_FUERTE> por el resultado:

ALTER ROLE contendo_app WITH LOGIN PASSWORD '<PASSWORD_FUERTE>';

-- 4) Verificar que NO tiene BYPASSRLS ni SUPERUSER:
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname = 'contendo_app';
-- Esperado: rolsuper=f, rolbypassrls=f, rolcanlogin=t.

-- 5) Confirmar que contendo_app puede leer/escribir las tablas (grants):
SELECT grantee, privilege_type, COUNT(*) AS n_tables
FROM information_schema.role_table_grants
WHERE grantee = 'contendo_app'
  AND table_schema = 'public'
GROUP BY grantee, privilege_type
ORDER BY privilege_type;
-- Esperado: SELECT, INSERT, UPDATE, DELETE cada una sobre muchas tablas (~100+).

-- =============================================================
-- DESPUÉS DE EJECUTAR EL SCRIPT:
-- =============================================================
-- En .env (local) y en Render (producción), cambiar:
--
--   SUPABASE_URL=postgresql://contendo_app:<PASSWORD_FUERTE>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
--   RLS_TENANT_CONTEXT_ENABLED=true
--
-- Reiniciar backend. Si /auth/login funciona y se ven datos → OK.
-- Si error "permission denied for table X" → falta GRANT en esa tabla:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.X TO contendo_app;
--
-- Si error "new row violates row-level security policy" en INSERTs →
-- falta que tenantContext esté pasando set_config('app.empresa_id', ...).
-- Revisar logs del middleware tenantContext.
-- =============================================================
