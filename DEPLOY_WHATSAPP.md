# Deploy WhatsApp Integration en Render (desde Backend)

## 📋 Resumen

Como ya tienes el backend desplegado en Render con plan Starter, solo necesitas hacer commit del archivo `render.yaml` y Render detectará automáticamente los 2 nuevos servicios: Evolution API y n8n.

## 🚀 Paso 1: Hacer commit y push

```bash
# Desde la carpeta backend
cd c:/Users/benja/Desktop/app180/backend

# Agregar render.yaml
git add render.yaml DEPLOY_WHATSAPP.md

# Commit
git commit -m "feat: add Evolution API and n8n for WhatsApp integration"

# Push
git push origin main
```

## ✅ Paso 2: Generar API Keys

Antes de aprobar en Render, genera las API keys necesarias:

```bash
# Evolution API Key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# n8n Encryption Key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Guarda estos valores**, los necesitarás en el siguiente paso.

## ✅ Paso 3: Verificar y Configurar en Render

1. **Ir a tu Dashboard de Render**: https://dashboard.render.com/

2. **Render detectará automáticamente** el nuevo `render.yaml`

3. **Verás 2 nuevos servicios pendientes de aprobación**:
   - `app180-evolution-api` (Evolution API)
   - `app180-n8n` (n8n)

4. **Antes de hacer "Apply"**, configura las variables de entorno sensibles:
   - Click en cada servicio → Environment
   - Configurar las API keys que generaste arriba
   - `AUTHENTICATION_API_KEY` en Evolution API
   - `EVOLUTION_API_KEY` en n8n (mismo valor que AUTHENTICATION_API_KEY)
   - `N8N_ENCRYPTION_KEY` en n8n
   - `WHATSAPP_WEBHOOK_API_KEY` en n8n (copiar del backend)
   - `GROQ_API_KEY` en n8n (obtener de https://console.groq.com)

5. **Click en "Apply"** para crear los servicios

6. **Esperar ~5-10 minutos** mientras Render despliega:
   - Descarga las imágenes Docker
   - Crea los discos persistentes (2x $1/mes)
   - Inicia los servicios

## 💰 Costos adicionales

| Item | Costo |
|------|-------|
| Evolution API (Starter plan) | Incluido en tu plan actual* |
| Evolution API Disk (1GB) | **$1/mes** |
| n8n (Starter plan) | Incluido en tu plan actual* |
| n8n Disk (1GB) | **$1/mes** |
| **TOTAL ADICIONAL** | **$2/mes** |

\* Asumiendo que tienes horas suficientes en tu plan Starter. Si no, puede que necesites actualizar el plan o poner n8n en free tier.

## 🔧 Paso 4: Configurar URLs después del deploy

Una vez desplegados, Render te dará URLs automáticas. **IMPORTANTE**: Debes actualizar estas variables de entorno:

### En `app180-evolution-api`:

1. Dashboard → app180-evolution-api → Environment
2. Buscar `WEBHOOK_GLOBAL_URL`
3. Cambiar a: `https://app180-n8n.onrender.com/webhook/evolution`
4. Click **"Save Changes"**

### En `app180-n8n`:

1. Dashboard → app180-n8n → Environment
2. Buscar `EVOLUTION_API_URL`
3. Cambiar a: `https://app180-evolution-api.onrender.com`
4. Buscar `APP180_BACKEND_URL`
5. Verificar que apunte a tu backend real (ej: `https://app180-backend.onrender.com`)
6. Click **"Save Changes"**

## 📱 Paso 5: Conectar WhatsApp

1. **Abrir Evolution API Manager**:
   ```
   https://app180-evolution-api.onrender.com/manager
   ```

2. **Crear instancia**:
   - Click **"Create Instance"**
   - **Instance Name**: `app180`
   - **API Key**: Usar la misma que configuraste en `AUTHENTICATION_API_KEY` en Render
   - Click **"Create"**

3. **Escanear QR**:
   - Abre WhatsApp en tu teléfono
   - **Configuración** → **Dispositivos vinculados** → **Vincular un dispositivo**
   - Escanea el código QR
   - Espera la confirmación ✅

## 🤖 Paso 6: Configurar n8n

1. **Abrir n8n**:
   ```
   https://app180-n8n.onrender.com/
   ```

2. **Crear cuenta** (primera vez):
   - Email y contraseña
   - Click **"Sign up"**

3. **Importar workflow**:
   - Click **"Workflows"** → **"Import from File"**
   - Seleccionar: `docs/n8n-whatsapp-evolution-workflow.json`
   - Click **"Import"**

4. **Configurar credenciales**:

   **Evolution API Auth:**
   - Nodo "Evolution Webhook" → Credentials → Create New
   - Type: Header Auth
   - Name: `Evolution API Auth`
   - Header Name: `apikey`
   - Header Value: Usar la misma que `EVOLUTION_API_KEY` de las variables de entorno
   - Save

   **Groq API:**
   - Nodo "Groq Whisper" → Credentials → Create New
   - Type: HTTP Header Auth
   - Name: `Groq API`
   - Header Name: `Authorization`
   - Header Value: `Bearer [TU_GROQ_API_KEY]` (obtener de https://console.groq.com)
   - Save

5. **Activar workflow**:
   - Toggle **"Active"** (arriba derecha)

## 👤 Paso 7: Configurar tu teléfono en APP180

1. Login en https://app180-frontend.vercel.app
2. **Perfil** → **Teléfono**
3. Agregar tu número: `+34612345678` (con prefijo de país)
4. **Guardar**

## 🧪 Paso 8: Probar

Envía un WhatsApp a tu número conectado:

```
Hola CONTENDO, muéstrame las facturas pendientes
```

Deberías recibir respuesta del agente con las facturas.

## 🔍 Ver logs

**En Render Dashboard:**
- Evolution API: Dashboard → app180-evolution-api → Logs
- n8n: Dashboard → app180-n8n → Logs
- Backend: Dashboard → app180-backend → Logs

**Ejecuciones de n8n:**
- https://app180-n8n.onrender.com/executions

## ⚙️ Variables de entorno importantes

Si necesitas ajustar alguna variable después del deploy:

### Backend (`app180-backend`)
- Las que ya tienes configuradas (DATABASE_URL, JWT_SECRET, etc.)

### Evolution API (`app180-evolution-api`)
- `AUTHENTICATION_API_KEY`: Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `WEBHOOK_GLOBAL_URL`: URL de n8n + `/webhook/evolution`

### n8n (`app180-n8n`)
- `N8N_ENCRYPTION_KEY`: Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `APP180_BACKEND_URL`: URL de tu backend
- `EVOLUTION_API_URL`: URL de Evolution API
- `EVOLUTION_API_KEY`: Misma que `AUTHENTICATION_API_KEY` de Evolution
- `WHATSAPP_WEBHOOK_API_KEY`: Copiar del backend (variable con mismo nombre)
- `GROQ_API_KEY`: Obtener de https://console.groq.com

## 🆘 Troubleshooting

### Los servicios nuevos no aparecen en Render
- Verificar que `render.yaml` esté en la raíz del repositorio del backend
- Verificar que el push se hizo correctamente: `git log -1`

### Evolution API pierde la sesión de WhatsApp
- Verificar que el disco esté montado correctamente
- Dashboard → app180-evolution-api → Disk → Verificar estado

### n8n no recibe mensajes
- Verificar que el workflow esté **Active** (toggle verde)
- Verificar webhook en Evolution API: Dashboard → evolution → Environment → `WEBHOOK_GLOBAL_URL`
- Ver logs: Dashboard → app180-n8n → Logs

### Mensajes no llegan a CONTENDO
- Verificar `WHATSAPP_WEBHOOK_API_KEY` en n8n
- Ver logs del backend: Dashboard → app180-backend → Logs
- Verificar que el teléfono esté en `perfil_180` en Supabase

---

**¿Problemas?** Revisa los logs en Render o consulta la [guía completa](../docs/WHATSAPP_RENDER_SETUP.md).
