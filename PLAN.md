# PLAN: Reset Completo + Onboarding SaaS con Google + Modulos/Widgets

## Resumen

Transformar APP180 de app manual (setup con formulario) a **SaaS con "Sign up with Google"**,
donde el admin se registra con 1 click, se le configura TODO automáticamente (Calendar + Gmail),
y puede elegir qué módulos y widgets tener en su dashboard.

---

## FASE 1: Reset de la Base de Datos (TRUNCATE tablas _180)

**Objetivo**: Dejar la DB limpia para empezar de cero.

### Archivo: `backend/migrations/reset_all_tables.sql`

```sql
-- Truncar todas las tablas en orden correcto (respetando FK)
TRUNCATE TABLE calendar_event_mapping_180 CASCADE;
TRUNCATE TABLE calendar_sync_log_180 CASCADE;
TRUNCATE TABLE calendar_webhook_180 CASCADE;
TRUNCATE TABLE empresa_calendar_config_180 CASCADE;
TRUNCATE TABLE empresa_email_config_180 CASCADE;
TRUNCATE TABLE contendo_memory_180 CASCADE;
TRUNCATE TABLE audit_log_180 CASCADE;
TRUNCATE TABLE envios_email_180 CASCADE;
TRUNCATE TABLE registroverifactu_180 CASCADE;
TRUNCATE TABLE lineafactura_180 CASCADE;
TRUNCATE TABLE factura_180 CASCADE;
TRUNCATE TABLE auditoria_180 CASCADE;
TRUNCATE TABLE concepto_180 CASCADE;
TRUNCATE TABLE iva_180 CASCADE;
TRUNCATE TABLE emisor_180 CASCADE;
TRUNCATE TABLE configuracionsistema_180 CASCADE;
TRUNCATE TABLE work_logs_180 CASCADE;
TRUNCATE TABLE employee_daily_report_180 CASCADE;
TRUNCATE TABLE fichajes_180 CASCADE;
TRUNCATE TABLE ausencias_adjuntos_180 CASCADE;
TRUNCATE TABLE ausencias_180 CASCADE;
TRUNCATE TABLE plantilla_bloques_180 CASCADE;
TRUNCATE TABLE plantilla_dias_180 CASCADE;
TRUNCATE TABLE empleado_plantillas_180 CASCADE;
TRUNCATE TABLE turnos_180 CASCADE;
TRUNCATE TABLE calendario_empresa_180 CASCADE;
TRUNCATE TABLE invite_180 CASCADE;
TRUNCATE TABLE employee_devices_180 CASCADE;
TRUNCATE TABLE client_tariffs_180 CASCADE;
TRUNCATE TABLE clients_180 CASCADE;
TRUNCATE TABLE storage_180 CASCADE;
TRUNCATE TABLE perfil_180 CASCADE;
TRUNCATE TABLE employees_180 CASCADE;
TRUNCATE TABLE empresa_config_180 CASCADE;
TRUNCATE TABLE empresa_180 CASCADE;
TRUNCATE TABLE users_180 CASCADE;
```

**Nota**: NO borramos `festivos_es_180` porque son datos de referencia.

---

## FASE 2: Migración DB - Añadir campo google_id a users_180

### Archivo: `backend/migrations/add_google_auth.sql`

```sql
-- Campos para Google Sign-In
ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- Hacer password nullable (usuarios que solo usan Google no necesitan password)
ALTER TABLE users_180 ALTER COLUMN password DROP NOT NULL;
```

---

## FASE 3: Backend - Registro/Login con Google OAuth2

### 3.1 Nuevo endpoint: `POST /auth/google/signup-login`

**Archivo**: `backend/src/controllers/authController.js` (modificar)

Flujo:
1. Frontend envía `{ credential }` (Google ID Token del botón "Sign in with Google")
2. Backend verifica el ID Token con la librería de Google
3. Extrae: google_id, email, nombre, avatar_url
4. **Si google_id ya existe en users_180** → LOGIN (retorna JWT)
5. **Si no existe** → SIGNUP:
   - Crea user en `users_180` (password = null, role = 'admin', google_id = xxx)
   - Crea empresa en `empresa_180` (nombre = email domain o nombre del usuario)
   - Crea `empresa_config_180` con módulos por defecto
   - Retorna JWT + flag `is_new_user: true`

### 3.2 Nuevo endpoint: `POST /auth/google/complete-setup`

**Archivo**: `backend/src/controllers/authController.js` (modificar)

Flujo (se llama después del signup, en la pantalla de onboarding):
1. Recibe `{ empresa_nombre }` (opcional, el admin puede renombrar)
2. Recibe consentimiento para solicitar scopes de Calendar + Gmail
3. Retorna URL de OAuth2 con scopes completos:
   - `userinfo.email`
   - `userinfo.profile`
   - `calendar`
   - `gmail.send` (para envío de facturas)
4. El callback de OAuth2 guardará los tokens en:
   - `empresa_calendar_config_180` → Calendar config
   - `empresa_email_config_180` → Gmail config
5. Ambos se guardan con una sola autorización (un solo popup de Google)

### 3.3 Callback unificado: `GET /auth/google/unified-callback`

**Archivo**: `backend/src/controllers/authController.js` (modificar)

Flujo:
1. Recibe code + state de Google OAuth2
2. Del state, extrae: userId, empresaId, type='setup'
3. Intercambia code por tokens
4. Guarda refresh_token ENCRIPTADO en:
   - `empresa_calendar_config_180` (para Calendar sync)
   - `empresa_email_config_180` (para Gmail send)
5. Ambos con la misma cuenta de Google
6. Retorna HTML de éxito + window.close()

### 3.4 Rutas nuevas

**Archivo**: `backend/src/routes/authRoutes.js` (modificar)

```
POST /auth/google           → signup/login con Google ID Token
POST /auth/google/complete-setup → solicita scopes Calendar+Gmail
GET  /auth/google/unified-callback → callback que configura todo
```

---

## FASE 4: Frontend - Nuevo Flujo de Registro/Login

### 4.1 Botón "Sign in with Google"

**Archivo**: `app180-frontend/app/login/LoginClient.tsx` (modificar)

- Añadir `<script src="https://accounts.google.com/gsi/client">` en layout
- Añadir botón "Sign in with Google" usando Google Identity Services
- Al recibir credential → POST /auth/google
- Si `is_new_user: true` → redirigir a /onboarding
- Si usuario existente → redirigir a /admin/dashboard

### 4.2 Página /setup (reemplazar)

**Archivo**: `app180-frontend/app/setup/page.tsx` (reemplazar completamente)

Antes: formulario manual con email+password+nombre+empresa
Ahora: Solo botón "Sign in with Google" + opción email/password

### 4.3 Nueva página de Onboarding `/onboarding`

**Archivo**: `app180-frontend/app/onboarding/page.tsx` (NUEVO)

Pantalla de bienvenida post-registro con 3 pasos:

**Paso 1**: "Nombre de tu empresa" (input text, pre-rellenado con dominio del email)
**Paso 2**: "Conectar servicios" - Botón para autorizar Calendar + Gmail juntos
**Paso 3**: "Elige tus módulos" - Checkboxes de módulos disponibles:
  - Fichajes (default ON)
  - Empleados (default ON)
  - Calendario (default ON)
  - Facturación (default OFF)
  - Cobros/Pagos (default OFF)
  - Trabajos/Partes (default OFF)

Al completar → redirigir a /admin/dashboard

### 4.4 Pantalla de Dashboard con Widgets configurables

**Archivo**: `app180-frontend/app/admin/dashboard/page.tsx` (modificar)

Sistema de widgets drag-and-drop (simplificado):
- Grid de widgets 2x2 o 3x2
- El admin puede:
  - Mostrar/Ocultar widgets
  - Reordenar (simple up/down, no drag-and-drop complejo)
- Widgets disponibles (según módulos activos):
  - KPI: Empleados activos
  - KPI: Fichajes hoy
  - KPI: Sospechosos
  - KPI: Calendario
  - KPI: Facturas pendientes
  - KPI: Cobros del mes
  - Chart: Actividad semanal
  - Chart: Distribución fichajes
  - Chart: Top clientes
  - List: Trabajando ahora
  - List: Últimos fichajes
  - List: Próximos eventos calendario
  - AI: Mini chat CONTENDO

Widget config se guarda en `empresa_config_180.dashboard_widgets` (JSONB).

---

## FASE 5: Migración DB - Dashboard widgets

### Archivo: `backend/migrations/add_dashboard_widgets.sql`

```sql
ALTER TABLE empresa_config_180
ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB DEFAULT '[]'::jsonb;
```

---

## FASE 6: Backend - Widget Configuration API

### Archivo: `backend/src/controllers/dashboardController.js` (NUEVO)

```
GET  /admin/dashboard/widgets      → obtener config de widgets
PUT  /admin/dashboard/widgets      → guardar config de widgets
GET  /admin/dashboard/data         → datos de todos los widgets activos
```

---

## Resumen de Archivos a Modificar/Crear

### Modificar:
1. `backend/src/controllers/authController.js` → Google signup/login + unified callback
2. `backend/src/routes/authRoutes.js` → nuevas rutas Google
3. `backend/src/app.js` → registrar nuevo callback
4. `app180-frontend/app/login/LoginClient.tsx` → botón Google
5. `app180-frontend/app/setup/page.tsx` → reemplazar con Google signup
6. `app180-frontend/app/admin/dashboard/page.tsx` → sistema de widgets
7. `app180-frontend/app/admin/layout.tsx` → link a config widgets en settings
8. `app180-frontend/app/layout.tsx` → cargar Google Identity Services script

### Crear:
1. `backend/migrations/reset_all_tables.sql`
2. `backend/migrations/add_google_auth.sql`
3. `backend/migrations/add_dashboard_widgets.sql`
4. `app180-frontend/app/onboarding/page.tsx` → wizard de onboarding
5. `backend/src/controllers/dashboardController.js` → API widgets

---

## Orden de Ejecución

1. **Sprint 1**: Ejecutar reset DB + migraciones (15 min)
2. **Sprint 2**: Backend Google Auth (signup/login + unified callback) (1h)
3. **Sprint 3**: Frontend Google Sign-In + Setup + Onboarding (1.5h)
4. **Sprint 4**: Dashboard con widgets configurables (1.5h)
5. **Sprint 5**: Testing E2E + commit (30 min)

**Total estimado: ~5 horas de implementación**

---

## Dependencias Técnicas

- `google-auth-library` (backend) → para verificar Google ID Token
- Google Identity Services (frontend) → script de Google para el botón
- Las credenciales OAuth2 de Google Cloud Console (CLIENT_ID, CLIENT_SECRET) son las MISMAS que ya se usan para Gmail/Calendar
- `GOOGLE_CLIENT_ID` debe añadirse también como variable de entorno del frontend (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`)

---

## Notas de Seguridad

- Los ID tokens de Google se verifican en el backend (nunca confiar solo en el frontend)
- Los refresh tokens se encriptan con AES-256-CBC (sistema existente)
- El password es nullable para usuarios que solo usan Google (no se puede hacer login manual sin password)
- Se mantiene la opción de login con email+password para compatibilidad
