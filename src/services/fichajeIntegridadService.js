/**
 * Servicio de Integridad de Fichajes - RD 8/2019 + Ley Fichaje Digital 2026
 *
 * Hash SHA-256 encadenado por empleado, siguiendo el patrón de verifactuService.js
 * Cada fichaje se sella con un hash que incluye el hash del fichaje anterior,
 * formando una cadena verificable tipo blockchain.
 */

import { sql } from "../db.js";
import crypto from "crypto";

// ─── HASH GENERATION ────────────────────────────────────────

/**
 * Obtiene el hash del último fichaje en la cadena del empleado.
 * Cada empleado tiene su propia cadena de hashes.
 */
async function obtenerHashAnterior(empresaId, empleadoId) {
  const [ultimo] = await sql`
    SELECT hash_actual FROM fichajes_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND hash_actual IS NOT NULL
    ORDER BY fecha DESC, created_at DESC
    LIMIT 1
  `;
  return ultimo ? ultimo.hash_actual : "";
}

/**
 * Serialización canónica con keys ordenadas (determinista).
 * Replica canonicalJsonStringify de verifactuService.js
 */
function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const keys = Object.keys(obj).sort();
  const sortedObj = {};
  keys.forEach((key) => {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      sortedObj[key] = JSON.parse(canonicalJsonStringify(obj[key]));
    } else {
      sortedObj[key] = obj[key];
    }
  });
  return JSON.stringify(sortedObj);
}

/**
 * Genera hash SHA-256 canónico del fichaje.
 *
 * Campos incluidos (orden alfabético para determinismo):
 * - empleado_id, empresa_id, fecha (ISO 8601), hash_anterior, jornada_id, tipo
 */
function generarHashFichaje(fichaje, hashAnterior) {
  const payload = {
    empleado_id: String(fichaje.empleado_id),
    empresa_id: String(fichaje.empresa_id),
    fecha: new Date(fichaje.fecha).toISOString(),
    hash_anterior: hashAnterior || "",
    jornada_id: String(fichaje.jornada_id || ""),
    tipo: fichaje.tipo,
  };

  const canonico = canonicalJsonStringify(payload);
  return crypto.createHash("sha256").update(canonico, "utf8").digest("hex");
}

/**
 * Genera hash para un fichaje nuevo.
 * DEBE llamarse ANTES del INSERT (o dentro de transacción) para consistencia.
 *
 * @param {Object} fichaje - { empleado_id, empresa_id, fecha, tipo, jornada_id }
 * @returns {{ hash_actual: string, hash_anterior: string, fecha_hash: Date }}
 */
export async function generarHashFichajeNuevo(fichaje) {
  const hashAnterior = await obtenerHashAnterior(fichaje.empresa_id, fichaje.empleado_id);
  const hashActual = generarHashFichaje(fichaje, hashAnterior);
  const fechaHash = new Date();

  return {
    hash_actual: hashActual,
    hash_anterior: hashAnterior,
    fecha_hash: fechaHash,
  };
}

// ─── CHAIN VERIFICATION ─────────────────────────────────────

/**
 * Verifica la integridad de la cadena de hashes.
 * Recorre todos los fichajes del empleado (o empresa) y recalcula cada hash.
 *
 * @param {string} empresaId - UUID empresa
 * @param {string|null} empleadoId - UUID empleado (null = verificar todos)
 * @returns {{ valido: boolean, total_fichajes: number, errores: Array, empleados_verificados: number }}
 */
export async function verificarIntegridadFichajes(empresaId, empleadoId = null) {
  const fichajes = empleadoId
    ? await sql`
        SELECT id, empleado_id, empresa_id, fecha, tipo, jornada_id,
               hash_actual, hash_anterior, created_at
        FROM fichajes_180
        WHERE empresa_id = ${empresaId} AND empleado_id = ${empleadoId}
          AND hash_actual IS NOT NULL
        ORDER BY empleado_id, fecha ASC, created_at ASC
      `
    : await sql`
        SELECT id, empleado_id, empresa_id, fecha, tipo, jornada_id,
               hash_actual, hash_anterior, created_at
        FROM fichajes_180
        WHERE empresa_id = ${empresaId}
          AND hash_actual IS NOT NULL
        ORDER BY empleado_id, fecha ASC, created_at ASC
      `;

  if (fichajes.length === 0) {
    return { valido: true, total_fichajes: 0, errores: [], empleados_verificados: 0, mensaje: "No hay fichajes con hash para verificar" };
  }

  const errores = [];
  const empleados = new Set();

  // Agrupar por empleado (cada uno tiene su cadena)
  const cadenasPorEmpleado = {};
  fichajes.forEach((f) => {
    empleados.add(f.empleado_id);
    if (!cadenasPorEmpleado[f.empleado_id]) {
      cadenasPorEmpleado[f.empleado_id] = [];
    }
    cadenasPorEmpleado[f.empleado_id].push(f);
  });

  // Verificar cada cadena
  for (const [empId, cadena] of Object.entries(cadenasPorEmpleado)) {
    let hashAnteriorEsperado = "";

    for (let i = 0; i < cadena.length; i++) {
      const fichaje = cadena[i];

      // 1. Verificar enlace con hash anterior
      if (fichaje.hash_anterior !== hashAnteriorEsperado) {
        errores.push({
          fichaje_id: fichaje.id,
          empleado_id: empId,
          fecha: fichaje.fecha,
          tipo: "hash_anterior_no_coincide",
          esperado: hashAnteriorEsperado.substring(0, 16) + "...",
          obtenido: (fichaje.hash_anterior || "").substring(0, 16) + "...",
        });
      }

      // 2. Recalcular hash actual
      const hashCalculado = generarHashFichaje(fichaje, fichaje.hash_anterior);
      if (hashCalculado !== fichaje.hash_actual) {
        errores.push({
          fichaje_id: fichaje.id,
          empleado_id: empId,
          fecha: fichaje.fecha,
          tipo: "hash_actual_no_coincide",
          esperado: hashCalculado.substring(0, 16) + "...",
          obtenido: (fichaje.hash_actual || "").substring(0, 16) + "...",
        });
      }

      hashAnteriorEsperado = fichaje.hash_actual;
    }
  }

  return {
    valido: errores.length === 0,
    total_fichajes: fichajes.length,
    empleados_verificados: empleados.size,
    errores,
    mensaje: errores.length === 0
      ? `Cadena integra: ${fichajes.length} fichajes de ${empleados.size} empleado(s) verificados`
      : `${errores.length} error(es) en ${fichajes.length} fichajes`,
  };
}

/**
 * Estadísticas de la cadena de hashes.
 */
export async function obtenerEstadisticasCadena(empresaId) {
  const [stats] = await sql`
    SELECT
      COUNT(*)::int as total_fichajes,
      COUNT(DISTINCT empleado_id)::int as total_empleados,
      MIN(fecha) as primer_fichaje,
      MAX(fecha) as ultimo_fichaje,
      COUNT(CASE WHEN hash_actual IS NOT NULL THEN 1 END)::int as con_hash,
      COUNT(CASE WHEN hash_actual IS NULL THEN 1 END)::int as sin_hash
    FROM fichajes_180
    WHERE empresa_id = ${empresaId}
  `;
  return stats;
}

/**
 * Regenera hashes para fichajes legacy (sin hash).
 * Se ejecuta una sola vez después de la migración.
 *
 * @param {string} empresaId
 * @returns {{ procesados: number, empleados: number }}
 */
export async function regenerarHashesLegacy(empresaId) {
  const fichajesSinHash = await sql`
    SELECT id, empleado_id, empresa_id, fecha, tipo, jornada_id
    FROM fichajes_180
    WHERE empresa_id = ${empresaId}
      AND hash_actual IS NULL
    ORDER BY empleado_id, fecha ASC, created_at ASC
  `;

  if (fichajesSinHash.length === 0) {
    return { procesados: 0, empleados: 0 };
  }

  // Agrupar por empleado
  const porEmpleado = {};
  fichajesSinHash.forEach((f) => {
    if (!porEmpleado[f.empleado_id]) porEmpleado[f.empleado_id] = [];
    porEmpleado[f.empleado_id].push(f);
  });

  let procesados = 0;

  for (const [empleadoId, fichajes] of Object.entries(porEmpleado)) {
    for (const fichaje of fichajes) {
      const hashData = await generarHashFichajeNuevo(fichaje);

      await sql`
        UPDATE fichajes_180
        SET hash_actual = ${hashData.hash_actual},
            hash_anterior = ${hashData.hash_anterior},
            fecha_hash = ${hashData.fecha_hash}
        WHERE id = ${fichaje.id}
      `;

      procesados++;
    }
  }

  return { procesados, empleados: Object.keys(porEmpleado).length };
}
