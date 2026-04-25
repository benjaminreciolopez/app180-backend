-- Sprint 4 hotfix: el advisor de Supabase avisaba de que schema_migrations_180
-- tenía RLS activo sin policies (era deny-by-default deliberado). Para evitar
-- la confusión, ahora revocamos GRANT a los roles aplicativos y desactivamos
-- RLS. Solo postgres/service_role acceden, que bypasean RLS de todas formas.

REVOKE ALL ON public.schema_migrations_180 FROM anon;
REVOKE ALL ON public.schema_migrations_180 FROM authenticated;
REVOKE ALL ON public.schema_migrations_180 FROM contendo_app;

ALTER TABLE public.schema_migrations_180 DISABLE ROW LEVEL SECURITY;
