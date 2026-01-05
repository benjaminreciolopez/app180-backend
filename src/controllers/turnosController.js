import {
  obtenerTurno,
  insertarTurno,
  editarTurno,
  borrarTurno,
} from "../services/turnosService.js";
import { sql } from "../db.js";

import { obtenerEmpresaUsuario } from "../helpers/empresaHelper.js";
import { obtenerTurnosEmpresa } from "../services/turnosService.js";

export async function getTurnos(req, res) {
  console.log("USER JWT:", req.user);
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const turnos = await sql`
      SELECT *
      FROM turnos_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
      ORDER BY nombre
    `;

    res.json(turnos);
  } catch (e) {
    console.error("❌ Error GET turnos:", e);
    res.status(500).json({ error: "Error al obtener turnos" });
  }
}

export async function getTurno(req, res) {
  try {
    const turno = await obtenerTurno(req.params.id);
    res.json(turno);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al obtener turno" });
  }
}

export async function getTurnoEmpleado(req, res) {
  try {
    const empleadoId = req.params.id;
    const empresaId = req.user?.empresa_id;

    if (!empresaId) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const result = await sql`
      SELECT
        e.id AS empleado_id,
        e.turno_id,
        t.nombre,
        t.descripcion,
        t.tipo_turno,
        t.tipo_horario,
        t.horas_dia_objetivo,
        t.max_horas_dia,
        t.max_horas_semana,
        t.minutos_descanso_min,
        t.minutos_descanso_max,
        t.nocturno_permitido
      FROM employees_180 e
      LEFT JOIN turnos_180 t ON t.id = e.turno_id
      WHERE e.id = ${empleadoId}
        AND e.empresa_id = ${empresaId}
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    res.json(result[0]);
  } catch (e) {
    console.error("❌ Error obteniendo turno empleado:", e);
    res.status(500).json({ error: "Error al obtener turno del empleado" });
  }
}

export async function createTurno(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ error: "Usuario no autenticado" });

    const empresaId = await obtenerEmpresaUsuario(userId);

    const nuevo = await insertarTurno({
      ...req.body,
      empresa_id: empresaId,
    });

    res.json(nuevo);
  } catch (e) {
    console.error("❌ Error creando turno:", e);
    res.status(500).json({ error: "Error al crear turno" });
  }
}

export async function updateTurno(req, res) {
  try {
    const actualizado = await editarTurno(req.params.id, req.body);
    res.json(actualizado);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al actualizar turno" });
  }
}

export async function deleteTurno(req, res) {
  try {
    await borrarTurno(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al eliminar turno" });
  }
}

export async function asignarTurnoEmpleado(req, res) {
  try {
    const empleadoId = req.params.id;
    const { turno_id } = req.body;

    // 🔐 Usuario autenticado
    const user = req.user;
    if (!user?.id || !user?.empresa_id) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const empresaId = user.empresa_id;

    // 1️⃣ Verificar que el empleado pertenece a la empresa
    const empleado = await sql`
      SELECT id
      FROM employees_180
      WHERE id = ${empleadoId}
        AND empresa_id = ${empresaId}
    `;

    if (empleado.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    // 2️⃣ Quitar turno (permitido)
    if (turno_id === null) {
      const result = await sql`
        UPDATE employees_180
        SET turno_id = NULL
        WHERE id = ${empleadoId}
        RETURNING *
      `;

      return res.json(result[0]);
    }

    // 3️⃣ Validar turno (empresa + activo)
    const turno = await sql`
      SELECT id
      FROM turnos_180
      WHERE id = ${turno_id}
        AND empresa_id = ${empresaId}
        AND activo = true
    `;

    if (turno.length === 0) {
      return res.status(400).json({ error: "Turno no válido" });
    }

    // 4️⃣ Asignar turno
    const result = await sql`
      UPDATE employees_180
      SET turno_id = ${turno_id}
      WHERE id = ${empleadoId}
      RETURNING *
    `;

    res.json(result[0]);
  } catch (e) {
    console.error("❌ Error asignando turno:", e);
    res.status(500).json({ error: "Error asignando turno" });
  }
}
