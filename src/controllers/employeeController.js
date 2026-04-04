import { sql } from "../db.js";
import { resolveEmpresaId } from "../services/resolveEmpresaId.js";
import bcrypt from "bcryptjs";
import { syncDailyReport } from "../services/dailyReportService.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";
import { saveToStorage } from "./storageController.js";

// ==========================
// CREAR EMPLEADO (PASSWORD FORZADO)
// ==========================
export const createEmployee = async (req, res) => {
  try {
    // 1️⃣ Empresa del admin
    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    const { email, nombre } = req.body;

    if (!email || !nombre) {
      return res.status(400).json({ error: "Email y nombre son obligatorios" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Formato de email inválido" });
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
    console.error("Error createEmployee:", err);
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

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    const empleados = await sql`
      SELECT DISTINCT ON (e.id)
        e.id,
        e.user_id,
        e.nombre,
        e.foto_url,
        u.email,
        e.activo,
        d.device_hash,
        d.activo AS dispositivo_activo,
        p.id AS plantilla_id,
        p.nombre AS plantilla_nombre,
        ct.id AS centro_trabajo_id_actual,
        ct.nombre AS centro_trabajo_nombre,
        ec_act.cliente_id AS cliente_actual_id,
        c_act.nombre AS cliente_actual_nombre,
        c_act.codigo AS cliente_actual_codigo
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id

      LEFT JOIN employee_devices_180 d
        ON d.empleado_id = e.id
      AND d.activo = true

      LEFT JOIN empleado_plantillas_180 ep
        ON ep.empleado_id = e.id
      AND ep.fecha_inicio <= CURRENT_DATE
      AND (ep.fecha_fin IS NULL OR ep.fecha_fin >= CURRENT_DATE)

      LEFT JOIN plantillas_jornada_180 p
        ON p.id = ep.plantilla_id
      AND p.activo = true

      LEFT JOIN centros_trabajo_180 ct
        ON ct.id = e.centro_trabajo_id
      AND ct.activo = true

      LEFT JOIN empleado_clientes_180 ec_act
        ON ec_act.empleado_id = e.id
      AND ec_act.empresa_id = e.empresa_id
      AND ec_act.activo = true
      AND ec_act.fecha_fin IS NULL

      LEFT JOIN clients_180 c_act
        ON c_act.id = ec_act.cliente_id

      WHERE e.empresa_id = ${empresaId}
      ORDER BY e.id, ep.fecha_inicio DESC
    `;

    res.json(empleados);
  } catch (err) {
    console.error("Error listando empleados:", err);
    res.status(500).json({ error: "Error obteniendo empleados" });
  }
};

// ==========================
// ACTIVAR / DESACTIVAR EMPLEADO
// ==========================
export const updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;
    const empresaId = req.user.empresa_id;

    const empleado = await sql`
      UPDATE employees_180
      SET activo = ${activo}
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING id, nombre, activo
    `;

    if (!empleado.length) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    res.json(empleado[0]);
  } catch (err) {
    console.error("Error updateEmployeeStatus:", err);
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
    const user = req.user;
    const empresaId = user.empresa_id;
    const empleadoId = user.empleado_id;

    if (!empresaId || !empleadoId) {
      return res
        .status(403)
        .json({ error: "Empleado sin empresa o sin empleado_id" });
    }

    const day = todayYYYYMMDD();

    // 🔁 Sincroniza parte diario (igual que antes)
    const parte = await syncDailyReport({
      empresaId,
      empleadoId,
      fecha: day,
    });

    // 👤 Datos básicos
    const emp = await sql`
      SELECT nombre
      FROM employees_180
      WHERE id = ${empleadoId}
        AND empresa_id = ${empresaId}
      LIMIT 1
    `;

    // 📆 PLAN DEL DÍA (JORNADA REAL)
    const plan = await resolverPlanDia({
      empresaId,
      empleadoId,
      fecha: day,
    });

    // 🕒 Fichajes de hoy
    const fichajes = await sql`
      SELECT id, tipo, fecha
      FROM fichajes_180
      WHERE empresa_id = ${empresaId}
        AND empleado_id = ${empleadoId}
        AND fecha::date = ${day}::date
      ORDER BY fecha ASC
    `;

    // 🧾 Jornada técnica (abierta/cerrada)
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

      // ⬇️ AHORA SE DEVUELVE LA JORNADA REAL
      jornada: {
        plantilla_id: plan.plantilla_id,
        modo: plan.modo, // semanal | excepcion | sin_plantilla
        rango: plan.rango || null,
        bloques: plan.bloques || [],
        nota: plan.nota || null,
      },

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
    console.error("Error empleadoDashboard:", err);
    return res.status(500).json({ error: "Error cargando dashboard empleado" });
  }
};
// ==========================
// EDITAR EMPLEADO (NOMBRE)
// ==========================
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email } = req.body;

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    // Validar formato de email si se proporciona
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Formato de email inválido" });
      }
    }

    // Obtener el user_id del empleado
    const empleado = await sql`
      SELECT user_id FROM employees_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (empleado.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    const user_id = empleado[0].user_id;

    // Actualizar nombre del empleado
    const updated = await sql`
      UPDATE employees_180
      SET 
        nombre = COALESCE(${nombre}, nombre)
      WHERE id = ${id}
        AND empresa_id = ${empresaId}
      RETURNING id, nombre, activo
    `;

    // Actualizar email en users_180 si se proporciona
    if (email && user_id) {
      await sql`
        UPDATE users_180
        SET email = ${email}
        WHERE id = ${user_id}
      `;
    }

    res.json({ success: true, empleado: updated[0] });
  } catch (err) {
    console.error("Error updateEmployee:", err);
    res.status(500).json({ error: "Error al actualizar empleado" });
  }
};

// ==========================
// SUBIR FOTO DE EMPLEADO
// ==========================
export const uploadEmployeePhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;

    const [emp] = await sql`
      SELECT id FROM employees_180 WHERE id = ${id} AND empresa_id = ${empresaId}
    `;
    if (!emp) return res.status(404).json({ error: "Empleado no encontrado" });
    if (!req.file) return res.status(400).json({ error: "No se subió ninguna foto" });

    const record = await saveToStorage({
      empresaId,
      nombre: `foto_${id}.jpg`,
      buffer: req.file.buffer,
      folder: "employee-photos",
      mimeType: req.file.mimetype,
      useTimestamp: false,
    });

    const publicUrl = `${process.env.SUPABASE_PROJECT_URL}/storage/v1/object/public/app180-files/${record.storage_path}`;

    await sql`
      UPDATE employees_180 SET foto_url = ${publicUrl} WHERE id = ${id}
    `;

    return res.json({ success: true, foto_url: publicUrl });
  } catch (err) {
    console.error("Error uploadEmployeePhoto:", err);
    return res.status(500).json({ error: "Error al subir foto" });
  }
};
