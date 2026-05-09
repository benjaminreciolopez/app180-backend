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

/**
 * Si NO hay gastos recurrentes vinculados al perfil RETA, intenta:
 *   1. Detectar un gasto recurrente "candidato" (categoría = autonomo,
 *      o nombre con "cuota"/"autónomo"/"seguridad social"/"reta") y
 *      vincularlo al perfil — preserva lo que ya hizo el asesor a mano.
 *   2. Si no hay candidato, crear uno nuevo con valores por defecto
 *      apropiados para una cuota RETA española (proveedor TGSS, cuenta 476,
 *      IVA y retención 0, método domiciliación, día 28).
 *
 * Idempotente: si ya hay gastos vinculados al perfil, no hace nada.
 *
 * @returns {Promise<{accion: 'ninguna'|'vinculado'|'creado', gasto?: object}>}
 */
export async function crearOrLinkGastoRecurrenteReta({
  empresaId,
  ejercicio,
  titularId = null,
  cuotaMensual,
  titularNombre = null,
}) {
  if (!empresaId || !cuotaMensual || cuotaMensual <= 0) {
    return { accion: "ninguna" };
  }

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
  if (!perfil) return { accion: "ninguna" };

  // 0) ¿Ya hay un gasto vinculado al perfil? Entonces nada que hacer.
  const [yaVinculado] = await sql`
    SELECT id FROM gastos_recurrentes_180
    WHERE vinculado_perfil_reta_id = ${perfil.id} AND activo = true
    LIMIT 1
  `;
  if (yaVinculado) return { accion: "ninguna" };

  // 1) ¿Hay un candidato sin vincular?
  //    Buscamos por categoría 'autonomo' o nombre que contenga palabras clave.
  const [candidato] = await sql`
    SELECT id FROM gastos_recurrentes_180
    WHERE empresa_id = ${empresaId}
      AND activo = true
      AND vinculado_perfil_reta_id IS NULL
      AND (
        categoria IN ('autonomo', 'autónomo')
        OR nombre ILIKE '%cuota%'
        OR nombre ILIKE '%aut[oó]nomo%'
        OR nombre ILIKE '%seguridad social%'
        OR nombre ILIKE '%reta%'
        OR proveedor ILIKE '%tesorer%'
      )
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (candidato) {
    const [updated] = await sql`
      UPDATE gastos_recurrentes_180
      SET vinculado_perfil_reta_id = ${perfil.id},
          base_imponible = ${cuotaMensual},
          iva_porcentaje = 0,
          iva_importe = 0,
          retencion_porcentaje = 0,
          retencion_importe = 0,
          total = ${cuotaMensual},
          updated_at = NOW()
      WHERE id = ${candidato.id}
      RETURNING *
    `;
    return { accion: "vinculado", gasto: updated };
  }

  // 2) Crear uno nuevo con valores por defecto típicos
  const nombre = titularNombre
    ? `Cuota RETA · ${titularNombre}`
    : "Cuota RETA autónomo";
  const descripcion = `Cotización mensual del autónomo a la Seguridad Social (base ${cuotaMensual.toFixed(2)} €).`;

  const [creado] = await sql`
    INSERT INTO gastos_recurrentes_180 (
      empresa_id, nombre, proveedor, descripcion,
      base_imponible, iva_porcentaje, iva_importe,
      retencion_porcentaje, retencion_importe, total,
      categoria, metodo_pago, cuenta_contable,
      dia_ejecucion, activo,
      vinculado_perfil_reta_id
    ) VALUES (
      ${empresaId}, ${nombre}, 'Tesorería General de la Seguridad Social', ${descripcion},
      ${cuotaMensual}, 0, 0,
      0, 0, ${cuotaMensual},
      'autonomo', 'domiciliacion', '476',
      28, true,
      ${perfil.id}
    )
    RETURNING *
  `;
  return { accion: "creado", gasto: creado };
}

