// src/controllers/empleadoCalendarioController.js
import { sql } from "../db.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export const getCalendarioHoyEmpleado = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "Empleado no válido" });
    }

    const fecha = today();

    // 1️⃣ Calendario empresa
    const cal = await sql`
      SELECT es_laborable
      FROM v_dia_laborable_empresa_180
      WHERE empresa_id = ${empresa_id}
        AND fecha = ${fecha}
      LIMIT 1
    `;

    if (!cal.length || cal[0].es_laborable === false) {
      return res.json({
        fecha,
        es_laborable: false,
        bloquea_fichaje: true,
        motivo: "festivo",
        detalle: "Día no laborable según calendario",
      });
    }

    // 2️⃣ Ausencias aprobadas
    const aus = await sql`
      SELECT tipo
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
        AND estado = 'aprobado'
        AND fecha_inicio <= ${fecha}
        AND fecha_fin >= ${fecha}
      LIMIT 1
    `;

    if (aus.length) {
      return res.json({
        fecha,
        es_laborable: false,
        bloquea_fichaje: true,
        motivo: aus[0].tipo,
        detalle:
          aus[0].tipo === "vacaciones"
            ? "Vacaciones aprobadas"
            : "Baja médica aprobada",
      });
    }

    // 3️⃣ Día normal
    return res.json({
      fecha,
      es_laborable: true,
      bloquea_fichaje: false,
      motivo: null,
      detalle: null,
    });
  } catch (err) {
    console.error("❌ empleado calendario hoy:", err);
    res.status(500).json({ error: "Error calendario empleado" });
  }
};

export const getCalendarioEmpleadoRango = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    const { desde, hasta } = req.query;

    const dias = await sql`
    SELECT
            d.fecha,
            d.es_laborable,

            -- evento calendario (domingo/festivo_nacional/empresa...)
            vc.tipo AS cal_tipo,
            vc.nombre AS cal_nombre,
            vc.fuente AS cal_fuente,

            -- ausencia aprobada
            a.tipo AS ausencia_tipo,
            a.estado AS ausencia_estado
          FROM v_dia_laborable_empresa_180 d
          LEFT JOIN v_calendario_empresa_180 vc
            ON vc.empresa_id = d.empresa_id
          AND vc.fecha = d.fecha
          LEFT JOIN ausencias_180 a
            ON a.empleado_id = ${empleado_id}
          AND a.estado = 'aprobado'
          AND d.fecha BETWEEN a.fecha_inicio AND a.fecha_fin
          WHERE d.empresa_id = ${empresa_id}
            AND d.fecha BETWEEN ${desde} AND ${hasta}
          ORDER BY d.fecha
        `;
    // PRIORIDAD:
    /// 1) ausencia aprobada (vacaciones / baja_medica)
    /// 2) calendario (vc.tipo) si existe
    /// 3) fallback: laborable / no laborable

    const eventos = dias
      .map((d) => {
        const fecha = String(d.fecha).slice(0, 10);

        // 1) Ausencia
        if (d.ausencia_tipo) {
          const tipo = d.ausencia_tipo;
          const title =
            tipo === "vacaciones"
              ? "Vacaciones"
              : tipo === "baja_medica"
                ? "Baja médica"
                : String(tipo);

          return {
            id: `${tipo}-${fecha}`,
            tipo,
            title,
            start: fecha,
            end: null,
            allDay: true,
            estado: d.ausencia_estado || "aprobado",
            // detalle opcional:
            // nombre_cal: d.cal_nombre || null,
            // fuente_cal: d.cal_fuente || null,
          };
        }

        // 2) Calendario empresa/nacional (v_calendario_empresa_180)
        if (d.cal_tipo) {
          const tipo = String(d.cal_tipo);
          const title = d.cal_nombre
            ? String(d.cal_nombre)
            : tipo.replaceAll("_", " ");

          return {
            id: `${tipo}-${fecha}`,
            tipo, // ej: festivo_nacional | festivo_local | cierre | laborable_extra
            title,
            start: fecha,
            end: null,
            allDay: true,
            // fuente opcional para debug:
            // fuente: d.cal_fuente || null,
          };
        }

        // 3) Fallback
        if (d.es_laborable === false) {
          return {
            id: `no_laborable-${fecha}`,
            tipo: "no_laborable",
            title: "No laborable",
            start: fecha,
            end: null,
            allDay: true,
          };
        }

        // No pintamos laborable por defecto (menos ruido).
        // Si quieres pintarlo, devuelve un evento "laborable".
        return null;
      })
      .filter(Boolean);

    res.json(eventos);
  } catch (err) {
    console.error("❌ calendario empleado rango:", err);
    res.status(500).json({ error: "Error calendario empleado" });
  }
};
