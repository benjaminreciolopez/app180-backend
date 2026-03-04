// backend/src/jobs/asesorAlertScan.js
// Cron jobs para notificaciones automaticas al asesor
import { sql } from "../db.js";
import { crearNotificacionAsesor } from "../controllers/asesorNotificacionesController.js";

/**
 * Cron diario (9 AM): Verifica plazos fiscales y documentos nuevos
 */
export async function runAsesorDailyAlertScan() {
  console.log("[AsesorAlertScan] Iniciando escaneo diario...");
  try {
    // Obtener todas las asesorias con clientes activos
    const asesorias = await sql`
      SELECT DISTINCT ac.asesoria_id
      FROM asesoria_clientes_180 ac
      WHERE ac.estado = 'activo'
    `;

    const now = new Date();

    for (const { asesoria_id } of asesorias) {
      // 1. Plazos fiscales proximos 7 dias
      await checkPlazosFiscales(asesoria_id, now);

      // 2. Documentos nuevos de clientes en ultimas 24h
      await checkDocumentosNuevos(asesoria_id, now);
    }

    console.log(`[AsesorAlertScan] Escaneo diario completado para ${asesorias.length} asesorias`);
  } catch (err) {
    console.error("[AsesorAlertScan] Error en escaneo diario:", err);
  }
}

/**
 * Cron mensual (1 del mes, 8 AM): Verifica actividad de clientes
 */
export async function runAsesorMonthlyCheck() {
  console.log("[AsesorAlertScan] Iniciando revision mensual...");
  try {
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    // Obtener todos los vinculos activos
    const vinculos = await sql`
      SELECT ac.asesoria_id, ac.empresa_id, e.nombre AS empresa_nombre
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.estado = 'activo'
    `;

    for (const vinculo of vinculos) {
      // 1. Si no emitio facturas el mes anterior
      const [factCount] = await sql`
        SELECT COUNT(*)::int AS total
        FROM factura_180
        WHERE empresa_id = ${vinculo.empresa_id}
          AND EXTRACT(YEAR FROM fecha) = ${prevYear}
          AND EXTRACT(MONTH FROM fecha) = ${prevMonth}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
      `;

      if (factCount.total === 0) {
        // Evitar duplicados: verificar si ya existe esta notificacion
        const [existing] = await sql`
          SELECT id FROM notificaciones_asesor_180
          WHERE asesoria_id = ${vinculo.asesoria_id}
            AND empresa_id = ${vinculo.empresa_id}
            AND tipo = 'cliente_inactivo'
            AND created_at > NOW() - INTERVAL '25 days'
          LIMIT 1
        `;

        if (!existing) {
          const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
          await crearNotificacionAsesor({
            asesoriaId: vinculo.asesoria_id,
            tipo: "cliente_inactivo",
            titulo: "Cliente sin facturas",
            mensaje: `${vinculo.empresa_nombre} no emitio facturas en ${monthNames[prevMonth - 1]} ${prevYear}`,
            accionUrl: `/asesor/clientes/${vinculo.empresa_id}`,
            accionLabel: "Ver cliente",
            empresaId: vinculo.empresa_id,
          });
        }
      }

      // 2. Alertas fiscales sin resolver
      const [alertCount] = await sql`
        SELECT COUNT(*)::int AS total
        FROM notificaciones_180
        WHERE empresa_id = ${vinculo.empresa_id}
          AND tipo = 'fiscal_alert'
          AND leida = false
      `;

      if (alertCount.total > 0) {
        const [existing] = await sql`
          SELECT id FROM notificaciones_asesor_180
          WHERE asesoria_id = ${vinculo.asesoria_id}
            AND empresa_id = ${vinculo.empresa_id}
            AND tipo = 'alerta_fiscal'
            AND created_at > NOW() - INTERVAL '25 days'
          LIMIT 1
        `;

        if (!existing) {
          await crearNotificacionAsesor({
            asesoriaId: vinculo.asesoria_id,
            tipo: "alerta_fiscal",
            titulo: "Alertas fiscales pendientes",
            mensaje: `${vinculo.empresa_nombre} tiene ${alertCount.total} alerta(s) fiscal(es) sin resolver`,
            accionUrl: `/asesor/clientes/${vinculo.empresa_id}`,
            accionLabel: "Ver cliente",
            empresaId: vinculo.empresa_id,
          });
        }
      }
    }

    console.log(`[AsesorAlertScan] Revision mensual completada para ${vinculos.length} vinculos`);
  } catch (err) {
    console.error("[AsesorAlertScan] Error en revision mensual:", err);
  }
}

// ── Helpers ──────────────────────────────────────────────

async function checkPlazosFiscales(asesoriaId, now) {
  try {
    const plazos = await sql`SELECT * FROM calendario_fiscal_180`;
    const currentYear = now.getFullYear();

    for (const plazo of plazos) {
      let year = currentYear;
      if ((plazo.periodo === "T4" || plazo.periodo === "Anual") && plazo.mes_vencimiento === 1) {
        year = currentYear;
      }

      const fechaVenc = new Date(year, plazo.mes_vencimiento - 1, plazo.dia_vencimiento);
      const diasRestantes = Math.ceil((fechaVenc - now) / (1000 * 60 * 60 * 24));

      if (diasRestantes >= 0 && diasRestantes <= 7) {
        // Evitar duplicados
        const [existing] = await sql`
          SELECT id FROM notificaciones_asesor_180
          WHERE asesoria_id = ${asesoriaId}
            AND tipo = 'fiscal_deadline'
            AND metadata->>'modelo' = ${plazo.modelo}
            AND metadata->>'periodo' = ${plazo.periodo}
            AND created_at > NOW() - INTERVAL '7 days'
          LIMIT 1
        `;

        if (!existing) {
          await crearNotificacionAsesor({
            asesoriaId,
            tipo: "fiscal_deadline",
            titulo: `Plazo fiscal: ${plazo.modelo}`,
            mensaje: `${plazo.descripcion} vence en ${diasRestantes} dia(s) (${fechaVenc.toLocaleDateString("es-ES")})`,
            metadata: {
              modelo: plazo.modelo,
              periodo: plazo.periodo,
              dias_restantes: diasRestantes,
              fecha_vencimiento: fechaVenc.toISOString().split("T")[0],
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("[AsesorAlertScan] Error checkPlazosFiscales:", err);
  }
}

async function checkDocumentosNuevos(asesoriaId, now) {
  try {
    const docs = await sql`
      SELECT d.empresa_id, e.nombre AS empresa_nombre, COUNT(*)::int AS total
      FROM documentos_asesoria_180 d
      JOIN empresa_180 e ON e.id = d.empresa_id
      WHERE d.asesoria_id = ${asesoriaId}
        AND d.subido_por_tipo = 'admin'
        AND d.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY d.empresa_id, e.nombre
    `;

    for (const doc of docs) {
      // Evitar duplicados
      const [existing] = await sql`
        SELECT id FROM notificaciones_asesor_180
        WHERE asesoria_id = ${asesoriaId}
          AND empresa_id = ${doc.empresa_id}
          AND tipo = 'nuevo_documento'
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `;

      if (!existing) {
        await crearNotificacionAsesor({
          asesoriaId,
          tipo: "nuevo_documento",
          titulo: "Nuevos documentos",
          mensaje: `${doc.empresa_nombre} ha subido ${doc.total} documento(s)`,
          accionUrl: `/asesor/clientes/${doc.empresa_id}/documentos`,
          accionLabel: "Ver documentos",
          empresaId: doc.empresa_id,
        });
      }
    }
  } catch (err) {
    console.error("[AsesorAlertScan] Error checkDocumentosNuevos:", err);
  }
}
