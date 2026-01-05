import { sql } from "../db.js";
import { ejecutarAutocierre } from "../jobs/autocierre.js";
import { detectarFichajeSospechoso } from "../services/fichajeSospechoso.js";
import { validarFichajeSegunTurno } from "../services/fichajesValidacionService.js";
import {
  obtenerJornadaAbierta,
  crearJornada,
} from "../services/jornadasService.js";
import { calcularMinutos } from "../services/jornadasCalculo.js";
import { calcularDescansoJornada } from "../services/jornadasCalculo.js";
import { calcularExtras } from "../services/jornadasExtras.js";
//
// Obtener último fichaje del empleado/autónomo
//
const getLastFichaje = async (empleadoId) => {
  const rows = await sql`
    SELECT *
    FROM fichajes_180
    WHERE 
      (empleado_id = ${empleadoId}
       OR (empleado_id IS NULL AND ${empleadoId} IS NULL))
    ORDER BY fecha DESC
    LIMIT 1
  `;
  return rows.length ? rows[0] : null;
};

//
// Registrar fichaje
//
export const createFichaje = async (req, res) => {
  try {
    const { tipo, cliente_id, lat, lng } = req.body;

    const tiposValidos = [
      "entrada",
      "salida",
      "descanso_inicio",
      "descanso_fin",
    ];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo de fichaje no válido" });
    }

    // 1. Determinar si empleado o autónomo
    let empleadoId = null;
    let empresaId = null;

    const empleado = await sql`
  SELECT id, activo, empresa_id, tipo_trabajo, turno_id
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

      // 1.1 Bloqueo por ausencia aprobada
      const hoy = new Date().toISOString().split("T")[0];

      const ausencia = await sql`
        SELECT tipo
        FROM ausencias_180
        WHERE empleado_id = ${empleadoId}
        AND estado = 'aprobado'
        AND fecha_inicio <= ${hoy}
        AND fecha_fin >= ${hoy}
      `;

      if (ausencia.length > 0) {
        const tipoAus =
          ausencia[0].tipo === "baja_medica" ? "baja médica" : "vacaciones";
        return res.status(403).json({
          error: `No puedes fichar porque estás en ${tipoAus}.`,
        });
      }

      // 1.2 Validar cliente obligatorio solo si empresa tiene clientes
      // 1.2 Validar cliente obligatorio solo si empresa tiene clientes
      const clientesEmpresa = await sql`
  SELECT id FROM clients_180 WHERE empresa_id = ${empresaId}
`;

      const tipoTrabajo = empleado[0].tipo_trabajo;

      if (
        clientesEmpresa.length > 0 &&
        tipoTrabajo === "oficina" &&
        tipo === "entrada" &&
        !cliente_id
      ) {
        return res.status(400).json({
          error: "Debes seleccionar un cliente",
        });
      }

      if (cliente_id) {
        const cliente = await sql`
    SELECT id FROM clients_180
    WHERE id = ${cliente_id}
    AND empresa_id = ${empresaId}
  `;

        if (cliente.length === 0) {
          return res.status(400).json({
            error: "Cliente no válido para esta empresa",
          });
        }
      }
    }
    if (esEmpleado) {
      const v = await validarFichajeSegunTurno({
        empleadoId,
        empresaId,
        fechaHora: new Date(),
        tipo,
      });

      if (!v.ok) {
        return res.status(v.status || 400).json({
          error: v.error,
          code: v.code,
        });
      }
    }

    // 3. Validación de secuencia
    const last = await getLastFichaje(empleadoId);

    if (tipo === "entrada") {
      if (last && last.tipo !== "salida") {
        return res.status(400).json({
          error: "Ya tienes una entrada activa.",
        });
      }
    }

    if (tipo === "salida") {
      if (!last || last.tipo === "salida") {
        return res.status(400).json({
          error: "Debes fichar entrada antes de fichar salida",
        });
      }
    }

    if (tipo === "descanso_inicio") {
      if (!last || !["entrada", "descanso_fin"].includes(last.tipo)) {
        return res.status(400).json({
          error: "No puedes iniciar descanso ahora",
        });
      }
    }

    if (tipo === "descanso_fin") {
      if (!last || last.tipo !== "descanso_inicio") {
        return res.status(400).json({
          error: "No puedes finalizar descanso ahora",
        });
      }
    }
    // 4. Detección de fichaje sospechoso
    const analisis = await detectarFichajeSospechoso({
      userId: req.user.id,
      empleadoId,
      tipo,
      lat,
      lng,
      clienteId: cliente_id || null,
      deviceHash: req.headers["x-device-id"] || null,
      reqIp: req.ip || req.headers["x-forwarded-for"] || null,
    });

    let estado = analisis.sospechoso ? "sospechoso" : "confirmado";
    let nota = analisis.sospechoso ? analisis.razones.join(" | ") : null;
    const detalle_ip = analisis?.ipInfo || null;
    const distancia_km = analisis?.distanciaKm || null;
    let jornada = null;
    let jornadaId = null;

    if (esEmpleado) {
      jornada = await obtenerJornadaAbierta(empleadoId);
    }

    if (tipo === "entrada" && esEmpleado) {
      if (!jornada) {
        jornada = await crearJornada({
          empresaId,
          empleadoId,
          inicio: new Date(),
        });
      }
      jornadaId = jornada.id;
    }

    if (tipo === "salida" && esEmpleado) {
      if (!jornada) {
        return res.status(400).json({
          error: "No hay jornada abierta para cerrar",
        });
      }

      const fin = new Date();
      const minutos = calcularMinutos(jornada.inicio, fin);
      const descanso = await calcularDescansoJornada(jornada.id);

      const turno = await sql`
    SELECT t.*
    FROM turnos_180 t
    JOIN employees_180 e ON e.turno_id = t.id
    WHERE e.id = ${empleadoId}
  `;

      const minutosExtra = calcularExtras({
        minutos_trabajados: minutos - descanso,
        horas_objetivo_dia: turno[0]?.horas_dia_objetivo,
      });

      await cerrarJornada({
        jornadaId: jornada.id,
        fin,
        minutos_trabajados: minutos - descanso,
        minutos_descanso: descanso,
        minutos_extra: minutosExtra,
        origen_cierre: "app",
      });

      jornadaId = jornada.id;
    }

    if ((tipo === "descanso_inicio" || tipo === "descanso_fin") && esEmpleado) {
      if (!jornada) {
        return res.status(400).json({
          error: "No hay jornada abierta para registrar descanso",
        });
      }
      jornadaId = jornada.id;
    }
    // 2. Autocierre inteligente
    if (tipo === "entrada" || tipo === "salida") {
      await ejecutarAutocierre();
    }

    // 5. Insertar fichaje
    const nuevo = await sql`
INSERT INTO fichajes_180 (
  user_id,
  empleado_id,
  cliente_id,
  empresa_id,
  jornada_id,
  tipo,
  lat,
  lng,
  ip,
  estado,
  origen,
  nota,
  sospechoso,
  sospecha_motivo,
  ip_info,
  distancia_km
)
VALUES (
  ${req.user.id},
  ${empleadoId},
  ${cliente_id || null},
  ${empresaId},
  ${jornadaId},
  ${tipo},
  ${lat || null},
  ${lng || null},
  ${req.ip},
  ${estado},
  'app',
  ${nota},
  ${analisis.sospechoso},
  ${analisis.sospechoso ? analisis.razones.join(" | ") : null},
  ${detalle_ip ? JSON.stringify(detalle_ip) : null},
  ${distancia_km}
)
RETURNING *
`;
    if (analisis.sospechoso) {
      await sql`
    INSERT INTO notificaciones_180 (empresa_id, mensaje, tipo)
    VALUES (${empresaId}, ${"Nuevo fichaje sospechoso"}, 'alerta')
  `;
    }

    return res.json({
      success: true,
      fichaje: nuevo[0],
    });
  } catch (err) {
    console.error("❌ Error en createFichaje:", err);
    return res.status(500).json({ error: "Error al registrar fichaje" });
  }
};

//
// FICH. SOSPECHOSOS + FILTROS
//
export const getFichajesSospechosos = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    // Obtener empresa del admin
    const empresa = await sql`
      SELECT id
      FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresa[0].id;

    // Obtener IDs de empleados de la empresa
    const empleados = await sql`
      SELECT id FROM employees_180
      WHERE empresa_id = ${empresaId}
    `;

    if (empleados.length === 0) return res.json([]); // No hay fichajes

    const empleadoIds = empleados.map((e) => e.id);

    const resultados = await sql`
      SELECT 
        f.*,
        u.nombre AS nombre_usuario,
        c.nombre AS nombre_cliente,
        e.nombre AS nombre_empleado
      FROM fichajes_180 f
      LEFT JOIN users_180 u ON u.id = f.user_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      LEFT JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.empleado_id = ANY(${empleadoIds})
      AND f.sospechoso = true
      ORDER BY f.fecha DESC
    `;

    return res.json(resultados);
  } catch (err) {
    console.error("❌ Error en getFichajesSospechosos:", err);
    return res.status(500).json({
      error: "Error al obtener fichajes sospechosos",
    });
  }
};

//
// VALIDAR FICHAJE SOSPECHOSO
//
export const validarFichaje = async (req, res) => {
  try {
    const { id } = req.params;
    const { accion } = req.body;

    if (!["confirmar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción inválida" });
    }

    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (adminEmpresa.length === 0)
      return res.status(403).json({ error: "No autorizado" });

    const update = await sql`
      UPDATE fichajes_180
      SET estado = ${accion === "confirmar" ? "confirmado" : "rechazado"}
      WHERE id = ${id}
      RETURNING *
    `;

    return res.json({
      success: true,
      fichaje: update[0],
    });
  } catch (err) {
    console.error("❌ Error en validarFichaje:", err);
    return res.status(500).json({
      error: "Error al actualizar fichaje",
    });
  }
};

//
// FICHAJES DEL DÍA DEL USUARIO
//
export const getTodayFichajes = async (req, res) => {
  try {
    const hoy = new Date().toISOString().split("T")[0];

    // Ver si es empleado
    const empleado = await sql`
      SELECT id FROM employees_180 
      WHERE user_id = ${req.user.id}
    `;

    let resultados;

    if (empleado.length > 0) {
      // Es empleado → fichajes por empleado
      resultados = await sql`
        SELECT *
        FROM fichajes_180
        WHERE empleado_id = ${empleado[0].id}
        AND fecha::date = ${hoy}
        ORDER BY fecha ASC
      `;
    } else {
      // Es autónomo → fichajes por user_id
      resultados = await sql`
        SELECT *
        FROM fichajes_180
        WHERE user_id = ${req.user.id}
        AND fecha::date = ${hoy}
        ORDER BY fecha ASC
      `;
    }

    return res.json(resultados);
  } catch (err) {
    console.error("❌ Error en getTodayFichajes:", err);
    return res.status(500).json({
      error: "Error al obtener fichajes del día",
    });
  }
};
export const registrarFichajeManual = async (req, res) => {
  try {
    const { empleado_id, tipo, fecha_hora } = req.body;

    if (!empleado_id || !tipo || !fecha_hora) {
      return res.status(400).json({
        error: "Empleado, tipo y fecha_hora son obligatorios",
      });
    }

    const tiposValidos = [
      "entrada",
      "salida",
      "descanso_inicio",
      "descanso_fin",
    ];

    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo no válido" });
    }

    const empleado = await sql`
      SELECT empresa_id
      FROM employees_180
      WHERE id = ${empleado_id}
    `;

    if (empleado.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    const nuevo = await sql`
      INSERT INTO fichajes_180 (
        empleado_id,
        empresa_id,
        tipo,
        fecha,
        estado,
        origen
      )
      VALUES (
        ${empleado_id},
        ${empleado[0].empresa_id},
        ${tipo},
        ${fecha_hora}::timestamptz,
        'confirmado',
        'manual_admin'
      )
      RETURNING *
    `;

    return res.json(nuevo[0]);
  } catch (err) {
    console.error("❌ Error fichaje manual", err);
    return res.status(500).json({ error: "Error registrando fichaje manual" });
  }
};

export const getFichajeDetalle = async (req, res) => {
  try {
    const { id } = req.params;

    const fichaje = await sql`
      SELECT 
        f.*,
        e.nombre AS empleado_nombre
      FROM fichajes_180 f
      LEFT JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id}
    `;

    if (fichaje.length === 0)
      return res.status(404).json({ error: "Fichaje no encontrado" });

    res.json(fichaje[0]);
  } catch (err) {
    console.error("Error obteniendo detalle sospechoso", err);
    res.status(500).json({ error: "Error cargando detalle" });
  }
};

export const getFichajes = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const empresa = await sql`
      SELECT id FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0)
      return res.status(400).json({ error: "Empresa no encontrada" });

    const empresaId = empresa[0].id;

    const resultados = await sql`
      SELECT 
        f.*,
        e.nombre AS empleado_nombre
      FROM fichajes_180 f
      LEFT JOIN employees_180 e ON e.id = f.empleado_id
      WHERE e.empresa_id = ${empresaId}
      ORDER BY f.fecha DESC
    `;

    return res.json(resultados);
  } catch (err) {
    console.error("❌ Error en getFichajes:", err);
    return res.status(500).json({ error: "Error obteniendo fichajes" });
  }
};
