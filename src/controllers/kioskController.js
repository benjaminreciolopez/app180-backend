// backend/src/controllers/kioskController.js

import { sql } from "../db.js";
import crypto from "crypto";
import { crearFichajeInterno } from "../services/fichajeSharedService.js";
import { createAndSendOTP, verifyOTP } from "../services/otpService.js";
import { getClientIp } from "../utils/clientIp.js";
import { registrarAuditoria } from "../middlewares/auditMiddleware.js";

// ─── ADMIN: Registrar dispositivo kiosko ─────────────────────

export const registerKioskDevice = async (req, res) => {
  try {
    const { nombre, centro_trabajo_id, offline_pin } = req.body;
    const empresaId = req.user.empresa_id;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El nombre del dispositivo es obligatorio" });
    }

    // Validar centro de trabajo si se proporciona
    if (centro_trabajo_id) {
      const [centro] = await sql`
        SELECT id FROM centros_trabajo_180
        WHERE id = ${centro_trabajo_id} AND empresa_id = ${empresaId}
      `;
      if (!centro) {
        return res.status(404).json({ error: "Centro de trabajo no encontrado" });
      }
    }

    const deviceToken = crypto.randomBytes(32).toString("hex");

    const [device] = await sql`
      INSERT INTO kiosk_devices_180 (empresa_id, centro_trabajo_id, nombre, device_token, offline_pin)
      VALUES (${empresaId}, ${centro_trabajo_id || null}, ${nombre.trim()}, ${deviceToken}, ${offline_pin || null})
      RETURNING id, nombre, centro_trabajo_id, created_at
    `;

    return res.json({
      success: true,
      device_token: deviceToken,
      device: device,
    });
  } catch (err) {
    console.error("❌ Error en registerKioskDevice:", err);
    return res.status(500).json({ error: "Error al registrar dispositivo" });
  }
};

// ─── ADMIN: Listar dispositivos ──────────────────────────────

export const listKioskDevices = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;

    const devices = await sql`
      SELECT
        kd.id, kd.nombre, kd.activo, kd.ultimo_uso, kd.created_at,
        kd.centro_trabajo_id, kd.device_token, kd.offline_pin,
        ct.nombre AS centro_nombre
      FROM kiosk_devices_180 kd
      LEFT JOIN centros_trabajo_180 ct ON ct.id = kd.centro_trabajo_id
      WHERE kd.empresa_id = ${empresaId}
      ORDER BY kd.created_at DESC
    `;

    return res.json(devices);
  } catch (err) {
    console.error("❌ Error en listKioskDevices:", err);
    return res.status(500).json({ error: "Error al listar dispositivos" });
  }
};

// ─── ADMIN: Activar/desactivar dispositivo ───────────────────

export const updateKioskDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo, nombre, centro_trabajo_id, offline_pin } = req.body;
    const empresaId = req.user.empresa_id;

    const updates = {};
    if (typeof activo === "boolean") updates.activo = activo;
    if (nombre) updates.nombre = nombre.trim();
    if (centro_trabajo_id !== undefined) updates.centro_trabajo_id = centro_trabajo_id || null;
    if (offline_pin !== undefined) updates.offline_pin = offline_pin || null;

    const [device] = await sql`
      UPDATE kiosk_devices_180
      SET
        activo = COALESCE(${updates.activo ?? null}, activo),
        nombre = COALESCE(${updates.nombre ?? null}, nombre),
        centro_trabajo_id = CASE WHEN ${centro_trabajo_id !== undefined} THEN ${updates.centro_trabajo_id} ELSE centro_trabajo_id END,
        offline_pin = CASE WHEN ${offline_pin !== undefined} THEN ${updates.offline_pin} ELSE offline_pin END
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING id, nombre, activo, centro_trabajo_id
    `;

    if (!device) {
      return res.status(404).json({ error: "Dispositivo no encontrado" });
    }

    return res.json({ success: true, device });
  } catch (err) {
    console.error("❌ Error en updateKioskDevice:", err);
    return res.status(500).json({ error: "Error al actualizar dispositivo" });
  }
};

// ─── KIOSK: Obtener configuración ────────────────────────────

export const getKioskConfig = async (req, res) => {
  try {
    const { empresa_id } = req.kiosk;

    const [config] = await sql`
      SELECT
        e.nombre AS empresa_nombre,
        e.logo_url,
        ec.kiosk_auth_method,
        ec.kiosk_idle_timeout_seconds,
        ec.kiosk_show_photo
      FROM empresa_180 e
      LEFT JOIN empresa_config_180 ec ON ec.empresa_id = e.id
      WHERE e.id = ${empresa_id}
    `;

    return res.json({
      empresa_nombre: config?.empresa_nombre || "",
      logo_url: config?.logo_url || null,
      centro_nombre: req.kiosk.centro_nombre || null,
      device_nombre: req.kiosk.nombre,
      auth_method: config?.kiosk_auth_method || "otp_email",
      idle_timeout: config?.kiosk_idle_timeout_seconds || 30,
      show_photo: config?.kiosk_show_photo !== false,
      has_offline_pin: !!req.kiosk.offline_pin,
    });
  } catch (err) {
    console.error("❌ Error en getKioskConfig:", err);
    return res.status(500).json({ error: "Error al obtener configuración" });
  }
};

// ─── KIOSK: Identificar empleado ─────────────────────────────

export const identifyEmployee = async (req, res) => {
  try {
    const { query } = req.body;
    const { empresa_id, id: deviceId, centro_trabajo_id } = req.kiosk;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: "Código o nombre requerido" });
    }

    const searchTerm = query.trim();

    // Comprobar si hay empleados asignados a este kiosco
    const assignments = await sql`
      SELECT empleado_id FROM kiosk_empleados_180
      WHERE kiosk_device_id = ${deviceId}
    `;
    const hasAssignments = assignments.length > 0;
    const assignedIds = assignments.map((a) => a.empleado_id);

    // Prioridad de filtrado:
    // 1. Si hay asignaciones explícitas en kiosk_empleados_180 → solo esos
    // 2. Si no hay asignaciones pero el kiosco tiene centro_trabajo_id → empleados de ese centro
    // 3. Sin asignaciones ni centro → todos los empleados de la empresa
    let employees;

    if (hasAssignments) {
      employees = await sql`
        SELECT id, nombre, codigo_empleado, foto_url
        FROM employees_180
        WHERE empresa_id = ${empresa_id}
          AND activo = true
          AND id = ANY(${assignedIds})
          AND (
            codigo_empleado = ${searchTerm}
            OR nombre ILIKE ${"%" + searchTerm + "%"}
          )
        ORDER BY
          CASE WHEN codigo_empleado = ${searchTerm} THEN 0 ELSE 1 END,
          nombre ASC
        LIMIT 5
      `;
    } else if (centro_trabajo_id) {
      // Filtrar por empleados asignados al mismo centro de trabajo que el kiosco
      employees = await sql`
        SELECT id, nombre, codigo_empleado, foto_url
        FROM employees_180
        WHERE empresa_id = ${empresa_id}
          AND activo = true
          AND centro_trabajo_id = ${centro_trabajo_id}
          AND (
            codigo_empleado = ${searchTerm}
            OR nombre ILIKE ${"%" + searchTerm + "%"}
          )
        ORDER BY
          CASE WHEN codigo_empleado = ${searchTerm} THEN 0 ELSE 1 END,
          nombre ASC
        LIMIT 5
      `;
    } else {
      employees = await sql`
        SELECT id, nombre, codigo_empleado, foto_url
        FROM employees_180
        WHERE empresa_id = ${empresa_id}
          AND activo = true
          AND (
            codigo_empleado = ${searchTerm}
            OR nombre ILIKE ${"%" + searchTerm + "%"}
          )
        ORDER BY
          CASE WHEN codigo_empleado = ${searchTerm} THEN 0 ELSE 1 END,
          nombre ASC
        LIMIT 5
      `;
    }

    return res.json(employees);
  } catch (err) {
    console.error("❌ Error en identifyEmployee:", err);
    return res.status(500).json({ error: "Error al buscar empleado" });
  }
};

// ─── KIOSK: Estado del fichaje de un empleado ────────────────

export const getKioskEstado = async (req, res) => {
  try {
    const { empleado_id } = req.body;
    const { empresa_id } = req.kiosk;

    if (!empleado_id) {
      return res.status(400).json({ error: "empleado_id requerido" });
    }

    // Verificar que el empleado pertenece a esta empresa
    const [empleado] = await sql`
      SELECT id, nombre, activo
      FROM employees_180
      WHERE id = ${empleado_id} AND empresa_id = ${empresa_id}
    `;

    if (!empleado) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    if (!empleado.activo) {
      return res.status(403).json({ error: "Empleado desactivado" });
    }

    // Último fichaje del empleado
    const [last] = await sql`
      SELECT tipo, fecha
      FROM fichajes_180
      WHERE empleado_id = ${empleado_id}
        AND empresa_id = ${empresa_id}
      ORDER BY fecha DESC
      LIMIT 1
    `;

    let estado = "fuera";
    if (last) {
      if (last.tipo === "entrada" || last.tipo === "descanso_fin") estado = "dentro";
      if (last.tipo === "descanso_inicio") estado = "descanso";
      if (last.tipo === "salida") estado = "fuera";
    }

    // Determinar próxima acción
    let accion = "entrada";
    if (estado === "dentro") accion = "salida"; // o descanso_inicio
    if (estado === "descanso") accion = "descanso_fin";

    // Acciones posibles
    const acciones_posibles = [];
    if (estado === "fuera") acciones_posibles.push("entrada");
    if (estado === "dentro") {
      acciones_posibles.push("salida", "descanso_inicio");
    }
    if (estado === "descanso") acciones_posibles.push("descanso_fin");

    return res.json({
      empleado_id,
      nombre: empleado.nombre,
      estado,
      accion,
      acciones_posibles,
      ultimo_fichaje: last || null,
    });
  } catch (err) {
    console.error("❌ Error en getKioskEstado:", err);
    return res.status(500).json({ error: "Error al obtener estado" });
  }
};

// ─── KIOSK: Crear fichaje ────────────────────────────────────

export const createKioskFichaje = async (req, res) => {
  try {
    const { empleado_id, tipo, otp_code, offline_pin, subtipo } = req.body;
    const { empresa_id, centro_trabajo_id, id: deviceId } = req.kiosk;

    if (!empleado_id || !tipo) {
      return res.status(400).json({ error: "empleado_id y tipo son obligatorios" });
    }

    const TIPOS = ["entrada", "salida", "descanso_inicio", "descanso_fin"];
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ error: "Tipo de fichaje no válido" });
    }

    // Validar subtipo si se proporciona
    if (subtipo && !["pausa_corta", "comida", "trayecto"].includes(subtipo)) {
      return res.status(400).json({ error: "Subtipo de descanso no válido" });
    }

    if (subtipo && tipo !== "descanso_inicio") {
      return res.status(400).json({ error: "Subtipo solo aplicable a descanso_inicio" });
    }

    // Verificar OTP o PIN offline
    if (otp_code) {
      try {
        const otpValid = await verifyOTP({ empleadoId: empleado_id, code: otp_code });
        if (!otpValid) {
          return res.status(401).json({ error: "Código OTP inválido o expirado" });
        }
      } catch (otpErr) {
        return res.status(429).json({ error: otpErr.message });
      }
    } else if (offline_pin) {
      // Verificar PIN offline del dispositivo
      if (req.kiosk.offline_pin && offline_pin !== req.kiosk.offline_pin) {
        return res.status(401).json({ error: "PIN offline incorrecto" });
      }
    }

    const clientIp = getClientIp(req);

    const result = await crearFichajeInterno({
      empleadoId: empleado_id,
      empresaId: empresa_id,
      tipo,
      fechaHora: new Date(),
      centroTrabajoId: centro_trabajo_id,
      origen: "kiosk",
      reqIp: clientIp,
      skipPlanCheck: true, // Kiosko no valida planificación (disponible 24/7)
      skipGeoValidation: true, // Kiosko usa ubicación fija del centro
      subtipo: subtipo || null,
    });

    // Audit trail
    try {
      await registrarAuditoria({
        empresaId: empresa_id,
        userId: null,
        empleadoId: empleado_id,
        accion: "fichaje_creado_kiosk",
        entidadTipo: "fichaje",
        entidadId: result.fichaje.id,
        datosNuevos: {
          tipo,
          fecha: result.fichaje.fecha,
          kiosk_device: req.kiosk.nombre,
          hash: result.fichaje.hash_actual?.substring(0, 16),
        },
        motivo: `Fichaje ${tipo} desde kiosko "${req.kiosk.nombre}"`,
        req,
      });
    } catch (_) { /* audit no bloquea */ }

    return res.json({
      success: true,
      fichaje: result.fichaje,
      incidencias: result.incidencias,
    });
  } catch (err) {
    console.error("❌ Error en createKioskFichaje:", err);

    // Errores conocidos del servicio
    if (err.message.includes("no encontrado") || err.message.includes("desactivado")) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes("No hay jornada")) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message.includes("no permitido") || err.message.includes("ausencia") || err.message.includes("laboral")) {
      return res.status(403).json({ error: err.message });
    }

    return res.status(500).json({ error: "Error al registrar fichaje" });
  }
};

// ─── KIOSK: Solicitar OTP ────────────────────────────────────

export const requestOTP = async (req, res) => {
  try {
    const { empleado_id } = req.body;
    const { empresa_id } = req.kiosk;

    if (!empleado_id) {
      return res.status(400).json({ error: "empleado_id requerido" });
    }

    const result = await createAndSendOTP({
      empleadoId: empleado_id,
      empresaId: empresa_id,
    });

    return res.json(result);
  } catch (err) {
    console.error("❌ Error en requestOTP:", err);

    if (err.message.includes("Demasiados")) {
      return res.status(429).json({ error: err.message });
    }
    if (err.message.includes("no encontrado") || err.message.includes("no tiene")) {
      return res.status(400).json({ error: err.message });
    }

    return res.status(500).json({ error: "Error al enviar código de verificación" });
  }
};

// ─── KIOSK: Anular fichaje (ventana de deshacer) ────────────

export const voidKioskFichaje = async (req, res) => {
  try {
    const { fichaje_id } = req.body;
    const { empresa_id } = req.kiosk;

    if (!fichaje_id) return res.status(400).json({ error: "fichaje_id requerido" });

    // Solo anular fichajes de último minuto, desde kiosko, no ya anulados
    const [fichaje] = await sql`
      SELECT id FROM fichajes_180
      WHERE id = ${fichaje_id}
        AND empresa_id = ${empresa_id}
        AND origen IN ('kiosk', 'offline_sync')
        AND (anulado = false OR anulado IS NULL)
        AND fecha > NOW() - INTERVAL '60 seconds'
    `;

    if (!fichaje) {
      return res.status(404).json({ error: "Fichaje no encontrado o fuera de la ventana de anulación" });
    }

    await sql`
      UPDATE fichajes_180
      SET anulado = true,
          anulado_at = NOW(),
          anulado_motivo = 'Anulado desde kiosco (error de identidad)'
      WHERE id = ${fichaje_id}
    `;

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error en voidKioskFichaje:", err);
    return res.status(500).json({ error: "Error al anular fichaje" });
  }
};

// ─── ADMIN: Eliminar dispositivo kiosko ─────────────────────

export const deleteKioskDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;

    const result = await sql`
      DELETE FROM kiosk_devices_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;

    if (result.count === 0) {
      return res.status(404).json({ error: "Dispositivo no encontrado" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error en deleteKioskDevice:", err);
    return res.status(500).json({ error: "Error al eliminar dispositivo" });
  }
};

// ─── KIOSK: Verificar PIN offline ────────────────────────────

export const verifyOfflinePin = async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({ error: "PIN requerido" });
    }

    if (!req.kiosk.offline_pin) {
      return res.status(400).json({ error: "Este dispositivo no tiene PIN offline configurado" });
    }

    const valid = pin === req.kiosk.offline_pin;

    return res.json({ valid });
  } catch (err) {
    console.error("❌ Error en verifyOfflinePin:", err);
    return res.status(500).json({ error: "Error al verificar PIN" });
  }
};
