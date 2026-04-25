-- RLS Phase 0: dedicated app role with no BYPASSRLS.
-- Created with NOLOGIN to keep the role unusable until the operator
-- explicitly grants LOGIN and a password (kept outside version control).
--
-- After running this migration, an operator runs ONCE, manually:
--   ALTER ROLE contendo_app WITH LOGIN PASSWORD '<strong-random>';
-- Then updates SUPABASE_URL in .env to use this role and restarts the app.
--
-- Default privileges: en Supabase la connection actual no siempre puede
-- ejecutar `ALTER DEFAULT PRIVILEGES FOR ROLE <otro>`. Aplicamos defaults
-- sólo para el rol actual (sin cláusula FOR ROLE). Tablas creadas por
-- migraciones futuras desde la misma connection heredarán los permisos
-- hacia contendo_app automáticamente. Si en el futuro otra entidad crea
-- tablas con otro rol, esa migración deberá hacer GRANT explícito.
--
-- See backend/docs/RLS_DESIGN.md for the full rollout plan.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contendo_app') THEN
        CREATE ROLE contendo_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END $$;

-- Connect/usage
GRANT USAGE ON SCHEMA public TO contendo_app;

-- Existing tables and sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO contendo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO contendo_app;

-- Future tables/sequences created by the current connection role
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO contendo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO contendo_app;
