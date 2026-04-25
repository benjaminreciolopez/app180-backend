// backend/src/controllers/facturasController.js

import { sql } from "../db.js";
import { generarPdfFactura } from "../services/facturaPdfService.js";
import * as emailService from "../services/emailService.js";
import { verificarVerifactu, crearRegistroAnulacion } from "../services/verifactuService.js";
import { enviarRegistroAeat } from "../services/verifactuAeatService.js";
import { registrarAuditoria } from "../middlewares/auditMiddleware.js";
import { generarAsientoFactura, assertEjercicioAbierto } from "../services/contabilidadService.js";
import { saveToStorage } from "./storageController.js";
import { registrarEventoVerifactu } from "./verifactuEventosController.js";

/* =========================
   Helpers
========================= */

async function getEmpresaId(userIdOrReq) {
  // Soportar tanto getEmpresaId(req) como getEmpresaId(req)
  if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
    if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
    userIdOrReq = userIdOrReq.user.id;
  }

  const r = await sql`
    select id from empresa_180
    where user_id=${userIdOrReq}
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

// REAGP: el autónomo agrícola/ganadero/pesca no repercute IVA (Art. 130 LIVA)
// pero percibe compensación a tanto alzado (12% agric/forestal o 10,5% ganadería/pesca).
async function loadRegimenEmisor(executor, empresaId) {
  const [row] = await executor`
    select coalesce(regimen_iva, 'general') as regimen_iva,
           compensacion_reagp_pct
    from emisor_180
    where empresa_id = ${empresaId}
    limit 1
  `;
  return {
    regimen_iva: row?.regimen_iva || 'general',
    compensacion_reagp_pct: row?.compensacion_reagp_pct != null ? parseFloat(row.compensacion_reagp_pct) : null,
  };
}

// Devuelve el iva_pct efectivo para una línea según el régimen del emisor.
function ivaPctSegunRegimen(regimen, ivaPctSolicitado) {
  if (regimen.regimen_iva === 'agricultura') return 0;
  return ivaPctSolicitado;
}

// Calcula la compensación REAGP para un subtotal dado.
function compensacionReagpDe(regimen, subtotal) {
  if (regimen.regimen_iva !== 'agricultura' || regimen.compensacion_reagp_pct == null) {
    return { pct: null, importe: 0 };
  }
  const pct = regimen.compensacion_reagp_pct;
  const importe = Math.round(subtotal * pct) / 100;
  return { pct, importe };
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
    return folder;
  } catch (e) {
    console.error(`[getInvoiceStorageFolder] Error: ${e.message}, usando default`);
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
      empresaId = await getEmpresaId(req);
    }

    const { estado, cliente_id, fecha_desde, fecha_hasta, year, es_test } = req.query;

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
        AND f.deleted_at IS NULL
    `;

    if (es_test === 'true') {
      query = sql`${query} AND f.es_test = true`;
    } else {
      query = sql`${query} AND (f.es_test IS NOT TRUE)`;
    }

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
    console.error("Error listFacturas:", err);
    res.status(500).json({ success: false, error: "Error listando facturas" });
  }
}


/* =========================
   ÚLTIMA FECHA VALIDA
========================= */

export async function previewNextNumber(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const fecha = req.query.fecha || new Date().toISOString().split("T")[0];
    const dateObj = new Date(fecha);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();

    // Misma lógica que generarNumeroFactura() pero sin escribir en DB
    const [config] = await sql`
      SELECT numeracion_tipo, numeracion_formato, correlativo_inicial, serie, verifactu_activo, verifactu_modo
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
    `;

    if (!config) {
      return res.json({ success: true, numero: null });
    }

    const tipo = config.numeracion_tipo || 'STANDARD';
    const formato = config.numeracion_formato || 'FAC-{YEAR}-';
    const serieBase = config.serie || 'F';
    const correlativoBase = config.correlativo_inicial || 0;

    // En modo test, mostrar siguiente TEST
    const esModoTest = config.verifactu_activo && config.verifactu_modo === 'TEST';
    if (esModoTest) {
      const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId} AND es_test = true AND numero LIKE 'TEST-%'
      `;
      const testCorrelativo = (max?.ultimo || 0) + 1;
      return res.json({ success: true, numero: `TEST-${String(testCorrelativo).padStart(4, '0')}`, esTest: true });
    }

    let correlativo = 1;
    let numeroFinal = "";

    if (tipo === 'STANDARD') {
      const prefix = `${serieBase}-`;
      const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId} AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND (es_test IS NOT TRUE) AND numero LIKE ${prefix + '%'}
      `;
      correlativo = (max?.ultimo) ? Math.max(correlativoBase, max.ultimo) + 1 : correlativoBase + 1;
      numeroFinal = `${prefix}${String(correlativo).padStart(4, '0')}`;

    } else if (tipo === 'BY_YEAR') {
      const prefix = `${serieBase}-${year}-`;
      const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId} AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND (es_test IS NOT TRUE) AND numero LIKE ${prefix + '%'}
      `;
      correlativo = (max?.ultimo) ? Math.max(correlativoBase, max.ultimo) + 1 : correlativoBase + 1;
      numeroFinal = `${prefix}${String(correlativo).padStart(4, '0')}`;

    } else if (tipo === 'PREFIXED') {
      const resolvedPrefix = formato
        .replace('{YEAR}', year.toString())
        .replace('{MONTH}', month.toString().padStart(2, '0'))
        .replace('{DAY}', day.toString().padStart(2, '0'));
      const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId} AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND (es_test IS NOT TRUE) AND numero LIKE ${resolvedPrefix + '%'}
      `;
      correlativo = (max?.ultimo) ? Math.max(correlativoBase, max.ultimo) + 1 : correlativoBase + 1;
      numeroFinal = `${resolvedPrefix}${String(correlativo).padStart(4, '0')}`;
    }

    res.json({ success: true, numero: numeroFinal });
  } catch (err) {
    console.error("Error previewNextNumber:", err);
    res.status(500).json({ success: false, error: "Error previsualizando número" });
  }
}

export async function getLastValidDate(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

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
    console.error("Error getLastValidDate:", err);
    res.status(500).json({ success: false, error: "Error obteniendo última fecha" });
  }
}

/* =========================
   DETALLE DE FACTURA
========================= */

export async function getFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
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
    console.error("Error getFactura:", err);
    res.status(500).json({ success: false, error: "Error obteniendo factura" });
  }
}

/* =========================
   CREAR FACTURA (BORRADOR)
========================= */

export async function createFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { cliente_id, fecha, iva_global, lineas = [], mensaje_iva, metodo_pago, work_log_ids = [], retencion_porcentaje = 0, tipo_factura = 'NORMAL' } = req.body;

    if (!cliente_id) {
      return res.status(400).json({ success: false, error: "Cliente requerido" });
    }

    if (!fecha || isNaN(Date.parse(fecha))) {
      return res.status(400).json({ success: false, error: "Fecha requerida y debe ser válida (YYYY-MM-DD)" });
    }

    await assertEjercicioAbierto(empresaId, fecha);

    // Validar iva_global es numérico y razonable
    const ivaNum = Number(iva_global);
    if (iva_global != null && (typeof iva_global === 'boolean' || isNaN(ivaNum) || ivaNum < 0 || ivaNum > 100)) {
      return res.status(400).json({ success: false, error: "IVA debe ser un número entre 0 y 100" });
    }

    if (!Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ success: false, error: "Debe incluir al menos una línea" });
    }

    // Validar líneas: cantidades y precios razonables
    if (lineas.length > 1000) {
      return res.status(400).json({ success: false, error: "Máximo 1000 líneas por factura" });
    }

    for (const linea of lineas) {
      const cant = Number(linea.cantidad);
      const precio = Number(linea.precio_unitario);
      if (isNaN(cant) || isNaN(precio) || Math.abs(cant) > 999999999 || Math.abs(precio) > 999999999) {
        return res.status(400).json({ success: false, error: "Cantidad y precio deben ser números válidos" });
      }
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
      const regimen = await loadRegimenEmisor(tx, empresaId);
      let subtotal = 0;
      let iva_total = 0;

      // Crear factura
      const [factura] = await tx`
        insert into factura_180 (
          empresa_id, cliente_id, fecha, estado, iva_global, mensaje_iva, metodo_pago,
          subtotal, iva_total, total,
          retencion_porcentaje, retencion_importe,
          tipo_factura,
          created_at
        ) values (
          ${empresaId},
          ${cliente_id},
          ${fecha}::date,
          'BORRADOR',
          ${regimen.regimen_iva === 'agricultura' ? 0 : (n(iva_global) || 0)},
          ${n(mensaje_iva)},
          ${n(metodo_pago) || 'TRANSFERENCIA'},
          0, 0, 0,
          ${retencion_porcentaje}, 0,
          ${tipo_factura},
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
        const iva_pct = ivaPctSegunRegimen(regimen, parseFloat(linea.iva || iva_global || 0));
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

      const compensacion = compensacionReagpDe(regimen, subtotal);
      const retencion_importe = (subtotal * retencion_porcentaje) / 100;
      const total = subtotal + iva_total + compensacion.importe - retencion_importe;

      const [updated] = await tx`
        update factura_180
        set subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            compensacion_reagp_pct = ${compensacion.pct},
            compensacion_reagp_importe = ${compensacion.importe},
            retencion_importe = ${Math.round(retencion_importe * 100) / 100},
            total = ${Math.round(total * 100) / 100}
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

    // --- AUTO-VALIDACIÓN EN MODO TEST ---
    // En modo TEST las facturas son ficticias (prueba de envío a AEAT),
    // no necesitan pasar por BORRADOR → se validan automáticamente.
    const [verifactuCfg] = await sql`
      select verifactu_activo, verifactu_modo
      from configuracionsistema_180
      where empresa_id = ${empresaId}
      limit 1
    `;

    const esModoTest = verifactuCfg?.verifactu_activo && verifactuCfg?.verifactu_modo === 'TEST';

    if (esModoTest && tipo_factura !== 'PROFORMA') {
      const facturaId = createdFactura.id;
      const numero = await generarNumeroFactura(empresaId, fecha);

      let verifactuResult = null;
      await sql.begin(async (tx) => {
        const regimen = await loadRegimenEmisor(tx, empresaId);
        const lineas_db = await tx`select * from lineafactura_180 where factura_id=${facturaId}`;

        let subtotal = 0;
        let iva_total = 0;
        for (const l of lineas_db) {
          const base = l.cantidad * l.precio_unitario;
          subtotal += base;
          iva_total += (base * (l.iva_percent || createdFactura.iva_global || 0) / 100);
        }

        const compensacion = compensacionReagpDe(regimen, subtotal);
        const ret_pct = createdFactura.retencion_porcentaje || 0;
        const ret_imp = (subtotal * ret_pct) / 100;
        const total = Math.round((subtotal + iva_total + compensacion.importe - ret_imp) * 100) / 100;

        const [updatedRecord] = await tx`
          update factura_180
          set estado = 'VALIDADA',
              numero = ${numero},
              serie = 'TEST',
              fecha = ${fecha}::date,
              fecha_validacion = current_date,
              es_test = true,
              subtotal = ${Math.round(subtotal * 100) / 100},
              iva_total = ${Math.round(iva_total * 100) / 100},
              iva_global = ${Math.round(iva_total * 100) / 100},
              compensacion_reagp_pct = ${compensacion.pct},
              compensacion_reagp_importe = ${compensacion.importe},
              retencion_importe = ${Math.round(ret_imp * 100) / 100},
              total = ${total}
          where id = ${facturaId}
          returning *
        `;

        verifactuResult = await verificarVerifactu(updatedRecord, tx);

        // TEST: no bloquear numeración
        const year = new Date(fecha).getFullYear();
        await tx`
          update emisor_180
          set ultimo_anio_numerado = ${year}
          where empresa_id = ${empresaId}
        `;
      });

      // Envío a AEAT post-transacción (fire-and-forget)
      if (verifactuResult?.registroId) {
        const { registroId, config: vfConfig } = verifactuResult;
        enviarRegistroAeat(registroId, 'PRUEBAS', vfConfig.verifactu_certificado_path, vfConfig.verifactu_certificado_password)
          .catch(err => console.error('VeriFactu TEST: envío async falló:', err.message));
      }

      // Auditoría
      await auditFactura({
        empresaId,
        userId: req.user.id,
        accion: 'factura_validada',
        entidadTipo: 'factura',
        entidadId: facturaId,
        req,
        datosNuevos: { numero, fecha, estado: 'VALIDADA', es_test: true }
      });

      registrarEventoVerifactu({
        empresaId,
        userId: req.user.id,
        tipoEvento: 'ALTA',
        descripcion: `Factura TEST ${numero} auto-validada — Total: ${createdFactura.total}€ — Hash: ${verifactuResult?.hash || 'N/A'}`,
        metaData: { factura_id: facturaId, numero, total: createdFactura.total, hash: verifactuResult?.hash, es_test: true }
      });


      return res.status(201).json({
        success: true,
        message: "Factura de prueba creada y validada automáticamente",
        numero,
        es_test: true
      });
    }

    res.status(201).json({ success: true, message: "Factura creada en borrador" });
  } catch (err) {
    console.error("Error createFactura:", err);
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: "Error creando factura" });
  }
}

/* =========================
   ACTUALIZAR FACTURA (BORRADOR)
========================= */

export async function updateFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { id } = req.params;
    const { cliente_id, fecha, iva_global, lineas = [], mensaje_iva, metodo_pago, work_log_ids = [], retencion_porcentaje = 0 } = req.body;

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

    // Bloquea editar si la fecha original o la nueva caen en ejercicio cerrado.
    await assertEjercicioAbierto(empresaId, factura.fecha);
    if (fecha) await assertEjercicioAbierto(empresaId, fecha);

    if (!Array.isArray(lineas)) {
      return res.status(400).json({ success: false, error: "Líneas deben ser un array" });
    }

    await sql.begin(async (tx) => {
      const regimen = await loadRegimenEmisor(tx, empresaId);
      const ivaGlobalEfectivo = regimen.regimen_iva === 'agricultura'
        ? 0
        : (n(iva_global) ?? factura.iva_global);

      // Actualizar datos básicos
      await tx`
        update factura_180
        set cliente_id = ${n(cliente_id) || factura.cliente_id},
            fecha = ${n(fecha) || factura.fecha}::date,
            iva_global = ${ivaGlobalEfectivo},
            mensaje_iva = ${n(mensaje_iva) || factura.mensaje_iva},
            metodo_pago = ${n(metodo_pago) || factura.metodo_pago},
            retencion_porcentaje = ${retencion_porcentaje}
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
        const iva_pct = ivaPctSegunRegimen(regimen, parseFloat(linea.iva || iva_global || 0));
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

      const compensacion = compensacionReagpDe(regimen, subtotal);
      const retencion_importe = (subtotal * retencion_porcentaje) / 100;
      const total = subtotal + iva_total + compensacion.importe - retencion_importe;

      await tx`
        update factura_180
        set subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            compensacion_reagp_pct = ${compensacion.pct},
            compensacion_reagp_importe = ${compensacion.importe},
            retencion_importe = ${Math.round(retencion_importe * 100) / 100},
            total = ${Math.round(total * 100) / 100}
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
    console.error("Error updateFactura:", err);
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: "Error actualizando factura" });
  }
}

/* =========================
   VALIDAR FACTURA
========================= */

export async function validarFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
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

    await assertEjercicioAbierto(empresaId, fecha);

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

    // Obtener configuración para la serie
    const [config] = await sql`select serie from configuracionsistema_180 where empresa_id=${empresaId}`;
    const serie = config?.serie || null;

    // Generar número de factura
    // PROFORMA: número especial sin consumir numeración oficial
    let numero;
    if (factura.tipo_factura === 'PROFORMA') {
      // Generar número único de proforma: PRO-YYYY-XXXXXX
      const year = new Date(fecha).getFullYear();
      const count = await sql`
        SELECT COUNT(*) as total FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND tipo_factura = 'PROFORMA'
          AND EXTRACT(YEAR FROM fecha) = ${year}
      `;
      const nextNum = (parseInt(count[0]?.total || 0) + 1).toString().padStart(6, '0');
      numero = `PRO-${year}-${nextNum}`;
    } else {
      // Factura NORMAL: usa numeración oficial
      numero = await generarNumeroFactura(empresaId, fecha);
    }

    let verifactuResult = null;
    await sql.begin(async (tx) => {
      const regimen = await loadRegimenEmisor(tx, empresaId);
      // Obtener líneas para recalcular
      const lineas = await tx`select * from lineafactura_180 where factura_id=${id}`;

      let subtotal = 0;
      let iva_total = 0;
      for (const l of lineas) {
        const base = l.cantidad * l.precio_unitario;
        subtotal += base;
        const ivaPct = ivaPctSegunRegimen(regimen, l.iva_percent || factura.iva_global || 0);
        iva_total += (base * ivaPct / 100);
      }

      const compensacion = compensacionReagpDe(regimen, subtotal);
      const retencion_porcentaje = factura.retencion_porcentaje || 0;
      const retencion_importe = (subtotal * retencion_porcentaje) / 100;
      const total = Math.round((subtotal + iva_total + compensacion.importe - retencion_importe) * 100) / 100;

      // Actualizar factura
      const [updatedRecord] = await tx`
        update factura_180
        set estado = 'VALIDADA',
            numero = ${numero},
            serie = ${serie},
            fecha = ${fecha}::date,
            fecha_validacion = current_date,
            mensaje_iva = ${mensaje_iva !== undefined ? n(mensaje_iva) : sql`mensaje_iva`},
            subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            iva_global = ${Math.round(iva_total * 100) / 100},
            compensacion_reagp_pct = ${compensacion.pct},
            compensacion_reagp_importe = ${compensacion.importe},
            retencion_importe = ${Math.round(retencion_importe * 100) / 100},
            total = ${total}
        where id = ${id}
        returning *
      `;

      // Verificar Veri*Factu (si aplica) con el registro actualizado
      // PROFORMA: NO se envía a VeriFactu
      if (factura.tipo_factura !== 'PROFORMA') {
        verifactuResult = await verificarVerifactu(updatedRecord, tx);
      }

      // Bloquear numeración SOLO si VeriFactu está en PRODUCCION (o desactivado)
      // En modo TEST NO se bloquea para permitir pruebas
      // PROFORMA: NUNCA bloquea numeración
      if (factura.tipo_factura !== 'PROFORMA') {
        const [verifactuConfig] = await tx`
          select verifactu_activo, verifactu_modo
          from configuracionsistema_180
          where empresa_id = ${empresaId}
          limit 1
        `;

        const year = new Date(fecha).getFullYear();
        const esProduccion = !verifactuConfig?.verifactu_activo || verifactuConfig?.verifactu_modo !== 'TEST';

        if (esProduccion) {
          // PRODUCCION o VeriFactu OFF: Bloquear numeración irreversiblemente
          await tx`
            update emisor_180
          set
            numeracion_bloqueada = true,
            anio_numeracion_bloqueada = ${year},
            ultimo_anio_numerado = ${year}
          where empresa_id = ${empresaId}
        `;
      } else {
        // TEST: Solo actualizar el año, NO bloquear
        await tx`
          update emisor_180
          set ultimo_anio_numerado = ${year}
          where empresa_id = ${empresaId}
        `;
        }
      } // Cierre del if para factura no-proforma
    });

    // Envío a AEAT post-transacción (fire-and-forget, no bloquea la respuesta HTTP)
    if (verifactuResult?.registroId) {
      const { registroId, config: vfConfig } = verifactuResult;
      const entorno = vfConfig.verifactu_modo === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS';
      enviarRegistroAeat(registroId, entorno, vfConfig.verifactu_certificado_path, vfConfig.verifactu_certificado_password)
        .catch(err => console.error('VeriFactu: envío async falló:', err.message));
    }

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

    // Registro evento Veri*Factu para auditoría fiscal
    registrarEventoVerifactu({
      empresaId,
      userId: req.user.id,
      tipoEvento: 'ALTA',
      descripcion: `Factura ${numero} validada — Total: ${factura.total}€ — Hash: ${verifactuResult?.hash || 'N/A'}`,
      metaData: { factura_id: id, numero, total: factura.total, hash: verifactuResult?.hash }
    });

    // --- AUTO-GENERAR ASIENTO CONTABLE (solo facturas reales, NO test) ---
    if (factura.tipo_factura !== 'PROFORMA' && !factura.es_test) {
      try {
        const [facturaFinal] = await sql`
          SELECT f.*, c.nombre AS cliente_nombre
          FROM factura_180 f
          LEFT JOIN clients_180 c ON c.id = f.cliente_id
          WHERE f.id = ${id}
        `;
        if (facturaFinal) {
          await generarAsientoFactura(empresaId, facturaFinal, req.user?.id || null);
        }
      } catch (contErr) {
        console.error("[Facturas] Error generando asiento de venta:", contErr.message);
      }
    } else if (factura.es_test) {
    }

    // --- AUTO-GENERAR Y GUARDAR EN STORAGE (solo facturas reales) ---
    if (!factura.es_test) {
      try {
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

        if (savedFile && savedFile.storage_path) {
          await sql`update factura_180 set ruta_pdf = ${savedFile.storage_path} where id = ${id}`;
        }

      } catch (storageErr) {
        console.error("No se pudo auto-almacenar el PDF:", storageErr);
      }
    }

    res.json({
      success: true,
      message: "Factura validada correctamente",
      numero,
    });
  } catch (err) {
    console.error("Error validarFactura:", err);
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message || "Error validando factura" });
  }
}

/* =========================
   VALIDACIÓN EN LOTE (BATCH)
========================= */

export async function batchValidar(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { ids, fecha } = req.body;

    if (!fecha) {
      return res.status(400).json({ success: false, error: "Fecha requerida" });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "Debes seleccionar al menos una factura" });
    }
    if (ids.length > 200) {
      return res.status(400).json({ success: false, error: "Máximo 200 facturas por lote" });
    }

    // Validar orden cronológico una sola vez
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

    const [config] = await sql`select serie from configuracionsistema_180 where empresa_id=${empresaId}`;
    const serie = config?.serie || null;

    const validated = [];
    const failed = [];

    // Procesar secuencialmente para mantener numeración correlativa
    for (const facturaId of ids) {
      try {
        const [factura] = await sql`
          select * from factura_180
          where id=${facturaId} and empresa_id=${empresaId}
          limit 1
        `;

        if (!factura) {
          failed.push({ id: facturaId, error: "Factura no encontrada" });
          continue;
        }
        if (factura.estado !== 'BORRADOR') {
          failed.push({ id: facturaId, error: `Estado actual: ${factura.estado}` });
          continue;
        }

        // Generar número
        let numero;
        if (factura.tipo_factura === 'PROFORMA') {
          const year = new Date(fecha).getFullYear();
          const count = await sql`
            SELECT COUNT(*) as total FROM factura_180
            WHERE empresa_id = ${empresaId}
              AND tipo_factura = 'PROFORMA'
              AND EXTRACT(YEAR FROM fecha) = ${year}
          `;
          const nextNum = (parseInt(count[0]?.total || 0) + 1).toString().padStart(6, '0');
          numero = `PRO-${year}-${nextNum}`;
        } else {
          numero = await generarNumeroFactura(empresaId, fecha);
        }

        let verifactuResult = null;
        await sql.begin(async (tx) => {
          const regimen = await loadRegimenEmisor(tx, empresaId);
          const lineas = await tx`select * from lineafactura_180 where factura_id=${facturaId}`;

          let subtotal = 0;
          let iva_total = 0;
          for (const l of lineas) {
            const base = l.cantidad * l.precio_unitario;
            subtotal += base;
            const ivaPct = ivaPctSegunRegimen(regimen, l.iva_percent || factura.iva_global || 0);
            iva_total += (base * ivaPct / 100);
          }

          const compensacion = compensacionReagpDe(regimen, subtotal);
          const retencion_porcentaje = factura.retencion_porcentaje || 0;
          const retencion_importe = (subtotal * retencion_porcentaje) / 100;
          const total = Math.round((subtotal + iva_total + compensacion.importe - retencion_importe) * 100) / 100;

          const [updatedRecord] = await tx`
            update factura_180
            set estado = 'VALIDADA',
                numero = ${numero},
                serie = ${serie},
                fecha = ${fecha}::date,
                fecha_validacion = current_date,
                subtotal = ${Math.round(subtotal * 100) / 100},
                iva_total = ${Math.round(iva_total * 100) / 100},
                iva_global = ${Math.round(iva_total * 100) / 100},
                compensacion_reagp_pct = ${compensacion.pct},
                compensacion_reagp_importe = ${compensacion.importe},
                retencion_importe = ${Math.round(retencion_importe * 100) / 100},
                total = ${total}
            where id = ${facturaId}
            returning *
          `;

          if (factura.tipo_factura !== 'PROFORMA') {
            verifactuResult = await verificarVerifactu(updatedRecord, tx);
          }

          if (factura.tipo_factura !== 'PROFORMA') {
            const [verifactuConfig] = await tx`
              select verifactu_activo, verifactu_modo
              from configuracionsistema_180
              where empresa_id = ${empresaId}
              limit 1
            `;
            const year = new Date(fecha).getFullYear();
            const esProduccion = !verifactuConfig?.verifactu_activo || verifactuConfig?.verifactu_modo !== 'TEST';
            if (esProduccion) {
              await tx`
                update emisor_180
                set numeracion_bloqueada = true,
                    anio_numeracion_bloqueada = ${year},
                    ultimo_anio_numerado = ${year}
                where empresa_id = ${empresaId}
              `;
            } else {
              await tx`
                update emisor_180
                set ultimo_anio_numerado = ${year}
                where empresa_id = ${empresaId}
              `;
            }
          }
        });

        // Envío AEAT (fire-and-forget)
        if (verifactuResult?.registroId) {
          const { registroId, config: vfConfig } = verifactuResult;
          const entorno = vfConfig.verifactu_modo === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS';
          enviarRegistroAeat(registroId, entorno, vfConfig.verifactu_certificado_path, vfConfig.verifactu_certificado_password)
            .catch(err => console.error('VeriFactu batch: envío async falló:', err.message));
        }

        // Auditoría
        await auditFactura({
          empresaId,
          userId: req.user.id,
          accion: 'factura_validada',
          entidadTipo: 'factura',
          entidadId: facturaId,
          req,
          datosNuevos: { numero, fecha, estado: 'VALIDADA' }
        });

        // Asiento contable
        if (factura.tipo_factura !== 'PROFORMA' && !factura.es_test) {
          try {
            const [facturaFinal] = await sql`
              SELECT f.*, c.nombre AS cliente_nombre
              FROM factura_180 f
              LEFT JOIN clients_180 c ON c.id = f.cliente_id
              WHERE f.id = ${facturaId}
            `;
            if (facturaFinal) {
              await generarAsientoFactura(empresaId, facturaFinal, req.user?.id || null);
            }
          } catch (contErr) {
            console.error(`[Batch] Error asiento factura ${facturaId}:`, contErr.message);
          }
        }

        // PDF (fire-and-forget para no bloquear el lote)
        if (!factura.es_test) {
          (async () => {
            try {
              const pdfBuffer = await generarPdfFactura(facturaId);
              const baseFolder = await getInvoiceStorageFolder(empresaId);
              const savedFile = await saveToStorage({
                empresaId,
                nombre: `Factura_${numero.replace(/\//g, '-')}.pdf`,
                buffer: pdfBuffer,
                folder: getStoragePath(fecha, baseFolder),
                mimeType: 'application/pdf',
                useTimestamp: false
              });
              if (savedFile?.storage_path) {
                await sql`update factura_180 set ruta_pdf = ${savedFile.storage_path} where id = ${facturaId}`;
              }
            } catch (e) {
              console.error(`Batch PDF ${facturaId}:`, e.message);
            }
          })();
        }

        validated.push({ id: facturaId, numero, total: factura.total });

      } catch (err) {
        console.error(`[Batch] Error validando factura ${facturaId}:`, err.message);
        failed.push({ id: facturaId, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `${validated.length} facturas validadas, ${failed.length} errores`,
      validated,
      failed
    });
  } catch (err) {
    console.error("Error batchValidar:", err);
    res.status(500).json({ success: false, error: err.message || "Error en validación por lote" });
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

  // 1. Obtener configuración del sistema de facturación (incluyendo VeriFactu)
  const [config] = await sql`
        select numeracion_tipo, numeracion_formato, correlativo_inicial, migracion_legal_aceptado, migracion_last_pdf, serie, verifactu_activo, verifactu_modo
        from configuracionsistema_180
        where empresa_id=${empresaId}
  `;

  // --- BLOQUEO ESTRICTO DE MIGRACIÓN PENDIENTE ---
  if (config && (config.correlativo_inicial > 0)) {
    if (!config.migracion_legal_aceptado || !config.migracion_last_pdf) {
      const err = new Error("Migración fiscal pendiente. Debes subir la última factura y aceptar la responsabilidad legal en Configuración.");
      err.status = 403;
      throw err;
    }
  }

  const tipo = config?.numeracion_tipo || 'STANDARD';
  const formato = config?.numeracion_formato || 'FAC-{YEAR}-';
  let serieBase = config?.serie || 'F';

  // VeriFactu MODE TEST: Usar serie y secuencia COMPLETAMENTE separada
  const esModoTest = config?.verifactu_activo && config?.verifactu_modo === 'TEST';
  if (esModoTest) {
    // Serie TEST con secuencia independiente: TEST-0001, TEST-0002...
    // Solo busca entre facturas es_test=true para no consumir numeración real
    const testPrefix = 'TEST-';
    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND es_test = true
        AND numero LIKE ${testPrefix + '%'}
    `;
    const testCorrelativo = (max?.ultimo || 0) + 1;
    return `${testPrefix}${String(testCorrelativo).padStart(4, '0')}`;
  }

  let correlativoBase = (config?.correlativo_inicial || 0);
  let correlativo = 1;
  let numeroFinal = "";

  // 2. Determinar correlativo según el tipo (solo facturas reales, excluir test)
  if (tipo === 'STANDARD') {
    // Numeración continua global: SERIE-0001, SERIE-0002...
    const prefix = `${serieBase}-`;
    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND (es_test IS NOT TRUE)
        AND numero LIKE ${prefix + '%'}
    `;
    if (max && max.ultimo) correlativo = Math.max(correlativoBase, max.ultimo) + 1;
    else correlativo = correlativoBase + 1;
    numeroFinal = `${prefix}${String(correlativo).padStart(4, '0')}`;

  } else if (tipo === 'BY_YEAR') {
    // Numeración por año: SERIE-2026-0001
    const prefix = `${serieBase}-${year}-`;
    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '-([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND (es_test IS NOT TRUE)
        AND numero LIKE ${prefix + '%'}
    `;
    if (max && max.ultimo) correlativo = Math.max(correlativoBase, max.ultimo) + 1;
    else correlativo = correlativoBase + 1;
    numeroFinal = `${prefix}${String(correlativo).padStart(4, '0')}`;

  } else if (tipo === 'PREFIXED') {
    // Formato personalizado: ej "AB-{YEAR}-" -> AB-2026-0001
    let resolvedPrefix = formato
      .replace('{YEAR}', year.toString())
      .replace('{MONTH}', month.toString().padStart(2, '0'))
      .replace('{DAY}', day.toString().padStart(2, '0'));

    const [max] = await sql`
        SELECT MAX(CAST(SUBSTRING(numero FROM '([0-9]+)$') AS INTEGER)) as ultimo
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ENVIADA', 'ANULADA')
        AND (es_test IS NOT TRUE)
        AND numero LIKE ${resolvedPrefix + '%'}
    `;

    if (max && max.ultimo) {
      correlativo = Math.max(correlativoBase, max.ultimo) + 1;
    } else {
      correlativo = correlativoBase + 1;
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
    const empresaId = await getEmpresaId(req);
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

    await assertEjercicioAbierto(empresaId, factura.fecha);

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

    let verifactuResultRect = null;
    let verifactuResultAnulacion = null;
    await sql.begin(async (tx) => {
      // Marcar original como anulada
      await tx`
        update factura_180
        set estado = 'ANULADA'
        where id = ${id}
      `;

      // RegistroAnulacion AEAT (RD 1007/2023): cancelar la factura original
      // antes de crear la rectificativa. La cadena de huellas continúa.
      verifactuResultAnulacion = await crearRegistroAnulacion(
        factura,
        `Anulada por usuario; rectificativa ${numeroRect}`,
        tx
      );

      // Obtener líneas originales
      const lineasOriginales = await tx`
        select * from lineafactura_180
        where factura_id=${id}
      `;

      // Crear factura rectificativa
      const [rect] = await tx`
        insert into factura_180 (
          empresa_id, cliente_id, fecha, numero, estado,
          subtotal, iva_total, total, iva_global, mensaje_iva, metodo_pago,
          rectificativa, created_at
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
          true,
          now()
        )
        returning *
      `;

      // Vincular original → rectificativa (Art. 89 LIVA): permite que el
      // modelo 303 mantenga la original en su periodo y aplique la negativa
      // en el periodo de la rectificativa.
      await tx`
        update factura_180
        set factura_rectificativa_id = ${rect.id}
        where id = ${id}
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
      verifactuResultRect = await verificarVerifactu(rect, tx);
    });

    // Envío a AEAT post-transacción (fire-and-forget): primero la anulación
    // del original, luego la rectificativa, en ese orden lógico.
    if (verifactuResultAnulacion?.registroId) {
      const { registroId, config: vfConfig } = verifactuResultAnulacion;
      const entorno = vfConfig.verifactu_modo === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS';
      enviarRegistroAeat(registroId, entorno, vfConfig.verifactu_certificado_path, vfConfig.verifactu_certificado_password)
        .catch(err => console.error('VeriFactu: envío async anulación falló:', err.message));
    }
    if (verifactuResultRect?.registroId) {
      const { registroId, config: vfConfig } = verifactuResultRect;
      const entorno = vfConfig.verifactu_modo === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS';
      enviarRegistroAeat(registroId, entorno, vfConfig.verifactu_certificado_path, vfConfig.verifactu_certificado_password)
        .catch(err => console.error('VeriFactu: envío async rectificativa falló:', err.message));
    }

    // --- AUTO-GENERAR PDF RECTIFICATIVA ---
    try {
      // Necesitamos el ID de la rectificativa que acabamos de crear
      const [rectData] = await sql`select id, numero, fecha from factura_180 where numero=${numeroRect} and empresa_id=${empresaId} limit 1`;
      if (rectData) {
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
      console.error("Error auto-generando PDF rectificativa:", err);
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

    // Registro evento Veri*Factu
    registrarEventoVerifactu({
      empresaId,
      userId: req.user.id,
      tipoEvento: 'ANULACION',
      descripcion: `Factura ${factura.numero} anulada — Rectificativa: ${numeroRect}`,
      metaData: { factura_id: id, numero_original: factura.numero, numero_rectificativa: numeroRect }
    });

    res.json({
      success: true,
      message: "Factura anulada y rectificativa generada",
      numero_rectificativa: numeroRect,
    });
  } catch (err) {
    console.error("Error anularFactura:", err);
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: "Error anulando factura" });
  }
}

/* =========================
   GENERAR PDF
========================= */

export async function generarPdf(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
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
      const baseFolder = await getInvoiceStorageFolder(empresaId);
      const savedFile = await saveToStorage({
        empresaId,
        nombre: `Factura_${String(numToUse).replace(/\//g, '-')}.pdf`,
        buffer: pdfBuffer,
        folder: getStoragePath(fechaToUse, baseFolder),
        mimeType: 'application/pdf',
        useTimestamp: false
      });

      if (savedFile && savedFile.storage_path) {
        savedPath = savedFile.storage_path;
        await sql`update factura_180 set ruta_pdf = ${savedPath} where id = ${id}`;
      } else {
        console.warn(`[generarPdf] saveToStorage no retornó file object o path`);
      }
    } catch (archiveErr) {
      console.error("[generarPdf] No se pudo auto-archivar el PDF en generarPdf:", archiveErr);
    }

    // SI LA ACCION ES SOLO GUARDAR (desde botón "Crear PDF")
    if (req.query.action === 'save') {
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
    console.error("Error generarPdf:", err);
    res.status(500).json({ success: false, error: "Error generando PDF" });
  }
}

/* =========================
   ENVIAR EMAIL
========================= */

export async function enviarEmail(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
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
        console.error("No se pudo auto-archivar el PDF en enviarEmail:", archiveErr);
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
    console.error("Error enviarEmail:", err);
    res.status(500).json({ success: false, error: "Error enviando email: " + err.message });
  }
}

/* =========================
   ELIMINAR FACTURA
========================= */

export async function deleteFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
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
    console.error("Error deleteFactura:", err);
    res.status(500).json({ success: false, error: "Error eliminando factura" });
  }
}

/* =========================
   CONVERTIR PROFORMA A FACTURA NORMAL
========================= */

export async function convertirProformaANormal(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { id } = req.params;
    const { fecha } = req.body;

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

    if (factura.tipo_factura !== 'PROFORMA') {
      return res.status(400).json({ success: false, error: "Solo se pueden convertir facturas proforma" });
    }

    if (factura.estado !== 'VALIDADA') {
      return res.status(400).json({ success: false, error: "La proforma debe estar validada primero" });
    }

    // Cambiar a factura normal y volver a borrador para que se valide con número oficial
    await sql`
      update factura_180
      set tipo_factura = 'NORMAL',
          estado = 'BORRADOR',
          numero = null,
          fecha = ${fecha}::date
      where id = ${id}
    `;

    // Auditoría
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_convertida',
      entidadTipo: 'factura',
      entidadId: id,
      req,
      motivo: `Proforma convertida a factura normal`
    });

    res.json({
      success: true,
      message: "Proforma convertida a factura normal. Ahora debes validarla para asignarle número oficial."
    });
  } catch (err) {
    console.error("Error convertirProformaANormal:", err);
    res.status(500).json({ success: false, error: "Error convirtiendo proforma" });
  }
}
