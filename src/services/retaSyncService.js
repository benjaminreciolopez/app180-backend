// backend/src/services/retaSyncService.js
//
// Sincronización entre cambios de base RETA y otros artefactos vinculados:
//   - Gastos recurrentes (cuota mensual de autónomo)
//   - (futuro) eventos del calendario fiscal, alertas...
//
// Filosofía: solo se toca lo que esté EXPLÍCITAMENTE vinculado. Los registros
// manuales (sin vínculo) se respetan siempre.

import { sql } from "../db.js";

/**
 * Actualiza el importe de los gastos recurrentes vinculados al perfil RETA dado
 * con la nueva cuota mensual.
 *
 * @param {string} empresaId
 * @param {number} ejercicio
 * @param {string|null} titularId
 * @param {number} nuevaCuota - cuota mensual a aplicar (en €, ej. 314.79)
 * @returns {Promise<Array<{id:number, nombre:string, importe_anterior:number}>>}
 *          lista de gastos recurrentes actualizados (0..n).
 */
export async function syncGastosRecurrentesPerfilReta(empresaId, ejercicio, titularId, nuevaCuota) {
  if (!empresaId || !nuevaCuota || nuevaCuota <= 0) return [];

  // 1) Localizar el perfil RETA (mismo titular o sin titular)
  const [perfil] = titularId
    ? await sql`
        SELECT id FROM reta_autonomo_perfil_180
        WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id = ${titularId}
        LIMIT 1
      `
    : await sql`
        SELECT id FROM reta_autonomo_perfil_180
        WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id IS NULL
        LIMIT 1
      `;
  if (!perfil) return [];

  // 2) Capturar importe anterior (para devolverlo al UI / log)
  const previos = await sql`
    SELECT id, nombre, total AS importe_anterior
    FROM gastos_recurrentes_180
    WHERE vinculado_perfil_reta_id = ${perfil.id}
      AND activo = true
  `;
  if (previos.length === 0) return [];

  // 3) Actualizar. La cuota RETA está exenta de IVA — base = total, IVA = 0.
  await sql`
    UPDATE gastos_recurrentes_180
    SET base_imponible = ${nuevaCuota},
        iva_porcentaje = 0,
        iva_importe = 0,
        retencion_porcentaje = 0,
        retencion_importe = 0,
        total = ${nuevaCuota},
        updated_at = NOW()
    WHERE vinculado_perfil_reta_id = ${perfil.id}
      AND activo = true
  `;

  return previos.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    importe_anterior: parseFloat(r.importe_anterior),
    importe_nuevo: nuevaCuota,
  }));
}
