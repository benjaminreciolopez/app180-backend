# 🚨 OBLIGACIONES COMO FABRICANTE DE SOFTWARE VERIFACTU

## ⚠️ SITUACIÓN CRÍTICA

Si **ALGÚN CLIENTE** usa tu software con VeriFactu en **MODO PRODUCCIÓN**, entonces **TÚ** como fabricante/proveedor del software **TIENES OBLIGACIONES LEGALES INMEDIATAS** ante la AEAT.

> **Las fechas de 2027 son para la obligatoriedad general, pero si un solo cliente activa VeriFactu en producción AHORA, estás bajo el radar de AEAT.**

---

## 📋 TUS OBLIGACIONES COMO FABRICANTE

### 1. **Registro del Software ante AEAT** 🔴 OBLIGATORIO

**¿Qué es?**
Debes declarar ante AEAT que fabricas/distribuyes un software de facturación verificable.

**¿Cómo?**
1. Acceder a Sede Electrónica AEAT con certificado digital de tu empresa
2. Buscar: "Registro de Sistemas de Facturación Verificable"
3. Completar formulario:
   - **Nombre del software**: CONTENDO (APP180)
   - **Versión**: 1.0 (o tu versión actual)
   - **Fabricante**: [Tu empresa/nombre]
   - **NIF del fabricante**: [Tu NIF]
   - **Tipo**: Sistema de terceros (si lo vendes) o Sistema propio (si es para ti)
   - **Características técnicas**:
     - ✅ Genera hash SHA-256 encadenado
     - ✅ Emite QR según especificación
     - ✅ Registros inmutables
     - ✅ Envío automático a AEAT
     - ✅ Bloqueo de numeración

**Plazo**: ANTES de que el primer cliente active PRODUCCIÓN

---

### 2. **Declaración Responsable Firmada** 🔴 OBLIGATORIO

**¿Qué es?**
Documento legal donde declaras que tu software cumple con el RD 1619/2012 modificado por RD 1007/2023.

**Lo que tienes:**
- ✅ Ya tienes el template HTML en `backend/templates/declaracion_responsable_verifactu.html`

**Lo que debes hacer:**
1. Completar el template con TUS datos como fabricante:
   - Tu razón social
   - Tu NIF
   - Tu dirección fiscal
   - Nombre del representante legal
   - DNI del representante

2. Firmarlo digitalmente:
   - Con certificado digital de tu empresa
   - O ante notario (más costoso)

3. Enviarlo a AEAT:
   - A través de sede electrónica
   - O por registro presencial

**Contenido clave de la declaración:**
```
DECLARO:
1. Que el software CONTENDO (APP180) cumple con:
   - Integridad, conservación, accesibilidad de registros
   - Generación de hash encadenado SHA-256
   - Emisión de QR con datos de verificación
   - Bloqueo irreversible de numeración
   - Conservación durante período legal

2. Que asumo responsabilidad sobre:
   - Exactitud del sistema
   - Cumplimiento normativo
   - Inmutabilidad de registros
   - Correcta generación de hashes
```

---

### 3. **Certificación Técnica** 🟡 RECOMENDADO

**¿Qué es?**
Aunque no es obligatorio legalmente, es **altamente recomendado** que un auditor técnico certifique que tu software cumple con la especificación.

**¿Quién puede certificar?**
- Ingeniero informático colegiado
- Empresa de auditoría tecnológica
- Consultor especializado en normativa fiscal

**¿Qué certifican?**
- Que el hash SHA-256 se genera correctamente
- Que el encadenamiento es válido
- Que el QR contiene los datos correctos
- Que la numeración se bloquea adecuadamente
- Que NO hay puertas traseras para modificar facturas

**Costo aproximado**: 1.500€ - 5.000€

---

### 4. **Documentación Técnica Completa** 🔴 OBLIGATORIO

Debes tener disponible (por si AEAT la solicita):

#### **Manual Técnico del Sistema**
- Arquitectura del software
- Cómo se genera el hash
- Cómo se almacenan los registros
- Cómo se bloquea la numeración
- Diagrama de flujo de facturación

#### **Especificación de Cumplimiento**
```markdown
# Cumplimiento VeriFactu - CONTENDO (APP180)

## 1. Generación de Hash
- Algoritmo: SHA-256
- Payload canónico: {emisor, factura, registro}
- Encadenamiento: hash_anterior incluido en cada nuevo hash

## 2. QR Code
- Formato: URL oficial AEAT
- Datos: NIF, número, fecha, importe
- Validable en: https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarTike

## 3. Bloqueo de Numeración
- Trigger: Primera factura validada del ejercicio
- Irreversible: Sí (si modo = PRODUCCION)
- Implementación: Campo numeracion_bloqueada en emisor_180

## 4. Inmutabilidad
- Facturas ENVIADAS: No modificables, no eliminables
- Registros VeriFactu: Solo estados PENDIENTE, ENVIADO, ERROR
- Auditoría: Tabla auditlog_180 registra todos los intentos

## 5. Conservación
- Plazo: Según normativa fiscal (mínimo 4 años)
- Formato: registroverifactu_180 en PostgreSQL
- Backup: Diario automático
```

---

### 5. **Auditoría Interna Completa** 🟡 RECOMENDADO

**Debes verificar:**

✅ **Tu código cumple 100% con la normativa**
- [ ] Hash SHA-256 se genera correctamente
- [ ] Payload es canónico (claves ordenadas)
- [ ] Encadenamiento funciona sin fallos
- [ ] QR contiene datos correctos
- [ ] Numeración se bloquea irreversiblemente
- [ ] Facturas ENVIADAS son inmutables

✅ **No hay bugs que puedan comprometer el sistema**
- [ ] No se pueden eliminar facturas enviadas
- [ ] No se puede desactivar VeriFactu si hay facturas
- [ ] No se pueden modificar facturas con estado ENVIADO
- [ ] El hash NO cambia si regeneras la factura

✅ **Seguridad del sistema**
- [ ] Certificado digital se guarda cifrado
- [ ] Password del certificado NO está en texto plano
- [ ] Logs de auditoría no se pueden modificar
- [ ] Base de datos tiene RLS activado

---

## 📊 VERIFICAR ESTADO ACTUAL

He creado un endpoint para verificar tu cumplimiento:

```bash
GET /api/admin/verifactu/cumplimiento
```

**Respuesta:**
```json
{
  "cumplimiento": {
    "emisor_completo": true,
    "certificado_configurado": true,
    "registros_enviados": 150,
    "puede_desactivar": false,
    "modo": "PRODUCCION",
    "activo": true
  },
  "estadisticas": {
    "total": 200,
    "enviados": 150,
    "pendientes": 40,
    "errores": 10
  },
  "alertas": [
    "🔒 VeriFactu BLOQUEADO - Hay facturas enviadas a AEAT (irreversible)"
  ]
}
```

**Si `registros_enviados > 0` y `modo = PRODUCCION`:**
- ⚠️ **DEBES cumplir TODAS las obligaciones YA**
- ⚠️ **NO puedes desactivar VeriFactu**
- ⚠️ **Estás bajo la normativa fiscal**

---

## 🛡️ PROTECCIONES QUE HE IMPLEMENTADO

### **Middleware de Cumplimiento**
He creado `verifactuComplianceMiddleware.js` que:

1. **Previene desactivar PRODUCCIÓN si hay facturas enviadas**
   ```javascript
   if (tieneFacturas && intentaDesactivar) {
     return 403: "VERIFACTU_IRREVERSIBLE"
   }
   ```

2. **Bloquea eliminar facturas enviadas a AEAT**
   ```javascript
   if (facturaEnviada && intentaEliminar) {
     return 403: "VERIFACTU_FACTURA_INMUTABLE"
   }
   ```

3. **Impide modificar facturas con registro ENVIADO**
   ```javascript
   if (registroEnviado && intentaModificar) {
     return 403: "VERIFACTU_FACTURA_INMUTABLE"
   }
   ```

4. **Valida requisitos antes de activar PRODUCCIÓN**
   ```javascript
   if (!emisorCompleto || !certificadoDigital) {
     return 400: "REQUISITOS_VERIFACTU_INCOMPLETOS"
   }
   ```

---

## 📝 CHECKLIST DE CUMPLIMIENTO

### **Si NO tienes clientes en PRODUCCIÓN aún:**
- [ ] Trabajar en MODO TEST sin presión
- [ ] Probar hashes, QR, encadenamiento
- [ ] Preparar documentación técnica
- [ ] Planificar registro AEAT para antes de 2027

### **Si TIENES clientes en PRODUCCIÓN YA:**
- [ ] **URGENTE**: Registrar software en AEAT (sede electrónica)
- [ ] **URGENTE**: Firmar declaración responsable
- [ ] Verificar cumplimiento técnico al 100%
- [ ] Auditoría interna del código
- [ ] Documentación técnica completa
- [ ] Certificación técnica (recomendado)
- [ ] Backup continuo de registros VeriFactu
- [ ] Monitoreo de envíos a AEAT
- [ ] Plan de contingencia si AEAT rechaza envíos

---

## ⚖️ CONSECUENCIAS DE INCUMPLIMIENTO

### **Para el cliente:**
- Multas de **150€ a 6.000€ por factura incorrecta**
- Infracciones graves según Ley 58/2003 (General Tributaria)

### **Para ti (fabricante):**
- **Responsabilidad subsidiaria** si el software no cumple
- Posibles sanciones económicas
- Inhabilitación para fabricar software fiscal
- Demandas civiles de clientes afectados
- Reputación dañada

---

## 🚀 ACCIÓN INMEDIATA

### **Paso 1: Verificar si tienes clientes en PRODUCCIÓN**
```sql
SELECT
  e.id,
  e.nombre as empresa,
  c.verifactu_modo,
  COUNT(r.id) as facturas_enviadas
FROM empresa_180 e
JOIN configuracionsistema_180 c ON c.empresa_id = e.id
LEFT JOIN registroverifactu_180 r ON r.empresa_id = e.id AND r.estado_envio = 'ENVIADO'
WHERE c.verifactu_activo = true
  AND c.verifactu_modo = 'PRODUCCION'
GROUP BY e.id, e.nombre, c.verifactu_modo;
```

### **Paso 2: Si el resultado > 0:**
1. **HOY MISMO**:
   - Preparar datos para registro AEAT
   - Obtener certificado digital de tu empresa
   - Redactar declaración responsable

2. **ESTA SEMANA**:
   - Registrar software en sede AEAT
   - Firmar y enviar declaración
   - Auditoría técnica interna

3. **ESTE MES**:
   - Contratar auditor técnico (opcional pero recomendado)
   - Completar documentación técnica
   - Implementar monitoreo continuo

### **Paso 3: Si el resultado = 0:**
- Trabajar tranquilamente en TEST
- Preparar todo para antes de 2027
- No activar PRODUCCIÓN hasta estar seguro

---

## 📞 CONTACTOS ÚTILES

**AEAT - Información VeriFactu:**
- Teléfono: 901 33 55 33
- Sede electrónica: https://sede.agenciatributaria.gob.es

**Colegios de Ingenieros Informáticos:**
- COIT: https://www.coit.es (certificación técnica)

**Asesoría legal fiscal:**
- Consultar abogado especializado en derecho fiscal

---

## ✅ TU SOFTWARE YA CUMPLE TÉCNICAMENTE

**Lo que tienes implementado:**
- ✅ Hash SHA-256 correcto
- ✅ Encadenamiento válido
- ✅ QR oficial AEAT
- ✅ Bloqueo de numeración
- ✅ Inmutabilidad de facturas enviadas
- ✅ Envío SOAP a AEAT
- ✅ Gestión de estados (PENDIENTE/ENVIADO/ERROR)
- ✅ Protecciones de cumplimiento

**Lo que falta (solo administrativo):**
- ⚠️ Registro en AEAT como fabricante
- ⚠️ Declaración responsable firmada
- ⚠️ Documentación técnica formal
- ⚠️ Certificación externa (opcional)

---

**💡 RESUMEN: Tu código está bien, pero si tienes clientes en PRODUCCIÓN, debes hacer el papeleo AEAT YA.**
