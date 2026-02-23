# 📋 Guía Completa: VeriFactu y Envío a la AEAT

## 🎯 ¿Qué es VeriFactu?

**VeriFactu** (Verificación de Facturas) es el nuevo sistema de facturación verificable obligatorio para todos los sistemas informáticos de facturación en España, regulado por el **Real Decreto 1007/2023** que modifica el Reglamento de facturación (RD 1619/2012).

### Objetivo
- **Combatir el fraude fiscal** mediante trazabilidad completa de facturas
- **Garantizar la inalterabilidad** de los registros de facturación
- **Facilitar la verificación** por parte de la AEAT

## 📅 Fechas Límite Obligatorias

| Tipo de Contribuyente | Fecha Límite |
|----------------------|--------------|
| **Sociedades (Impuesto sobre Sociedades)** | 1 de enero de 2027 |
| **Autónomos (IRPF)** | 1 de julio de 2027 |

> ⚠️ **Importante**: Hasta estas fechas, puedes operar en **MODO TEST** sin necesidad de registro oficial.

---

## 🔐 Requisitos Previos para Producción

### 1. **Certificado Digital**
Necesitas un **certificado digital válido** de la empresa o del representante legal:

- **FNMT** (Fábrica Nacional de Moneda y Timbre): https://www.sede.fnmt.gob.es
- **Certificados de Empresa** de autoridades certificadoras reconocidas
- **Formato**: `.p12` o `.pfx` con contraseña

**¿Cómo obtenerlo?**
1. Acceder a https://www.sede.fnmt.gob.es/certificados
2. Solicitar **Certificado de Persona Jurídica** (empresa)
3. Descargar el certificado en formato `.p12`
4. Guardar la contraseña de forma segura

### 2. **Alta en VeriFactu (AEAT)**
Antes del envío en producción, debes:

1. **Acceder a Sede Electrónica de la AEAT**:
   - URL: https://sede.agenciatributaria.gob.es
   - Autenticarse con certificado digital

2. **Registrar tu sistema de facturación**:
   - Buscar: "Sistema de Facturación Verificable (VeriFactu)"
   - Dar de alta el software: **CONTENDO (APP180)**
   - Proporcionar datos del sistema:
     - Nombre del software: CONTENDO
     - Versión: 1.0
     - Proveedor: [Tu empresa]
     - NIF del fabricante

3. **Declaración responsable**:
   - Firmar digitalmente la declaración de cumplimiento normativo
   - Ya tienes el template en `backend/templates/declaracion_responsable_verifactu.html`

---

## 🌐 Endpoints de la AEAT

### **Entorno de PRUEBAS** (Pre-producción)
```
https://prewww1.aeat.es/wlpl/TIKE-CONT/SuministroLR
```
- **Acceso**: No requiere certificado en algunos casos
- **Datos**: Ficticios, no afectan tu producción
- **Uso**: Testing y desarrollo

### **Entorno de PRODUCCIÓN**
```
https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/SuministroLR
```
- **Acceso**: Requiere certificado digital OBLIGATORIO
- **Datos**: Reales, van al registro oficial
- **Uso**: Facturas definitivas tras fecha límite

---

## 🛠️ Configuración en tu Sistema

### 1. **Subir Certificado Digital**

Guarda tu certificado `.p12` en el servidor:
```bash
# Ejemplo de ubicación recomendada
backend/certificates/mi-empresa-cert.p12
```

### 2. **Configurar en Base de Datos**

Actualiza la tabla `configuracionsistema_180` con:

```sql
UPDATE configuracionsistema_180
SET
  verifactu_activo = true,
  verifactu_modo = 'TEST', -- Cambiar a 'PRODUCCION' cuando estés listo
  verifactu_certificado_path = '/ruta/completa/al/certificado.p12',
  verifactu_certificado_password = 'tu_password_certificado'
WHERE empresa_id = <tu_empresa_id>;
```

### 3. **Probar Conexión**

Usa el endpoint de testing:
```bash
POST /api/admin/verifactu/test-conexion
Content-Type: application/json
Authorization: Bearer <tu_token>

{
  "entorno": "PRUEBAS"
}
```

---

## 📤 Cómo Enviar Facturas a la AEAT

### **Flujo Automático** (Recomendado)

Cuando valides una factura, el sistema:
1. ✅ Genera el hash SHA-256 encadenado
2. ✅ Guarda el registro en `registroverifactu_180` con estado `PENDIENTE`
3. ✅ Construye el QR con los datos oficiales

Luego, puedes enviar manualmente o automatizar:

#### **Opción A: Envío Manual desde Admin**
```bash
# Ver registros pendientes
GET /api/admin/verifactu/registros?estado=PENDIENTE

# Enviar todos los pendientes
POST /api/admin/verifactu/enviar-pendientes
{
  "entorno": "PRUEBAS" // o "PRODUCCION"
}
```

#### **Opción B: Envío Individual**
```bash
POST /api/admin/verifactu/enviar/:registroId
{
  "entorno": "PRUEBAS"
}
```

#### **Opción C: Cron Job Automático** (Para implementar)
```javascript
// En backend/src/jobs/enviarVerifactu.js
import cron from 'node-cron';
import { enviarRegistrosPendientes } from '../services/verifactuAeatService.js';

// Enviar cada hora los registros pendientes
cron.schedule('0 * * * *', async () => {
  console.log('🤖 Ejecutando envío automático VeriFactu...');

  const empresas = await sql`SELECT id FROM empresa_180 WHERE activa = true`;

  for (const empresa of empresas) {
    await enviarRegistrosPendientes(empresa.id, 'PRUEBAS');
  }
});
```

---

## 📊 Endpoints Disponibles

### **Listar Registros VeriFactu**
```http
GET /api/admin/verifactu/registros?estado=PENDIENTE&limit=50&offset=0
```

Respuesta:
```json
{
  "registros": [
    {
      "id": 123,
      "factura_id": 456,
      "numero_factura": "F-2026-0001",
      "hash_actual": "abc123...",
      "estado_envio": "PENDIENTE",
      "fecha_registro": "2026-02-23T10:00:00Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### **Estadísticas**
```http
GET /api/admin/verifactu/stats
```

Respuesta:
```json
{
  "total": 250,
  "pendientes": 50,
  "enviados": 190,
  "errores": 10
}
```

### **Enviar Pendientes**
```http
POST /api/admin/verifactu/enviar-pendientes
Content-Type: application/json

{
  "entorno": "PRUEBAS"
}
```

Respuesta:
```json
{
  "success": true,
  "mensaje": "Enviados: 48, Errores: 2",
  "total": 50,
  "enviados": 48,
  "errores": 2,
  "resultados": [...]
}
```

### **Reintentar Errores**
```http
POST /api/admin/verifactu/reintentar-errores
Content-Type: application/json

{
  "entorno": "PRUEBAS"
}
```

---

## 🔍 Estados de Envío

| Estado | Descripción |
|--------|-------------|
| **PENDIENTE** | Registro creado, no enviado a AEAT |
| **ENVIADO** | Enviado y aceptado por AEAT |
| **ERROR** | Fallo en el envío (ver `respuesta_aeat`) |

---

## ❌ Manejo de Errores Comunes

### **Error: Certificado no encontrado**
```json
{
  "error": "Error al cargar certificado: ENOENT"
}
```
**Solución**: Verifica la ruta en `verifactu_certificado_path`

### **Error: Certificado inválido**
```json
{
  "error": "Error de conexión con AEAT: self signed certificate"
}
```
**Solución**:
- Verifica que el certificado sea válido
- En PRUEBAS, se acepta certificado autofirmado
- En PRODUCCIÓN, debe ser emitido por CA reconocida

### **Error: Datos incorrectos**
```json
{
  "success": false,
  "mensaje": "NIF incorrecto",
  "codigoError": "VAL-001"
}
```
**Solución**: Revisa los datos del emisor en `emisor_180`

---

## 📖 Documentación Oficial AEAT

1. **Especificaciones Técnicas**:
   - https://sede.agenciatributaria.gob.es
   - Buscar: "VeriFactu" > "Documentación técnica"

2. **XSD (Esquemas XML)**:
   - Descargables desde sede electrónica
   - Definen estructura exacta del XML

3. **Códigos de Error**:
   - Documentados en guía técnica AEAT
   - Disponibles tras registro del sistema

---

## ✅ Checklist de Implementación

### **Fase 1: Desarrollo (YA HECHO ✅)**
- [x] Generación de hash SHA-256 encadenado
- [x] Tabla `registroverifactu_180` con estados
- [x] Servicio de envío SOAP a AEAT
- [x] Endpoints API para gestión
- [x] Construcción de XML según XSD
- [x] QR con datos oficiales

### **Fase 2: Testing (ACTUAL)**
- [ ] Obtener certificado digital de pruebas (opcional)
- [ ] Configurar `verifactu_modo = 'TEST'`
- [ ] Generar facturas de prueba
- [ ] Probar envío a entorno PRUEBAS
- [ ] Verificar respuestas AEAT
- [ ] Validar QR en validador AEAT

### **Fase 3: Pre-Producción (Antes de fechas límite)**
- [ ] Solicitar certificado digital de PRODUCCIÓN
- [ ] Dar de alta sistema en sede AEAT
- [ ] Firmar declaración responsable
- [ ] Configurar `verifactu_certificado_path`
- [ ] Probar conexión con certificado

### **Fase 4: Producción (Tras fecha límite)**
- [ ] Cambiar `verifactu_modo = 'PRODUCCION'`
- [ ] Enviar primeras facturas reales
- [ ] Monitorear respuestas AEAT
- [ ] Implementar envío automático (cron)
- [ ] Archivar respuestas CSV de AEAT

---

## 🚀 Próximos Pasos AHORA (Antes de Registro)

1. **Generar facturas de prueba en MODO TEST**
   - Verifica que se generen hashes correctos
   - Comprueba que el QR sea válido

2. **Implementar UI de administración** (opcional)
   - Panel para ver registros pendientes
   - Botón para enviar pendientes
   - Ver estadísticas de envío

3. **Configurar logs y alertas**
   - Log de envíos exitosos
   - Alertas si hay errores recurrentes

4. **Testing exhaustivo**
   - Envía facturas de prueba al entorno PRUEBAS
   - Valida QR en: https://prewww1.aeat.es/wlpl/TIKE-CONT/ValidarTike

---

## 💡 Recomendaciones Finales

1. **No te apresures**: Tienes hasta 2027 (autónomos) o enero 2027 (sociedades)
2. **Usa MODO TEST**: Genera hashes y QR reales sin afectar producción
3. **Documenta todo**: Guarda las respuestas AEAT en la BD
4. **Auditoría**: Los registros VeriFactu son inmutables por ley
5. **Certificado seguro**: Guarda el `.p12` en lugar seguro, cifrado

---

## 📞 Soporte AEAT

- **Teléfono**: 901 33 55 33
- **Email**: Formulario en sede electrónica
- **Horario**: L-V 9:00-19:00h

---

**✅ Tu sistema CONTENDO ya está preparado para VeriFactu. Solo falta registrarte cuando llegue el momento.**
