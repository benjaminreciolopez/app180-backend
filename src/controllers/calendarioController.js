import { sql } from "../db.js";

const addOneDay = (dateStr) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
};

//
// Utilidad para obtener rango por defecto (mes actual)
//
const getRangoFechas = (desde, hasta) => {
  if (desde && hasta) return { desde, hasta };

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

  const toStr = (d) => d.toISOString().split("T")[0];

  return {
    desde: desde || toStr(inicioMes),
    hasta: hasta || toStr(finMes),
  };
};

//
// CALENDARIO DEL USUARIO (empleado o autónomo)
//
export const getCalendarioUsuario = async (req, res) => {
  try {
    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);

    // 👇 USAR EL empleado_id DEL JWT (no buscar por user_id)
    const empleadoId = req.user.empleado_id;
    const empleadoNombre = req.user.nombre;

    if (!empleadoId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    // =========================
    // AUSENCIAS DEL EMPLEADO
    // =========================
    const ausencias = await sql`
      SELECT id, tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
      ORDER BY fecha_inicio ASC
    `;

    // =========================
    // FICHAJES (por user_id)
    // =========================
    const fichajes = await sql`
      SELECT 
        f.id,
        f.tipo,
        f.fecha,
        f.cliente_id,
        c.nombre AS cliente_nombre
      FROM fichajes_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.user_id = ${req.user.id}
        AND f.fecha::date BETWEEN ${desde} AND ${hasta}
      ORDER BY f.fecha ASC
    `;

    // =========================
    // MAPEO A EVENTOS
    // =========================
    const eventosAusencias = ausencias.map((a) => ({
      id: `aus-${a.id}`,
      tipo: a.tipo,
      subtipo: a.tipo,
      title: a.tipo === "baja_medica" ? `Baja médica` : `Vacaciones`,
      start: a.fecha_inicio,
      end: addOneDay(a.fecha_fin),
      allDay: true,
      estado: a.estado,
    }));

    const eventosFichajes = fichajes.map((f) => ({
      id: `fic-${f.id}`,
      tipo: "fichaje",
      subtipo: f.tipo,
      title: f.cliente_nombre ? `${f.tipo} - ${f.cliente_nombre}` : f.tipo,
      start: f.fecha,
      allDay: false,
    }));

    const eventos = [...eventosAusencias, ...eventosFichajes];

    return res.json(eventos);
  } catch (err) {
    console.error("❌ Error en getCalendarioUsuario:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener calendario del usuario" });
  }
};
//
// CALENDARIO DE EMPRESA (solo admin)
//
export const getCalendarioEmpresa = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);

    // Empresa del admin
    const empresaRows = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (empresaRows.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }
    const empresaId = empresaRows[0].id;

    // Empleados de la empresa
    const empleados = await sql`
      SELECT e.id, e.nombre, u.id AS user_id
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      WHERE e.empresa_id = ${empresaId}
    `;

    if (empleados.length === 0) {
      return res.json([]);
    }

    const empleadoIds = empleados.map((e) => e.id);
    const userIds = empleados.map((e) => e.user_id);

    // AUSENCIAS de la empresa
    const ausencias = await sql`
      SELECT 
        a.id,
        a.tipo,
        a.fecha_inicio,
        a.fecha_fin,
        a.estado,
        a.empleado_id,
        e.nombre AS empleado_nombre
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
      AND a.fecha_inicio <= ${hasta}
      AND a.fecha_fin >= ${desde}
      ORDER BY a.fecha_inicio ASC
    `;

    // FICHAJES de los empleados de la empresa
    const fichajes = await sql`
      SELECT 
        f.id,
        f.tipo,
        f.fecha,
        f.cliente_id,
        f.empleado_id,
        u.nombre AS empleado_nombre,
        c.nombre AS cliente_nombre
      FROM fichajes_180 f
      LEFT JOIN users_180 u ON u.id = f.user_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.empleado_id = ANY(${empleadoIds})
      AND f.fecha::date BETWEEN ${desde} AND ${hasta}
      ORDER BY f.fecha ASC
    `;

    const eventosAusencias = ausencias.map((a) => ({
      id: `aus-${a.id}`,
      tipo: a.tipo,
      subtipo: a.tipo,
      title:
        a.tipo === "baja_medica"
          ? `${a.empleado_nombre} - Baja médica`
          : `${a.empleado_nombre} - Vacaciones`,
      start: a.fecha_inicio,
      end: addOneDay(a.fecha_fin),
      allDay: true,
      estado: a.estado,
      empleado_id: a.empleado_id,
    }));

    const eventosFichajes = fichajes.map((f) => ({
      id: `fic-${f.id}`,
      tipo: "fichaje",
      subtipo: f.tipo,
      title: f.cliente_nombre
        ? `${f.empleado_nombre} - ${f.tipo} - ${f.cliente_nombre}`
        : `${f.empleado_nombre} - ${f.tipo}`,
      start: f.fecha,
      allDay: false,
    }));

    return res.json([...eventosAusencias, ...eventosFichajes]);
  } catch (err) {
    console.error("❌ Error en getCalendarioEmpresa:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener calendario de empresa" });
  }
};

export const getEstadoHoyUsuario = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;

    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const hoy = new Date().toISOString().slice(0, 10);

    // 1️⃣ ¿Ausencia aprobada?
    const ausencia = await sql`
      SELECT tipo
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
        AND estado = 'aprobado'
        AND fecha_inicio <= ${hoy}
        AND fecha_fin >= ${hoy}
      LIMIT 1
    `;

    if (ausencia.length > 0) {
      return res.json({
        laborable: false,
        motivo: ausencia[0].tipo,
        label: ausencia[0].tipo === "vacaciones" ? "Vacaciones" : "Baja médica",
      });
    }

    // 2️⃣ ¿Festivo empresa?
    const festivo = await sql`
      SELECT es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresa_id}
        AND fecha = ${hoy}
      LIMIT 1
    `;

    if (festivo.length > 0 && festivo[0].es_laborable === false) {
      return res.json({
        laborable: false,
        motivo: "festivo",
        label: "Festivo",
      });
    }

    // 3️⃣ Es laborable
    return res.json({ laborable: true });
  } catch (err) {
    console.error("❌ getEstadoHoyUsuario:", err);
    res.status(500).json({ error: "Error comprobando día laboral" });
  }
};
