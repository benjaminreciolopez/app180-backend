// backend/src/services/turnoAutoService.js
import { sql } from "../db.js";

const NOMBRE_MAP = {
  completo: "Turno completo",
  partido: "Turno partido",
  nocturno: "Turno nocturno",
  rotativo: "Turno rotativo",
  otros: "Turno especial",
};

export async function getOrCreateTurnoCatalogo({ empresaId, tipo }, tx = null) {
  const db = tx || sql;

  const nombre = NOMBRE_MAP[tipo] || "Turno";

  const existing = await db`
    SELECT *
    FROM turnos_180
    WHERE empresa_id = ${empresaId}
      AND tipo_turno = ${tipo}
      AND activo = true
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (existing.length) return existing[0];

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
      ${tipo},
      true
    )
    RETURNING *
  `;

  return rows[0];
}
