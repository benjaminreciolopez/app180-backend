import { sql } from "../db.js";
import bcrypt from "bcryptjs";
import { syncDailyReport } from "../services/dailyReportService.js";

// ==========================
// CREAR EMPLEADO (PASSWORD FORZADO)
// ==========================
export const createEmployee = async (req, res) => {
  try {
    // 1️⃣ Empresa del admin
    const empresa = await sql`
      SELECT id
      FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "El usuario no es una empresa" });
    }

    const empresaId = empresa[0].id;
    const { email, nombre } = req.body;

    if (!email || !nombre) {
      return res.status(400).json({ error: "Email y nombre son obligatorios" });
    }

    // 2️⃣ Password inicial
    const PASSWORD_INICIAL = "123456";
    const hashed = await bcrypt.hash(PASSWORD_INICIAL, 10);

    // 3️⃣ Crear usuario
    const userRows = await sql`
      INSERT INTO users_180 (
        email,
        password,
        nombre,
        role,
        password_forced,
        created_at
      )
      VALUES (
        ${email},
        ${hashed},
        ${nombre},
        'empleado',
        true,
        now()
      )
      RETURNING id
    `;

    const userId = userRows[0].id;

    // 4️⃣ Crear empleado (completo)
    const empleadoRows = await sql`
      INSERT INTO employees_180 (
        user_id,
        empresa_id,
        nombre,
        activo,
        tipo_trabajo,
        created_at
      )
      VALUES (
        ${userId},
        ${empresaId},
        ${nombre},
        true,
        'empleado',
        now()
      )
      RETURNING id, nombre, activo
    `;

    return res.json({
      success: true,
      empleado: empleadoRows[0],
      password_inicial: PASSWORD_INICIAL,
    });
  } catch (err) {
    console.error("❌ createEmployee:", err);
    return res.status(500).json({ error: "Error al crear empleado" });
  }
};
// ==========================
// LISTAR EMPLEADOS DEL ADMIN
// ==========================
export const getEmployeesAdmin = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (!empresa.length) {
      return res.status(403).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresa[0].id;

    const empleados = await sql`
      SELECT
        e.id,
        e.nombre,
        u.email,
        e.activo,
        t.nombre AS turno_nombre,
        d.activo AS dispositivo_activo,
        d.device_hash
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      LEFT JOIN turnos_180 t ON t.id = e.turno_id
      LEFT JOIN LATERAL (
        SELECT device_hash, activo
        FROM employee_devices_180
        WHERE empleado_id = e.id
        ORDER BY created_at DESC
        LIMIT 1
      ) d ON true
      WHERE e.empresa_id = ${empresaId}
      ORDER BY e.nombre
    `;

    res.json(empleados);
  } catch (err) {
    console.error("❌ Error listando empleados:", err);
    res.status(500).json({ error: "Error obteniendo empleados" });
  }
};

// ==========================
// ACTIVAR / DESACTIVAR EMPLEADO
// ==========================
export const updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params; // id del empleado
    const { activo } = req.body; // true / false

    const empleado = await sql`
      UPDATE employees_180
      SET activo = ${activo}
      WHERE id = ${id}
      RETURNING id, nombre, activo
    `;

    res.json(empleado[0]);
  } catch (err) {
    console.error("❌ Error en updateEmployeeStatus:", err);
    res.status(500).json({ error: "Error al actualizar estado del empleado" });
  }
};
function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mapEstado(estado) {
  switch (estado) {
    case "abierto":
      return { label: "En curso", color: "green-600" };
    case "completo":
      return { label: "Completado", color: "green-600" };
    case "incidencia":
      return { label: "Incidencia", color: "red-600" };
    case "incompleto":
      return { label: "Incompleto", color: "yellow-600" };
    case "ausente":
      return { label: "Ausencia", color: "gray-500" };
    case "solo_trabajo":
      return { label: "Trabajo sin fichaje", color: "blue-600" };
    default:
      return { label: "Sin datos", color: "gray-500" };
  }
}

function hhmm(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function nextAccionFromFichajes(fichajes) {
  // Regla simple: alternancia y descansos.
  // Ajusta si tu backend ya tiene lógica más completa.
  if (!Array.isArray(fichajes) || fichajes.length === 0) return "entrada";

  const last = fichajes[fichajes.length - 1]?.tipo;
  if (last === "entrada") return "descanso_inicio"; // o "salida" según política
  if (last === "descanso_inicio") return "descanso_fin";
  if (last === "descanso_fin") return "salida";
  if (last === "salida") return null;

  return "entrada";
}

export const empleadoDashboard = async (req, res) => {
  try {
    const user = req.user; // tu middleware JWT ya lo pone
    const empresaId = user.empresa_id;
    const empleadoId = user.empleado_id;

    if (!empresaId || !empleadoId) {
      return res
        .status(403)
        .json({ error: "Empleado sin empresa o sin empleado_id" });
    }

    const day = todayYYYYMMDD();

    // Fuerza sincronización (seguro e idempotente)
    const parte = await syncDailyReport({
      empresaId,
      empleadoId,
      fecha: day,
    });

    const emp = await sql`
      SELECT e.nombre, e.turno_id, t.nombre AS turno_nombre
      FROM employees_180 e
      LEFT JOIN turnos_180 t ON t.id = e.turno_id
      WHERE e.id = ${empleadoId}
        AND e.empresa_id = ${empresaId}
      LIMIT 1
    `;

    const fichajes = await sql`
      SELECT id, tipo, fecha
      FROM fichajes_180
      WHERE empresa_id = ${empresaId}
        AND empleado_id = ${empleadoId}
        AND fecha::date = ${day}::date
      ORDER BY fecha ASC
    `;

    const jornadas = await sql`
      SELECT id, estado, inicio, fin
      FROM jornadas_180
      WHERE empresa_id = ${empresaId}
        AND empleado_id = ${empleadoId}
        AND fecha = ${day}::date
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const jornada = jornadas[0] || null;

    const fichando = jornada
      ? String(jornada.estado).toLowerCase().includes("abiert")
      : false;
    const accion = nextAccionFromFichajes(fichajes);

    const { label, color } = mapEstado(parte?.estado);

    return res.json({
      nombre: emp[0]?.nombre || user.nombre || "Empleado",
      turno: { nombre: emp[0]?.turno_nombre || null },
      fichando,
      estado_label: label,
      estado_color: color,
      minutos_trabajados_hoy:
        parte?.horas_trabajadas != null ? `${parte.horas_trabajadas} h` : "—",
      accion,
      fichajes_hoy: fichajes.map((f) => ({
        id: f.id,
        tipo_label: f.tipo,
        hora: f.fecha ? hhmm(f.fecha) : "--:--",
      })),
    });
  } catch (err) {
    console.error("❌ empleadoDashboard:", err);
    return res.status(500).json({ error: "Error cargando dashboard empleado" });
  }
};
