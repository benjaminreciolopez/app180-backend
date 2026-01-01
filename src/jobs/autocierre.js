import { sql } from "../db.js";

export const ejecutarAutocierre = async () => {
  try {
    console.log("⏳ Ejecutando autocierre inteligente de fichajes...");

    //
    // 1. Buscar fichajes de ENTRADA sin SALIDA posterior
    //    cuya duración ya excede el máximo permitido
    //
    const abiertos = await sql`
      SELECT 
        f.*,
        COALESCE(e.max_duracion_turno, 14) AS max_horas
      FROM fichajes_180 f
      LEFT JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.tipo = 'entrada'
      AND NOT EXISTS (
        SELECT 1 FROM fichajes_180 s
        WHERE s.user_id = f.user_id
        AND (s.empleado_id = f.empleado_id OR (s.empleado_id IS NULL AND f.empleado_id IS NULL))
        AND s.fecha > f.fecha
        AND s.tipo = 'salida'
      )
      AND (NOW() - f.fecha) > (interval '1 hour' * COALESCE(e.max_duracion_turno, 14))
    `;

    if (abiertos.length === 0) {
      console.log("✔ No hay fichajes que autocerrar");
      return;
    }

    console.log(
      `⚠ Detectados ${abiertos.length} fichajes abiertos que deben autocerrarse.`
    );

    //
    // 2. Autocerrar cada uno
    //
    for (const entrada of abiertos) {
      const maxHoras = entrada.max_horas || 14;

      // hora de salida = hora de entrada + max horas del turno
      const salidaHora = new Date(entrada.fecha);
      salidaHora.setHours(salidaHora.getHours() + maxHoras);

      await sql`
        INSERT INTO fichajes_180 (
          user_id, empleado_id, cliente_id, tipo, fecha,
          estado, origen, validado, lat, lng, ip
        )
        VALUES (
          ${entrada.user_id},
          ${entrada.empleado_id},
          ${entrada.cliente_id},
          'salida',
          ${salidaHora.toISOString()},
          'cerrado',
          'autocierre',
          false,
          null, null, null
        )
      `;

      console.log(`✔ Fichaje autocerrado para usuario: ${entrada.user_id}`);
    }

    console.log("✔ Autocierre inteligente completado.");
  } catch (err) {
    console.error("❌ Error ejecutando autocierre:", err);
  }
};
