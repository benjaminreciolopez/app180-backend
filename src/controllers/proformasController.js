// backend/src/controllers/proformasController.js
// Sistema propio de proformas - funciones separadas de facturas normales

import { sql } from "../db.js";
import { generarPdfFactura } from "../services/facturaPdfService.js";
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

async function auditProforma(params) {
  const { empresaId, userId, entidadTipo, entidadId, accion, motivo, req, datosNuevos, datosAnteriores } = params;

  await registrarAuditoria(params);

  const { registrarEventoSeguridad } = await import('../middlewares/auditMiddleware.js');
  await registrarEventoSeguridad({
    empresaId,
    userId,
    entidad: entidadTipo || 'proforma',
    entidadId,
    accion,
    motivo,
    req,
    payload: datosNuevos
  });
}

/**
 * Genera número PRO-YYYY-XXXXXX para proformas
 */
async function generarNumeroProforma(empresaId, fecha) {
  const year = new Date(fecha).getFullYear();
  const [result] = await sql`
    SELECT COUNT(*) as total FROM factura_180
    WHERE empresa_id = ${empresaId}
      AND tipo_factura = 'PROFORMA'
      AND numero IS NOT NULL
      AND EXTRACT(YEAR FROM fecha) = ${year}
  `;
  const nextNum = (parseInt(result?.total || 0) + 1).toString().padStart(6, '0');
  return `PRO-${year}-${nextNum}`;
}

/* =========================
   LISTAR PROFORMAS
========================= */

export async function listProformas(req, res) {
  try {
    let empresaId = req.user.empresa_id;
    if (!empresaId) {
      empresaId = await getEmpresaId(req.user.id);
    }

    const { estado, cliente_id, year } = req.query;

    let query = sql`
      SELECT
        f.*,
        c.nombre as cliente_nombre,
        c.codigo as cliente_codigo,
        po.numero as proforma_origen_numero
      FROM factura_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      LEFT JOIN factura_180 po ON po.id = f.proforma_origen_id
      WHERE f.empresa_id = ${empresaId}
        AND f.tipo_factura = 'PROFORMA'
    `;

    if (estado && estado !== 'TODOS') {
      query = sql`${query} AND f.estado = ${estado}`;
    }

    if (cliente_id) {
      query = sql`${query} AND f.cliente_id = ${parseInt(cliente_id)}`;
    }

    if (year) {
      query = sql`${query} AND EXTRACT(YEAR FROM f.fecha) = ${parseInt(year)}`;
    }

    const proformas = await sql`${query} ORDER BY f.created_at DESC`;

    res.json({ success: true, data: proformas });
  } catch (err) {
    console.error("❌ listProformas:", err);
    res.status(500).json({ success: false, error: "Error listando proformas" });
  }
}

/* =========================
   DETALLE DE PROFORMA
========================= */

export async function getProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [proforma] = await sql`
      SELECT
        f.*,
        c.nombre as cliente_nombre,
        c.codigo as cliente_codigo,
        fd.razon_social,
        fd.nif_cif,
        fd.direccion_fiscal,
        fd.codigo_postal,
        fd.municipio,
        fd.provincia,
        fd.pais,
        po.numero as proforma_origen_numero,
        fc.numero as factura_convertida_numero
      FROM factura_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      LEFT JOIN client_fiscal_data_180 fd ON fd.cliente_id = f.cliente_id
      LEFT JOIN factura_180 po ON po.id = f.proforma_origen_id
      LEFT JOIN factura_180 fc ON fc.id = f.factura_convertida_id
      WHERE f.id = ${id}
        AND f.empresa_id = ${empresaId}
        AND f.tipo_factura = 'PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    const lineas = await sql`
      SELECT lf.*, co.nombre as concepto_nombre
      FROM lineafactura_180 lf
      LEFT JOIN concepto_180 co ON co.id = lf.concepto_id
      WHERE lf.factura_id = ${id}
      ORDER BY lf.id
    `;

    res.json({
      success: true,
      data: { ...proforma, lineas }
    });
  } catch (err) {
    console.error("❌ getProforma:", err);
    res.status(500).json({ success: false, error: "Error obteniendo proforma" });
  }
}

/* =========================
   CREAR PROFORMA (directamente ACTIVA)
========================= */

export async function crearProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { cliente_id, fecha, iva_global, lineas = [], mensaje_iva, metodo_pago, retencion_porcentaje = 0 } = req.body;

    if (!cliente_id) {
      return res.status(400).json({ success: false, error: "Cliente requerido" });
    }

    if (!fecha || isNaN(Date.parse(fecha))) {
      return res.status(400).json({ success: false, error: "Fecha requerida y debe ser válida (YYYY-MM-DD)" });
    }

    const ivaNum = Number(iva_global);
    if (iva_global != null && (typeof iva_global === 'boolean' || isNaN(ivaNum) || ivaNum < 0 || ivaNum > 100)) {
      return res.status(400).json({ success: false, error: "IVA debe ser un número entre 0 y 100" });
    }

    if (!Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ success: false, error: "Debe incluir al menos una línea" });
    }

    if (lineas.length > 1000) {
      return res.status(400).json({ success: false, error: "Máximo 1000 líneas por proforma" });
    }

    for (const linea of lineas) {
      const cant = Number(linea.cantidad);
      const precio = Number(linea.precio_unitario);
      if (isNaN(cant) || isNaN(precio) || Math.abs(cant) > 999999999 || Math.abs(precio) > 999999999) {
        return res.status(400).json({ success: false, error: "Cantidad y precio deben ser números válidos" });
      }
    }

    // Validar cliente
    const [cliente] = await sql`
      SELECT 1 FROM clients_180
      WHERE id=${cliente_id} AND empresa_id=${empresaId}
    `;
    if (!cliente) {
      return res.status(400).json({ success: false, error: "Cliente inválido" });
    }

    // Generar número PRO directamente
    const numero = await generarNumeroProforma(empresaId, fecha);

    let createdProforma;

    await sql.begin(async (tx) => {
      let subtotal = 0;
      let iva_total = 0;

      // Crear proforma en estado ACTIVA con número asignado
      const [proforma] = await tx`
        INSERT INTO factura_180 (
          empresa_id, cliente_id, fecha, estado, numero,
          iva_global, mensaje_iva, metodo_pago,
          subtotal, iva_total, total,
          retencion_porcentaje, retencion_importe,
          tipo_factura, created_at
        ) VALUES (
          ${empresaId},
          ${cliente_id},
          ${fecha}::date,
          'ACTIVA',
          ${numero},
          ${n(iva_global) || 0},
          ${n(mensaje_iva)},
          ${n(metodo_pago) || 'TRANSFERENCIA'},
          0, 0, 0,
          ${retencion_porcentaje}, 0,
          'PROFORMA',
          now()
        )
        RETURNING *
      `;

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
          INSERT INTO lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent
          ) VALUES (
            ${proforma.id},
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
      const retencion_importe = (subtotal * retencion_porcentaje) / 100;
      const total = subtotal + iva_total - retencion_importe;

      const [updated] = await tx`
        UPDATE factura_180
        SET subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            retencion_importe = ${Math.round(retencion_importe * 100) / 100},
            total = ${Math.round(total * 100) / 100}
        WHERE id = ${proforma.id}
        RETURNING *
      `;
      createdProforma = updated;
    });

    // Auditoría
    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_creada',
      entidadTipo: 'proforma',
      entidadId: createdProforma.id,
      req,
      datosNuevos: { numero, cliente_id, fecha, total: createdProforma.total }
    });

    res.status(201).json({
      success: true,
      message: `Proforma ${numero} creada correctamente`,
      data: createdProforma
    });
  } catch (err) {
    console.error("❌ crearProforma:", err);
    res.status(500).json({ success: false, error: "Error creando proforma" });
  }
}

/* =========================
   EDITAR PROFORMA (solo ACTIVA)
========================= */

export async function editarProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { cliente_id, fecha, iva_global, lineas = [], mensaje_iva, metodo_pago, retencion_porcentaje = 0 } = req.body;

    const [proforma] = await sql`
      SELECT * FROM factura_180
      WHERE id=${id} AND empresa_id=${empresaId} AND tipo_factura='PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    if (proforma.estado !== 'ACTIVA') {
      return res.status(400).json({ success: false, error: "Solo se pueden editar proformas activas" });
    }

    if (!Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ success: false, error: "Debe incluir al menos una línea" });
    }

    await sql.begin(async (tx) => {
      // Actualizar datos básicos (mantiene mismo número PRO)
      await tx`
        UPDATE factura_180
        SET cliente_id = ${n(cliente_id) || proforma.cliente_id},
            fecha = ${n(fecha) || proforma.fecha}::date,
            iva_global = ${n(iva_global) != null ? n(iva_global) : proforma.iva_global},
            mensaje_iva = ${n(mensaje_iva) != null ? n(mensaje_iva) : proforma.mensaje_iva},
            metodo_pago = ${n(metodo_pago) || proforma.metodo_pago},
            retencion_porcentaje = ${retencion_porcentaje},
            updated_at = now()
        WHERE id = ${id}
      `;

      // Eliminar líneas anteriores y recrear
      await tx`DELETE FROM lineafactura_180 WHERE factura_id=${id}`;

      let subtotal = 0;
      let iva_total = 0;

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
          INSERT INTO lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent
          ) VALUES (
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

      const retencion_importe = (subtotal * retencion_porcentaje) / 100;
      const total = subtotal + iva_total - retencion_importe;

      await tx`
        UPDATE factura_180
        SET subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            retencion_importe = ${Math.round(retencion_importe * 100) / 100},
            total = ${Math.round(total * 100) / 100}
        WHERE id = ${id}
      `;
    });

    // Auditoría
    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_editada',
      entidadTipo: 'proforma',
      entidadId: id,
      req,
      datosAnteriores: { total: proforma.total },
      datosNuevos: { cliente_id: cliente_id || proforma.cliente_id, fecha }
    });

    res.json({ success: true, message: "Proforma actualizada correctamente" });
  } catch (err) {
    console.error("❌ editarProforma:", err);
    res.status(500).json({ success: false, error: "Error editando proforma" });
  }
}

/* =========================
   ANULAR PROFORMA (ACTIVA → ANULADA)
========================= */

export async function anularProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { motivo } = req.body;

    if (!motivo || !motivo.trim()) {
      return res.status(400).json({ success: false, error: "Motivo de anulación obligatorio" });
    }

    const [proforma] = await sql`
      SELECT * FROM factura_180
      WHERE id=${id} AND empresa_id=${empresaId} AND tipo_factura='PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    if (proforma.estado !== 'ACTIVA') {
      return res.status(400).json({ success: false, error: "Solo se pueden anular proformas activas" });
    }

    // Solo cambiar estado - sin rectificativa, sin VeriFactu
    await sql`
      UPDATE factura_180
      SET estado = 'ANULADA',
          updated_at = now()
      WHERE id = ${id}
    `;

    // Auditoría
    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_anulada',
      entidadTipo: 'proforma',
      entidadId: id,
      motivo: motivo.trim(),
      req,
      datosNuevos: { estado: 'ANULADA', numero: proforma.numero }
    });

    res.json({
      success: true,
      message: `Proforma ${proforma.numero} anulada correctamente`
    });
  } catch (err) {
    console.error("❌ anularProforma:", err);
    res.status(500).json({ success: false, error: "Error anulando proforma" });
  }
}

/* =========================
   REACTIVAR PROFORMA (ANULADA → nueva ACTIVA)
   Crea NUEVA proforma copiando contenido de la anulada
========================= */

export async function reactivarProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [proforma] = await sql`
      SELECT * FROM factura_180
      WHERE id=${id} AND empresa_id=${empresaId} AND tipo_factura='PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    if (proforma.estado !== 'ANULADA') {
      return res.status(400).json({ success: false, error: "Solo se pueden reactivar proformas anuladas" });
    }

    // Obtener líneas originales
    const lineasOriginales = await sql`
      SELECT * FROM lineafactura_180
      WHERE factura_id = ${id}
      ORDER BY id
    `;

    // Generar nuevo número PRO
    const hoy = new Date().toISOString().split('T')[0];
    const nuevoNumero = await generarNumeroProforma(empresaId, hoy);

    let nuevaProforma;

    await sql.begin(async (tx) => {
      // Crear nueva proforma copiando datos
      const [nueva] = await tx`
        INSERT INTO factura_180 (
          empresa_id, cliente_id, fecha, estado, numero,
          iva_global, mensaje_iva, metodo_pago,
          subtotal, iva_total, total,
          retencion_porcentaje, retencion_importe,
          tipo_factura, proforma_origen_id, created_at
        ) VALUES (
          ${empresaId},
          ${proforma.cliente_id},
          ${hoy}::date,
          'ACTIVA',
          ${nuevoNumero},
          ${proforma.iva_global},
          ${proforma.mensaje_iva},
          ${proforma.metodo_pago},
          ${proforma.subtotal},
          ${proforma.iva_total},
          ${proforma.total},
          ${proforma.retencion_porcentaje},
          ${proforma.retencion_importe},
          'PROFORMA',
          ${id},
          now()
        )
        RETURNING *
      `;
      nuevaProforma = nueva;

      // Copiar líneas
      for (const linea of lineasOriginales) {
        await tx`
          INSERT INTO lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent
          ) VALUES (
            ${nueva.id},
            ${linea.descripcion},
            ${linea.cantidad},
            ${linea.precio_unitario},
            ${linea.total},
            ${linea.concepto_id},
            ${linea.iva_percent}
          )
        `;
      }
    });

    // Auditoría en la original
    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_reactivada',
      entidadTipo: 'proforma',
      entidadId: id,
      req,
      datosNuevos: { nueva_proforma_id: nuevaProforma.id, nuevo_numero: nuevoNumero }
    });

    // Auditoría en la nueva
    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_creada_desde_reactivacion',
      entidadTipo: 'proforma',
      entidadId: nuevaProforma.id,
      req,
      datosNuevos: { origen_id: id, origen_numero: proforma.numero, numero: nuevoNumero }
    });

    res.status(201).json({
      success: true,
      message: `Nueva proforma ${nuevoNumero} creada desde ${proforma.numero}`,
      data: nuevaProforma
    });
  } catch (err) {
    console.error("❌ reactivarProforma:", err);
    res.status(500).json({ success: false, error: "Error reactivando proforma" });
  }
}

/* =========================
   CONVERTIR PROFORMA A FACTURA (ACTIVA → CONVERTIDA + nueva factura BORRADOR)
   Requiere doble confirmación: escribir el número PRO
========================= */

export async function convertirProformaAFactura(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { numero_confirmacion, fecha } = req.body;

    if (!numero_confirmacion) {
      return res.status(400).json({ success: false, error: "Debe escribir el número de la proforma para confirmar" });
    }

    const [proforma] = await sql`
      SELECT * FROM factura_180
      WHERE id=${id} AND empresa_id=${empresaId} AND tipo_factura='PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    if (proforma.estado !== 'ACTIVA') {
      return res.status(400).json({ success: false, error: "Solo se pueden convertir proformas activas" });
    }

    // Doble factor: verificar que escribió el número correctamente
    if (numero_confirmacion.trim().toUpperCase() !== proforma.numero.trim().toUpperCase()) {
      return res.status(400).json({
        success: false,
        error: "El número de confirmación no coincide con el de la proforma"
      });
    }

    const fechaFactura = fecha || new Date().toISOString().split('T')[0];

    // Obtener líneas
    const lineasOriginales = await sql`
      SELECT * FROM lineafactura_180
      WHERE factura_id = ${id}
      ORDER BY id
    `;

    let nuevaFactura;

    await sql.begin(async (tx) => {
      // Marcar proforma como CONVERTIDA
      await tx`
        UPDATE factura_180
        SET estado = 'CONVERTIDA',
            updated_at = now()
        WHERE id = ${id}
      `;

      // Crear nueva factura NORMAL en BORRADOR
      const [factura] = await tx`
        INSERT INTO factura_180 (
          empresa_id, cliente_id, fecha, estado,
          iva_global, mensaje_iva, metodo_pago,
          subtotal, iva_total, total,
          retencion_porcentaje, retencion_importe,
          tipo_factura, created_at
        ) VALUES (
          ${empresaId},
          ${proforma.cliente_id},
          ${fechaFactura}::date,
          'BORRADOR',
          ${proforma.iva_global},
          ${proforma.mensaje_iva},
          ${proforma.metodo_pago},
          ${proforma.subtotal},
          ${proforma.iva_total},
          ${proforma.total},
          ${proforma.retencion_porcentaje},
          ${proforma.retencion_importe},
          'NORMAL',
          now()
        )
        RETURNING *
      `;
      nuevaFactura = factura;

      // Copiar líneas a la nueva factura
      for (const linea of lineasOriginales) {
        await tx`
          INSERT INTO lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent
          ) VALUES (
            ${factura.id},
            ${linea.descripcion},
            ${linea.cantidad},
            ${linea.precio_unitario},
            ${linea.total},
            ${linea.concepto_id},
            ${linea.iva_percent}
          )
        `;
      }

      // Vincular proforma con factura resultante
      await tx`
        UPDATE factura_180
        SET factura_convertida_id = ${factura.id}
        WHERE id = ${id}
      `;
    });

    // Auditoría
    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_convertida',
      entidadTipo: 'proforma',
      entidadId: id,
      req,
      datosNuevos: {
        proforma_numero: proforma.numero,
        nueva_factura_id: nuevaFactura.id,
        fecha: fechaFactura
      }
    });

    res.json({
      success: true,
      message: `Proforma ${proforma.numero} convertida a factura. Valida la factura para asignar número oficial.`,
      factura_id: nuevaFactura.id
    });
  } catch (err) {
    console.error("❌ convertirProformaAFactura:", err);
    res.status(500).json({ success: false, error: "Error convirtiendo proforma a factura" });
  }
}

/* =========================
   ELIMINAR PROFORMA (solo ACTIVA, sin historial)
========================= */

export async function eliminarProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [proforma] = await sql`
      SELECT * FROM factura_180
      WHERE id=${id} AND empresa_id=${empresaId} AND tipo_factura='PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    if (proforma.estado !== 'ACTIVA') {
      return res.status(400).json({ success: false, error: "Solo se pueden eliminar proformas activas" });
    }

    await sql.begin(async (tx) => {
      await tx`DELETE FROM lineafactura_180 WHERE factura_id = ${id}`;
      await tx`DELETE FROM factura_180 WHERE id = ${id}`;
    });

    await auditProforma({
      empresaId,
      userId: req.user.id,
      accion: 'proforma_eliminada',
      entidadTipo: 'proforma',
      entidadId: id,
      req,
      datosNuevos: { numero: proforma.numero }
    });

    res.json({ success: true, message: `Proforma ${proforma.numero} eliminada` });
  } catch (err) {
    console.error("❌ eliminarProforma:", err);
    res.status(500).json({ success: false, error: "Error eliminando proforma" });
  }
}

/* =========================
   GENERAR PDF PROFORMA
========================= */

export async function generarPdfProforma(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const [proforma] = await sql`
      SELECT * FROM factura_180
      WHERE id=${id} AND empresa_id=${empresaId} AND tipo_factura='PROFORMA'
      LIMIT 1
    `;

    if (!proforma) {
      return res.status(404).json({ success: false, error: "Proforma no encontrada" });
    }

    // Reutilizar el generador de PDF de facturas (ya soporta proformas)
    const pdfBuffer = await generarPdfFactura(id);

    // Guardar en storage
    try {
      const baseFolder = 'Proformas';
      const f = new Date(proforma.fecha);
      const year = f.getUTCFullYear();
      const trim = Math.floor(f.getUTCMonth() / 3) + 1;
      const folder = `${baseFolder}/${year}/T${trim}`;

      const savedFile = await saveToStorage({
        empresaId,
        nombre: `Proforma_${proforma.numero.replace(/\//g, '-')}.pdf`,
        buffer: pdfBuffer,
        folder,
        mimeType: 'application/pdf',
        useTimestamp: false
      });

      if (savedFile && savedFile.storage_path) {
        await sql`UPDATE factura_180 SET ruta_pdf = ${savedFile.storage_path} WHERE id = ${id}`;
      }
    } catch (storageErr) {
      console.error("⚠️ No se pudo almacenar PDF proforma:", storageErr);
    }

    // Devolver PDF como descarga
    if (req.query.action === 'save') {
      return res.json({ success: true, message: "PDF generado y guardado" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Proforma_${proforma.numero}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("❌ generarPdfProforma:", err);
    res.status(500).json({ success: false, error: "Error generando PDF de proforma" });
  }
}
