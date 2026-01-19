// backend/src/services/turnoAutoService.js
import { sql } from "../db.js";

// =========================
// Mapeos
// =========================

// Nombre visible por tipo lógico
const NOMBRE_MAP = {
  completo: "Turno completo",
  partido: "Turno partido",
  nocturno: "Turno nocturno",
  rotativo: "Turno rotativo",
  otros: "Turno especial",
  continuo: "Turno continuo",
  discontinuo: "Turno discontinuo",
};

// Normalización a enum físico
function normalizarTipoTurno(tipo) {
  const map = {
    partido: "discontinuo",
    rotativo: "discontinuo",
    nocturno: "discontinuo",
    otros: "discontinuo",

    completo: "continuo",
    intensivo: "continuo",
    continuo: "continuo",
  };

  return map[tipo] || "continuo"; // fallback seguro
}

// =========================
// Servicio principal
// =========================
export async function getOrCreateTurnoCatalogo({ empresaId, tipo }, tx = null) {
  const db = tx || sql;

  const tipoFisico = normalizarTipoTurno(tipo);
  const nombre = NOMBRE_MAP[tipo] || `Turno ${tipo}`;

  // =========================
  // Buscar existente
  // =========================
  const existing = await db`
    SELECT *
    FROM turnos_180
    WHERE empresa_id = ${empresaId}
      AND tipo_turno = ${tipoFisico}
      AND activo = true
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (existing.length) return existing[0];

  // =========================
  // Crear nuevo
  // =========================
  const rows = await db`
    INSERT INTO turnos_180 (
      empresa_id,
      nombre,
      descripcion,
      tipo_turno,
      activo
    )
    VALUES (
      ${empresaId},
      ${nombre},
      ${`Generado automáticamente (${tipo})`},
      ${tipoFisico},
      true
    )
    RETURNING *
  `;

  return rows[0];
}
