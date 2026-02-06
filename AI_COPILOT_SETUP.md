# 🤖 CONTENDO - Asistente IA de APP180

## ¿Qué es CONTENDO?

Un asistente inteligente integrado en tu aplicación que puede:
- 📊 Consultar facturas y estadísticas de facturación
- 👥 Ver información de empleados y clientes
- 💰 Listar trabajos pendientes de facturar
- 📈 Analizar datos de tu negocio
- 💬 Responder preguntas en lenguaje natural

## Configuración (100% GRATIS)

### 1. Obtener API Key de Groq

Groq es **completamente gratuito** y ultra-rápido (hasta 14,400 requests/día).

1. Ve a [https://console.groq.com](https://console.groq.com)
2. Crea una cuenta (NO requiere tarjeta de crédito)
3. Ve a "API Keys" en el menú lateral
4. Haz clic en "Create API Key"
5. Copia la clave (empieza con `gsk_...`)

### 2. Configurar en el Backend

Agrega la API key a tu archivo `.env`:

```bash
# AI Copilot (Groq)
GROQ_API_KEY=gsk_tu_clave_aqui
```

### 3. Reiniciar el Backend

```bash
cd backend
npm start
```

### 4. ¡Listo!

El bot flotante aparecerá en la esquina inferior derecha del panel de admin.

## Límites del Plan Gratuito

- **14,400 requests/día** (más que suficiente para uso normal)
- **Modelo**: Llama 3.3 70B (excelente calidad)
- **Velocidad**: Ultra-rápido (tokens/segundo muy alto)
- **Sin límite de tiempo**: Gratis forever

## Herramientas Disponibles

El agente puede ejecutar estas acciones:

1. **consultar_facturas** - Obtiene facturas filtradas por estado/cliente
2. **consultar_empleados** - Lista empleados activos/inactivos
3. **consultar_clientes** - Lista clientes de la empresa
4. **estadisticas_facturacion** - Análisis de facturación por período
5. **trabajos_pendientes_facturar** - Trabajos completados sin facturar

## Ejemplos de Preguntas

- "¿Cuánto hemos facturado este mes?"
- "¿Cuántas facturas tengo pendientes de cobro?"
- "Muéstrame los trabajos sin facturar"
- "¿Qué clientes tengo activos?"
- "Dame estadísticas del mes pasado"

## Troubleshooting

### El bot no responde
- Verifica que `GROQ_API_KEY` esté en el `.env`
- Revisa los logs del backend para errores
- Comprueba que la API key sea válida

### Error "API key inválida"
- Regenera la API key en console.groq.com
- Asegúrate de copiar la clave completa

### Error "Límite excedido"
- El plan gratuito tiene 14,400 requests/día
- Espera hasta el siguiente día o considera usar Claude Haiku (también tiene tier gratuito)

## Alternativas de Modelos

Si quieres cambiar de modelo, edita `backend/src/services/aiAgentService.js`:

### Opción 1: Claude Haiku (Anthropic)
```bash
npm install @anthropic-ai/sdk
```
```env
ANTHROPIC_API_KEY=sk-ant-...
```

### Opción 2: GPT-4o Mini (OpenAI)
```bash
npm install openai
```
```env
OPENAI_API_KEY=sk-...
```

### Opción 3: Gemini Flash (Google)
```bash
npm install @google/generative-ai
```
```env
GOOGLE_API_KEY=...
```

## Arquitectura

```
Frontend (app180-frontend)
  └─ components/shared/AICopilot.tsx
       ↓ POST /admin/ai/chat
Backend (backend)
  ├─ routes/aiRoutes.js
  ├─ controllers/aiController.js
  └─ services/aiAgentService.js
       ↓ Groq API (Llama 3.3 70B)
       ↓ Ejecuta herramientas
       └─ Consultas a PostgreSQL
```

## Seguridad

- Solo usuarios autenticados (admin) pueden usar el agente
- El agente solo tiene acceso READ a la base de datos
- Todas las consultas incluyen filtro por `empresa_id`
- Los datos del usuario nunca se envían a terceros (solo el contexto necesario)

## Modo "Offline" / Cerebro de Respaldo

Si el servicio de IA (Groq/Gemini) falla por cuotas o errores de conexión, **CONTENDO NO dejará de responder**.

- Se activa automáticamente el **Cerebro de Respaldo** (Base de Datos Local).
- Responde a preguntas comunes (saludos, ayuda, facturas pendientes, calendario) sin consumir tokens API.
- **Entrenamiento:** Puedes añadir nuevas respuestas ejecutando:
  ```bash
  node scripts/add_knowledge.js "concepto clave" "Respuesta que debe dar el bot"
  ```

## Soporte

Si tienes problemas:
1. Revisa los logs del backend
2. Verifica la configuración del `.env`
3. Abre un issue en GitHub con los logs de error

---

**Hecho con ❤️ para APP180**
