import { sql } from "../db.js";

//
// Obtener último fichaje real del usuario
//
const getLastRealFichaje = async (userId, empleadoId) => {
  const rows = await sql`
    SELECT f.*, c.nombre AS cliente_nombre
    FROM fichajes_180 f
    LEFT JOIN clients_180 c ON c.id = f.cliente_id
    WHERE f.user_id = ${userId}
    AND (
      f.empleado_id = ${empleadoId}
      OR (${empleadoId} IS NULL AND f.empleado_id IS NULL)
    )
    ORDER BY f.fecha DESC
    LIMIT 1
  `;
  return rows.length ? rows[0] : null;
};

//
// Endpoint: Obtener estado actual del fichaje
//
export const getEstadoFichaje = async (req, res) => {
  try {
    //
    // 1. Determinar si usuario es empleado o autónomo
    //
    let empleadoId = null;
    let empresaId = null;

    const empleado = await sql`
      SELECT id, activo, empresa_id 
      FROM employees_180
      WHERE user_id = ${req.user.id}
    `;

    const esEmpleado = empleado.length > 0;

    if (esEmpleado) {
      empleadoId = empleado[0].id;
      empresaId = empleado[0].empresa_id;

      if (!empleado[0].activo) {
        return res.status(403).json({ error: "Empleado desactivado" });
      }
    }

    //
    // 2. Obtener último fichaje real
    //
    const last = await getLastRealFichaje(req.user.id, empleadoId);

    //
    // 3. Determinar estado actual según último fichaje
    //
    let estado = "fuera"; // fuera, dentro, descanso
    let clienteActual = null; // cliente en el que está trabajando
    let acciones = []; // lo que puede hacer ahora

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

    //
    // 4. Acciones permitidas según el estado actual
    //
    if (estado === "fuera") {
      acciones = ["entrada"];
    }

    if (estado === "dentro") {
      acciones = ["salida", "descanso_inicio"];
    }

    if (estado === "descanso") {
      acciones = ["descanso_fin"];
    }

    //
    // 5. Enviar respuesta final
    //
    return res.json({
      estado, // dentro / fuera / descanso
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
