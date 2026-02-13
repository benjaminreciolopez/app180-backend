// backend/src/controllers/facturasController.js

import { sql } from "../db.js";
import { generarPdfFactura } from "../services/facturaPdfService.js";
import * as emailService from "../services/emailService.js";
import { verificarVerifactu } from "../services/verifactuService.js";
import { registrarAuditoria } from "../middlewares/auditMiddleware.js";
import { saveToStorage } from "./storageController.js";

/* =========================
   Helpers
========================= */

async function getEmpresaId(userId) {
  const r = await sql`
    select id from empresa_180
    where user_id=${userId}
    limit 1
  `;

  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }

  return r[0].id;
}

function n(v) {
  return v === undefined || v === null ? null : v;
}

function getTrimestre(fecha) {
  const f = new Date(fecha);
  const mes = f.getUTCMonth(); // 0-11
  return Math.floor(mes / 3) + 1;
}

function getStoragePath(fecha, baseFolder = 'Facturas emitidas') {
  const f = new Date(fecha);
  const year = f.getUTCFullYear();
  const trim = getTrimestre(fecha);
  return `${baseFolder}/${year}/T${trim}`;
}

async function getInvoiceStorageFolder(empresaId) {
  try {
    const [config] = await sql`select storage_facturas_folder from configuracionsistema_180 where empresa_id=${empresaId}`;
    const folder = config?.storage_facturas_folder || 'Facturas emitidas';
    console.log(`📂 [getInvoiceStorageFolder] Empresa: ${empresaId}, Config: ${config?.storage_facturas_folder} -> Final: ${folder}`);
    return folder;
  } catch (e) {
    console.error(`⚠️ [getInvoiceStorageFolder] Error: ${e.message}, usando default`);
    return 'Facturas emitidas';
  }
}

async function auditFactura(params) {
  const { empresaId, userId, entidadTipo, entidadId, accion, motivo, req, datosNuevos } = params;

  // 1. Log General (audit_log_180)
  await registrarAuditoria(params);

  // 2. Log de Seguridad Veri*Factu (auditoria_180)
  const { registrarEventoSeguridad } = await import('../middlewares/auditMiddleware.js');
  await registrarEventoSeguridad({
    empresaId,
    userId,
    entidad: entidadTipo || 'factura',
    entidadId,
    accion,
    motivo,
    req,
    payload: datosNuevos
  });
}

// Parse número de factura para ordenación
function parseNumeroFactura(numero) {
  if (!numero) return { year: 0, correlativo: 0, esRect: 0 };

  const num = String(numero).trim().toUpperCase();
  const esRect = num.endsWith("R") ? 1 : 0;
  const numClean = esRect ? num.slice(0, -1) : num;

  const partes = numClean.split("-");
  let year = 0;
  let correlativo = 0;

  // Encontrar año (4 dígitos)
  for (const p of partes) {
    if (p.length === 4 && /^\d+$/.test(p)) {
      year = parseInt(p);
      break;
    }
  }

  // Correlativo (última parte numérica)
  try {
    const lastPart = partes[partes.length - 1];
    const soloNumeros = lastPart.replace(/\D/g, "");
    if (soloNumeros) {
      correlativo = parseInt(soloNumeros);
    }
  } catch {
    correlativo = 0;
  }

  return { year, correlativo, esRect };
}

/* =========================
   LISTADO DE FACTURAS
========================= */

export async function listFacturas(req, res) {
  try {
    let empresaId = req.user.empresa_id;
    if (!empresaId) {
      empresaId = await getEmpresaId(req.user.id);
    }

    const { estado, cliente_id, fecha_desde, fecha_hasta, year } = req.query;

    let query = sql`
      select
        f.*,
        c.nombre as cliente_nombre,
        c.codigo as cliente_codigo,
        s.id as storage_record_id,
        s.storage_path as storage_real_path
      from factura_180 f
      left join clients_180 c on c.id = f.cliente_id
      left join storage_180 s on s.nombre = 'Factura_' || replace(f.numero, '/', '-') || '.pdf' 
        AND s.empresa_id = f.empresa_id
      where f.empresa_id = ${empresaId}
    `;

    if (estado && estado !== 'TODOS') {
      query = sql`${query} AND f.estado = ${estado}`;
    }

    if (cliente_id) {
      query = sql`${query} AND f.cliente_id = ${parseInt(cliente_id)}`;
    }

    if (fecha_desde) {
      query = sql`${query} AND f.fecha >= ${fecha_desde}::date`;
    }

    if (fecha_hasta) {
      query = sql`${query} AND f.fecha <= ${fecha_hasta}::date`;
    }

    if (year) {
      query = sql`${query} AND EXTRACT(YEAR FROM f.fecha) = ${parseInt(year)}`;
    }

    const facturas = await sql`${query} order by f.created_at desc`;

    // Ordenar por número de factura (lógica compleja)
    const facturasOrdenadas = facturas.sort((a, b) => {
      const parseA = parseNumeroFactura(a.numero);
      const parseB = parseNumeroFactura(b.numero);

      if (parseA.year !== parseB.year) return parseA.year - parseB.year;
      if (parseA.correlativo !== parseB.correlativo)
        return parseA.correlativo - parseB.correlativo;
      return parseA.esRect - parseB.esRect;
    });

    res.json({ success: true, data: facturasOrdenadas });
  } catch (err) {
    console.error("❌ listFacturas:", err);
    res.status(500).json({ success: false, error: "Error listando facturas" });
  }
}


/* =========================
   ÚLTIMA FECHA VALIDA
========================= */

export async function getLastValidDate(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);

    // Obtener la fecha de la última factura validada
    const [lastInvoice] = await sql`
      select fecha from factura_180
      where empresa_id = ${empresaId}
        and estado IN ('VALIDADA', 'ENVIADA')
      order by fecha desc
      limit 1
    `;

    res.json({
      success: true,
      lastDate: lastInvoice ? lastInvoice.fecha : null
    });
  } catch (err) {
    console.error("❌ getLastValidDate:", err);
    res.status(500).json({ success: false, error: "Error obteniendo última fecha" });
  }
}

/* =========================
   DETALLE DE FACTURA
========================= */

export async function getFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [factura] = await sql`
      select
        f.*,
        c.nombre as cliente_nombre,
        c.codigo as cliente_codigo,
        fd.razon_social,
        fd.nif_cif,
        fd.direccion_fiscal,
        fd.codigo_postal,
        fd.municipio,
        fd.provincia,
        fd.pais
      from factura_180 f
      left join clients_180 c on c.id = f.cliente_id
      left join client_fiscal_data_180 fd on fd.cliente_id = f.cliente_id
      where f.id = ${id}
        and f.empresa_id = ${empresaId}
      limit 1
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    // Obtener líneas
    const lineas = await sql`
      select
        lf.*,
        co.nombre as concepto_nombre
      from lineafactura_180 lf
      left join concepto_180 co on co.id = lf.concepto_id
      where lf.factura_id = ${id}
      order by lf.id
    `;

    // Obtener trabajos enlazados
    const work_logs = await sql`
      select id from work_logs_180 where factura_id = ${id}
    `;
    const work_log_ids = work_logs.map(w => w.id);

    res.json({
      success: true,
      data: {
        ...factura,
        lineas,
        work_log_ids
      },
    });
  } catch (err) {
    console.error("❌ getFactura:", err);
    res.status(500).json({ success: false, error: "Error obteniendo factura" });
  }
}

/* =========================
   CREAR FACTURA (BORRADOR)
========================= */

export async function createFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { cliente_id, fecha, iva_global, lineas = [], mensaje_iva, metodo_pago, work_log_ids = [] } = req.body;

    if (!cliente_id) {
      return res.status(400).json({ success: false, error: "Cliente requerido" });
    }

    if (!fecha) {
      return res.status(400).json({ success: false, error: "Fecha requerida" });
    }

    if (!Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ success: false, error: "Debe incluir al menos una línea" });
    }

    // Validar cliente existe
    const [cliente] = await sql`
      select 1 from clients_180
      where id=${cliente_id} and empresa_id=${empresaId}
    `;

    if (!cliente) {
      return res.status(400).json({ success: false, error: "Cliente inválido" });
    }

    let createdFactura;

    await sql.begin(async (tx) => {
      let subtotal = 0;
      let iva_total = 0;

      // Crear factura
      const [factura] = await tx`
        insert into factura_180 (
          empresa_id, cliente_id, fecha, estado, iva_global, mensaje_iva, metodo_pago,
          subtotal, iva_total, total, created_at
        ) values (
          ${empresaId},
          ${cliente_id},
          ${fecha}::date,
          'BORRADOR',
          ${n(iva_global) || 0},
          ${n(mensaje_iva)},
          ${n(metodo_pago) || 'TRANSFERENCIA'},
          0, 0, 0,
          now()
        )
        returning *
      `;
      createdFactura = factura; // Assign to createdFactura for audit log

      // Crear líneas
      for (const linea of lineas) {
        const descripcion = (linea.descripcion || "").trim();
        if (!descripcion) continue;

        const cantidad = parseFloat(linea.cantidad || 0);
        const precio_unitario = parseFloat(linea.precio_unitario || 0);
        const iva_pct = parseFloat(linea.iva || iva_global || 0);
        const base = cantidad * precio_unitario;
        const importe_iva = base * iva_pct / 100;

        subtotal += base;
        iva_total += importe_iva;

        await tx`
          insert into lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent
          ) values (
            ${factura.id},
            ${descripcion},
            ${cantidad},
            ${precio_unitario},
            ${base + importe_iva},
            ${n(linea.concepto_id)},
            ${iva_pct}
          )
        `;
      }

      // Actualizar totales
      const [updated] = await tx`
        update factura_180
        set subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            total = ${Math.round((subtotal + iva_total) * 100) / 100}
        where id = ${factura.id}
        returning *
      `;
      createdFactura = updated;

      // Enlazar trabajos (God Level)
      if (Array.isArray(work_log_ids) && work_log_ids.length > 0) {

        // Limpiar IDs (quitar prefijo 'trabajo_' si viene del frontend nuevo)
        const cleanIds = work_log_ids
          .map(id => String(id).replace('trabajo_', ''))
          .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

        if (cleanIds.length > 0) {
          // 1. Vincular los trabajos a la factura
          await tx`
              UPDATE work_logs_180
              SET factura_id = ${factura.id}
              WHERE id IN ${tx(cleanIds)}
                AND empresa_id = ${empresaId}
                AND cliente_id = ${cliente_id}
            `;

          // 2. Si hay al menos un trabajo, guardamos referencia en la factura (Útil si es 1:1 o para trazabilidad rápida)
          const mainWorkLogId = cleanIds[0];
          await tx`
                UPDATE factura_180 
                SET work_log_id = ${mainWorkLogId}
                WHERE id = ${factura.id} AND empresa_id = ${empresaId}
             `;
          createdFactura.work_log_id = mainWorkLogId;
        }
      }

      // Auditoría
      await auditFactura({
        empresaId,
        userId: req.user.id,
        accion: 'factura_creada',
        entidadTipo: 'factura',
        entidadId: createdFactura.id,
        req,
        datosNuevos: { cliente_id, fecha, total: createdFactura.total }
      });
    });

    res.status(201).json({ success: true, message: "Factura creada en borrador" });
  } catch (err) {
    console.error("❌ createFactura:", err);
    res.status(500).json({ success: false, error: "Error creando factura" });
  }
}

/* =========================
   ACTUALIZAR FACTURA (BORRADOR)
========================= */

export async function updateFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { cliente_id, fecha, iva_global, lineas = [], mensaje_iva, metodo_pago, work_log_ids = [] } = req.body;

    // Validar que la factura existe y es borrador
    const [factura] = await sql`
      select * from factura_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    if (factura.estado !== "BORRADOR") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden editar facturas en borrador",
      });
    }

    if (!Array.isArray(lineas)) {
      return res.status(400).json({ success: false, error: "Líneas deben ser un array" });
    }

    await sql.begin(async (tx) => {
      // Actualizar datos básicos
      await tx`
        update factura_180
        set cliente_id = ${n(cliente_id) || factura.cliente_id},
            fecha = ${n(fecha) || factura.fecha}::date,
            iva_global = ${n(iva_global) || factura.iva_global},
            mensaje_iva = ${n(mensaje_iva) || factura.mensaje_iva},
            metodo_pago = ${n(metodo_pago) || factura.metodo_pago}
        where id = ${id}
      `;

      // Eliminar líneas anteriores
      await tx`delete from lineafactura_180 where factura_id=${id}`;

      let subtotal = 0;
      let iva_total = 0;

      // Recrear líneas
      for (const linea of lineas) {
        const descripcion = (linea.descripcion || "").trim();
        if (!descripcion) continue;

        const cantidad = parseFloat(linea.cantidad || 0);
        const precio_unitario = parseFloat(linea.precio_unitario || 0);
        const iva_pct = parseFloat(linea.iva || iva_global || 0);
        const base = cantidad * precio_unitario;
        const importe_iva = base * iva_pct / 100;

        subtotal += base;
        iva_total += importe_iva;

        await tx`
          insert into lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent
          ) values (
            ${id},
            ${descripcion},
            ${cantidad},
            ${precio_unitario},
            ${base + importe_iva},
            ${n(linea.concepto_id)},
            ${iva_pct}
          )
        `;
      }

      // Actualizar totales
      // Actualizar totales
      await tx`
        update factura_180
        set subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            total = ${Math.round((subtotal + iva_total) * 100) / 100}
        where id = ${id}
      `;

      // Gestión de enlaces de trabajos (God Level)
      // 1. Liberar trabajos previos de esta factura
      await tx`
        UPDATE work_logs_180
        SET factura_id = NULL
        WHERE factura_id = ${id}
          AND empresa_id = ${empresaId}
      `;

      // 2. Enlazar nuevos trabajos
      if (Array.isArray(work_log_ids) && work_log_ids.length > 0) {

        // Limpiar IDs (quitar prefijo 'trabajo_' si viene del frontend nuevo)
        const cleanIds = work_log_ids
          .map(id => String(id).replace('trabajo_', ''))
          .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

        if (cleanIds.length > 0) {
          // A. Link Reverso (Lista)
          await tx`
              UPDATE work_logs_180
              SET factura_id = ${id}
              WHERE id IN ${tx(cleanIds)}
                AND empresa_id = ${empresaId}
                AND cliente_id = ${cliente_id}
            `;

          // B. Link Directo (Único) - Tomamos el primero o único
          const mainWorkLogId = cleanIds[0];
          await tx`
                UPDATE factura_180 
                SET work_log_id = ${mainWorkLogId}
                WHERE id = ${id} AND empresa_id = ${empresaId}
            `;
        } else {
          // Si no hay trabajos validos, limpiamos referencia directa tambien
          await tx`UPDATE factura_180 SET work_log_id = NULL WHERE id = ${id}`;
        }
      } else {
        // Si lista vacia, limpiamos referencia directa
        await tx`UPDATE factura_180 SET work_log_id = NULL WHERE id = ${id}`;
      }
      await auditFactura({
        empresaId,
        userId: req.user.id,
        req,
        accion: 'factura_actualizada',
        entidadTipo: 'factura',
        entidadId: id,
        datosAnteriores: factura,
        datosNuevos: { cliente_id, total: subtotal + iva_total }
      });
    });

    res.json({ success: true, message: "Factura actualizada" });
  } catch (err) {
    console.error("❌ updateFactura:", err);
    res.status(500).json({ success: false, error: "Error actualizando factura" });
  }
}

/* =========================
   VALIDAR FACTURA
========================= */

export async function validarFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { fecha, mensaje_iva } = req.body;

    if (!fecha) {
      return res.status(400).json({ success: false, error: "Fecha requerida" });
    }

    const [factura] = await sql`
      select * from factura_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    if (factura.estado === "VALIDADA") {
      return res.status(400).json({ success: false, error: "Factura ya validada" });
    }

    // Validar orden cronológico
    const [ultima] = await sql`
      select fecha from factura_180
      where empresa_id=${empresaId}
        and estado='VALIDADA'
      order by fecha desc
      limit 1
    `;

    if (ultima && new Date(fecha) < new Date(ultima.fecha)) {
      return res.status(400).json({
        success: false,
        error: "La fecha no puede ser anterior a la última factura validada",
      });
    }

    // Generar número de factura
    const numero = await generarNumeroFactura(empresaId, fecha);

    await sql.begin(async (tx) => {
      // Obtener líneas para recalcular
      const lineas = await tx`select * from lineafactura_180 where factura_id=${id}`;

      let subtotal = 0;
      let iva_total = 0;
      for (const l of lineas) {
        const base = l.cantidad * l.precio_unitario;
        subtotal += base;
        iva_total += (base * (l.iva_percent || factura.iva_global || 0) / 100);
      }
      const total = Math.round((subtotal + iva_total) * 100) / 100;

      // Actualizar factura
      const [updatedRecord] = await tx`
        update factura_180
        set estado = 'VALIDADA',
            numero = ${numero},
            fecha = ${fecha}::date,
            fecha_validacion = current_date,
            mensaje_iva = ${mensaje_iva !== undefined ? n(mensaje_iva) : sql`mensaje_iva`},
            subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            total = ${total}
        where id = ${id}
        returning *
      `;

      // Verificar Veri*Factu (si aplica) con el registro actualizado
      await verificarVerifactu(updatedRecord, tx);

      // Bloquear numeración (actualizar emisor)
      const year = new Date(fecha).getFullYear();
      await tx`
        update emisor_180
        set ultimo_anio_numerado = ${year}
        where empresa_id = ${empresaId}
      `;
    });

    // Auditoría
    await auditFactura({
      empresaId,
      userId: req.user.id,
      accion: 'factura_validada',
      entidadTipo: 'factura',
      entidadId: id,
      req,
      datosNuevos: { numero, fecha, estado: 'VALIDADA' }
    });

    // --- AUTO-GENERAR Y GUARDAR EN STORAGE ---
    try {
      console.log(`📑 Generando PDF para auto-almacenamiento: ${numero}`);
      const pdfBuffer = await generarPdfFactura(id);
      const baseFolder = await getInvoiceStorageFolder(empresaId);

      const savedFile = await saveToStorage({
        empresaId,
        nombre: `Factura_${numero.replace(/\//g, '-')}.pdf`,
        buffer: pdfBuffer,
        folder: getStoragePath(fecha, baseFolder),
        mimeType: 'application/pdf',
        useTimestamp: false
      });

      // Actualizar path en la factura
      if (savedFile && savedFile.storage_path) {
        await sql`update factura_180 set ruta_pdf = ${savedFile.storage_path} where id = ${id}`;
      }

      console.log(`✅ PDF guardado en Storage para: ${numero}`);
    } catch (storageErr) {
      console.error("⚠️ No se pudo auto-almacenar el PDF:", storageErr);
    }

    res.json({
      success: true,
      message: "Factura validada correctamente",
      numero,
    });
  } catch (err) {
    console.error("❌ validarFactura:", err);
    res.status(500).json({ success: false, error: err.message || "Error validando factura" });
  }
}

/* =========================
   GENERAR NÚMERO DE FACTURA
========================= */

async function generarNumeroFactura(empresaId, fecha) {
  const dateObj = new Date(fecha);
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;
  const day = dateObj.getDate();

  // 1. Obtener configuración del sistema de facturación
  const [config] = await sql`
        select numeracion_tipo, numeracion_formato 
        from configuracionsistema_180 
        where empresa_id=${empresaId}
  `;

  const tipo = config?.numeracion_tipo || 'STANDARD';
  const formato = config?.numeracion_formato || 'FAC-{YEAR}-';

  let correlativo = 1;
  let numeroFinal = "";

  // 2. Determinar correlativo según el tipo
  if (tipo === 'STANDARD') {
    // Numeración continua global: F-0001, F-0002...
    // Buscamos la última factura global válida
    // Numeración continua global: F-0001, F-0002...
    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180 
        WHERE empresa_id = ${empresaId} 
        AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND numero LIKE 'F-%'
    `;
    if (max && max.ultimo) correlativo = max.ultimo + 1;
    numeroFinal = `F-${String(correlativo).padStart(4, '0')}`;

  } else if (tipo === 'BY_YEAR') {
    // Numeración por año: F-2026-0001
    // Buscamos la última de ESTE año
    // Numeración por año: F-2026-0001
    const prefix = `F-${year}-`;
    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180 
        WHERE empresa_id = ${empresaId} 
        AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND numero LIKE ${prefix + '%'}
    `;
    if (max && max.ultimo) correlativo = max.ultimo + 1;
    numeroFinal = `${prefix}${String(correlativo).padStart(4, '0')}`;

  } else if (tipo === 'PREFIXED') {
    // Formato personalizado: ej "AB-{YEAR}-" -> AB-2026-0001
    // 1. Resolver las variables del prefijo
    let resolvedPrefix = formato
      .replace('{YEAR}', year.toString())
      .replace('{MONTH}', month.toString().padStart(2, '0'))
      .replace('{DAY}', day.toString().padStart(2, '0'));

    // Buscamos el mayor número que coincida con el prefijo
    // Intentamos extraer la parte numérica final
    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180 
        WHERE empresa_id = ${empresaId} 
        AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND numero LIKE ${resolvedPrefix + '%'}
    `;

    if (max && max.ultimo) {
      correlativo = max.ultimo + 1;
    }
    numeroFinal = `${resolvedPrefix}${String(correlativo).padStart(4, '0')}`;
  }

  return numeroFinal;
}

/* =========================
   ANULAR FACTURA
========================= */

export async function anularFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [factura] = await sql`
      select * from factura_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    if (factura.estado !== "VALIDADA") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden anular facturas validadas",
      });
    }

    // Verificar si ya existe rectificativa
    const numeroRect = `${factura.numero}R`;
    const [existe] = await sql`
      select 1 from factura_180
      where numero=${numeroRect} and empresa_id=${empresaId}
    `;

    if (existe) {
      return res.status(400).json({
        success: false,
        error: "Ya existe factura rectificativa",
      });
    }

    await sql.begin(async (tx) => {
      // Marcar original como anulada
      await tx`
        update factura_180
        set estado = 'ANULADA'
        where id = ${id}
      `;

      // Obtener líneas originales
      const lineasOriginales = await tx`
        select * from lineafactura_180
        where factura_id=${id}
      `;

      // Crear factura rectificativa
      const [rect] = await tx`
        insert into factura_180 (
          empresa_id, cliente_id, fecha, numero, estado,
          subtotal, iva_total, total, iva_global, mensaje_iva, metodo_pago, created_at
        ) values (
          ${empresaId},
          ${factura.cliente_id},
          current_date,
          ${numeroRect},
          'VALIDADA',
          ${-factura.subtotal},
          ${-factura.iva_total},
          ${-factura.total},
          ${factura.iva_global},
          ${`Factura rectificativa de ${factura.numero}`},
          ${factura.metodo_pago},
          now()
        )
        returning *
      `;

      // Crear líneas negativas
      for (const linea of lineasOriginales) {
        await tx`
          insert into lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id
          ) values (
            ${rect.id},
            ${`(Rectific.) ${linea.descripcion}`},
            ${-linea.cantidad},
            ${linea.precio_unitario},
            ${-linea.total},
            ${linea.concepto_id}
          )
        `;
      }

      // REGISTRAR EN VERIFACTU la rectificativa
      await verificarVerifactu(rect, tx);
    });

    // --- AUTO-GENERAR PDF RECTIFICATIVA ---
    try {
      // Necesitamos el ID de la rectificativa que acabamos de crear
      const [rectData] = await sql`select id, numero, fecha from factura_180 where numero=${numeroRect} and empresa_id=${empresaId} limit 1`;
      if (rectData) {
        console.log(`📑 Generando PDF para rectificativa: ${numeroRect}`);
        const pdfBuffer = await generarPdfFactura(rectData.id);
        const baseFolder = await getInvoiceStorageFolder(empresaId);

        const savedFile = await saveToStorage({
          empresaId,
          nombre: `Factura_${numeroRect.replace(/\//g, '-')}.pdf`,
          buffer: pdfBuffer,
          folder: getStoragePath(rectData.fecha, baseFolder),
          mimeType: 'application/pdf',
          useTimestamp: false
        });

        if (savedFile && savedFile.storage_path) {
          await sql`update factura_180 set ruta_pdf = ${savedFile.storage_path} where id = ${rectData.id}`;
        }
      }
    } catch (err) {
      console.error("⚠️ Error auto-generando PDF rectificativa:", err);
    }

    // Auditoría: Factura original anulada
    await auditFactura({
      empresaId,
      userId: req.user.id,
      accion: 'factura_anulada',
      entidadTipo: 'factura',
      entidadId: id,
      req,
      motivo: `Generada rectificativa ${numeroRect}`
    });

    res.json({
      success: true,
      message: "Factura anulada y rectificativa generada",
      numero_rectificativa: numeroRect,
    });
  } catch (err) {
    console.error("❌ anularFactura:", err);
    res.status(500).json({ success: false, error: "Error anulando factura" });
  }
}

/* =========================
   GENERAR PDF
========================= */

export async function generarPdf(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { modo } = req.query; // TEST or PROD

    const [facturaData] = await sql`
      select numero, fecha from factura_180 where id=${id} limit 1
    `;
    const numToUse = facturaData?.numero || id;
    const fechaToUse = facturaData?.fecha || new Date();

    const pdfBuffer = await generarPdfFactura(id, { modo });

    // --- AUTO-ARCHIVAR Y ACTUALIZAR DB ---
    let savedPath = null;
    try {
      console.log(`📄 [generarPdf] Auto-archivando PDF. ID: ${id}, Num: ${numToUse}`);
      const baseFolder = await getInvoiceStorageFolder(empresaId);
      const savedFile = await saveToStorage({
        empresaId,
        nombre: `Factura_${String(numToUse).replace(/\//g, '-')}.pdf`,
        buffer: pdfBuffer,
        folder: getStoragePath(fechaToUse, baseFolder),
        mimeType: 'application/pdf',
        useTimestamp: false
      });
      console.log(`💾 [generarPdf] Resultado saveToStorage:`, savedFile);

      if (savedFile && savedFile.storage_path) {
        savedPath = savedFile.storage_path;
        await sql`update factura_180 set ruta_pdf = ${savedPath} where id = ${id}`;
        console.log(`✅ [generarPdf] DB actualizada con ruta_pdf: ${savedPath}`);
      } else {
        console.warn(`⚠️ [generarPdf] saveToStorage no retornó file object o path`);
      }
    } catch (archiveErr) {
      console.error("⚠️ [generarPdf] No se pudo auto-archivar el PDF en generarPdf:", archiveErr);
    }

    // SI LA ACCION ES SOLO GUARDAR (desde botón "Crear PDF")
    if (req.query.action === 'save') {
      console.log(`🔄 [generarPdf] Action=save. Retornando JSON.`);
      return res.json({
        success: true,
        message: "PDF Generado y guardado correctamente",
        ruta_pdf: savedPath
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="factura-${numToUse}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ generarPdf:", err);
    res.status(500).json({ success: false, error: "Error generando PDF" });
  }
}

/* =========================
   ENVIAR EMAIL
========================= */

export async function enviarEmail(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { para, asunto, cuerpo, cc, adjuntar_pdf } = req.body;

    if (!para || !asunto) {
      return res.status(400).json({ success: false, error: "Destinatario y asunto requeridos" });
    }

    const [factura] = await sql`
      select * from factura_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    let attachments = [];
    if (adjuntar_pdf) {
      const pdfBuffer = await generarPdfFactura(id);
      attachments.push({
        filename: `factura-${factura.numero || 'borrador'}.pdf`,
        content: pdfBuffer,
      });

      // --- AUTO-ARCHIVAR ---
      try {
        const baseFolder = await getInvoiceStorageFolder(empresaId);
        await saveToStorage({
          empresaId,
          nombre: `Factura_${String(factura.numero || id).replace(/\//g, '-')}.pdf`,
          buffer: pdfBuffer,
          folder: getStoragePath(factura.fecha, baseFolder),
          mimeType: 'application/pdf',
          useTimestamp: false
        });
      } catch (archiveErr) {
        console.error("⚠️ No se pudo auto-archivar el PDF en enviarEmail:", archiveErr);
      }
    }

    // Send email
    await emailService.sendEmail({
      to: para,
      cc,
      subject: asunto,
      html: cuerpo ? cuerpo.replace(/\n/g, "<br>") : "Se adjunta factura.",
      attachments
    }, empresaId);

    // Registrar envío
    await sql`
      insert into envios_email_180 (
        factura_id, destinatario, cc, asunto, cuerpo, enviado, created_at
      ) values (
        ${id},
        ${para},
        ${n(cc)},
        ${asunto},
        ${n(cuerpo)},
        true,
        now()
      )
    `;

    res.json({
      success: true,
      message: "Email enviado correctamente",
    });
  } catch (err) {
    console.error("❌ enviarEmail:", err);
    res.status(500).json({ success: false, error: "Error enviando email: " + err.message });
  }
}

/* =========================
   ELIMINAR FACTURA
========================= */

export async function deleteFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [factura] = await sql`
      select * from factura_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    if (factura.estado !== "BORRADOR") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden eliminar facturas en borrador",
      });
    }

    await sql.begin(async (tx) => {
      await tx`delete from lineafactura_180 where factura_id=${id}`;
      await tx`delete from factura_180 where id=${id}`;
    });

    // Auditoría
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      accion: 'factura_eliminada',
      entidadTipo: 'factura',
      entidadId: id,
      req,
      datosAnteriores: factura
    });

    res.json({ success: true, message: "Factura eliminada" });
  } catch (err) {
    console.error("❌ deleteFactura:", err);
    res.status(500).json({ success: false, error: "Error eliminando factura" });
  }
}
