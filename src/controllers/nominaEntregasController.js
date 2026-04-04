// backend/src/controllers/nominaEntregasController.js
//
// Sistema de entrega y firma de nóminas.
// Admin envía → Empleado recibe y firma → Audit trail completo.

import { sql } from "../db.js";
import crypto from "crypto";
import { crearNotificacionSistema } from "./notificacionesController.js";

const MESES = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ─── Helper: obtener datos de nómina + empleado ──────────────────
async function getNominaConEmpleado(nominaId, empresaId) {
  const [row] = await sql`
    SELECT n.id, n.anio, n.mes, n.bruto, n.liquido, n.pdf_path, n.estado_entrega,
           n.empleado_id, e.user_id, e.nombre AS empleado_nombre,
           u.email AS empleado_email
    FROM nominas_180 n
    JOIN employees_180 e ON e.id = n.empleado_id
    JOIN users_180 u ON u.id = e.user_id
    WHERE n.id = ${nominaId} AND n.empresa_id = ${empresaId}
  `;
  return row || null;
}

// ─── Helper: obtener admin user_id de una empresa ────────────────
async function getAdminUserId(empresaId) {
  const [emp] = await sql`SELECT user_id FROM empresa_180 WHERE id = ${empresaId}`;
  return emp?.user_id || null;
}

// ─── ADMIN: Enviar nómina a empleado ─────────────────────────────
export const enviarNomina = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const { id: nominaId } = req.params;

    const nomina = await getNominaConEmpleado(nominaId, empresaId);
    if (!nomina) {
      return res.status(404).json({ error: "Nómina no encontrada" });
    }

    // Crear registro de entrega
    const [entrega] = await sql`
      INSERT INTO nomina_entregas_180 (
        nomina_id, empresa_id, empleado_id, estado, metodo_envio, email_enviado_a
      ) VALUES (
        ${nominaId}, ${empresaId}, ${nomina.empleado_id},
        'enviada', 'app', ${nomina.empleado_email}
      )
      RETURNING *
    `;

    // Actualizar estado en nómina
    await sql`
      UPDATE nominas_180 SET estado_entrega = 'enviada', updated_at = NOW()
      WHERE id = ${nominaId}
    `;

    // Enviar email (best-effort, no bloquea)
    try {
      const { sendEmail } = await import("../services/emailService.js");
      await sendEmail({
        to: nomina.empleado_email,
        subject: `Tu nómina de ${MESES[nomina.mes]} ${nomina.anio} está disponible`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px;">
            <h2>Hola ${nomina.empleado_nombre},</h2>
            <p>Tu nómina de <strong>${MESES[nomina.mes]} ${nomina.anio}</strong> ya está disponible en la aplicación.</p>
            <p><strong>Neto a percibir:</strong> ${Number(nomina.liquido).toFixed(2)} €</p>
            <p>Accede a la app para confirmar la recepción y firmarla.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px;">Este es un mensaje automático de CONTENDO.</p>
          </div>
        `,
      }, empresaId);
    } catch (emailErr) {
      console.warn("Email de nómina no enviado:", emailErr.message);
    }

    // Notificación al empleado
    await crearNotificacionSistema({
      empresaId,
      userId: nomina.user_id,
      tipo: "info",
      titulo: "Nueva nómina disponible",
      mensaje: `Tu nómina de ${MESES[nomina.mes]} ${nomina.anio} está disponible. Neto: ${Number(nomina.liquido).toFixed(2)} €`,
      accionUrl: "/empleado/nominas",
      accionLabel: "Ver nómina",
    });

    return res.json({ success: true, entrega });
  } catch (err) {
    console.error("Error enviarNomina:", err);
    return res.status(500).json({ error: "Error al enviar nómina" });
  }
};

// ─── ADMIN: Enviar nóminas en lote ───────────────────────────────
export const enviarNominasLote = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const { nomina_ids } = req.body;

    if (!Array.isArray(nomina_ids) || nomina_ids.length === 0) {
      return res.status(400).json({ error: "Se requiere un array de nomina_ids" });
    }

    let enviadas = 0;
    let errores = 0;
    const detalle = [];

    for (const nominaId of nomina_ids) {
      try {
        const nomina = await getNominaConEmpleado(nominaId, empresaId);
        if (!nomina) {
          detalle.push({ nominaId, error: "No encontrada" });
          errores++;
          continue;
        }

        await sql`
          INSERT INTO nomina_entregas_180 (
            nomina_id, empresa_id, empleado_id, estado, metodo_envio, email_enviado_a
          ) VALUES (
            ${nominaId}, ${empresaId}, ${nomina.empleado_id},
            'enviada', 'app', ${nomina.empleado_email}
          )
        `;

        await sql`
          UPDATE nominas_180 SET estado_entrega = 'enviada', updated_at = NOW()
          WHERE id = ${nominaId}
        `;

        await crearNotificacionSistema({
          empresaId,
          userId: nomina.user_id,
          tipo: "info",
          titulo: "Nueva nómina disponible",
          mensaje: `Tu nómina de ${MESES[nomina.mes]} ${nomina.anio} está disponible.`,
          accionUrl: "/empleado/nominas",
          accionLabel: "Ver nómina",
        });

        detalle.push({ nominaId, empleado: nomina.empleado_nombre, ok: true });
        enviadas++;
      } catch (innerErr) {
        detalle.push({ nominaId, error: innerErr.message });
        errores++;
      }
    }

    return res.json({ success: true, enviadas, errores, detalle });
  } catch (err) {
    console.error("Error enviarNominasLote:", err);
    return res.status(500).json({ error: "Error al enviar nóminas en lote" });
  }
};

// ─── ADMIN: Listar entregas con estado ───────────────────────────
export const listarEntregas = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const { anio, mes, estado } = req.query;

    const entregas = await sql`
      SELECT ne.id, ne.nomina_id, ne.estado, ne.fecha_envio, ne.fecha_recepcion,
             ne.fecha_firma, ne.metodo_envio, ne.email_enviado_a, ne.hash_firma,
             ne.comentario_empleado, ne.ip_firma,
             n.anio, n.mes, n.bruto, n.liquido,
             e.nombre AS empleado_nombre, u.email AS empleado_email
      FROM nomina_entregas_180 ne
      JOIN nominas_180 n ON n.id = ne.nomina_id
      JOIN employees_180 e ON e.id = ne.empleado_id
      JOIN users_180 u ON u.id = e.user_id
      WHERE ne.empresa_id = ${empresaId}
        ${anio ? sql`AND n.anio = ${parseInt(anio)}` : sql``}
        ${mes ? sql`AND n.mes = ${parseInt(mes)}` : sql``}
        ${estado ? sql`AND ne.estado = ${estado}` : sql``}
      ORDER BY ne.fecha_envio DESC
      LIMIT 200
    `;

    return res.json({ success: true, data: entregas, total: entregas.length });
  } catch (err) {
    console.error("Error listarEntregas:", err);
    return res.status(500).json({ error: "Error al listar entregas" });
  }
};

// ─── EMPLEADO: Confirmar recepción de nómina ─────────────────────
export const confirmarRecepcion = async (req, res) => {
  try {
    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;
    const { id: nominaId } = req.params;

    if (!empleadoId) return res.status(400).json({ error: "No eres empleado" });

    // Verificar que la nómina pertenece al empleado
    const [nomina] = await sql`
      SELECT id, anio, mes FROM nominas_180
      WHERE id = ${nominaId} AND empresa_id = ${empresaId} AND empleado_id = ${empleadoId}
    `;
    if (!nomina) return res.status(404).json({ error: "Nómina no encontrada" });

    // Actualizar entrega
    const updated = await sql`
      UPDATE nomina_entregas_180
      SET estado = 'recibida', fecha_recepcion = NOW(), updated_at = NOW()
      WHERE nomina_id = ${nominaId} AND empleado_id = ${empleadoId} AND estado = 'enviada'
      RETURNING *
    `;

    if (updated.length === 0) {
      // Puede que no haya entrega o ya esté en estado posterior
      return res.status(400).json({ error: "No hay entrega pendiente para esta nómina" });
    }

    await sql`
      UPDATE nominas_180 SET estado_entrega = 'recibida', updated_at = NOW()
      WHERE id = ${nominaId}
    `;

    // Notificar admin
    const adminUserId = await getAdminUserId(empresaId);
    const [empData] = await sql`SELECT nombre FROM employees_180 WHERE id = ${empleadoId}`;
    if (adminUserId) {
      await crearNotificacionSistema({
        empresaId,
        userId: adminUserId,
        tipo: "info",
        titulo: "Nómina recibida",
        mensaje: `${empData?.nombre || "Empleado"} ha confirmado la recepción de su nómina de ${MESES[nomina.mes]} ${nomina.anio}.`,
        accionUrl: "/admin/nominas",
        accionLabel: "Ver nóminas",
      });
    }

    return res.json({ success: true, entrega: updated[0] });
  } catch (err) {
    console.error("Error confirmarRecepcion:", err);
    return res.status(500).json({ error: "Error al confirmar recepción" });
  }
};

// ─── EMPLEADO: Firmar nómina ─────────────────────────────────────
export const firmarNomina = async (req, res) => {
  try {
    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;
    const { id: nominaId } = req.params;
    const { comentario } = req.body || {};

    if (!empleadoId) return res.status(400).json({ error: "No eres empleado" });

    // Verificar nómina
    const [nomina] = await sql`
      SELECT id, anio, mes FROM nominas_180
      WHERE id = ${nominaId} AND empresa_id = ${empresaId} AND empleado_id = ${empleadoId}
    `;
    if (!nomina) return res.status(404).json({ error: "Nómina no encontrada" });

    // Generar hash de firma (audit trail)
    const ahora = new Date().toISOString();
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const hashFirma = crypto
      .createHash("sha256")
      .update(`${nominaId}:${ahora}:${ip}:${empleadoId}`)
      .digest("hex");

    // Actualizar entrega (acepta estado enviada o recibida)
    const updated = await sql`
      UPDATE nomina_entregas_180
      SET estado = 'firmada',
          fecha_firma = NOW(),
          ip_firma = ${ip},
          hash_firma = ${hashFirma},
          comentario_empleado = ${comentario || null},
          updated_at = NOW()
      WHERE nomina_id = ${nominaId} AND empleado_id = ${empleadoId}
        AND estado IN ('enviada', 'recibida')
      RETURNING *
    `;

    if (updated.length === 0) {
      return res.status(400).json({ error: "No hay entrega pendiente de firma para esta nómina" });
    }

    await sql`
      UPDATE nominas_180 SET estado_entrega = 'firmada', updated_at = NOW()
      WHERE id = ${nominaId}
    `;

    // Notificar admin
    const adminUserId = await getAdminUserId(empresaId);
    const [empData] = await sql`SELECT nombre FROM employees_180 WHERE id = ${empleadoId}`;
    if (adminUserId) {
      await crearNotificacionSistema({
        empresaId,
        userId: adminUserId,
        tipo: "success",
        titulo: "Nómina firmada",
        mensaje: `${empData?.nombre || "Empleado"} ha firmado su nómina de ${MESES[nomina.mes]} ${nomina.anio}.`,
        accionUrl: "/admin/nominas",
        accionLabel: "Ver nóminas",
      });
    }

    return res.json({ success: true, entrega: updated[0], hash_firma: hashFirma });
  } catch (err) {
    console.error("Error firmarNomina:", err);
    return res.status(500).json({ error: "Error al firmar nómina" });
  }
};

// ─── EMPLEADO: Descargar PDF de nómina ───────────────────────────
export const descargarNominaPDF = async (req, res) => {
  try {
    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;
    const { id: nominaId } = req.params;

    if (!empleadoId) return res.status(400).json({ error: "No eres empleado" });

    const [nomina] = await sql`
      SELECT pdf_path, anio, mes FROM nominas_180
      WHERE id = ${nominaId} AND empresa_id = ${empresaId} AND empleado_id = ${empleadoId}
    `;

    if (!nomina) return res.status(404).json({ error: "Nómina no encontrada" });
    if (!nomina.pdf_path) return res.status(404).json({ error: "No hay PDF disponible para esta nómina" });

    // Proxy desde Supabase Storage
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const { data, error } = await supabase.storage
        .from("app180-files")
        .download(nomina.pdf_path);

      if (error || !data) {
        return res.status(404).json({ error: "PDF no encontrado en storage" });
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="nomina-${nomina.anio}-${String(nomina.mes).padStart(2, "0")}.pdf"`);
      return res.send(buffer);
    } catch (storageErr) {
      console.error("Error descargando PDF de storage:", storageErr);
      return res.status(500).json({ error: "Error al descargar PDF" });
    }
  } catch (err) {
    console.error("Error descargarNominaPDF:", err);
    return res.status(500).json({ error: "Error al descargar nómina" });
  }
};
