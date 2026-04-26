// backend/src/services/appConfigService.js
// Configuración global de la app, editable desde la propia UI por el fabricante.
// Cache en memoria con TTL corto para no consultar BD en cada request.

import { sql } from "../db.js";

const CACHE_TTL_MS = 60 * 1000; // 1 minuto
let cache = { value: null, expiresAt: 0 };

async function loadAll() {
  const rows = await sql`SELECT clave, valor, descripcion, categoria, updated_at FROM app_config_180`;
  const map = {};
  for (const r of rows) map[r.clave] = r;
  return map;
}

async function getCache() {
  const now = Date.now();
  if (cache.value && now < cache.expiresAt) return cache.value;
  const map = await loadAll();
  cache = { value: map, expiresAt: now + CACHE_TTL_MS };
  return map;
}

export function invalidateCache() {
  cache = { value: null, expiresAt: 0 };
}

/**
 * Devuelve el valor de una clave. Prioridad:
 *   1) Si hay env var con el mismo nombre en MAYÚSCULAS, gana (override server-side)
 *   2) Tabla app_config_180
 *   3) defaultValue
 */
export async function getConfig(clave, defaultValue = null) {
  const envName = clave.toUpperCase();
  if (process.env[envName]) return process.env[envName];

  const map = await getCache();
  return map[clave]?.valor ?? defaultValue;
}

export async function listAllConfig() {
  const map = await getCache();
  return Object.values(map).map((r) => ({
    clave: r.clave,
    valor: r.valor,
    descripcion: r.descripcion,
    categoria: r.categoria,
    updated_at: r.updated_at,
    overridden_by_env: !!process.env[r.clave.toUpperCase()],
  }));
}

export async function setConfig(clave, valor, userId = null) {
  const [updated] = await sql`
    INSERT INTO app_config_180 (clave, valor, actualizado_por, updated_at)
    VALUES (${clave}, ${valor}, ${userId}, now())
    ON CONFLICT (clave) DO UPDATE SET
      valor = EXCLUDED.valor,
      actualizado_por = EXCLUDED.actualizado_por,
      updated_at = now()
    RETURNING clave, valor, updated_at
  `;
  invalidateCache();
  return updated;
}
