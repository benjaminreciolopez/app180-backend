// backend/src/controllers/fichajeEstadoController.js
import { sql } from "../db.js";
import { getPlanDiaEstado } from "../services/planDiaEstadoService.js";

const getLastRealFichaje = async (userId, empleadoId) => {
  if (empleadoId) {
    const rows = await sql`
      SELECT f.*, c.nombre AS cliente_nombre
      FROM fichajes_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.user_id = ${userId}
        AND f.empleado_id = ${empleadoId}
      ORDER BY f.fecha DESC
      LIMIT 1
    `;
    return rows[0] || null;
  } else {
    const rows = await sql`
      SELECT f.*, c.nombre AS cliente_nombre
      FROM fichajes_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.user_id = ${userId}
        AND f.empleado_id IS NULL
      ORDER BY f.fecha DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }
};

export const getEstadoFichaje = async (req, res) => {
  try {
    let empleadoId = req.user.empleado_id || null;
    let empresaId = req.user.empresa_id || null;

    let esEmpleado = false;

    if (req.user.role === "empleado") {
      esEmpleado = true;

      if (!empleadoId) {
        const empleado = await sql`
          SELECT id, activo, empresa_id 
          FROM employees_180
          WHERE user_id = ${req.user.id}
          LIMIT 1
        `;

        if (empleado.length === 0) {
          return res.status(404).json({ error: "Empleado no encontrado" });
        }

        if (!empleado[0].activo) {
          return res.status(403).json({ error: "Empleado desactivado" });
        }

        empleadoId = empleado[0].id;
        empresaId = empleado[0].empresa_id;
      }
    }

    const last = await getLastRealFichaje(req.user.id, empleadoId);

    let estado = "fuera";
    let clienteActual = null;

    if (last) {
      if (last.tipo === "entrada" || last.tipo === "descanso_fin")
        estado = "dentro";
      if (last.tipo === "descanso_inicio") estado = "descanso";
      if (last.tipo === "salida") estado = "fuera";

      if (last.cliente_id) {
        clienteActual = {
          id: last.cliente_id,
          nombre: last.cliente_nombre,
        };
      }
    }

    // =========================
    // Estado del botón (plan + ausencia + margen)
    // =========================
    const hoy = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const estadoPlan = esEmpleado
      ? await getPlanDiaEstado({
          empresaId,
          empleadoId,
          fecha: hoy,
        })
      : null;

    const botonVisible = estadoPlan ? Boolean(estadoPlan.boton_visible) : true;

    const acciones_permitidas =
      estadoPlan && botonVisible ? estadoPlan.acciones_permitidas || [] : [];

    return res.json({
      estado,
      ultimo_fichaje: last || null,
      cliente_actual: clienteActual,
      acciones_permitidas,
      es_empleado: esEmpleado,
      empleado_id: empleadoId,
      empresa_id: empresaId,

      // Contrato final del botón
      boton: estadoPlan
        ? {
            visible: Boolean(estadoPlan.boton_visible),
            color: estadoPlan.color || "negro",
            puede_fichar: Boolean(estadoPlan.puede_fichar),
            mensaje: estadoPlan.mensaje || null,
            accion:
              estadoPlan.boton_visible && estadoPlan.accion
                ? estadoPlan.accion
                : null,
            objetivo_hhmm: estadoPlan.objetivo_hhmm || null,
            margen_antes: estadoPlan.margen_antes,
            margen_despues: estadoPlan.margen_despues,
            motivo_oculto: estadoPlan.motivo_oculto || null,

            // ✅ AÑADIR ESTO
            ausencia: estadoPlan.ausencia || null,
            calendario: estadoPlan.calendario || null,
          }
        : {
            visible: true,
            color: "negro",
            puede_fichar: false,
            accion: null,
          },
    });
  } catch (err) {
    console.error("❌ Error en getEstadoFichaje:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener estado del fichaje" });
  }
};
// backend/src/controllers/fichajeEstadoController.js
