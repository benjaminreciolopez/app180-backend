// backend/src/controllers/facturasController.js

import { sql } from "../db.js";
import { generarPdfFactura } from "../services/facturaPdfService.js";
import * as emailService from "../services/emailService.js";
import { verificarVerifactu } from "../services/verifactuService.js";
import { registrarAuditoria } from "../middlewares/auditMiddleware.js";

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

    const { estado, cliente_id, fecha_desde, fecha_hasta } = req.query;

    let conditions = [sql`f.empresa_id = ${empresaId}`];

    if (estado) {
      conditions.push(sql`f.estado = ${estado}`);
    }

    if (cliente_id) {
      conditions.push(sql`f.cliente_id = ${parseInt(cliente_id)}`);
    }

    if (fecha_desde) {
      conditions.push(sql`f.fecha >= ${fecha_desde}::date`);
    }

    if (fecha_hasta) {
      conditions.push(sql`f.fecha <= ${fecha_hasta}::date`);
    }

    const facturas = await sql`
      select
        f.*,
        c.nombre as cliente_nombre,
        c.codigo as cliente_codigo
      from factura_180 f
      left join clients_180 c on c.id = f.cliente_id
      where ${sql.unsafe(
      conditions.map((c, i) => `__condition_${i}__`).join(" AND "),
      ...conditions
    )}
      order by f.created_at desc
    `;

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

    res.json({
      success: true,
      data: {
        ...factura,
        lineas,
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
    const { cliente_id, fecha, iva_global, lineas = [] } = req.body;

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
          empresa_id, cliente_id, fecha, estado, iva_global,
          subtotal, iva_total, total, created_at
        ) values (
          ${empresaId},
          ${cliente_id},
          ${fecha}::date,
          'BORRADOR',
          ${n(iva_global) || 0},
          0, 0, 0,
          now()
        )
        returning *
      `;

      // Crear líneas
      for (const linea of lineas) {
        const descripcion = (linea.descripcion || "").trim();
        if (!descripcion) continue;

        const cantidad = parseFloat(linea.cantidad || 0);
        const precio_unitario = parseFloat(linea.precio_unitario || 0);
        const base = cantidad * precio_unitario;
        const importe_iva = base * (iva_global || 0) / 100;

        subtotal += base;
        iva_total += importe_iva;

        await tx`
          insert into lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id
          ) values (
            ${factura.id},
            ${descripcion},
            ${cantidad},
            ${precio_unitario},
            ${base + importe_iva},
            ${n(linea.concepto_id)}
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
    });

    // Auditoría
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      accion: 'factura_creada',
      entidadTipo: 'factura',
      entidadId: createdFactura.id,
      req,
      datosNuevos: createdFactura
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
    const { cliente_id, fecha, iva_global, lineas = [] } = req.body;

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
            iva_global = ${n(iva_global) || factura.iva_global}
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
        const base = cantidad * precio_unitario;
        const importe_iva = base * (iva_global || 0) / 100;

        subtotal += base;
        iva_total += importe_iva;

        await tx`
          insert into lineafactura_180 (
            factura_id, descripcion, cantidad, precio_unitario, total, concepto_id
          ) values (
            ${id},
            ${descripcion},
            ${cantidad},
            ${precio_unitario},
            ${base + importe_iva},
            ${n(linea.concepto_id)}
          )
        `;
      }

      // Actualizar totales
      await tx`
        update factura_180
        set subtotal = ${Math.round(subtotal * 100) / 100},
            iva_total = ${Math.round(iva_total * 100) / 100},
            total = ${Math.round((subtotal + iva_total) * 100) / 100}
        where id = ${id}
      `;
    });

    // Auditoría
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      accion: 'factura_actualizada',
      entidadTipo: 'factura',
      entidadId: id,
      req,
      datosAnteriores: factura
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
      // Actualizar factura
      await tx`
        update factura_180
        set estado = 'VALIDADA',
            numero = ${numero},
            fecha = ${fecha}::date,
            fecha_validacion = current_date,
            mensaje_iva = ${n(mensaje_iva)}
        where id = ${id}
      `;

      // Preparar objeto para VeriFactu
      const facturaActualizada = {
        ...factura,
        numero,
        fecha,
        estado: 'VALIDADA',
        fecha_validacion: new Date(),
        mensaje_iva: n(mensaje_iva)
      };

      // Verificar Veri*Factu (si aplica)
      await verificarVerifactu(facturaActualizada, tx);

      // Bloquear numeración (actualizar emisor)
      const year = new Date(fecha).getFullYear();
      await tx`
        update emisor_180
        set ultimo_anio_numerado = ${year}
        where empresa_id = ${empresaId}
      `;
    });

    // Auditoría
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      accion: 'factura_validada',
      entidadTipo: 'factura',
      entidadId: id,
      req,
      datosNuevos: { numero, fecha, estado: 'VALIDADA' }
    });

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
  const year = new Date(fecha).getFullYear();

  // Obtener emisor
  const [emisor] = await sql`
    select * from emisor_180
    where empresa_id=${empresaId}
    limit 1
  `;

  if (!emisor) {
    throw new Error("No existe configuración del emisor");
  }

  let correlativo = 1;

  // Si el año cambió, resetear correlativo
  if (emisor.ultimo_anio_numerado !== year) {
    correlativo = 1;
  } else {
    // Buscar último número del año
    const [ultimaFactura] = await sql`
      select numero from factura_180
      where empresa_id=${empresaId}
        and estado='VALIDADA'
        and numero like ${`%${year}-%`}
      order by numero desc
      limit 1
    `;

    if (ultimaFactura && ultimaFactura.numero) {
      const partes = ultimaFactura.numero.split("-");
      const lastPart = partes[partes.length - 1];
      const soloNumeros = lastPart.replace(/\D/g, "");
      if (soloNumeros) {
        correlativo = parseInt(soloNumeros) + 1;
      }
    }
  }

  // Formato: YYYY-0001
  const numero = `${year}-${String(correlativo).padStart(4, "0")}`;

  // Actualizar emisor
  await sql`
    update emisor_180
    set siguiente_numero = ${correlativo + 1},
        ultimo_anio_numerado = ${year}
    where empresa_id=${empresaId}
  `;

  return numero;
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
          subtotal, iva_total, total, iva_global, mensaje_iva, created_at
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
    });

    // Auditoría: Factura original anulada
    await registrarAuditoria({
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

    // Check ownership
    const [factura] = await sql`
      select 1 from factura_180
      where id=${id} and empresa_id=${empresaId}
    `;

    if (!factura) {
      return res.status(404).json({ success: false, error: "Factura no encontrada" });
    }

    const pdfBuffer = await generarPdfFactura(id, { modo });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="factura-${id}.pdf"`);
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
