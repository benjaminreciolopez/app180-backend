// backend\src\controllers\fichajeEstadoController.js

import { sql } from "../db.js";

//
// Obtener último fichaje real del usuario
//
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

//
// Endpoint: Obtener estado actual del fichaje
//
export const getEstadoFichaje = async (req, res) => {
  try {
    console.log("🔍 Estado fichaje req.user:", req.user);

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
    let acciones = [];

    if (last) {
      if (last.tipo === "entrada" || last.tipo === "descanso_fin") {
        estado = "dentro";
      }

      if (last.tipo === "descanso_inicio") {
        estado = "descanso";
      }

      if (last.tipo === "salida") {
        estado = "fuera";
      }

      if (last.cliente_id) {
        clienteActual = {
          id: last.cliente_id,
          nombre: last.cliente_nombre,
        };
      }
    }

    if (estado === "fuera") {
      acciones = ["entrada"];
    }

    if (estado === "dentro") {
      acciones = ["salida", "descanso_inicio"];
    }

    if (estado === "descanso") {
      acciones = ["descanso_fin"];
    }

    return res.json({
      estado,
      ultimo_fichaje: last || null,
      cliente_actual: clienteActual,
      acciones_permitidas: acciones,
      es_empleado: esEmpleado,
      empleado_id: empleadoId,
      empresa_id: empresaId,
    });
  } catch (err) {
    console.error("❌ Error en getEstadoFichaje:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener estado del fichaje" });
  }
};
