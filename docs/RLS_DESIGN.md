# RLS (Row-Level Security) — diseño propuesto

**Estado:** propuesta para revisión, no aplicado.
**Por qué:** las políticas RLS actuales (en `enable_plantilla_rls.sql` y el hotfix de `app.js`) usan `auth.uid()`, que es una función del esquema `auth` de Supabase y solo funciona cuando la conexión llega vía PostgREST con un JWT pasado en el header. El backend conecta con la librería `postgres` directa usando la connection string de `SUPABASE_URL`, así que **`auth.uid()` siempre es `NULL`** y las políticas no protegen nada.

---

## Decisión arquitectónica

**Opción A (elegida):** rol Postgres dedicado sin `BYPASSRLS` + `current_setting('app.empresa_id')` en políticas + reserva de conexión por request.

**Opción B (descartada):** migrar todo el backend a `@supabase/supabase-js` con JWT por request. Refactor masivo (cientos de queries), no realista en sprint corto.

---

## Cambios requeridos

### 1. Rol Postgres dedicado

```sql
-- Nuevo rol con permisos limitados, NO bypassrls
CREATE ROLE contendo_app WITH LOGIN PASSWORD '<env>' NOSUPERUSER NOBYPASSRLS;

-- Permisos: SELECT/INSERT/UPDATE/DELETE en tablas de la app
GRANT USAGE ON SCHEMA public TO contendo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO contendo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO contendo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO contendo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO contendo_app;
```

La connection string en `.env` (`SUPABASE_URL`) cambia para usar este rol en lugar del superuser.

### 2. Reserva de conexión + `set_config` por request, vía AsyncLocalStorage

`postgres.js` reusa conexiones de pool, así que un `SET` en una conexión sería visible para otro request que reutilice la misma conexión. Solución: **reservar la conexión durante todo el request** y publicarla en un `AsyncLocalStorage` que el `sql` exportado por `db.js` consulta automáticamente.

`db.js` (resumen):

```js
import { AsyncLocalStorage } from 'node:async_hooks';
export const poolSql = postgres(...);                  // pool bruto
export const tenantStorage = new AsyncLocalStorage();  // conexión del request

// Proxy callable: delega a la conexión reservada del request si existe,
// si no, al pool. Tagged templates y métodos (begin, unsafe, ...) funcionan igual.
export const sql = new Proxy(function(){}, {
  apply: (_t, _self, args) => (tenantStorage.getStore() || poolSql)(...args),
  get:   (_t, prop) => {
    const target = tenantStorage.getStore() || poolSql;
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
```

Middleware `tenantContext.js`:

```js
import { poolSql, tenantStorage } from '../db.js';

export async function tenantContext(req, res, next) {
  if (!req.user?.empresa_id) return next();
  const reserved = await poolSql.reserve();
  await reserved`SELECT set_config('app.empresa_id', ${String(req.user.empresa_id)}, false)`;
  await reserved`SELECT set_config('app.role', ${req.user.role || 'admin'}, false)`;
  res.on('finish', () => reserved.release());
  res.on('close',  () => reserved.release());
  tenantStorage.run(reserved, () => next());
}
```

Aplicar después de `authRequired` (montado vía array en `authRequired.js`).

### 3. Controllers — sin cambios

Con el patrón ALS, cualquier `import { sql } from '../db.js'` existente queda tenant-aware automáticamente: dentro de un request con contexto, las queries usan la conexión reservada; fuera de él (jobs cron, scripts, healthchecks) caen al pool. **Cero migraciones de controllers**.

Casos que sí necesitan `poolSql` directamente: jobs cron, migraciones (`migrate.js`) y scripts de mantenimiento que no deben filtrar por empresa.

### 4. Políticas RLS por tabla

Patrón estándar para tabla con `empresa_id`:

```sql
ALTER TABLE factura_180 ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_factura_select ON factura_180
  FOR SELECT TO contendo_app
  USING (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_factura_insert ON factura_180
  FOR INSERT TO contendo_app
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_factura_update ON factura_180
  FOR UPDATE TO contendo_app
  USING (empresa_id::text = current_setting('app.empresa_id', true))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_factura_delete ON factura_180
  FOR DELETE TO contendo_app
  USING (empresa_id::text = current_setting('app.empresa_id', true));
```

`current_setting(_, true)` con segundo arg `true` devuelve NULL si no está seteado en lugar de error — protege rutas auth/kiosk antes de tenantContext.

---

## Tablas que necesitan RLS

Críticas (datos fiscales/financieros):
- `factura_180`
- `lineafactura_180`
- `proforma_180`
- `asientos_180`
- `lineas_asiento_180`
- `compras_180`
- `lineas_compra_180`
- `registroverifactu_180`
- `registroverifactueventos_180`
- `eventos_sistema_verifactu_180`
- `cuentas_contables_180`
- `modelos_anuales_180`
- `cierre_ejercicio_180`
- `nominas_180`
- `nomina_lineas_180`

Importantes (datos de gestión):
- `clients_180`
- `employees_180`
- `partes_dia_180`
- `worklogs_180`
- `ausencias_180`
- `calendario_180`
- `centros_trabajo_180`
- `titulares_180`
- `certificados_digitales_180`

Especiales (asesoría — políticas distintas, no `empresa_id` directo sino `asesoria_id` o relación):
- `asesoria_clientes_180` — política basada en `asesoria_id = current_setting('app.asesoria_id')`
- `asesoria_usuarios_180` — idem
- `asesoria_documentos_180` — idem
- `asesoria_mensajes_180` — idem
- `asesoria_invitaciones_180` — idem

Sin RLS (compartidas / sin tenant):
- `users_180` (acceso por id propio)
- `audit_log_180` (escritura, no lectura cruzada)
- `qr_sessions_180` (TTL corto, sin datos sensibles)

---

## Estimación

| Trabajo | Tiempo |
|---|---|
| Crear rol + grants | 1 día |
| Implementar middleware `tenantContext` + ALS proxy en `db.js` + tests | 1 día |
| Migración con ENABLE RLS + políticas para 30+ tablas | 2 días |
| Testing E2E completo (cada modo: admin, asesor con X-Empresa-Id, asesor propio, empleado, kiosko) | 2-3 días |
| **Total bloqueante para release** | **5-6 días** |

---

## Plan de despliegue (por fases)

1. **Fase 0 (esta PR)**: añadir migración con creación del rol + grants + tabla schema_migrations bootstrap. NO ENABLE RLS todavía.
2. **Fase 1**: añadir middleware `tenantContext`, montarlo en rutas pero sin que controllers lo usen. Verificar que no rompe nada.
3. **Fase 2**: migrar controllers de factura+verifactu+asientos+cierre a `req.sql`. Aplicar RLS solo en tablas tocadas por estos controllers.
4. **Fase 3**: ENABLE RLS en tablas restantes una a una, después de migrar sus controllers.
5. **Fase 4**: cambiar connection string en producción al rol `contendo_app`. **Punto sin retorno** — si el frontend se rompe aquí, hay que rollback de DB.

---

## Riesgos y mitigaciones

- **Riesgo:** un controller no migrado escribe sin contexto y la query falla con "row violates row-level security policy" después de Fase 4. Mitigación: la connection string superuser sigue disponible en otra env var (`SUPABASE_URL_ADMIN`) para scripts de migración y emergencias.
- **Riesgo:** jobs cron (autocierre, alertas) no tienen request context. Mitigación: jobs usan conexión superuser (con bypass) explícitamente y son auditados.
- **Riesgo:** `sql.reserve()` agota el pool si el frontend abre muchas conexiones simultáneas. Mitigación: aumentar `max` en `db.js` y monitorizar.

---

## Lo que NO hace este diseño

- No cubre asesores cross-cliente (asesor viendo dashboard agregado de 50 clientes). Para eso, el asesor necesita un rol distinto que pueda ver varias `empresa_id`. Pendiente de decisión: ¿usar `asesoria_id` en `app.asesoria_id` con políticas que aceptan o `empresa_id IN (asesoria_clientes_180.empresa_id)` o multi-context?
- No protege contra timing attacks ni inferencia. RLS oculta filas, pero un atacante con acceso de un tenant podría inferir existencia de filas de otro tenant si las políticas son demasiado permisivas. Aceptable para v1.

---

## Próximo paso

Si apruebas este diseño:
1. Creo `migrations/20260425_rls_role_and_grants.sql` con el rol + permisos.
2. Creo `middlewares/tenantContext.js` y lo monto **detrás de un feature flag** en `app.js`.
3. Migración de muestra `migrations/20260425_rls_factura_180.sql` para que veas el patrón completo aplicado a una tabla.

Sin tu aprobación no toco la base de datos ni los controllers.
