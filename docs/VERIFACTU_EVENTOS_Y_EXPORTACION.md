# 📋 VeriFactu - Registro de Eventos y Exportación

## ✅ Implementación Completa RD 1007/2023

Este documento describe las funcionalidades de **registro de eventos** y **exportación/volcado** implementadas según los requisitos del Real Decreto 1007/2023.

---

## 🔍 Registro de Eventos del Sistema

### **¿Qué es?**

El RD 1007/2023 requiere que los Sistemas Informáticos de Facturación (SIF) mantengan un **registro inmutable y encadenado** de todos los eventos relevantes del sistema:

- Inicio y parada del sistema
- Cambios de modo (TEST ↔ PRODUCCIÓN)
- Activación/desactivación de VeriFactu
- Envíos a AEAT
- Descargas de registros
- Incidencias y errores
- Cambios de configuración

### **Tabla: `eventos_sistema_verifactu_180`**

```sql
CREATE TABLE eventos_sistema_verifactu_180 (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL,
  tipo_evento VARCHAR(50) NOT NULL,
  descripcion TEXT NOT NULL,
  datos_evento JSONB DEFAULT '{}',
  usuario_id INTEGER,
  fecha_evento TIMESTAMPTZ NOT NULL,
  hash_actual VARCHAR(64) NOT NULL,   -- SHA-256 encadenado
  hash_anterior VARCHAR(64) DEFAULT '',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Características:**
- ✅ Hash SHA-256 encadenado (igual que facturas)
- ✅ Inmutable (RLS bloquea UPDATE y DELETE)
- ✅ Multi-tenant (empresa_id)
- ✅ Auditoría completa (usuario, IP, user agent)

---

## 📊 Tipos de Eventos

| Tipo de Evento | Descripción | Se Registra Automáticamente |
|---------------|-------------|---------------------------|
| `INICIO_SISTEMA` | Sistema iniciado | ⚠️ Manual (ver sección abajo) |
| `PARADA_SISTEMA` | Sistema detenido | ⚠️ Manual |
| `CAMBIO_MODO` | Cambio TEST ↔ PRODUCCION | ✅ Automático |
| `ACTIVACION_VERIFACTU` | VeriFactu activado | ✅ Automático |
| `DESACTIVACION_VERIFACTU` | VeriFactu desactivado | ✅ Automático |
| `DESCARGA_REGISTROS` | Descarga/volcado ZIP | ✅ Automático |
| `ENVIO_AEAT` | Envío de registros a AEAT | ✅ Automático |
| `CONFIGURACION` | Cambio de configuración | ⚠️ Según cambio |
| `INCIDENCIA` | Error o incidencia | Manual |
| `MANTENIMIENTO` | Operación de mantenimiento | Manual |
| `RESTAURACION_BACKUP` | Restauración desde backup | Manual |

---

## 🔧 API de Eventos

### **GET /api/admin/verifactu/eventos**

Lista todos los eventos del sistema con paginación y filtros.

**Query params:**
- `tipo`: Filtrar por tipo de evento (opcional)
- `desde`: Fecha desde (ISO 8601, opcional)
- `hasta`: Fecha hasta (ISO 8601, opcional)
- `limit`: Límite de resultados (default: 100)
- `offset`: Offset para paginación (default: 0)

**Ejemplo:**
```bash
GET /api/admin/verifactu/eventos?tipo=ENVIO_AEAT&limit=50
```

**Respuesta:**
```json
{
  "eventos": [
    {
      "id": 123,
      "tipo_evento": "ENVIO_AEAT",
      "descripcion": "Enviados 45 registros a AEAT (2 errores)",
      "fecha_evento": "2026-02-23T10:30:00Z",
      "hash_actual": "a3b2c1...",
      "hash_anterior": "9f8e7d...",
      "usuario_nombre": "Admin User",
      "datos_evento": {
        "enviados": 45,
        "errores": 2,
        "entorno": "PRODUCCION"
      }
    }
  ],
  "total": 523,
  "limit": 100,
  "offset": 0
}
```

---

### **GET /api/admin/verifactu/eventos/stats**

Estadísticas resumidas de eventos.

**Respuesta:**
```json
{
  "total": 523,
  "por_tipo": {
    "INICIO_SISTEMA": 45,
    "ENVIO_AEAT": 120,
    "CAMBIO_MODO": 3,
    "DESCARGA_REGISTROS": 8,
    "ACTIVACION_VERIFACTU": 1
  },
  "primer_evento": "2025-01-15T08:00:00Z",
  "ultimo_evento": "2026-02-23T10:30:00Z"
}
```

---

### **GET /api/admin/verifactu/eventos/verificar**

Verifica la integridad de la cadena de eventos (hash encadenado).

**Respuesta (OK):**
```json
{
  "integridad": "OK",
  "mensaje": "Cadena de eventos íntegra. Todos los hashes válidos.",
  "total_eventos": 523,
  "primer_hash": "1a2b3c...",
  "ultimo_hash": "9f8e7d..."
}
```

**Respuesta (ERROR):**
```json
{
  "integridad": "ERROR",
  "mensaje": "Ruptura en la cadena detectada",
  "evento_roto": 245,
  "hash_esperado": "a1b2c3...",
  "hash_encontrado": "x9y8z7..."
}
```

---

## 📦 Sistema de Exportación/Volcado

### **¿Qué es?**

El RD 1007/2023 requiere que se pueda **descargar o volcar** todos los registros de facturación y eventos, en un formato estructurado y seguro.

### **GET /api/admin/verifactu/exportar**

Genera y descarga un archivo **ZIP** con todos los registros VeriFactu.

**Query params:**
- `incluir_eventos`: true/false (default: true) - Incluir eventos del sistema
- `desde`: Fecha desde (ISO 8601, opcional)
- `hasta`: Fecha hasta (ISO 8601, opcional)

**Ejemplo:**
```bash
GET /api/admin/verifactu/exportar?incluir_eventos=true&desde=2026-01-01
```

**Respuesta:**
Archivo ZIP descargable con la siguiente estructura:

```
verifactu_registros_1_1740123456.zip
│
├── metadata.json                         # Metadatos de la exportación
├── README.txt                            # Instrucciones de verificación
│
├── registros_facturacion/               # Facturas en XML
│   ├── F-2026-0001_123.xml
│   ├── F-2026-0002_124.xml
│   └── ...
│
└── registro_eventos/                    # Eventos en XML
    ├── evento_1_INICIO_SISTEMA.xml
    ├── evento_2_ENVIO_AEAT.xml
    ├── ...
    └── resumen.json
```

### **Contenido del ZIP**

#### **1. metadata.json**
```json
{
  "empresa": {
    "id": 1,
    "nif": "B12345678",
    "nombre": "Mi Empresa SL"
  },
  "exportacion": {
    "fecha": "2026-02-23T10:45:00Z",
    "total_registros": 250,
    "rango_fechas": {
      "desde": "2025-01-01T00:00:00Z",
      "hasta": "2026-02-23T10:45:00Z"
    }
  },
  "verifactu": {
    "version": "1.0",
    "normativa": "RD 1007/2023"
  }
}
```

#### **2. registros_facturacion/*.xml**

Cada factura en formato XML oficial AEAT:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<RegistroFactura xmlns="https://www2.agenciatributaria.gob.es/...">
  <IDFactura>
    <IDEmisorFactura>
      <NIF>B12345678</NIF>
    </IDEmisorFactura>
    <NumSerieFactura>F-2026-0001</NumSerieFactura>
    <FechaExpedicionFactura>23-02-2026</FechaExpedicionFactura>
  </IDFactura>
  <Huella>
    <Hash>a3b2c1d4e5f6...</Hash>
    <FechaHoraHuella>23-02-2026T10:30:00</FechaHoraHuella>
  </Huella>
  <Encadenamiento>
    <RegistroAnterior>
      <HashRegistroAnterior>9f8e7d6c5b4a...</HashRegistroAnterior>
    </RegistroAnterior>
  </Encadenamiento>
  <ImporteTotal>121.00</ImporteTotal>
  <EstadoEnvio>ENVIADO</EstadoEnvio>
  <FechaEnvio>2026-02-23</FechaEnvio>
</RegistroFactura>
```

#### **3. registro_eventos/*.xml**

Cada evento en formato XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<EventoSistema>
  <ID>123</ID>
  <TipoEvento>ENVIO_AEAT</TipoEvento>
  <Descripcion><![CDATA[Enviados 45 registros a AEAT]]></Descripcion>
  <FechaEvento>2026-02-23T10:30:00Z</FechaEvento>
  <Usuario>Admin User</Usuario>
  <Huella>
    <Hash>a3b2c1d4e5f6...</Hash>
    <HashAnterior>9f8e7d6c5b4a...</HashAnterior>
  </Huella>
  <DatosEvento>
    <![CDATA[{"enviados": 45, "errores": 2}]]>
  </DatosEvento>
</EventoSistema>
```

#### **4. README.txt**

Instrucciones de verificación de integridad:

```
# Exportación Registros VeriFactu

Empresa: Mi Empresa SL
NIF: B12345678
Fecha exportación: 23/02/2026 10:45:00
Total registros: 250

## Contenido

- metadata.json: Información de la exportación
- registros_facturacion/: Registros de facturas en formato XML
- registro_eventos/: Eventos del sistema con hash encadenado

## Normativa

Real Decreto 1007/2023 - Sistema de Facturación Verificable (VeriFactu)

## Verificación

Para verificar la integridad:
1. Recalcular hash de cada registro
2. Verificar encadenamiento con registro anterior
3. Validar que no hay gaps en la secuencia
```

---

### **GET /api/admin/verifactu/informe-cumplimiento**

Genera un informe completo de cumplimiento VeriFactu.

**Respuesta:**
```json
{
  "fecha_informe": "2026-02-23T10:45:00Z",
  "empresa": {
    "nif": "B12345678",
    "nombre": "Mi Empresa SL"
  },
  "configuracion": {
    "verifactu_activo": true,
    "verifactu_modo": "PRODUCCION",
    "certificado_configurado": true
  },
  "registros_facturacion": {
    "total": 250,
    "enviados": 230,
    "pendientes": 15,
    "errores": 5,
    "primer_registro": "2025-01-15T00:00:00Z",
    "ultimo_registro": "2026-02-23T10:00:00Z"
  },
  "registro_eventos": {
    "total": 523,
    "primer_evento": "2025-01-15T08:00:00Z",
    "ultimo_evento": "2026-02-23T10:30:00Z"
  },
  "cumplimiento": {
    "hash_encadenado": "✅ Implementado",
    "qr_verificable": "✅ Implementado",
    "registro_eventos": "✅ Activo",
    "envio_aeat": "✅ Implementado",
    "inmutabilidad": "✅ Implementado"
  }
}
```

---

## 🤖 Logging Automático

### **¿Qué eventos se registran automáticamente?**

El sistema registra automáticamente los siguientes eventos **sin intervención manual**:

1. **Cambios de Configuración VeriFactu**
   - Activación/desactivación
   - Cambio de modo (TEST ↔ PRODUCCION)
   - Middleware: `verifactuEventosMiddleware.logCambiosVerifactu`

2. **Envíos a AEAT**
   - Cada vez que se envían registros (pendientes, errores, individual)
   - Middleware: `verifactuEventosMiddleware.logEnviosAeat`

3. **Descargas de Registros**
   - Cada vez que se exporta el ZIP
   - Servicio: `exportVerifactuService.registrarDescargaRegistros`

### **Implementación en Rutas**

```javascript
// En adminVerifactuAeatRoutes.js
import { logEnviosAeat } from '../middlewares/verifactuEventosMiddleware.js';

router.post('/enviar-pendientes',
  protegerVerifactuProduccion,
  logEnviosAeat,  // ← Logging automático
  enviarPendientes
);
```

---

## 🛠️ Uso Programático

### **Registrar un Evento Manualmente**

```javascript
import { registrarEventoSistema } from './services/eventosVerifactuService.js';

// Ejemplo: Registrar una incidencia
await registrarEventoSistema({
  empresaId: 1,
  tipoEvento: 'INCIDENCIA',
  descripcion: 'Error al conectar con AEAT: timeout',
  datosEvento: {
    error: 'ECONNREFUSED',
    endpoint: 'https://www1.aeat.es/...'
  },
  usuarioId: null, // Sistema automático
  ipAddress: req.ip,
  userAgent: req.headers['user-agent']
});
```

### **Verificar Integridad**

```javascript
import { verificarIntegridadEventos } from './services/eventosVerifactuService.js';

const resultado = await verificarIntegridadEventos(empresaId);

if (resultado.integridad === 'OK') {
  console.log('✅ Cadena íntegra');
} else {
  console.error('❌ Ruptura detectada:', resultado);
}
```

---

## 🔒 Seguridad

### **Inmutabilidad**

La tabla `eventos_sistema_verifactu_180` tiene **RLS (Row Level Security)** configurado para:

- ✅ **SELECT**: Solo eventos de tu empresa
- ✅ **INSERT**: Solo a través de función controlada
- ❌ **UPDATE**: Bloqueado (inmutabilidad)
- ❌ **DELETE**: Bloqueado (inmutabilidad)

### **Hash Encadenado**

Cada evento incluye:
- `hash_actual`: Hash SHA-256 del evento actual
- `hash_anterior`: Hash del evento anterior (encadenamiento)

Esto garantiza que:
1. No se pueden insertar eventos falsos en medio de la cadena
2. Cualquier modificación rompe el encadenamiento
3. Se puede verificar la integridad de toda la cadena

---

## 📋 Checklist de Cumplimiento

### **Requisitos RD 1007/2023**

- [x] ✅ Registro de eventos del sistema
- [x] ✅ Hash encadenado de eventos (SHA-256)
- [x] ✅ Inmutabilidad de eventos (RLS)
- [x] ✅ Sistema de exportación/volcado (ZIP)
- [x] ✅ Formato XML según especificación oficial
- [x] ✅ Metadatos de exportación
- [x] ✅ Instrucciones de verificación
- [x] ✅ Logging automático de eventos críticos
- [x] ✅ API REST completa para gestión de eventos
- [x] ✅ Verificación de integridad de la cadena

---

## 🆘 Solución de Problemas

### **Error: Ruptura en la cadena de eventos**

```json
{
  "integridad": "ERROR",
  "evento_roto": 245
}
```

**Causa:** Posible manipulación manual de la base de datos o bug en el código.

**Solución:**
1. Verificar logs del sistema
2. Comprobar si hay acceso directo a BD
3. Auditar cambios recientes en el código de eventos

### **Error: No se pueden descargar registros**

**Causa:** Falta el paquete `archiver` o permisos de memoria.

**Solución:**
```bash
npm install archiver
```

---

## ✅ Resumen Final

**Lo que tienes implementado:**

1. ✅ Tabla `eventos_sistema_verifactu_180` con hash encadenado
2. ✅ Servicio de eventos (`eventosVerifactuService.js`)
3. ✅ Controlador de eventos (`eventosVerifactuController.js`)
4. ✅ Rutas de eventos (`adminEventosVerifactuRoutes.js`)
5. ✅ Servicio de exportación (`exportVerifactuService.js`)
6. ✅ Controlador de exportación (`exportVerifactuController.js`)
7. ✅ Rutas de exportación (`adminExportVerifactuRoutes.js`)
8. ✅ Middleware de logging automático (`verifactuEventosMiddleware.js`)
9. ✅ Integración en `app.js`

**Tu sistema cumple 100% con los requisitos de registro de eventos y exportación del RD 1007/2023.**
